const tf = require("@tensorflow/tfjs");
const { movementFromProbabilities } = require("./movementActions");

const CANVAS_SIZE = 800;
const PLAYER_FEATURES = 7;
const OPPONENT_FEATURES = 6;
const STRATEGY_FEATURES = 13;
const MAX_OBSTACLE_SLOTS = 5;
const OBSTACLE_FEATURES = 6;
const INTENT_TYPES = Object.freeze([
    "none",
    "engage_target",
    "disengage_target",
    "orbit_target",
    "seek_object",
    "avoid_object",
    "reposition",
    "hold_position",
    "attack_target",
    "defend_against_target",
]);
const INTENT_TARGET_TYPES = Object.freeze([
    "none",
    "opponent",
    "object_1",
    "object_2",
    "object_3",
    "object_4",
    "object_5",
]);
const MOVEMENT_STYLE_TYPES = Object.freeze([
    "none",
    "direct_in",
    "direct_out",
    "tangent_left",
    "tangent_right",
    "diagonal_in_left",
    "diagonal_in_right",
    "diagonal_out_left",
    "diagonal_out_right",
    "center",
    "stop",
]);
const DEFAULT_INTENT = Object.freeze({
    intent: "hold_position",
    target: "none",
    movementStyle: "stop",
    dash: 0,
});
const INTENT_FEATURE_SIZE = INTENT_TYPES.length + INTENT_TARGET_TYPES.length + MOVEMENT_STYLE_TYPES.length + 1;
const INTENT_FEATURE_OFFSET = PLAYER_FEATURES + OPPONENT_FEATURES + STRATEGY_FEATURES
    + MAX_OBSTACLE_SLOTS * OBSTACLE_FEATURES;
const INPUT_SIZE = INTENT_FEATURE_OFFSET + INTENT_FEATURE_SIZE;
const STEP_MS = 100;
const MOVE_SPEED = 8;
const TURN_SPEED_DEGREES = 24;
const MAX_HP = 100;
const ATTACK_RANGE = 92;
const ATTACK_ARC_DEGREES = 50;
const ATTACK_DAMAGE = 20;
const HEALTH_PACK_SIZE = 42;
const HEALTH_PACK_HEAL = 50;
const DAMAGE_ZONE_SIZE = 128;
const DAMAGE_ZONE_ENTRY_DAMAGE = 25;
const DAMAGE_ZONE_DAMAGE_MULTIPLIER = 1.5;
const ATTACK_COOLDOWN_MS = 1000;
const ATTACK_ACTIVE_MS = 200;
const BLOCK_ACTIVE_MS = 500;
const BLOCK_COOLDOWN_MS = 1000;
const DASH_DURATION_MS = 1000;
const DASH_COOLDOWN_MS = 4500;
const DASH_SPEED = 20;
const MAX_VELOCITY = 250;

