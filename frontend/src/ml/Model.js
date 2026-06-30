/**
 * Defines, saves, and loads the arena combat model.
 *
 * Architecture:
 *   Input -> movement strategy Dense(32, relu)
 *     -> movement head: probabilities for stop plus eight compass directions
 *   Input -> Dense(64, relu) -> Dense(32, relu)
 *     -> rotation head: [dRot] in range [-1, 1]
 *     -> swing head: [probability] in range [0, 1]
 *     -> block head: [probability] in range [0, 1]
 *     -> dash head: [probability] in range [0, 1]
 *
 * The heads let coaching examples train one action surface without turning
 * blank controls into negative labels for the other actions.
 */

import * as tf from "@tensorflow/tfjs";
import { INPUT_SIZE } from "./Featurebuilder.js";
import { loadApprovedBaseModel } from "./BaseModelArtifact.js";
import { MOVEMENT_ACTION_COUNT } from "./MovementActions.js";

const MODEL_KEY = "indexeddb://arena-model-v6-intents";
const LEGACY_MODEL_KEY = "localstorage://arena-model";
const LEGACY_DUEL_INPUT_SIZE = 26;
const LEGACY_LOGIC_BLOCK_INPUT_SIZE = 56;

export function getPracticeModelKey(combatClass = "melee") {
    return combatClass === "melee" ? MODEL_KEY : `indexeddb://arena-${combatClass}-model-v1`;
}

export function getMatchModelKey(matchId, userId, combatClass = "melee") {
    if (!matchId || !userId) {
        throw new Error("matchId and userId are required for match model storage.");
    }

    const classSegment = combatClass === "melee" ? "" : `-${combatClass}`;
    return `indexeddb://arena-match-model-v6-intents${classSegment}-${matchId}-${userId}`;
}

export function createModel() {
    const input = tf.input({ shape: [INPUT_SIZE], name: "combat_state" });
    const hidden1 = tf.layers.dense({
        units: 64,
        activation: "relu",
        kernelInitializer: tf.initializers.heNormal({ seed: 1101 }),
        name: "hidden1",
    }).apply(input);
    const hidden2 = tf.layers.dense({
        units: 32,
        activation: "relu",
        kernelInitializer: tf.initializers.heNormal({ seed: 1102 }),
        name: "hidden2",
    }).apply(hidden1);

    // Player-authored movement strategy gets a private feature extractor. It
    // can learn condition/direction interactions without changing the shared
    // melee mechanics used by rotation and swing.
    const movementStrategy = tf.layers.dense({
        units: 32,
        activation: "relu",
        kernelInitializer: tf.initializers.heNormal({ seed: 1201 }),
        name: "movement_strategy",
    }).apply(input);
    const swingStrategy = tf.layers.dense({
        units: 16,
        activation: "relu",
        kernelInitializer: tf.initializers.heNormal({ seed: 1202 }),
        name: "swing_strategy",
    }).apply(input);
    const swingFeatures = tf.layers.concatenate({ name: "swing_features" })
        .apply([hidden2, swingStrategy]);

    const movement = tf.layers.dense({
        units: MOVEMENT_ACTION_COUNT,
        activation: "softmax",
        kernelInitializer: "zeros",
        biasInitializer: "zeros",
        name: "movement",
    }).apply(movementStrategy);
    const rotation = tf.layers.dense({
        units: 1,
        activation: "tanh",
        kernelInitializer: tf.initializers.glorotUniform({ seed: 1301 }),
        name: "rotation",
    }).apply(hidden2);
    const swing = tf.layers.dense({
        units: 1,
        activation: "sigmoid",
        kernelInitializer: tf.initializers.glorotUniform({ seed: 1302 }),
        name: "swing",
    }).apply(swingFeatures);
    const block = tf.layers.dense({
        units: 1,
        activation: "sigmoid",
        kernelInitializer: tf.initializers.glorotUniform({ seed: 1303 }),
        name: "block",
    }).apply(hidden2);
    const dash = tf.layers.dense({
        units: 1,
        activation: "sigmoid",
        kernelInitializer: "zeros",
        biasInitializer: tf.initializers.constant({ value: -8 }),
        name: "dash",
    }).apply(hidden2);

    const model = tf.model({
        inputs: input,
        outputs: [movement, rotation, swing, block, dash],
        name: "melee_combat_model",
    });

    compileModel(model);

    return model;
}

