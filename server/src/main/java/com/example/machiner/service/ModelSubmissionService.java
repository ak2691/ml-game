package com.example.machiner.service;

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
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ModelSubmissionService {

    private static final String FALLBACK_ACTION_SCHEMA_VERSION = "melee-logic-actions-v1";
    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TRAINING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_MODEL_HASH_LENGTH = 128;
    private static final int MAX_SELECTED_CLASS_LENGTH = 40;
    private static final int MAX_BASE_MODEL_ARTIFACT_ID_LENGTH = 100;
    private static final String VALIDATOR_VERSION = "model-submission-stub-v1";

    private final ModelSubmissionValidationService validationService;
    private final ModelSubmissionRepository modelSubmissionRepository;
    private final TrainingSessionRepository trainingSessionRepository;
    private final ValidationResultRepository validationResultRepository;
    private final CurrentUserService currentUserService;
    private final ModelSubmissionRateLimiter rateLimiter;
    private final MatchmakingService matchmakingService;
    private final JsonMapper jsonMapper;

    public ModelSubmissionService(
            ModelSubmissionValidationService validationService,
            ModelSubmissionRepository modelSubmissionRepository,
            TrainingSessionRepository trainingSessionRepository,
            ValidationResultRepository validationResultRepository,
            CurrentUserService currentUserService,
            ModelSubmissionRateLimiter rateLimiter,
            MatchmakingService matchmakingService,
            JsonMapper jsonMapper) {
        this.validationService = validationService;
        this.modelSubmissionRepository = modelSubmissionRepository;
        this.trainingSessionRepository = trainingSessionRepository;
        this.validationResultRepository = validationResultRepository;
        this.currentUserService = currentUserService;
        this.rateLimiter = rateLimiter;
        this.matchmakingService = matchmakingService;
        this.jsonMapper = jsonMapper;
    }

    @Transactional
    public ModelSubmissionValidationResponseDTO submit(ModelSubmissionPayloadDTO payload, Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        rateLimiter.requireAllowed(user.getId());
        ModelSubmissionValidationResponseDTO validation = validateSafely(payload);
        Integer trustedTrainingDurationMs = validateOwnedTrainingSession(payload, user, validation);
        validateMatchBinding(payload, user, validation);
        rejectDuplicateFinalHash(payload, validation);
        ModelSubmission submission = toSubmission(payload, validation, user, trustedTrainingDurationMs);

        ModelSubmission savedSubmission = modelSubmissionRepository.save(submission);
        validationResultRepository.save(toValidationResult(savedSubmission, validation));
        validation.setModelSubmissionId(savedSubmission.getId());

        return validation;
    }

    private void rejectDuplicateFinalHash(
            ModelSubmissionPayloadDTO payload,
            ModelSubmissionValidationResponseDTO validation) {
        // Deterministic bot brains may intentionally be resubmitted unchanged across rounds.
    }

    private ModelSubmissionValidationResponseDTO validateSafely(ModelSubmissionPayloadDTO payload) {
        try {
            return validationService.validate(payload);
        } catch (Exception ex) {
            ModelSubmissionValidationResponseDTO response = new ModelSubmissionValidationResponseDTO();
            response.setAccepted(false);
            response.setStatus("ERROR");
            response.setMessage("Bot brain validation failed unexpectedly");
            response.setValidatorVersion(VALIDATOR_VERSION);
            response.setSubmittedModelHash(payload == null ? null : payload.getModelHash());
            response.setComputedModelHash(null);
            response.setTrainingDurationTrusted(false);
            response.setErrors(List.of("validator error: " + ex.getClass().getSimpleName()));
            response.setWarnings(List.of());
            return response;
        }
    }

    private ModelSubmission toSubmission(
            ModelSubmissionPayloadDTO payload,
            ModelSubmissionValidationResponseDTO validation,
            AppUser user,
            Integer trustedTrainingDurationMs) {
        ModelSubmission submission = new ModelSubmission();
        submission.setUser(user);

        if (payload != null) {
            submission.setArchitectureVersion(cleanText(
                    payload.getArchitectureVersion(), "missing-architecture", MAX_VERSION_LENGTH));
            submission.setMatchId(payload.getMatchId());
            submission.setFeatureSchemaVersion(cleanText(
                    payload.getFeatureSchemaVersion(), "missing-features", MAX_VERSION_LENGTH));
            submission.setActionSchemaVersion(cleanText(
                    payload.getActionSchemaVersion(), FALLBACK_ACTION_SCHEMA_VERSION, MAX_VERSION_LENGTH));
            submission.setTrainingSessionId(cleanNullableText(
                    payload.getTrainingSessionId(), MAX_TRAINING_SESSION_ID_LENGTH));
            submission.setTrainingDurationMs(cleanNonNegative(trustedTrainingDurationMs));
            submission.setTrainingSteps(cleanNonNegative(payload.getTrainingSteps()));
            submission.setSelectedClass(cleanNullableText(
                    payload.getSelectedClass(), MAX_SELECTED_CLASS_LENGTH));
            submission.setBaseModelArtifactId(cleanNullableText(
                    payload.getBaseModelArtifactId(), MAX_BASE_MODEL_ARTIFACT_ID_LENGTH));
            submission.setTrainingMetrics(toJson(payload.getTrainingMetrics(), "{}"));
            submission.setClientBuildVersion(cleanNullableText(
                    payload.getClientBuildVersion(), MAX_CLIENT_BUILD_VERSION_LENGTH));
            submission.setModelArtifacts(toJson(payload.getBrain() != null ? payload.getBrain() : payload.getModel(), "{}"));
        } else {
            submission.setArchitectureVersion("missing-payload");
            submission.setFeatureSchemaVersion("missing-payload");
            submission.setActionSchemaVersion(FALLBACK_ACTION_SCHEMA_VERSION);
            submission.setModelArtifacts("{}");
        }

        submission.setModelHash(cleanNullableText(validation.getComputedModelHash(), MAX_MODEL_HASH_LENGTH));
        submission.setStatus(validation.isAccepted()
                ? ModelSubmissionStatus.VALIDATED
                : ModelSubmissionStatus.REJECTED);
        return submission;
    }

    private void validateMatchBinding(
            ModelSubmissionPayloadDTO payload,
            AppUser user,
            ModelSubmissionValidationResponseDTO validation) {
        if (payload == null || "ERROR".equals(validation.getStatus())) {
            return;
        }

        UUID matchId = payload.getMatchId();
        if (matchId != null) {
            try {
                matchmakingService.requireActiveMatchForUser(user.getId(), matchId);
            } catch (AuthException ex) {
                rejectValidation(validation, "matchId is not active for this user");
                return;
            }
        }

        if (!hasText(payload.getTrainingSessionId())) {
            return;
        }

        UUID trainingSessionId;
        try {
            trainingSessionId = UUID.fromString(payload.getTrainingSessionId().trim());
        } catch (IllegalArgumentException ex) {
            return;
        }

        Optional<TrainingSession> session = trainingSessionRepository.findByIdAndUserId(trainingSessionId, user.getId());
        if (session.isEmpty()) {
            return;
        }

        UUID sessionMatchId = session.get().getMatchId();
        if (sessionMatchId != null && matchId == null) {
            rejectValidation(validation, "matchId is required for match training sessions");
            return;
        }
        if (matchId != null && !matchId.equals(sessionMatchId)) {
            rejectValidation(validation, "trainingSessionId is not assigned to this match");
        }
    }

    private Integer validateOwnedTrainingSession(
            ModelSubmissionPayloadDTO payload,
            AppUser user,
            ModelSubmissionValidationResponseDTO validation) {
        if (payload == null || "ERROR".equals(validation.getStatus()) || !hasText(payload.getTrainingSessionId())) {
            return null;
        }

        UUID trainingSessionId;
        try {
            trainingSessionId = UUID.fromString(payload.getTrainingSessionId().trim());
        } catch (IllegalArgumentException ex) {
            rejectValidation(validation, "trainingSessionId must be a server-issued UUID");
            return null;
        }

        Optional<TrainingSession> session = trainingSessionRepository.findByIdAndUserId(trainingSessionId, user.getId());
        if (session.isEmpty()) {
            rejectValidation(validation, "trainingSessionId was not found for this user");
            return null;
        }

        validation.setTrainingDurationTrusted(true);
        return clampToInteger(Math.max(
                0,
                Duration.between(session.get().getStartedAt(), Instant.now()).toMillis()));
    }

    private void rejectValidation(ModelSubmissionValidationResponseDTO validation, String error) {
        validation.setAccepted(false);
        validation.setStatus("REJECTED");
        validation.setMessage("Bot brain failed validation");

        List<String> errors = validation.getErrors() == null
                ? new ArrayList<>()
                : new ArrayList<>(validation.getErrors());
        if (!errors.contains(error)) {
            errors.add(error);
        }
        validation.setErrors(errors);
    }

    private void addWarning(ModelSubmissionValidationResponseDTO validation, String warning) {
        List<String> warnings = validation.getWarnings() == null
                ? new ArrayList<>()
                : new ArrayList<>(validation.getWarnings());
        if (!warnings.contains(warning)) {
            warnings.add(warning);
        }
        validation.setWarnings(warnings);
    }

    private Integer clampToInteger(long value) {
        return value > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) value;
    }

    private ValidationResult toValidationResult(
            ModelSubmission submission,
            ModelSubmissionValidationResponseDTO validation) {
        ValidationResult result = new ValidationResult();
        result.setModelSubmission(submission);
        result.setStatus(toValidationStatus(validation));
        result.setValidatorVersion(validation.getValidatorVersion());
        result.setRejectionCode(toRejectionCode(validation));

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("message", validation.getMessage());
        details.put("submittedModelHash", validation.getSubmittedModelHash());
        details.put("computedModelHash", validation.getComputedModelHash());
        details.put("trainingDurationTrusted", validation.isTrainingDurationTrusted());
        details.put("errors", validation.getErrors());
        details.put("warnings", validation.getWarnings());
        result.setDetails(toJson(details, "{}"));
        return result;
    }

    private ValidationStatus toValidationStatus(ModelSubmissionValidationResponseDTO validation) {
        if ("ERROR".equals(validation.getStatus())) {
            return ValidationStatus.ERROR;
        }

        return validation.isAccepted() ? ValidationStatus.ACCEPTED : ValidationStatus.REJECTED;
    }

    private String toRejectionCode(ModelSubmissionValidationResponseDTO validation) {
        if (validation.isAccepted()) {
            return null;
        }

        if ("ERROR".equals(validation.getStatus())) {
            return "MODEL_SUBMISSION_VALIDATION_ERROR";
        }

        return "MODEL_SUBMISSION_CONTRACT_FAILED";
    }

    private String toJson(Object value, String fallback) {
        if (value == null) {
            return fallback;
        }

        try {
            return jsonMapper.writeValueAsString(value);
        } catch (Exception ex) {
            return fallback;
        }
    }

    private String cleanText(String value, String fallback, int maxLength) {
        String cleaned = hasText(value) ? value : fallback;
        return truncate(cleaned, maxLength);
    }

    private String cleanNullableText(String value, int maxLength) {
        if (!hasText(value)) {
            return null;
        }

        return truncate(value, maxLength);
    }

    private String truncate(String value, int maxLength) {
        if (value.length() <= maxLength) {
            return value;
        }

        return value.substring(0, maxLength);
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private Integer cleanNonNegative(Integer value) {
        if (value == null || value < 0) {
            return null;
        }

        return value;
    }
}