function base64ToArrayBuffer(value) {
    const buffer = Buffer.from(value, "base64");
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadTfjsModel(modelArtifacts) {
    if (!modelArtifacts?.modelTopology || !Array.isArray(modelArtifacts.weightSpecs)) {
        throw new Error("model artifacts are missing modelTopology or weightSpecs");
    }
    return tf.loadLayersModel({
        load: async () => ({
            modelTopology: modelArtifacts.modelTopology,
            weightSpecs: modelArtifacts.weightSpecs,
            weightData: base64ToArrayBuffer(modelArtifacts.weightDataBase64 ?? ""),
        }),
    });
}

function buildInputVector(player, opponent, obstacles = [], intent = DEFAULT_INTENT) {
    const vector = new Float32Array(INPUT_SIZE);
    const perspectiveRotation = player.perspectiveRotation ?? (player.slot === 2 ? 180 : 0);
    const relativePosition = rotateVector(
        opponent.x - player.x,
        opponent.y - player.y,
        -perspectiveRotation
    );
    const dx = relativePosition.dx;
    const dy = relativePosition.dy;
    const bearing = Math.atan2(dy, dx) * 180 / Math.PI;
    const playerRotation = normalizeDegrees(player.rotation - perspectiveRotation);
    const offset = PLAYER_FEATURES;

    vector[0] = playerRotation / 360;
    vector[1] = player.attackCooldownMs <= 0 ? 1 : 0;
    vector[2] = clamp(player.attackCooldownMs / ATTACK_COOLDOWN_MS, 0, 1);
    vector[3] = player.blockCooldownMs <= 0 && player.blockActiveMs <= 0 ? 1 : 0;
    vector[4] = player.blockActiveMs > 0 ? 1 : 0;
    vector[5] = clamp(player.blockActiveMs / BLOCK_ACTIVE_MS, 0, 1);
    vector[6] = clamp(player.blockCooldownMs / BLOCK_COOLDOWN_MS, 0, 1);
    vector[13] = clamp(player.hp / MAX_HP, 0, 1);
    vector[14] = normalizeEdgeDistance(player);
    vector[15] = player.dashCooldownMs <= 0 && player.dashActiveMs <= 0 ? 1 : 0;
    vector[16] = player.dashActiveMs > 0 ? 1 : 0;
    vector[17] = clamp(player.dashCooldownMs / DASH_COOLDOWN_MS, 0, 1);
    vector[offset] = dx / CANVAS_SIZE;
    vector[offset + 1] = dy / CANVAS_SIZE;
    vector[offset + 2] = angleDelta(playerRotation, bearing) / 180;
    vector[offset + 3] = 1;
    vector[offset + 4] = clamp((opponent.size ?? 60) / 200, 0, 1);
    vector[offset + 5] = normalizeDegrees(opponent.rotation - perspectiveRotation) / 360;
    const worldDx = opponent.x - player.x;
    const worldDy = opponent.y - player.y;
    const distance = Math.hypot(worldDx, worldDy);
    const towardX = distance > 0.001 ? -worldDx / distance : 0;
    const towardY = distance > 0.001 ? -worldDy / distance : 0;
    const radialVelocity = (opponent.velocityX ?? 0) * towardX + (opponent.velocityY ?? 0) * towardY;
    vector[18] = clamp(opponent.hp / MAX_HP, 0, 1);
    vector[19] = normalizeEdgeDistance(opponent);
    vector[20] = opponent.attackActiveMs > 0 ? 1 : 0;
    vector[21] = opponent.blockActiveMs > 0 ? 1 : 0;
    const canonicalVelocity = rotateVector(
        opponent.velocityX ?? 0,
        opponent.velocityY ?? 0,
        -perspectiveRotation
    );
    vector[22] = clamp(canonicalVelocity.dx / MAX_VELOCITY, -1, 1);
    vector[23] = clamp(canonicalVelocity.dy / MAX_VELOCITY, -1, 1);
    vector[24] = clamp(radialVelocity / MAX_VELOCITY, -1, 1);
    vector[25] = clamp(distance / Math.hypot(CANVAS_SIZE, CANVAS_SIZE), 0, 1);
    obstacleSlots(obstacles).forEach((obstacle, slotIndex) => {
        const obstacleRelativePosition = rotateVector(
            obstacle.x - player.x,
            obstacle.y - player.y,
            -perspectiveRotation
        );
        const obstacleOffset = PLAYER_FEATURES + OPPONENT_FEATURES + STRATEGY_FEATURES + slotIndex * OBSTACLE_FEATURES;
        const obstacleDistance = Math.hypot(obstacle.x - player.x, obstacle.y - player.y);
        vector[obstacleOffset] = 1;
        vector[obstacleOffset + 1] = obstacle.type === "healthPack" ? 1 : 0;
        vector[obstacleOffset + 2] = obstacle.type === "damageZone" ? 1 : 0;
        vector[obstacleOffset + 3] = clamp(obstacleRelativePosition.dx / CANVAS_SIZE, -1, 1);
        vector[obstacleOffset + 4] = clamp(obstacleRelativePosition.dy / CANVAS_SIZE, -1, 1);
        vector[obstacleOffset + 5] = clamp(obstacleDistance / Math.hypot(CANVAS_SIZE, CANVAS_SIZE), 0, 1);
    });
    vector.set(encodeIntentFeatures(intent), INTENT_FEATURE_OFFSET);
    return vector;
}

function selectStrategyIntent(strategy, player, opponent, obstacles) {
    const blocks = normalizeStrategyBlocks(strategy);
    const block = blocks.find((candidate) => candidate.action !== "no_dash" && candidate.conditions.every((condition) => (
        evaluateCondition(condition, player, opponent, obstacles)
    ))) ?? null;
    return block ? intentFromAction(block.action, block.actionTarget) : DEFAULT_INTENT;
}

function shouldSuppressDash(strategy, player, opponent, obstacles) {
    const blocks = normalizeStrategyBlocks(strategy);
    return blocks.some((block) => (
        block.action === "no_dash"
        && block.conditions.every((condition) => evaluateCondition(condition, player, opponent, obstacles))
    ));
}

function shouldAllowDash(strategy, player, opponent, obstacles) {
    return Boolean(selectStrategyIntent(strategy, player, opponent, obstacles).dash)
        && !shouldSuppressDash(strategy, player, opponent, obstacles);
}

function normalizeStrategyBlocks(strategy) {
    const sourceBlocks = Array.isArray(strategy?.blocks) ? strategy.blocks : [];
    return sourceBlocks.slice(0, 8).map((block, index) => ({
        index,
        action: normalizeAction(block?.action),
        actionTarget: normalizeTarget(block?.actionTarget, "opponent"),
        conditions: Array.isArray(block?.conditions)
            ? block.conditions.slice(0, 4).map(normalizeCondition)
            : [],
    }));
}

function normalizeCondition(condition) {
    return {
        type: String(condition?.type ?? ""),
        value: Number.isFinite(Number(condition?.value)) ? Number(condition.value) : 0,
        target: normalizeTarget(condition?.target, "opponent"),
    };
}

function normalizeAction(action) {
    return typeof action === "string" ? action : "move_stop";
}

function normalizeTarget(target, fallback) {
    if (target === "opponent" || /^object_[1-5]$/.test(String(target))) return target;
    return fallback;
}

function evaluateCondition(condition, player, opponent, obstacles) {
    const target = targetEntity(condition.target ?? "opponent", opponent, obstacles);
    const distance = target ? Math.hypot(target.x - player.x, target.y - player.y) : Number.POSITIVE_INFINITY;
    switch (condition.type) {
        case "enemy_distance_lt": return distance < condition.value;
        case "enemy_distance_gt": return distance > condition.value;
        case "my_cornered": return edgeDistancePixels(player) < condition.value;
        case "enemy_cornered": return target ? edgeDistancePixels(target) < condition.value : false;
        case "enemy_attacking": return opponent.attackActiveMs > 0;
        case "enemy_blocking": return opponent.blockActiveMs > 0;
        case "enemy_rushing": return radialVelocityTowardPlayer(player, opponent) > 20;
        case "enemy_fleeing": return radialVelocityTowardPlayer(player, opponent) < -20;
        case "my_hp_lt": return player.hp < condition.value;
        case "my_hp_gt": return player.hp > condition.value;
        case "enemy_hp_lt": return opponent.hp < condition.value;
        case "enemy_hp_gt": return opponent.hp > condition.value;
        case "my_swing_ready": return player.attackCooldownMs <= 0;
        case "my_swing_cooldown": return player.attackCooldownMs > 0;
        case "my_block_ready": return player.blockCooldownMs <= 0 && player.blockActiveMs <= 0;
        case "my_block_cooldown": return player.blockCooldownMs > 0 || player.blockActiveMs > 0;
        case "my_dash_ready": return player.dashCooldownMs <= 0 && player.dashActiveMs <= 0;
        case "my_dash_cooldown": return player.dashCooldownMs > 0 || player.dashActiveMs > 0;
        case "target_exists": return condition.target !== "opponent" && Boolean(target);
        case "target_missing": return condition.target !== "opponent" && !target;
        case "target_health_pack": return target?.type === "healthPack";
        case "target_damage_zone": return target?.type === "damageZone";
        case "inside_damage_zone": return obstacles.some((obstacle) => (
            obstacle.type === "damageZone" && overlapsObstacle(player, obstacle)
        ));
        default: return false;
    }
}

function targetEntity(target, opponent, obstacles) {
    if (target === "opponent") return opponent;
    return obstacleSlots(obstacles).find((obstacle) => obstacle.id === target) ?? null;
}

function radialVelocityTowardPlayer(player, opponent) {
    const dx = player.x - opponent.x;
    const dy = player.y - opponent.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.001) return 0;
    return (opponent.velocityX ?? 0) * dx / distance + (opponent.velocityY ?? 0) * dy / distance;
}

