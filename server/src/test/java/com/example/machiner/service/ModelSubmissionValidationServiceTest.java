package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class ModelSubmissionValidationServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final ModelSubmissionValidationService service = new ModelSubmissionValidationService(jsonMapper);

    @Test
    void acceptsValidMovementModelContract() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getStatus()).isEqualTo("ACCEPTED");
        assertThat(result.getComputedModelHash()).startsWith("sha256:");
        assertThat(result.getWarnings()).contains(
                "modelHash was not provided; server computed one from submitted model",
                "trainingDurationMs will be computed from the server-owned training session");
    }

    @Test
    void acceptsValidMeleeModelContract() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setArchitectureVersion("melee-heads-v5");
        payload.setFeatureSchemaVersion("duel-logic-features-v4");
        payload.setActionSchemaVersion("melee-dash-actions-v3");
        payload.setSelectedClass("melee");

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsClientHashMismatchButWarnsThatServerHashIsAuthoritative() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setModelHash("sha256:tampered");

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getComputedModelHash()).isNotEqualTo(payload.getModelHash());
        assertThat(result.getWarnings()).contains(
                "submitted modelHash does not match server-computed hash; server hash is authoritative");
    }

    @Test
    void rejectsUnsupportedContractVersions() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setFeatureSchemaVersion("combat-features-v2");

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains("featureSchemaVersion is not supported");
    }

    @Test
    void rejectsTrainingThatExceedsTheRoundBudget() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setTrainingSteps(92_161);
        payload.setTrainingMetrics(jsonMapper.readTree("""
                {"trainingSamples":3073,"epochsCompleted":31}
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "trainingSteps exceeds the round training limit",
                "trainingMetrics.trainingSamples exceeds the round sample limit",
                "trainingMetrics.epochsCompleted exceeds the round epoch limit");
    }

    private ModelSubmissionPayloadDTO validPayload() throws Exception {
        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setArchitectureVersion("dense-movement-v1");
        payload.setFeatureSchemaVersion("arena-features-v1");
        payload.setActionSchemaVersion("movement-v1");
        payload.setModelFormat("tfjs-layers-v1");
        payload.setTrainingSessionId("11111111-1111-1111-1111-111111111111");
        payload.setTrainingDurationMs(null);
        payload.setTrainingSteps(3);
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
}
