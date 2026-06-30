package com.example.machiner.service;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import com.example.machiner.DTO.ModelSubmissionValidationResponseDTO;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ModelSubmissionValidationService {

    private static final String VALIDATOR_VERSION = "model-submission-stub-v1";
    private static final String ARCHITECTURE_VERSION = "dense-movement-v1";
    private static final String MELEE_ARCHITECTURE_VERSION = "melee-heads-v1";
    private static final String MELEE_ARCHITECTURE_VERSION_V2 = "melee-heads-v2";
    private static final String MELEE_ARCHITECTURE_VERSION_V3 = "melee-heads-v3";
    private static final String MELEE_ARCHITECTURE_VERSION_V4 = "melee-heads-v4";
    private static final String MELEE_ARCHITECTURE_VERSION_V5 = "melee-heads-v5";
    private static final String MELEE_ARCHITECTURE_VERSION_V6 = "melee-heads-v6";
    private static final String MELEE_ARCHITECTURE_VERSION_V7 = "melee-heads-v7";
    private static final String FEATURE_SCHEMA_VERSION = "arena-features-v1";
    private static final String MELEE_FEATURE_SCHEMA_VERSION = "arena-combat-features-v1";
    private static final String MELEE_FEATURE_SCHEMA_VERSION_V2 = "arena-combat-features-v2";
    private static final String MELEE_FEATURE_SCHEMA_VERSION_V3 = "duel-combat-features-v3";
    private static final String MELEE_FEATURE_SCHEMA_VERSION_V4 = "duel-logic-features-v4";
    private static final String MELEE_FEATURE_SCHEMA_VERSION_V5 = "duel-obstacle-features-v5";
    private static final String MELEE_FEATURE_SCHEMA_VERSION_V6 = "duel-intent-features-v6";
    private static final String ACTION_SCHEMA_VERSION = "movement-v1";
    private static final String MELEE_ACTION_SCHEMA_VERSION = "melee-actions-v1";
    private static final String MELEE_ACTION_SCHEMA_VERSION_V2 = "melee-discrete-actions-v2";
    private static final String MELEE_ACTION_SCHEMA_VERSION_V3 = "melee-dash-actions-v3";
    private static final String MODEL_FORMAT = "tfjs-layers-v1";
    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TRAINING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_MODEL_HASH_LENGTH = 128;
    private static final int MAX_SELECTED_CLASS_LENGTH = 40;
    private static final int MAX_BASE_MODEL_ARTIFACT_ID_LENGTH = 100;
    private static final int MAX_ROUND_TRAINING_SAMPLES = 3_072;
    private static final int MAX_ROUND_TRAINING_EPOCHS = 30;
    private static final int MAX_ROUND_TRAINING_STEPS = MAX_ROUND_TRAINING_SAMPLES * MAX_ROUND_TRAINING_EPOCHS;

    private final JsonMapper jsonMapper;

    public ModelSubmissionValidationService(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    public ModelSubmissionValidationResponseDTO validate(ModelSubmissionPayloadDTO payload) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (payload == null) {
            errors.add("submission payload is required");
            return response(false, errors, warnings, null, null, false);
        }

        requireOneOf(errors, payload.getArchitectureVersion(), "architectureVersion",
                ARCHITECTURE_VERSION, MELEE_ARCHITECTURE_VERSION, MELEE_ARCHITECTURE_VERSION_V2,
                MELEE_ARCHITECTURE_VERSION_V3, MELEE_ARCHITECTURE_VERSION_V4,
                MELEE_ARCHITECTURE_VERSION_V5, MELEE_ARCHITECTURE_VERSION_V6,
                MELEE_ARCHITECTURE_VERSION_V7);
        requireOneOf(errors, payload.getFeatureSchemaVersion(), "featureSchemaVersion",
                FEATURE_SCHEMA_VERSION, MELEE_FEATURE_SCHEMA_VERSION, MELEE_FEATURE_SCHEMA_VERSION_V2,
                MELEE_FEATURE_SCHEMA_VERSION_V3, MELEE_FEATURE_SCHEMA_VERSION_V4,
                MELEE_FEATURE_SCHEMA_VERSION_V5, MELEE_FEATURE_SCHEMA_VERSION_V6);
        requireOneOf(errors, payload.getActionSchemaVersion(), "actionSchemaVersion",
                ACTION_SCHEMA_VERSION, MELEE_ACTION_SCHEMA_VERSION, MELEE_ACTION_SCHEMA_VERSION_V2,
                MELEE_ACTION_SCHEMA_VERSION_V3);
        requireExact(errors, payload.getModelFormat(), "modelFormat", MODEL_FORMAT);

        rejectTooLong(errors, payload.getArchitectureVersion(), "architectureVersion", MAX_VERSION_LENGTH);
        rejectTooLong(errors, payload.getFeatureSchemaVersion(), "featureSchemaVersion", MAX_VERSION_LENGTH);
        rejectTooLong(errors, payload.getActionSchemaVersion(), "actionSchemaVersion", MAX_VERSION_LENGTH);
        rejectTooLong(errors, payload.getModelFormat(), "modelFormat", MAX_VERSION_LENGTH);
        rejectTooLong(errors, payload.getTrainingSessionId(), "trainingSessionId", MAX_TRAINING_SESSION_ID_LENGTH);
        rejectTooLong(errors, payload.getSelectedClass(), "selectedClass", MAX_SELECTED_CLASS_LENGTH);
        rejectTooLong(errors, payload.getBaseModelArtifactId(),
                "baseModelArtifactId", MAX_BASE_MODEL_ARTIFACT_ID_LENGTH);
        rejectTooLong(errors, payload.getModelHash(), "modelHash", MAX_MODEL_HASH_LENGTH);
        rejectTooLong(errors, payload.getClientBuildVersion(), "clientBuildVersion", MAX_CLIENT_BUILD_VERSION_LENGTH);

        requireText(errors, payload.getTrainingSessionId(), "trainingSessionId");
        requireUuid(errors, payload.getTrainingSessionId(), "trainingSessionId");
        rejectNegative(errors, payload.getTrainingDurationMs(), "trainingDurationMs");
        rejectNegative(errors, payload.getTrainingSteps(), "trainingSteps");
        requireNonNegative(errors, payload.getTrainingSteps(), "trainingSteps");
        if (payload.getTrainingSteps() != null && payload.getTrainingSteps() > MAX_ROUND_TRAINING_STEPS) {
            errors.add("trainingSteps exceeds the round training limit");
        }
        if (requireObject(errors, payload.getTrainingMetrics(), "trainingMetrics")) {
            validateRoundTrainingLimits(errors, payload.getTrainingMetrics());
        }
        validateSerializedModel(errors, payload.getModel());

        String computedHash = null;
        if (payload.getModel() != null && payload.getModel().isObject()) {
            computedHash = computeModelHash(payload.getModel(), errors);
        }

        if (hasText(payload.getModelHash())) {
            if (computedHash != null && !payload.getModelHash().equals(computedHash)) {
                warnings.add("submitted modelHash does not match server-computed hash; server hash is authoritative");
            }
        } else {
            warnings.add("modelHash was not provided; server computed one from submitted model");
        }

        if (payload.getTrainingDurationMs() == null) {
            warnings.add("trainingDurationMs will be computed from the server-owned training session");
        }

        return response(errors.isEmpty(), errors, warnings, payload.getModelHash(), computedHash,
                payload.getTrainingDurationMs() != null);
    }

    private ModelSubmissionValidationResponseDTO response(
            boolean accepted,
            List<String> errors,
            List<String> warnings,
            String submittedHash,
            String computedHash,
            boolean trainingDurationTrusted) {
        ModelSubmissionValidationResponseDTO response = new ModelSubmissionValidationResponseDTO();
        response.setAccepted(accepted);
        response.setStatus(accepted ? "ACCEPTED" : "REJECTED");
        response.setMessage(accepted
                ? "Model submission passed validation stub"
                : "Model submission failed validation stub");
        response.setValidatorVersion(VALIDATOR_VERSION);
        response.setSubmittedModelHash(submittedHash);
        response.setComputedModelHash(computedHash);
        response.setTrainingDurationTrusted(trainingDurationTrusted);
        response.setErrors(errors);
        response.setWarnings(warnings);
        return response;
    }

    private void validateSerializedModel(List<String> errors, JsonNode model) {
        if (!requireObject(errors, model, "model")) {
            return;
        }

        if (!model.hasNonNull("modelTopology") || !model.get("modelTopology").isObject()) {
            errors.add("model.modelTopology must be an object");
        }

        if (!model.hasNonNull("weightSpecs") || !model.get("weightSpecs").isArray()) {
            errors.add("model.weightSpecs must be an array");
        }

        if (!model.hasNonNull("weightDataBase64") || !model.get("weightDataBase64").isTextual()) {
            errors.add("model.weightDataBase64 must be a base64 string");
        }
    }

    private void validateRoundTrainingLimits(List<String> errors, JsonNode metrics) {
        JsonNode trainingSamples = metrics.get("trainingSamples");
        if (trainingSamples != null && trainingSamples.isNumber()
                && trainingSamples.asInt() > MAX_ROUND_TRAINING_SAMPLES) {
            errors.add("trainingMetrics.trainingSamples exceeds the round sample limit");
        }

        JsonNode epochsCompleted = metrics.get("epochsCompleted");
        if (epochsCompleted != null && epochsCompleted.isNumber()
                && epochsCompleted.asInt() > MAX_ROUND_TRAINING_EPOCHS) {
            errors.add("trainingMetrics.epochsCompleted exceeds the round epoch limit");
        }
    }

    private String computeModelHash(JsonNode model, List<String> errors) {
        try {
            String topology = jsonMapper.writeValueAsString(model.get("modelTopology"));
            String specs = jsonMapper.writeValueAsString(model.get("weightSpecs"));
            String weights = model.get("weightDataBase64").asString("");
            return "sha256:" + sha256Hex(topology + "|" + specs + "|" + weights);
        } catch (Exception ex) {
            errors.add("modelHash could not be computed from submitted model");
            return null;
        }
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is not available", ex);
        }
    }

    private void requireExact(List<String> errors, String value, String field, String expected) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        if (!expected.equals(value)) {
            errors.add(field + " must be " + expected);
        }
    }

    private void requireOneOf(List<String> errors, String value, String field, String... expectedValues) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        for (String expected : expectedValues) {
            if (expected.equals(value)) {
                return;
            }
        }

        errors.add(field + " is not supported");
    }

    private void requireText(List<String> errors, String value, String field) {
        if (!hasText(value)) {
            errors.add(field + " is required");
        }
    }

    private void requireUuid(List<String> errors, String value, String field) {
        if (!hasText(value)) {
            return;
        }

        try {
            UUID.fromString(value.trim());
        } catch (IllegalArgumentException ex) {
            errors.add(field + " must be a server-issued UUID");
        }
    }

    private boolean requireObject(List<String> errors, JsonNode value, String field) {
        if (value == null || value.isNull()) {
            errors.add(field + " is required");
            return false;
        }

        if (!value.isObject()) {
            errors.add(field + " must be an object");
            return false;
        }

        return true;
    }

    private void requireNonNegative(List<String> errors, Integer value, String field) {
        if (value == null) {
            errors.add(field + " is required");
            return;
        }

        rejectNegative(errors, value, field);
    }

    private void rejectNegative(List<String> errors, Integer value, String field) {
        if (value != null && value < 0) {
            errors.add(field + " cannot be negative");
        }
    }

    private void rejectTooLong(List<String> errors, String value, String field, int maxLength) {
        if (value != null && value.length() > maxLength) {
            errors.add(field + " cannot exceed " + maxLength + " characters");
        }
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
