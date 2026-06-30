import * as tf from "@tensorflow/tfjs";
import {
    ACTION_SCHEMA_VERSION,
    FEATURE_SCHEMA_VERSION,
    MODEL_ARCHITECTURE_VERSION,
} from "./ModelSubmissionContract.js";

export const BASE_MODEL_ARTIFACT_VERSION = "machiner-base-model-v1";

// Future classes add one definition here and provide their own trainer.
const BASE_MODEL_DEFINITIONS = {
    melee: {
        artifactId: "melee-base-v6",
        combatClass: "melee",
        version: 6,
        architectureVersion: MODEL_ARCHITECTURE_VERSION,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        actionSchemaVersion: ACTION_SCHEMA_VERSION,
        legacyArtifacts: [{
            artifactId: "melee-base-v5",
            combatClass: "melee",
            version: 5,
            architectureVersion: "melee-heads-v5",
            featureSchemaVersion: "duel-logic-features-v4",
            actionSchemaVersion: ACTION_SCHEMA_VERSION,
        }],
    },
};

export function getBaseModelDefinition(combatClass) {
    const definition = BASE_MODEL_DEFINITIONS[combatClass];
    if (!definition) {
        throw new Error(`No base-model definition exists for class '${combatClass}'.`);
    }
    return definition;
}

export function getApprovedBaseArtifactUrl(combatClass) {
    const { artifactId } = getBaseModelDefinition(combatClass);
    return `/models/${artifactId}/${artifactId}.base-model.json`;
}

export async function createApprovedBaseArtifact({
    model,
    combatClass,
    trainingMetrics = null,
    trainingRecipe = null,
}) {
    const definition = getBaseModelDefinition(combatClass);
    const baseDefinition = { ...definition };
    delete baseDefinition.legacyArtifacts;
    const serializedModel = await serializeModel(model);
    const digest = await modelDigest(serializedModel);

    return {
        artifactVersion: BASE_MODEL_ARTIFACT_VERSION,
        baseModel: {
            ...baseDefinition,
            approvalStatus: "approved",
            approvedAt: new Date().toISOString(),
        },
        training: {
            recipe: trainingRecipe,
            metrics: trainingMetrics,
        },
        integrity: {
            algorithm: "SHA-256",
            digest,
        },
        model: serializedModel,
    };
}

export async function exportApprovedBaseArtifact(options) {
    const artifact = await createApprovedBaseArtifact(options);
    const filename = `${artifact.baseModel.artifactId}.base-model.json`;
    downloadJson(filename, artifact);
    return artifact;
}

export async function loadApprovedBaseModel(combatClass) {
    const definition = getBaseModelDefinition(combatClass);
    const artifact = await fetchAndValidateArtifact(definition)
        .catch(async (err) => {
            for (const legacyDefinition of definition.legacyArtifacts ?? []) {
                try {
                    return await fetchAndValidateArtifact(legacyDefinition);
                } catch {
                    // Try each legacy artifact before surfacing the current failure.
                }
            }
            throw err;
        });
    const weightData = base64ToArrayBuffer(artifact.model.weightDataBase64);
    const model = await tf.loadLayersModel(tf.io.fromMemory({
        modelTopology: artifact.model.modelTopology,
        weightSpecs: artifact.model.weightSpecs,
        weightData,
    }));
    return { model, artifact };
}

async function fetchAndValidateArtifact(definition) {
    const response = await fetch(`/models/${definition.artifactId}/${definition.artifactId}.base-model.json`, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Approved ${definition.combatClass} base returned ${response.status}.`);
    }

    const artifact = await response.json();
    await validateArtifact(artifact, definition);
    return artifact;
}

async function validateArtifact(artifact, definition) {
    if (artifact?.artifactVersion !== BASE_MODEL_ARTIFACT_VERSION) {
        throw new Error("Base-model artifact version is unsupported.");
    }
    if (artifact.baseModel?.approvalStatus !== "approved") {
        throw new Error("Base-model artifact is not approved.");
    }

    const contractFields = [
        "artifactId",
        "combatClass",
        "version",
        "architectureVersion",
        "featureSchemaVersion",
        "actionSchemaVersion",
    ];
    for (const field of contractFields) {
        if (artifact.baseModel?.[field] !== definition[field]) {
            throw new Error(`Base-model artifact ${field} does not match the class registry.`);
        }
    }

    if (!artifact.model?.modelTopology || !Array.isArray(artifact.model?.weightSpecs)
        || typeof artifact.model?.weightDataBase64 !== "string") {
        throw new Error("Base-model artifact is missing TensorFlow.js model data.");
    }

    const actualDigest = await modelDigest(artifact.model);
    if (artifact.integrity?.algorithm !== "SHA-256" || artifact.integrity?.digest !== actualDigest) {
        throw new Error("Base-model artifact integrity check failed.");
    }
}

async function serializeModel(model) {
    let artifacts = null;
    await model.save(tf.io.withSaveHandler(async (modelArtifacts) => {
        artifacts = modelArtifacts;
        return {
            modelArtifactsInfo: {
                dateSaved: new Date(),
                modelTopologyType: "JSON",
            },
        };
    }));

    if (!artifacts?.modelTopology || !artifacts.weightData) {
        throw new Error("Unable to serialize the base model.");
    }

    return {
        modelTopology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs ?? [],
        weightDataBase64: arrayBufferToBase64(artifacts.weightData),
    };
}

async function modelDigest(serializedModel) {
    if (!globalThis.crypto?.subtle) {
        throw new Error("SHA-256 is unavailable in this browser context.");
    }

    const encoder = new TextEncoder();
    const topology = encoder.encode(stableStringify(serializedModel.modelTopology));
    const specs = encoder.encode(stableStringify(serializedModel.weightSpecs));
    const weights = new Uint8Array(base64ToArrayBuffer(serializedModel.weightDataBase64));
    const bytes = new Uint8Array(topology.length + specs.length + weights.length + 2);
    bytes.set(topology, 0);
    bytes[topology.length] = 10;
    bytes.set(specs, topology.length + 1);
    bytes[topology.length + specs.length + 1] = 10;
    bytes.set(weights, topology.length + specs.length + 2);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${stableStringify(value[key])}`
        )).join(",")}}`;
    }
    return JSON.stringify(value);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
}

function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
