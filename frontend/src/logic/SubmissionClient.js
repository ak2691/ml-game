import {
    CLIENT_BUILD_VERSION,
    MODEL_SUBMISSION_ENDPOINT,
    TRAINING_SESSION_ENDPOINT,
} from "./SubmissionContract.js";
import { ensureCsrfHeaders } from "../security/csrf";
import { API_BASE_URL } from "../config/api.js";
import { normalizeMeleeStrategyConfiguration } from "./BotBrain.js";

export async function buildModelSubmissionPayload({
    brain,
    matchId = null,
    trainingSessionId,
    selectedClass = "custom",
    loadout = null,
}) {
    const normalizedBrain = {
        ...normalizeMeleeStrategyConfiguration(brain),
        ...(loadout ? { loadout } : {}),
    };

    return {
        matchId,
        trainingSessionId,
        selectedClass,
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
