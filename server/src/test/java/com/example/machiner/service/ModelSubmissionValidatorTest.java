package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.ModelSubmission;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ModelSubmissionValidatorTest {

    private final ModelSubmissionValidator validator = new ModelSubmissionValidator(new ObjectMapper());

    @Test
    void acceptsMovementModelSubmissionMetadata() {
        ModelSubmission submission = validSubmission();

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isTrue();
        assertThat(result.errors()).isEmpty();
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
    void rejectsNonMovementActionSchemaForCurrentPrototype() {
        ModelSubmission submission = validSubmission();
        submission.setActionSchemaVersion("attack-v1");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("actionSchemaVersion must be movement-v1");
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
        submission.setRewardEvents("{not-json");

        ModelSubmissionValidationResult result = validator.validate(submission);

        assertThat(result.isValid()).isFalse();
        assertThat(result.errors()).contains("rewardEvents must be valid JSON");
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
        submission.setRewardEvents("{\"movesTowardTarget\":12,\"collisions\":1}");
        submission.setModelHash("sha256:prototype");
        submission.setClientBuildVersion("local-dev");
        return submission;
    }
}
