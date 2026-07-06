import { MAX_OBSTACLE_SLOTS, obstacleSlots } from "./Featurebuilder.js";
import { DEFAULT_INTENT, intentFromAction } from "./IntentFeatures.js";

export const MELEE_STRATEGY_VERSION = "melee-logic-blocks-v2";
export const MAX_LOGIC_BLOCKS = 50;
export const MAX_CLUSTERS = 12;
export const MAX_CONDITIONS_PER_BLOCK = 4;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 10;
export const STRATEGY_TIME_LIMIT_MS = 15_000;
const TARGETLESS_MOVEMENT_ACTION_IDS = new Set([
    "move_center",
    "move_stop",
    "move_north",
    "move_south",
    "move_east",
    "move_west",
    "move_northeast",
    "move_northwest",
    "move_southeast",
    "move_southwest",
]);
const TARGETLESS_DASH_ACTION_IDS = new Set([
    "no_dash",
    "dash_north",
    "dash_south",
    "dash_east",
    "dash_west",
    "dash_northeast",
    "dash_northwest",
    "dash_southeast",
    "dash_southwest",
]);

export const CONDITION_TYPES = Object.freeze([
    flagCondition("always", "Always", { group: "Basic" }),
    thresholdCondition("enemy_distance_lt", "Target Distance <", 120, 0, 700, "px", { supportsTarget: true, group: "Target" }),
    thresholdCondition("enemy_distance_gt", "Target Distance >", 120, 0, 700, "px", { supportsTarget: true, group: "Target" }),
    thresholdCondition("my_edge_distance_lt", "My Distance From Edge <", 80, 0, 300, "px"),
    thresholdCondition("my_edge_distance_gt", "My Distance From Edge >", 80, 0, 300, "px"),
    thresholdCondition("target_edge_distance_lt", "Target Distance From Edge <", 80, 0, 300, "px", { supportsTarget: true, group: "Target" }),
    thresholdCondition("target_edge_distance_gt", "Target Distance From Edge >", 80, 0, 300, "px", { supportsTarget: true, group: "Target" }),
    flagCondition("enemy_attacking", "Opponent is Attacking", { group: "Opponent" }),
    flagCondition("enemy_blocking", "Opponent is Blocking", { group: "Opponent" }),
    flagCondition("enemy_rushing", "Opponent is Rushing", { group: "Opponent" }),
    flagCondition("enemy_fleeing", "Opponent is Fleeing", { group: "Opponent" }),
    thresholdCondition("my_hp_lt", "My HP <", 50, 1, 100, "HP", { group: "My Bot" }),
    thresholdCondition("my_hp_gt", "My HP >", 50, 0, 99, "HP", { group: "My Bot" }),
    thresholdCondition("enemy_hp_lt", "Opponent HP <", 50, 1, 100, "HP", { group: "Opponent" }),
    thresholdCondition("enemy_hp_gt", "Opponent HP >", 50, 0, 99, "HP", { group: "Opponent" }),
    flagCondition("my_swing_ready", "My Swing is Ready", { group: "My Bot" }),
    flagCondition("my_swing_cooldown", "My Swing is on Cooldown", { group: "My Bot" }),
    flagCondition("my_block_ready", "My Block is Ready", { group: "My Bot" }),
    flagCondition("my_block_cooldown", "My Block is on Cooldown", { group: "My Bot" }),
    flagCondition("my_shield_up", "My Shield is Up", { group: "My Bot" }),
    flagCondition("my_shield_down", "My Shield is Down", { group: "My Bot" }),
    thresholdCondition("my_shield_charges_lt", "My Shield Charges <", 3, 0, 5, "charges", { group: "My Bot" }),
    thresholdCondition("my_shield_charges_gt", "My Shield Charges >", 2, 0, 5, "charges", { group: "My Bot" }),
    flagCondition("my_dash_ready", "My Dash is Ready", { group: "My Bot" }),
    flagCondition("my_dash_cooldown", "My Dash is on Cooldown", { group: "My Bot" }),
    flagCondition("my_fire_gun_ready", "My Fire Gun is Ready", { group: "My Bot" }),
    flagCondition("my_fire_gun_cooldown", "My Fire Gun is on Cooldown", { group: "My Bot" }),
    flagCondition("my_grenade_ready", "My Grenade is Ready", { group: "My Bot" }),
    flagCondition("my_grenade_cooldown", "My Grenade is on Cooldown", { group: "My Bot" }),
    flagCondition("opponent_swing_ready", "Opponent Swing is Ready", { group: "Opponent" }),
    flagCondition("opponent_swing_cooldown", "Opponent Swing is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_block_ready", "Opponent Block is Ready", { group: "Opponent" }),
    flagCondition("opponent_block_cooldown", "Opponent Block is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_shield_up", "Opponent Shield is Up", { group: "Opponent" }),
    flagCondition("opponent_shield_down", "Opponent Shield is Down", { group: "Opponent" }),
    thresholdCondition("opponent_shield_charges_lt", "Opponent Shield Charges <", 3, 0, 5, "charges", { group: "Opponent" }),
    thresholdCondition("opponent_shield_charges_gt", "Opponent Shield Charges >", 2, 0, 5, "charges", { group: "Opponent" }),
    flagCondition("opponent_dash_ready", "Opponent Dash is Ready", { group: "Opponent" }),
    flagCondition("opponent_dash_cooldown", "Opponent Dash is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_fire_gun_ready", "Opponent Fire Gun is Ready", { group: "Opponent" }),
    flagCondition("opponent_fire_gun_cooldown", "Opponent Fire Gun is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_grenade_ready", "Opponent Grenade is Ready", { group: "Opponent" }),
    flagCondition("opponent_grenade_cooldown", "Opponent Grenade is on Cooldown", { group: "Opponent" }),
    flagCondition("target_exists", "Target Object Exists", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects", group: "Objects" }),
    flagCondition("target_missing", "Target Object Does Not Exist", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects", group: "Objects" }),
    flagCondition("target_health_pack", "Target is Health Pack", { supportsTarget: true, defaultTarget: "object_1", group: "Objects" }),
    flagCondition("target_damage_zone", "Target is Damage Zone", { supportsTarget: true, defaultTarget: "object_1", group: "Objects" }),
    flagCondition("inside_damage_zone", "I am in a Damage Zone", { group: "Objects" }),
]);
const LEGACY_CONDITION_TYPES = Object.freeze([
    thresholdCondition("my_cornered", "My Distance From Edge <", 80, 0, 300, "px"),
    thresholdCondition("enemy_cornered", "Target Distance From Edge <", 80, 0, 300, "px", { supportsTarget: true, group: "Target" }),
]);
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
    { id: "move_north", label: "Move: North", head: "movement" },
    { id: "move_south", label: "Move: South", head: "movement" },
    { id: "move_east", label: "Move: East", head: "movement" },
    { id: "move_west", label: "Move: West", head: "movement" },
    { id: "move_northeast", label: "Move: Northeast", head: "movement" },
    { id: "move_northwest", label: "Move: Northwest", head: "movement" },
    { id: "move_southeast", label: "Move: Southeast", head: "movement" },
    { id: "move_southwest", label: "Move: Southwest", head: "movement" },
    { id: "move_stop", label: "Move: Hold Ground (Stop)", head: "movement" },
    { id: "rotate_toward_enemy", label: "Rotate: Face Enemy", head: "rotation" },
    { id: "swing", label: "Action: Swing Weapon", head: "swing" },
    { id: "block", label: "Action: Raise Shield", head: "block" },
    { id: "fire_gun", label: "Action: Fire Gun", head: "gun" },
    { id: "throw_grenade", label: "Action: Throw Grenade", head: "grenade" },
    { id: "no_dash", label: "Dash: Don't Dash", head: "dash" },
    { id: "dash", label: "Dash: Toward Target", head: "dash" },
    { id: "dash_outward", label: "Dash: Away from Target", head: "dash" },
    { id: "dash_tangent_left", label: "Dash: Tangential Left", head: "dash" },
    { id: "dash_tangent_right", label: "Dash: Tangential Right", head: "dash" },
    { id: "dash_diagonal_in_left", label: "Dash: Diagonal Left Inward", head: "dash" },
    { id: "dash_diagonal_in_right", label: "Dash: Diagonal Right Inward", head: "dash" },
    { id: "dash_diagonal_out_left", label: "Dash: Diagonal Left Backward", head: "dash" },
    { id: "dash_diagonal_out_right", label: "Dash: Diagonal Right Backward", head: "dash" },
    { id: "dash_north", label: "Dash: North", head: "dash" },
    { id: "dash_south", label: "Dash: South", head: "dash" },
    { id: "dash_east", label: "Dash: East", head: "dash" },
    { id: "dash_west", label: "Dash: West", head: "dash" },
    { id: "dash_northeast", label: "Dash: Northeast", head: "dash" },
    { id: "dash_northwest", label: "Dash: Northwest", head: "dash" },
    { id: "dash_southeast", label: "Dash: Southeast", head: "dash" },
    { id: "dash_southwest", label: "Dash: Southwest", head: "dash" },
]);