export function cloneCombatModel(sourceModel) {
    const clone = createModel();
    clone.setWeights(sourceModel.getWeights());
    return clone;
}

export async function warmUpModel(model) {
    await tf.ready();

    tf.tidy(() => {
        const inputTensor = tf.zeros([1, INPUT_SIZE]);
        const output = model.predict(inputTensor);
        if (Array.isArray(output)) {
            output.forEach((head) => head.dataSync());
        } else {
            output.dataSync();
        }
    });
}

export async function saveModel(model, storageKey = MODEL_KEY) {
    try {
        const saveResult = await model.save(storageKey);

        if (storageKey.startsWith("indexeddb://")) {
            const savedModels = await tf.io.listModels();
            if (!Object.prototype.hasOwnProperty.call(savedModels, storageKey)) {
                throw new Error(`IndexedDB did not report the saved model at ${storageKey}.`);
            }
        }

        console.log(`[arena-ml] Model saved to ${storageKey}.`);
        return saveResult;
    } catch (err) {
        console.warn("[arena-ml] Save failed:", err);
        throw err;
    }
}

export async function loadOrCreateModel(combatClass = "melee") {
    const storageKey = getPracticeModelKey(combatClass);
    try {
        const model = await tf.loadLayersModel(storageKey);
        if (!isUpgradeableCombatModel(model)) {
            console.log("[arena-ml] Saved practice model is not combat compatible; creating fresh model.");
            return createModel();
        }
        if (!isCurrentCombatModel(model)) {
            const upgraded = upgradeCombatModel(model);
            model.dispose();
            await saveModel(upgraded, storageKey);
            console.log("[arena-ml] Upgraded the saved practice model to the current strategy architecture.");
            return upgraded;
        }
        compileModel(model);
        console.log("[arena-ml] Loaded existing model from IndexedDB.");
        return model;
    } catch {
        return combatClass === "melee"
            ? loadLegacyOrCreateModel(combatClass)
            : loadApprovedOrCreateModel(combatClass);
    }
}

export async function loadOrCreateMatchModel(matchId, userId, combatClass = "melee") {
    const storageKey = getMatchModelKey(matchId, userId, combatClass);
    try {
        const model = await tf.loadLayersModel(storageKey);
        if (!isUpgradeableCombatModel(model)) {
            model.dispose();
            throw new Error("stored match model is not combat compatible");
        }
        if (!isCurrentCombatModel(model)) {
            const upgraded = upgradeCombatModel(model);
            model.dispose();
            await saveModel(upgraded, storageKey);
            console.log("[arena-ml] Upgraded stored match round checkpoint.");
            return upgraded;
        }
        compileModel(model);
        console.log("[arena-ml] Loaded existing match round checkpoint from IndexedDB.");
        return model;
    } catch {
        const model = await loadApprovedOrCreateModel(combatClass);
        await saveModel(model, storageKey);
        console.log("[arena-ml] Fresh match round checkpoint saved to IndexedDB.");
        return model;
    }
}

export async function deleteSavedModel(combatClass = "melee") {
    try {
        await tf.io.removeModel(getPracticeModelKey(combatClass));
        if (combatClass === "melee") {
            await tf.io.removeModel(LEGACY_MODEL_KEY).catch(() => {});
        }
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
        loss: [
            "categoricalCrossentropy",
            "meanSquaredError",
            "binaryCrossentropy",
            "binaryCrossentropy",
            "binaryCrossentropy",
        ],
    });
}

async function loadLegacyOrCreateModel(combatClass) {
    try {
        const legacyModel = await tf.loadLayersModel(LEGACY_MODEL_KEY);
        if (!isUpgradeableCombatModel(legacyModel)) {
            console.log("[arena-ml] Legacy model is not combat compatible; loading approved base.");
            return loadApprovedOrCreateModel(combatClass);
        }
        const migratedModel = isCurrentCombatModel(legacyModel) ? legacyModel : upgradeCombatModel(legacyModel);
        if (migratedModel !== legacyModel) legacyModel.dispose();
        compileModel(migratedModel);
        await saveModel(migratedModel);
        await tf.io.removeModel(LEGACY_MODEL_KEY);
        console.log("[arena-ml] Migrated existing model from localStorage to IndexedDB.");
        return migratedModel;
    } catch {
        console.log("[arena-ml] No saved model found; loading approved class base.");
        return loadApprovedOrCreateModel(combatClass);
    }
}