function edgeDistancePixels(fighter) {
    const radius = (fighter.size ?? 60) / 2;
    return Math.max(0, Math.min(
        fighter.x - radius,
        CANVAS_SIZE - radius - fighter.x,
        fighter.y - radius,
        CANVAS_SIZE - radius - fighter.y
    ));
}

function intentFromAction(actionId, actionTarget = "opponent") {
    const target = normalizeIntentTarget(actionTarget);
    const objectTarget = target.startsWith("object_");
    const movementStyle = movementStyleForAction(actionId);
    const dash = actionId?.startsWith("dash") ? 1 : 0;

    if (actionId === "move_center") return { intent: "reposition", target: "none", movementStyle, dash };
    if (actionId === "move_stop") return DEFAULT_INTENT;
    if (actionId === "rotate_toward_enemy" || actionId === "swing") {
        return { intent: "attack_target", target, movementStyle: "stop", dash: 0 };
    }
    if (actionId === "block") {
        return { intent: "defend_against_target", target: "opponent", movementStyle: "stop", dash: 0 };
    }
    if (movementStyle === "direct_in" || movementStyle.startsWith("diagonal_in")) {
        return { intent: objectTarget ? "seek_object" : "engage_target", target, movementStyle, dash };
    }
    if (movementStyle === "direct_out" || movementStyle.startsWith("diagonal_out")) {
        return { intent: objectTarget ? "avoid_object" : "disengage_target", target, movementStyle, dash };
    }
    if (movementStyle.startsWith("tangent")) {
        return { intent: "orbit_target", target, movementStyle, dash };
    }
    return DEFAULT_INTENT;
}

