import {
    ACTION_SCHEMA_VERSION,
    CLIENT_BUILD_VERSION,
    FEATURE_SCHEMA_VERSION,
    MODEL_ARCHITECTURE_VERSION,
    MODEL_FORMAT,
    MODEL_SUBMISSION_ENDPOINT,
    TRAINING_SESSION_ENDPOINT,
} from "./ModelSubmissionContract";
import { csrfHeaders } from "../security/csrf";

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
    trainingSessionId,
    trainingSteps,
    rewardEvents,
}) {
    const serializedModel = await serializeModel(model);

    return {
        architectureVersion: MODEL_ARCHITECTURE_VERSION,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        actionSchemaVersion: ACTION_SCHEMA_VERSION,
        modelFormat: MODEL_FORMAT,
        trainingSessionId,
        trainingDurationMs: null,
        trainingSteps,
        rewardEvents,
        clientBuildVersion: CLIENT_BUILD_VERSION,
        model: serializedModel,
    };
}

export async function submitModelPayload(payload) {
    const response = await fetch(MODEL_SUBMISSION_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...csrfHeaders("POST"),
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

export async function createTrainingSession() {
    const response = await fetch(TRAINING_SESSION_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...csrfHeaders("POST"),
        },
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(body.message ?? `Training session failed with ${response.status}`);
    }

    return body;
}

export async function fetchTrainingSessionDuration(trainingSessionId) {
    const response = await fetch(`${TRAINING_SESSION_ENDPOINT}/${trainingSessionId}/duration`, {
        credentials: "include",
    });
    if (!response.ok) return null;

    const body = await response.json();
    return body.trainingDurationMs ?? null;
}
