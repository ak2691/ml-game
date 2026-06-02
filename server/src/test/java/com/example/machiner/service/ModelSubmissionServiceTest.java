package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.ModelSubmission;
import com.example.machiner.domain.ModelSubmissionStatus;
import com.example.machiner.domain.ValidationResult;
import com.example.machiner.domain.ValidationStatus;
import com.example.machiner.repository.ModelSubmissionRepository;
import com.example.machiner.repository.ValidationResultRepository;
import java.lang.reflect.Field;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class ModelSubmissionServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final ModelSubmissionRepository modelSubmissionRepository =
            org.mockito.Mockito.mock(ModelSubmissionRepository.class);
    private final ValidationResultRepository validationResultRepository =
            org.mockito.Mockito.mock(ValidationResultRepository.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final ModelSubmissionService service = new ModelSubmissionService(
            new ModelSubmissionValidationService(jsonMapper),
            modelSubmissionRepository,
            validationResultRepository,
            currentUserService,
            jsonMapper);

    @Test
    void persistsAcceptedSubmissionWithServerComputedHash() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        ModelSubmissionPayloadDTO payload = validPayload();
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        assertThat(response.getModelSubmissionId()).isEqualTo(submissionId);

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        ModelSubmission savedSubmission = submissionCaptor.getValue();
        assertThat(savedSubmission.getUser()).isSameAs(user);
        assertThat(savedSubmission.getArchitectureVersion()).isEqualTo("dense-movement-v1");
        assertThat(savedSubmission.getFeatureSchemaVersion()).isEqualTo("arena-features-v1");
        assertThat(savedSubmission.getActionSchemaVersion()).isEqualTo("movement-v1");
        assertThat(savedSubmission.getTrainingSessionId()).isEqualTo("local-session-1");
        assertThat(savedSubmission.getTrainingSteps()).isEqualTo(3);
        assertThat(savedSubmission.getRewardEvents()).contains("\"reward-events-v1\"");
        assertThat(savedSubmission.getModelHash()).isEqualTo(response.getComputedModelHash());
        assertThat(savedSubmission.getStatus()).isEqualTo(ModelSubmissionStatus.VALIDATED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        ValidationResult savedResult = resultCaptor.getValue();
        assertThat(savedResult.getModelSubmission()).isSameAs(savedSubmission);
        assertThat(savedResult.getStatus()).isEqualTo(ValidationStatus.ACCEPTED);
        assertThat(savedResult.getValidatorVersion()).isEqualTo("model-submission-stub-v1");
        assertThat(savedResult.getDetails()).contains("\"computedModelHash\"");
    }

    @Test
    void persistsRejectedSubmissionWithoutViolatingRequiredColumns() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setArchitectureVersion(null);
        payload.setFeatureSchemaVersion(null);
        payload.setActionSchemaVersion(null);
        payload.setTrainingSessionId("x".repeat(150));
        payload.setTrainingSteps(-1);
        payload.setRewardEvents(jsonMapper.readTree("{}"));

        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getModelSubmissionId()).isEqualTo(submissionId);

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        ModelSubmission savedSubmission = submissionCaptor.getValue();
        assertThat(savedSubmission.getArchitectureVersion()).isEqualTo("missing-architecture");
        assertThat(savedSubmission.getFeatureSchemaVersion()).isEqualTo("missing-features");
        assertThat(savedSubmission.getActionSchemaVersion()).isEqualTo("movement-v1");
        assertThat(savedSubmission.getTrainingSessionId()).hasSize(100);
        assertThat(savedSubmission.getStatus()).isEqualTo(ModelSubmissionStatus.REJECTED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        assertThat(resultCaptor.getValue().getStatus()).isEqualTo(ValidationStatus.REJECTED);
        assertThat(resultCaptor.getValue().getRejectionCode()).isEqualTo("MODEL_SUBMISSION_CONTRACT_FAILED");
    }

    @Test
    void persistsValidatorErrorsAsValidationResults() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        ModelSubmissionValidationService failingValidationService =
                org.mockito.Mockito.mock(ModelSubmissionValidationService.class);
        when(failingValidationService.validate(any(ModelSubmissionPayloadDTO.class)))
                .thenThrow(new IllegalStateException("validator unavailable"));
        ModelSubmissionService serviceWithFailingValidator = new ModelSubmissionService(
                failingValidationService,
                modelSubmissionRepository,
                validationResultRepository,
                currentUserService,
                jsonMapper);

        ModelSubmissionPayloadDTO payload = validPayload();
        var response = serviceWithFailingValidator.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getStatus()).isEqualTo("ERROR");
        assertThat(response.getModelSubmissionId()).isEqualTo(submissionId);

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(ModelSubmissionStatus.REJECTED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        ValidationResult savedResult = resultCaptor.getValue();
        assertThat(savedResult.getStatus()).isEqualTo(ValidationStatus.ERROR);
        assertThat(savedResult.getRejectionCode()).isEqualTo("MODEL_SUBMISSION_VALIDATION_ERROR");
        assertThat(savedResult.getDetails()).contains("validator error: IllegalStateException");
    }

    private ModelSubmissionPayloadDTO validPayload() throws Exception {
        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setArchitectureVersion("dense-movement-v1");
        payload.setFeatureSchemaVersion("arena-features-v1");
        payload.setActionSchemaVersion("movement-v1");
        payload.setModelFormat("tfjs-layers-v1");
        payload.setTrainingSessionId("local-session-1");
        payload.setTrainingDurationMs(null);
        payload.setTrainingSteps(3);
        payload.setRewardEvents(jsonMapper.readTree("""
                {"version":"reward-events-v1","events":[],"totals":{"rewardCount":0}}
                """));

        JsonNode model = jsonMapper.readTree("""
                {
                  "modelTopology": {"class_name":"Sequential","config":{"name":"sequential_1"}},
                  "weightSpecs": [{"name":"hidden1/kernel","shape":[60,64],"dtype":"float32"}],
                  "weightDataBase64": "AAECAw=="
                }
                """);
        payload.setModel(model);
        payload.setClientBuildVersion("test");
        return payload;
    }

    private AppUser prototypeUser() {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername("prototype-local-player");
        user.setEmail("prototype@example.test");
        user.setNormalizedEmail("prototype@example.test");
        return user;
    }

    private Authentication authenticatedUser(AppUser user) {
        Authentication authentication = new UsernamePasswordAuthenticationToken("test", null);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        return authentication;
    }

    private void stubSavedSubmissionId(UUID submissionId) throws Exception {
        when(modelSubmissionRepository.save(any(ModelSubmission.class))).thenAnswer(invocation -> {
            ModelSubmission submission = invocation.getArgument(0);
            setId(submission, submissionId);
            return submission;
        });
    }

    private void setId(ModelSubmission submission, UUID id) throws Exception {
        Field idField = ModelSubmission.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(submission, id);
    }
}
