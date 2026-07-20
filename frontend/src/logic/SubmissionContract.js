export const MODEL_ARCHITECTURE_VERSION = "deterministic-logic-v1";
export const FEATURE_SCHEMA_VERSION = "duel-logic-features-v1";
export const ACTION_SCHEMA_VERSION = "melee-logic-actions-v1";
export const MODEL_FORMAT = "logic-blocks-v1";
const ENV = import.meta.env ?? {};

export const CLIENT_BUILD_VERSION =
    ENV.VITE_CLIENT_BUILD_VERSION ?? "local-dev";

export const MODEL_SUBMISSION_ENDPOINT =
    `${ENV.VITE_API_BASE_URL ?? "http://localhost:8080"}/api/model-submissions`;

export const TRAINING_SESSION_ENDPOINT =
    `${ENV.VITE_API_BASE_URL ?? "http://localhost:8080"}/api/training-sessions`;
