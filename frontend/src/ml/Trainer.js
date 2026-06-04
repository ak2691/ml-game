import * as tf from "@tensorflow/tfjs";
import { buildInputVector, INPUT_SIZE } from "./Featurebuilder";
import { saveModel } from "./Model";

const MAX_MEMORY = 2000;
const BATCH_SIZE = 64;
export const MAX_REWIND_STEPS = 10;

let replayBuffer = [];
let stagingBuffer = [];
let rewardEvents = [];
let persistenceTimer = null;
let persistenceEnabled = true;
let trainerStatePersistenceEnabled = true;
let modelStorageKey = null;

const EPSILON_START = 0.9;
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = 0.97;
let trainStepCount = 0;

const MEMORY_KEY = "arena-trainer-memory";
const STEP_KEY = "arena-trainer-steps";
const REWARD_EVENTS_KEY = "arena-trainer-reward-events";
const MAX_REWARD_EVENTS = 500;

export function saveTrainerState() {
    if (!persistenceEnabled || !trainerStatePersistenceEnabled) return;

    localStorage.setItem(MEMORY_KEY, JSON.stringify(replayBuffer));
    localStorage.setItem(STEP_KEY, trainStepCount.toString());
    localStorage.setItem(REWARD_EVENTS_KEY, JSON.stringify(rewardEvents));
}

export function setTrainerPersistenceEnabled(enabled, options = {}) {
    persistenceEnabled = enabled;
    trainerStatePersistenceEnabled = options.trainerState ?? true;
    modelStorageKey = options.modelStorageKey ?? null;

    if (!persistenceEnabled && persistenceTimer) {
        clearTimeout(persistenceTimer);
        persistenceTimer = null;
    }
}

export function resetTrainerRuntimeState() {
    if (persistenceTimer) {
        clearTimeout(persistenceTimer);
        persistenceTimer = null;
    }

    replayBuffer = [];
    stagingBuffer = [];
    rewardEvents = [];
    trainStepCount = 0;
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
        const savedRewardEvents = localStorage.getItem(REWARD_EVENTS_KEY);
        if (savedRewardEvents) {
            rewardEvents = JSON.parse(savedRewardEvents);
        }
        console.log(`[arena-ml] Trainer state loaded. Memories: ${replayBuffer.length}, Steps: ${trainStepCount}, epsilon: ${getEpsilon().toFixed(3)}`);
    } catch (err) {
        console.warn("[arena-ml] Failed to load trainer state, starting fresh.", err);
    }
}

export function getTrainingStepCount() {
    return trainStepCount;
}

export function getRewardEvents() {
    return {
        version: "reward-events-v1",
        events: rewardEvents,
        totals: rewardEvents.reduce((totals, event) => ({
            rewardCount: totals.rewardCount + (event.type === "batch-reward" ? 1 : 0),
            overrideCount: totals.overrideCount + (event.type === "override-vector" ? 1 : 0),
            rewardedStepCount: totals.rewardedStepCount + (event.stepCount ?? 0),
        }), {
            rewardCount: 0,
            overrideCount: 0,
            rewardedStepCount: 0,
        }),
    };
}

function rememberRewardEvent(event) {
    rewardEvents.push({
        ...event,
        localRecordedAt: new Date().toISOString(),
        trainingStepCount: trainStepCount,
    });

    if (rewardEvents.length > MAX_REWARD_EVENTS) {
        rewardEvents = rewardEvents.slice(-MAX_REWARD_EVENTS);
    }
}

export function getEpsilon() {
    return Math.max(EPSILON_MIN, EPSILON_START * Math.pow(EPSILON_DECAY, trainStepCount));
}

export async function warmUpTraining(model) {
    await tf.ready();

    const inputTensor = tf.zeros([BATCH_SIZE, INPUT_SIZE]);
    const targetTensor = model.predict(inputTensor);

    try {
        await model.fit(inputTensor, targetTensor, {
            epochs: 1,
            batchSize: BATCH_SIZE,
            shuffle: false,
            verbose: 0,
        });
        console.log("[arena-ml] Training path warmed up.");
    } finally {
        inputTensor.dispose();
        targetTensor.dispose();
    }
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

function sampleReplayBatch(batchSize) {
    const batch = [];
    const usedIndexes = new Set();

    while (batch.length < batchSize) {
        const index = Math.floor(Math.random() * replayBuffer.length);
        if (!usedIndexes.has(index)) {
            usedIndexes.add(index);
            batch.push(replayBuffer[index]);
        }
    }

    return batch;
}

function scheduleTrainerPersistence(model) {
    if (!persistenceEnabled) return;

    if (persistenceTimer) {
        clearTimeout(persistenceTimer);
    }

    persistenceTimer = setTimeout(() => {
        persistenceTimer = null;
        saveModel(model, modelStorageKey ?? undefined);
        saveTrainerState();
    }, 100);
}

async function trainFromReplay(model, logPrefix = "Trained", trainedStepCount = 1) {
    const batchSize = Math.min(replayBuffer.length, BATCH_SIZE);
    if (batchSize === 0) return;

    const batch = sampleReplayBatch(batchSize);

    const stateTensor = tf.tensor2d(batch.map((b) => b.state));
    const targetTensor = tf.tensor2d(batch.map((b) => b.target));

    const info = await model.fit(stateTensor, targetTensor, {
        epochs: 1,
        shuffle: true,
        verbose: 0,
    });

    stateTensor.dispose();
    targetTensor.dispose();

    trainStepCount += Math.max(0, trainedStepCount);

    console.log(
        `[arena-ml] ${logPrefix} on batch of ${batchSize} | Loss: ${info.history.loss[0].toFixed(4)} | ` +
        `Memories: ${replayBuffer.length} | epsilon: ${getEpsilon().toFixed(3)}`
    );

    scheduleTrainerPersistence(model);
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
    rememberRewardEvent({
        type: "batch-reward",
        rewardValue,
        stepCount: stepsToTrain.length,
    });

    for (const { stateSnapshot, action } of stepsToTrain) {
        const normalized = normalizeAction(action);
        rememberSample(stateSnapshot, [
            normalized.dx * rewardValue,
            normalized.dy * rewardValue,
        ]);
    }

    await trainFromReplay(
        model,
        `Reward trained ${stepsToTrain.length} recent step${stepsToTrain.length !== 1 ? "s" : ""}`,
        stepsToTrain.length
    );
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

    await trainFromReplay(model, "Trained", 1);
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
    resetTrainerRuntimeState();
    localStorage.removeItem(MEMORY_KEY);
    localStorage.removeItem(STEP_KEY);
    localStorage.removeItem(REWARD_EVENTS_KEY);
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
    rememberRewardEvent({
        type: "override-vector",
        stepCount: stepsToTrain.length,
        override: {
            dx: normDx,
            dy: normDy,
        },
    });

    for (const { stateSnapshot } of stepsToTrain) {
        rememberSample(stateSnapshot, [normDx, normDy]);
    }

    await trainFromReplay(
        model,
        `Override trained ${stepsToTrain.length} recent step${stepsToTrain.length !== 1 ? "s" : ""}`,
        stepsToTrain.length
    );
}
