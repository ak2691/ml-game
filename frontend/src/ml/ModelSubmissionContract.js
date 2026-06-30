export const MODEL_ARCHITECTURE_VERSION = "melee-heads-v7";
export const FEATURE_SCHEMA_VERSION = "duel-intent-features-v6";
export const ACTION_SCHEMA_VERSION = "melee-dash-actions-v3";
export const MODEL_FORMAT = "tfjs-layers-v1";
const ENV = import.meta.env ?? {};

export const CLIENT_BUILD_VERSION =
    ENV.VITE_CLIENT_BUILD_VERSION ?? "local-dev";

export const MODEL_SUBMISSION_ENDPOINT =
    `${ENV.VITE_API_BASE_URL ?? "http://localhost:8080"}/api/model-submissions`;

export const TRAINING_SESSION_ENDPOINT =
    `${ENV.VITE_API_BASE_URL ?? "http://localhost:8080"}/api/training-sessions`;
