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
import { normalizeMeleeStrategyConfiguration } from "./MeleeStrategy.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export async function buildModelSubmissionPayload({
    brain,
    matchId = null,
    trainingSessionId,
    trainingSteps = 0,
    trainingMetrics = null,
    selectedClass = "melee",
}) {
    const normalizedBrain = normalizeMeleeStrategyConfiguration(brain);

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
        baseModelArtifactId: null,
        trainingMetrics: trainingMetrics ?? {
            version: "deterministic-logic-submission-v1",
            configuration: normalizedBrain,
            trainingSamples: 0,
            validationSamples: 0,
            epochsCompleted: 0,
        },
        clientBuildVersion: CLIENT_BUILD_VERSION,
        brain: normalizedBrain,
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
