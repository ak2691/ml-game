package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.ModelSubmission;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class ModelSubmissionValidatorTest {

    private final ModelSubmissionValidator validator = new ModelSubmissionValidator(new JsonMapper());

    @Test
    void acceptsDeterministicBrainSubmissionMetadata() {
        ModelSubmission submission = validSubmission();

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isTrue();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    void rejectsLegacyMovementActionSchemaMetadata() {
        ModelSubmission submission = validSubmission();
        submission.setActionSchemaVersion("movement-v1");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("actionSchemaVersion is not supported");
    }

    @Test
    void rejectsLegacyMeleeActionSchemaMetadata() {
        ModelSubmission submission = validSubmission();
        submission.setActionSchemaVersion("melee-discrete-actions-v2");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("actionSchemaVersion is not supported");
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
        submission.setArchitectureVersion("deterministic-logic-v1");
        submission.setFeatureSchemaVersion("duel-logic-features-v1");
        submission.setActionSchemaVersion("melee-logic-actions-v1");
        submission.setTrainingSessionId("local-session-1");
        submission.setTrainingDurationMs(15000);
        submission.setTrainingSteps(0);
        submission.setTrainingMetrics("{\"version\":\"deterministic-logic-check-v1\",\"trainingSamples\":0,\"epochsCompleted\":0}");
        submission.setModelHash("sha256:prototype");
        submission.setClientBuildVersion("local-dev");
        return submission;
    }
}
