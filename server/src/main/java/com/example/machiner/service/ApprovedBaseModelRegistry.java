package com.example.machiner.service;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ApprovedBaseModelRegistry {

    // Hashes use ModelSubmissionValidationService's canonical submitted-model hash.
    // Update this entry whenever the corresponding approved frontend artifact changes.
    private static final Map<String, ApprovedBaseModel> APPROVED_BASES = Map.of(
            "melee",
            new ApprovedBaseModel(
                    "melee-base-v6",
                    "melee-heads-v7",
                    "duel-intent-features-v6",
                    "melee-dash-actions-v3",
                    "sha256:9e259e2ef0a9dbff85e4df95a2e273b57febc188932668c528b0b7b864fe52e2"));

    public boolean isApprovedMatchBase(ModelSubmissionPayloadDTO payload, String computedModelHash) {
        if (payload == null || payload.getMatchId() == null || computedModelHash == null) {
            return false;
        }

        ApprovedBaseModel approved = APPROVED_BASES.get(payload.getSelectedClass());
        return approved != null
                && approved.artifactId().equals(payload.getBaseModelArtifactId())
                && approved.architectureVersion().equals(payload.getArchitectureVersion())
                && approved.featureSchemaVersion().equals(payload.getFeatureSchemaVersion())
                && approved.actionSchemaVersion().equals(payload.getActionSchemaVersion())
                && approved.modelHash().equals(computedModelHash);
    }

    private record ApprovedBaseModel(
            String artifactId,
            String architectureVersion,
            String featureSchemaVersion,
            String actionSchemaVersion,
            String modelHash) {
    }
}