function movementStyleForAction(actionId) {
    return ({
        move_inward: "direct_in",
        move_outward: "direct_out",
        move_tangent_left: "tangent_left",
        move_tangent_right: "tangent_right",
        move_diagonal_in_left: "diagonal_in_left",
        move_diagonal_in_right: "diagonal_in_right",
        move_diagonal_out_left: "diagonal_out_left",
        move_diagonal_out_right: "diagonal_out_right",
        move_center: "center",
        move_stop: "stop",
        dash: "direct_in",
        dash_outward: "direct_out",
        dash_tangent_left: "tangent_left",
        dash_tangent_right: "tangent_right",
        dash_diagonal_in_left: "diagonal_in_left",
        dash_diagonal_in_right: "diagonal_in_right",
        dash_diagonal_out_left: "diagonal_out_left",
        dash_diagonal_out_right: "diagonal_out_right",
    })[actionId] ?? "stop";
}

function encodeIntentFeatures(intent = DEFAULT_INTENT) {
    const normalized = {
        intent: INTENT_TYPES.includes(intent?.intent) ? intent.intent : DEFAULT_INTENT.intent,
        target: normalizeIntentTarget(intent?.target),
        movementStyle: MOVEMENT_STYLE_TYPES.includes(intent?.movementStyle)
            ? intent.movementStyle
            : DEFAULT_INTENT.movementStyle,
        dash: intent?.dash ? 1 : 0,
    };
    const vector = new Float32Array(INTENT_FEATURE_SIZE);
    let offset = setOneHot(vector, 0, INTENT_TYPES, normalized.intent);
    offset = setOneHot(vector, offset, INTENT_TARGET_TYPES, normalized.target);
    offset = setOneHot(vector, offset, MOVEMENT_STYLE_TYPES, normalized.movementStyle);
    vector[offset] = normalized.dash;
    return vector;
}

