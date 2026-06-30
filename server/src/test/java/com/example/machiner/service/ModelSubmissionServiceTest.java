package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import com.example.machiner.DTO.ModelSubmissionValidationResponseDTO;
import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.ModelSubmission;
import com.example.machiner.domain.ModelSubmissionStatus;
import com.example.machiner.domain.TrainingSession;
import com.example.machiner.domain.ValidationResult;
import com.example.machiner.domain.ValidationStatus;
import com.example.machiner.repository.ModelSubmissionRepository;
import com.example.machiner.repository.TrainingSessionRepository;
import com.example.machiner.repository.ValidationResultRepository;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
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
    private final TrainingSessionRepository trainingSessionRepository =
            org.mockito.Mockito.mock(TrainingSessionRepository.class);
    private final ValidationResultRepository validationResultRepository =
            org.mockito.Mockito.mock(ValidationResultRepository.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final ModelSubmissionRateLimiter rateLimiter = org.mockito.Mockito.mock(ModelSubmissionRateLimiter.class);
    private final ApprovedBaseModelRegistry approvedBaseModelRegistry =
            org.mockito.Mockito.mock(ApprovedBaseModelRegistry.class);
    private final MatchmakingService matchmakingService = org.mockito.Mockito.mock(MatchmakingService.class);
    private final ModelSubmissionService service = new ModelSubmissionService(
            new ModelSubmissionValidationService(jsonMapper),
            modelSubmissionRepository,
            trainingSessionRepository,
            validationResultRepository,
            currentUserService,
            rateLimiter,
            approvedBaseModelRegistry,
            matchmakingService,
            jsonMapper);

    @Test
    void persistsAcceptedSubmissionWithServerComputedHash() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user);
        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        assertThat(response.getModelSubmissionId()).isEqualTo(submissionId);
        assertThat(response.isTrainingDurationTrusted()).isTrue();

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        ModelSubmission savedSubmission = submissionCaptor.getValue();
        assertThat(savedSubmission.getUser()).isSameAs(user);
        assertThat(savedSubmission.getArchitectureVersion()).isEqualTo("dense-movement-v1");
        assertThat(savedSubmission.getFeatureSchemaVersion()).isEqualTo("arena-features-v1");
        assertThat(savedSubmission.getActionSchemaVersion()).isEqualTo("movement-v1");
        assertThat(savedSubmission.getTrainingSessionId()).isEqualTo(trainingSessionId.toString());
        assertThat(savedSubmission.getTrainingDurationMs()).isGreaterThanOrEqualTo(0);
        assertThat(savedSubmission.getTrainingSteps()).isEqualTo(3);
        assertThat(savedSubmission.getTrainingMetrics()).contains("\"melee-supervised-training-metrics-v1\"");
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
    void rejectsSubmissionForTrainingSessionOwnedByAnotherUser() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        UUID trainingSessionId = UUID.randomUUID();
        when(trainingSessionRepository.findByIdAndUserId(trainingSessionId, user.getId()))
                .thenReturn(Optional.empty());

        var response = service.submit(validPayload(trainingSessionId), authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains("trainingSessionId was not found for this user");

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(ModelSubmissionStatus.REJECTED);
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
        payload.setTrainingMetrics(jsonMapper.readTree("{}"));

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
            trainingSessionRepository,
            validationResultRepository,
            currentUserService,
                rateLimiter,
                approvedBaseModelRegistry,
                matchmakingService,
            jsonMapper);

        ModelSubmissionPayloadDTO payload = validPayload(UUID.randomUUID());
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

    @Test
    void rejectsExactDuplicateValidatedModelHash() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user);
        when(modelSubmissionRepository.existsByModelHashAndStatus(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.eq(ModelSubmissionStatus.VALIDATED)))
                .thenReturn(true);

        var response = service.submit(validPayload(trainingSessionId), authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains("modelHash exactly matches a previous validated submission");

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(ModelSubmissionStatus.REJECTED);
    }

    @Test
    void acceptsDuplicateHashWhenItIsTheApprovedBaseForThisMatch() throws Exception {
        UUID submissionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user, matchId);
        when(modelSubmissionRepository.existsByModelHashAndStatus(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.eq(ModelSubmissionStatus.VALIDATED)))
                .thenReturn(true);
        when(approvedBaseModelRegistry.isApprovedMatchBase(
                any(ModelSubmissionPayloadDTO.class),
                org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(true);

        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);
        payload.setMatchId(matchId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        assertThat(response.getWarnings()).contains("unchanged approved base model accepted for this match");
        verify(modelSubmissionRepository, never()).existsByModelHashAndStatus(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.eq(ModelSubmissionStatus.VALIDATED));
    }

    @Test
    void acceptsDuplicateHashForCurrentUntouchedApprovedBase() throws Exception {
        UUID submissionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        UUID trainingSessionId = UUID.randomUUID();
        stubSavedSubmissionId(submissionId);
        stubOwnedTrainingSession(trainingSessionId, user, matchId);
        when(modelSubmissionRepository.existsByModelHashAndStatus(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.eq(ModelSubmissionStatus.VALIDATED)))
                .thenReturn(true);

        ModelSubmissionValidationResponseDTO validation = new ModelSubmissionValidationResponseDTO();
        validation.setAccepted(true);
        validation.setStatus("ACCEPTED");
        validation.setMessage("Model submission passed validation stub");
        validation.setValidatorVersion("model-submission-stub-v1");
        validation.setComputedModelHash("sha256:9e259e2ef0a9dbff85e4df95a2e273b57febc188932668c528b0b7b864fe52e2");
        validation.setErrors(List.of());
        validation.setWarnings(List.of());

        ModelSubmissionValidationService validationService =
                org.mockito.Mockito.mock(ModelSubmissionValidationService.class);
        when(validationService.validate(any(ModelSubmissionPayloadDTO.class))).thenReturn(validation);
        ModelSubmissionService serviceWithRealBaseRegistry = new ModelSubmissionService(
                validationService,
                modelSubmissionRepository,
                trainingSessionRepository,
                validationResultRepository,
                currentUserService,
                rateLimiter,
                new ApprovedBaseModelRegistry(),
                matchmakingService,
                jsonMapper);

        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);
        payload.setMatchId(matchId);
        payload.setSelectedClass("melee");
        payload.setBaseModelArtifactId("melee-base-v6");
        payload.setArchitectureVersion("melee-heads-v7");
        payload.setFeatureSchemaVersion("duel-intent-features-v6");
        payload.setActionSchemaVersion("melee-dash-actions-v3");

        var response = serviceWithRealBaseRegistry.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        assertThat(response.getWarnings()).contains("unchanged approved base model accepted for this match");
    }

    @Test
    void persistsAcceptedMatchBoundSubmission() throws Exception {
        UUID submissionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user, matchId);

        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);
        payload.setMatchId(matchId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getMatchId()).isEqualTo(matchId);
        org.mockito.Mockito.verify(matchmakingService).requireActiveMatchForUser(user.getId(), matchId);
    }

    @Test
    void rejectsMatchSubmissionUsingTrainingSessionFromAnotherContext() throws Exception {
        UUID submissionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user, null);

        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);
        payload.setMatchId(matchId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains("trainingSessionId is not assigned to this match");
    }

    @Test
    void rateLimitStopsSubmissionBeforePersistence() {
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        org.mockito.Mockito.doThrow(new RateLimitExceededException(
                "Too many model submissions. Please retry shortly.",
                java.time.Duration.ofMillis(500)))
                .when(rateLimiter).requireAllowed(user.getId());

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.submit(null, authentication))
                .isInstanceOf(RateLimitExceededException.class);

        verify(modelSubmissionRepository, never()).save(any(ModelSubmission.class));
        verify(validationResultRepository, never()).save(any(ValidationResult.class));
    }

    private ModelSubmissionPayloadDTO validPayload(UUID trainingSessionId) throws Exception {
        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setArchitectureVersion("dense-movement-v1");
        payload.setFeatureSchemaVersion("arena-features-v1");
        payload.setActionSchemaVersion("movement-v1");
        payload.setModelFormat("tfjs-layers-v1");
        payload.setTrainingSessionId(trainingSessionId.toString());
        payload.setTrainingDurationMs(null);
        payload.setTrainingSteps(3);
        payload.setSelectedClass("melee");
        payload.setBaseModelArtifactId("melee-base-v1");
        payload.setTrainingMetrics(jsonMapper.readTree("""
                {"version":"melee-supervised-training-metrics-v1","validationLoss":0.12}
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

    private void stubOwnedTrainingSession(UUID trainingSessionId, AppUser user) throws Exception {
        stubOwnedTrainingSession(trainingSessionId, user, null);
    }

    private void stubOwnedTrainingSession(UUID trainingSessionId, AppUser user, UUID matchId) throws Exception {
        TrainingSession session = new TrainingSession();
        setId(session, trainingSessionId);
        session.setUser(user);
        session.setMatchId(matchId);
        session.setStartedAt(Instant.now().minusSeconds(2));
        when(trainingSessionRepository.findByIdAndUserId(trainingSessionId, user.getId()))
                .thenReturn(Optional.of(session));
    }

    private void setId(ModelSubmission submission, UUID id) throws Exception {
        Field idField = ModelSubmission.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(submission, id);
    }

    private void setId(TrainingSession session, UUID id) throws Exception {
        Field idField = TrainingSession.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(session, id);
    }
}
