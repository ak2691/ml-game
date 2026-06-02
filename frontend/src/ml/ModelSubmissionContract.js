export const MODEL_ARCHITECTURE_VERSION = "dense-movement-v1";
export const FEATURE_SCHEMA_VERSION = "arena-features-v1";
export const ACTION_SCHEMA_VERSION = "movement-v1";
export const MODEL_FORMAT = "tfjs-layers-v1";

export const CLIENT_BUILD_VERSION =
    import.meta.env.VITE_CLIENT_BUILD_VERSION ?? "local-dev";

export const MODEL_SUBMISSION_ENDPOINT =
    `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080"}/api/model-submissions`;

export const TRAINING_SESSION_ENDPOINT =
    `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080"}/api/training-sessions`;