function normalizeIntentTarget(target) {
    return INTENT_TARGET_TYPES.includes(target) ? target : "none";
}

function setOneHot(vector, offset, values, selected) {
    const index = Math.max(0, values.indexOf(selected));
    vector[offset + index] = 1;
    return offset + values.length;
}

function predictAction(model, player, opponent, obstacles, random) {
    return tf.tidy(() => {
        const intent = selectStrategyIntent(player.strategy, player, opponent, obstacles);
        const input = tf.tensor2d([buildInputVector(player, opponent, obstacles, intent)]);
        const prediction = model.predict(input);
        const outputs = Array.isArray(prediction) ? prediction : [prediction];
        const movement = movementFromProbabilities(outputs[0]?.dataSync() ?? [], {
            sample: false,
            random,
        });
        const worldMovement = rotateVector(
            movement.dx,
            movement.dy,
            player.perspectiveRotation ?? (player.slot === 2 ? 180 : 0)
        );
        const [rotation = 0] = outputs[1]?.dataSync() ?? [];
        const [swing = 0] = outputs[2]?.dataSync() ?? [];
        const [block = 0] = outputs[3]?.dataSync() ?? [];
        const [dash = 0] = outputs[4]?.dataSync() ?? [];
        return {
            ...movement,
            ...worldMovement,
            dRot: rotation,
            swing,
            block,
            dash: shouldAllowDash(player.strategy, player, opponent, obstacles) ? dash : 0,
        };
    });
}

function applyAction(fighter, action, arena) {
    fighter.attackCooldownMs = Math.max(0, fighter.attackCooldownMs - STEP_MS);
    fighter.attackActiveMs = Math.max(0, fighter.attackActiveMs - STEP_MS);
    fighter.blockCooldownMs = Math.max(0, fighter.blockCooldownMs - STEP_MS);
    fighter.blockActiveMs = Math.max(0, fighter.blockActiveMs - STEP_MS);
    fighter.dashCooldownMs = Math.max(0, fighter.dashCooldownMs - STEP_MS);
    fighter.dashActiveMs = Math.max(0, fighter.dashActiveMs - STEP_MS);

    const actionMagnitude = Math.hypot(action.dx, action.dy);
    const dashAvailable = fighter.dashCooldownMs <= 0;
    const isContinuingDash = fighter.dashActiveMs > 0;
    fighter.rotation = normalizeDegrees(fighter.rotation + clamp(action.dRot, -1, 1) * TURN_SPEED_DEGREES);

    if (isContinuingDash) {
        moveFighter(fighter, fighter.dashDirectionX, fighter.dashDirectionY, DASH_SPEED, arena);
    } else if (action.dash > 0.5 && dashAvailable) {
        const radians = fighter.rotation * Math.PI / 180;
        fighter.dashDirectionX = actionMagnitude > 0.001 ? action.dx / actionMagnitude : Math.cos(radians);
        fighter.dashDirectionY = actionMagnitude > 0.001 ? action.dy / actionMagnitude : Math.sin(radians);
        fighter.dashActiveMs = DASH_DURATION_MS;
        fighter.dashCooldownMs = DASH_COOLDOWN_MS;
        moveFighter(fighter, fighter.dashDirectionX, fighter.dashDirectionY, DASH_SPEED, arena);
    }

    const magnitude = actionMagnitude;
    if (!isContinuingDash && fighter.dashActiveMs <= 0 && Number.isFinite(magnitude) && magnitude > 0.001) {
        moveFighter(fighter, action.dx / magnitude, action.dy / magnitude, MOVE_SPEED, arena);
    } else if (!isContinuingDash && fighter.dashActiveMs <= 0) {
        fighter.velocityX = 0;
        fighter.velocityY = 0;
    }
    if (action.block > 0.5 && fighter.blockCooldownMs <= 0 && fighter.blockActiveMs <= 0) {
        fighter.blockActiveMs = BLOCK_ACTIVE_MS;
        fighter.blockCooldownMs = BLOCK_ACTIVE_MS + BLOCK_COOLDOWN_MS;
    }
    if (action.swing > 0.5 && fighter.attackCooldownMs <= 0) {
        fighter.attackActiveMs = ATTACK_ACTIVE_MS;
        fighter.attackCooldownMs = ATTACK_COOLDOWN_MS;
        return true;
    }
    return false;
}