async function loadApprovedOrCreateModel(combatClass) {
    try {
        const { model, artifact } = await loadApprovedBaseModel(combatClass);
        if (!isUpgradeableCombatModel(model)) {
            model.dispose();
            throw new Error("Approved base model has an incompatible output contract.");
        }
        if (!isCurrentCombatModel(model)) {
            const upgraded = upgradeCombatModel(model);
            model.dispose();
            console.log(`[arena-ml] Upgraded approved base ${artifact.baseModel.artifactId} to the current strategy architecture.`);
            return upgraded;
        }
        compileModel(model);
        console.log(`[arena-ml] Loaded approved base ${artifact.baseModel.artifactId}.`);
        return model;
    } catch (err) {
        console.info(`[arena-ml] Approved ${combatClass} base unavailable; creating fresh model.`, err);
        return createModel();
    }
}

function upgradeCombatModel(sourceModel) {
    const upgraded = createModel();
    for (const layerName of ["hidden1", "movement_strategy", "swing_strategy"]) {
        copyDenseLayerWeights(sourceModel, upgraded, layerName);
    }
    for (const layerName of ["hidden2", "rotation", "block", "dash"]) {
        const sourceLayer = sourceModel.getLayer(layerName);
        const targetLayer = upgraded.getLayer(layerName);
        const sourceWeights = sourceLayer.getWeights();
        const targetWeights = targetLayer.getWeights();
        const shapesMatch = sourceWeights.length === targetWeights.length
            && sourceWeights.every((weight, index) => (
                weight.shape.join(",") === targetWeights[index].shape.join(",")
            ));
        if (shapesMatch) targetLayer.setWeights(sourceWeights);
    }
    const sourceSwingWeights = sourceModel.getLayer("swing").getWeights();
    const targetSwingWeights = upgraded.getLayer("swing").getWeights();
    if (sourceSwingWeights[0]?.shape?.[0] === 32 && targetSwingWeights[0]?.shape?.[0] === 48) {
        const expandedKernel = tf.concat([sourceSwingWeights[0], tf.zeros([16, 1])], 0);
        upgraded.getLayer("swing").setWeights([expandedKernel, sourceSwingWeights[1]]);
        expandedKernel.dispose();
    }
    return upgraded;
}

function copyDenseLayerWeights(sourceModel, targetModel, layerName) {
    try {
        const sourceLayer = sourceModel.getLayer(layerName);
        const targetLayer = targetModel.getLayer(layerName);
        const sourceWeights = sourceLayer.getWeights();
        const targetWeights = targetLayer.getWeights();
        if (sourceWeights.length !== 2 || targetWeights.length !== 2) return;
        const [sourceKernel, sourceBias] = sourceWeights;
        const [targetKernel, targetBias] = targetWeights;
        const sameShape = sourceKernel.shape.join(",") === targetKernel.shape.join(",")
            && sourceBias.shape.join(",") === targetBias.shape.join(",");
        if (sameShape) {
            targetLayer.setWeights(sourceWeights);
            return;
        }
        const canPadInputRows = sourceKernel.shape.length === 2
            && targetKernel.shape.length === 2
            && sourceKernel.shape[0] <= targetKernel.shape[0]
            && sourceKernel.shape[1] === targetKernel.shape[1]
            && sourceBias.shape.join(",") === targetBias.shape.join(",");
        if (!canPadInputRows) return;
        const padding = tf.zeros([targetKernel.shape[0] - sourceKernel.shape[0], targetKernel.shape[1]]);
        const expandedKernel = tf.concat([sourceKernel, padding], 0);
        targetLayer.setWeights([expandedKernel, sourceBias]);
        padding.dispose();
        expandedKernel.dispose();
    } catch {
        // Older architectures may not have every isolated strategy layer.
    }
}

function isCurrentCombatModel(model) {
    try {
        return model.getLayer("movement_strategy")?.outputShape?.at(-1) === 32
            && model.getLayer("swing_strategy")?.outputShape?.at(-1) === 16
            && model.inputs?.[0]?.shape?.at(-1) === INPUT_SIZE;
    } catch {
        return false;
    }
}

function isUpgradeableCombatModel(model) {
    return Array.isArray(model.outputs)
        && model.outputs.length === 5
        && model.outputs[0].shape.at(-1) === MOVEMENT_ACTION_COUNT
        && [INPUT_SIZE, LEGACY_LOGIC_BLOCK_INPUT_SIZE, LEGACY_DUEL_INPUT_SIZE]
            .includes(model.inputs?.[0]?.shape?.at(-1));
}
