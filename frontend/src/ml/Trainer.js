import * as tf from "@tensorflow/tfjs";
import { buildInputVector } from "./Featurebuilder";
import { saveModel } from "./Model";

const MAX_MEMORY = 2000;
const BATCH_SIZE = 64;
export const MAX_REWIND_STEPS = 10;

let replayBuffer = [];
let stagingBuffer = [];

const EPSILON_START = 0.9;
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = 0.97;
let trainStepCount = 0;

const MEMORY_KEY = "arena-trainer-memory";
const STEP_KEY = "arena-trainer-steps";

export function saveTrainerState() {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(replayBuffer));
    localStorage.setItem(STEP_KEY, trainStepCount.toString());
}

export function loadTrainerState() {
    try {
        const savedMemory = localStorage.getItem(MEMORY_KEY);
        if (savedMemory) {
            replayBuffer = JSON.parse(savedMemory);
        }
        const savedSteps = localStorage.getItem(STEP_KEY);
        if (savedSteps) {
            trainStepCount = parseInt(savedSteps, 10);
        }
        console.log(`[arena-ml] Trainer state loaded. Memories: ${replayBuffer.length}, Steps: ${trainStepCount}, epsilon: ${getEpsilon().toFixed(3)}`);
    } catch (err) {
        console.warn("[arena-ml] Failed to load trainer state, starting fresh.", err);
    }
}

export function getEpsilon() {
    return Math.max(EPSILON_MIN, EPSILON_START * Math.pow(EPSILON_DECAY, trainStepCount));
}

function rememberSample(stateSnapshot, target) {
    const inputVector = buildInputVector(stateSnapshot);

    replayBuffer.push({
        state: Array.from(inputVector),
        target,
    });

    if (replayBuffer.length > MAX_MEMORY) {
        replayBuffer.shift();
    }
}

async function trainFromReplay(model, logPrefix = "Trained") {
    const batchSize = Math.min(replayBuffer.length, BATCH_SIZE);
    if (batchSize === 0) return;

    const shuffled = [...replayBuffer].sort(() => 0.5 - Math.random());
    const batch = shuffled.slice(0, batchSize);

    const stateTensor = tf.tensor2d(batch.map((b) => b.state));
    const targetTensor = tf.tensor2d(batch.map((b) => b.target));

    const info = await model.fit(stateTensor, targetTensor, {
        epochs: 1,
        shuffle: true,
        verbose: 0,
    });

    stateTensor.dispose();
    targetTensor.dispose();

    trainStepCount++;

    console.log(
        `[arena-ml] ${logPrefix} on batch of ${batchSize} | Loss: ${info.history.loss[0].toFixed(4)} | ` +
        `Memories: ${replayBuffer.length} | epsilon: ${getEpsilon().toFixed(3)}`
    );

    await saveModel(model);
    saveTrainerState();
}

function normalizeAction(action) {
    const actualDx = action.dx;
    const actualDy = action.dy;
    const mag = Math.sqrt(actualDx * actualDx + actualDy * actualDy);

    return {
        dx: mag > 0.001 ? actualDx / mag : (Math.random() > 0.5 ? 1 : -1),
        dy: mag > 0.001 ? actualDy / mag : (Math.random() > 0.5 ? 1 : -1),
    };
}

function getRecentStagedSteps(count = stagingBuffer.length) {
    const safeCount = Math.max(0, Math.min(count, stagingBuffer.length, MAX_REWIND_STEPS));
    return stagingBuffer.slice(stagingBuffer.length - safeCount);
}

export function stageStep(stateSnapshot, action, movement = null) {
    stagingBuffer.push({ stateSnapshot, action, movement });
    if (stagingBuffer.length > MAX_REWIND_STEPS) {
        stagingBuffer.shift();
    }
}

export function clearStaging() {
    stagingBuffer = [];
}

export async function applyBatchReward(model, rewardValue, stepCount = stagingBuffer.length) {
    if (stagingBuffer.length === 0) return;

    if (rewardValue === 0) {
        console.log("[arena-ml] Reward=0, skipping batch.");
        return;
    }

    const stepsToTrain = getRecentStagedSteps(stepCount);
    for (const { stateSnapshot, action } of stepsToTrain) {
        const normalized = normalizeAction(action);
        rememberSample(stateSnapshot, [
            normalized.dx * rewardValue,
            normalized.dy * rewardValue,
        ]);
    }

    await trainFromReplay(model, `Reward trained ${stepsToTrain.length} recent step${stepsToTrain.length !== 1 ? "s" : ""}`);
}

export async function receiveSample(model, payload) {
    const { reward, action } = payload;

    if (reward === 0) {
        console.log("[arena-ml] Reward=0, skipping.");
        return;
    }

    const normalized = normalizeAction(action);
    rememberSample(payload, [
        normalized.dx * reward,
        normalized.dy * reward,
    ]);

    await trainFromReplay(model);
}

export function predictDirection(model, payload) {
    const epsilon = getEpsilon();
    const inputVector = buildInputVector(payload);

    return tf.tidy(() => {
        const inputTensor = tf.tensor2d([inputVector]);
        const output = model.predict(inputTensor);
        const [nnDx, nnDy] = output.dataSync();

        if (Math.random() < epsilon) {
            const mag = Math.sqrt(nnDx * nnDx + nnDy * nnDy);
            const angle = Math.random() * 2 * Math.PI;
            return {
                dx: Math.cos(angle) * mag,
                dy: Math.sin(angle) * mag,
            };
        }

        return { dx: nnDx, dy: nnDy };
    });
}

export function clearMemory() {
    replayBuffer = [];
    stagingBuffer = [];
    trainStepCount = 0;
    localStorage.removeItem(MEMORY_KEY);
    localStorage.removeItem(STEP_KEY);
    console.log("[arena-ml] Replay buffer, staging buffer, and epsilon reset.");
}

export async function applyOverrideVector(model, overrideDx, overrideDy, stepCount = stagingBuffer.length) {
    if (stagingBuffer.length === 0) return;

    const mag = Math.sqrt(overrideDx * overrideDx + overrideDy * overrideDy);
    if (mag < 0.001) {
        console.log("[arena-ml] Override vector too small, aborting.");
        return;
    }

    const normDx = overrideDx / mag;
    const normDy = overrideDy / mag;
    const stepsToTrain = getRecentStagedSteps(stepCount);

    for (const { stateSnapshot } of stepsToTrain) {
        rememberSample(stateSnapshot, [normDx, normDy]);
    }

    await trainFromReplay(model, `Override trained ${stepsToTrain.length} recent step${stepsToTrain.length !== 1 ? "s" : ""}`);
}