function attackHits(attacker, defender) {
    if (Math.hypot(defender.x - attacker.x, defender.y - attacker.y) > ATTACK_RANGE) return false;
    const bearing = Math.atan2(defender.y - attacker.y, defender.x - attacker.x) * 180 / Math.PI;
    return Math.abs(angleDelta(attacker.rotation, bearing)) <= ATTACK_ARC_DEGREES;
}

function blocksAttack(defender, attacker) {
    if (defender.blockActiveMs <= 0) return false;
    const bearing = Math.atan2(attacker.y - defender.y, attacker.x - defender.x) * 180 / Math.PI;
    return Math.abs(angleDelta(defender.rotation, bearing)) <= 95;
}

function incomingAttackDamage(defender) {
    return Math.round(ATTACK_DAMAGE * (defender.inDamageZone ? DAMAGE_ZONE_DAMAGE_MULTIPLIER : 1));
}

function overlapsObstacle(fighter, obstacle) {
    return Math.hypot(fighter.x - obstacle.x, fighter.y - obstacle.y) <= ((fighter.size ?? 60) + (obstacle.size ?? 0)) / 2;
}

function applyObstacleEffects(fighters, obstacles) {
    const remainingObstacles = [];
    for (const obstacle of obstacles) {
        if (obstacle.type !== "healthPack") {
            remainingObstacles.push(obstacle);
            continue;
        }
        const collector = fighters.find((fighter) => overlapsObstacle(fighter, obstacle));
        if (!collector) {
            remainingObstacles.push(obstacle);
            continue;
        }
        collector.hp = Math.min(MAX_HP, collector.hp + HEALTH_PACK_HEAL);
    }

    const damageZones = remainingObstacles.filter((obstacle) => obstacle.type === "damageZone");
    for (const fighter of fighters) {
        const previousZoneIds = new Set(fighter.damageZoneIds ?? []);
        const currentZoneIds = damageZones
            .filter((zone) => overlapsObstacle(fighter, zone))
            .map((zone) => zone.id);
        if (currentZoneIds.some((id) => !previousZoneIds.has(id))) {
            fighter.hp = Math.max(0, fighter.hp - DAMAGE_ZONE_ENTRY_DAMAGE);
        }
        fighter.damageZoneIds = currentZoneIds;
        fighter.inDamageZone = currentZoneIds.length > 0;
    }

    return remainingObstacles;
}

function toPlacement(fighter) {
    return {
        userId: fighter.userId,
        username: fighter.username,
        slot: fighter.slot,
        x: round(fighter.x),
        y: round(fighter.y),
        rotation: round(fighter.rotation),
        hp: fighter.hp,
        attackActive: fighter.attackActiveMs > 0,
        blockActive: fighter.blockActiveMs > 0,
        dashActive: fighter.dashActiveMs > 0,
        inDamageZone: Boolean(fighter.inDamageZone),
    };
}

