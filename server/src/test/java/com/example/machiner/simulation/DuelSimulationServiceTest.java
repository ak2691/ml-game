package com.example.machiner.simulation;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.machiner.DTO.MatchPlaybackDTO;
import com.example.machiner.simulation.DuelSimulationService.DuelArenaRequest;
import com.example.machiner.simulation.DuelSimulationService.DuelFighterRequest;
import com.example.machiner.simulation.DuelSimulationService.DuelSimulationRequest;
import com.example.machiner.simulation.DuelSimulationService.ObstacleRequest;
import com.example.machiner.simulation.classes.CombatClassRegistry;
import com.example.machiner.simulation.classes.MeleeClassSpec;
import com.example.machiner.simulation.classes.RangedClassSpec;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class DuelSimulationServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final DuelSimulationService service = new DuelSimulationService(
            new CombatClassRegistry(List.of(new MeleeClassSpec(), new RangedClassSpec())));
    private final JsonNode idleBrain = brain("[]");

    @Test
    void producesDrawWhenNeitherBrainChoosesWinningAction() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(200, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, idleBrain),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(result.result()).isEqualTo("DRAW");
        assertThat(result.winnerUserId()).isNull();
    }

    @Test
    void lowerPriorityNumberOverridesEarlierHigherNumberMovement() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"enemy_distance_gt","value":100}],"action":"move_outward"},
                          {"priority":5,"conditions":[{"type":"enemy_distance_gt","value":100}],"action":"move_inward"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x() - 100).isEqualTo(-4.0);
    }

    @Test
    void higherPriorityHpRuleStaysSelectedOverLowerPriorityDistanceEngage() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"my_hp_gt","value":50}],"action":"move_outward"},
                          {"priority":2,"conditions":[{"type":"enemy_distance_gt","value":10}],"action":"move_inward"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x() - 100).isEqualTo(-4.0);
    }

    @Test
    void expressionConditionsSelectBlocksFromStateVariables() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"target.distance",
                              "comparator":"gt",
                              "right":{"type":"variable","value":"my.hp"}
                            }],
                            "action":"move_inward"
                          }
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void expressionConditionsCompareBooleanVariables() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"my.dashReady",
                              "comparator":"eq",
                              "right":{"type":"boolean","value":true}
                            }],
                            "action":"dash"
                          }
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isGreaterThan(115);
    }

    @Test
    void samePriorityMoveAndDashBlocksCombineActionHeads() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":3,"conditions":[{"type":"enemy_distance_gt","value":100}],"action":"move_inward"},
                          {"priority":3,"conditions":[{"type":"enemy_distance_gt","value":100}],"action":"dash"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x() - 100).isEqualTo(20.0);
    }

    @Test
    void doNotDashSuppressesDashWithoutBlockingDashDirectionMovement() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"conditions":[{"type":"my_hp_gt","value":50}],"action":"no_dash"},
                          {"conditions":[{"type":"enemy_distance_gt","value":100}],"action":"dash"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x() - 100).isEqualTo(4.0);
    }

    @Test
    void clusterPriorityAndSharedConditionsSelectNestedBlocks() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of(new ObstacleRequest("object_1", "healthPack", 300.0, 400.0, 42))),
                fighter("fighter-1", "One", 1, 400, 400, brainWithClusters("""
                        [{"priority":5,"conditions":[{"type":"enemy_distance_gt","value":100}],"action":"move_inward"}]
                        """, """
                        [{
                          "priority":1,
                          "conditions":[{"type":"my_hp_lt","value":101}],
                          "blocks":[{
                            "conditions":[{"type":"target_health_pack","target":"object_1"}],
                            "action":"move_inward",
                            "actionTarget":"object_1"
                          }]
                        }]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isLessThan(400.0);
    }

    @Test
    void deterministicAttackRulesCanWinFight() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(6000, List.of()),
                fighter("attacker", "Attacker", 1, 360, 400, brain("""
                        [{"conditions":[{"type":"enemy_distance_lt","value":100}],"action":"swing"}]
                        """)),
                fighter("target", "Target", 2, 440, 400, idleBrain)));

        assertThat(result.result()).isEqualTo("FIGHTER_WIN");
        assertThat(result.winnerUserId()).isEqualTo(UUID.nameUUIDFromBytes("attacker".getBytes()));
    }

    @Test
    void rangedFireGunUsesFacingRayAndLinearFalloff() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"my_fire_gun_ready"}],"action":"fire_gun"}]
                        """)),
                fighter("target", "Target", 2, 300, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(87);
        assertThat(result.frames().getFirst().fighters().getFirst().attackActive()).isTrue();
    }

    @Test
    void rangedReplayTracerOnlyMarksShotFrames() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(1100, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"my_fire_gun_ready"}],"action":"fire_gun"}]
                        """)),
                fighter("target", "Target", 2, 300, 400, idleBrain)));

        assertThat(result.frames().get(0).fighters().getFirst().attackActive()).isTrue();
        assertThat(result.frames().get(1).fighters().getFirst().attackActive()).isFalse();
        assertThat(result.frames().get(11).fighters().getFirst().attackActive()).isTrue();
    }

    @Test
    void rangedGunUsesTenRoundMagazineAndThreeSecondReload() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(15_000, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"my_fire_gun_ready"}],"action":"fire_gun"}]
                        """)),
                fighter("target", "Target", 2, 900, 400, idleBrain)));

        List<MatchPlaybackDTO.ReplayFrameDTO> shotFrames = result.frames().stream()
                .filter(frame -> frame.fighters().getFirst().attackActive())
                .toList();
        MatchPlaybackDTO.ReplayFrameDTO emptyMagazineFrame = result.frames().stream()
                .filter(frame -> frame.fighters().getFirst().gunAmmo() == 0)
                .findFirst()
                .orElseThrow();
        MatchPlaybackDTO.ReplayFrameDTO firstPostReloadShot = shotFrames.stream()
                .filter(frame -> frame.elapsedMs() > emptyMagazineFrame.elapsedMs())
                .findFirst()
                .orElseThrow();

        assertThat(result.frames().getFirst().fighters().getFirst().gunAmmo()).isEqualTo(9);
        assertThat(emptyMagazineFrame.fighters().getFirst().gunReloadMs()).isGreaterThan(0);
        assertThat(firstPostReloadShot.elapsedMs() - emptyMagazineFrame.elapsedMs()).isGreaterThanOrEqualTo(3_000);
        assertThat(firstPostReloadShot.fighters().getFirst().gunAmmo()).isEqualTo(9);
    }

    @Test
    void fireGunIsGatedToRangedFighters() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("melee", "Melee", 1, 100, 400, "melee", brain("""
                        [{"conditions":[{"type":"enemy_distance_lt","value":700}],"action":"fire_gun"}]
                        """)),
                fighter("target", "Target", 2, 300, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(100);
        assertThat(result.frames().getFirst().fighters().getFirst().attackActive()).isFalse();
    }

    @Test
    void rangedGrenadeExplodesImmediatelyWhenItTouchesOpponent() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"my_grenade_ready"}],"action":"throw_grenade"}]
                        """)),
                fighter("target", "Target", 2, 190, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(50);
        assertThat(result.frames().getFirst().obstacles())
                .anyMatch(obstacle -> "grenadeExplosion".equals(obstacle.type()));
    }

    @Test
    void rangedGrenadeExplodesOneSecondAfterStoppingWithSteppedFalloff() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(3000, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"my_grenade_ready"}],"action":"throw_grenade"}]
                        """)),
                fighter("target", "Target", 2, 530, 400, idleBrain)));

        MatchPlaybackDTO.ReplayFrameDTO explosionFrame = result.frames().stream()
                .filter(frame -> frame.obstacles().stream().anyMatch(obstacle -> "grenadeExplosion".equals(obstacle.type())))
                .findFirst()
                .orElseThrow();
        assertThat(explosionFrame.fighters().get(1).hp()).isEqualTo(65);
    }

    @Test
    void opponentGrenadeCanBeUsedAsConditionAndMovementTarget() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(300, List.of()),
                fighter("melee", "Melee", 1, 100, 400, "melee", brain("""
                        [{
                          "conditions":[{"type":"target_exists","target":"opponent_grenade"}],
                          "action":"move_inward",
                          "actionTarget":"opponent_grenade"
                        }]
                        """)),
                fighter("ranged", "Ranged", 2, 700, 400, "ranged", brain("""
                        [{"conditions":[{"type":"my_grenade_ready"}],"action":"throw_grenade"}]
                        """))));

        assertThat(result.frames().get(1).fighters().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void grenadeIsGatedToRangedFighters() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("melee", "Melee", 1, 100, 400, "melee", brain("""
                        [{"conditions":[{"type":"always"}],"action":"throw_grenade"}]
                        """)),
                fighter("target", "Target", 2, 190, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(100);
        assertThat(result.frames().getFirst().obstacles())
                .noneMatch(obstacle -> "grenadeExplosion".equals(obstacle.type()));
    }

    @Test
    void dashIsGatedToMeleeFighters() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"enemy_distance_gt","value":100}],"action":"dash"}]
                        """)),
                fighter("target", "Target", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isEqualTo(100.0);
    }

    @Test
    void alwaysConditionCanMoveArenaRelativeDirection() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [{"conditions":[{"type":"always"}],"action":"move_north"}]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isEqualTo(100.0);
        assertThat(result.frames().getFirst().fighters().getFirst().y()).isEqualTo(396.0);
    }

    @Test
    void alwaysConditionCanDashArenaRelativeDirection() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [{"conditions":[{"type":"always"}],"action":"dash_north"}]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isEqualTo(100.0);
        assertThat(result.frames().getFirst().fighters().getFirst().y()).isEqualTo(380.0);
    }

    @Test
    void dashLeavesMeleeAtMaxMovementSpeedInDashDirection() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(1200, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [{"conditions":[{"type":"always"}],"action":"dash_north"}]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().get(9).fighters().getFirst().y()).isEqualTo(200.0);
        assertThat(result.frames().get(10).fighters().getFirst().y()).isEqualTo(188.0);
    }

    @Test
    void normalMovementAcceleratesAndMeleeCapsFasterThanRanged() {
        JsonNode moveBrain = brain("""
                [{"conditions":[{"type":"enemy_distance_gt","value":100}],"action":"move_inward"}]
                """);
        MatchPlaybackDTO meleeResult = service.simulate(request(
                arena(1500, List.of()),
                fighter("melee", "Melee", 1, 100, 400, "melee", moveBrain),
                fighter("target", "Target", 2, 700, 400, idleBrain)));
        MatchPlaybackDTO rangedResult = service.simulate(request(
                arena(1500, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", moveBrain),
                fighter("target", "Target", 2, 700, 400, idleBrain)));

        assertThat(meleeResult.frames().get(0).fighters().getFirst().x()).isEqualTo(104.0);
        assertThat(meleeResult.frames().get(1).fighters().getFirst().x()).isEqualTo(112.0);
        assertThat(meleeResult.frames().get(11).fighters().getFirst().x()).isEqualTo(232.0);
        assertThat(rangedResult.frames().get(11).fighters().getFirst().x()).isEqualTo(192.0);
        assertThat(meleeResult.frames().getLast().fighters().getFirst().x())
                .isGreaterThan(rangedResult.frames().getLast().fighters().getFirst().x());
    }

    @Test
    void oppositeMovementInputBrakesBeforeReversingDirection() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(500, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"my_edge_distance_gt","value":75}],"action":"move_west"},
                          {"priority":2,"conditions":[{"type":"always"}],"action":"move_east"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().get(0).fighters().getFirst().x()).isEqualTo(104.0);
        assertThat(result.frames().get(1).fighters().getFirst().x()).isEqualTo(112.0);
        assertThat(result.frames().get(2).fighters().getFirst().x()).isEqualTo(112.0);
        assertThat(result.frames().get(3).fighters().getFirst().x()).isEqualTo(108.0);
        assertThat(result.frames().get(4).fighters().getFirst().x()).isEqualTo(100.0);
    }

    @Test
    void releasedAxisDecaysByOneTickWhileOppositeAxisBrakesHarder() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(700, List.of()),
                fighter("fighter-1", "One", 1, 400, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"my_edge_distance_gt","value":360}],"action":"move_northeast"},
                          {"priority":2,"conditions":[{"type":"always"}],"action":"move_west"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        double previousXDelta = result.frames().get(4).fighters().getFirst().x()
                - result.frames().get(3).fighters().getFirst().x();
        double nextXDelta = result.frames().get(5).fighters().getFirst().x()
                - result.frames().get(4).fighters().getFirst().x();
        double previousYDelta = result.frames().get(4).fighters().getFirst().y()
                - result.frames().get(3).fighters().getFirst().y();
        double nextYDelta = result.frames().get(5).fighters().getFirst().y()
                - result.frames().get(4).fighters().getFirst().y();

        assertThat(Math.abs(previousXDelta - nextXDelta - 4.0)).isLessThan(0.01);
        assertThat(Math.abs(nextYDelta)).isLessThan(Math.abs(previousYDelta));
    }

    private DuelSimulationRequest request(
            DuelArenaRequest arena,
            DuelFighterRequest first,
            DuelFighterRequest second) {
        return new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("match".getBytes()),
                DuelSimulationService.DUEL_RULESET_VERSION,
                123L,
                arena,
                List.of(first, second));
    }

    private DuelArenaRequest arena(int durationMs, List<ObstacleRequest> obstacles) {
        return new DuelArenaRequest(800, 800, durationMs, obstacles);
    }

    private DuelFighterRequest fighter(String id, String username, int slot, double x, double y, JsonNode brain) {
        return fighter(id, username, slot, x, y, "melee", brain);
    }

    private DuelFighterRequest fighter(String id, String username, int slot, double x, double y, String selectedClass, JsonNode brain) {
        return new DuelFighterRequest(
                UUID.nameUUIDFromBytes(id.getBytes()),
                username,
                slot,
                x,
                y,
                slot == 1 ? 0.0 : 180.0,
                60,
                selectedClass,
                brain);
    }

    private JsonNode brain(String blocksJson) {
        return brainWithClusters(blocksJson, "[]");
    }

    private JsonNode brainWithClusters(String blocksJson, String clustersJson) {
        try {
            return jsonMapper.readTree("""
                    {
                      "version":"melee-logic-blocks-v2",
                      "blocks":%s,
                      "clusters":%s
                    }
                    """.formatted(blocksJson, clustersJson));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
