import * as tf from "@tensorflow/tfjs";
import { buildInputVector } from "./Featurebuilder.js";

const CANVAS_CENTER_MIN = 270;
const CANVAS_CENTER_MAX = 530;
const AWARENESS_RANGE = 240;
const SWING_RANGE = 92;
const SWING_ALIGNMENT_DEGREES = 15;
const ROTATION_FULL_SPEED_DEGREES = 90;

/**
 * Trains only the mechanical melee heads from generated arena states.
 * Movement has no labels and is reset to a neutral zero output afterward.
 */
export async function trainSupervisedMeleeBase(model, {
    sampleCount = 6000,
    epochs = 18,
    batchSize = 128,
    validationFraction = 0.15,
    onEpoch = null,
    random = Math.random,
} = {}) {
    await tf.ready();
    const examples = Array.from({ length: sampleCount }, () => createExample(random));
    shuffle(examples, random);

    const validationCount = Math.max(1, Math.floor(examples.length * validationFraction));
    const validationExamples = examples.slice(0, validationCount);
    const trainingExamples = examples.slice(validationCount);
    const optimizer = tf.train.adam(0.0008);
    const trainableVariables = trainableVariablesFor(
        model,
        ["hidden1", "hidden2", "rotation", "swing_strategy", "swing"]
    );
    const epochLosses = [];

    for (let epoch = 0; epoch < epochs; epoch += 1) {
        shuffle(trainingExamples, random);
        let lossTotal = 0;
        let batchCount = 0;

        for (let start = 0; start < trainingExamples.length; start += batchSize) {
            const batch = trainingExamples.slice(start, start + batchSize);
            const inputs = tf.tensor2d(batch.map((example) => example.input));
            const rotationTargets = tf.tensor2d(batch.map((example) => [example.rotation]));
            const swingTargets = tf.tensor2d(batch.map((example) => [example.swing]));

            try {
                const lossTensor = optimizer.minimize(() => tf.tidy(() => {
                    const outputs = model.apply(inputs, { training: true });
                    const rotation = outputs[1];
                    const swing = outputs[2].clipByValue(1e-7, 1 - 1e-7);
                    const rotationLoss = rotation.sub(rotationTargets).square().mean();
                    const swingLoss = swingTargets.mul(swing.log())
                        .add(tf.scalar(1).sub(swingTargets).mul(tf.scalar(1).sub(swing).log()))
                        .neg()
                        .mean();
                    return rotationLoss.add(swingLoss);
                }), true, trainableVariables);

                lossTotal += lossTensor.dataSync()[0];
                lossTensor.dispose();
                batchCount += 1;
            } finally {
                inputs.dispose();
                rotationTargets.dispose();
                swingTargets.dispose();
            }
        }

        const loss = lossTotal / Math.max(batchCount, 1);
        epochLosses.push(loss);
        onEpoch?.({ epoch: epoch + 1, epochs, loss });
        await tf.nextFrame();
    }

    neutralizeUntrainedHeads(model);
    const metrics = evaluateExamples(model, validationExamples);
    return {
        ...metrics,
        finalLoss: epochLosses.at(-1) ?? null,
        sampleCount,
        epochs,
        batchSize,
        trainingSamples: trainingExamples.length,
        validationSamples: validationExamples.length,
    };
}

