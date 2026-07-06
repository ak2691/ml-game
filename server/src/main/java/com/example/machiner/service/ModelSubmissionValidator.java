package com.example.machiner.service;

import com.example.machiner.domain.ModelSubmission;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
public class ModelSubmissionValidator {

    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TRAINING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_MODEL_HASH_LENGTH = 128;
    private static final int MAX_SELECTED_CLASS_LENGTH = 40;
    private static final int MAX_BASE_MODEL_ARTIFACT_ID_LENGTH = 100;
    private static final String LOGIC_ACTION_SCHEMA_VERSION = "melee-logic-actions-v1";

    private final JsonMapper jsonMapper;

    public ModelSubmissionValidator(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    public ModelSubmissionValidationResult validate(ModelSubmission submission) {
        List<String> errors = new ArrayList<>();

        if (submission == null) {
            errors.add("submission is required");
            return new ModelSubmissionValidationResult(errors);
        }

        if (submission.getUser() == null) {
            errors.add("user is required");
        }

        requireText(errors, submission.getArchitectureVersion(), "architectureVersion", MAX_VERSION_LENGTH);
        requireText(errors, submission.getFeatureSchemaVersion(), "featureSchemaVersion", MAX_VERSION_LENGTH);
        requireText(errors, submission.getActionSchemaVersion(), "actionSchemaVersion", MAX_VERSION_LENGTH);

        if (hasText(submission.getActionSchemaVersion())
                && !LOGIC_ACTION_SCHEMA_VERSION.equals(submission.getActionSchemaVersion())) {
            errors.add("actionSchemaVersion is not supported");
        }

        rejectNegative(errors, submission.getTrainingDurationMs(), "trainingDurationMs");
        rejectNegative(errors, submission.getTrainingSteps(), "trainingSteps");

        rejectTooLong(errors, submission.getTrainingSessionId(), "trainingSessionId", MAX_TRAINING_SESSION_ID_LENGTH);
        rejectTooLong(errors, submission.getSelectedClass(), "selectedClass", MAX_SELECTED_CLASS_LENGTH);
        rejectTooLong(errors, submission.getBaseModelArtifactId(),
                "baseModelArtifactId", MAX_BASE_MODEL_ARTIFACT_ID_LENGTH);
        rejectTooLong(errors, submission.getModelHash(), "modelHash", MAX_MODEL_HASH_LENGTH);
        rejectTooLong(errors, submission.getClientBuildVersion(), "clientBuildVersion", MAX_CLIENT_BUILD_VERSION_LENGTH);

        validateJson(errors, submission.getTrainingMetrics(), "trainingMetrics");

        return new ModelSubmissionValidationResult(errors);
    }

    private void requireText(List<String> errors, String value, String field, int maxLength) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        rejectTooLong(errors, value, field, maxLength);
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

    private void validateJson(List<String> errors, String value, String field) {
        if (!hasText(value)) {
            errors.add(field + " is required");
            return;
        }

        try {
            jsonMapper.readTree(value);
        } catch (Exception ex) {
            errors.add(field + " must be valid JSON");
        }
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
