/**
 * Defines, saves, and loads the arena navigation model.
 *
 * Architecture:
 *   Input -> Dense(64, relu) -> Dense(32, relu) -> Dense(2, tanh)
 *
 * Output: [dx, dy] in range [-1, 1].
 */

import * as tf from "@tensorflow/tfjs";
import { INPUT_SIZE } from "./Featurebuilder";

const MODEL_KEY = "indexeddb://arena-model";
const LEGACY_MODEL_KEY = "localstorage://arena-model";

export function getMatchModelKey(matchId, userId) {
    if (!matchId || !userId) {
        throw new Error("matchId and userId are required for match model storage.");
    }

    return `indexeddb://arena-match-model-${matchId}-${userId}`;
}

export function createModel() {
    const model = tf.sequential({
        layers: [
            tf.layers.dense({
                inputShape: [INPUT_SIZE],
                units: 64,
                activation: "relu",
                kernelInitializer: "heNormal",
                name: "hidden1",
            }),
            tf.layers.dense({
                units: 32,
                activation: "relu",
                kernelInitializer: "heNormal",
                name: "hidden2",
            }),
            tf.layers.dense({
                units: 2,
                activation: "tanh",
                kernelInitializer: "glorotUniform",
                name: "output",
            }),
        ],
    });

    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "meanSquaredError",
    });

    return model;
}

export async function warmUpModel(model) {
    await tf.ready();

    tf.tidy(() => {
        const inputTensor = tf.zeros([1, INPUT_SIZE]);
        const output = model.predict(inputTensor);
        output.dataSync();
    });
}

export async function saveModel(model, storageKey = MODEL_KEY) {
    try {
        await model.save(storageKey);
        console.log("[arena-ml] Model saved.");
    } catch (err) {
        console.warn("[arena-ml] Save failed:", err);
    }
}

export async function loadOrCreateModel() {
    try {
        const model = await tf.loadLayersModel(MODEL_KEY);
        compileModel(model);
        console.log("[arena-ml] Loaded existing model from IndexedDB.");
        return model;
    } catch {
        return loadLegacyOrCreateModel();
    }
}

export async function loadOrCreateMatchModel(matchId, userId) {
    const storageKey = getMatchModelKey(matchId, userId);

    try {
        const model = await tf.loadLayersModel(storageKey);
        compileModel(model);
        console.log("[arena-ml] Loaded existing match model from IndexedDB.");
        return model;
    } catch {
        console.log("[arena-ml] No saved match model found; creating fresh match model.");
        const model = createModel();
        await saveModel(model, storageKey);
        return model;
    }
}

export async function deleteSavedModel() {
    try {
        await tf.io.removeModel(MODEL_KEY);
        await tf.io.removeModel(LEGACY_MODEL_KEY).catch(() => {});
        console.log("[arena-ml] Model deleted from browser storage.");
    } catch {
        console.log("[arena-ml] No saved model found to delete.");
    }
}

export async function deleteMatchModel(matchId, userId) {
    try {
        await tf.io.removeModel(getMatchModelKey(matchId, userId));
        console.log("[arena-ml] Match model deleted from browser storage.");
    } catch {
        console.log("[arena-ml] No saved match model found to delete.");
    }
}

function compileModel(model) {
    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "meanSquaredError",
    });
}

async function loadLegacyOrCreateModel() {
    try {
        const legacyModel = await tf.loadLayersModel(LEGACY_MODEL_KEY);
        compileModel(legacyModel);
        await saveModel(legacyModel);
        await tf.io.removeModel(LEGACY_MODEL_KEY);
        console.log("[arena-ml] Migrated existing model from localStorage to IndexedDB.");
        return legacyModel;
    } catch {
        console.log("[arena-ml] No saved model found; creating fresh model.");
        return createModel();
    }
}
