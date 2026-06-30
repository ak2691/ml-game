package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.ModelSubmission;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class ModelSubmissionValidatorTest {

    private final ModelSubmissionValidator validator = new ModelSubmissionValidator(new JsonMapper());

    @Test
    void acceptsMovementModelSubmissionMetadata() {
        ModelSubmission submission = validSubmission();

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isTrue();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    void acceptsMeleeActionSchemaMetadata() {
        ModelSubmission submission = validSubmission();
        submission.setActionSchemaVersion("melee-actions-v1");
        submission.setSelectedClass("melee");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isTrue();
    }

    @Test
    void acceptsDiscreteMeleeActionSchemaMetadata() {
        ModelSubmission submission = validSubmission();
        submission.setActionSchemaVersion("melee-discrete-actions-v2");
        submission.setSelectedClass("melee");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isTrue();
    }

    @Test
    void rejectsMissingRequiredSubmissionFields() {
        ModelSubmission submission = new ModelSubmission();

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains(
                "user is required",
                "architectureVersion is required",
                "featureSchemaVersion is required");
    }

    @Test
    void rejectsUnsupportedActionSchemaForCurrentPrototype() {
        ModelSubmission submission = validSubmission();
        submission.setActionSchemaVersion("attack-v1");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("actionSchemaVersion is not supported");
    }

    @Test
    void rejectsNegativeTrainingMetrics() {
        ModelSubmission submission = validSubmission();
        submission.setTrainingDurationMs(-1);
        submission.setTrainingSteps(-5);

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains(
                "trainingDurationMs cannot be negative",
                "trainingSteps cannot be negative");
    }

    @Test
    void rejectsInvalidRewardEventJson() {
        ModelSubmission submission = validSubmission();
        submission.setTrainingMetrics("{not-json");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("trainingMetrics must be valid JSON");
    }

    private ModelSubmission validSubmission() {
        ModelSubmission submission = new ModelSubmission();
        submission.setUser(new AppUser());
        submission.setArchitectureVersion("dense-movement-v1");
        submission.setFeatureSchemaVersion("arena-features-v1");
        submission.setActionSchemaVersion("movement-v1");
        submission.setTrainingSessionId("local-session-1");
        submission.setTrainingDurationMs(15000);
        submission.setTrainingSteps(120);
        submission.setTrainingMetrics("{\"movementAccuracy\":0.95,\"validationLoss\":0.12}");
        submission.setModelHash("sha256:prototype");
        submission.setClientBuildVersion("local-dev");
        return submission;
    }
}
