package com.example.machiner.service;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import com.example.machiner.DTO.ModelSubmissionValidationResponseDTO;
import com.example.machiner.domain.AppUser;
import com.example.machiner.domain.ModelSubmission;
import com.example.machiner.domain.ModelSubmissionStatus;
import com.example.machiner.domain.ValidationResult;
import com.example.machiner.domain.ValidationStatus;
import com.example.machiner.repository.ModelSubmissionRepository;
import com.example.machiner.repository.ValidationResultRepository;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ModelSubmissionService {

    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TRAINING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_MODEL_HASH_LENGTH = 128;
    private static final String VALIDATOR_VERSION = "model-submission-stub-v1";

    private final ModelSubmissionValidationService validationService;
    private final ModelSubmissionRepository modelSubmissionRepository;
    private final ValidationResultRepository validationResultRepository;
    private final CurrentUserService currentUserService;
    private final JsonMapper jsonMapper;

    public ModelSubmissionService(
            ModelSubmissionValidationService validationService,
            ModelSubmissionRepository modelSubmissionRepository,
            ValidationResultRepository validationResultRepository,
            CurrentUserService currentUserService,
            JsonMapper jsonMapper) {
        this.validationService = validationService;
        this.modelSubmissionRepository = modelSubmissionRepository;
        this.validationResultRepository = validationResultRepository;
        this.currentUserService = currentUserService;
        this.jsonMapper = jsonMapper;
    }

    @Transactional
    public ModelSubmissionValidationResponseDTO submit(ModelSubmissionPayloadDTO payload, Authentication authentication) {
        ModelSubmissionValidationResponseDTO validation = validateSafely(payload);
        AppUser user = currentUserService.requireCurrentUser(authentication);
        ModelSubmission submission = toSubmission(payload, validation, user);

        ModelSubmission savedSubmission = modelSubmissionRepository.save(submission);
        validationResultRepository.save(toValidationResult(savedSubmission, validation));
        validation.setModelSubmissionId(savedSubmission.getId());

        return validation;
    }

    private ModelSubmissionValidationResponseDTO validateSafely(ModelSubmissionPayloadDTO payload) {
        try {
            return validationService.validate(payload);
        } catch (Exception ex) {
            ModelSubmissionValidationResponseDTO response = new ModelSubmissionValidationResponseDTO();
            response.setAccepted(false);
            response.setStatus("ERROR");
            response.setMessage("Model submission validation failed unexpectedly");
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
            AppUser user) {
        ModelSubmission submission = new ModelSubmission();
        submission.setUser(user);

        if (payload != null) {
            submission.setArchitectureVersion(cleanText(
                    payload.getArchitectureVersion(), "missing-architecture", MAX_VERSION_LENGTH));
            submission.setFeatureSchemaVersion(cleanText(
                    payload.getFeatureSchemaVersion(), "missing-features", MAX_VERSION_LENGTH));
            submission.setActionSchemaVersion(cleanText(
                    payload.getActionSchemaVersion(), "movement-v1", MAX_VERSION_LENGTH));
            submission.setTrainingSessionId(cleanNullableText(
                    payload.getTrainingSessionId(), MAX_TRAINING_SESSION_ID_LENGTH));
            submission.setTrainingDurationMs(cleanNonNegative(payload.getTrainingDurationMs()));
            submission.setTrainingSteps(cleanNonNegative(payload.getTrainingSteps()));
            submission.setRewardEvents(toJson(payload.getRewardEvents(), "{}"));
            submission.setClientBuildVersion(cleanNullableText(
                    payload.getClientBuildVersion(), MAX_CLIENT_BUILD_VERSION_LENGTH));
            submission.setModelArtifacts(toJson(payload.getModel(), "{}"));
        } else {
            submission.setArchitectureVersion("missing-payload");
            submission.setFeatureSchemaVersion("missing-payload");
            submission.setActionSchemaVersion("movement-v1");
            submission.setModelArtifacts("{}");
        }

        submission.setModelHash(cleanNullableText(validation.getComputedModelHash(), MAX_MODEL_HASH_LENGTH));
        submission.setStatus(validation.isAccepted()
                ? ModelSubmissionStatus.VALIDATED
                : ModelSubmissionStatus.REJECTED);
        return submission;
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