const CONDITION_BY_ID = new Map(CONDITION_DEFINITIONS.map((condition) => [condition.id, condition]));
const ACTION_BY_ID = new Map(ACTION_TYPES.map((action) => [action.id, action]));
export const TARGET_TYPES = Object.freeze([
    { id: "opponent", label: "Opponent" },
    { id: "opponent_grenade", label: "Opponent's Grenade" },
    ...Array.from({ length: MAX_OBSTACLE_SLOTS }, (_, index) => ({
        id: `object_${index + 1}`,
        label: `Object ${index + 1}`,
    })),
]);
const TARGET_BY_ID = new Map(TARGET_TYPES.map((target) => [target.id, target]));
const ENTITY_SIZE = 60;
export const CONDITION_COMPARATORS = Object.freeze([
    { id: "lt", label: "<", valueTypes: ["number"] },
    { id: "lte", label: "<=", valueTypes: ["number"] },
    { id: "eq", label: "=", valueTypes: ["number", "boolean"] },
    { id: "neq", label: "!=", valueTypes: ["number", "boolean"] },
    { id: "gte", label: ">=", valueTypes: ["number"] },
    { id: "gt", label: ">", valueTypes: ["number"] },
]);
const COMPARATOR_BY_ID = new Map(CONDITION_COMPARATORS.map((comparator) => [comparator.id, comparator]));
export const STATE_VARIABLES = Object.freeze([
    variableDefinition("my.hp", "My HP", "number", { group: "My Bot", min: 0, max: 100 }),
    variableDefinition("opponent.hp", "Opponent HP", "number", { group: "Opponent", min: 0, max: 100 }),
    variableDefinition("target.distance", "Target Distance", "number", { group: "Target", min: 0, max: 700, supportsTarget: true }),
    variableDefinition("my.edgeDistance", "My Distance From Edge", "number", { group: "My Bot", min: 0, max: 300 }),
    variableDefinition("target.edgeDistance", "Target Distance From Edge", "number", { group: "Target", min: 0, max: 300, supportsTarget: true }),
    variableDefinition("my.swingReady", "My Swing Ready", "boolean", { group: "My Bot", ownConditionId: "my_swing_ready" }),
    variableDefinition("my.swingCooldownMs", "My Swing Cooldown", "number", { group: "My Bot", min: 0, max: 2000, ownConditionId: "my_swing_cooldown" }),
    variableDefinition("my.blockReady", "My Block Ready", "boolean", { group: "My Bot", ownConditionId: "my_block_ready" }),
    variableDefinition("my.shieldUp", "My Shield Up", "boolean", { group: "My Bot", ownConditionId: "my_shield_up" }),
    variableDefinition("my.shieldCharges", "My Shield Charges", "number", { group: "My Bot", min: 0, max: 5, ownConditionId: "my_shield_charges_lt" }),
    variableDefinition("my.blockRechargeMs", "My Block Recharge", "number", { group: "My Bot", min: 0, max: 3000, ownConditionId: "my_block_cooldown" }),
    variableDefinition("my.dashReady", "My Dash Ready", "boolean", { group: "My Bot", ownConditionId: "my_dash_ready" }),
    variableDefinition("my.dashCooldownMs", "My Dash Cooldown", "number", { group: "My Bot", min: 0, max: 4500, ownConditionId: "my_dash_cooldown" }),
    variableDefinition("my.gunReady", "My Gun Ready", "boolean", { group: "My Bot", ownConditionId: "my_fire_gun_ready" }),
    variableDefinition("my.gunCooldownMs", "My Gun Cooldown", "number", { group: "My Bot", min: 0, max: 3000, ownConditionId: "my_fire_gun_cooldown" }),
    variableDefinition("my.gunAmmo", "My Gun Ammo", "number", { group: "My Bot", min: 0, max: 10, ownConditionId: "my_fire_gun_ready" }),
    variableDefinition("my.gunReloadMs", "My Gun Reload", "number", { group: "My Bot", min: 0, max: 3000, ownConditionId: "my_fire_gun_cooldown" }),
    variableDefinition("my.grenadeReady", "My Grenade Ready", "boolean", { group: "My Bot", ownConditionId: "my_grenade_ready" }),
    variableDefinition("my.grenadeCooldownMs", "My Grenade Cooldown", "number", { group: "My Bot", min: 0, max: 12000, ownConditionId: "my_grenade_cooldown" }),
    variableDefinition("opponent.swingReady", "Opponent Swing Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_swing_ready" }),
    variableDefinition("opponent.swingCooldownMs", "Opponent Swing Cooldown", "number", { group: "Opponent", min: 0, max: 2000, opponentConditionId: "opponent_swing_cooldown" }),
    variableDefinition("opponent.blockReady", "Opponent Block Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_block_ready" }),
    variableDefinition("opponent.shieldUp", "Opponent Shield Up", "boolean", { group: "Opponent", opponentConditionId: "opponent_shield_up" }),
    variableDefinition("opponent.shieldCharges", "Opponent Shield Charges", "number", { group: "Opponent", min: 0, max: 5, opponentConditionId: "opponent_shield_charges_lt" }),
    variableDefinition("opponent.blockRechargeMs", "Opponent Block Recharge", "number", { group: "Opponent", min: 0, max: 3000, opponentConditionId: "opponent_block_cooldown" }),
    variableDefinition("opponent.dashReady", "Opponent Dash Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_dash_ready" }),
    variableDefinition("opponent.dashCooldownMs", "Opponent Dash Cooldown", "number", { group: "Opponent", min: 0, max: 4500, opponentConditionId: "opponent_dash_cooldown" }),
    variableDefinition("opponent.gunReady", "Opponent Gun Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_fire_gun_ready" }),
    variableDefinition("opponent.gunCooldownMs", "Opponent Gun Cooldown", "number", { group: "Opponent", min: 0, max: 3000, opponentConditionId: "opponent_fire_gun_cooldown" }),
    variableDefinition("opponent.gunAmmo", "Opponent Gun Ammo", "number", { group: "Opponent", min: 0, max: 10, opponentConditionId: "opponent_fire_gun_ready" }),
    variableDefinition("opponent.gunReloadMs", "Opponent Gun Reload", "number", { group: "Opponent", min: 0, max: 3000, opponentConditionId: "opponent_fire_gun_cooldown" }),
    variableDefinition("opponent.grenadeReady", "Opponent Grenade Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_grenade_ready" }),
    variableDefinition("opponent.grenadeCooldownMs", "Opponent Grenade Cooldown", "number", { group: "Opponent", min: 0, max: 12000, opponentConditionId: "opponent_grenade_cooldown" }),
    variableDefinition("target.exists", "Target Exists", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("target.isHealthPack", "Target is Health Pack", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("target.isDamageZone", "Target is Damage Zone", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("my.insideDamageZone", "I am in a Damage Zone", "boolean", { group: "Objects" }),
]);
const STATE_VARIABLE_BY_ID = new Map(STATE_VARIABLES.map((variable) => [variable.id, variable]));

export function createDefaultMeleeStrategyConfiguration() {
    return {
        version: MELEE_STRATEGY_VERSION,
        blocks: [],
        clusters: [],
    };
}

export function createLogicBlock(conditionType = "enemy_distance_lt", action = "move_stop") {
    const definition = CONDITION_BY_ID.get(conditionType) ?? CONDITION_TYPES[0];
    return {
        id: `logic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conditions: [{
            type: definition.id,
            ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
            ...(definition.supportsTarget ? { target: definition.defaultTarget ?? "opponent" } : {}),
        }],
        priority: 1,
        action: ACTION_BY_ID.has(action) ? action : ACTION_TYPES[0].id,
        actionTarget: normalizeActionTarget("opponent", action),
    };
}

export function createExpressionCondition(left = "target.distance") {
    const variable = STATE_VARIABLE_BY_ID.get(left) ?? STATE_VARIABLES[0];
    return normalizeExpressionCondition({
        type: "expression",
        left: variable.id,
        comparator: variable.valueType === "boolean" ? "eq" : "lt",
        right: variable.valueType === "boolean"
            ? { type: "boolean", value: true }
            : { type: "number", value: variable.defaultValue },
        ...(variable.supportsTarget ? { target: variable.defaultTarget ?? "opponent" } : {}),
    });
}

export function createLogicCluster(conditionType = "my_hp_lt") {
    const definition = CONDITION_BY_ID.get(conditionType) ?? CONDITION_TYPES[0];
    return {
        id: `cluster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Cluster",
        priority: 1,
        conditions: [{
            type: definition.id,
            ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
            ...(definition.supportsTarget ? { target: definition.defaultTarget ?? "opponent" } : {}),
        }],
        blocks: [],
    };
}

export function normalizeMeleeStrategyConfiguration(configuration) {
    const sourceBlocks = Array.isArray(configuration?.blocks)
        ? configuration.blocks
        : createDefaultMeleeStrategyConfiguration().blocks;
    let remainingBlocks = MAX_LOGIC_BLOCKS;
    const blocks = sourceBlocks.slice(0, remainingBlocks).map((block, blockIndex) => normalizeBlock(block, blockIndex));
    remainingBlocks -= blocks.length;
    const sourceClusters = Array.isArray(configuration?.clusters) ? configuration.clusters : [];
    const clusters = [];
    for (let clusterIndex = 0; clusterIndex < Math.min(sourceClusters.length, MAX_CLUSTERS) && remainingBlocks > 0; clusterIndex += 1) {
        const cluster = sourceClusters[clusterIndex];
        const sourceClusterBlocks = Array.isArray(cluster?.blocks) ? cluster.blocks : [];
        const clusterBlocks = sourceClusterBlocks
            .slice(0, remainingBlocks)
            .map((block, blockIndex) => normalizeBlock(block, blockIndex));
        remainingBlocks -= clusterBlocks.length;
        clusters.push({
            id: String(cluster?.id || `cluster-${clusterIndex + 1}`),
            name: String(cluster?.name || `Cluster ${clusterIndex + 1}`).slice(0, 40),
            priority: normalizePriority(cluster?.priority),
            conditions: normalizeConditions(cluster?.conditions),
            blocks: clusterBlocks,
        });
    }

    return {
        version: MELEE_STRATEGY_VERSION,
        blocks,
        clusters,
    };
}

export function validateMeleeStrategyConfiguration(configuration) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    const errors = [];
    const entries = normalizedBlockEntries(normalized);
    if (!entries.some((entry) => isTrainableBlock(entry.block))) {
        errors.push("Add at least one action logic block before submitting.");
    }
    entries.forEach(({ block, label }) => {
        const ids = new Set(block.conditions.map((condition) => condition.type));
        for (const [first, second] of [
            ["enemy_rushing", "enemy_fleeing"],
            ["my_swing_ready", "my_swing_cooldown"],
            ["my_block_ready", "my_block_cooldown"],
            ["my_shield_up", "my_shield_down"],
            ["my_dash_ready", "my_dash_cooldown"],
            ["my_fire_gun_ready", "my_fire_gun_cooldown"],
            ["my_grenade_ready", "my_grenade_cooldown"],
            ["opponent_swing_ready", "opponent_swing_cooldown"],
            ["opponent_block_ready", "opponent_block_cooldown"],
            ["opponent_shield_up", "opponent_shield_down"],
            ["opponent_dash_ready", "opponent_dash_cooldown"],
            ["opponent_fire_gun_ready", "opponent_fire_gun_cooldown"],
            ["opponent_grenade_ready", "opponent_grenade_cooldown"],
        ]) {
            if (ids.has(first) && ids.has(second)) errors.push(`${label} contains contradictory conditions.`);
        }
        for (const target of TARGET_TYPES) {
            const lower = block.conditions.find((condition) => (
                condition.type === "enemy_distance_gt" && (condition.target ?? "opponent") === target.id
            ))?.value;
            const upper = block.conditions.find((condition) => (
                condition.type === "enemy_distance_lt" && (condition.target ?? "opponent") === target.id
            ))?.value;
            if (lower != null && upper != null && lower >= upper) {
                errors.push(`${label} has an impossible ${target.label.toLowerCase()} distance range.`);
            }
            const typeConditions = new Set(block.conditions.filter((condition) => (
                (condition.type === "target_health_pack" || condition.type === "target_damage_zone")
                && (condition.target ?? "object_1") === target.id
            )).map((condition) => condition.type));
            if (typeConditions.size > 1) {
                errors.push(`${label} requires ${target.label.toLowerCase()} to be multiple obstacle types.`);
            }
            const targetConditionTypes = new Set(block.conditions.filter((condition) => (
                condition.target === target.id
            )).map((condition) => condition.type));
            if (targetConditionTypes.has("target_exists") && targetConditionTypes.has("target_missing")) {
                errors.push(`${label} requires ${target.label.toLowerCase()} to both exist and not exist.`);
            }
            if (targetConditionTypes.has("target_missing") && [...targetConditionTypes].some((type) => (
                type !== "target_missing"
            ))) {
                errors.push(`${label} requires ${target.label.toLowerCase()} to be missing while using it.`);
            }
        }
        validateThresholdRange(errors, block, label, "my_hp_gt", "my_hp_lt", "my HP");
        validateThresholdRange(errors, block, label, "enemy_hp_gt", "enemy_hp_lt", "opponent HP");
    });
    return { configuration: normalized, errors };
}

