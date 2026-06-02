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
                "trainingDurationMs is not trusted yet because server-owned sessions are not implemented");
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
        assertThat(result.getErrors()).contains("featureSchemaVersion must be arena-features-v1");
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
}
