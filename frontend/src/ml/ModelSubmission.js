import {
    ACTION_SCHEMA_VERSION,
    CLIENT_BUILD_VERSION,
    FEATURE_SCHEMA_VERSION,
    MODEL_ARCHITECTURE_VERSION,
    MODEL_FORMAT,
    MODEL_SUBMISSION_ENDPOINT,
    TRAINING_SESSION_ENDPOINT,
} from "./ModelSubmissionContract";
import { ensureCsrfHeaders } from "../security/csrf";
import { getBaseModelDefinition } from "./BaseModelArtifact.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";

    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}

async function serializeModel(model) {
    let savedArtifacts = null;

    await model.save({
        save: async (artifacts) => {
            savedArtifacts = artifacts;
            return {
                modelArtifactsInfo: {
                    dateSaved: new Date(),
                    modelTopologyType: "JSON",
                },
            };
        },
    });

    if (!savedArtifacts) {
        throw new Error("Unable to serialize model artifacts.");
    }

    return {
        modelTopology: savedArtifacts.modelTopology,
        weightSpecs: savedArtifacts.weightSpecs ?? [],
        weightDataBase64: savedArtifacts.weightData
            ? arrayBufferToBase64(savedArtifacts.weightData)
            : null,
    };
}

export async function buildModelSubmissionPayload({
    model,
    matchId = null,
    trainingSessionId,
    trainingSteps,
    trainingMetrics,
    selectedClass = "melee",
}) {
    const serializedModel = await serializeModel(model);
    const baseModel = getBaseModelDefinition(selectedClass);

    return {
        architectureVersion: MODEL_ARCHITECTURE_VERSION,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        actionSchemaVersion: ACTION_SCHEMA_VERSION,
        modelFormat: MODEL_FORMAT,
        matchId,
        trainingSessionId,
        trainingDurationMs: null,
        trainingSteps,
        selectedClass,
        baseModelArtifactId: baseModel.artifactId,
        trainingMetrics,
        clientBuildVersion: CLIENT_BUILD_VERSION,
        model: serializedModel,
    };
}

export async function buildModelFingerprintProbeResponse({
    model,
    probe,
    trainingStepCount,
}) {
    if (!model || !probe?.probeId || !Array.isArray(probe.weightIndices)) {
        throw new Error("A model and server probe request are required.");
    }

    const allWeights = [];
    const tensors = model.getWeights();
    for (const tensor of tensors) {
        const values = await tensor.data();
        for (let i = 0; i < values.length; i++) {
            allWeights.push(values[i]);
        }
    }

    return {
        probeId: probe.probeId,
        values: probe.weightIndices.map((index) => {
            const value = allWeights[index];
            return Number.isFinite(value) ? value : null;
        }),
        trainingStepCount,
    };
}

export async function submitModelPayload(payload) {
    const response = await fetch(MODEL_SUBMISSION_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(await ensureCsrfHeaders("POST", API_BASE_URL)),
        },
        body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const validationErrors = Array.isArray(body.errors) && body.errors.length > 0
            ? `: ${body.errors.join(", ")}`
            : "";
        throw new Error(`${body.message ?? `Model submission failed with ${response.status}`}${validationErrors}`);
    }

    return body;
}

export async function createTrainingSession(matchId = null) {
    const endpoint = matchId
        ? `${TRAINING_SESSION_ENDPOINT}?matchId=${encodeURIComponent(matchId)}`
        : TRAINING_SESSION_ENDPOINT;
    const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(await ensureCsrfHeaders("POST", API_BASE_URL)),
        },
    });

    const responseText = await response.text();
    const body = responseText ? safeJson(responseText) : {};

    if (!response.ok) {
        throw new Error(body.message ?? responseText ?? `Training session failed with ${response.status}`);
    }

    return body;
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

export async function fetchTrainingSessionDuration(trainingSessionId) {
    const response = await fetch(`${TRAINING_SESSION_ENDPOINT}/${trainingSessionId}/duration`, {
        credentials: "include",
    });
    if (!response.ok) return null;

    const body = await response.json();
    return body.trainingDurationMs ?? null;
}