function activeIntentForBlock(block) {
    return intentFromAction(block.action, block.actionTarget);
}

export function selectMeleeStrategyBlock(configuration, payload) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    const state = stateFromPayload(payload);
    return selectPriorityCandidates(normalized, state).find((entry) => isTrainableBlock(entry.block))?.block ?? null;
}

export function shouldSuppressMeleeStrategyDash(configuration, payload) {
    return selectMeleeStrategyActionPlan(configuration, payload).dash?.action === "no_dash";
}

export function shouldAllowMeleeStrategyDash(configuration, payload) {
    return Boolean(selectMeleeStrategyActionPlan(configuration, payload).dash?.action?.startsWith("dash"));
}

export function selectMeleeStrategyIntent(configuration, payload) {
    const plan = selectMeleeStrategyActionPlan(configuration, payload);
    const primary = plan.primary ?? plan.movement ?? plan.dash ?? plan.rotation ?? plan.swing ?? plan.block ?? plan.gun ?? plan.grenade;
    if (!primary) return DEFAULT_INTENT;
    const intent = activeIntentForBlock(primary);
    return {
        ...intent,
        dash: plan.dash?.action?.startsWith("dash") ? 1 : 0,
    };
}

export function selectMeleeStrategyActionPlan(configuration, payload) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    const state = stateFromPayload(payload);
    const selected = selectPriorityCandidates(normalized, state);
    const plan = { primary: selected.find((entry) => isTrainableBlock(entry.block))?.block ?? null };
    for (const { block } of selected) {
        const action = ACTION_BY_ID.get(block.action) ?? ACTION_TYPES[0];
        if (block.action.startsWith("dash") && !plan.dashMovement) plan.dashMovement = block;
        if (block.action === "no_dash") plan.dash = block;
        else if (!plan[action.head]) plan[action.head] = block;
    }
    return plan;
}

