import { buildInputVector, MAX_OBSTACLE_SLOTS, obstacleSlots } from "./Featurebuilder.js";
import { DEFAULT_INTENT, intentFromAction } from "./IntentFeatures.js";
import { movementVectorToActionIndex, oneHotMovementAction } from "./MovementActions.js";

export const MELEE_STRATEGY_VERSION = "melee-logic-blocks-v2";
export const MAX_STRATEGY_EXAMPLES = 3072;
export const MIN_BLOCK_EXAMPLES = 32;
export const MAX_LOGIC_BLOCKS = 8;
export const MAX_CONDITIONS_PER_BLOCK = 4;
export const MAX_STRATEGY_EPOCHS = 30;
export const STRATEGY_TIME_LIMIT_MS = 15_000;
export const STRATEGY_VALIDATION_FRACTION = 0.2;

export const CONDITION_TYPES = Object.freeze([
    thresholdCondition("enemy_distance_lt", "Target Distance <", 120, 0, 700, "px", { supportsTarget: true }),
    thresholdCondition("enemy_distance_gt", "Target Distance >", 120, 0, 700, "px", { supportsTarget: true }),
    thresholdCondition("my_cornered", "I am Cornered · edge distance <", 80, 0, 300, "px"),
    thresholdCondition("enemy_cornered", "Target is Cornered - edge distance <", 80, 0, 300, "px", { supportsTarget: true }),
    flagCondition("enemy_attacking", "Enemy is Attacking"),
    flagCondition("enemy_blocking", "Enemy is Blocking"),
    flagCondition("enemy_rushing", "Enemy is Rushing"),
    flagCondition("enemy_fleeing", "Enemy is Fleeing"),
    thresholdCondition("my_hp_lt", "My HP <", 50, 1, 100, "HP"),
    thresholdCondition("my_hp_gt", "My HP >", 50, 0, 99, "HP"),
    thresholdCondition("enemy_hp_lt", "Enemy HP <", 50, 1, 100, "HP"),
    thresholdCondition("enemy_hp_gt", "Enemy HP >", 50, 0, 99, "HP"),
    flagCondition("my_swing_ready", "My Swing is Ready"),
    flagCondition("my_swing_cooldown", "My Swing is on Cooldown"),
    flagCondition("my_block_ready", "My Block is Ready"),
    flagCondition("my_block_cooldown", "My Block is on Cooldown"),
    flagCondition("my_dash_ready", "My Dash is Ready"),
    flagCondition("my_dash_cooldown", "My Dash is on Cooldown"),
    flagCondition("target_exists", "Target Object Exists", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects" }),
    flagCondition("target_missing", "Target Object Does Not Exist", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects" }),
    flagCondition("target_health_pack", "Target is Health Pack", { supportsTarget: true, defaultTarget: "object_1" }),
    flagCondition("target_damage_zone", "Target is Damage Zone", { supportsTarget: true, defaultTarget: "object_1" }),
    flagCondition("inside_damage_zone", "I am in a Damage Zone"),
]);
const LEGACY_CONDITION_TYPES = Object.freeze([]);
export const CONDITION_DEFINITIONS = Object.freeze([...CONDITION_TYPES, ...LEGACY_CONDITION_TYPES]);

export const ACTION_TYPES = Object.freeze([
    { id: "move_inward", label: "Move: Radially Inward (Engage)", head: "movement" },
    { id: "move_outward", label: "Move: Radially Outward (Retreat)", head: "movement" },
    { id: "move_tangent_left", label: "Move: Tangential Left (Strafe Left)", head: "movement" },
    { id: "move_tangent_right", label: "Move: Tangential Right (Strafe Right)", head: "movement" },
    { id: "move_diagonal_in_left", label: "Move: Diagonal Left Inward", head: "movement" },
    { id: "move_diagonal_in_right", label: "Move: Diagonal Right Inward", head: "movement" },
    { id: "move_diagonal_out_left", label: "Move: Diagonal Left Backward", head: "movement" },
    { id: "move_diagonal_out_right", label: "Move: Diagonal Right Backward", head: "movement" },
    { id: "move_center", label: "Move: Take Center Stage", head: "movement" },
    { id: "move_stop", label: "Move: Hold Ground (Stop)", head: "movement" },
    { id: "rotate_toward_enemy", label: "Rotate: Face Enemy", head: "rotation" },
    { id: "swing", label: "Action: Swing Weapon", head: "swing" },
    { id: "block", label: "Action: Raise Shield", head: "block" },
    { id: "no_dash", label: "Dash: Don't Dash", head: "dash" },
    { id: "dash", label: "Dash: Toward Target", head: "dash" },
    { id: "dash_outward", label: "Dash: Away from Target", head: "dash" },
    { id: "dash_tangent_left", label: "Dash: Tangential Left", head: "dash" },
    { id: "dash_tangent_right", label: "Dash: Tangential Right", head: "dash" },
    { id: "dash_diagonal_in_left", label: "Dash: Diagonal Left Inward", head: "dash" },
    { id: "dash_diagonal_in_right", label: "Dash: Diagonal Right Inward", head: "dash" },
    { id: "dash_diagonal_out_left", label: "Dash: Diagonal Left Backward", head: "dash" },
    { id: "dash_diagonal_out_right", label: "Dash: Diagonal Right Backward", head: "dash" },
]);

const CONDITION_BY_ID = new Map(CONDITION_DEFINITIONS.map((condition) => [condition.id, condition]));
const ACTION_BY_ID = new Map(ACTION_TYPES.map((action) => [action.id, action]));
export const TARGET_TYPES = Object.freeze([
    { id: "opponent", label: "Opponent" },
    ...Array.from({ length: MAX_OBSTACLE_SLOTS }, (_, index) => ({
        id: `object_${index + 1}`,
        label: `Object ${index + 1}`,
    })),
]);
const TARGET_BY_ID = new Map(TARGET_TYPES.map((target) => [target.id, target]));
const CANVAS_SIZE = 800;
const ENTITY_SIZE = 60;
const HEALTH_PACK_SIZE = 42;
const DAMAGE_ZONE_SIZE = 128;
const LABEL_SMOOTHING = 0.08;
// Stop is one class while movement spans eight directional classes. Keep
// contrast stops sparse so they do not overwhelm every individual direction.
const MOVEMENT_CONTRAST_INTERVAL = 31;
const BINARY_CONTRAST_INTERVAL = 2;

export function createDefaultMeleeStrategyConfiguration() {
    return {
        version: MELEE_STRATEGY_VERSION,
        epochLimit: 30,
        blocks: [],
    };
}

export function createLogicBlock(conditionType = "enemy_distance_lt", action = "move_stop", sampleCount = 256) {
    const definition = CONDITION_BY_ID.get(conditionType) ?? CONDITION_TYPES[0];
    return {
        id: `logic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conditions: [{
            type: definition.id,
            ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
            ...(definition.supportsTarget ? { target: definition.defaultTarget ?? "opponent" } : {}),
        }],
        action: ACTION_BY_ID.has(action) ? action : ACTION_TYPES[0].id,
        actionTarget: normalizeActionTarget("opponent", action),
        sampleCount,
    };
}

export function normalizeMeleeStrategyConfiguration(configuration) {
    const sourceBlocks = Array.isArray(configuration?.blocks)
        ? configuration.blocks
        : createDefaultMeleeStrategyConfiguration().blocks;
    const blocks = sourceBlocks.slice(0, MAX_LOGIC_BLOCKS).map((block, blockIndex) => ({
        id: String(block?.id || `logic-${blockIndex + 1}`),
        conditions: normalizeConditions(block?.conditions),
        action: ACTION_BY_ID.has(block?.action) ? block.action : ACTION_TYPES[0].id,
        actionTarget: normalizeActionTarget(block?.actionTarget, block?.action),
        sampleCount: clamp(Math.round(Number(block?.sampleCount) || 256), MIN_BLOCK_EXAMPLES, MAX_STRATEGY_EXAMPLES),
    }));

    return {
        version: MELEE_STRATEGY_VERSION,
        epochLimit: clamp(Math.round(Number(configuration?.epochLimit) || 12), 1, MAX_STRATEGY_EPOCHS),
        blocks,
    };
}

export function strategyExampleCount(configuration) {
    return normalizeMeleeStrategyConfiguration(configuration).blocks
        .filter(isTrainableBlock)
        .reduce((total, block) => total + block.sampleCount, 0);
}

export function validateMeleeStrategyConfiguration(configuration) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    const errors = [];
    if (!normalized.blocks.some(isTrainableBlock)) {
        errors.push("Add at least one trainable logic block before training.");
    }
    if (strategyExampleCount(normalized) > MAX_STRATEGY_EXAMPLES) {
        errors.push(`Logic blocks allocate more than ${MAX_STRATEGY_EXAMPLES} total examples.`);
    }
    normalized.blocks.forEach((block, index) => {
        const ids = new Set(block.conditions.map((condition) => condition.type));
        for (const [first, second] of [
            ["enemy_rushing", "enemy_fleeing"],
            ["my_swing_ready", "my_swing_cooldown"],
            ["my_block_ready", "my_block_cooldown"],
            ["my_dash_ready", "my_dash_cooldown"],
        ]) {
            if (ids.has(first) && ids.has(second)) errors.push(`Block ${index + 1} contains contradictory conditions.`);
        }
        for (const target of TARGET_TYPES) {
            const lower = block.conditions.find((condition) => (
                condition.type === "enemy_distance_gt" && (condition.target ?? "opponent") === target.id
            ))?.value;
            const upper = block.conditions.find((condition) => (
                condition.type === "enemy_distance_lt" && (condition.target ?? "opponent") === target.id
            ))?.value;
            if (lower != null && upper != null && lower >= upper) {
                errors.push(`Block ${index + 1} has an impossible ${target.label.toLowerCase()} distance range.`);
            }
            const typeConditions = new Set(block.conditions.filter((condition) => (
                (condition.type === "target_health_pack" || condition.type === "target_damage_zone")
                && (condition.target ?? "object_1") === target.id
            )).map((condition) => condition.type));
            if (typeConditions.size > 1) {
                errors.push(`Block ${index + 1} requires ${target.label.toLowerCase()} to be multiple obstacle types.`);
            }
            const targetConditionTypes = new Set(block.conditions.filter((condition) => (
                condition.target === target.id
            )).map((condition) => condition.type));
            if (targetConditionTypes.has("target_exists") && targetConditionTypes.has("target_missing")) {
                errors.push(`Block ${index + 1} requires ${target.label.toLowerCase()} to both exist and not exist.`);
            }
            if (targetConditionTypes.has("target_missing") && [...targetConditionTypes].some((type) => (
                type !== "target_missing"
            ))) {
                errors.push(`Block ${index + 1} requires ${target.label.toLowerCase()} to be missing while using it.`);
            }
        }
        validateThresholdRange(errors, block, index, "my_hp_gt", "my_hp_lt", "my HP");
        validateThresholdRange(errors, block, index, "enemy_hp_gt", "enemy_hp_lt", "enemy HP");
    });
    return { configuration: normalized, errors };
}

export function generateMeleeStrategyDataset(configuration, { random = Math.random } = {}) {
    const validated = validateMeleeStrategyConfiguration(configuration);
    if (validated.errors.length) throw new Error(validated.errors.join(" "));
    const trainableBlocks = validated.configuration.blocks.filter(isTrainableBlock);
    const examples = trainableBlocks.flatMap((block) => (
        Array.from({ length: block.sampleCount }, (_, index) => (
            createMeleeStrategyExample(block, index, random, validated.configuration.blocks)
        ))
    ));
    shuffle(examples, random);
    const validationCount = Math.ceil(examples.length * STRATEGY_VALIDATION_FRACTION);
    const validation = examples.slice(0, validationCount);
    const training = examples.slice(validationCount);
    shuffle(training, random);
    return { configuration: validated.configuration, training, validation };
}

export function createMeleeStrategyExample(block, index, random = Math.random, fallbackBlocks = []) {
    const normalizedBlock = normalizeMeleeStrategyConfiguration({ blocks: [block] }).blocks[0];
    const action = ACTION_BY_ID.get(normalizedBlock.action);
    const contrastInterval = action.head === "movement"
        ? MOVEMENT_CONTRAST_INTERVAL
        : BINARY_CONTRAST_INTERVAL;
    const isContrast = index % contrastInterval === 0;
    const state = createMatchingState(normalizedBlock.conditions, random, normalizedBlock.actionTarget);
    if (isContrast) violateCondition(state, normalizedBlock.conditions[index % normalizedBlock.conditions.length], random);
    const isActiveExample = !isContrast;
    const targets = targetsForAction(action.id, state, isActiveExample, normalizedBlock.actionTarget);
    const actionTarget = targetEntity(state, normalizedBlock.actionTarget);
    return {
        input: Array.from(buildInputVector(toPayload(
            state,
            isActiveExample
                ? activeIntentForBlock(normalizedBlock, state, fallbackBlocks)
                : fallbackIntentForState(fallbackBlocks, normalizedBlock.id, state)
        ))),
        targets,
        trainHead: action.head,
        sampleWeight: action.head === "movement" && isContrast ? 0.1 : 1,
        blockId: normalizedBlock.id,
        diagnostics: {
            matched: normalizedBlock.conditions.every((condition) => evaluateCondition(condition, state)),
            distance: distanceBetween(state.player, state.opponent),
            targetDistance: actionTarget ? distanceBetween(state.player, actionTarget) : null,
            actionTarget: normalizedBlock.actionTarget,
            radialVelocity: radialVelocityTowardPlayer(state.player, state.opponent),
        },
    };
}

function activeIntentForBlock(block, state, fallbackBlocks) {
    return intentFromAction(block.action, block.actionTarget);
}

function fallbackIntentForState(blocks, excludedBlockId, state) {
    const normalized = normalizeMeleeStrategyConfiguration({ blocks });
    const fallback = normalized.blocks.find((block) => (
        block.id !== excludedBlockId
        && block.action !== "no_dash"
        && block.conditions.every((condition) => evaluateCondition(condition, state))
    ));
    return fallback ? intentFromAction(fallback.action, fallback.actionTarget) : DEFAULT_INTENT;
}

export function selectMeleeStrategyBlock(configuration, payload) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    const state = stateFromPayload(payload);
    return normalized.blocks.find((block) => (
        isTrainableBlock(block)
        && block.conditions.every((condition) => evaluateCondition(condition, state))
    )) ?? null;
}

export function shouldSuppressMeleeStrategyDash(configuration, payload) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    const state = stateFromPayload(payload);
    return normalized.blocks.some((block) => (
        block.action === "no_dash"
        && block.conditions.every((condition) => evaluateCondition(condition, state))
    ));
}

export function shouldAllowMeleeStrategyDash(configuration, payload) {
    return Boolean(selectMeleeStrategyIntent(configuration, payload).dash)
        && !shouldSuppressMeleeStrategyDash(configuration, payload);
}

export function selectMeleeStrategyIntent(configuration, payload) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    const state = stateFromPayload(payload);
    const block = normalized.blocks.find((candidate) => (
        isTrainableBlock(candidate)
        && candidate.conditions.every((condition) => evaluateCondition(condition, state))
    )) ?? null;
    if (!block) return DEFAULT_INTENT;
    return activeIntentForBlock(block, state, normalized.blocks);
}

export function evaluateCondition(condition, state) {
    const target = targetEntity(state, condition.target ?? "opponent");
    const distance = target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY;
    switch (condition.type) {
        case "enemy_distance_lt": return distance < condition.value;
        case "enemy_distance_gt": return distance > condition.value;
        case "my_cornered": return edgeDistance(state.player) < condition.value;
        case "enemy_cornered": return target ? edgeDistance(target) < condition.value : false;
        case "enemy_attacking": return Boolean(state.opponent?.swingActive);
        case "enemy_blocking": return Boolean(state.opponent?.blockActive);
        case "enemy_rushing": return radialVelocityTowardPlayer(state.player, state.opponent) > 20;
        case "enemy_fleeing": return radialVelocityTowardPlayer(state.player, state.opponent) < -20;
        case "my_hp_lt": return state.player.hp < condition.value;
        case "my_hp_gt": return state.player.hp > condition.value;
        case "enemy_hp_lt": return state.opponent ? state.opponent.hp < condition.value : false;
        case "enemy_hp_gt": return state.opponent ? state.opponent.hp > condition.value : false;
        case "my_swing_ready": return state.player.swingAvailable;
        case "my_swing_cooldown": return !state.player.swingAvailable;
        case "my_block_ready": return state.player.blockAvailable;
        case "my_block_cooldown": return !state.player.blockAvailable;
        case "my_dash_ready": return state.player.dashAvailable;
        case "my_dash_cooldown": return !state.player.dashAvailable;
        case "target_exists": return Boolean(target) && condition.target !== "opponent";
        case "target_missing": return !target && condition.target !== "opponent";
        case "target_health_pack": return target?.type === "healthPack";
        case "target_damage_zone": return target?.type === "damageZone";
        case "inside_damage_zone": return state.obstacles.some((obstacle) => (
            obstacle.type === "damageZone" && distanceBetween(state.player, obstacle) <= (state.player.size + obstacle.size) / 2
        ));
        default: return false;
    }
}

export function radialVelocityTowardPlayer(player, opponent) {
    if (!player || !opponent) return 0;
    const dx = player.x - opponent.x;
    const dy = player.y - opponent.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.001) return 0;
    return (opponent.velocityX ?? 0) * dx / distance + (opponent.velocityY ?? 0) * dy / distance;
}

function createMatchingState(conditions, random, actionTarget = "opponent") {
    for (let attempt = 0; attempt < 500; attempt += 1) {
        const state = createRandomState(random, conditions, actionTarget);
        if (conditions.every((condition) => evaluateCondition(condition, state))) return state;
    }
    throw new Error("Unable to generate examples for this combination of conditions.");
}

function createRandomState(random, conditions, actionTarget = "opponent") {
    const condition = (type, target = null) => conditions.find((candidate) => (
        candidate.type === type && (target == null || (candidate.target ?? "opponent") === target)
    ));
    const referencedTargets = new Set([
        actionTarget,
        ...conditions.map((candidate) => candidate.target).filter(Boolean),
    ]);
    const primaryDistanceCondition = conditions.find((candidate) => (
        candidate.type === "enemy_distance_lt" || candidate.type === "enemy_distance_gt"
    ));
    const primaryTarget = primaryDistanceCondition?.target ?? "opponent";
    const distanceMin = condition("enemy_distance_gt", primaryTarget)?.value ?? 0;
    const distanceMax = condition("enemy_distance_lt", primaryTarget)?.value ?? 500;
    const desiredDistance = between(random, distanceMin, Math.max(distanceMin, distanceMax - 2));
    const player = createEntity(random, condition("my_cornered"));
    const angle = random() * Math.PI * 2;
    const opponent = createEntity(random, condition("enemy_cornered", "opponent"));
    const obstacles = createObstacleSlots(random, conditions, referencedTargets);
    const state = { player, opponent, obstacles };
    for (const missingCondition of conditions.filter((candidate) => candidate.type === "target_missing")) {
        removeTargetAndLaterObjectSlots(state, missingCondition.target ?? "object_1");
    }

    for (const cornerCondition of conditions.filter((candidate) => candidate.type === "enemy_cornered")) {
        placeTargetNearEdge(state, cornerCondition.target ?? "opponent", cornerCondition.value, random);
    }
    placeTargetAtDistance(state, primaryTarget, desiredDistance, angle);

    player.hp = hpForConditions(random, condition("my_hp_gt"), condition("my_hp_lt"));
    opponent.hp = hpForConditions(random, condition("enemy_hp_gt"), condition("enemy_hp_lt"));
    setReadyState(player, "swing", condition("my_swing_ready"), condition("my_swing_cooldown"), random);
    setReadyState(player, "block", condition("my_block_ready"), condition("my_block_cooldown"), random);
    setReadyState(player, "dash", condition("my_dash_ready"), condition("my_dash_cooldown"), random);
    opponent.swingActive = Boolean(condition("enemy_attacking")) || random() < 0.15;
    opponent.blockActive = Boolean(condition("enemy_blocking")) || random() < 0.15;
    setOpponentVelocity(player, opponent, condition("enemy_rushing"), condition("enemy_fleeing"), random);
    if (condition("inside_damage_zone")) {
        const zone = obstacles.find((obstacle) => obstacle.type === "damageZone") ?? obstacles[0];
        Object.assign(zone, { type: "damageZone", x: player.x, y: player.y, size: DAMAGE_ZONE_SIZE });
    }
    return state;
}

function createEntity(random, cornerCondition) {
    const entity = {
        x: between(random, 31, 769), y: between(random, 31, 769), size: ENTITY_SIZE,
        rotation: random() * 360, hp: between(random, 1, 100), velocityX: 0, velocityY: 0,
        swingAvailable: random() > 0.3, blockAvailable: random() > 0.3, dashAvailable: random() > 0.3,
        swingActive: false, blockActive: false, dashActive: false,
    };
    if (cornerCondition) {
        const edge = Math.floor(random() * 4);
        const gap = between(random, 0, Math.max(1, cornerCondition.value - 1));
        if (edge === 0) entity.x = 30 + gap;
        if (edge === 1) entity.x = 770 - gap;
        if (edge === 2) entity.y = 30 + gap;
        if (edge === 3) entity.y = 770 - gap;
    }
    return entity;
}

function setReadyState(entity, name, readyCondition, cooldownCondition, random) {
    const ready = readyCondition ? true : cooldownCondition ? false : random() > 0.3;
    entity[`${name}Available`] = ready;
    entity[`${name}CooldownRemainingMs`] = ready ? 0 : between(random, 100, name === "dash" ? 4500 : 1000);
}

function setOpponentVelocity(player, opponent, rushing, fleeing, random) {
    const baseAngle = Math.atan2(player.y - opponent.y, player.x - opponent.x);
    const radialDirection = fleeing ? baseAngle + Math.PI : baseAngle;
    const angle = rushing || fleeing
        ? radialDirection + between(random, -Math.PI / 3, Math.PI / 3)
        : random() * Math.PI * 2;
    const speed = rushing || fleeing ? between(random, 60, 180) : between(random, 0, 180);
    opponent.velocityX = Math.cos(angle) * speed;
    opponent.velocityY = Math.sin(angle) * speed;
}

function violateCondition(state, condition, random) {
    const target = condition.target ?? "opponent";
    switch (condition.type) {
        case "enemy_distance_lt": placeTargetAtDistance(state, target, condition.value + 80, random() * Math.PI * 2); break;
        case "enemy_distance_gt": placeTargetAtDistance(state, target, Math.max(35, condition.value - 30), random() * Math.PI * 2); break;
        case "my_cornered": state.player.x = 400; state.player.y = 400; break;
        case "enemy_cornered": setTargetPosition(state, target, 400, 400); break;
        case "enemy_attacking": state.opponent.swingActive = false; break;
        case "enemy_blocking": state.opponent.blockActive = false; break;
        case "enemy_rushing": setOpponentVelocity(state.player, state.opponent, null, true, random); break;
        case "enemy_fleeing": setOpponentVelocity(state.player, state.opponent, true, null, random); break;
        case "my_hp_lt": state.player.hp = Math.min(100, condition.value + 20); break;
        case "my_hp_gt": state.player.hp = Math.max(1, condition.value - 20); break;
        case "enemy_hp_lt": state.opponent.hp = Math.min(100, condition.value + 20); break;
        case "enemy_hp_gt": state.opponent.hp = Math.max(1, condition.value - 20); break;
        case "my_swing_ready": state.player.swingAvailable = false; state.player.swingCooldownRemainingMs = 500; break;
        case "my_swing_cooldown": state.player.swingAvailable = true; state.player.swingCooldownRemainingMs = 0; break;
        case "my_block_ready": state.player.blockAvailable = false; state.player.blockCooldownRemainingMs = 500; break;
        case "my_block_cooldown": state.player.blockAvailable = true; state.player.blockCooldownRemainingMs = 0; break;
        case "my_dash_ready": state.player.dashAvailable = false; state.player.dashCooldownRemainingMs = 1500; break;
        case "my_dash_cooldown": state.player.dashAvailable = true; state.player.dashCooldownRemainingMs = 0; break;
        case "target_exists": removeTargetAndLaterObjectSlots(state, target); break;
        case "target_missing": ensureObjectSlotExists(state, target, random); break;
        case "target_health_pack": setTargetType(state, target, "damageZone"); break;
        case "target_damage_zone": setTargetType(state, target, "healthPack"); break;
        case "inside_damage_zone": state.obstacles.forEach((obstacle) => {
            if (obstacle.type === "damageZone") obstacle.x = 760;
        }); break;
    }
}

function targetsForAction(action, state, active, actionTarget = "opponent") {
    const definition = ACTION_BY_ID.get(action);
    let movementIndex = 0;
    if (active && (action.startsWith("move_") || isDashMovementAction(action))) {
        movementIndex = movementTarget(action, state, actionTarget);
    }
    const target = targetEntity(state, actionTarget) ?? state.opponent;
    const targetBearing = Math.atan2(
        target.y - state.player.y,
        target.x - state.player.x
    ) * 180 / Math.PI;
    const rotation = active && action === "rotate_toward_enemy"
        ? clamp(normalizeAngleDelta(targetBearing - state.player.rotation) / 90, -1, 1)
        : 0;
    return {
        movement: smoothOneHot(movementIndex),
        movementIndex,
        rotation: [rotation],
        swing: [active && action === "swing" ? 1 : 0],
        block: [active && action === "block" ? 1 : 0],
        dash: [active && isDashMovementAction(action) ? 1 : 0],
    };
}

function isDashMovementAction(action) {
    return action?.startsWith("dash");
}

function isTrainableBlock(block) {
    return block?.action !== "no_dash";
}

function movementTarget(action, state, actionTarget = "opponent") {
    const target = targetEntity(state, actionTarget) ?? state.opponent;
    const dx = target.x - state.player.x;
    const dy = target.y - state.player.y;
    const inwardX = dx;
    const inwardY = dy;
    const outwardX = -dx;
    const outwardY = -dy;
    const tangentLeftX = dy;
    const tangentLeftY = -dx;
    const tangentRightX = -dy;
    const tangentRightY = dx;
    if (action === "move_inward" || action === "dash") return movementVectorToActionIndex(inwardX, inwardY);
    if (action === "move_outward" || action === "dash_outward") return movementVectorToActionIndex(outwardX, outwardY);
    if (action === "move_tangent_left" || action === "dash_tangent_left") return movementVectorToActionIndex(tangentLeftX, tangentLeftY);
    if (action === "move_tangent_right" || action === "dash_tangent_right") return movementVectorToActionIndex(tangentRightX, tangentRightY);
    if (action === "move_diagonal_in_left" || action === "dash_diagonal_in_left") {
        return movementVectorToActionIndex(inwardX + tangentLeftX, inwardY + tangentLeftY);
    }
    if (action === "move_diagonal_in_right" || action === "dash_diagonal_in_right") {
        return movementVectorToActionIndex(inwardX + tangentRightX, inwardY + tangentRightY);
    }
    if (action === "move_diagonal_out_left" || action === "dash_diagonal_out_left") {
        return movementVectorToActionIndex(outwardX + tangentLeftX, outwardY + tangentLeftY);
    }
    if (action === "move_diagonal_out_right" || action === "dash_diagonal_out_right") {
        return movementVectorToActionIndex(outwardX + tangentRightX, outwardY + tangentRightY);
    }
    if (action === "move_center") return movementVectorToActionIndex(400 - state.player.x, 400 - state.player.y);
    return 0;
}

function toPayload(state, intent = DEFAULT_INTENT) {
    return {
        arenaWidth: CANVAS_SIZE,
        arenaHeight: CANVAS_SIZE,
        intent,
        playerModel: {
            ...state.player,
            blockActiveRemainingMs: state.player.blockActive ? 500 : 0,
        },
        objects: [
            { id: "opponent-model", type: "opponentModel", ...state.opponent },
            ...state.obstacles,
        ],
    };
}

function stateFromPayload(payload) {
    const objects = Array.isArray(payload?.objects) ? payload.objects : [];
    const player = {
        ...(payload?.playerModel ?? {}),
        hp: payload?.playerModel?.hp ?? 100,
        size: payload?.playerModel?.size ?? ENTITY_SIZE,
        swingAvailable: Boolean(payload?.playerModel?.swingAvailable),
        blockAvailable: Boolean(payload?.playerModel?.blockAvailable),
        dashAvailable: Boolean(payload?.playerModel?.dashAvailable),
    };
    const opponent = objects.find((object) => object?.type === "opponentModel") ?? null;
    return {
        player,
        opponent: opponent ? {
            ...opponent,
            hp: opponent.hp ?? 100,
            size: opponent.size ?? ENTITY_SIZE,
            swingActive: Boolean(opponent.swingActive),
            blockActive: Boolean(opponent.blockActive),
            velocityX: opponent.velocityX ?? 0,
            velocityY: opponent.velocityY ?? 0,
        } : null,
        obstacles: obstacleSlots(objects),
    };
}

function normalizeConditions(conditions) {
    const source = Array.isArray(conditions) && conditions.length ? conditions : [{ type: CONDITION_TYPES[0].id }];
    return source.slice(0, MAX_CONDITIONS_PER_BLOCK).map((condition) => {
        const definition = CONDITION_BY_ID.get(condition?.type) ?? CONDITION_TYPES[0];
        return {
            type: definition.id,
            ...(definition.requiresValue ? {
                value: clamp(Number(condition?.value) || definition.defaultValue, definition.min, definition.max),
            } : {}),
            ...(definition.supportsTarget ? {
                target: normalizeTarget(condition?.target, definition.defaultTarget ?? "opponent", definition.targetGroup),
            } : {}),
        };
    });
}

function normalizeActionTarget(target, actionId) {
    const action = ACTION_BY_ID.get(actionId) ?? ACTION_TYPES[0];
    if (!actionSupportsTarget(action)) return "opponent";
    return normalizeTarget(target, "opponent");
}

export function actionSupportsTarget(action) {
    return (action.head === "movement" && action.id !== "move_center" && action.id !== "move_stop")
        || (action.head === "dash" && action.id !== "no_dash")
        || action.id === "rotate_toward_enemy";
}

function normalizeTarget(target, fallback, targetGroup = null) {
    if (!TARGET_BY_ID.has(target)) return fallback;
    if (targetGroup === "objects" && !String(target).startsWith("object_")) return fallback;
    return target;
}

function validateThresholdRange(errors, block, index, lowerType, upperType, label) {
    const lower = block.conditions.find((condition) => condition.type === lowerType)?.value;
    const upper = block.conditions.find((condition) => condition.type === upperType)?.value;
    if (lower != null && upper != null && lower >= upper) {
        errors.push(`Block ${index + 1} has an impossible ${label} range.`);
    }
}

function hpForConditions(random, greaterThanCondition, lessThanCondition) {
    const lower = Math.max(1, (greaterThanCondition?.value ?? 0) + 0.1);
    const upper = Math.min(100, (lessThanCondition?.value ?? 100.1) - 0.1);
    return between(random, lower, Math.max(lower, upper));
}

function thresholdCondition(id, label, defaultValue, min, max, suffix, options = {}) {
    return { id, label, requiresValue: true, defaultValue, min, max, suffix, ...options };
}

function flagCondition(id, label, options = {}) { return { id, label, requiresValue: false, ...options }; }
function edgeDistance(entity) { return Math.max(0, Math.min(entity.x - 30, 770 - entity.x, entity.y - 30, 770 - entity.y)); }
function distanceBetween(first, second) {
    if (!first || !second) return Number.POSITIVE_INFINITY;
    return Math.hypot(second.x - first.x, second.y - first.y);
}
function smoothOneHot(index) {
    const oneHot = oneHotMovementAction(index);
    const offValue = LABEL_SMOOTHING / Math.max(oneHot.length - 1, 1);
    return oneHot.map((value) => value ? 1 - LABEL_SMOOTHING : offValue);
}
function shuffle(items, random) {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [items[index], items[other]] = [items[other], items[index]];
    }
}
function between(random, min, max) { return min + random() * Math.max(0, max - min); }
function normalizeAngleDelta(degrees) { return ((degrees + 540) % 360) - 180; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function createObstacleSlots(random, conditions, referencedTargets) {
    const maxReferencedIndex = Math.max(0, ...[...referencedTargets]
        .map((target) => target?.match(/^object_(\d)$/)?.[1])
        .filter(Boolean)
        .map(Number));
    const count = clamp(Math.max(maxReferencedIndex, 1 + Math.floor(random() * MAX_OBSTACLE_SLOTS)), 1, MAX_OBSTACLE_SLOTS);
    const forcedType = Object.fromEntries(conditions
        .filter((condition) => condition.type === "target_health_pack" || condition.type === "target_damage_zone")
        .map((condition) => [
            condition.target ?? "object_1",
            condition.type === "target_health_pack" ? "healthPack" : "damageZone",
        ]));

    return Array.from({ length: count }, (_, index) => {
        const id = `object_${index + 1}`;
        const type = forcedType[id] ?? (random() < 0.5 ? "healthPack" : "damageZone");
        return createObstacle(random, id, type);
    });
}

function createObstacle(random, id, type) {
    const size = type === "healthPack" ? HEALTH_PACK_SIZE : DAMAGE_ZONE_SIZE;
    return {
        id,
        type,
        x: between(random, size / 2, CANVAS_SIZE - size / 2),
        y: between(random, size / 2, CANVAS_SIZE - size / 2),
        size,
        rotation: 0,
    };
}

function targetEntity(state, target) {
    if (target === "opponent") return state.opponent;
    return state.obstacles.find((obstacle) => obstacle.id === target) ?? null;
}

function removeTargetAndLaterObjectSlots(state, target) {
    const targetIndex = Number(target?.match(/^object_(\d)$/)?.[1]);
    if (!Number.isFinite(targetIndex)) return;
    state.obstacles = state.obstacles.filter((obstacle) => {
        const obstacleIndex = Number(obstacle.id?.match(/^object_(\d)$/)?.[1]);
        return !Number.isFinite(obstacleIndex) || obstacleIndex < targetIndex;
    });
}

function ensureObjectSlotExists(state, target, random) {
    const targetIndex = Number(target?.match(/^object_(\d)$/)?.[1]);
    if (!Number.isFinite(targetIndex)) return;
    const existing = new Set(state.obstacles.map((obstacle) => obstacle.id));
    for (let index = 1; index <= targetIndex; index += 1) {
        const id = `object_${index}`;
        if (!existing.has(id)) {
            state.obstacles.push(createObstacle(random, id, random() < 0.5 ? "healthPack" : "damageZone"));
        }
    }
    state.obstacles.sort((first, second) => String(first.id ?? "").localeCompare(String(second.id ?? "")));
}

function setTargetType(state, target, type) {
    const entity = targetEntity(state, target);
    if (!entity || target === "opponent") return;
    entity.type = type;
    entity.size = type === "healthPack" ? HEALTH_PACK_SIZE : DAMAGE_ZONE_SIZE;
}

function setTargetPosition(state, target, x, y) {
    const entity = targetEntity(state, target);
    if (!entity) return;
    const radius = (entity.size ?? ENTITY_SIZE) / 2;
    entity.x = clamp(x, radius, CANVAS_SIZE - radius);
    entity.y = clamp(y, radius, CANVAS_SIZE - radius);
}

function placeTargetAtDistance(state, target, distance, angle) {
    setTargetPosition(
        state,
        target,
        state.player.x + Math.cos(angle) * distance,
        state.player.y + Math.sin(angle) * distance,
    );
}

function placeTargetNearEdge(state, target, value, random) {
    const entity = targetEntity(state, target);
    if (!entity) return;
    const radius = (entity.size ?? ENTITY_SIZE) / 2;
    const gap = between(random, 0, Math.max(1, value - 1));
    const edge = Math.floor(random() * 4);
    if (edge === 0) setTargetPosition(state, target, radius + gap, entity.y);
    if (edge === 1) setTargetPosition(state, target, CANVAS_SIZE - radius - gap, entity.y);
    if (edge === 2) setTargetPosition(state, target, entity.x, radius + gap);
    if (edge === 3) setTargetPosition(state, target, entity.x, CANVAS_SIZE - radius - gap);
}
