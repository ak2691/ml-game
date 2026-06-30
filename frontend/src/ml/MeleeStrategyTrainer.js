import * as tf from "@tensorflow/tfjs";
import { buildInputVector } from "./Featurebuilder.js";
import { selectMovementAction } from "./MovementActions.js";
import { generateMeleeStrategyDataset, STRATEGY_TIME_LIMIT_MS } from "./MeleeStrategy.js";

const BATCH_SIZE = 64;
const HEAD_INDEX = { movement: 0, rotation: 1, swing: 2, block: 3, dash: 4 };

export async function trainMeleeStrategy(model, configuration, {
    onEpoch = null,
    shouldStop = () => false,
    timeLimitMs = STRATEGY_TIME_LIMIT_MS,
    random = Math.random,
    learningRate = 0.01,
} = {}) {
    await tf.ready();
    const startedAt = performance.now();
    const dataset = generateMeleeStrategyDataset(configuration, { random });
    const trainedHeads = new Set(dataset.training.map((example) => example.trainHead));
    if (dataset.training.some((example) => example.trainHead === "dash" && example.targets.movementIndex !== 0)) {
        trainedHeads.add("movement");
    }
    const weightsBeforeTraining = snapshotHeadWeights(model, trainedHeads);
    const optimizers = Object.fromEntries(Object.keys(HEAD_INDEX).map((head) => [head, tf.train.adam(learningRate)]));
    let epochsCompleted = 0;
    let stoppedByTimeLimit = false;
    let finalLoss = null;

    try {
        for (let epoch = 0; epoch < dataset.configuration.epochLimit; epoch += 1) {
            shuffle(dataset.training, random);
            let lossTotal = 0;
            let batchCount = 0;

            for (const head of Object.keys(HEAD_INDEX)) {
                const examples = dataset.training.filter((example) => example.trainHead === head);
                for (let start = 0; start < examples.length; start += BATCH_SIZE) {
                    const batch = examples.slice(start, start + BATCH_SIZE);
                    if (!batch.length) continue;
                    const loss = trainHeadBatch(model, head, batch, optimizers[head]);
                    if (head === "dash" && batch.some((example) => example.targets.movementIndex !== 0)) {
                        trainHeadBatch(model, "movement", batch, optimizers.movement);
                    }
                    lossTotal += loss;
                    batchCount += 1;
                    stoppedByTimeLimit = performance.now() - startedAt >= timeLimitMs;
                    if (stoppedByTimeLimit || shouldStop()) break;
                    await tf.nextFrame();
                }
                if (stoppedByTimeLimit || shouldStop()) break;
            }

            finalLoss = lossTotal / Math.max(batchCount, 1);
            epochsCompleted = epoch + 1;
            const validation = evaluateValidation(model, dataset.validation);
            onEpoch?.({
                epoch: epochsCompleted,
                epochs: dataset.configuration.epochLimit,
                loss: finalLoss,
                validationLoss: validation.validationLoss,
                elapsedMs: Math.round(performance.now() - startedAt),
            });
            if (stoppedByTimeLimit || shouldStop()) break;
        }

        const headWeightDeltas = measureHeadWeightDeltas(model, weightsBeforeTraining);
        const unchangedHeads = [...trainedHeads].filter((head) => headWeightDeltas[head] <= 1e-8);
        if (unchangedHeads.length) {
            throw new Error(`Training did not update the ${unchangedHeads.join(", ")} model head(s).`);
        }

        return {
            version: "melee-logic-block-training-metrics-v2",
            configuration: dataset.configuration,
            trainingSamples: dataset.training.length,
            validationSamples: dataset.validation.length,
            epochsCompleted,
            epochLimit: dataset.configuration.epochLimit,
            learningRate,
            finalLoss,
            elapsedMs: Math.round(performance.now() - startedAt),
            stoppedByTimeLimit,
            stoppedByUser: shouldStop(),
            headWeightDeltas,
            ...evaluateValidation(model, dataset.validation),
        };
    } finally {
        Object.values(optimizers).forEach((optimizer) => optimizer.dispose());
    }
}

function snapshotHeadWeights(model, heads) {
    return Object.fromEntries([...heads].map((head) => [
        head,
        model.getLayer(head).getWeights().map((weight) => Array.from(weight.dataSync())),
    ]));
}

function measureHeadWeightDeltas(model, snapshots) {
    return Object.fromEntries(Object.entries(snapshots).map(([head, beforeWeights]) => {
        const afterWeights = model.getLayer(head).getWeights();
        let largestDelta = 0;
        afterWeights.forEach((weight, weightIndex) => {
            const after = weight.dataSync();
            const before = beforeWeights[weightIndex];
            for (let index = 0; index < after.length; index += 1) {
                largestDelta = Math.max(largestDelta, Math.abs(after[index] - before[index]));
            }
        });
        return [head, largestDelta];
    }));
}