export function evaluateCondition(condition, state) {
    if (condition?.type === "expression") {
        return evaluateExpressionCondition(condition, state);
    }
    const target = targetEntity(state, condition.target ?? "opponent");
    const distance = target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY;
    switch (condition.type) {
        case "always": return true;
        case "enemy_distance_lt": return distance < condition.value;
        case "enemy_distance_gt": return distance > condition.value;
        case "my_edge_distance_lt":
        case "my_cornered": return edgeDistance(state.player) < condition.value;
        case "my_edge_distance_gt": return edgeDistance(state.player) > condition.value;
        case "target_edge_distance_lt":
        case "enemy_cornered": return target ? edgeDistance(target) < condition.value : false;
        case "target_edge_distance_gt": return target ? edgeDistance(target) > condition.value : false;
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
        case "my_shield_up": return state.player.blockActive;
        case "my_shield_down": return !state.player.blockActive;
        case "my_shield_charges_lt": return state.player.blockCharges < condition.value;
        case "my_shield_charges_gt": return state.player.blockCharges > condition.value;
        case "my_dash_ready": return state.player.dashAvailable;
        case "my_dash_cooldown": return !state.player.dashAvailable;
        case "my_fire_gun_ready": return state.player.gunAvailable;
        case "my_fire_gun_cooldown": return !state.player.gunAvailable;
        case "my_grenade_ready": return state.player.grenadeAvailable;
        case "my_grenade_cooldown": return !state.player.grenadeAvailable;
        case "opponent_swing_ready": return Boolean(state.opponent?.swingAvailable);
        case "opponent_swing_cooldown": return Boolean(state.opponent) && !state.opponent.swingAvailable;
        case "opponent_block_ready": return Boolean(state.opponent?.blockAvailable);
        case "opponent_block_cooldown": return Boolean(state.opponent) && !state.opponent.blockAvailable;
        case "opponent_shield_up": return Boolean(state.opponent?.blockActive);
        case "opponent_shield_down": return Boolean(state.opponent) && !state.opponent.blockActive;
        case "opponent_shield_charges_lt": return Boolean(state.opponent) && state.opponent.blockCharges < condition.value;
        case "opponent_shield_charges_gt": return Boolean(state.opponent) && state.opponent.blockCharges > condition.value;
        case "opponent_dash_ready": return Boolean(state.opponent?.dashAvailable);
        case "opponent_dash_cooldown": return Boolean(state.opponent) && !state.opponent.dashAvailable;
        case "opponent_fire_gun_ready": return Boolean(state.opponent?.gunAvailable);
        case "opponent_fire_gun_cooldown": return Boolean(state.opponent) && !state.opponent.gunAvailable;
        case "opponent_grenade_ready": return Boolean(state.opponent?.grenadeAvailable);
        case "opponent_grenade_cooldown": return Boolean(state.opponent) && !state.opponent.grenadeAvailable;
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

function isTrainableBlock(block) {
    return block?.action !== "no_dash";
}

function normalizedBlockEntries(normalized) {
    return [
        ...normalized.blocks.map((block, blockIndex) => ({
            block,
            blockIndex,
            clusterIndex: -1,
            clusterPriority: 1,
            clusterConditions: [],
            label: `Block ${blockIndex + 1}`,
        })),
        ...normalized.clusters.flatMap((cluster, clusterIndex) => (
            cluster.blocks.map((block, blockIndex) => ({
                block,
                blockIndex,
                clusterIndex,
                clusterPriority: cluster.priority,
                clusterConditions: cluster.conditions,
                label: `Cluster ${clusterIndex + 1} block ${blockIndex + 1}`,
            }))
        )),
    ];
}

function selectPriorityCandidates(normalized, state) {
    const matching = normalizedBlockEntries(normalized)
        .filter((entry) => (
            entry.clusterConditions.every((condition) => evaluateCondition(condition, state))
            && entry.block.conditions.every((condition) => evaluateCondition(condition, state))
        ))
        .sort(comparePriorityEntries);
    if (!matching.length) return [];
    const winner = matching[0];
    return matching.filter((entry) => (
        entry.clusterPriority === winner.clusterPriority
        && entry.block.priority === winner.block.priority
    ));
}

function comparePriorityEntries(first, second) {
    return first.clusterPriority - second.clusterPriority
        || first.block.priority - second.block.priority
        || first.clusterIndex - second.clusterIndex
        || first.blockIndex - second.blockIndex;
}

function stateFromPayload(payload) {
    const objects = Array.isArray(payload?.objects) ? payload.objects : [];
    const player = {
        ...(payload?.playerModel ?? {}),
        hp: payload?.playerModel?.hp ?? 100,
        size: payload?.playerModel?.size ?? ENTITY_SIZE,
        swingAvailable: Boolean(payload?.playerModel?.swingAvailable),
        swingCooldownRemainingMs: Number(payload?.playerModel?.swingCooldownRemainingMs) || 0,
        blockAvailable: Boolean(payload?.playerModel?.blockAvailable),
        blockActive: Boolean(payload?.playerModel?.blockActive),
        blockCooldownRemainingMs: Number(payload?.playerModel?.blockCooldownRemainingMs) || 0,
        blockCharges: Number.isFinite(Number(payload?.playerModel?.blockCharges)) ? Number(payload.playerModel.blockCharges) : 0,
        dashAvailable: Boolean(payload?.playerModel?.dashAvailable),
        dashCooldownRemainingMs: Number(payload?.playerModel?.dashCooldownRemainingMs) || 0,
        gunAvailable: Boolean(payload?.playerModel?.gunAvailable),
        gunCooldownRemainingMs: Number(payload?.playerModel?.gunCooldownRemainingMs) || 0,
        gunAmmo: Number.isFinite(Number(payload?.playerModel?.gunAmmo)) ? Number(payload.playerModel.gunAmmo) : 0,
        gunReloadRemainingMs: Number(payload?.playerModel?.gunReloadRemainingMs) || 0,
        grenadeAvailable: Boolean(payload?.playerModel?.grenadeAvailable),
        grenadeCooldownRemainingMs: Number(payload?.playerModel?.grenadeCooldownRemainingMs) || 0,
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
            swingAvailable: Boolean(opponent.swingAvailable),
            swingCooldownRemainingMs: Number(opponent.swingCooldownRemainingMs) || 0,
            blockAvailable: Boolean(opponent.blockAvailable),
            blockCooldownRemainingMs: Number(opponent.blockCooldownRemainingMs) || 0,
            blockCharges: Number.isFinite(Number(opponent.blockCharges)) ? Number(opponent.blockCharges) : 0,
            dashAvailable: Boolean(opponent.dashAvailable),
            dashCooldownRemainingMs: Number(opponent.dashCooldownRemainingMs) || 0,
            gunAvailable: Boolean(opponent.gunAvailable),
            gunCooldownRemainingMs: Number(opponent.gunCooldownRemainingMs) || 0,
            gunAmmo: Number.isFinite(Number(opponent.gunAmmo)) ? Number(opponent.gunAmmo) : 0,
            gunReloadRemainingMs: Number(opponent.gunReloadRemainingMs) || 0,
            grenadeAvailable: Boolean(opponent.grenadeAvailable),
            grenadeCooldownRemainingMs: Number(opponent.grenadeCooldownRemainingMs) || 0,
            velocityX: opponent.velocityX ?? 0,
            velocityY: opponent.velocityY ?? 0,
        } : null,
        objects,
        obstacles: obstacleSlots(objects),
    };
}

function normalizeConditions(conditions) {
    const source = Array.isArray(conditions) ? conditions : [{ type: CONDITION_TYPES[0].id }];
    return source.slice(0, MAX_CONDITIONS_PER_BLOCK).map((condition) => {
        if (condition?.type === "expression" || condition?.left) {
            return normalizeExpressionCondition(condition);
        }
        const conditionType = normalizeConditionType(condition?.type);
        const definition = CONDITION_BY_ID.get(conditionType) ?? CONDITION_TYPES[0];
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

function normalizeExpressionCondition(condition) {
    const leftDefinition = STATE_VARIABLE_BY_ID.get(condition?.left) ?? STATE_VARIABLES[0];
    const comparator = normalizeComparator(condition?.comparator, leftDefinition.valueType);
    const right = normalizeRightOperand(condition?.right, leftDefinition);
    return {
        type: "expression",
        left: leftDefinition.id,
        comparator,
        right,
        ...(expressionSupportsTarget(leftDefinition, right) ? {
            target: normalizeTarget(
                condition?.target,
                expressionDefaultTarget(leftDefinition, right),
                expressionTargetGroup(leftDefinition, right),
            ),
        } : {}),
    };
}

function normalizeComparator(comparator, valueType) {
    const definition = COMPARATOR_BY_ID.get(comparator);
    if (definition?.valueTypes.includes(valueType)) return definition.id;
    return valueType === "boolean" ? "eq" : "lt";
}

function normalizeRightOperand(right, leftDefinition) {
    if (leftDefinition.valueType === "boolean") {
        return { type: "boolean", value: normalizeBoolean(right?.value, true) };
    }
    if (right?.type === "variable") {
        const rightDefinition = STATE_VARIABLE_BY_ID.get(right.value);
        if (rightDefinition?.valueType === "number") {
            return { type: "variable", value: rightDefinition.id };
        }
    }
    return {
        type: "number",
        value: clamp(Number(right?.value ?? leftDefinition.defaultValue), leftDefinition.min, leftDefinition.max),
    };
}

function expressionSupportsTarget(leftDefinition, right) {
    if (leftDefinition.supportsTarget) return true;
    return right?.type === "variable" && Boolean(STATE_VARIABLE_BY_ID.get(right.value)?.supportsTarget);
}

function expressionTargetGroup(leftDefinition, right) {
    return leftDefinition.targetGroup
        ?? (right?.type === "variable" ? STATE_VARIABLE_BY_ID.get(right.value)?.targetGroup : null)
        ?? null;
}

function expressionDefaultTarget(leftDefinition, right) {
    return leftDefinition.defaultTarget
        ?? (right?.type === "variable" ? STATE_VARIABLE_BY_ID.get(right.value)?.defaultTarget : null)
        ?? "opponent";
}

function normalizeConditionType(type) {
    if (type === "my_cornered") return "my_edge_distance_lt";
    if (type === "enemy_cornered") return "target_edge_distance_lt";
    return type;
}

function normalizeBlock(block, blockIndex) {
    return {
        id: String(block?.id || `logic-${blockIndex + 1}`),
        conditions: normalizeConditions(block?.conditions),
        priority: normalizePriority(block?.priority),
        action: ACTION_BY_ID.has(block?.action) ? block.action : ACTION_TYPES[0].id,
        actionTarget: normalizeActionTarget(block?.actionTarget, block?.action),
    };
}

function normalizePriority(value) {
    return clamp(Math.round(Number.isFinite(Number(value)) ? Number(value) : 1), MIN_PRIORITY, MAX_PRIORITY);
}

function normalizeActionTarget(target, actionId) {
    const action = ACTION_BY_ID.get(actionId) ?? ACTION_TYPES[0];
    if (!actionSupportsTarget(action)) return "opponent";
    return normalizeTarget(target, "opponent");
}

export function actionSupportsTarget(action) {
    return (action.head === "movement" && !TARGETLESS_MOVEMENT_ACTION_IDS.has(action.id))
        || (action.head === "dash" && !TARGETLESS_DASH_ACTION_IDS.has(action.id))
        || action.id === "rotate_toward_enemy";
}

function normalizeTarget(target, fallback, targetGroup = null) {
    if (!TARGET_BY_ID.has(target)) return fallback;
    if (targetGroup === "objects" && !String(target).startsWith("object_") && target !== "opponent_grenade") return fallback;
    return target;
}

function validateThresholdRange(errors, block, blockLabel, lowerType, upperType, label) {
    const lower = block.conditions.find((condition) => condition.type === lowerType)?.value;
    const upper = block.conditions.find((condition) => condition.type === upperType)?.value;
    if (lower != null && upper != null && lower >= upper) {
        errors.push(`${blockLabel} has an impossible ${label} range.`);
    }
}

function evaluateExpressionCondition(condition, state) {
    const leftDefinition = STATE_VARIABLE_BY_ID.get(condition.left);
    if (!leftDefinition) return false;
    const left = resolveStateVariable(state, condition, leftDefinition.id);
    const right = condition.right?.type === "variable"
        ? resolveStateVariable(state, condition, condition.right.value)
        : condition.right?.value;
    return compareValues(left, condition.comparator, right, leftDefinition.valueType);
}

function resolveStateVariable(state, condition, variableId) {
    const target = targetEntity(state, condition.target ?? "opponent");
    switch (variableId) {
        case "my.hp": return state.player.hp;
        case "opponent.hp": return state.opponent?.hp ?? 0;
        case "target.distance": return target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY;
        case "my.edgeDistance": return edgeDistance(state.player);
        case "target.edgeDistance": return target ? edgeDistance(target) : 0;
        case "my.swingReady": return Boolean(state.player.swingAvailable);
        case "my.swingCooldownMs": return state.player.swingCooldownRemainingMs ?? 0;
        case "my.blockReady": return Boolean(state.player.blockAvailable);
        case "my.shieldUp": return Boolean(state.player.blockActive);
        case "my.shieldCharges": return state.player.blockCharges ?? 0;
        case "my.blockRechargeMs": return state.player.blockCooldownRemainingMs ?? 0;
        case "my.dashReady": return Boolean(state.player.dashAvailable);
        case "my.dashCooldownMs": return state.player.dashCooldownRemainingMs ?? 0;
        case "my.gunReady": return Boolean(state.player.gunAvailable);
        case "my.gunCooldownMs": return state.player.gunCooldownRemainingMs ?? 0;
        case "my.gunAmmo": return state.player.gunAmmo ?? 0;
        case "my.gunReloadMs": return state.player.gunReloadRemainingMs ?? 0;
        case "my.grenadeReady": return Boolean(state.player.grenadeAvailable);
        case "my.grenadeCooldownMs": return state.player.grenadeCooldownRemainingMs ?? 0;
        case "opponent.swingReady": return Boolean(state.opponent?.swingAvailable);
        case "opponent.swingCooldownMs": return state.opponent?.swingCooldownRemainingMs ?? 0;
        case "opponent.blockReady": return Boolean(state.opponent?.blockAvailable);
        case "opponent.shieldUp": return Boolean(state.opponent?.blockActive);
        case "opponent.shieldCharges": return state.opponent?.blockCharges ?? 0;
        case "opponent.blockRechargeMs": return state.opponent?.blockCooldownRemainingMs ?? 0;
        case "opponent.dashReady": return Boolean(state.opponent?.dashAvailable);
        case "opponent.dashCooldownMs": return state.opponent?.dashCooldownRemainingMs ?? 0;
        case "opponent.gunReady": return Boolean(state.opponent?.gunAvailable);
        case "opponent.gunCooldownMs": return state.opponent?.gunCooldownRemainingMs ?? 0;
        case "opponent.gunAmmo": return state.opponent?.gunAmmo ?? 0;
        case "opponent.gunReloadMs": return state.opponent?.gunReloadRemainingMs ?? 0;
        case "opponent.grenadeReady": return Boolean(state.opponent?.grenadeAvailable);
        case "opponent.grenadeCooldownMs": return state.opponent?.grenadeCooldownRemainingMs ?? 0;
        case "target.exists": return Boolean(target) && condition.target !== "opponent";
        case "target.isHealthPack": return target?.type === "healthPack";
        case "target.isDamageZone": return target?.type === "damageZone";
        case "my.insideDamageZone": return state.obstacles.some((obstacle) => (
            obstacle.type === "damageZone" && distanceBetween(state.player, obstacle) <= (state.player.size + obstacle.size) / 2
        ));
        default: return null;
    }
}

function compareValues(left, comparator, right, valueType) {
    if (valueType === "boolean") {
        const leftBoolean = Boolean(left);
        const rightBoolean = Boolean(right);
        return comparator === "neq" ? leftBoolean !== rightBoolean : leftBoolean === rightBoolean;
    }
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
        return false;
    }
    switch (comparator) {
        case "lt": return leftNumber < rightNumber;
        case "lte": return leftNumber <= rightNumber;
        case "eq": return leftNumber === rightNumber;
        case "neq": return leftNumber !== rightNumber;
        case "gte": return leftNumber >= rightNumber;
        case "gt": return leftNumber > rightNumber;
        default: return false;
    }
}

function variableDefinition(id, label, valueType, options = {}) {
    return {
        id,
        label,
        valueType,
        defaultValue: valueType === "boolean" ? true : 50,
        min: valueType === "number" ? 0 : undefined,
        max: valueType === "number" ? 100 : undefined,
        ...options,
    };
}

function normalizeBoolean(value, fallback) {
    if (value === true || value === false) return value;
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
    return fallback;
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
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function targetEntity(state, target) {
    if (target === "opponent") return state.opponent;
    if (target === "opponent_grenade") {
        return state.objects.find((object) => (
            object?.type === "grenade"
            && object.ownerId
            && object.ownerId === state.opponent?.id
        )) ?? null;
    }
    return state.obstacles.find((obstacle) => obstacle.id === target) ?? null;
}
