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
    private static final int DAMAGE_ZONE_SIZE = 128;
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
    private static final int DASH_DURATION_MS = 1000;
    private static final int DASH_COOLDOWN_MS = 4500;
    private static final double DASH_SPEED = 20.0;
    private static final int MAX_OBSTACLE_SLOTS = 5;
    private static final int MAX_LOGIC_BLOCKS = 50;
    private static final int MAX_CLUSTERS = 12;
    private static final int MAX_CONDITIONS_PER_BLOCK = 4;
    private static final int MIN_PRIORITY = 1;
    private static final int MAX_PRIORITY = 10;
    private static final Pattern OBJECT_TARGET = Pattern.compile("object_[1-5]");

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
        List<Fighter> occupiedShapes = fighterRequests == null
                ? List.of()
                : fighterRequests.stream()
                        .map(this::fighterFromRequest)
                        .toList();
        return createMatchObstacles(new SeededRandom(seed + ":obstacles"), arena, occupiedShapes).stream()
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
                : createMatchObstacles(new SeededRandom((request.seed()) + ":obstacles"), arena, fighters);

        MatchPlaybackDTO.ArenaStateDTO initialState = new MatchPlaybackDTO.ArenaStateDTO(
                arena.width(),
                arena.height(),
                fighters.stream().map(DuelSimulationService::toPlacement).toList(),
                obstacles.stream().map(DuelSimulationService::toObstaclePlacement).toList());
        List<MatchPlaybackDTO.ReplayFrameDTO> frames = new ArrayList<>();
        List<Grenade> grenades = new ArrayList<>();

        for (int elapsedMs = 0, tick = 0; elapsedMs <= arena.durationMs(); elapsedMs += STEP_MS, tick += 1) {
            Action firstAction = predictAction(fighters.get(0), fighters.get(1), obstacles, grenades);
            Action secondAction = predictAction(fighters.get(1), fighters.get(0), obstacles, grenades);
            boolean firstSwung = applyAction(fighters.get(0), firstAction, arena);
            boolean secondSwung = applyAction(fighters.get(1), secondAction, arena);
            fighters.stream()
                    .map(fighter -> fighter.thrownGrenade)
                    .filter(grenade -> grenade != null)
                    .forEach(grenades::add);
            obstacles = applyObstacleEffects(fighters, obstacles);
            GrenadeUpdate grenadeUpdate = updateGrenades(grenades, fighters, arena);
            grenades = grenadeUpdate.grenades();

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
                fighters.get(1).hp = Math.max(0, fighters.get(1).hp - incomingAttackDamage(fighters.get(0), fighters.get(1)));
            }
            if (secondLanded) {
                fighters.get(0).hp = Math.max(0, fighters.get(0).hp - incomingAttackDamage(fighters.get(1), fighters.get(0)));
            }
            if (firstBlocked) consumeBlockCharges(fighters.get(1), 1);
            if (secondBlocked) consumeBlockCharges(fighters.get(0), 1);

            boolean firstGunBlocked = gunHits(fighters.get(0), fighters.get(1))
                    && blocksAttack(fighters.get(1), fighters.get(0));
            boolean secondGunBlocked = gunHits(fighters.get(1), fighters.get(0))
                    && blocksAttack(fighters.get(0), fighters.get(1));
            boolean firstGunLanded = gunHits(fighters.get(0), fighters.get(1))
                    && !firstGunBlocked;
            boolean secondGunLanded = gunHits(fighters.get(1), fighters.get(0))
                    && !secondGunBlocked;
            if (firstGunLanded) {
                fighters.get(1).hp = Math.max(0, fighters.get(1).hp - incomingGunDamage(fighters.get(0), fighters.get(1)));
            }
            if (secondGunLanded) {
                fighters.get(0).hp = Math.max(0, fighters.get(0).hp - incomingGunDamage(fighters.get(1), fighters.get(0)));
            }
            if (firstGunBlocked) consumeBlockCharges(fighters.get(1), 1);
            if (secondGunBlocked) consumeBlockCharges(fighters.get(0), 1);
            applyGrenadeExplosions(fighters, grenadeUpdate.explosions());

            List<MatchPlaybackDTO.ObstaclePlacementDTO> frameObstacles = new ArrayList<>();
            frameObstacles.addAll(obstacles.stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(grenades.stream().map(DuelSimulationService::toObstaclePlacement).toList());
            frameObstacles.addAll(grenadeUpdate.explosions().stream().map(DuelSimulationService::toObstaclePlacement).toList());

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
        fighter.gunAmmo = classSpec(fighter).gunAmmoMax();
        fighter.gunReloadMs = 0;
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

    private Action predictAction(Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades) {
        ActionPlan plan = selectStrategyActionPlan(player.brain, player, opponent, obstacles, grenades);
        boolean canDash = classSpec(player).canDash();
        StrategyBlock movementBlock = plan.movement != null ? plan.movement : canDash ? plan.dashMovement : null;
        StrategyBlock facingBlock = firstNonNull(plan.rotation, plan.swing, plan.block, plan.grenade);
        Entity movementTarget = targetEntity(movementBlock != null ? movementBlock.actionTarget : "opponent", opponent, obstacles, grenades);
        Entity facingTarget = targetEntity(facingBlock != null
                ? facingBlock.actionTarget
                : movementBlock != null ? movementBlock.actionTarget : "opponent", opponent, obstacles, grenades);
        Vector movement = movementVectorForAction(movementBlock != null ? movementBlock.action : "move_stop", player, movementTarget);
        String turnAction = facingBlock != null ? facingBlock.action : "move_stop";
        boolean shouldTurn = "rotate_toward_enemy".equals(turnAction)
                || "swing".equals(turnAction)
                || "block".equals(turnAction)
                || "throw_grenade".equals(turnAction);
        return new Action(
                movement.dx(),
                movement.dy(),
                shouldTurn ? turnTowardTarget(player, facingTarget) : 0.0,
                plan.swing != null && "swing".equals(plan.swing.action) ? 1.0 : 0.0,
                plan.block != null && "block".equals(plan.block.action) ? 1.0 : 0.0,
                plan.gun != null && "fire_gun".equals(plan.gun.action) ? 1.0 : 0.0,
                plan.grenade != null && "throw_grenade".equals(plan.grenade.action) ? 1.0 : 0.0,
                canDash && plan.dash != null && plan.dash.action.startsWith("dash") ? 1.0 : 0.0);
    }

    private ActionPlan selectStrategyActionPlan(JsonNode strategy, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades) {
        List<PriorityEntry> selected = selectPriorityEntries(strategy, player, opponent, obstacles, grenades);
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

    private List<PriorityEntry> selectPriorityEntries(JsonNode strategy, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades) {
        List<PriorityEntry> matching = normalizeStrategyEntries(strategy).stream()
                .filter(entry -> entry.clusterConditions().stream().allMatch(condition -> evaluateCondition(condition, player, opponent, obstacles, grenades))
                        && entry.block().conditions.stream().allMatch(condition -> evaluateCondition(condition, player, opponent, obstacles, grenades)))
                .sorted(DuelSimulationService::comparePriorityEntries)
                .toList();
        if (matching.isEmpty()) return List.of();
        PriorityEntry winner = matching.get(0);
        return matching.stream()
                .filter(entry -> entry.clusterPriority() == winner.clusterPriority()
                        && entry.block().priority == winner.block().priority)
                .toList();
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
                    normalizeOperand(field(condition, "right"))));
        }
        return normalized;
    }

    private boolean evaluateCondition(Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades) {
        if ("expression".equals(condition.type())) {
            return evaluateExpressionCondition(condition, player, opponent, obstacles, grenades);
        }
        Entity target = targetEntity(condition.target(), opponent, obstacles, grenades);
        double distance = target != null ? Math.hypot(target.x() - player.x, target.y() - player.y) : Double.POSITIVE_INFINITY;
        return switch (condition.type()) {
            case "always" -> true;
            case "enemy_distance_lt" -> distance < condition.value();
            case "enemy_distance_gt" -> distance > condition.value();
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
            case "my_swing_ready" -> player.attackCooldownMs <= 0;
            case "my_swing_cooldown" -> player.attackCooldownMs > 0;
            case "my_block_ready" -> player.blockCharges > 0;
            case "my_block_cooldown" -> player.blockCharges <= 0;
            case "my_shield_up" -> player.blockActive;
            case "my_shield_down" -> !player.blockActive;
            case "my_shield_charges_lt" -> player.blockCharges < condition.value();
            case "my_shield_charges_gt" -> player.blockCharges > condition.value();
            case "my_dash_ready" -> canDash(player) && player.dashCooldownMs <= 0 && player.dashActiveMs <= 0;
            case "my_dash_cooldown" -> canDash(player) && (player.dashCooldownMs > 0 || player.dashActiveMs > 0);
            case "my_fire_gun_ready" -> "ranged".equals(player.combatClass)
                    && player.gunAmmo > 0 && player.gunReloadMs <= 0
                    && player.gunCooldownMs <= 0 && player.gunActiveMs <= 0;
            case "my_fire_gun_cooldown" -> "ranged".equals(player.combatClass)
                    && (player.gunAmmo <= 0 || player.gunReloadMs > 0 || player.gunCooldownMs > 0 || player.gunActiveMs > 0);
            case "my_grenade_ready" -> classSpec(player).canThrowGrenade() && player.grenadeCooldownMs <= 0;
            case "my_grenade_cooldown" -> classSpec(player).canThrowGrenade() && player.grenadeCooldownMs > 0;
            case "opponent_swing_ready" -> opponent.attackCooldownMs <= 0;
            case "opponent_swing_cooldown" -> opponent.attackCooldownMs > 0;
            case "opponent_block_ready" -> opponent.blockCharges > 0;
            case "opponent_block_cooldown" -> opponent.blockCharges <= 0;
            case "opponent_shield_up" -> opponent.blockActive;
            case "opponent_shield_down" -> !opponent.blockActive;
            case "opponent_shield_charges_lt" -> opponent.blockCharges < condition.value();
            case "opponent_shield_charges_gt" -> opponent.blockCharges > condition.value();
            case "opponent_dash_ready" -> canDash(opponent) && opponent.dashCooldownMs <= 0 && opponent.dashActiveMs <= 0;
            case "opponent_dash_cooldown" -> canDash(opponent) && (opponent.dashCooldownMs > 0 || opponent.dashActiveMs > 0);
            case "opponent_fire_gun_ready" -> "ranged".equals(opponent.combatClass)
                    && opponent.gunAmmo > 0 && opponent.gunReloadMs <= 0
                    && opponent.gunCooldownMs <= 0 && opponent.gunActiveMs <= 0;
            case "opponent_fire_gun_cooldown" -> "ranged".equals(opponent.combatClass)
                    && (opponent.gunAmmo <= 0 || opponent.gunReloadMs > 0 || opponent.gunCooldownMs > 0 || opponent.gunActiveMs > 0);
            case "opponent_grenade_ready" -> classSpec(opponent).canThrowGrenade() && opponent.grenadeCooldownMs <= 0;
            case "opponent_grenade_cooldown" -> classSpec(opponent).canThrowGrenade() && opponent.grenadeCooldownMs > 0;
            case "target_exists" -> !"opponent".equals(condition.target()) && target != null;
            case "target_missing" -> !"opponent".equals(condition.target()) && target == null;
            case "target_health_pack" -> target instanceof Obstacle obstacle && "healthPack".equals(obstacle.type);
            case "target_damage_zone" -> target instanceof Obstacle obstacle && "damageZone".equals(obstacle.type);
            case "inside_damage_zone" -> obstacles.stream()
                    .anyMatch(obstacle -> "damageZone".equals(obstacle.type) && overlapsObstacle(player, obstacle));
            default -> false;
        };
    }

    private boolean evaluateExpressionCondition(Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades) {
        StateValue left = resolveStateVariable(condition.left(), condition, player, opponent, obstacles, grenades);
        if (left == null) return false;
        StateValue right = "variable".equals(condition.right().type())
                ? resolveStateVariable(condition.right().valueText(), condition, player, opponent, obstacles, grenades)
                : condition.right().toStateValue(left.type());
        if (right == null || left.type() != right.type()) return false;
        return compareValues(left, condition.comparator(), right);
    }

    private StateValue resolveStateVariable(String variable, Condition condition, Fighter player, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades) {
        Entity target = targetEntity(condition.target(), opponent, obstacles, grenades);
        return switch (variable) {
            case "my.hp" -> StateValue.number(player.hp);
            case "opponent.hp" -> StateValue.number(opponent.hp);
            case "target.distance" -> StateValue.number(target != null
                    ? Math.hypot(target.x() - player.x, target.y() - player.y)
                    : Double.POSITIVE_INFINITY);
            case "my.edgeDistance" -> StateValue.number(edgeDistancePixels(player));
            case "target.edgeDistance" -> StateValue.number(target != null ? edgeDistancePixels(target) : 0.0);
            case "my.swingReady" -> StateValue.bool(player.attackCooldownMs <= 0);
            case "my.swingCooldownMs" -> StateValue.number(player.attackCooldownMs);
            case "my.blockReady" -> StateValue.bool(player.blockCharges > 0);
            case "my.shieldUp" -> StateValue.bool(player.blockActive);
            case "my.shieldCharges" -> StateValue.number(player.blockCharges);
            case "my.blockRechargeMs" -> StateValue.number(player.blockRechargeMs);
            case "my.dashReady" -> StateValue.bool(canDash(player) && player.dashCooldownMs <= 0 && player.dashActiveMs <= 0);
            case "my.dashCooldownMs" -> StateValue.number(Math.max(player.dashCooldownMs, player.dashActiveMs));
            case "my.gunReady" -> StateValue.bool("ranged".equals(player.combatClass)
                    && player.gunAmmo > 0 && player.gunReloadMs <= 0
                    && player.gunCooldownMs <= 0 && player.gunActiveMs <= 0);
            case "my.gunCooldownMs" -> StateValue.number(player.gunCooldownMs);
            case "my.gunAmmo" -> StateValue.number(player.gunAmmo);
            case "my.gunReloadMs" -> StateValue.number(player.gunReloadMs);
            case "my.grenadeReady" -> StateValue.bool(classSpec(player).canThrowGrenade() && player.grenadeCooldownMs <= 0);
            case "my.grenadeCooldownMs" -> StateValue.number(player.grenadeCooldownMs);
            case "opponent.swingReady" -> StateValue.bool(opponent.attackCooldownMs <= 0);
            case "opponent.swingCooldownMs" -> StateValue.number(opponent.attackCooldownMs);
            case "opponent.blockReady" -> StateValue.bool(opponent.blockCharges > 0);
            case "opponent.shieldUp" -> StateValue.bool(opponent.blockActive);
            case "opponent.shieldCharges" -> StateValue.number(opponent.blockCharges);
            case "opponent.blockRechargeMs" -> StateValue.number(opponent.blockRechargeMs);
            case "opponent.dashReady" -> StateValue.bool(canDash(opponent) && opponent.dashCooldownMs <= 0 && opponent.dashActiveMs <= 0);
            case "opponent.dashCooldownMs" -> StateValue.number(Math.max(opponent.dashCooldownMs, opponent.dashActiveMs));
            case "opponent.gunReady" -> StateValue.bool("ranged".equals(opponent.combatClass)
                    && opponent.gunAmmo > 0 && opponent.gunReloadMs <= 0
                    && opponent.gunCooldownMs <= 0 && opponent.gunActiveMs <= 0);
            case "opponent.gunCooldownMs" -> StateValue.number(opponent.gunCooldownMs);
            case "opponent.gunAmmo" -> StateValue.number(opponent.gunAmmo);
            case "opponent.gunReloadMs" -> StateValue.number(opponent.gunReloadMs);
            case "opponent.grenadeReady" -> StateValue.bool(classSpec(opponent).canThrowGrenade() && opponent.grenadeCooldownMs <= 0);
            case "opponent.grenadeCooldownMs" -> StateValue.number(opponent.grenadeCooldownMs);
            case "target.exists" -> StateValue.bool(!"opponent".equals(condition.target()) && target != null);
            case "target.isHealthPack" -> StateValue.bool(target instanceof Obstacle obstacle && "healthPack".equals(obstacle.type));
            case "target.isDamageZone" -> StateValue.bool(target instanceof Obstacle obstacle && "damageZone".equals(obstacle.type));
            case "my.insideDamageZone" -> StateValue.bool(obstacles.stream()
                    .anyMatch(obstacle -> "damageZone".equals(obstacle.type) && overlapsObstacle(player, obstacle)));
            default -> null;
        };
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

    private static Entity targetEntity(String target, Fighter opponent, List<Obstacle> obstacles, List<Grenade> grenades) {
        if ("opponent".equals(target)) return opponent;
        if ("opponent_grenade".equals(target)) {
            return grenades.stream()
                    .filter(grenade -> opponent.userId.equals(grenade.ownerUserId()))
                    .findFirst()
                    .orElse(null);
        }
        return obstacleSlots(obstacles).stream()
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
                || "throw_grenade".equals(action)) {
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
        fighter.attackCooldownMs = Math.max(0, fighter.attackCooldownMs - STEP_MS);
        fighter.attackActiveMs = Math.max(0, fighter.attackActiveMs - STEP_MS);
        rechargeBlock(fighter, spec);
        fighter.blockActive = false;
        fighter.dashCooldownMs = Math.max(0, fighter.dashCooldownMs - STEP_MS);
        fighter.dashActiveMs = Math.max(0, fighter.dashActiveMs - STEP_MS);
        fighter.gunCooldownMs = Math.max(0, fighter.gunCooldownMs - STEP_MS);
        fighter.gunActiveMs = Math.max(0, fighter.gunActiveMs - STEP_MS);
        reloadGun(fighter, spec);
        fighter.gunShotActive = false;
        fighter.grenadeCooldownMs = Math.max(0, fighter.grenadeCooldownMs - STEP_MS);
        fighter.thrownGrenade = null;

        boolean swungThisTick = false;
        double actionMagnitude = Math.hypot(action.dx(), action.dy());
        boolean dashAvailable = spec.canDash() && fighter.dashCooldownMs <= 0;
        boolean isContinuingDash = fighter.dashActiveMs > 0;
        fighter.rotation = normalizeDegrees(fighter.rotation + clamp(action.dRot(), -1, 1) * TURN_SPEED_DEGREES);

        if (isContinuingDash) {
            fighter.movementVelocityX = fighter.dashDirectionX * spec.moveSpeed();
            fighter.movementVelocityY = fighter.dashDirectionY * spec.moveSpeed();
            moveFighter(fighter, fighter.dashDirectionX, fighter.dashDirectionY, DASH_SPEED, arena);
        } else if (action.dash() > 0.5 && dashAvailable) {
            double radians = fighter.rotation * Math.PI / 180.0;
            fighter.dashDirectionX = actionMagnitude > 0.001 ? action.dx() / actionMagnitude : Math.cos(radians);
            fighter.dashDirectionY = actionMagnitude > 0.001 ? action.dy() / actionMagnitude : Math.sin(radians);
            fighter.dashActiveMs = DASH_DURATION_MS;
            fighter.dashCooldownMs = DASH_COOLDOWN_MS;
            fighter.movementVelocityX = fighter.dashDirectionX * spec.moveSpeed();
            fighter.movementVelocityY = fighter.dashDirectionY * spec.moveSpeed();
            moveFighter(fighter, fighter.dashDirectionX, fighter.dashDirectionY, DASH_SPEED, arena);
        }

        if (!isContinuingDash && fighter.dashActiveMs <= 0) {
            Vector movementVelocity = nextMovementVelocity(fighter, action, actionMagnitude, spec.moveSpeed());
            fighter.movementVelocityX = movementVelocity.dx();
            fighter.movementVelocityY = movementVelocity.dy();
            moveFighterByVelocity(fighter, movementVelocity.dx(), movementVelocity.dy(), arena);
        }
        if (action.block() > 0.5 && spec.canBlock() && fighter.blockCharges > 0) {
            fighter.blockActive = true;
        }
        if (!fighter.blockActive && action.swing() > 0.5 && spec.canSwing() && fighter.attackCooldownMs <= 0) {
            fighter.attackActiveMs = ATTACK_ACTIVE_MS;
            fighter.attackCooldownMs = ATTACK_COOLDOWN_MS;
            swungThisTick = true;
        }
        if (!fighter.blockActive && action.gun() > 0.5 && spec.canFireGun()
                && fighter.gunAmmo > 0
                && fighter.gunReloadMs <= 0
                && fighter.gunCooldownMs <= 0 && fighter.gunActiveMs <= 0) {
            fighter.gunAmmo = Math.max(0, fighter.gunAmmo - 1);
            if (fighter.gunAmmo <= 0) {
                fighter.gunReloadMs = spec.gunReloadMs();
            }
            fighter.gunActiveMs = spec.gunActiveMs();
            fighter.gunCooldownMs = spec.gunCooldownMs();
            fighter.gunShotActive = true;
        }
        if (!fighter.blockActive && action.grenade() > 0.5 && spec.canThrowGrenade() && fighter.grenadeCooldownMs <= 0) {
            fighter.grenadeCooldownMs = spec.grenadeCooldownMs();
            fighter.thrownGrenade = createGrenade(fighter);
            fighter.grenadeSerial += 1;
        }
        return swungThisTick;
    }

    private static void rechargeBlock(Fighter fighter, CombatClassSpec spec) {
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
        fighter.blockRechargeMs += STEP_MS;
        while (fighter.blockCharges < spec.blockMaxCharges() && fighter.blockRechargeMs >= spec.blockRechargeMs()) {
            fighter.blockCharges += 1;
            fighter.blockRechargeMs -= spec.blockRechargeMs();
        }
        if (fighter.blockCharges >= spec.blockMaxCharges()) fighter.blockRechargeMs = 0;
    }

    private static void reloadGun(Fighter fighter, CombatClassSpec spec) {
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
        fighter.gunReloadMs = Math.max(0, fighter.gunReloadMs - STEP_MS);
        if (fighter.gunReloadMs <= 0) {
            fighter.gunAmmo = spec.gunAmmoMax();
        }
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

    private boolean gunHits(Fighter attacker, Fighter defender) {
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
                && Math.abs(sideDistance) <= defenderRadius;
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
                0);
    }

    private static GrenadeUpdate updateGrenades(List<Grenade> grenades, List<Fighter> fighters, Arena arena) {
        List<Grenade> remaining = new ArrayList<>();
        List<GrenadeExplosion> explosions = new ArrayList<>();
        for (Grenade grenade : grenades) {
            Grenade next = advanceGrenade(grenade, arena);
            boolean touchedOpponent = fighters.stream()
                    .anyMatch(fighter -> !fighter.userId.equals(next.ownerUserId()) && overlapsShape(fighter, next, 0));
            boolean stoppedLongEnough = Math.hypot(next.velocityX(), next.velocityY()) <= 0.001
                    && next.stoppedMs() >= GRENADE_STOP_FUSE_MS;
            if (touchedOpponent || stoppedLongEnough) {
                explosions.add(new GrenadeExplosion(
                        next.id() + "-explosion",
                        next.x(),
                        next.y(),
                        GRENADE_EXPLOSION_RADIUS * 2,
                        GRENADE_EXPLOSION_VISIBLE_MS,
                        next.ownerUserId()));
            } else {
                remaining.add(next);
            }
        }
        return new GrenadeUpdate(remaining, explosions);
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
        return new Grenade(grenade.id(), grenade.ownerUserId(), nextX, nextY, grenade.size(), velocityX, velocityY, stoppedMs);
    }

    private void applyGrenadeExplosions(List<Fighter> fighters, List<GrenadeExplosion> explosions) {
        for (GrenadeExplosion explosion : explosions) {
            CombatClassSpec ownerSpec = fighters.stream()
                    .filter(fighter -> fighter.userId.equals(explosion.ownerUserId()))
                    .findFirst()
                    .map(this::classSpec)
                    .orElse(combatClasses.forId("ranged"));
            for (Fighter fighter : fighters) {
                int shieldCharges = grenadeShieldChargesToFighter(explosion, fighter);
                if (fighter.blockActive && fighter.blockCharges > 0 && shieldCharges > 0) {
                    consumeBlockCharges(fighter, shieldCharges);
                    continue;
                }
                int damage = grenadeDamageToFighter(ownerSpec, explosion, fighter);
                if (damage > 0) {
                    fighter.hp = Math.max(0, fighter.hp - damage);
                }
            }
        }
    }

    private static int grenadeDamageToFighter(CombatClassSpec ownerSpec, GrenadeExplosion explosion, Fighter fighter) {
        double nearestBodyDistance = Math.max(0.0, Math.hypot(fighter.x - explosion.x(), fighter.y - explosion.y()) - fighter.size / 2.0);
        return ownerSpec.grenadeDamage(nearestBodyDistance);
    }

    private static int grenadeShieldChargesToFighter(GrenadeExplosion explosion, Fighter fighter) {
        double nearestBodyDistance = Math.max(0.0, Math.hypot(fighter.x - explosion.x(), fighter.y - explosion.y()) - fighter.size / 2.0);
        if (nearestBodyDistance > GRENADE_EXPLOSION_RADIUS) return 0;
        double t = Math.max(0.0, Math.min(1.0, nearestBodyDistance / GRENADE_EXPLOSION_RADIUS));
        return (int) Math.max(1, Math.min(5, Math.round(5.0 + (1.0 - 5.0) * t)));
    }

    private List<Obstacle> applyObstacleEffects(List<Fighter> fighters, List<Obstacle> obstacles) {
        List<Obstacle> remainingObstacles = new ArrayList<>();
        for (Obstacle obstacle : obstacles) {
            if (!"healthPack".equals(obstacle.type)) {
                remainingObstacles.add(obstacle);
                continue;
            }
            Fighter collector = fighters.stream()
                    .filter(fighter -> overlapsObstacle(fighter, obstacle))
                    .findFirst()
                    .orElse(null);
            if (collector == null) {
                remainingObstacles.add(obstacle);
                continue;
            }
            collector.hp = Math.min(classSpec(collector).maxHp(), collector.hp + HEALTH_PACK_HEAL);
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
                fighter.hp = Math.max(0, fighter.hp - DAMAGE_ZONE_ENTRY_DAMAGE);
            }
            fighter.damageZoneIds = new ArrayList<>(currentZoneIds);
            fighter.inDamageZone = !currentZoneIds.isEmpty();
        }

        return remainingObstacles;
    }

    private static List<Obstacle> createMatchObstacles(SeededRandom random, Arena arena, List<Fighter> occupiedShapes) {
        int count = 1 + (int) Math.floor(random.next() * MAX_OBSTACLE_SLOTS);
        List<Obstacle> obstacles = new ArrayList<>();
        for (int index = 0; index < count; index += 1) {
            String type = random.next() < 0.5 ? "healthPack" : "damageZone";
            int size = "healthPack".equals(type) ? HEALTH_PACK_SIZE : DAMAGE_ZONE_SIZE;
            Obstacle candidate = null;
            for (int attempt = 0; attempt < 80; attempt += 1) {
                candidate = new Obstacle(
                        "object_" + (index + 1),
                        type,
                        size / 2.0 + random.next() * (arena.width() - size),
                        size / 2.0 + random.next() * (arena.height() - size),
                        size);
                if (!overlapsAny(candidate, occupiedShapes, obstacles, 8)) break;
            }
            obstacles.add(candidate);
        }
        return obstacles;
    }

    private static List<Obstacle> normalizeRequestObstacles(List<ObstacleRequest> obstacles, Arena arena) {
        return obstacles.stream()
                .filter(obstacle -> "healthPack".equals(obstacle.type()) || "damageZone".equals(obstacle.type()))
                .limit(MAX_OBSTACLE_SLOTS)
                .map(obstacle -> {
                    String type = obstacle.type();
                    int defaultSize = "healthPack".equals(type) ? HEALTH_PACK_SIZE : DAMAGE_ZONE_SIZE;
                    int size = (int) clamp(obstacle.size() != null ? obstacle.size() : defaultSize, 16, 240);
                    return new Obstacle(
                            obstacle.id() != null ? obstacle.id() : "object_1",
                            type,
                            clamp(obstacle.x() != null ? obstacle.x() : arena.width() / 2.0, size / 2.0, arena.width() - size / 2.0),
                            clamp(obstacle.y() != null ? obstacle.y() : arena.height() / 2.0, size / 2.0, arena.height() - size / 2.0),
                            size);
                })
                .toList();
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
                fighter.attackActiveMs > 0 || fighter.gunShotActive,
                fighter.blockActive,
                fighter.gunAmmo,
                fighter.gunReloadMs);
    }

    private static MatchPlaybackDTO.ObstaclePlacementDTO toObstaclePlacement(Obstacle obstacle) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(
                obstacle.id,
                obstacle.type,
                round(obstacle.x),
                round(obstacle.y),
                obstacle.size);
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

    private static boolean overlapsAny(Obstacle candidate, List<Fighter> fighters, List<Obstacle> obstacles, double padding) {
        return fighters.stream().anyMatch(fighter -> overlapsShape(fighter, candidate, padding))
                || obstacles.stream().anyMatch(obstacle -> overlapsShape(obstacle, candidate, padding));
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
                .filter(obstacle -> "healthPack".equals(obstacle.type) || "damageZone".equals(obstacle.type))
                .sorted(Comparator.comparing(obstacle -> obstacle.id))
                .limit(MAX_OBSTACLE_SLOTS)
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
        if ("no_dash".equals(action) || action.startsWith("dash")) return "dash";
        return "movement";
    }

    private static int normalizePriority(double value) {
        return (int) clamp(Math.round(Double.isFinite(value) ? value : 1.0), MIN_PRIORITY, MAX_PRIORITY);
    }

    private static String normalizeTarget(String target, String fallback) {
        if ("opponent".equals(target) || "opponent_grenade".equals(target) || OBJECT_TARGET.matcher(target).matches()) return target;
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

    public record ObstacleRequest(String id, String type, Double x, Double y, Integer size) {
    }

    private record Arena(int width, int height, int durationMs) {
    }

    private record Action(double dx, double dy, double dRot, double swing, double block, double gun, double grenade, double dash) {
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

    private record Condition(String type, double value, String target, String left, String comparator, Operand right) {
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
        private int dashCooldownMs;
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

    private record Obstacle(String id, String type, double x, double y, int size) implements Entity {
    }

    private record Grenade(
            String id,
            UUID ownerUserId,
            double x,
            double y,
            int size,
            double velocityX,
            double velocityY,
            int stoppedMs) implements Entity {
    }

    private record GrenadeExplosion(
            String id,
            double x,
            double y,
            int size,
            int visibleMs,
            UUID ownerUserId) implements Entity {
    }

    private record GrenadeUpdate(List<Grenade> grenades, List<GrenadeExplosion> explosions) {
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