export function predictPolicyAction(model, payload) {
    const inputVector = buildInputVector(payload);
    return tf.tidy(() => {
        const output = model.predict(tf.tensor2d([inputVector]));
        const [movementTensor, rotationTensor, swingTensor, blockTensor, dashTensor] = output;
        const movementProbabilities = Array.from(movementTensor.dataSync());
        const movement = selectMovementAction(movementProbabilities);
        const [dRot = 0] = rotationTensor.dataSync();
        const [swing = 0] = swingTensor.dataSync();
        const [block = 0] = blockTensor.dataSync();
        const [dash = 0] = dashTensor.dataSync();
        return { ...movement, movementProbabilities, dRot, swing, block, dash };
    });
}

function trainHeadBatch(model, head, examples, optimizer) {
    const inputs = tf.tensor2d(examples.map((example) => example.input));
    const targetKey = head === "movement" ? "movement" : head;
    const targets = tf.tensor2d(examples.map((example) => example.targets[targetKey]));
    const sampleWeights = tf.tensor1d(examples.map((example) => example.sampleWeight ?? 1));
    const layerNames = head === "movement"
        ? ["movement_strategy", "movement"]
        : head === "swing"
            ? ["swing_strategy", "swing"]
            : [head];
    const variables = layerNames.flatMap((layerName) => (
        model.getLayer(layerName).trainableWeights.map((weight) => weight.val)
    ));
    try {
        const lossTensor = optimizer.minimize(() => tf.tidy(() => {
            const prediction = model.apply(inputs, { training: true })[HEAD_INDEX[head]];
            if (head === "movement") {
                const perExampleLoss = targets.mul(prediction.clipByValue(1e-7, 1).log()).sum(-1).neg();
                return perExampleLoss.mul(sampleWeights).sum().div(sampleWeights.sum());
            }
            if (head === "rotation") {
                return prediction.sub(targets).square().mean();
            }
            const safe = prediction.clipByValue(1e-7, 1 - 1e-7);
            return targets.mul(safe.log())
                .add(tf.scalar(1).sub(targets).mul(tf.scalar(1).sub(safe).log()))
                .neg().mean();
        }), true, variables);
        const value = lossTensor.dataSync()[0];
        lossTensor.dispose();
        return value;
    } finally {
        inputs.dispose();
        targets.dispose();
        sampleWeights.dispose();
    }
}

function evaluateValidation(model, examples) {
    if (!examples.length) return emptyMetrics();
    return tf.tidy(() => {
        const inputs = tf.tensor2d(examples.map((example) => example.input));
        const outputs = model.predict(inputs);
        const movementValues = outputs[0].arraySync();
        const rotationValues = outputs[1].dataSync();
        const binaryValues = {
            swing: outputs[2].dataSync(), block: outputs[3].dataSync(), dash: outputs[4].dataSync(),
        };
        let correct = 0;
        let loss = 0;
        let rotationAbsoluteError = 0;
        const headTotals = { movement: 0, rotation: 0, swing: 0, block: 0, dash: 0 };
        const headCorrect = { ...headTotals };

        examples.forEach((example, index) => {
            const head = example.trainHead;
            headTotals[head] += 1;
            if (head === "movement") {
                const predicted = maxIndex(movementValues[index]);
                const expected = example.targets.movementIndex;
                const hit = predicted === expected;
                correct += hit ? 1 : 0;
                headCorrect.movement += hit ? 1 : 0;
                loss -= Math.log(Math.max(movementValues[index][expected], 1e-7));
            } else if (head === "rotation") {
                const expected = example.targets.rotation[0];
                const error = Math.abs(rotationValues[index] - expected);
                const hit = error <= 0.15;
                correct += hit ? 1 : 0;
                headCorrect.rotation += hit ? 1 : 0;
                rotationAbsoluteError += error;
                loss += error * error;
            } else {
                const expected = Boolean(example.targets[head][0]);
                const probability = binaryValues[head][index];
                const hit = (probability >= 0.5) === expected;
                correct += hit ? 1 : 0;
                headCorrect[head] += hit ? 1 : 0;
                loss -= expected ? Math.log(Math.max(probability, 1e-7)) : Math.log(Math.max(1 - probability, 1e-7));
            }
        });
        const count = examples.length;
        return {
            validationLoss: loss / count,
            logicAccuracy: correct / count,
            movementAccuracy: ratio(headCorrect.movement, headTotals.movement),
            rotationAccuracy: ratio(headCorrect.rotation, headTotals.rotation),
            rotationMeanAbsoluteError: headTotals.rotation
                ? rotationAbsoluteError / headTotals.rotation
                : null,
            swingAccuracy: ratio(headCorrect.swing, headTotals.swing),
            blockAccuracy: ratio(headCorrect.block, headTotals.block),
            dashAccuracy: ratio(headCorrect.dash, headTotals.dash),
        };
    });
}

function emptyMetrics() {
    return {
        validationLoss: null,
        logicAccuracy: null,
        movementAccuracy: null,
        rotationAccuracy: null,
        rotationMeanAbsoluteError: null,
        swingAccuracy: null,
        blockAccuracy: null,
        dashAccuracy: null,
    };
}
function ratio(value, total) { return total ? value / total : null; }
function maxIndex(values) {
    let result = 0;
    for (let index = 1; index < values.length; index += 1) if (values[index] > values[result]) result = index;
    return result;
}
function shuffle(items, random) {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [items[index], items[other]] = [items[other], items[index]];
    }
}