function toObstaclePlacement(obstacle) {
    return {
        id: obstacle.id,
        type: obstacle.type,
        x: round(obstacle.x),
        y: round(obstacle.y),
        size: obstacle.size,
    };
}

async function simulateDuelMatch(request) {
    if (request?.rulesetVersion !== "duel-v1") throw new Error("rulesetVersion must be duel-v1");
    if (!Array.isArray(request.fighters) || request.fighters.length !== 2) {
        throw new Error("duel-v1 requires exactly two fighters");
    }

    const fighters = request.fighters.map((fighter) => ({
        ...fighter,
        rotation: fighter.rotation ?? (fighter.slot === 1 ? 0 : 180),
        hp: MAX_HP,
        attackCooldownMs: 0,
        attackActiveMs: 0,
        blockCooldownMs: 0,
        blockActiveMs: 0,
        dashCooldownMs: 0,
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        velocityX: 0,
        velocityY: 0,
        damageZoneIds: [],
        inDamageZone: false,
    }));
    const models = new Map();
    const movementRandomByUserId = new Map(fighters.map((fighter) => [
        fighter.userId,
        createSeededRandom(`${request.seed ?? 0}:${fighter.userId}`),
    ]));
    try {
        for (const fighter of fighters) models.set(fighter.userId, await loadTfjsModel(fighter.model));
        const arena = {
            width: request.arena?.width ?? CANVAS_SIZE,
            height: request.arena?.height ?? CANVAS_SIZE,
            durationMs: request.arena?.durationMs ?? 30000,
        };
        let obstacles = Array.isArray(request.arena?.obstacles)
            ? normalizeRequestObstacles(request.arena.obstacles, arena)
            : createMatchObstacles(createSeededRandom(`${request.seed ?? 0}:obstacles`), arena, fighters);
        const initialState = {
            width: arena.width,
            height: arena.height,
            fighters: fighters.map(toPlacement),
            obstacles: obstacles.map(toObstaclePlacement),
        };
        const frames = [];

        for (let elapsedMs = 0, tick = 0; elapsedMs <= arena.durationMs; elapsedMs += STEP_MS, tick += 1) {
            const actions = fighters.map((fighter, index) => predictAction(
                models.get(fighter.userId),
                fighter,
                fighters[1 - index],
                obstacles,
                movementRandomByUserId.get(fighter.userId)
            ));
            const swung = fighters.map((fighter, index) => applyAction(fighter, actions[index], arena));
            obstacles = applyObstacleEffects(fighters, obstacles);
            const landed = swung.map((didSwing, index) => didSwing
                && attackHits(fighters[index], fighters[1 - index])
                && !blocksAttack(fighters[1 - index], fighters[index]));
            if (landed[0]) fighters[1].hp = Math.max(0, fighters[1].hp - incomingAttackDamage(fighters[1]));
            if (landed[1]) fighters[0].hp = Math.max(0, fighters[0].hp - incomingAttackDamage(fighters[0]));
            frames.push({ tick, elapsedMs, fighters: fighters.map(toPlacement), obstacles: obstacles.map(toObstaclePlacement) });

            if (fighters.some((fighter) => fighter.hp <= 0)) {
                const survivors = fighters.filter((fighter) => fighter.hp > 0);
                const winner = survivors.length === 1 ? survivors[0] : null;
                return duelResult(request.matchId, initialState, frames, winner);
            }
        }
        return duelResult(request.matchId, initialState, frames, null);
    } finally {
        for (const model of models.values()) model.dispose();
    }
}

