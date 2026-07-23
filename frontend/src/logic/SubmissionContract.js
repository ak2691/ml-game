import { apiUrl } from "../config/api.js";

const ENV = import.meta.env ?? {};

export const CLIENT_BUILD_VERSION =
    ENV.VITE_CLIENT_BUILD_VERSION ?? "local-dev";

export const MODEL_SUBMISSION_ENDPOINT =
    apiUrl("/api/model-submissions");

export const TRAINING_SESSION_ENDPOINT =
    apiUrl("/api/training-sessions");
