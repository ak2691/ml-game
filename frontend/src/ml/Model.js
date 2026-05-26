/**
 * model.js
 *
 * Defines, saves, and loads the arena navigation model.
 *
 * Architecture:
 *   Input  → Dense(64, relu) → Dense(32, relu) → Dense(2, tanh)
 *
 * Output: [dx, dy] in range [-1, 1]
 *   These are the raw direction signals the player model will eventually act on.
 *   tanh keeps outputs bounded and symmetric around zero.
 */

import * as tf from "@tensorflow/tfjs";
import { INPUT_SIZE } from "./Featurebuilder";

const MODEL_KEY = "localstorage://arena-model";

/**
 * createModel
 * Builds and compiles a fresh model.
 * The optimizer and loss are set here even though we use a custom
 * training loop in trainer.js — tf.LayersModel still needs them
 * defined for save/load to work correctly.
 */
export function createModel() {
    const model = tf.sequential({
        layers: [
            tf.layers.dense({
                inputShape: [INPUT_SIZE],
                units: 64,
                activation: "relu",
                kernelInitializer: "glorotUniform",
                name: "hidden1",
            }),
            tf.layers.dense({
                units: 32,
                activation: "relu",
                kernelInitializer: "glorotUniform",
                name: "hidden2",
            }),
            tf.layers.dense({
                units: 2,
                activation: "tanh",       // output in [-1, 1]
                kernelInitializer: "glorotUniform",
                name: "output",
            }),
        ],
    });

    // Optimizer used in the custom REINFORCE training step in trainer.js.
    // lr=0.001 is a safe starting point; lower if the model oscillates.
    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "meanSquaredError", // placeholder — not used for REINFORCE
    });

    return model;
}

/**
 * saveModel
 * Persists the model weights to localStorage.
 * Call after every successful training step.
 */
export async function saveModel(model) {
    try {
        await model.save(MODEL_KEY);
        console.log("[arena-ml] Model saved.");
    } catch (err) {
        console.warn("[arena-ml] Save failed:", err);
    }
}

/**
 * loadOrCreateModel
 * Tries to restore a previously saved model from localStorage.
 * Falls back to a fresh model if none exists.
 * Call this once when BetaModel mounts.
 */
export async function loadOrCreateModel() {
    try {
        const model = await tf.loadLayersModel(MODEL_KEY);

        // Re-attach the optimizer after loading (tf.js requires this)
        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: "meanSquaredError",
        });

        console.log("[arena-ml] Loaded existing model from localStorage.");
        return model;
    } catch {
        console.log("[arena-ml] No saved model found — creating fresh model.");
        return createModel();
    }
}
export async function deleteSavedModel() {
    try {
        await tf.io.removeModel(MODEL_KEY);
        console.log("[arena-ml] Model deleted from local storage.");
    } catch {
        console.log("[arena-ml] No saved model found to delete.");
    }
}