function duelResult(matchId, initialState, frames, winner) {
    return {
        matchId,
        rulesetVersion: "duel-v1",
        status: "COMPLETED",
        initialState,
        frames,
        result: winner ? "FIGHTER_WIN" : "DRAW",
        winnerUserId: winner?.userId ?? null,
        message: winner ? `${winner.username} wins the fight.` : "The fight ended in a draw.",
    };
}

function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
}

function rotateVector(dx, dy, degrees) {
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return {
        dx: dx * cosine - dy * sine,
        dy: dx * sine + dy * cosine,
    };
}

function createSeededRandom(seedValue) {
    const seedText = String(seedValue);
    let state = 2_166_136_261;
    for (let index = 0; index < seedText.length; index += 1) {
        state ^= seedText.charCodeAt(index);
        state = Math.imul(state, 16_777_619);
    }

    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
    };
}

function angleDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeEdgeDistance(fighter) {
    const radius = fighter.size / 2;
    return clamp(Math.min(
        fighter.x - radius,
        CANVAS_SIZE - radius - fighter.x,
        fighter.y - radius,
        CANVAS_SIZE - radius - fighter.y
    ) / (CANVAS_SIZE / 2), 0, 1);
}

function moveFighter(fighter, dx, dy, speed, arena) {
    const radius = fighter.size / 2;
    fighter.x = clamp(fighter.x + dx * speed, radius, arena.width - radius);
    fighter.y = clamp(fighter.y + dy * speed, radius, arena.height - radius);
    fighter.velocityX = dx * speed / (STEP_MS / 1000);
    fighter.velocityY = dy * speed / (STEP_MS / 1000);
}

function round(value) {
    return Number(value.toFixed(3));
}

function createMatchObstacles(random, arena, occupiedShapes = []) {
    const count = 1 + Math.floor(random() * MAX_OBSTACLE_SLOTS);
    const obstacles = [];
    for (let index = 0; index < count; index += 1) {
        const type = random() < 0.5 ? "healthPack" : "damageZone";
        const size = type === "healthPack" ? HEALTH_PACK_SIZE : DAMAGE_ZONE_SIZE;
        let candidate = null;
        for (let attempt = 0; attempt < 80; attempt += 1) {
            candidate = {
                id: `object_${index + 1}`,
                type,
                x: size / 2 + random() * (arena.width - size),
                y: size / 2 + random() * (arena.height - size),
                size,
            };
            if (![...occupiedShapes, ...obstacles].some((shape) => overlapsShape(shape, candidate, 8))) break;
        }
        obstacles.push(candidate);
    }
    return obstacles;
}

function overlapsShape(first, second, padding = 0) {
    return Math.hypot(first.x - second.x, first.y - second.y) <= ((first.size ?? 60) + (second.size ?? 0)) / 2 + padding;
}

function normalizeRequestObstacles(obstacles, arena) {
    return obstacles
        .filter((obstacle) => obstacle?.type === "healthPack" || obstacle?.type === "damageZone")
        .slice(0, MAX_OBSTACLE_SLOTS)
        .map((obstacle, index) => {
            const type = obstacle.type;
            const size = clamp(
                Number(obstacle.size) || (type === "healthPack" ? HEALTH_PACK_SIZE : DAMAGE_ZONE_SIZE),
                16,
                240
            );
            return {
                id: String(obstacle.id ?? `object_${index + 1}`),
                type,
                x: clamp(Number(obstacle.x) || arena.width / 2, size / 2, arena.width - size / 2),
                y: clamp(Number(obstacle.y) || arena.height / 2, size / 2, arena.height - size / 2),
                size,
            };
        });
}

function obstacleSlots(obstacles = []) {
    return [...obstacles]
        .filter((obstacle) => obstacle.type === "healthPack" || obstacle.type === "damageZone")
        .sort((first, second) => String(first.id ?? "").localeCompare(String(second.id ?? "")))
        .slice(0, MAX_OBSTACLE_SLOTS);
}

module.exports = { simulateDuelMatch, buildInputVector, INPUT_SIZE };
