package com.example.machiner.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.machiner.DTO.ModelSubmissionPayloadDTO;
import com.example.machiner.simulation.classes.CombatClassRegistry;
import com.example.machiner.simulation.classes.MeleeClassSpec;
import com.example.machiner.simulation.classes.RangedClassSpec;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class ModelSubmissionValidationServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final ModelSubmissionValidationService service = new ModelSubmissionValidationService(
            jsonMapper,
            new CombatClassRegistry(List.of(new MeleeClassSpec(), new RangedClassSpec())));

    @Test
    void acceptsValidDeterministicBrainContract() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getStatus()).isEqualTo("ACCEPTED");
        assertThat(result.getComputedModelHash()).startsWith("sha256:");
        assertThat(result.getWarnings()).contains(
                "modelHash was not provided; server computed one from submitted brain",
                "trainingDurationMs will be computed from the server-owned training session");
    }

    @Test
    void acceptsEmptyLogicBlockList() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"melee-strategy-v1","blocks":[]}
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsClusteredLogicBlocksWithinLimit() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[],
                  "clusters":[
                    {
                      "id":"cluster-1",
                      "priority":4,
                      "conditions":[{"type":"my_hp_lt","value":50}],
                      "blocks":[
                        {"id":"block-1","priority":1,"action":"move_inward","conditions":[{"type":"target_health_pack","target":"object_1"}]}
                      ]
                    }
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsPositionAndBuffTimerExpressionConditions() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {
                      "id":"block-1",
                      "priority":1,
                      "action":"move_center",
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"my.x",
                          "comparator":"lt",
                          "right":{"type":"number","value":240}
                        },
                        {
                          "type":"expression",
                          "left":"opponent.y",
                          "comparator":"gte",
                          "right":{"type":"number","value":300}
                        },
                        {
                          "type":"expression",
                          "left":"my.overdriveMs",
                          "comparator":"gt",
                          "right":{"type":"number","value":2}
                        },
                        {
                          "type":"expression",
                          "left":"opponent.commandLockedMs",
                          "comparator":"lte",
                          "right":{"type":"number","value":1}
                        }
                      ]
                    }
                  ],
                  "clusters":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsExpressionConditionsWithVariableComparisons() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {
                      "id":"block-1",
                      "priority":1,
                      "action":"move_inward",
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"my.hp",
                          "comparator":"lt",
                          "right":{"type":"variable","value":"opponent.hp"}
                        },
                        {
                          "type":"expression",
                          "left":"my.x",
                          "comparator":"gte",
                          "right":{"type":"number","value":300}
                        },
                        {
                          "type":"expression",
                          "join":"or",
                          "left":"my.dashReady",
                          "comparator":"eq",
                          "right":{"type":"boolean","value":true}
                        }
                      ]
                    }
                  ],
                  "clusters":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void rejectsExpressionConditionsWithInvalidTypesForClass() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {
                      "id":"block-1",
                      "priority":1,
                      "action":"move_inward",
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"my.dashReady",
                          "comparator":"lt",
                          "right":{"type":"number","value":1}
                        }
                      ]
                    }
                  ],
                  "clusters":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.blocks[0].conditions[0].left is not allowed for ranged",
                "brain.blocks[0].conditions[0].comparator is not allowed for boolean variables",
                "brain.blocks[0].conditions[0].right.type is not allowed for boolean variables");
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
        assertThat(result.getErrors()).contains("featureSchemaVersion must be duel-logic-features-v1");
    }

    @Test
    void rejectsTrainingFieldsForDeterministicBrains() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setTrainingSteps(1);
        payload.setTrainingMetrics(jsonMapper.readTree("""
                {"trainingSamples":1,"epochsCompleted":1}
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "trainingSteps must be 0 for deterministic bot brains",
                "trainingMetrics.trainingSamples must be 0 for deterministic bot brains",
                "trainingMetrics.epochsCompleted must be 0 for deterministic bot brains");
    }

    @Test
    void rejectsRangedDashActionsAndOwnDashConditions() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"dash","conditions":[{"type":"my_dash_ready"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.blocks[0].action is not allowed for ranged",
                "brain.blocks[0].conditions[0].type is not allowed for ranged");
    }

    @Test
    void acceptsMeleeDashActionsAndOwnDashConditions() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("melee");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"dash","conditions":[{"type":"my_dash_ready"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsOpponentShieldConditionsForRangedBrains() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"move_outward","conditions":[{"type":"opponent_shield_up"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsRangedGrenadeActionAndRejectsItForMelee() throws Exception {
        ModelSubmissionPayloadDTO rangedPayload = validPayload();
        rangedPayload.setSelectedClass("ranged");
        rangedPayload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"throw_grenade","conditions":[{"type":"my_grenade_ready"}]}
                  ]
                }
                """));

        var rangedResult = service.validate(rangedPayload);

        assertThat(rangedResult.isAccepted()).isTrue();

        ModelSubmissionPayloadDTO meleePayload = validPayload();
        meleePayload.setSelectedClass("melee");
        meleePayload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"throw_grenade","conditions":[{"type":"my_grenade_ready"}]}
                  ]
                }
                """));

        var meleeResult = service.validate(meleePayload);

        assertThat(meleeResult.isAccepted()).isFalse();
        assertThat(meleeResult.getErrors()).contains(
                "brain.blocks[0].action is not allowed for melee",
                "brain.blocks[0].conditions[0].type is not allowed for melee");
    }

    @Test
    void acceptsAlwaysConditionAndArenaRelativeMovement() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"move_north","conditions":[{"type":"always"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsAlwaysConditionAndArenaRelativeDashForMelee() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("melee");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-blocks-v2",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"dash_north","conditions":[{"type":"always"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    private ModelSubmissionPayloadDTO validPayload() throws Exception {
        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setArchitectureVersion("deterministic-logic-v1");
        payload.setFeatureSchemaVersion("duel-logic-features-v1");
        payload.setActionSchemaVersion("melee-logic-actions-v1");
        payload.setModelFormat("logic-blocks-v1");
        payload.setTrainingSessionId("11111111-1111-1111-1111-111111111111");
        payload.setTrainingDurationMs(null);
        payload.setTrainingSteps(0);
        payload.setTrainingMetrics(jsonMapper.readTree("""
                {"version":"deterministic-logic-check-v1","trainingSamples":0,"epochsCompleted":0}
                """));
        payload.setSelectedClass("melee");

        JsonNode brain = jsonMapper.readTree("""
                {
                  "version": "melee-strategy-v1",
                  "blocks": [
                    {"id":"block-1","action":"move_inward","conditions":[]}
                  ]
                }
                """);
        payload.setBrain(brain);
        payload.setClientBuildVersion("test");
        return payload;
    }
}
