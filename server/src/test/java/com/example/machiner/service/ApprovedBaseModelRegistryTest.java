package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ApprovedBaseModelRegistryTest {

    private static final String MELEE_BASE_HASH =
            "sha256:9e259e2ef0a9dbff85e4df95a2e273b57febc188932668c528b0b7b864fe52e2";
    private final ApprovedBaseModelRegistry registry = new ApprovedBaseModelRegistry();

    @Test
    void recognizesOnlyTheVersionedApprovedBaseInAMatch() {
        ModelSubmissionPayloadDTO payload = approvedMeleePayload();

        assertThat(registry.isApprovedMatchBase(payload, MELEE_BASE_HASH)).isTrue();
        assertThat(registry.isApprovedMatchBase(payload, "sha256:trained-model")).isFalse();

        payload.setBaseModelArtifactId("unapproved-base");
        assertThat(registry.isApprovedMatchBase(payload, MELEE_BASE_HASH)).isFalse();
    }

    @Test
    void doesNotApplyTheBaseExceptionOutsideAMatch() {
        ModelSubmissionPayloadDTO payload = approvedMeleePayload();
        payload.setMatchId(null);

        assertThat(registry.isApprovedMatchBase(payload, MELEE_BASE_HASH)).isFalse();
    }

    private ModelSubmissionPayloadDTO approvedMeleePayload() {
        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setMatchId(UUID.randomUUID());
        payload.setSelectedClass("melee");
        payload.setBaseModelArtifactId("melee-base-v6");
        payload.setArchitectureVersion("melee-heads-v7");
        payload.setFeatureSchemaVersion("duel-intent-features-v6");
        payload.setActionSchemaVersion("melee-dash-actions-v3");
        return payload;
    }
}