function createExample(random) {
    const mode = random();
    const playerRotation = random() * 360;
    let distance;
    let bearingDelta;
    let swingAvailable = random() > 0.2;

    if (mode < 0.30) {
        distance = between(random, 55, 88);
        bearingDelta = between(random, -12, 12);
        swingAvailable = true;
    } else if (mode < 0.55) {
        distance = between(random, 55, 88);
        bearingDelta = signedBetween(random, 25, 175);
    } else if (mode < 0.70) {
        distance = between(random, 55, 88);
        bearingDelta = between(random, -12, 12);
        swingAvailable = false;
    } else {
        distance = between(random, 105, 260);
        bearingDelta = between(random, -180, 180);
    }

    const playerX = between(random, CANVAS_CENTER_MIN, CANVAS_CENTER_MAX);
    const playerY = between(random, CANVAS_CENTER_MIN, CANVAS_CENTER_MAX);
    const enemyBearing = degreesToRadians(playerRotation + bearingDelta);
    const enemyX = playerX + Math.cos(enemyBearing) * distance;
    const enemyY = playerY + Math.sin(enemyBearing) * distance;
    const normalizedDelta = normalizeAngleDelta(bearingDelta);
    const objects = [
        {
            id: "opponent-model",
            type: "opponentModel",
            x: enemyX,
            y: enemyY,
            size: 64,
            rotation: random() * 360,
        },
        ...createDistractors(random, playerX, playerY),
    ];
    const payload = {
        selectedClass: "melee",
        playerModel: {
            x: playerX,
            y: playerY,
            rotation: playerRotation,
            swingAvailable,
            swingCooldownRemainingMs: swingAvailable ? 0 : between(random, 50, 1000),
            blockAvailable: true,
            blockActive: false,
            blockActiveRemainingMs: 0,
            blockCooldownRemainingMs: 0,
            hp: 100,
            size: 60,
            dashAvailable: true,
            dashActive: false,
            dashCooldownRemainingMs: 0,
        },
        objects,
    };

    const rotation = distance <= AWARENESS_RANGE
        ? clamp(normalizedDelta / ROTATION_FULL_SPEED_DEGREES, -1, 1)
        : 0;
    const swing = distance <= SWING_RANGE
        && Math.abs(normalizedDelta) <= SWING_ALIGNMENT_DEGREES
        && swingAvailable
        ? 1
        : 0;

    return {
        input: Array.from(buildInputVector(payload)),
        rotation,
        swing,
    };
}

function createDistractors(random, playerX, playerY) {
    const types = ["circle", "square", "triangle"];
    const count = Math.floor(random() * 3);
    return Array.from({ length: count }, (_, index) => ({
        id: `distractor-${index}`,
        type: types[Math.floor(random() * types.length)],
        x: clamp(playerX + between(random, -200, 200), 20, 780),
        y: clamp(playerY + between(random, -200, 200), 20, 780),
        size: between(random, 30, 100),
            rotation: random() * 360,
            hp: 100,
            swingActive: false,
            blockActive: false,
            velocityX: 0,
            velocityY: 0,
    }));
}

function evaluateExamples(model, examples) {
    return tf.tidy(() => {
        const inputs = tf.tensor2d(examples.map((example) => example.input));
        const outputs = model.predict(inputs);
        const rotationPredictions = outputs[1].dataSync();
        const swingPredictions = outputs[2].dataSync();
        let rotationError = 0;
        let swingCorrect = 0;

        examples.forEach((example, index) => {
            rotationError += Math.abs(rotationPredictions[index] - example.rotation);
            swingCorrect += (swingPredictions[index] >= 0.5 ? 1 : 0) === example.swing ? 1 : 0;
        });

        return {
            rotationMeanAbsoluteError: rotationError / examples.length,
            swingAccuracy: swingCorrect / examples.length,
        };
    });
}

function neutralizeUntrainedHeads(model) {
    setDenseOutput(model.getLayer("movement"), 0);
    setDenseOutput(model.getLayer("block"), -8);
    setDenseOutput(model.getLayer("dash"), -8);
}

function setDenseOutput(layer, biasValue) {
    const [existingKernel, existingBias] = layer.getWeights();
    const kernel = tf.zeros(existingKernel.shape);
    const bias = tf.fill(existingBias.shape, biasValue);
    layer.setWeights([kernel, bias]);
    kernel.dispose();
    bias.dispose();
}

function trainableVariablesFor(model, layerNames) {
    return layerNames.flatMap((name) => (
        model.getLayer(name).trainableWeights.map((weight) => weight.val)
    ));
}

function shuffle(items, random) {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [items[index], items[other]] = [items[other], items[index]];
    }
}

function signedBetween(random, min, max) {
    return (random() < 0.5 ? -1 : 1) * between(random, min, max);
}

function between(random, min, max) {
    return min + random() * (max - min);
}

function normalizeAngleDelta(degrees) {
    return ((degrees + 540) % 360) - 180;
}

function degreesToRadians(degrees) {
    return degrees * Math.PI / 180;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
