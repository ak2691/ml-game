package com.example.machiner.simulation;

import com.example.machiner.DTO.MatchPlaybackDTO;
import com.example.machiner.simulation.classes.CombatClassRegistry;
import com.example.machiner.simulation.classes.CombatClassSpec;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class DuelSimulationService {

    public static final String DUEL_RULESET_VERSION = "duel-v1";

    private static final int CANVAS_SIZE = 800;
    private static final int STEP_MS = 100;
    private static final double MOVE_ACCELERATION_PER_TICK = 4.0;
    private static final double MOVE_BRAKE_ACCELERATION_PER_TICK = 8.0;
    private static final double TURN_SPEED_DEGREES = 18.0;
    private static final int HEALTH_PACK_SIZE = 42;
    private static final int HEALTH_PACK_HEAL = 50;
    private static final String OVERDRIVE_TYPE = "overdrive";
    private static final String BARRIER_TYPE = "barrier";
    private static final String INHIBITION_TYPE = "inhibition";
    private static final String RADAR_JAMMER_TYPE = "radarJammer";
    private static final String COMMAND_LOCK_TYPE = "commandLock";
    private static final int BUFF_PICKUP_SIZE = 76;
    private static final int CENTER_OBJECTIVE_SIZE = 92;
    private static final int CENTER_OBJECTIVE_CAPTURE_MS = 5_000;
    private static final int CENTER_EFFECT_DURATION_MS = 5_000;
    private static final int KILLABLE_BUFF_HP = 50;
    private static final int BUFF_DURATION_MS = 5_000;
    private static final int BARRIER_SHIELD_HP = 25;
    private static final int INHIBITION_ATTACK_CHARGES = 3;
    private static final int INHIBITION_SLOW_MS = 2_000;
    private static final double INHIBITION_SPEED_MULTIPLIER = 0.6;
    private static final int DAMAGE_ZONE_SIZE = 128;
    private static final String PROJECTILE_WALL_TYPE = "projectileWall";
    private static final String BOUNCY_WALL_TYPE = "bouncyWall";
    private static final int PROJECTILE_WALL_LENGTH = 120;
    private static final double PROJECTILE_WALL_THICKNESS = 8.0;
    private static final int BOUNCY_WALL_MAX_USES = 10;
    private static final int DAMAGE_ZONE_ENTRY_DAMAGE = 25;
    private static final double DAMAGE_ZONE_DAMAGE_MULTIPLIER = 1.5;
    private static final int ATTACK_COOLDOWN_MS = 1000;
    private static final int ATTACK_ACTIVE_MS = 200;
    private static final int GRENADE_SIZE = 12;
    private static final double GRENADE_THROW_SPEED = 32.0;
    private static final double GRENADE_DECELERATION_PER_TICK = 1.6;
    private static final int GRENADE_STOP_FUSE_MS = 1_000;
    private static final int GRENADE_EXPLOSION_RADIUS = 50;
    private static final int GRENADE_EXPLOSION_VISIBLE_MS = 200;
    private static final int FIREBALL_SIZE = 30;
    private static final double FIREBALL_SPEED = 36.0;
    private static final int DASH_DURATION_MS = 1000;
    private static final double DASH_SPEED = 20.0;
    private static final int MAX_PLAYER_OBJECT_SLOTS = 6;
    private static final int CENTER_OBJECT_COUNT = 3;
    private static final int MAX_ARENA_OBJECTS = CENTER_OBJECT_COUNT + MAX_PLAYER_OBJECT_SLOTS;
    private static final int MAX_LOGIC_BLOCKS = 50;
    private static final int MAX_CLUSTERS = 12;
    private static final int MAX_CONDITIONS_PER_BLOCK = 4;
    private static final int MIN_PRIORITY = 1;
    private static final int MAX_PRIORITY = 10;
    private static final Pattern OBJECT_TARGET = Pattern.compile("object_([1-6]|center|buff_[12])");

    private final CombatClassRegistry combatClasses;

    public DuelSimulationService(CombatClassRegistry combatClasses) {
        this.combatClasses = combatClasses;
    }

    public List<MatchPlaybackDTO.ObstaclePlacementDTO> createMatchObstaclePlacements(
            long seed,
            int arenaWidth,
            int arenaHeight,
            List<DuelFighterRequest> fighterRequests) {
        Arena arena = new Arena(arenaWidth, arenaHeight, 30_000);
        return createCenterObstacles(new SeededRandom(seed + ":center-obstacles"), arena).stream()
                .map(DuelSimulationService::toObstaclePlacement)
                .toList();
    }

    public MatchPlaybackDTO simulate(DuelSimulationRequest request) {
        if (request == null || !DUEL_RULESET_VERSION.equals(request.rulesetVersion())) {
            throw new IllegalArgumentException("rulesetVersion must be duel-v1");
        }
        if (request.fighters() == null || request.fighters().size() != 2) {
            throw new IllegalArgumentException("duel-v1 requires exactly two fighters");
        }

        Arena arena = new Arena(
                request.arena() != null ? request.arena().width() : CANVAS_SIZE,
                request.arena() != null ? request.arena().height() : CANVAS_SIZE,
                request.arena() != null ? request.arena().durationMs() : 30_000);

        List<Fighter> fighters = request.fighters().stream()
                .map(this::fighterFromRequest)
                .toList();
        List<Obstacle> obstacles = request.arena() != null && request.arena().obstacles() != null
                ? normalizeRequestObstacles(request.arena().obstacles(), arena)
                : createCenterObstacles(new SeededRandom((request.seed()) + ":center-obstacles"), arena);

        MatchPlaybackDTO.ArenaStateDTO initialState = new MatchPlaybackDTO.ArenaStateDTO(
                arena.width(),
                arena.height(),
                fighters.stream().map(DuelSimulationService::toPlacement).toList(),
                obstacles.stream().map(DuelSimulationService::toObstaclePlacement).toList());
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = new ArrayList<>();
        List<Grenade> grenades = new ArrayList<>();
        List<Fireball> fireballs = new ArrayList<>();

        for (int elapsedMs = 0, tick = 0; elapsedMs <= arena.durationMs(); elapsedMs += STEP_MS, tick += 1) {
            Action firstPredicted = predictAction(fighters.get(0), fighters.get(1), obstacles, grenades, fireballs);
            Action secondPredicted = predictAction(fighters.get(1), fighters.get(0), obstacles, grenades, fireballs);
            Action firstAction = commandLockedAction(fighters.get(0), firstPredicted);
            Action secondAction = commandLockedAction(fighters.get(1), secondPredicted);
            boolean firstSwung = applyAction(fighters.get(0), firstAction, arena);
            boolean secondSwung = applyAction(fighters.get(1), secondAction, arena);
            fighters.stream()
                    .map(fighter -> fighter.thrownGrenade)
                    .filter(grenade -> grenade != null)
                    .forEach(grenades::add);
            fighters.stream()
                    .map(fighter -> fighter.thrownFireball)
                    .filter(fireball -> fireball != null)
                    .forEach(fireballs::add);
            obstacles = applyObstacleEffects(fighters, obstacles, firstAction, secondAction);
            GrenadeUpdate grenadeUpdate = updateGrenades(grenades, fighters, obstacles, arena);
            grenades = grenadeUpdate.grenades();
            obstacles = grenadeUpdate.obstacles();
            FireballUpdate fireballUpdate = updateFireballs(fireballs, fighters, obstacles, arena);
            fireballs = fireballUpdate.fireballs();
            obstacles = fireballUpdate.obstacles();

            boolean firstBlocked = firstSwung
                    && attackHits(fighters.get(0), fighters.get(1))
                    && blocksAttack(fighters.get(1), fighters.get(0));
            boolean secondBlocked = secondSwung
                    && attackHits(fighters.get(1), fighters.get(0))
                    && blocksAttack(fighters.get(0), fighters.get(1));
            boolean firstLanded = firstSwung
                    && attackHits(fighters.get(0), fighters.get(1))
                    && !firstBlocked;
            boolean secondLanded = secondSwung
                    && attackHits(fighters.get(1), fighters.get(0))
                    && !secondBlocked;
            if (firstLanded) {
                applyDamage(fighters.get(1), incomingAttackDamage(fighters.get(0), fighters.get(1)));
                applyInhibitionOnHit(fighters.get(0), fighters.get(1));
            }
            if (secondLanded) {
                applyDamage(fighters.get(0), incomingAttackDamage(fighters.get(1), fighters.get(0)));
                applyInhibitionOnHit(fighters.get(1), fighters.get(0));
            }
            if (firstBlocked) consumeBlockCharges(fighters.get(1), 1);
            if (secondBlocked) consumeBlockCharges(fighters.get(0), 1);

            GunReflection firstGunReflection = reflectGunShot(fighters.get(0), fighters, obstacles);
            obstacles = firstGunReflection.obstacles();
            GunReflection secondGunReflection = reflectGunShot(fighters.get(1), fighters, obstacles);
            obstacles = secondGunReflection.obstacles();
            applyGunReflectionDamage(fighters.get(0), firstGunReflection, fighters);
            applyGunReflectionDamage(fighters.get(1), secondGunReflection, fighters);
            boolean firstGunBlocked = !firstGunReflection.reflected()
                    && gunHits(fighters.get(0), fighters.get(1), obstacles)
                    && blocksAttack(fighters.get(1), fighters.get(0));
            boolean secondGunBlocked = !secondGunReflection.reflected()
                    && gunHits(fighters.get(1), fighters.get(0), obstacles)
                    && blocksAttack(fighters.get(0), fighters.get(1));
            boolean firstGunLanded = !firstGunReflection.reflected()
                    && gunHits(fighters.get(0), fighters.get(1), obstacles)
                    && !firstGunBlocked;
            boolean secondGunLanded = !secondGunReflection.reflected()
                    && gunHits(fighters.get(1), fighters.get(0), obstacles)
                    && !secondGunBlocked;
            if (firstGunLanded) {
                applyDamage(fighters.get(1), incomingGunDamage(fighters.get(0), fighters.get(1)));
                applyInhibitionOnHit(fighters.get(0), fighters.get(1));
            }
            if (secondGunLanded) {
                applyDamage(fighters.get(0), incomingGunDamage(fighters.get(1), fighters.get(0)));
                applyInhibitionOnHit(fighters.get(1), fighters.get(0));
            }
            if (firstGunBlocked) consumeBlockCharges(fighters.get(1), 1);
            if (secondGunBlocked) consumeBlockCharges(fighters.get(0), 1);
            boolean firstStunBlocked = stunHits(fighters.get(0), fighters.get(1))
                    && blocksAttack(fighters.get(1), fighters.get(0));
            boolean secondStunBlocked = stunHits(fighters.get(1), fighters.get(0))
                    && blocksAttack(fighters.get(0), fighters.get(1));
            boolean firstStunLanded = stunHits(fighters.get(0), fighters.get(1))
                    && !firstStunBlocked;
            boolean secondStunLanded = stunHits(fighters.get(1), fighters.get(0))
                    && !secondStunBlocked;
            if (firstStunLanded) applyStun(fighters.get(0), fighters.get(1));
            if (secondStunLanded) applyStun(fighters.get(1), fighters.get(0));
            if (firstStunBlocked) consumeBlockCharges(fighters.get(1), 1);
            if (secondStunBlocked) consumeBlockCharges(fighters.get(0), 1);
            applyGrenadeExplosions(fighters, grenadeUpdate.explosions());
            applyFireballHits(fighters, fireballUpdate.hits());
            obstacles = applyGrenadeBuffDamage(obstacles, fighters, grenadeUpdate.explosions());
            obstacles = applyKillableBuffDamage(obstacles, fighters.get(0), firstSwung, fighters.get(0).gunShotActive);
            obstacles = applyKillableBuffDamage(obstacles, fighters.get(1), secondSwung, fighters.get(1).gunShotActive);
            applyBurnDamage(fighters);

            List<MatchPlaybackDTO.ObstaclePlacementDTO> frameObstacles = new ArrayList<>();
            frameObstacles.addAll(obstacles.stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(grenades.stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(grenadeUpdate.explosions().stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(fireballs.stream().map(DuelSimulationService::toObstaclePlacement).toList());

            frames.add(new MatchPlaybackDTO.ReplayFrameDTO(
                    tick,
                    elapsedMs,
                    fighters.stream().map(DuelSimulationService::toPlacement).toList(),
                    frameObstacles));

            if (fighters.stream().anyMatch(fighter -> fighter.hp <= 0)) {
                List<Fighter> survivors = fighters.stream().filter(fighter -> fighter.hp > 0).toList();
                return duelResult(request.matchId(), initialState, frames, survivors.size() == 1 ? survivors.get(0) : null);
            }
        }

        return duelResult(request.matchId(), initialState, frames, null);
    }

    private Fighter fighterFromRequest(DuelFighterRequest request) {
        Fighter fighter = new Fighter();
        fighter.userId = request.userId();
        fighter.username = request.username();
        fighter.slot = request.slot();
        fighter.x = request.x();
        fighter.y = request.y();
        fighter.rotation = request.rotation() != null ? request.rotation() : request.slot() == 1 ? 0.0 : 180.0;
        fighter.size = request.size();
        fighter.brain = request.brain();
        fighter.combatClass = hasText(request.selectedClass()) ? request.selectedClass() : "melee";
        fighter.hp = classSpec(fighter).maxHp();
        fighter.blockCharges = classSpec(fighter).blockMaxCharges();
        fighter.blockRechargeMs = 0;
        fighter.dashCharges = classSpec(fighter).dashMaxCharges();
        fighter.dashRechargeMs = 0;
        fighter.gunAmmo = classSpec(fighter).gunAmmoMax();
        fighter.gunReloadMs = 0;
        fighter.fireballCharges = classSpec(fighter).fireballChargesMax();
        fighter.fireballReloadMs = 0;
        return fighter;
    }

    private CombatClassSpec classSpec(Fighter fighter) {
        return combatClasses.forId(fighter.combatClass);
    }

    private static MatchPlaybackDTO duelResult(
            UUID matchId,
            MatchPlaybackDTO.ArenaStateDTO initialState,
            List<MatchPlaybackDTO.ReplayFrameDTO> frames,
            Fighter winner) {
        return new MatchPlaybackDTO(
                matchId,
                DUEL_RULESET_VERSION,
                "COMPLETED",
                initialState,
                frames,
                winner != null ? "FIGHTER_WIN" : "DRAW",
                winner != null ? winner.userId : null,
                winner != null ? winner.username + " wins the fight." : "The fight ended in a draw.");
    }

    private Action predictAction(Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        ActionPlan plan = selectStrategyActionPlan(player.brain, player, opponent, obstacles, grenades, fireballs);
        boolean canDash = classSpec(player).canDash();
        StrategyBlock movementBlock = plan.movement != null ? plan.movement : canDash ? plan.dashMovement : null;
        StrategyBlock facingBlock = firstNonNull(plan.rotation, plan.swing, plan.block, plan.grenade, plan.fireball, plan.stun);
        Entity movementTarget = targetEntity(movementBlock != null ? movementBlock.actionTarget : "opponent", player, opponent, obstacles, grenades, fireballs);
        Entity facingTarget = targetEntity(facingBlock != null
                ? facingBlock.actionTarget
                : movementBlock != null ? movementBlock.actionTarget : "opponent", player, opponent, obstacles, grenades, fireballs);
        Vector movement = movementVectorForAction(movementBlock != null ? movementBlock.action : "move_stop", player, movementTarget);
        String turnAction = facingBlock != null ? facingBlock.action : "move_stop";
        boolean shouldTurn = "rotate_toward_enemy".equals(turnAction)
                || "swing".equals(turnAction)
                || "block".equals(turnAction)
                || "throw_grenade".equals(turnAction)
                || "shoot_fireball".equals(turnAction)
                || "stun".equals(turnAction);
        return new Action(
                movement.dx(),
                movement.dy(),
                shouldTurn ? turnTowardTarget(player, facingTarget) : 0.0,
                plan.swing != null && "swing".equals(plan.swing.action) ? 1.0 : 0.0,
                plan.block != null && "block".equals(plan.block.action) ? 1.0 : 0.0,
                plan.gun != null && "fire_gun".equals(plan.gun.action) ? 1.0 : 0.0,
                plan.grenade != null && "throw_grenade".equals(plan.grenade.action) ? 1.0 : 0.0,
                plan.fireball != null && "shoot_fireball".equals(plan.fireball.action) ? 1.0 : 0.0,
                plan.stun != null && "stun".equals(plan.stun.action) ? 1.0 : 0.0,
                canDash && plan.dash != null && plan.dash.action.startsWith("dash") ? 1.0 : 0.0);
    }

    private static Action commandLockedAction(Fighter fighter, Action predicted) {
        if (fighter.commandLockedMs <= 0 || fighter.commandLockAction == null) return predicted;
        Action locked = fighter.commandLockAction;
        boolean dashNow = predicted.dash() > 0.5;
        return new Action(
                dashNow ? predicted.dx() : locked.dx(),
                dashNow ? predicted.dy() : locked.dy(),
                locked.dRot(),
                locked.swing(),
                predicted.block(),
                locked.gun(),
                predicted.grenade(),
                locked.fireball(),
                predicted.stun(),
                predicted.dash());
    }

    private ActionPlan selectStrategyActionPlan(JsonNode strategy, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        List<PriorityEntry> selected = selectPriorityEntries(strategy, player, opponent, obstacles, grenades, fireballs);
        ActionPlan plan = new ActionPlan();
        plan.primary = selected.stream()
                .map(PriorityEntry::block)
                .filter(block -> !"no_dash".equals(block.action))
                .findFirst()
                .orElse(null);
        for (PriorityEntry entry : selected) {
            StrategyBlock block = entry.block();
            String head = actionHead(block.action);
            if (block.action.startsWith("dash") && plan.dashMovement == null) plan.dashMovement = block;
            switch (head) {
                case "rotation" -> {
                    if (plan.rotation == null) plan.rotation = block;
                }
                case "swing" -> {
                    if (plan.swing == null) plan.swing = block;
                }
                case "block" -> {
                    if (plan.block == null) plan.block = block;
                }
                case "gun" -> {
                    if (plan.gun == null) plan.gun = block;
                }
                case "grenade" -> {
                    if (plan.grenade == null) plan.grenade = block;
                }
                case "fireball" -> {
                    if (plan.fireball == null) plan.fireball = block;
                }
                case "stun" -> {
                    if (plan.stun == null) plan.stun = block;
                }
                case "dash" -> {
                    if ("no_dash".equals(block.action) || plan.dash == null) plan.dash = block;
                }
                default -> {
                    if (plan.movement == null) plan.movement = block;
                }
            }
        }
        return plan;
    }

    private List<PriorityEntry> selectPriorityEntries(JsonNode strategy, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        List<PriorityEntry> matching = normalizeStrategyEntries(strategy).stream()
                .filter(entry -> !entryUsesHiddenTarget(entry, player)
                        && evaluateConditions(entry.clusterConditions(), player, opponent, obstacles, grenades, fireballs)
                        && evaluateConditions(entry.block().conditions(), player, opponent, obstacles, grenades, fireballs))
                .sorted(DuelSimulationService::comparePriorityEntries)
                .toList();
        if (matching.isEmpty()) return List.of();
        PriorityEntry winner = matching.get(0);
        return matching.stream()
                .filter(entry -> entry.clusterPriority() == winner.clusterPriority()
                        && entry.block().priority == winner.block().priority)
                .toList();
    }

    private static boolean entryUsesHiddenTarget(PriorityEntry entry, Fighter player) {
        if (player.jammedMs <= 0) return false;
        return actionUsesTarget(entry.block().action())
                || entry.clusterConditions().stream().anyMatch(DuelSimulationService::conditionUsesTarget)
                || entry.block().conditions().stream().anyMatch(DuelSimulationService::conditionUsesTarget);
    }

    private static boolean actionUsesTarget(String action) {
        return switch (action) {
            case "move_inward", "move_outward", "move_tangent_left", "move_tangent_right",
                    "move_diagonal_in_left", "move_diagonal_in_right", "move_diagonal_out_left",
                    "move_diagonal_out_right", "move_center", "rotate_toward_enemy",
                    "dash", "dash_outward", "dash_tangent_left", "dash_tangent_right",
                    "dash_diagonal_in_left", "dash_diagonal_in_right", "dash_diagonal_out_left",
                    "dash_diagonal_out_right" -> true;
            default -> false;
        };
    }

    private static boolean conditionUsesTarget(Condition condition) {
        if ("expression".equals(condition.type())) {
            return variableUsesHiddenTarget(condition.left())
                    || (condition.right() != null
                    && "variable".equals(condition.right().type())
                    && variableUsesHiddenTarget(condition.right().valueText()));
        }
        return condition.type().startsWith("enemy_")
                || condition.type().startsWith("opponent_")
                || condition.type().startsWith("target_");
    }

    private static boolean variableUsesHiddenTarget(String variableId) {
        return variableId != null
                && (variableId.startsWith("opponent.") || variableId.startsWith("target."));
    }

    private static List<PriorityEntry> normalizeStrategyEntries(JsonNode strategy) {
        if (strategy == null || !strategy.isObject()) return List.of();
        List<PriorityEntry> entries = new ArrayList<>();
        int remainingBlocks = MAX_LOGIC_BLOCKS;
        JsonNode sourceBlocks = strategy.get("blocks");
        if (sourceBlocks != null && sourceBlocks.isArray()) {
            int blockLimit = Math.min(sourceBlocks.size(), remainingBlocks);
            for (int index = 0; index < blockLimit; index += 1) {
                entries.add(new PriorityEntry(
                        normalizeStrategyBlock(sourceBlocks.get(index), index),
                        index,
                        -1,
                        1,
                        List.of()));
            }
            remainingBlocks -= blockLimit;
        }

        JsonNode sourceClusters = strategy.get("clusters");
        if (sourceClusters != null && sourceClusters.isArray()) {
            int clusterLimit = Math.min(sourceClusters.size(), MAX_CLUSTERS);
            for (int clusterIndex = 0; clusterIndex < clusterLimit && remainingBlocks > 0; clusterIndex += 1) {
                JsonNode cluster = sourceClusters.get(clusterIndex);
                if (cluster == null || !cluster.isObject()) continue;
                List<Condition> clusterConditions = normalizeConditions(cluster.get("conditions"));
                JsonNode clusterBlocks = cluster.get("blocks");
                if (clusterBlocks == null || !clusterBlocks.isArray()) continue;
                int blockLimit = Math.min(clusterBlocks.size(), remainingBlocks);
                for (int blockIndex = 0; blockIndex < blockLimit; blockIndex += 1) {
                    entries.add(new PriorityEntry(
                            normalizeStrategyBlock(clusterBlocks.get(blockIndex), blockIndex),
                            blockIndex,
                            clusterIndex,
                            normalizePriority(numberValue(cluster.get("priority"), 1.0)),
                            clusterConditions));
                }
                remainingBlocks -= blockLimit;
            }
        }
        return entries;
    }

    private static StrategyBlock normalizeStrategyBlock(JsonNode block, int index) {
        return new StrategyBlock(
                index,
                textValue(field(block, "action"), "move_stop"),
                normalizeTarget(textValue(field(block, "actionTarget"), "opponent"), "opponent"),
                normalizePriority(numberValue(field(block, "priority"), 1.0)),
                normalizeConditions(field(block, "conditions")));
    }

    private static List<Condition> normalizeConditions(JsonNode conditions) {
        if (conditions == null || !conditions.isArray()) return List.of();
        List<Condition> normalized = new ArrayList<>();
        int limit = Math.min(conditions.size(), MAX_CONDITIONS_PER_BLOCK);
        for (int index = 0; index < limit; index += 1) {
            JsonNode condition = conditions.get(index);
            normalized.add(new Condition(
                    textValue(field(condition, "type"), ""),
                    numberValue(field(condition, "value"), 0.0),
                    normalizeTarget(textValue(field(condition, "target"), "opponent"), "opponent"),
                    textValue(field(condition, "left"), ""),
                    textValue(field(condition, "comparator"), "lt"),
                    normalizeOperand(field(condition, "right")),
                    index > 0 && "or".equals(textValue(field(condition, "join"), "and")) ? "or" : "and"));
        }
        return normalized;
    }

    private boolean evaluateConditions(List<Condition> conditions, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        boolean matches = true;
        for (int index = 0; index < conditions.size(); index += 1) {
            Condition condition = conditions.get(index);
            boolean conditionMatches = evaluateCondition(condition, player, opponent, obstacles, grenades, fireballs);
            matches = index > 0 && "or".equals(condition.join())
                    ? matches || conditionMatches
                    : matches && conditionMatches;
        }
        return matches;
    }

    private boolean evaluateCondition(Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        if ("expression".equals(condition.type())) {
            return evaluateExpressionCondition(condition, player, opponent, obstacles, grenades, fireballs);
        }
        Entity target = targetEntity(condition.target(), player, opponent, obstacles, grenades, fireballs);
        double distance = target != null ? Math.hypot(target.x() - player.x, target.y() - player.y) : Double.POSITIVE_INFINITY;
        return switch (condition.type()) {
            case "always" -> true;
            case "enemy_distance_lt" -> distance < condition.value();
            case "enemy_distance_gt" -> distance > condition.value();
            case "opponent_object_distance_lt" -> target instanceof Obstacle
                    && Math.hypot(target.x() - opponent.x, target.y() - opponent.y) < condition.value();
            case "opponent_object_distance_gt" -> target instanceof Obstacle
                    && Math.hypot(target.x() - opponent.x, target.y() - opponent.y) > condition.value();
            case "my_edge_distance_lt", "my_cornered" -> edgeDistancePixels(player) < condition.value();
            case "my_edge_distance_gt" -> edgeDistancePixels(player) > condition.value();
            case "target_edge_distance_lt", "enemy_cornered" -> target != null && edgeDistancePixels(target) < condition.value();
            case "target_edge_distance_gt" -> target != null && edgeDistancePixels(target) > condition.value();
            case "enemy_attacking" -> opponent.attackActiveMs > 0;
            case "enemy_blocking" -> opponent.blockActive;
            case "enemy_rushing" -> radialVelocityTowardPlayer(player, opponent) > 20;
            case "enemy_fleeing" -> radialVelocityTowardPlayer(player, opponent) < -20;
            case "my_hp_lt" -> player.hp < condition.value();
            case "my_hp_gt" -> player.hp > condition.value();
            case "enemy_hp_lt" -> opponent.hp < condition.value();
            case "enemy_hp_gt" -> opponent.hp > condition.value();
            case "my_jammed" -> player.jammedMs > 0;
            case "my_command_locked" -> player.commandLockedMs > 0;
            case "opponent_jammed" -> opponent.jammedMs > 0;
            case "opponent_command_locked" -> opponent.commandLockedMs > 0;
            case "my_swing_ready" -> player.attackCooldownMs <= 0;
            case "my_swing_cooldown" -> player.attackCooldownMs > 0;
            case "my_block_ready" -> player.blockCharges > 0;
            case "my_block_cooldown" -> player.blockCharges <= 0;
            case "my_shield_up" -> player.blockActive;
            case "my_shield_down" -> !player.blockActive;
            case "my_shield_charges_lt" -> player.blockCharges < condition.value();
            case "my_shield_charges_gt" -> player.blockCharges > condition.value();
            case "my_dash_ready" -> canDash(player) && player.dashCharges > 0 && player.dashActiveMs <= 0;
            case "my_dash_cooldown" -> canDash(player) && (player.dashCharges <= 0 || player.dashActiveMs > 0);
            case "my_dash_charges_lt" -> canDash(player) && player.dashCharges < condition.value();
            case "my_dash_charges_gt" -> canDash(player) && player.dashCharges > condition.value();
            case "my_fire_gun_ready" -> "ranged".equals(player.combatClass)
                    && player.gunAmmo > 0 && player.gunReloadMs <= 0
                    && player.gunCooldownMs <= 0 && player.gunActiveMs <= 0;
            case "my_fire_gun_cooldown" -> "ranged".equals(player.combatClass)
                    && (player.gunAmmo <= 0 || player.gunReloadMs > 0 || player.gunCooldownMs > 0 || player.gunActiveMs > 0);
            case "my_grenade_ready" -> classSpec(player).canThrowGrenade() && player.grenadeCooldownMs <= 0;
            case "my_grenade_cooldown" -> classSpec(player).canThrowGrenade() && player.grenadeCooldownMs > 0;
            case "my_fireball_ready" -> fireballAvailable(player);
            case "my_fireball_cooldown" -> classSpec(player).canShootFireball() && !fireballAvailable(player);
            case "my_stun_ready" -> stunAvailable(player);
            case "my_stun_cooldown" -> classSpec(player).canStun() && !stunAvailable(player);
            case "opponent_swing_ready" -> opponent.attackCooldownMs <= 0;
            case "opponent_swing_cooldown" -> opponent.attackCooldownMs > 0;
            case "opponent_block_ready" -> opponent.blockCharges > 0;
            case "opponent_block_cooldown" -> opponent.blockCharges <= 0;
            case "opponent_shield_up" -> opponent.blockActive;
            case "opponent_shield_down" -> !opponent.blockActive;
            case "opponent_shield_charges_lt" -> opponent.blockCharges < condition.value();
            case "opponent_shield_charges_gt" -> opponent.blockCharges > condition.value();
            case "opponent_dash_ready" -> canDash(opponent) && opponent.dashCharges > 0 && opponent.dashActiveMs <= 0;
            case "opponent_dash_cooldown" -> canDash(opponent) && (opponent.dashCharges <= 0 || opponent.dashActiveMs > 0);
            case "opponent_dash_charges_lt" -> canDash(opponent) && opponent.dashCharges < condition.value();
            case "opponent_dash_charges_gt" -> canDash(opponent) && opponent.dashCharges > condition.value();
            case "opponent_fire_gun_ready" -> "ranged".equals(opponent.combatClass)
                    && opponent.gunAmmo > 0 && opponent.gunReloadMs <= 0
                    && opponent.gunCooldownMs <= 0 && opponent.gunActiveMs <= 0;
            case "opponent_fire_gun_cooldown" -> "ranged".equals(opponent.combatClass)
                    && (opponent.gunAmmo <= 0 || opponent.gunReloadMs > 0 || opponent.gunCooldownMs > 0 || opponent.gunActiveMs > 0);
            case "opponent_grenade_ready" -> classSpec(opponent).canThrowGrenade() && opponent.grenadeCooldownMs <= 0;
            case "opponent_grenade_cooldown" -> classSpec(opponent).canThrowGrenade() && opponent.grenadeCooldownMs > 0;
            case "opponent_fireball_ready" -> fireballAvailable(opponent);
            case "opponent_fireball_cooldown" -> classSpec(opponent).canShootFireball() && !fireballAvailable(opponent);
            case "opponent_stun_ready" -> stunAvailable(opponent);
            case "opponent_stun_cooldown" -> classSpec(opponent).canStun() && !stunAvailable(opponent);
            case "target_exists" -> !"opponent".equals(condition.target()) && target != null;
            case "target_missing" -> !"opponent".equals(condition.target()) && target == null;
            case "target_health_pack" -> target instanceof Obstacle obstacle && "healthPack".equals(obstacle.type);
            case "target_damage_zone" -> target instanceof Obstacle obstacle && "damageZone".equals(obstacle.type);
            case "target_projectile_wall" -> target instanceof Obstacle obstacle
                    && PROJECTILE_WALL_TYPE.equals(obstacle.type);
            case "target_bouncy_wall" -> target instanceof Obstacle obstacle
                    && BOUNCY_WALL_TYPE.equals(obstacle.type);
            case "inside_damage_zone" -> obstacles.stream()
                    .anyMatch(obstacle -> "damageZone".equals(obstacle.type) && overlapsObstacle(player, obstacle));
            default -> false;
        };
    }

    private boolean evaluateExpressionCondition(Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        StateValue left = resolveStateVariable(condition.left(), condition, player, opponent, obstacles, grenades, fireballs);
        if (left == null) return false;
        StateValue right = "variable".equals(condition.right().type())
                ? resolveStateVariable(condition.right().valueText(), condition, player, opponent, obstacles, grenades, fireballs)
                : condition.right().toStateValue(left.type());
        if (right == null || left.type() != right.type()) return false;
        return compareValues(left, condition.comparator(), right);
    }

    private StateValue resolveStateVariable(String variable, Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        Entity target = targetEntity(condition.target(), player, opponent, obstacles, grenades, fireballs);
        return switch (variable) {
            case "my.hp" -> StateValue.number(player.hp);
            case "my.x" -> StateValue.number(player.x);
            case "my.y" -> StateValue.number(player.y);
            case "opponent.hp" -> StateValue.number(opponent.hp);
            case "opponent.x" -> StateValue.number(opponent.x);
            case "opponent.y" -> StateValue.number(opponent.y);
            case "my.overdriveMs" -> StateValue.number(millisecondsToSeconds(player.overdriveMs));
            case "my.barrierMs" -> StateValue.number(millisecondsToSeconds(player.barrierImmunityMs));
            case "my.slowedMs" -> StateValue.number(millisecondsToSeconds(player.slowedMs));
            case "my.jammedMs" -> StateValue.number(millisecondsToSeconds(player.jammedMs));
            case "my.commandLockedMs" -> StateValue.number(millisecondsToSeconds(player.commandLockedMs));
            case "opponent.overdriveMs" -> StateValue.number(millisecondsToSeconds(opponent.overdriveMs));
            case "opponent.barrierMs" -> StateValue.number(millisecondsToSeconds(opponent.barrierImmunityMs));
            case "opponent.slowedMs" -> StateValue.number(millisecondsToSeconds(opponent.slowedMs));
            case "opponent.jammedMs" -> StateValue.number(millisecondsToSeconds(opponent.jammedMs));
            case "opponent.commandLockedMs" -> StateValue.number(millisecondsToSeconds(opponent.commandLockedMs));
            case "target.distance" -> StateValue.number(target != null
                    ? Math.hypot(target.x() - player.x, target.y() - player.y)
                    : Double.POSITIVE_INFINITY);
            case "opponent.objectDistance" -> StateValue.number(target instanceof Obstacle
                    ? Math.hypot(target.x() - opponent.x, target.y() - opponent.y)
                    : Double.POSITIVE_INFINITY);
            case "my.edgeDistance" -> StateValue.number(edgeDistancePixels(player));
            case "target.edgeDistance" -> StateValue.number(target != null ? edgeDistancePixels(target) : 0.0);
            case "my.swingReady" -> StateValue.bool(player.attackCooldownMs <= 0);
            case "my.swingCooldownMs" -> StateValue.number(millisecondsToSeconds(player.attackCooldownMs));
            case "my.blockReady" -> StateValue.bool(player.blockCharges > 0);
            case "my.shieldUp" -> StateValue.bool(player.blockActive);
            case "my.shieldCharges" -> StateValue.number(player.blockCharges);
            case "my.blockRechargeMs" -> StateValue.number(millisecondsToSeconds(player.blockRechargeMs));
            case "my.dashReady" -> StateValue.bool(canDash(player) && player.dashCharges > 0 && player.dashActiveMs <= 0);
            case "my.dashCooldownMs" -> StateValue.number(millisecondsToSeconds(Math.max(nextDashRechargeMs(player), player.dashActiveMs)));
            case "my.dashCharges" -> StateValue.number(player.dashCharges);
            case "my.gunReady" -> StateValue.bool("ranged".equals(player.combatClass)
                    && player.gunAmmo > 0 && player.gunReloadMs <= 0
                    && player.gunCooldownMs <= 0 && player.gunActiveMs <= 0);
            case "my.gunCooldownMs" -> StateValue.number(millisecondsToSeconds(player.gunCooldownMs));
            case "my.gunAmmo" -> StateValue.number(player.gunAmmo);
            case "my.gunReloadMs" -> StateValue.number(millisecondsToSeconds(player.gunReloadMs));
            case "my.grenadeReady" -> StateValue.bool(classSpec(player).canThrowGrenade() && player.grenadeCooldownMs <= 0);
            case "my.grenadeCooldownMs" -> StateValue.number(millisecondsToSeconds(player.grenadeCooldownMs));
            case "my.fireballReady" -> StateValue.bool(fireballAvailable(player));
            case "my.fireballCooldownMs" -> StateValue.number(millisecondsToSeconds(player.fireballCooldownMs));
            case "my.fireballCharges" -> StateValue.number(player.fireballCharges);
            case "my.fireballReloadMs" -> StateValue.number(millisecondsToSeconds(player.fireballReloadMs));
            case "my.stunReady" -> StateValue.bool(stunAvailable(player));
            case "my.stunCooldownMs" -> StateValue.number(millisecondsToSeconds(player.stunCooldownMs));
            case "opponent.swingReady" -> StateValue.bool(opponent.attackCooldownMs <= 0);
            case "opponent.swingCooldownMs" -> StateValue.number(millisecondsToSeconds(opponent.attackCooldownMs));
            case "opponent.blockReady" -> StateValue.bool(opponent.blockCharges > 0);
            case "opponent.shieldUp" -> StateValue.bool(opponent.blockActive);
            case "opponent.shieldCharges" -> StateValue.number(opponent.blockCharges);
            case "opponent.blockRechargeMs" -> StateValue.number(millisecondsToSeconds(opponent.blockRechargeMs));
            case "opponent.dashReady" -> StateValue.bool(canDash(opponent) && opponent.dashCharges > 0 && opponent.dashActiveMs <= 0);
            case "opponent.dashCooldownMs" -> StateValue.number(millisecondsToSeconds(Math.max(nextDashRechargeMs(opponent), opponent.dashActiveMs)));
            case "opponent.dashCharges" -> StateValue.number(opponent.dashCharges);
            case "opponent.gunReady" -> StateValue.bool("ranged".equals(opponent.combatClass)
                    && opponent.gunAmmo > 0 && opponent.gunReloadMs <= 0
                    && opponent.gunCooldownMs <= 0 && opponent.gunActiveMs <= 0);
            case "opponent.gunCooldownMs" -> StateValue.number(millisecondsToSeconds(opponent.gunCooldownMs));
            case "opponent.gunAmmo" -> StateValue.number(opponent.gunAmmo);
            case "opponent.gunReloadMs" -> StateValue.number(millisecondsToSeconds(opponent.gunReloadMs));
            case "opponent.grenadeReady" -> StateValue.bool(classSpec(opponent).canThrowGrenade() && opponent.grenadeCooldownMs <= 0);
            case "opponent.grenadeCooldownMs" -> StateValue.number(millisecondsToSeconds(opponent.grenadeCooldownMs));
            case "opponent.fireballReady" -> StateValue.bool(fireballAvailable(opponent));
            case "opponent.fireballCooldownMs" -> StateValue.number(millisecondsToSeconds(opponent.fireballCooldownMs));
            case "opponent.fireballCharges" -> StateValue.number(opponent.fireballCharges);
            case "opponent.fireballReloadMs" -> StateValue.number(millisecondsToSeconds(opponent.fireballReloadMs));
            case "opponent.stunReady" -> StateValue.bool(stunAvailable(opponent));
            case "opponent.stunCooldownMs" -> StateValue.number(millisecondsToSeconds(opponent.stunCooldownMs));
            case "target.exists" -> StateValue.bool(!"opponent".equals(condition.target()) && target != null);
            case "target.isHealthPack" -> StateValue.bool(target instanceof Obstacle obstacle && "healthPack".equals(obstacle.type));
            case "target.isDamageZone" -> StateValue.bool(target instanceof Obstacle obstacle && "damageZone".equals(obstacle.type));
            case "target.isProjectileWall" -> StateValue.bool(target instanceof Obstacle obstacle
                    && PROJECTILE_WALL_TYPE.equals(obstacle.type));
            case "target.isBouncyWall" -> StateValue.bool(target instanceof Obstacle obstacle
                    && BOUNCY_WALL_TYPE.equals(obstacle.type));
            case "my.jammed" -> StateValue.bool(player.jammedMs > 0);
            case "my.commandLocked" -> StateValue.bool(player.commandLockedMs > 0);
            case "opponent.jammed" -> StateValue.bool(opponent.jammedMs > 0);
            case "opponent.commandLocked" -> StateValue.bool(opponent.commandLockedMs > 0);
            case "my.insideDamageZone" -> StateValue.bool(obstacles.stream()
                    .anyMatch(obstacle -> "damageZone".equals(obstacle.type) && overlapsObstacle(player, obstacle)));
            default -> null;
        };
    }

    private static double millisecondsToSeconds(int value) {
        return value / 1000.0;
    }

    private static boolean compareValues(StateValue left, String comparator, StateValue right) {
        if (left.type() == ValueType.BOOLEAN) {
            return "neq".equals(comparator)
                    ? left.booleanValue() != right.booleanValue()
                    : left.booleanValue() == right.booleanValue();
        }
        double leftNumber = left.numberValue();
        double rightNumber = right.numberValue();
        if (!Double.isFinite(leftNumber) || !Double.isFinite(rightNumber)) return false;
        return switch (comparator) {
            case "lt" -> leftNumber < rightNumber;
            case "lte" -> leftNumber <= rightNumber;
            case "eq" -> leftNumber == rightNumber;
            case "neq" -> leftNumber != rightNumber;
            case "gte" -> leftNumber >= rightNumber;
            case "gt" -> leftNumber > rightNumber;
            default -> false;
        };
    }

    private boolean fireballAvailable(Fighter fighter) {
        return classSpec(fighter).canShootFireball()
                && fighter.fireballCharges > 0
                && fighter.fireballReloadMs <= 0
                && fighter.fireballCooldownMs <= 0
                && fighter.fireballActiveMs <= 0;
    }

    private boolean stunAvailable(Fighter fighter) {
        return classSpec(fighter).canStun()
                && fighter.stunCooldownMs <= 0
                && fighter.stunActiveMs <= 0;
    }

    private static Entity targetEntity(String target, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades, List<Fireball> fireballs) {
        if (player.jammedMs > 0) return null;
        if ("opponent".equals(target)) return opponent;
        if ("opponent_grenade".equals(target)) {
            return grenades.stream()
                    .filter(grenade -> opponent.userId.equals(grenade.ownerUserId()))
                    .findFirst()
                    .orElse(null);
        }
        if ("opponent_fireball".equals(target)) {
            return fireballs.stream()
                    .filter(fireball -> opponent.userId.equals(fireball.ownerUserId()))
                    .min(Comparator.comparingDouble(fireball -> Math.hypot(fireball.x() - player.x, fireball.y() - player.y)))
                    .orElse(null);
        }
        return obstacles.stream()
                .filter(obstacle -> isPlaceableObstacleType(obstacle.type))
                .filter(obstacle -> obstacle.id.equals(target))
                .findFirst()
                .orElse(null);
    }

    private boolean canDash(Fighter fighter) {
        return classSpec(fighter).canDash();
    }

    private static Vector movementVectorForAction(String action, Fighter player, Entity target) {
        if (player == null || "move_stop".equals(action) || "rotate_toward_enemy".equals(action)
                || "swing".equals(action) || "block".equals(action) || "fire_gun".equals(action)
                || "throw_grenade".equals(action) || "shoot_fireball".equals(action) || "stun".equals(action)) {
            return new Vector(0, 0);
        }
        if ("move_center".equals(action)) {
            return new Vector(CANVAS_SIZE / 2.0 - player.x, CANVAS_SIZE / 2.0 - player.y);
        }
        switch (action) {
            case "move_north", "dash_north" -> {
                return new Vector(0.0, -1.0);
            }
            case "move_south", "dash_south" -> {
                return new Vector(0.0, 1.0);
            }
            case "move_east", "dash_east" -> {
                return new Vector(1.0, 0.0);
            }
            case "move_west", "dash_west" -> {
                return new Vector(-1.0, 0.0);
            }
            case "move_northeast", "dash_northeast" -> {
                return new Vector(Math.sqrt(0.5), -Math.sqrt(0.5));
            }
            case "move_northwest", "dash_northwest" -> {
                return new Vector(-Math.sqrt(0.5), -Math.sqrt(0.5));
            }
            case "move_southeast", "dash_southeast" -> {
                return new Vector(Math.sqrt(0.5), Math.sqrt(0.5));
            }
            case "move_southwest", "dash_southwest" -> {
                return new Vector(-Math.sqrt(0.5), Math.sqrt(0.5));
            }
            default -> {
            }
        }
        if (target == null) return new Vector(0, 0);
        Vector inward = new Vector(target.x() - player.x, target.y() - player.y);
        Vector outward = new Vector(-inward.dx(), -inward.dy());
        Vector tangentLeft = new Vector(inward.dy(), -inward.dx());
        Vector tangentRight = new Vector(-inward.dy(), inward.dx());
        return switch (action) {
            case "move_inward", "dash" -> inward;
            case "move_outward", "dash_outward" -> outward;
            case "move_tangent_left", "dash_tangent_left" -> tangentLeft;
            case "move_tangent_right", "dash_tangent_right" -> tangentRight;
            case "move_diagonal_in_left", "dash_diagonal_in_left" -> addVectors(inward, tangentLeft);
            case "move_diagonal_in_right", "dash_diagonal_in_right" -> addVectors(inward, tangentRight);
            case "move_diagonal_out_left", "dash_diagonal_out_left" -> addVectors(outward, tangentLeft);
            case "move_diagonal_out_right", "dash_diagonal_out_right" -> addVectors(outward, tangentRight);
            default -> new Vector(0, 0);
        };
    }

    private boolean applyAction(Fighter fighter, Action action, Arena arena) {
        CombatClassSpec spec = classSpec(fighter);
        fighter.overdriveMs = Math.max(0, fighter.overdriveMs - STEP_MS);
        fighter.barrierImmunityMs = Math.max(0, fighter.barrierImmunityMs - STEP_MS);
        fighter.slowedMs = Math.max(0, fighter.slowedMs - STEP_MS);
        fighter.jammedMs = Math.max(0, fighter.jammedMs - STEP_MS);
        fighter.commandLockedMs = Math.max(0, fighter.commandLockedMs - STEP_MS);
        if (fighter.commandLockedMs <= 0) fighter.commandLockAction = null;
        int cooldownStepMs = fighter.overdriveMs > 0 ? STEP_MS * 2 : STEP_MS;
        double attackCooldownMultiplier = fighter.overdriveMs > 0 ? 0.75 : 1.0;
        double movementSpeedMultiplier = fighter.slowedMs > 0 ? INHIBITION_SPEED_MULTIPLIER : 1.0;
        fighter.attackCooldownMs = Math.max(0, fighter.attackCooldownMs - cooldownStepMs);
        fighter.attackActiveMs = Math.max(0, fighter.attackActiveMs - STEP_MS);
        rechargeBlock(fighter, spec, cooldownStepMs);
        fighter.blockActive = false;
        rechargeDash(fighter, spec, cooldownStepMs);
        fighter.dashActiveMs = Math.max(0, fighter.dashActiveMs - STEP_MS);
        fighter.gunCooldownMs = Math.max(0, fighter.gunCooldownMs - cooldownStepMs);
        fighter.gunActiveMs = Math.max(0, fighter.gunActiveMs - STEP_MS);
        reloadGun(fighter, spec, cooldownStepMs);
        fighter.gunShotActive = false;
        fighter.grenadeCooldownMs = Math.max(0, fighter.grenadeCooldownMs - cooldownStepMs);
        fighter.thrownGrenade = null;
        fighter.fireballCooldownMs = Math.max(0, fighter.fireballCooldownMs - cooldownStepMs);
        fighter.fireballActiveMs = Math.max(0, fighter.fireballActiveMs - STEP_MS);
        reloadFireballs(fighter, spec, cooldownStepMs);
        fighter.thrownFireball = null;
        fighter.stunCooldownMs = Math.max(0, fighter.stunCooldownMs - cooldownStepMs);
        fighter.stunActiveMs = Math.max(0, fighter.stunActiveMs - STEP_MS);
        fighter.stunCastActive = false;
        fighter.stunnedMs = Math.max(0, fighter.stunnedMs - STEP_MS);

        boolean swungThisTick = false;
        if (fighter.stunnedMs > 0) {
            fighter.dashActiveMs = 0;
            fighter.movementVelocityX = 0.0;
            fighter.movementVelocityY = 0.0;
            fighter.velocityX = 0.0;
            fighter.velocityY = 0.0;
            return false;
        }
        double actionMagnitude = Math.hypot(action.dx(), action.dy());
        boolean dashAvailable = spec.canDash() && fighter.dashCharges > 0;
        boolean isContinuingDash = fighter.dashActiveMs > 0;
        fighter.rotation = normalizeDegrees(fighter.rotation + clamp(action.dRot(), -1, 1) * TURN_SPEED_DEGREES);

        if (isContinuingDash) {
            fighter.movementVelocityX = fighter.dashDirectionX * spec.moveSpeed() * movementSpeedMultiplier;
            fighter.movementVelocityY = fighter.dashDirectionY * spec.moveSpeed() * movementSpeedMultiplier;
            moveFighter(fighter, fighter.dashDirectionX, fighter.dashDirectionY, DASH_SPEED * movementSpeedMultiplier, arena);
        } else if (action.dash() > 0.5 && dashAvailable) {
            double radians = fighter.rotation * Math.PI / 180.0;
            fighter.dashDirectionX = actionMagnitude > 0.001 ? action.dx() / actionMagnitude : Math.cos(radians);
            fighter.dashDirectionY = actionMagnitude > 0.001 ? action.dy() / actionMagnitude : Math.sin(radians);
            fighter.dashActiveMs = DASH_DURATION_MS;
            consumeDashCharge(fighter, spec);
            fighter.movementVelocityX = fighter.dashDirectionX * spec.moveSpeed() * movementSpeedMultiplier;
            fighter.movementVelocityY = fighter.dashDirectionY * spec.moveSpeed() * movementSpeedMultiplier;
            moveFighter(fighter, fighter.dashDirectionX, fighter.dashDirectionY, DASH_SPEED * movementSpeedMultiplier, arena);
        }

        if (!isContinuingDash && fighter.dashActiveMs <= 0) {
            Vector movementVelocity = nextMovementVelocity(fighter, action, actionMagnitude, spec.moveSpeed() * movementSpeedMultiplier);
            fighter.movementVelocityX = movementVelocity.dx();
            fighter.movementVelocityY = movementVelocity.dy();
            moveFighterByVelocity(fighter, movementVelocity.dx(), movementVelocity.dy(), arena);
        }
        if (action.block() > 0.5 && spec.canBlock() && fighter.blockCharges > 0) {
            fighter.blockActive = true;
        }
        if (!fighter.blockActive && action.swing() > 0.5 && spec.canSwing() && fighter.attackCooldownMs <= 0) {
            fighter.attackActiveMs = ATTACK_ACTIVE_MS;
            fighter.attackCooldownMs = (int) Math.round(ATTACK_COOLDOWN_MS * attackCooldownMultiplier);
            swungThisTick = true;
        }
        if (!fighter.blockActive && action.gun() > 0.5 && spec.canFireGun()
                && fighter.gunAmmo > 0
                && fighter.gunReloadMs <= 0
                && fighter.gunCooldownMs <= 0 && fighter.gunActiveMs <= 0) {
            fighter.gunAmmo = Math.max(0, fighter.gunAmmo - 1);
            if (fighter.gunAmmo <= 0) {
                fighter.gunReloadMs = overdriveAdjustedMs(fighter, spec.gunReloadMs());
            }
            fighter.gunActiveMs = spec.gunActiveMs();
            fighter.gunCooldownMs = overdriveAdjustedMs(fighter, spec.gunCooldownMs());
            fighter.gunShotActive = true;
        }
        if (!fighter.blockActive && action.grenade() > 0.5 && spec.canThrowGrenade() && fighter.grenadeCooldownMs <= 0) {
            fighter.grenadeCooldownMs = overdriveAdjustedMs(fighter, spec.grenadeCooldownMs());
            fighter.thrownGrenade = createGrenade(fighter);
            fighter.grenadeSerial += 1;
        }
        if (!fighter.blockActive && action.fireball() > 0.5 && fireballAvailable(fighter)) {
            fighter.fireballCharges = Math.max(0, fighter.fireballCharges - 1);
            if (fighter.fireballCharges <= 0) {
                fighter.fireballReloadMs = overdriveAdjustedMs(fighter, spec.fireballReloadMs());
            }
            fighter.fireballActiveMs = spec.fireballActiveMs();
            fighter.fireballCooldownMs = overdriveAdjustedMs(fighter, spec.fireballCooldownMs());
            fighter.thrownFireball = createFireball(fighter);
            fighter.fireballSerial += 1;
        }
        if (!fighter.blockActive && action.stun() > 0.5 && stunAvailable(fighter)) {
            fighter.stunActiveMs = spec.stunActiveMs();
            fighter.stunCooldownMs = overdriveAdjustedMs(fighter, spec.stunCooldownMs());
            fighter.stunCastActive = true;
        }
        return swungThisTick;
    }

    private static int overdriveAdjustedMs(Fighter fighter, int milliseconds) {
        return fighter.overdriveMs > 0 ? Math.max(0, (int) Math.round(milliseconds * 0.5)) : milliseconds;
    }

    private static void rechargeBlock(Fighter fighter, CombatClassSpec spec, int stepMs) {
        if (!spec.canBlock()) {
            fighter.blockCharges = 0;
            fighter.blockRechargeMs = 0;
            return;
        }
        fighter.blockCharges = (int) clamp(fighter.blockCharges, 0, spec.blockMaxCharges());
        if (fighter.blockCharges >= spec.blockMaxCharges()) {
            fighter.blockRechargeMs = 0;
            return;
        }
        fighter.blockRechargeMs += stepMs;
        while (fighter.blockCharges < spec.blockMaxCharges() && fighter.blockRechargeMs >= spec.blockRechargeMs()) {
            fighter.blockCharges += 1;
            fighter.blockRechargeMs -= spec.blockRechargeMs();
        }
        if (fighter.blockCharges >= spec.blockMaxCharges()) fighter.blockRechargeMs = 0;
    }

    private static void reloadGun(Fighter fighter, CombatClassSpec spec, int stepMs) {
        if (!spec.canFireGun()) {
            fighter.gunAmmo = 0;
            fighter.gunReloadMs = 0;
            return;
        }
        fighter.gunAmmo = (int) clamp(fighter.gunAmmo, 0, spec.gunAmmoMax());
        if (fighter.gunAmmo > 0) {
            fighter.gunReloadMs = 0;
            return;
        }
        fighter.gunReloadMs = Math.max(0, fighter.gunReloadMs - stepMs);
        if (fighter.gunReloadMs <= 0) {
            fighter.gunAmmo = spec.gunAmmoMax();
        }
    }

    private static void reloadFireballs(Fighter fighter, CombatClassSpec spec, int stepMs) {
        if (!spec.canShootFireball()) {
            fighter.fireballCharges = 0;
            fighter.fireballReloadMs = 0;
            return;
        }
        fighter.fireballCharges = (int) clamp(fighter.fireballCharges, 0, spec.fireballChargesMax());
        if (fighter.fireballCharges > 0) {
            fighter.fireballReloadMs = 0;
            return;
        }
        fighter.fireballReloadMs = Math.max(0, fighter.fireballReloadMs - stepMs);
        if (fighter.fireballReloadMs <= 0) {
            fighter.fireballCharges = spec.fireballChargesMax();
        }
    }

    private static void rechargeDash(Fighter fighter, CombatClassSpec spec, int stepMs) {
        if (!spec.canDash()) {
            fighter.dashCharges = 0;
            fighter.dashRechargeMs = 0;
            fighter.dashChargeRechargeMs.clear();
            return;
        }
        fighter.dashCharges = (int) clamp(fighter.dashCharges, 0, spec.dashMaxCharges());
        List<Integer> remaining = new ArrayList<>();
        for (Integer rechargeMs : fighter.dashChargeRechargeMs) {
            int nextMs = Math.max(0, rechargeMs - stepMs);
            if (nextMs <= 0 && fighter.dashCharges < spec.dashMaxCharges()) {
                fighter.dashCharges += 1;
            } else if (nextMs > 0) {
                remaining.add(nextMs);
            }
        }
        fighter.dashChargeRechargeMs = remaining;
        fighter.dashRechargeMs = nextDashRechargeMs(fighter);
    }

    private static void consumeDashCharge(Fighter fighter, CombatClassSpec spec) {
        if (!spec.canDash() || fighter.dashCharges <= 0) return;
        fighter.dashCharges -= 1;
        fighter.dashChargeRechargeMs.add(overdriveAdjustedMs(fighter, spec.dashRechargeMs()));
        fighter.dashRechargeMs = nextDashRechargeMs(fighter);
    }

    private static int nextDashRechargeMs(Fighter fighter) {
        return fighter.dashChargeRechargeMs.stream()
                .min(Integer::compareTo)
                .orElse(0);
    }

    private boolean attackHits(Fighter attacker, Fighter defender) {
        CombatClassSpec spec = classSpec(attacker);
        if (!spec.canSwing()) return false;
        if (Math.hypot(defender.x - attacker.x, defender.y - attacker.y) > spec.attackRange()) return false;
        double bearing = Math.atan2(defender.y - attacker.y, defender.x - attacker.x) * 180.0 / Math.PI;
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= spec.attackArcDegrees();
    }

    private static boolean blocksAttack(Fighter defender, Fighter attacker) {
        if (!defender.blockActive || defender.blockCharges <= 0) return false;
        double bearing = Math.atan2(attacker.y - defender.y, attacker.x - defender.x) * 180.0 / Math.PI;
        return Math.abs(angleDelta(defender.rotation, bearing)) <= 95;
    }

    private static void consumeBlockCharges(Fighter fighter, int charges) {
        fighter.blockCharges = Math.max(0, fighter.blockCharges - charges);
        if (fighter.blockCharges <= 0) fighter.blockActive = false;
    }

    private int incomingAttackDamage(Fighter attacker, Fighter defender) {
        return (int) Math.round(classSpec(attacker).attackDamage()
                * (defender.inDamageZone ? DAMAGE_ZONE_DAMAGE_MULTIPLIER : 1.0));
    }

    private boolean gunHits(Fighter attacker, Fighter defender, List<Obstacle> obstacles) {
        if (!attacker.gunShotActive) return false;
        CombatClassSpec spec = classSpec(attacker);
        if (!spec.canFireGun()) return false;
        double radians = attacker.rotation * Math.PI / 180.0;
        double forwardX = Math.cos(radians);
        double forwardY = Math.sin(radians);
        double rightX = -forwardY;
        double rightY = forwardX;
        double relX = defender.x - attacker.x;
        double relY = defender.y - attacker.y;
        double forwardDistance = relX * forwardX + relY * forwardY;
        double sideDistance = relX * rightX + relY * rightY;
        double defenderRadius = defender.size / 2.0;
        return forwardDistance >= 0
                && forwardDistance <= spec.gunRange() + defenderRadius
                && Math.abs(sideDistance) <= defenderRadius
                && !projectileWallBlocksSegment(attacker.x, attacker.y, defender.x, defender.y, 0, obstacles);
    }

    private boolean stunHits(Fighter attacker, Fighter defender) {
        if (!attacker.stunCastActive) return false;
        CombatClassSpec spec = classSpec(attacker);
        if (!spec.canStun()) return false;
        double dx = defender.x - attacker.x;
        double dy = defender.y - attacker.y;
        double distance = Math.hypot(dx, dy);
        if (distance > spec.stunRange() + defender.size / 2.0) return false;
        double bearing = Math.atan2(dy, dx) * 180.0 / Math.PI;
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= spec.stunArcDegrees() / 2.0;
    }

    private void applyStun(Fighter attacker, Fighter defender) {
        CombatClassSpec spec = classSpec(attacker);
        applyDamage(defender, spec.stunDamage());
        if (defender.barrierImmunityMs > 0) return;
        defender.stunnedMs = Math.max(defender.stunnedMs, spec.stunDurationMs());
        defender.dashActiveMs = 0;
        defender.movementVelocityX = 0.0;
        defender.movementVelocityY = 0.0;
        defender.velocityX = 0.0;
        defender.velocityY = 0.0;
        applyInhibitionOnHit(attacker, defender);
    }

    private static void applyDamage(Fighter target, int damage) {
        int remaining = Math.max(0, damage);
        if (target.shieldHp > 0 && remaining > 0) {
            int absorbed = Math.min(target.shieldHp, remaining);
            target.shieldHp -= absorbed;
            remaining -= absorbed;
        }
        if (remaining > 0) {
            target.hp = Math.max(0, target.hp - remaining);
        }
    }

    private static void applyInhibitionOnHit(Fighter attacker, Fighter defender) {
        if (attacker.inhibitionCharges <= 0) return;
        attacker.inhibitionCharges -= 1;
        defender.slowedMs = INHIBITION_SLOW_MS;
    }

    private List<Obstacle> applyKillableBuffDamage(List<Obstacle> obstacles, Fighter attacker, boolean swungThisTick, boolean gunShotActive) {
        if (!swungThisTick && !gunShotActive) return obstacles;
        List<Obstacle> nextObstacles = new ArrayList<>();
        boolean consumedHit = false;
        for (Obstacle obstacle : obstacles) {
            if (!isBuffPickupType(obstacle.type) || obstacle.hp <= 0 || consumedHit) {
                nextObstacles.add(obstacle);
                continue;
            }
            int damage = 0;
            if (swungThisTick && attackHitsObstacle(attacker, obstacle)) {
                damage = classSpec(attacker).attackDamage();
            } else if (gunShotActive && gunHitsObstacle(attacker, obstacle, obstacles)) {
                damage = classSpec(attacker).gunDamage(Math.hypot(obstacle.x - attacker.x, obstacle.y - attacker.y));
            }
            if (damage <= 0) {
                nextObstacles.add(obstacle);
                continue;
            }
            consumedHit = true;
            nextObstacles.addAll(damageKillableBuff(List.of(obstacle), obstacle.id, attacker, damage));
        }
        return nextObstacles;
    }

    private static List<Obstacle> damageKillableBuff(List<Obstacle> obstacles, String obstacleId, Fighter attacker, int damage) {
        if (attacker == null || damage <= 0) return obstacles;
        List<Obstacle> nextObstacles = new ArrayList<>();
        for (Obstacle obstacle : obstacles) {
            if (!obstacle.id.equals(obstacleId) || !isBuffPickupType(obstacle.type)) {
                nextObstacles.add(obstacle);
                continue;
            }
            int remainingHp = Math.max(0, obstacle.hp - damage);
            if (remainingHp <= 0) {
                applyBuffPickup(attacker, obstacle.type);
            } else {
                nextObstacles.add(obstacle.withHp(remainingHp));
            }
        }
        return nextObstacles;
    }

    private List<Obstacle> applyGrenadeBuffDamage(List<Obstacle> obstacles, List<Fighter> fighters, List<GrenadeExplosion> explosions) {
        List<Obstacle> nextObstacles = obstacles;
        for (GrenadeExplosion explosion : explosions) {
            Fighter owner = fighters.stream()
                    .filter(fighter -> fighter.userId.equals(explosion.ownerUserId()))
                    .findFirst()
                    .orElse(null);
            if (owner == null) continue;
            for (Obstacle obstacle : nextObstacles) {
                if (!isBuffPickupType(obstacle.type)) continue;
                int damage = grenadeDamageToEntity(classSpec(owner), explosion, obstacle);
                if (damage > 0) {
                    nextObstacles = damageKillableBuff(nextObstacles, obstacle.id, owner, damage);
                    break;
                }
            }
        }
        return nextObstacles;
    }

    private boolean attackHitsObstacle(Fighter attacker, Obstacle obstacle) {
        CombatClassSpec spec = classSpec(attacker);
        if (!spec.canSwing()) return false;
        if (Math.hypot(obstacle.x - attacker.x, obstacle.y - attacker.y) > spec.attackRange() + obstacle.size / 2.0) return false;
        double bearing = Math.atan2(obstacle.y - attacker.y, obstacle.x - attacker.x) * 180.0 / Math.PI;
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= spec.attackArcDegrees();
    }

    private boolean gunHitsObstacle(Fighter attacker, Obstacle obstacle, List<Obstacle> obstacles) {
        CombatClassSpec spec = classSpec(attacker);
        if (!spec.canFireGun()) return false;
        double distance = Math.hypot(obstacle.x - attacker.x, obstacle.y - attacker.y);
        if (distance > spec.gunRange()) return false;
        double bearing = Math.atan2(obstacle.y - attacker.y, obstacle.x - attacker.x) * 180.0 / Math.PI;
        return Math.abs(angleDelta(attacker.rotation, bearing)) <= Math.toDegrees(Math.atan2(obstacle.size / 2.0, Math.max(1.0, distance)))
                && !projectileWallBlocksSegment(attacker.x, attacker.y, obstacle.x, obstacle.y, 0, obstacles);
    }

    private int incomingGunDamage(Fighter attacker, Fighter defender) {
        double distance = Math.hypot(defender.x - attacker.x, defender.y - attacker.y);
        double damage = classSpec(attacker).gunDamage(distance);
        return (int) Math.round(damage * (defender.inDamageZone ? DAMAGE_ZONE_DAMAGE_MULTIPLIER : 1.0));
    }

    private static Grenade createGrenade(Fighter fighter) {
        double radians = fighter.rotation * Math.PI / 180.0;
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        double spawnDistance = fighter.size / 2.0 + GRENADE_SIZE / 2.0 + 2.0;
        return new Grenade(
                "grenade-" + fighter.userId + "-" + fighter.grenadeSerial,
                fighter.userId,
                fighter.x + directionX * spawnDistance,
                fighter.y + directionY * spawnDistance,
                GRENADE_SIZE,
                directionX * GRENADE_THROW_SPEED,
                directionY * GRENADE_THROW_SPEED,
                0,
                false,
                1.0);
    }

    private static Fireball createFireball(Fighter fighter) {
        double radians = fighter.rotation * Math.PI / 180.0;
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        double spawnDistance = fighter.size / 2.0 + FIREBALL_SIZE / 2.0 + 2.0;
        return new Fireball(
                "fireball-" + fighter.userId + "-" + fighter.fireballSerial,
                fighter.userId,
                fighter.x + directionX * spawnDistance,
                fighter.y + directionY * spawnDistance,
                FIREBALL_SIZE,
                directionX * FIREBALL_SPEED,
                directionY * FIREBALL_SPEED,
                0.0,
                false,
                1.0);
    }

    private static GrenadeUpdate updateGrenades(
            List<Grenade> grenades,
            List<Fighter> fighters,
            List<Obstacle> obstacles,
            Arena arena) {
        List<Grenade> remaining = new ArrayList<>();
        List<GrenadeExplosion> explosions = new ArrayList<>();
        List<Obstacle> nextObstacles = obstacles;
        for (Grenade grenade : grenades) {
            Grenade next = advanceGrenade(grenade, arena);
            if (projectileWallBlocksSegment(
                    grenade.x(), grenade.y(), next.x(), next.y(), next.size() / 2.0, obstacles)) {
                continue;
            }
            WallReflection wallReflection = findBouncyWallReflection(
                    grenade.x(), grenade.y(), next.velocityX(), next.velocityY(), next.size(), nextObstacles);
            if (wallReflection != null) {
                double speed = Math.hypot(next.velocityX(), next.velocityY()) * 1.25;
                double clearance = next.size() / 2.0 + PROJECTILE_WALL_THICKNESS / 2.0 + 0.1;
                next = new Grenade(
                        next.id(), next.ownerUserId(),
                        wallReflection.hitX() + wallReflection.outX() * clearance,
                        wallReflection.hitY() + wallReflection.outY() * clearance,
                        next.size(),
                        wallReflection.outX() * speed,
                        wallReflection.outY() * speed,
                        0,
                        true,
                        next.damageMultiplier() * 1.5);
                nextObstacles = consumeBouncyWall(nextObstacles, wallReflection.wall().id);
            }
            Grenade collisionGrenade = next;
            boolean touchedOpponent = fighters.stream()
                    .anyMatch(fighter -> (collisionGrenade.reflected()
                            || !fighter.userId.equals(collisionGrenade.ownerUserId()))
                            && overlapsShape(fighter, collisionGrenade, 0));
            boolean stoppedLongEnough = Math.hypot(next.velocityX(), next.velocityY()) <= 0.001
                    && next.stoppedMs() >= GRENADE_STOP_FUSE_MS;
            if (touchedOpponent || stoppedLongEnough) {
                explosions.add(new GrenadeExplosion(
                        next.id() + "-explosion",
                        next.x(),
                        next.y(),
                        GRENADE_EXPLOSION_RADIUS * 2,
                        GRENADE_EXPLOSION_VISIBLE_MS,
                        next.ownerUserId(),
                        next.damageMultiplier()));
            } else {
                remaining.add(next);
            }
        }
        return new GrenadeUpdate(remaining, explosions, nextObstacles);
    }

    private static Grenade advanceGrenade(Grenade grenade, Arena arena) {
        double nextX = clamp(grenade.x() + grenade.velocityX(), GRENADE_SIZE / 2.0, arena.width() - GRENADE_SIZE / 2.0);
        double nextY = clamp(grenade.y() + grenade.velocityY(), GRENADE_SIZE / 2.0, arena.height() - GRENADE_SIZE / 2.0);
        boolean hitWall = nextX != grenade.x() + grenade.velocityX() || nextY != grenade.y() + grenade.velocityY();
        double velocityX = grenade.velocityX();
        double velocityY = grenade.velocityY();
        if (hitWall) {
            velocityX = 0.0;
            velocityY = 0.0;
        } else {
            double speed = Math.hypot(velocityX, velocityY);
            if (speed <= GRENADE_DECELERATION_PER_TICK) {
                velocityX = 0.0;
                velocityY = 0.0;
            } else {
                double nextSpeed = speed - GRENADE_DECELERATION_PER_TICK;
                velocityX = velocityX / speed * nextSpeed;
                velocityY = velocityY / speed * nextSpeed;
            }
        }
        int stoppedMs = Math.hypot(velocityX, velocityY) <= 0.001 ? grenade.stoppedMs() + STEP_MS : 0;
        return new Grenade(
                grenade.id(), grenade.ownerUserId(), nextX, nextY, grenade.size(),
                velocityX, velocityY, stoppedMs, grenade.reflected(), grenade.damageMultiplier());
    }

    private FireballUpdate updateFireballs(
            List<Fireball> fireballs,
            List<Fighter> fighters,
            List<Obstacle> obstacles,
            Arena arena) {
        List<Fireball> remaining = new ArrayList<>();
        List<FireballHit> hits = new ArrayList<>();
        List<Obstacle> nextObstacles = obstacles;
        for (Fireball fireball : fireballs) {
            Fireball next = advanceFireball(fireball);
            if (projectileWallBlocksSegment(
                    fireball.x(), fireball.y(), next.x(), next.y(), next.size() / 2.0, obstacles)) {
                continue;
            }
            WallReflection wallReflection = findBouncyWallReflection(
                    fireball.x(), fireball.y(), next.velocityX(), next.velocityY(), next.size(), nextObstacles);
            if (wallReflection != null) {
                double speed = Math.hypot(next.velocityX(), next.velocityY()) * 1.25;
                double clearance = next.size() / 2.0 + PROJECTILE_WALL_THICKNESS / 2.0 + 0.1;
                next = new Fireball(
                        next.id(), next.ownerUserId(),
                        wallReflection.hitX() + wallReflection.outX() * clearance,
                        wallReflection.hitY() + wallReflection.outY() * clearance,
                        next.size(),
                        wallReflection.outX() * speed,
                        wallReflection.outY() * speed,
                        next.traveled(),
                        true,
                        next.damageMultiplier() * 1.5);
                nextObstacles = consumeBouncyWall(nextObstacles, wallReflection.wall().id);
            }
            Fireball collisionFireball = next;
            Obstacle hitBuff = nextObstacles.stream()
                    .filter(obstacle -> isBuffPickupType(obstacle.type) && overlapsShape(obstacle, collisionFireball, 0))
                    .findFirst()
                    .orElse(null);
            if (hitBuff != null) {
                Fireball buffHitFireball = next;
                Fighter owner = fighters.stream()
                        .filter(fighter -> fighter.userId.equals(buffHitFireball.ownerUserId()))
                        .findFirst()
                        .orElse(null);
                if (owner != null) {
                    nextObstacles = damageKillableBuff(nextObstacles, hitBuff.id, owner, (int) Math.round(classSpec(owner).fireballDamage() * buffHitFireball.damageMultiplier()));
                }
                continue;
            }
            Fighter hit = fighters.stream()
                    .filter(fighter -> (collisionFireball.reflected()
                            || !fighter.userId.equals(collisionFireball.ownerUserId()))
                            && overlapsShape(fighter, collisionFireball, 0))
                    .findFirst()
                    .orElse(null);
            if (hit != null) {
                hits.add(new FireballHit(next.ownerUserId(), hit.userId, next.damageMultiplier()));
            } else if (next.traveled() < combatClasses.forId("mage").fireballRange() && insideArena(next, arena)) {
                remaining.add(next);
            }
        }
        return new FireballUpdate(remaining, hits, nextObstacles);
    }

    private static Fireball advanceFireball(Fireball fireball) {
        double velocityX = fireball.velocityX();
        double velocityY = fireball.velocityY();
        return new Fireball(
                fireball.id(),
                fireball.ownerUserId(),
                fireball.x() + velocityX,
                fireball.y() + velocityY,
                fireball.size(),
                velocityX,
                velocityY,
                fireball.traveled() + Math.hypot(velocityX, velocityY),
                fireball.reflected(),
                fireball.damageMultiplier());
    }

    private static boolean insideArena(Entity entity, Arena arena) {
        return entity.x() >= -entity.size() && entity.x() <= arena.width() + entity.size()
                && entity.y() >= -entity.size() && entity.y() <= arena.height() + entity.size();
    }

    private GunReflection reflectGunShot(Fighter attacker, List<Fighter> fighters, List<Obstacle> obstacles) {
        if (!attacker.gunShotActive) return new GunReflection(false, null, obstacles);
        double radians = attacker.rotation * Math.PI / 180.0;
        double directionX = Math.cos(radians);
        double directionY = Math.sin(radians);
        WallReflection reflection = findBouncyWallReflection(
                attacker.x, attacker.y,
                directionX * classSpec(attacker).gunRange(),
                directionY * classSpec(attacker).gunRange(),
                0,
                obstacles);
        if (reflection == null) return new GunReflection(false, null, obstacles);
        double maxDistance = Math.max(0, classSpec(attacker).gunRange() - reflection.distance());
        Fighter target = fighters.stream()
                .map(fighter -> new FighterRayHit(
                        fighter,
                        rayCircleEntryDistance(
                                reflection.hitX() + reflection.outX() * (PROJECTILE_WALL_THICKNESS / 2.0 + 0.1),
                                reflection.hitY() + reflection.outY() * (PROJECTILE_WALL_THICKNESS / 2.0 + 0.1),
                                reflection.outX(),
                                reflection.outY(),
                                fighter.x,
                                fighter.y,
                                fighter.size / 2.0)))
                .filter(hit -> hit.distance() != null && hit.distance() <= maxDistance)
                .min(Comparator.comparingDouble(FighterRayHit::distance))
                .map(FighterRayHit::fighter)
                .orElse(null);
        return new GunReflection(true, target, consumeBouncyWall(obstacles, reflection.wall().id));
    }

    private void applyGunReflectionDamage(Fighter attacker, GunReflection reflection, List<Fighter> fighters) {
        if (!reflection.reflected() || reflection.target() == null) return;
        Fighter target = reflection.target();
        applyDamage(target, (int) Math.round(incomingGunDamage(attacker, target) * 1.5));
        applyInhibitionOnHit(attacker, target);
    }

    private static WallReflection findBouncyWallReflection(
            double x,
            double y,
            double velocityX,
            double velocityY,
            int projectileSize,
            List<Obstacle> obstacles) {
        double speed = Math.hypot(velocityX, velocityY);
        if (speed <= 0.000001) return null;
        double directionX = velocityX / speed;
        double directionY = velocityY / speed;
        return obstacles.stream()
                .filter(obstacle -> BOUNCY_WALL_TYPE.equals(obstacle.type))
                .map(wall -> {
                    double radians = wall.rotation * Math.PI / 180.0;
                    double offsetX = Math.cos(radians) * wall.size / 2.0;
                    double offsetY = Math.sin(radians) * wall.size / 2.0;
                    Double distance = raySegmentIntersectionDistance(
                            x, y, directionX, directionY,
                            wall.x - offsetX, wall.y - offsetY,
                            wall.x + offsetX, wall.y + offsetY);
                    if (distance == null || distance > speed + projectileSize / 2.0) return null;
                    double normalX = -Math.sin(radians);
                    double normalY = Math.cos(radians);
                    if (directionX * normalX + directionY * normalY > 0) {
                        normalX *= -1;
                        normalY *= -1;
                    }
                    return new WallReflection(
                            wall,
                            distance,
                            x + directionX * distance,
                            y + directionY * distance,
                            normalX,
                            normalY);
                })
                .filter(reflection -> reflection != null)
                .min(Comparator.comparingDouble(WallReflection::distance))
                .orElse(null);
    }

    private static List<Obstacle> consumeBouncyWall(List<Obstacle> obstacles, String wallId) {
        return obstacles.stream()
                .map(obstacle -> obstacle.id.equals(wallId)
                        ? new Obstacle(
                                obstacle.id, obstacle.type, obstacle.x, obstacle.y, obstacle.size,
                                obstacle.rotation, obstacle.usesRemaining - 1)
                        : obstacle)
                .filter(obstacle -> !BOUNCY_WALL_TYPE.equals(obstacle.type) || obstacle.usesRemaining > 0)
                .toList();
    }

    private static Double raySegmentIntersectionDistance(
            double originX,
            double originY,
            double directionX,
            double directionY,
            double ax,
            double ay,
            double bx,
            double by) {
        double segmentX = bx - ax;
        double segmentY = by - ay;
        double denominator = directionX * segmentY - directionY * segmentX;
        if (Math.abs(denominator) <= 0.000001) return null;
        double offsetX = ax - originX;
        double offsetY = ay - originY;
        double distance = (offsetX * segmentY - offsetY * segmentX) / denominator;
        double segmentT = (offsetX * directionY - offsetY * directionX) / denominator;
        return distance >= 0 && segmentT >= 0 && segmentT <= 1 ? distance : null;
    }

    private static Double rayCircleEntryDistance(
            double originX,
            double originY,
            double directionX,
            double directionY,
            double centerX,
            double centerY,
            double radius) {
        double offsetX = centerX - originX;
        double offsetY = centerY - originY;
        double projection = offsetX * directionX + offsetY * directionY;
        double perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
        double radiusSquared = radius * radius;
        if (perpendicularSquared > radiusSquared) return null;
        double entry = projection - Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared));
        return entry >= 0 ? entry : null;
    }

    private static boolean projectileWallBlocksSegment(
            double startX,
            double startY,
            double endX,
            double endY,
            double projectileRadius,
            List<Obstacle> obstacles) {
        return obstacles.stream()
                .filter(obstacle -> PROJECTILE_WALL_TYPE.equals(obstacle.type))
                .anyMatch(wall -> {
                    double radians = wall.rotation * Math.PI / 180.0;
                    double offsetX = Math.cos(radians) * wall.size / 2.0;
                    double offsetY = Math.sin(radians) * wall.size / 2.0;
                    return segmentDistance(
                            startX,
                            startY,
                            endX,
                            endY,
                            wall.x - offsetX,
                            wall.y - offsetY,
                            wall.x + offsetX,
                            wall.y + offsetY) <= projectileRadius + PROJECTILE_WALL_THICKNESS / 2.0;
                });
    }

    private static double segmentDistance(
            double ax, double ay, double bx, double by,
            double cx, double cy, double dx, double dy) {
        if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
        return Math.min(
                Math.min(pointToSegmentDistance(ax, ay, cx, cy, dx, dy),
                        pointToSegmentDistance(bx, by, cx, cy, dx, dy)),
                Math.min(pointToSegmentDistance(cx, cy, ax, ay, bx, by),
                        pointToSegmentDistance(dx, dy, ax, ay, bx, by)));
    }

    private static double pointToSegmentDistance(
            double px, double py, double ax, double ay, double bx, double by) {
        double dx = bx - ax;
        double dy = by - ay;
        double lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0.000001) return Math.hypot(px - ax, py - ay);
        double t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    private static boolean segmentsIntersect(
            double ax, double ay, double bx, double by,
            double cx, double cy, double dx, double dy) {
        double abC = cross(ax, ay, bx, by, cx, cy);
        double abD = cross(ax, ay, bx, by, dx, dy);
        double cdA = cross(cx, cy, dx, dy, ax, ay);
        double cdB = cross(cx, cy, dx, dy, bx, by);
        if (Math.abs(abC) <= 0.000001 && pointOnSegment(cx, cy, ax, ay, bx, by)) return true;
        if (Math.abs(abD) <= 0.000001 && pointOnSegment(dx, dy, ax, ay, bx, by)) return true;
        if (Math.abs(cdA) <= 0.000001 && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true;
        if (Math.abs(cdB) <= 0.000001 && pointOnSegment(bx, by, cx, cy, dx, dy)) return true;
        return (abC > 0) != (abD > 0) && (cdA > 0) != (cdB > 0);
    }

    private static double cross(
            double ax, double ay, double bx, double by, double px, double py) {
        return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    }

    private static boolean isWallType(String type) {
        return PROJECTILE_WALL_TYPE.equals(type) || BOUNCY_WALL_TYPE.equals(type);
    }

    private static double snapWallRotation(Double rotation) {
        double value = rotation != null ? rotation : 0.0;
        return normalizeDegrees(Math.round(value / 45.0) * 45.0);
    }

    private static boolean pointOnSegment(
            double px, double py, double ax, double ay, double bx, double by) {
        return px >= Math.min(ax, bx) - 0.000001
                && px <= Math.max(ax, bx) + 0.000001
                && py >= Math.min(ay, by) - 0.000001
                && py <= Math.max(ay, by) + 0.000001;
    }

    private void applyFireballHits(List<Fighter> fighters, List<FireballHit> hits) {
        for (FireballHit hit : hits) {
            Fighter owner = fighters.stream()
                    .filter(fighter -> fighter.userId.equals(hit.ownerUserId()))
                    .findFirst()
                    .orElse(null);
            CombatClassSpec ownerSpec = owner != null ? classSpec(owner) : combatClasses.forId("mage");
            for (Fighter fighter : fighters) {
                if (!fighter.userId.equals(hit.targetUserId())) continue;
                applyDamage(fighter, (int) Math.round(ownerSpec.fireballDamage() * hit.damageMultiplier()));
                if (owner != null) applyInhibitionOnHit(owner, fighter);
                fighter.burnRemainingMs = ownerSpec.fireballBurnDurationMs();
                fighter.burnTickMs = ownerSpec.fireballBurnTickMs();
                fighter.burnDamageMultiplier = hit.damageMultiplier();
            }
        }
    }

    private void applyBurnDamage(List<Fighter> fighters) {
        for (Fighter fighter : fighters) {
            if (fighter.burnRemainingMs <= 0) {
                fighter.burnTickMs = 0;
                fighter.burnDamageMultiplier = 1.0;
                continue;
            }
            fighter.burnRemainingMs = Math.max(0, fighter.burnRemainingMs - STEP_MS);
            fighter.burnTickMs = Math.max(0, fighter.burnTickMs - STEP_MS);
            if (fighter.burnRemainingMs > 0 && fighter.burnTickMs <= 0) {
                applyDamage(fighter, (int) Math.round(
                        combatClasses.forId("mage").fireballBurnDamage() * fighter.burnDamageMultiplier));
                fighter.burnTickMs = combatClasses.forId("mage").fireballBurnTickMs();
            }
            if (fighter.burnRemainingMs <= 0) {
                fighter.burnTickMs = 0;
                fighter.burnDamageMultiplier = 1.0;
            }
        }
    }

    private void applyGrenadeExplosions(List<Fighter> fighters, List<GrenadeExplosion> explosions) {
        for (GrenadeExplosion explosion : explosions) {
            Fighter owner = fighters.stream()
                    .filter(fighter -> fighter.userId.equals(explosion.ownerUserId()))
                    .findFirst()
                    .orElse(null);
            CombatClassSpec ownerSpec = owner != null ? classSpec(owner) : combatClasses.forId("ranged");
            for (Fighter fighter : fighters) {
            int shieldCharges = grenadeShieldChargesToFighter(explosion, fighter);
            if (fighter.blockActive && fighter.blockCharges > 0 && shieldCharges > 0) {
                consumeBlockCharges(fighter, shieldCharges);
                continue;
            }
            int damage = grenadeDamageToFighter(ownerSpec, explosion, fighter);
            if (damage > 0) {
                applyDamage(fighter, damage);
                if (owner != null) applyInhibitionOnHit(owner, fighter);
            }
            }
        }
    }

    private static int grenadeDamageToFighter(CombatClassSpec ownerSpec, GrenadeExplosion explosion, Fighter fighter) {
        double nearestBodyDistance = Math.max(0.0, Math.hypot(fighter.x - explosion.x(), fighter.y - explosion.y()) - fighter.size / 2.0);
        return (int) Math.round(ownerSpec.grenadeDamage(nearestBodyDistance) * explosion.damageMultiplier());
    }

    private static int grenadeDamageToEntity(CombatClassSpec ownerSpec, GrenadeExplosion explosion, Entity entity) {
        double nearestBodyDistance = Math.max(0.0, Math.hypot(entity.x() - explosion.x(), entity.y() - explosion.y()) - entity.size() / 2.0);
        return (int) Math.round(ownerSpec.grenadeDamage(nearestBodyDistance) * explosion.damageMultiplier());
    }

    private static int grenadeShieldChargesToFighter(GrenadeExplosion explosion, Fighter fighter) {
        double nearestBodyDistance = Math.max(0.0, Math.hypot(fighter.x - explosion.x(), fighter.y - explosion.y()) - fighter.size / 2.0);
        if (nearestBodyDistance > GRENADE_EXPLOSION_RADIUS) return 0;
        double t = Math.max(0.0, Math.min(1.0, nearestBodyDistance / GRENADE_EXPLOSION_RADIUS));
        return (int) Math.max(1, Math.min(5, Math.round(5.0 + (1.0 - 5.0) * t)));
    }

    private List<Obstacle> applyObstacleEffects(List<Fighter> fighters, List<Obstacle> obstacles, Action firstAction, Action secondAction) {
        List<Obstacle> remainingObstacles = new ArrayList<>();
        for (Obstacle obstacle : obstacles) {
            if (!isConsumablePickupType(obstacle.type) && !isCenterObjectiveType(obstacle.type)) {
                remainingObstacles.add(obstacle);
                continue;
            }
            if ("healthPack".equals(obstacle.type)) {
                Fighter collector = fighters.stream()
                        .filter(fighter -> overlapsObstacle(fighter, obstacle))
                        .findFirst()
                        .orElse(null);
                if (collector == null) {
                    remainingObstacles.add(obstacle);
                    continue;
                }
                collector.hp = Math.min(classSpec(collector).maxHp(), collector.hp + HEALTH_PACK_HEAL);
                continue;
            }

            Obstacle captured = updateCenterObjectiveCapture(obstacle, fighters);
            Fighter collector = centerObjectiveCollector(captured, fighters);
            if (collector == null) {
                remainingObstacles.add(captured);
                continue;
            }
            Fighter target = fighters.stream()
                    .filter(fighter -> fighter.slot != collector.slot)
                    .findFirst()
                    .orElse(null);
            applyCenterObjective(collector, target, captured.type, collector.slot == 1 ? firstAction : secondAction, collector.slot == 1 ? secondAction : firstAction);
        }

        List<Obstacle> damageZones = remainingObstacles.stream()
                .filter(obstacle -> "damageZone".equals(obstacle.type))
                .toList();
        for (Fighter fighter : fighters) {
            Set<String> previousZoneIds = new HashSet<>(fighter.damageZoneIds);
            List<String> currentZoneIds = damageZones.stream()
                    .filter(zone -> overlapsObstacle(fighter, zone))
                    .map(zone -> zone.id)
                    .toList();
            if (currentZoneIds.stream().anyMatch(id -> !previousZoneIds.contains(id))) {
                applyDamage(fighter, DAMAGE_ZONE_ENTRY_DAMAGE);
            }
            fighter.damageZoneIds = new ArrayList<>(currentZoneIds);
            fighter.inDamageZone = !currentZoneIds.isEmpty();
        }

        return remainingObstacles;
    }

    private static Obstacle updateCenterObjectiveCapture(Obstacle obstacle, List<Fighter> fighters) {
        int slotOneMs = 0;
        int slotTwoMs = 0;
        for (Fighter fighter : fighters) {
            int nextMs = overlapsObstacle(fighter, obstacle)
                    ? Math.min(CENTER_OBJECTIVE_CAPTURE_MS, captureMsForSlot(obstacle, fighter.slot) + STEP_MS)
                    : 0;
            if (fighter.slot == 1) slotOneMs = nextMs;
            if (fighter.slot == 2) slotTwoMs = nextMs;
        }
        return obstacle.withCapture(slotOneMs, slotTwoMs);
    }

    private static int captureMsForSlot(Obstacle obstacle, int slot) {
        return slot == 1 ? obstacle.slotOneCaptureMs : slot == 2 ? obstacle.slotTwoCaptureMs : 0;
    }

    private static Fighter centerObjectiveCollector(Obstacle obstacle, List<Fighter> fighters) {
        if (obstacle.slotOneCaptureMs < CENTER_OBJECTIVE_CAPTURE_MS && obstacle.slotTwoCaptureMs < CENTER_OBJECTIVE_CAPTURE_MS) {
            return null;
        }
        int winningSlot = obstacle.slotOneCaptureMs >= CENTER_OBJECTIVE_CAPTURE_MS
                && obstacle.slotOneCaptureMs >= obstacle.slotTwoCaptureMs ? 1 : 2;
        return fighters.stream()
                .filter(fighter -> fighter.slot == winningSlot)
                .findFirst()
                .orElse(null);
    }

    private static void applyCenterObjective(Fighter collector, Fighter target, String type, Action collectorAction, Action targetAction) {
        if (target == null) return;
        if (RADAR_JAMMER_TYPE.equals(type)) {
            target.jammedMs = CENTER_EFFECT_DURATION_MS;
        } else if (COMMAND_LOCK_TYPE.equals(type)) {
            target.commandLockedMs = CENTER_EFFECT_DURATION_MS;
            target.commandLockAction = targetAction;
        }
    }

    private static void applyBuffPickup(Fighter collector, String type) {
        if (OVERDRIVE_TYPE.equals(type)) {
            collector.overdriveMs = BUFF_DURATION_MS;
        } else if (BARRIER_TYPE.equals(type)) {
            collector.shieldHp += BARRIER_SHIELD_HP;
            collector.barrierImmunityMs = BUFF_DURATION_MS;
        } else if (INHIBITION_TYPE.equals(type)) {
            collector.inhibitionCharges = INHIBITION_ATTACK_CHARGES;
        }
    }

    private static boolean isConsumablePickupType(String type) {
        return "healthPack".equals(type);
    }

    private static boolean isBuffPickupType(String type) {
        return OVERDRIVE_TYPE.equals(type) || BARRIER_TYPE.equals(type) || INHIBITION_TYPE.equals(type);
    }

    private static boolean isCenterObjectiveType(String type) {
        return RADAR_JAMMER_TYPE.equals(type) || COMMAND_LOCK_TYPE.equals(type);
    }

    private static boolean isPlaceableObstacleType(String type) {
        return "healthPack".equals(type)
                || PROJECTILE_WALL_TYPE.equals(type)
                || BOUNCY_WALL_TYPE.equals(type)
                || isBuffPickupType(type)
                || isCenterObjectiveType(type);
    }

    private static List<Obstacle> createCenterObstacles(SeededRandom random, Arena arena) {
        List<Obstacle> obstacles = new ArrayList<>();
        String centerType = random.next() < 0.5 ? RADAR_JAMMER_TYPE : COMMAND_LOCK_TYPE;
        obstacles.add(new Obstacle(
                "object_center",
                centerType,
                arena.width() / 2.0,
                arena.height() / 2.0,
                CENTER_OBJECTIVE_SIZE,
                0.0,
                0,
                0));
        List<String> centerBuffTypes = List.of(OVERDRIVE_TYPE, BARRIER_TYPE, INHIBITION_TYPE);
        double buffOffset = arena.width() / 4.0;
        for (int buffIndex = 0; buffIndex < 2; buffIndex += 1) {
            String type = centerBuffTypes.get((int) Math.floor(random.next() * centerBuffTypes.size()));
            double side = buffIndex == 0 ? -1.0 : 1.0;
            obstacles.add(new Obstacle(
                    "object_buff_" + (buffIndex + 1),
                    type,
                    clamp(arena.width() / 2.0 + side * buffOffset, BUFF_PICKUP_SIZE / 2.0, arena.width() - BUFF_PICKUP_SIZE / 2.0),
                    arena.height() / 2.0,
                    BUFF_PICKUP_SIZE,
                    0.0,
                    0,
                    KILLABLE_BUFF_HP));
        }
        return obstacles;
    }

    private static List<Obstacle> normalizeRequestObstacles(List<ObstacleRequest> obstacles, Arena arena) {
        return obstacles.stream()
                .filter(obstacle -> isPlaceableObstacleType(obstacle.type()))
                .limit(MAX_ARENA_OBJECTS)
                .map(obstacle -> {
                    String type = obstacle.type();
                    int defaultSize = defaultObstacleSize(type);
                    int size = (int) clamp(obstacle.size() != null ? obstacle.size() : defaultSize, 16, 240);
                    return new Obstacle(
                            obstacle.id() != null ? obstacle.id() : "object_1",
                            type,
                            clamp(obstacle.x() != null ? obstacle.x() : arena.width() / 2.0, size / 2.0, arena.width() - size / 2.0),
                            clamp(obstacle.y() != null ? obstacle.y() : arena.height() / 2.0, size / 2.0, arena.height() - size / 2.0),
                            size,
                            isWallType(type) ? snapWallRotation(obstacle.rotation()) : 0.0,
                            BOUNCY_WALL_TYPE.equals(type) ? BOUNCY_WALL_MAX_USES : 0,
                            isBuffPickupType(type) ? KILLABLE_BUFF_HP : 0);
                })
                .toList();
    }

    private static int defaultObstacleSize(String type) {
        if ("healthPack".equals(type)) return HEALTH_PACK_SIZE;
        if (isBuffPickupType(type)) return BUFF_PICKUP_SIZE;
        if (isCenterObjectiveType(type)) return CENTER_OBJECTIVE_SIZE;
        return PROJECTILE_WALL_LENGTH;
    }

    private static MatchPlaybackDTO.FighterPlacementDTO toPlacement(Fighter fighter) {
        return new MatchPlaybackDTO.FighterPlacementDTO(
                fighter.userId,
                fighter.username,
                fighter.slot,
                round(fighter.x),
                round(fighter.y),
                round(fighter.rotation),
                fighter.hp,
                fighter.combatClass,
                fighter.attackActiveMs > 0 || fighter.gunShotActive || fighter.fireballActiveMs > 0 || fighter.stunActiveMs > 0,
                fighter.blockActive,
                "mage".equals(fighter.combatClass) ? fighter.fireballCharges : fighter.gunAmmo,
                "mage".equals(fighter.combatClass) ? fighter.fireballReloadMs : fighter.gunReloadMs,
                fighter.shieldHp,
                fighter.overdriveMs,
                fighter.barrierImmunityMs,
                fighter.inhibitionCharges,
                fighter.slowedMs,
                fighter.jammedMs,
                fighter.commandLockedMs);
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(Obstacle obstacle) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                obstacle.id,
                obstacle.type,
                round(obstacle.x),
                round(obstacle.y),
                obstacle.size,
                obstacle.rotation,
                obstacle.hp,
                obstacle.slotOneCaptureMs,
                obstacle.slotTwoCaptureMs);
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(Grenade grenade) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                grenade.id(),
                "grenade",
                round(grenade.x()),
                round(grenade.y()),
                grenade.size());
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(GrenadeExplosion explosion) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                explosion.id(),
                "grenadeExplosion",
                round(explosion.x()),
                round(explosion.y()),
                explosion.size());
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(Fireball fireball) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                fireball.id(),
                "fireball",
                round(fireball.x()),
                round(fireball.y()),
                fireball.size());
    }

    private static boolean overlapsObstacle(Fighter fighter, Obstacle obstacle) {
        return Math.hypot(fighter.x - obstacle.x, fighter.y - obstacle.y)
                <= ((fighter.size) + obstacle.size) / 2.0;
    }

    private static boolean overlapsShape(Entity first, Entity second, double padding) {
        return Math.hypot(first.x() - second.x(), first.y() - second.y())
                <= ((first.size()) + second.size()) / 2.0 + padding;
    }

    private static List<Obstacle> obstacleSlots(List<Obstacle> obstacles) {
        return obstacles.stream()
                .filter(obstacle -> isPlaceableObstacleType(obstacle.type))
                .sorted(Comparator.comparing(obstacle -> obstacle.id))
                .limit(MAX_ARENA_OBJECTS)
                .toList();
    }

    private static int comparePriorityEntries(PriorityEntry first, PriorityEntry second) {
        int clusterPriority = Integer.compare(first.clusterPriority(), second.clusterPriority());
        if (clusterPriority != 0) return clusterPriority;
        int blockPriority = Integer.compare(first.block().priority, second.block().priority);
        if (blockPriority != 0) return blockPriority;
        int clusterIndex = Integer.compare(first.clusterIndex(), second.clusterIndex());
        if (clusterIndex != 0) return clusterIndex;
        return Integer.compare(first.blockIndex(), second.blockIndex());
    }

    private static String actionHead(String action) {
        if ("rotate_toward_enemy".equals(action)) return "rotation";
        if ("swing".equals(action)) return "swing";
        if ("block".equals(action)) return "block";
        if ("fire_gun".equals(action)) return "gun";
        if ("throw_grenade".equals(action)) return "grenade";
        if ("shoot_fireball".equals(action)) return "fireball";
        if ("stun".equals(action)) return "stun";
        if ("no_dash".equals(action) || action.startsWith("dash")) return "dash";
        return "movement";
    }

    private static int normalizePriority(double value) {
        return (int) clamp(Math.round(Double.isFinite(value) ? value : 1.0), MIN_PRIORITY, MAX_PRIORITY);
    }

    private static String normalizeTarget(String target, String fallback) {
        if ("opponent".equals(target) || "opponent_grenade".equals(target) || "opponent_fireball".equals(target) || OBJECT_TARGET.matcher(target).matches()) return target;
        return fallback;
    }

    private static JsonNode field(JsonNode node, String field) {
        return node != null && node.isObject() ? node.get(field) : null;
    }

    private static String textValue(JsonNode node, String fallback) {
        return node != null && node.isTextual() ? node.asText() : fallback;
    }

    private static double numberValue(JsonNode node, double fallback) {
        return node != null && node.isNumber() ? node.asDouble() : fallback;
    }

    private static Operand normalizeOperand(JsonNode node) {
        if (node == null || !node.isObject()) return Operand.number(0.0);
        String type = textValue(node.get("type"), "number");
        if ("variable".equals(type)) {
            return Operand.variable(textValue(node.get("value"), ""));
        }
        if ("boolean".equals(type)) {
            return Operand.bool(booleanValue(node.get("value"), true));
        }
        return Operand.number(numberValue(node.get("value"), 0.0));
    }

    private static boolean booleanValue(JsonNode node, boolean fallback) {
        if (node == null) return fallback;
        if (node.isBoolean()) return node.asBoolean();
        if (node.isNumber()) return node.asInt() != 0;
        if (node.isTextual()) {
            String value = node.asText();
            if ("true".equalsIgnoreCase(value) || "1".equals(value)) return true;
            if ("false".equalsIgnoreCase(value) || "0".equals(value)) return false;
        }
        return fallback;
    }

    private static double radialVelocityTowardPlayer(Fighter player, Fighter opponent) {
        double dx = player.x - opponent.x;
        double dy = player.y - opponent.y;
        double distance = Math.hypot(dx, dy);
        if (distance < 0.001) return 0;
        return (opponent.velocityX * dx / distance) + (opponent.velocityY * dy / distance);
    }

    private static double edgeDistancePixels(Entity entity) {
        double radius = entity.size() / 2.0;
        return Math.max(0, Math.min(
                Math.min(entity.x() - radius, CANVAS_SIZE - radius - entity.x()),
                Math.min(entity.y() - radius, CANVAS_SIZE - radius - entity.y())));
    }

    private static double turnTowardTarget(Fighter player, Entity target) {
        if (player == null || target == null) return 0;
        double bearing = Math.atan2(target.y() - player.y, target.x() - player.x) * 180.0 / Math.PI;
        return clamp(angleDelta(player.rotation, bearing) / TURN_SPEED_DEGREES, -1, 1);
    }

    private static Vector addVectors(Vector first, Vector second) {
        return new Vector(first.dx() + second.dx(), first.dy() + second.dy());
    }

    private static void moveFighter(Fighter fighter, double dx, double dy, double speed, Arena arena) {
        double radius = fighter.size / 2.0;
        fighter.x = clamp(fighter.x + dx * speed, radius, arena.width() - radius);
        fighter.y = clamp(fighter.y + dy * speed, radius, arena.height() - radius);
        fighter.velocityX = dx * speed / (STEP_MS / 1000.0);
        fighter.velocityY = dy * speed / (STEP_MS / 1000.0);
    }

    private static Vector nextMovementVelocity(Fighter fighter, Action action, double actionMagnitude, double maxMoveSpeed) {
        Vector current = new Vector(fighter.movementVelocityX, fighter.movementVelocityY);
        if (!Double.isFinite(actionMagnitude) || actionMagnitude <= 0.001) {
            return new Vector(
                    decelerateVelocityComponent(current.dx(), MOVE_ACCELERATION_PER_TICK),
                    decelerateVelocityComponent(current.dy(), MOVE_ACCELERATION_PER_TICK));
        }

        double inputX = action.dx() / actionMagnitude;
        double inputY = action.dy() / actionMagnitude;
        return clampVelocity(new Vector(
                nextVelocityComponent(current.dx(), inputX),
                nextVelocityComponent(current.dy(), inputY)), maxMoveSpeed);
    }

    private static double nextVelocityComponent(double current, double input) {
        if (!Double.isFinite(current) || !Double.isFinite(input)) return 0.0;
        if (Math.abs(input) <= 0.001) {
            return decelerateVelocityComponent(current, MOVE_ACCELERATION_PER_TICK);
        }
        double acceleration = current * input < -0.001
                ? MOVE_BRAKE_ACCELERATION_PER_TICK
                : MOVE_ACCELERATION_PER_TICK;
        return current + input * acceleration;
    }

    private static double decelerateVelocityComponent(double value, double amount) {
        if (!Double.isFinite(value) || Math.abs(value) <= amount) return 0.0;
        return value > 0 ? value - amount : value + amount;
    }

    private static Vector clampVelocity(Vector velocity, double maxSpeed) {
        double speed = Math.hypot(velocity.dx(), velocity.dy());
        if (!Double.isFinite(speed) || speed <= maxSpeed) return velocity;
        return new Vector(velocity.dx() / speed * maxSpeed, velocity.dy() / speed * maxSpeed);
    }

    private static void moveFighterByVelocity(Fighter fighter, double velocityX, double velocityY, Arena arena) {
        double radius = fighter.size / 2.0;
        fighter.x = clamp(fighter.x + velocityX, radius, arena.width() - radius);
        fighter.y = clamp(fighter.y + velocityY, radius, arena.height() - radius);
        fighter.velocityX = velocityX / (STEP_MS / 1000.0);
        fighter.velocityY = velocityY / (STEP_MS / 1000.0);
    }

    private static double normalizeDegrees(double value) {
        return ((value % 360.0) + 360.0) % 360.0;
    }

    private static double angleDelta(double from, double to) {
        return ((to - from + 540.0) % 360.0) - 180.0;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double round(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    @SafeVarargs
    private static <T> T firstNonNull(T... values) {
        for (T value : values) {
            if (value != null) return value;
        }
        return null;
    }

    public record DuelSimulationRequest(
            UUID matchId,
            String rulesetVersion,
            long seed,
            DuelArenaRequest arena,
            List<DuelFighterRequest> fighters) {
    }

    public record DuelArenaRequest(
            int width,
            int height,
            int durationMs,
            List<ObstacleRequest> obstacles) {
    }

    public record DuelFighterRequest(
            UUID userId,
            String username,
            int slot,
            double x,
            double y,
            Double rotation,
            int size,
            String selectedClass,
            JsonNode brain) {
    }

    public record ObstacleRequest(String id, String type, Double x, Double y, Integer size, Double rotation) {
        public ObstacleRequest(String id, String type, Double x, Double y, Integer size) {
            this(id, type, x, y, size, 0.0);
        }
    }

    private record Arena(int width, int height, int durationMs) {
    }

    private record Action(double dx, double dy, double dRot, double swing, double block, double gun, double grenade, double fireball, double stun, double dash) {
    }

    private record Vector(double dx, double dy) {
    }

    private enum ValueType {
        NUMBER,
        BOOLEAN
    }

    private record StateValue(ValueType type, double numberValue, boolean booleanValue) {
        static StateValue number(double value) {
            return new StateValue(ValueType.NUMBER, value, false);
        }

        static StateValue bool(boolean value) {
            return new StateValue(ValueType.BOOLEAN, 0.0, value);
        }
    }

    private record Operand(String type, String valueText, double numberValue, boolean booleanValue) {
        static Operand variable(String value) {
            return new Operand("variable", value, 0.0, false);
        }

        static Operand number(double value) {
            return new Operand("number", "", value, false);
        }

        static Operand bool(boolean value) {
            return new Operand("boolean", "", 0.0, value);
        }

        StateValue toStateValue(ValueType expectedType) {
            return expectedType == ValueType.BOOLEAN
                    ? StateValue.bool(booleanValue)
                    : StateValue.number(numberValue);
        }
    }

    private record Condition(String type, double value, String target, String left, String comparator, Operand right, String join) {
    }

    private record StrategyBlock(int index, String action, String actionTarget, int priority, List<Condition> conditions) {
    }

    private record PriorityEntry(
            StrategyBlock block,
            int blockIndex,
            int clusterIndex,
            int clusterPriority,
            List<Condition> clusterConditions) {
    }

    private interface Entity {
        double x();

        double y();

        int size();
    }

    private static final class Fighter implements Entity {
        private UUID userId;
        private String username;
        private int slot;
        private double x;
        private double y;
        private double rotation;
        private int size;
        private String combatClass;
        private JsonNode brain;
        private int hp;
        private int shieldHp;
        private int overdriveMs;
        private int barrierImmunityMs;
        private int inhibitionCharges;
        private int slowedMs;
        private int jammedMs;
        private int commandLockedMs;
        private Action commandLockAction;
        private int attackCooldownMs;
        private int attackActiveMs;
        private int blockCooldownMs;
        private int blockActiveMs;
        private int blockCharges;
        private int blockRechargeMs;
        private boolean blockActive;
        private int gunCooldownMs;
        private int gunActiveMs;
        private boolean gunShotActive;
        private int gunAmmo;
        private int gunReloadMs;
        private int grenadeCooldownMs;
        private int grenadeSerial = 1;
        private Grenade thrownGrenade;
        private int fireballCooldownMs;
        private int fireballActiveMs;
        private int fireballCharges;
        private int fireballReloadMs;
        private int fireballSerial = 1;
        private Fireball thrownFireball;
        private int burnRemainingMs;
        private int burnTickMs;
        private double burnDamageMultiplier = 1.0;
        private int stunCooldownMs;
        private int stunActiveMs;
        private boolean stunCastActive;
        private int stunnedMs;
        private int dashCharges;
        private int dashRechargeMs;
        private List<Integer> dashChargeRechargeMs = new ArrayList<>();
        private int dashActiveMs;
        private double dashDirectionX;
        private double dashDirectionY;
        private double movementVelocityX;
        private double movementVelocityY;
        private double velocityX;
        private double velocityY;
        private List<String> damageZoneIds = new ArrayList<>();
        private boolean inDamageZone;

        @Override
        public double x() {
            return x;
        }

        @Override
        public double y() {
            return y;
        }

        @Override
        public int size() {
            return size;
        }
    }

    private record Obstacle(
            String id,
            String type,
            double x,
            double y,
            int size,
            double rotation,
            int usesRemaining,
            int hp,
            int slotOneCaptureMs,
            int slotTwoCaptureMs) implements Entity {
        private Obstacle(String id, String type, double x, double y, int size, double rotation, int usesRemaining) {
            this(id, type, x, y, size, rotation, usesRemaining, 0, 0, 0);
        }

        private Obstacle(String id, String type, double x, double y, int size, double rotation, int usesRemaining, int hp) {
            this(id, type, x, y, size, rotation, usesRemaining, hp, 0, 0);
        }

        private Obstacle withCapture(int slotOneCaptureMs, int slotTwoCaptureMs) {
            return new Obstacle(id, type, x, y, size, rotation, usesRemaining, hp, slotOneCaptureMs, slotTwoCaptureMs);
        }

        private Obstacle withHp(int hp) {
            return new Obstacle(id, type, x, y, size, rotation, usesRemaining, hp, slotOneCaptureMs, slotTwoCaptureMs);
        }
    }

    private record Grenade(
            String id,
            UUID ownerUserId,
            double x,
            double y,
            int size,
            double velocityX,
            double velocityY,
            int stoppedMs,
            boolean reflected,
            double damageMultiplier) implements Entity {
    }

    private record Fireball(
            String id,
            UUID ownerUserId,
            double x,
            double y,
            int size,
            double velocityX,
            double velocityY,
            double traveled,
            boolean reflected,
            double damageMultiplier) implements Entity {
    }

    private record GrenadeExplosion(
            String id,
            double x,
            double y,
            int size,
            int visibleMs,
            UUID ownerUserId,
            double damageMultiplier) implements Entity {
    }

    private record GrenadeUpdate(
            List<Grenade> grenades,
            List<GrenadeExplosion> explosions,
            List<Obstacle> obstacles) {
    }

    private record FireballHit(UUID ownerUserId, UUID targetUserId, double damageMultiplier) {
    }

    private record FireballUpdate(
            List<Fireball> fireballs,
            List<FireballHit> hits,
            List<Obstacle> obstacles) {
    }

    private record WallReflection(
            Obstacle wall,
            double distance,
            double hitX,
            double hitY,
            double outX,
            double outY) {
    }

    private record GunReflection(boolean reflected, Fighter target, List<Obstacle> obstacles) {
    }

    private record FighterRayHit(Fighter fighter, Double distance) {
    }

    private static final class ActionPlan {
        private StrategyBlock primary;
        private StrategyBlock movement;
        private StrategyBlock dashMovement;
        private StrategyBlock rotation;
        private StrategyBlock swing;
        private StrategyBlock block;
        private StrategyBlock gun;
        private StrategyBlock grenade;
        private StrategyBlock fireball;
        private StrategyBlock stun;
        private StrategyBlock dash;
    }

    private static final class SeededRandom {
        private int state;

        private SeededRandom(String seedValue) {
            state = 0x811C9DC5;
            String seedText = seedValue != null ? seedValue : "";
            for (int index = 0; index < seedText.length(); index += 1) {
                state ^= seedText.charAt(index);
                state *= 16_777_619;
            }
        }

        private double next() {
            state += 0x6D2B79F5;
            int value = state;
            value = (value ^ (value >>> 15)) * (value | 1);
            value ^= value + ((value ^ (value >>> 7)) * (value | 61));
            long unsigned = Integer.toUnsignedLong(value ^ (value >>> 14));
            return unsigned / 4_294_967_296.0;
        }
    }
}
