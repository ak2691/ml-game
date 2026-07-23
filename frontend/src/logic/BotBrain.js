import { DEFAULT_INTENT, intentFromAction } from "./LegacyIntent.js";
import { ARENA_HEIGHT_UNITS, ARENA_WIDTH_UNITS } from "../beta/modelPayloads/arenaConstants.js";
import { BOT_ABILITIES, PROTOTYPE_ABILITY_STATS, PROTOTYPE_ACTION_TO_ABILITY, entityTargetDefinitions } from "../beta/loadout/BotLoadout.js";

export const MELEE_STRATEGY_VERSION = "melee-logic-tree-v1";
export const MAX_LOGIC_BLOCKS = 100;
export const MAX_BRAIN_NODES = 100;
export const MAX_TOTAL_CONDITIONS = 300;
export const MAX_CUSTOM_VARIABLE_SLOTS = 100;
export const MAX_VARIABLE_ACTION_TERMS = 20;
export const CUSTOM_INTEGER_MIN = -99_999;
export const CUSTOM_INTEGER_MAX = 99_999;
export const MAX_CLUSTERS = MAX_BRAIN_NODES;
export const MAX_CONDITIONS_PER_BLOCK = MAX_TOTAL_CONDITIONS;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 10;
export const STRATEGY_TIME_LIMIT_MS = 15_000;
const MAX_OBSTACLE_SLOTS = 6;
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

const PROTOTYPE_CONDITION_TYPES = BOT_ABILITIES.filter(({ id }) => PROTOTYPE_ABILITY_STATS[id]).flatMap((ability) => [
    flagCondition(`my_${ability.id}_ready`, `My ${ability.label} is Ready`, { group: "My Bot" }),
    flagCondition(`my_${ability.id}_cooldown`, `My ${ability.label} is on Cooldown`, { group: "My Bot" }),
    flagCondition(`opponent_${ability.id}_ready`, `Opponent ${ability.label} is Ready`, { group: "Opponent" }),
    flagCondition(`opponent_${ability.id}_cooldown`, `Opponent ${ability.label} is on Cooldown`, { group: "Opponent" }),
    ...(PROTOTYPE_ABILITY_STATS[ability.id].windupMs ? [
        flagCondition(`my_${ability.id}_preparing`, `My Bot is Preparing ${ability.label}`, { group: "My Bot" }),
        flagCondition(`opponent_${ability.id}_preparing`, `Opponent is Preparing ${ability.label}`, { group: "Opponent" }),
    ] : []),
]);

const LEGACY_ABILITY_FLAG_CONDITIONS = Object.freeze([
    flagCondition("always", "ALWAYS", { group: "Basic" }),
    flagCondition("my_swing_ready", "My Swing is Ready", { group: "My Bot" }),
    flagCondition("my_swing_cooldown", "My Swing is on Cooldown", { group: "My Bot" }),
    flagCondition("my_block_ready", "My Block is Ready", { group: "My Bot" }),
    flagCondition("my_block_cooldown", "My Block is on Cooldown", { group: "My Bot" }),
    flagCondition("my_shield_up", "My Shield is Up", { group: "My Bot" }),
    flagCondition("my_shield_down", "My Shield is Down", { group: "My Bot" }),
    flagCondition("my_dash_ready", "My Dash is Ready", { group: "My Bot" }),
    flagCondition("my_dash_cooldown", "My Dash is on Cooldown", { group: "My Bot" }),
    flagCondition("my_fire_gun_ready", "My Fire Gun is Ready", { group: "My Bot" }),
    flagCondition("my_fire_gun_cooldown", "My Fire Gun is on Cooldown", { group: "My Bot" }),
    flagCondition("my_grenade_ready", "My Grenade is Ready", { group: "My Bot" }),
    flagCondition("my_grenade_cooldown", "My Grenade is on Cooldown", { group: "My Bot" }),
    flagCondition("my_fireball_ready", "My Fireball is Ready", { group: "My Bot" }),
    flagCondition("my_fireball_cooldown", "My Fireball is on Cooldown", { group: "My Bot" }),
    flagCondition("my_stun_ready", "My Stun is Ready", { group: "My Bot" }),
    flagCondition("my_stun_cooldown", "My Stun is on Cooldown", { group: "My Bot" }),
    flagCondition("opponent_swing_ready", "Opponent Swing is Ready", { group: "Opponent" }),
    flagCondition("opponent_swing_cooldown", "Opponent Swing is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_block_ready", "Opponent Block is Ready", { group: "Opponent" }),
    flagCondition("opponent_block_cooldown", "Opponent Block is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_shield_up", "Opponent Shield is Up", { group: "Opponent" }),
    flagCondition("opponent_shield_down", "Opponent Shield is Down", { group: "Opponent" }),
    flagCondition("opponent_dash_ready", "Opponent Dash is Ready", { group: "Opponent" }),
    flagCondition("opponent_dash_cooldown", "Opponent Dash is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_fire_gun_ready", "Opponent Fire Gun is Ready", { group: "Opponent" }),
    flagCondition("opponent_fire_gun_cooldown", "Opponent Fire Gun is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_grenade_ready", "Opponent Grenade is Ready", { group: "Opponent" }),
    flagCondition("opponent_grenade_cooldown", "Opponent Grenade is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_fireball_ready", "Opponent Fireball is Ready", { group: "Opponent" }),
    flagCondition("opponent_fireball_cooldown", "Opponent Fireball is on Cooldown", { group: "Opponent" }),
    flagCondition("opponent_stun_ready", "Opponent Stun is Ready", { group: "Opponent" }),
    flagCondition("opponent_stun_cooldown", "Opponent Stun is on Cooldown", { group: "Opponent" }),
    ...PROTOTYPE_CONDITION_TYPES,
]);
export const CONDITION_TYPES = Object.freeze([LEGACY_ABILITY_FLAG_CONDITIONS[0]]);
const LEGACY_CONDITION_TYPES = Object.freeze([
    thresholdCondition("enemy_distance_lt", "Target Distance <", 120, 0, 700, "units", { supportsTarget: true, group: "Target" }),
    thresholdCondition("enemy_distance_gt", "Target Distance >", 120, 0, 700, "units", { supportsTarget: true, group: "Target" }),
    thresholdCondition("my_edge_distance_lt", "My Distance From Edge <", 80, 0, 800, "units"),
    thresholdCondition("my_edge_distance_gt", "My Distance From Edge >", 80, 0, 800, "units"),
    thresholdCondition("target_edge_distance_lt", "Target Distance From Edge <", 80, 0, 800, "units", { supportsTarget: true, group: "Target" }),
    thresholdCondition("target_edge_distance_gt", "Target Distance From Edge >", 80, 0, 800, "units", { supportsTarget: true, group: "Target" }),
    thresholdCondition("opponent_object_distance_lt", "Opponent Distance to Object <", 120, 0, 700, "units", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects", group: "Objects" }),
    thresholdCondition("opponent_object_distance_gt", "Opponent Distance to Object >", 120, 0, 700, "units", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects", group: "Objects" }),
    thresholdCondition("my_hp_lt", "My HP <", 50, 1, 100, "HP", { group: "My Bot" }),
    thresholdCondition("my_hp_gt", "My HP >", 50, 0, 99, "HP", { group: "My Bot" }),
    thresholdCondition("enemy_hp_lt", "Opponent HP <", 50, 1, 100, "HP", { group: "Opponent" }),
    thresholdCondition("enemy_hp_gt", "Opponent HP >", 50, 0, 99, "HP", { group: "Opponent" }),
    thresholdCondition("my_shield_charges_lt", "My Shield Charges <", 3, 0, 5, "charges", { group: "My Bot" }),
    thresholdCondition("my_shield_charges_gt", "My Shield Charges >", 2, 0, 5, "charges", { group: "My Bot" }),
    thresholdCondition("opponent_shield_charges_lt", "Opponent Shield Charges <", 3, 0, 5, "charges", { group: "Opponent" }),
    thresholdCondition("opponent_shield_charges_gt", "Opponent Shield Charges >", 2, 0, 5, "charges", { group: "Opponent" }),
    flagCondition("enemy_attacking", "Opponent is Attacking", { group: "Opponent" }),
    flagCondition("enemy_blocking", "Opponent is Blocking", { group: "Opponent" }),
    flagCondition("enemy_rushing", "Opponent is Rushing", { group: "Opponent" }),
    flagCondition("enemy_fleeing", "Opponent is Fleeing", { group: "Opponent" }),
    thresholdCondition("my_cornered", "My Distance From Edge <", 80, 0, 800, "units"),
    thresholdCondition("enemy_cornered", "Target Distance From Edge <", 80, 0, 800, "units", { supportsTarget: true, group: "Target" }),
]);
export const CONDITION_DEFINITIONS = Object.freeze([...LEGACY_ABILITY_FLAG_CONDITIONS, ...LEGACY_CONDITION_TYPES]);

export const ACTION_TYPES = Object.freeze([
    { id: "none", label: "N/A (Nested Conditions Only)", head: "none" },
    { id: "variable", label: "Variable: Modify Custom Variable", head: "variable", variableAction: true },
    { id: "move_walk", label: "Movement: Walk", head: "movement", movementConfig: true, coordinateTarget: true },
    /* Legacy directional IDs remain normalization-only and are not exposed by the picker. */
    { id: "move_inward", label: "Move: Radially Inward (Engage)", head: "movement", legacy: true },
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
    { id: "rotate_toward_enemy", label: "Rotate: Face Target", head: "rotation" },
    { id: "swing", label: "Move: Swing Weapon", head: "swing" },
    { id: "block", label: "Move: Raise Shield", head: "block" },
    { id: "fire_gun", label: "Move: Fire Gun", head: "gun" },
    { id: "throw_grenade", label: "Ability: Throw Grenade", head: "grenade" },
    { id: "shoot_fireball", label: "Move: Shoot Fireball", head: "fireball" },
    { id: "stun", label: "Ability: Stun", head: "stun" },
    { id: "no_dash", label: "Dash: Don't Dash", head: "dash" },
    { id: "dash", label: "Move: Dash", head: "dash", movementConfig: true, coordinateTarget: true },
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
    ...BOT_ABILITIES.filter(({ id }) => PROTOTYPE_ABILITY_STATS[id]).flatMap((ability) => ability.actions.map((id) => ({
        id,
        label: id === "micro_dash" ? "Move: Micro Dash" : `${ability.kind === "move" ? "Move" : "Ability"}: ${ability.label}${id.endsWith("_left") ? " Left" : id.endsWith("_right") || id.endsWith("_outward") ? " Away / Right" : ""}`,
        head: id === "micro_dash" ? "micro_dash" : id.includes("dash") ? "dash" : id,
        coordinateTarget: id === "orbital_strike" || id === "null_zone" || id === "micro_dash",
        locationTarget: id === "orbital_strike" || id === "null_zone",
        movementConfig: id === "micro_dash",
        orientationConfig: id === "phase_strike",
    }))),
]);

const CONDITION_BY_ID = new Map(CONDITION_DEFINITIONS.map((condition) => [condition.id, condition]));
const ACTION_BY_ID = new Map(ACTION_TYPES.map((action) => [action.id, action]));
const ENTITY_TARGET_DEFINITIONS = entityTargetDefinitions();
const BASE_ENTITY_TARGET_TYPES = [
    { id: "opponent", label: "Opponent 1" },
    { id: "orbital_zone", label: "Closest Orbital Strike Zone", abilityId: "orbital_strike", owner: "my", legacy: true },
    ...ENTITY_TARGET_DEFINITIONS.map((ability) => ({
        id: `opponent_${ability.entityType}`,
        label: `Closest ${ability.entityLabel} by Opponent 1`,
        abilityId: ability.id,
        owner: "opponent",
        tags: ability.tags,
    })),
    ...ENTITY_TARGET_DEFINITIONS.map((ability) => ({
        id: `my_${ability.entityType}`,
        label: `Closest ${ability.entityLabel} by My Bot`,
        abilityId: ability.id,
        owner: "my",
        tags: ability.tags,
    })),
];
export const TARGET_TYPES = Object.freeze(BASE_ENTITY_TARGET_TYPES);
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
const LEGACY_PROTOTYPE_STATE_VARIABLES = BOT_ABILITIES.filter(({ id }) => PROTOTYPE_ABILITY_STATS[id]).flatMap((ability) => {
    const stats = PROTOTYPE_ABILITY_STATS[ability.id];
    const title = ability.label;
    const variables = [
        variableDefinition(`my.abilityReady.${ability.id}`, `My ${title} Ready`, "boolean", { group: "My Bot", ownConditionId: `my_${ability.id}_ready` }),
        variableDefinition(`my.abilityCooldownMs.${ability.id}`, `My ${title} Cooldown (seconds)`, "number", { group: "My Bot", min: 0, max: stats.cooldownMs / 1000, suffix: "s", step: 0.1, ownConditionId: `my_${ability.id}_cooldown` }),
        variableDefinition(`opponent.abilityReady.${ability.id}`, `Opponent ${title} Ready`, "boolean", { group: "Opponent", opponentConditionId: `opponent_${ability.id}_ready` }),
        variableDefinition(`opponent.abilityCooldownMs.${ability.id}`, `Opponent ${title} Cooldown (seconds)`, "number", { group: "Opponent", min: 0, max: stats.cooldownMs / 1000, suffix: "s", step: 0.1, opponentConditionId: `opponent_${ability.id}_cooldown` }),
    ];
    if (stats.entity) variables.push(
        variableDefinition(`my.entityExists.${ability.id}`, `My ${title} Entity / Zone Exists`, "boolean", { group: "Objects", ownConditionId: `my_${ability.id}_ready` }),
        variableDefinition(`opponent.entityExists.${ability.id}`, `Opponent ${title} Entity / Zone Exists`, "boolean", { group: "Objects", opponentConditionId: `opponent_${ability.id}_ready` }),
    );
    if (stats.windupMs) variables.push(
        variableDefinition(`my.preparing.${ability.id}`, `My Bot Preparing ${title}`, "boolean", { group: "My Bot", ownConditionId: `my_${ability.id}_preparing` }),
        variableDefinition(`my.preparingMs.${ability.id}`, `My ${title} Preparation Time (seconds)`, "number", { group: "My Bot", min: 0, max: stats.windupMs / 1000, suffix: "s", step: 0.1, ownConditionId: `my_${ability.id}_preparing` }),
        variableDefinition(`opponent.preparing.${ability.id}`, `Opponent Preparing ${title}`, "boolean", { group: "Opponent", opponentConditionId: `opponent_${ability.id}_preparing` }),
        variableDefinition(`opponent.preparingMs.${ability.id}`, `Opponent ${title} Preparation Time (seconds)`, "number", { group: "Opponent", min: 0, max: stats.windupMs / 1000, suffix: "s", step: 0.1, opponentConditionId: `opponent_${ability.id}_preparing` }),
    );
    return variables;
});

const GENERIC_ABILITY_STATE_VARIABLES = [
    variableDefinition("my.selectedAbilityReady", "My Ability Ready", "boolean", { group: "My Bot", supportsAbility: true, abilityOwner: "my" }),
    variableDefinition("my.selectedAbilityCooldownMs", "My Ability Cooldown", "number", { group: "My Bot", min: 0, max: 60, suffix: "s", step: 0.1, supportsAbility: true, abilityOwner: "my" }),
    variableDefinition("my.selectedAbilityAmmo", "My Ability Ammo / Charges", "number", { group: "My Bot", min: 0, max: 100, supportsAbility: true, abilityOwner: "my" }),
    variableDefinition("my.selectedAbilityPreparing", "My Ability Preparing", "boolean", { group: "My Bot", supportsAbility: true, abilityOwner: "my", requiredTag: "wind-up" }),
    variableDefinition("my.selectedAbilityPreparationMs", "My Ability Preparation Time", "number", { group: "My Bot", min: 0, max: 10, suffix: "s", step: 0.1, supportsAbility: true, abilityOwner: "my", requiredTag: "wind-up" }),
    variableDefinition("opponent.selectedAbilityReady", "Opponent 1 Ability Ready", "boolean", { group: "Opponent", supportsAbility: true, abilityOwner: "opponent" }),
    variableDefinition("opponent.selectedAbilityCooldownMs", "Opponent 1 Ability Cooldown", "number", { group: "Opponent", min: 0, max: 60, suffix: "s", step: 0.1, supportsAbility: true, abilityOwner: "opponent" }),
    variableDefinition("opponent.selectedAbilityAmmo", "Opponent 1 Ability Ammo / Charges", "number", { group: "Opponent", min: 0, max: 100, supportsAbility: true, abilityOwner: "opponent" }),
    variableDefinition("opponent.selectedAbilityPreparing", "Opponent 1 Ability Preparing", "boolean", { group: "Opponent", supportsAbility: true, abilityOwner: "opponent", requiredTag: "wind-up" }),
    variableDefinition("opponent.selectedAbilityPreparationMs", "Opponent 1 Ability Preparation Time", "number", { group: "Opponent", min: 0, max: 10, suffix: "s", step: 0.1, supportsAbility: true, abilityOwner: "opponent", requiredTag: "wind-up" }),
];

const ALL_STATE_VARIABLES = [
    variableDefinition("match.elapsedSeconds", "Time Since Start", "number", { group: "General", min: 0, max: 99_999, defaultValue: 0, suffix: "s", step: 0.1 }),
    variableDefinition("my.hp", "My HP", "number", { group: "My Bot", min: 0, max: 100 }),
    variableDefinition("my.damageTakenLastTick", "My Damage Taken Last Tick", "number", { group: "My Bot", min: 0, max: 300, suffix: "damage" }),
    variableDefinition("my.hpNetChangeLastTick", "My Net HP Change Last Tick", "number", { group: "My Bot", min: -300, max: 300, suffix: "HP" }),
    variableDefinition("my.x", "My X Position", "number", { group: "My Bot", min: 0, max: ARENA_WIDTH_UNITS, suffix: "units" }),
    variableDefinition("my.y", "My Y Position", "number", { group: "My Bot", min: 0, max: ARENA_HEIGHT_UNITS, suffix: "units" }),
    variableDefinition("opponent.hp", "Opponent HP", "number", { group: "Opponent", min: 0, max: 100 }),
    variableDefinition("opponent.damageTakenLastTick", "Opponent Damage Taken Last Tick", "number", { group: "Opponent", min: 0, max: 300, suffix: "damage" }),
    variableDefinition("opponent.hpNetChangeLastTick", "Opponent Net HP Change Last Tick", "number", { group: "Opponent", min: -300, max: 300, suffix: "HP" }),
    variableDefinition("opponent.x", "Opponent X Position", "number", { group: "Opponent", min: 0, max: ARENA_WIDTH_UNITS, suffix: "units" }),
    variableDefinition("opponent.y", "Opponent Y Position", "number", { group: "Opponent", min: 0, max: ARENA_HEIGHT_UNITS, suffix: "units" }),
    variableDefinition("target.distance", "Target Distance", "number", { group: "Target", min: 0, max: 700, supportsTarget: true }),
    variableDefinition("target.hp", "Target HP", "number", { group: "Target", min: 0, max: 300, supportsTarget: true }),
    variableDefinition("target.alive", "Target Alive", "boolean", { group: "Target", supportsTarget: true }),
    variableDefinition("target.bearingFromMe", "Target Direction From Me", "number", { group: "Rotation", min: -360, max: 360, suffix: "deg", supportsTarget: true, rangeOnly: true, maxRange: 360, defaultMin: -30, defaultMax: 30 }),
    variableDefinition("target.movementDirection", "Target Movement Direction", "number", { group: "Movement", min: -360, max: 360, suffix: "deg", supportsTarget: true, rangeOnly: true, maxRange: 360, defaultMin: -30, defaultMax: 30 }),
    variableDefinition("target.velocity", "Target Velocity", "number", { group: "Movement", min: 0, max: 100, suffix: "units/tick", supportsTarget: true }),
    variableDefinition("my.bearingFromTarget", "My Direction From Target", "number", { group: "Rotation", min: 0, max: 360, suffix: "deg", supportsTarget: true }),
    variableDefinition("target.relativeBearing", "Target Bearing Difference (Shortest)", "number", { group: "Rotation", min: 0, max: 180, suffix: "deg", supportsTarget: true }),
    variableDefinition("target.relativeBearingClockwise", "Target Bearing Difference (Clockwise)", "number", { group: "Rotation", min: 0, max: 360, suffix: "deg", supportsTarget: true }),
    variableDefinition("target.relativeBearingCounterclockwise", "Target Bearing Difference (Counterclockwise)", "number", { group: "Rotation", min: 0, max: 360, suffix: "deg", supportsTarget: true }),
    variableDefinition("target.facing", "Target Facing", "number", { group: "Rotation", min: 0, max: 360, suffix: "deg", supportsTarget: true, fighterTargetOnly: true }),
    variableDefinition("target.count", "Target Type Count", "number", { group: "Objects", min: 0, max: 100, supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("target.age", "Target Age (seconds)", "number", { group: "Objects", suffix: "s", step: 0.1, min: 0, max: 120, supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("my.edgeDistance", "My Distance From Edge", "number", { group: "My Bot", min: 0, max: 300 }),
    variableDefinition("target.edgeDistance", "Target Distance From Edge", "number", { group: "Target", min: 0, max: 300, supportsTarget: true }),
    variableDefinition("my.swingReady", "My Swing Ready", "boolean", { group: "My Bot", ownConditionId: "my_swing_ready" }),
    variableDefinition("my.swingCooldownMs", "My Swing Cooldown (seconds)", "number", { group: "My Bot", min: 0, max: 2, defaultValue: 0.5, suffix: "s", step: 0.1, ownConditionId: "my_swing_cooldown" }),
    variableDefinition("my.blockReady", "My Block Ready", "boolean", { group: "My Bot", ownConditionId: "my_block_ready" }),
    variableDefinition("my.shieldUp", "My Shield Up", "boolean", { group: "My Bot", ownConditionId: "my_shield_up" }),
    variableDefinition("my.shieldCharges", "My Shield Charges", "number", { group: "My Bot", min: 0, max: 5, ownConditionId: "my_block_ready" }),
    variableDefinition("my.blockRechargeMs", "My Block Recharge (seconds)", "number", { group: "My Bot", min: 0, max: 3, defaultValue: 1, suffix: "s", step: 0.1, ownConditionId: "my_block_cooldown" }),
    variableDefinition("my.dashReady", "My Dash Ready", "boolean", { group: "My Bot", ownConditionId: "my_dash_ready" }),
    variableDefinition("my.dashCooldownMs", "My Dash Cooldown (seconds)", "number", { group: "My Bot", min: 0, max: 4.5, defaultValue: 1, suffix: "s", step: 0.1, ownConditionId: "my_dash_cooldown" }),
    variableDefinition("my.gunReady", "My Gun Ready", "boolean", { group: "My Bot", ownConditionId: "my_fire_gun_ready" }),
    variableDefinition("my.gunCooldownMs", "My Gun Cooldown (seconds)", "number", { group: "My Bot", min: 0, max: 3, defaultValue: 1, suffix: "s", step: 0.1, ownConditionId: "my_fire_gun_cooldown" }),
    variableDefinition("my.gunAmmo", "My Gun Ammo", "number", { group: "My Bot", min: 0, max: 10, ownConditionId: "my_fire_gun_ready" }),
    variableDefinition("my.gunReloadMs", "My Gun Reload (seconds)", "number", { group: "My Bot", min: 0, max: 3, defaultValue: 1, suffix: "s", step: 0.1, ownConditionId: "my_fire_gun_cooldown" }),
    variableDefinition("my.grenadeReady", "My Grenade Ready", "boolean", { group: "My Bot", ownConditionId: "my_grenade_ready" }),
    variableDefinition("my.grenadeCooldownMs", "My Grenade Cooldown (seconds)", "number", { group: "My Bot", min: 0, max: 12, defaultValue: 1, suffix: "s", step: 0.1, ownConditionId: "my_grenade_cooldown" }),
    variableDefinition("my.fireballReady", "My Fireball Ready", "boolean", { group: "My Bot", ownConditionId: "my_fireball_ready" }),
    variableDefinition("my.fireballCooldownMs", "My Fireball Cooldown (seconds)", "number", { group: "My Bot", min: 0, max: 1, defaultValue: 0.5, suffix: "s", step: 0.1, ownConditionId: "my_fireball_cooldown" }),
    variableDefinition("my.fireballCharges", "My Fireball Charges", "number", { group: "My Bot", min: 0, max: 4, ownConditionId: "my_fireball_ready" }),
    variableDefinition("my.fireballReloadMs", "My Fireball Reload (seconds)", "number", { group: "My Bot", min: 0, max: 1, defaultValue: 0.5, suffix: "s", step: 0.1, ownConditionId: "my_fireball_cooldown" }),
    variableDefinition("my.stunReady", "My Stun Ready", "boolean", { group: "My Bot", ownConditionId: "my_stun_ready" }),
    variableDefinition("my.stunCooldownMs", "My Stun Cooldown (seconds)", "number", { group: "My Bot", min: 0, max: 10, defaultValue: 1, suffix: "s", step: 0.1, ownConditionId: "my_stun_cooldown" }),
    variableDefinition("opponent.swingReady", "Opponent Swing Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_swing_ready" }),
    variableDefinition("opponent.swingCooldownMs", "Opponent Swing Cooldown (seconds)", "number", { group: "Opponent", min: 0, max: 2, defaultValue: 0.5, suffix: "s", step: 0.1, opponentConditionId: "opponent_swing_cooldown" }),
    variableDefinition("opponent.blockReady", "Opponent Block Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_block_ready" }),
    variableDefinition("opponent.shieldUp", "Opponent Shield Up", "boolean", { group: "Opponent", opponentConditionId: "opponent_shield_up" }),
    variableDefinition("opponent.shieldCharges", "Opponent Shield Charges", "number", { group: "Opponent", min: 0, max: 5, opponentConditionId: "opponent_block_ready" }),
    variableDefinition("opponent.blockRechargeMs", "Opponent Block Recharge (seconds)", "number", { group: "Opponent", min: 0, max: 3, defaultValue: 1, suffix: "s", step: 0.1, opponentConditionId: "opponent_block_cooldown" }),
    variableDefinition("opponent.dashReady", "Opponent Dash Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_dash_ready" }),
    variableDefinition("opponent.dashCooldownMs", "Opponent Dash Cooldown (seconds)", "number", { group: "Opponent", min: 0, max: 4.5, defaultValue: 1, suffix: "s", step: 0.1, opponentConditionId: "opponent_dash_cooldown" }),
    variableDefinition("opponent.gunReady", "Opponent Gun Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_fire_gun_ready" }),
    variableDefinition("opponent.gunCooldownMs", "Opponent Gun Cooldown (seconds)", "number", { group: "Opponent", min: 0, max: 3, defaultValue: 1, suffix: "s", step: 0.1, opponentConditionId: "opponent_fire_gun_cooldown" }),
    variableDefinition("opponent.gunAmmo", "Opponent Gun Ammo", "number", { group: "Opponent", min: 0, max: 10, opponentConditionId: "opponent_fire_gun_ready" }),
    variableDefinition("opponent.gunReloadMs", "Opponent Gun Reload (seconds)", "number", { group: "Opponent", min: 0, max: 3, defaultValue: 1, suffix: "s", step: 0.1, opponentConditionId: "opponent_fire_gun_cooldown" }),
    variableDefinition("opponent.grenadeReady", "Opponent Grenade Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_grenade_ready" }),
    variableDefinition("opponent.grenadeCooldownMs", "Opponent Grenade Cooldown (seconds)", "number", { group: "Opponent", min: 0, max: 12, defaultValue: 1, suffix: "s", step: 0.1, opponentConditionId: "opponent_grenade_cooldown" }),
    variableDefinition("opponent.fireballReady", "Opponent Fireball Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_fireball_ready" }),
    variableDefinition("opponent.fireballCooldownMs", "Opponent Fireball Cooldown (seconds)", "number", { group: "Opponent", min: 0, max: 1, defaultValue: 0.5, suffix: "s", step: 0.1, opponentConditionId: "opponent_fireball_cooldown" }),
    variableDefinition("opponent.fireballCharges", "Opponent Fireball Charges", "number", { group: "Opponent", min: 0, max: 4, opponentConditionId: "opponent_fireball_ready" }),
    variableDefinition("opponent.fireballReloadMs", "Opponent Fireball Reload (seconds)", "number", { group: "Opponent", min: 0, max: 1, defaultValue: 0.5, suffix: "s", step: 0.1, opponentConditionId: "opponent_fireball_cooldown" }),
    variableDefinition("opponent.stunReady", "Opponent Stun Ready", "boolean", { group: "Opponent", opponentConditionId: "opponent_stun_ready" }),
    variableDefinition("opponent.stunCooldownMs", "Opponent Stun Cooldown (seconds)", "number", { group: "Opponent", min: 0, max: 10, defaultValue: 1, suffix: "s", step: 0.1, opponentConditionId: "opponent_stun_cooldown" }),
    ...GENERIC_ABILITY_STATE_VARIABLES,
    variableDefinition("target.exists", "Target Exists", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
];
export const STATE_VARIABLES = Object.freeze(ALL_STATE_VARIABLES);
const STATE_VARIABLE_BY_ID = new Map([...STATE_VARIABLES, ...LEGACY_PROTOTYPE_STATE_VARIABLES].map((variable) => [variable.id, variable]));

export function createDefaultMeleeStrategyConfiguration() {
    return {
        version: MELEE_STRATEGY_VERSION,
        columns: [],
        blocks: [],
        clusters: [],
        customVariables: [],
    };
}

export function createLogicColumn(name = "Logic Column", createdOrder = Date.now()) {
    return {
        id: `column-${createdOrder}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        createdOrder,
        branches: [],
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
    const suppliedDefinition = left && typeof left === "object" ? left : null;
    const variable = suppliedDefinition ?? STATE_VARIABLE_BY_ID.get(left) ?? STATE_VARIABLES[0];
    return normalizeExpressionCondition({
        type: "expression",
        left: variable.id,
        comparator: variable.rangeOnly ? "range" : variable.valueType === "boolean" ? "eq" : "lt",
        right: variable.rangeOnly
            ? { type: "range", min: variable.defaultMin, max: variable.defaultMax }
            : variable.valueType === "boolean"
            ? { type: "boolean", value: true }
            : { type: "number", value: variable.defaultValue },
        ...(variable.supportsAbility ? { ability: defaultAbilityForVariable(variable) } : {}),
        ...(variable.supportsTarget ? { leftTarget: variable.defaultTarget ?? "opponent" } : {}),
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
    const customVariables = normalizeCustomVariables(customVariablesWithReferencedActions(configuration));
    if (Array.isArray(configuration?.columns)) {
        const derivedConditionCount = customVariables.reduce((total, variable) => total + (variable.conditions?.length ?? 0), 0);
        const remaining = { actions: MAX_LOGIC_BLOCKS, conditions: Math.max(0, MAX_TOTAL_CONDITIONS - derivedConditionCount) };
        const columns = configuration.columns.slice(0, MAX_CLUSTERS).map((column, columnIndex) => {
            return normalizeColumn(column, columnIndex, remaining);
        });
        return { version: MELEE_STRATEGY_VERSION, columns, blocks: [], clusters: [], customVariables, legacyMode: false };
    }
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

    const columns = migrateLegacyColumns(blocks, clusters);
    return {
        version: MELEE_STRATEGY_VERSION,
        columns,
        blocks,
        clusters,
        customVariables,
        legacyMode: true,
    };
}

function migrateLegacyColumns(blocks, clusters) {
    const columns = [];
    if (blocks.length) {
        columns.push({
            id: "legacy-standalone-column",
            name: "Legacy Standalone Blocks",
            createdOrder: 0,
            branches: [...blocks].sort((first, second) => first.priority - second.priority).map((block, index) => ({
                ...block,
                branchType: index === 0 ? "if" : "else_if",
                createdOrder: index,
                children: [],
            })),
        });
    }
    clusters.forEach((cluster, clusterIndex) => columns.push({
        id: `legacy-${cluster.id}`,
        name: cluster.name,
        createdOrder: clusterIndex + 1,
        branches: [{
            id: `${cluster.id}-gate`,
            branchType: "if",
            createdOrder: 0,
            conditions: cluster.conditions,
            priority: cluster.priority,
            action: "move_stop",
            actionTarget: "opponent",
            children: [...cluster.blocks].sort((first, second) => first.priority - second.priority).map((block, index) => ({
                ...block,
                branchType: index === 0 ? "if" : "else_if",
                createdOrder: index,
                children: [],
            })),
        }],
    }));
    return columns;
}

function normalizeColumn(column, columnIndex, remaining) {
    const createdOrder = finiteOrder(column?.createdOrder, columnIndex);
    return {
        id: String(column?.id || `column-${columnIndex + 1}`),
        name: String(column?.name || `Column ${columnIndex + 1}`).slice(0, 40),
        createdOrder,
        branches: normalizeBranches(column?.branches, remaining),
    };
}

function normalizeBranches(branches, remaining) {
    if (!Array.isArray(branches) || remaining.conditions <= 0) return [];
    const normalized = [];
    for (let index = 0; index < branches.length && remaining.conditions > 0; index += 1) {
        const branch = branches[index];
        const normalizedBlock = normalizeBlock(branch, index);
        const actions = [];
        for (const entry of normalizedBlock.actions) {
            if (entry.action === "none") continue;
            if (remaining.actions <= 0) break;
            actions.push(entry);
            remaining.actions -= 1;
        }
        if (!actions.length) actions.push({ action: "none", actionTarget: "opponent" });
        const conditions = branch?.branchType === "else"
            ? []
            : normalizeConditions(branch?.conditions).slice(0, remaining.conditions);
        remaining.conditions -= conditions.length;
        const children = normalizeBranches(branch?.children, remaining);
        normalized.push({
            ...normalizedBlock,
            ...actions[0],
            actions,
            branchType: index === 0 ? "if" : branch?.branchType === "else" ? "else" : "else_if",
            createdOrder: finiteOrder(branch?.createdOrder, index),
            conditions,
            children,
        });
    }
    return normalized;
}

function finiteOrder(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function validateMeleeStrategyConfiguration(configuration) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    const errors = [];
    const warnings = [];
    const rawVariables = Array.isArray(configuration?.customVariables) ? configuration.customVariables : [];
    const variableSlots = countVariableSlots(configuration);
    if (variableSlots > MAX_CUSTOM_VARIABLE_SLOTS) errors.push(`Custom variables use ${variableSlots}/${MAX_CUSTOM_VARIABLE_SLOTS} variable slots.`);
    const conditionSlots = countConditionSlots(configuration);
    if (conditionSlots > MAX_TOTAL_CONDITIONS) errors.push(`Conditions use ${conditionSlots}/${MAX_TOTAL_CONDITIONS} condition slots.`);
    const names = new Set();
    rawVariables.forEach((variable, index) => {
        const name = String(variable?.name ?? "").trim();
        if (!/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(name)) errors.push(`Custom variable ${index + 1} has an invalid name.`);
        const key = name.toLocaleLowerCase();
        if (names.has(key)) errors.push(`Custom variable name "${name}" is duplicated.`);
        names.add(key);
        if (variable?.valueType === "boolean" && Array.isArray(variable.conditions)) {
            variable.conditions.forEach((condition) => {
                if (condition?.type === "expression" && String(condition.left ?? "").startsWith("custom.")) {
                    const referenced = rawVariables.find((candidate) => candidate.id === condition.left);
                    if (!referenced) errors.push(`Custom variable "${name}" references a missing variable.`);
                }
            });
        }
    });
    const entries = normalizedBlockEntries(normalized);
    if (!entries.some((entry) => isTrainableBlock(entry.block))) {
        errors.push("Add at least one bot brain action before submitting.");
    }
    entries.forEach(({ block, label }) => {
        for (const conditions of andConditionGroups(block.conditions)) {
            const ids = new Set(conditions.map((condition) => condition.type));
            for (const [first, second] of [
                ["enemy_rushing", "enemy_fleeing"],
                ["my_swing_ready", "my_swing_cooldown"],
                ["my_block_ready", "my_block_cooldown"],
                ["my_shield_up", "my_shield_down"],
                ["my_dash_ready", "my_dash_cooldown"],
                ["my_fire_gun_ready", "my_fire_gun_cooldown"],
                ["my_grenade_ready", "my_grenade_cooldown"],
                ["my_fireball_ready", "my_fireball_cooldown"],
                ["opponent_swing_ready", "opponent_swing_cooldown"],
                ["opponent_block_ready", "opponent_block_cooldown"],
                ["opponent_shield_up", "opponent_shield_down"],
                ["opponent_dash_ready", "opponent_dash_cooldown"],
                ["opponent_fire_gun_ready", "opponent_fire_gun_cooldown"],
                ["opponent_grenade_ready", "opponent_grenade_cooldown"],
                ["opponent_fireball_ready", "opponent_fireball_cooldown"],
            ]) {
                if (ids.has(first) && ids.has(second)) errors.push(`${label} contains contradictory conditions.`);
            }
            for (const target of TARGET_TYPES) {
                const lower = conditions.find((condition) => (
                    condition.type === "enemy_distance_gt" && (condition.target ?? "opponent") === target.id
                ))?.value;
                const upper = conditions.find((condition) => (
                    condition.type === "enemy_distance_lt" && (condition.target ?? "opponent") === target.id
                ))?.value;
                if (lower != null && upper != null && lower >= upper) {
                    errors.push(`${label} has an impossible ${target.label.toLowerCase()} distance range.`);
                }
            }
            validateThresholdRange(errors, conditions, label, "my_hp_gt", "my_hp_lt", "my HP");
            validateThresholdRange(errors, conditions, label, "enemy_hp_gt", "enemy_hp_lt", "opponent HP");
        }
    });
    return { configuration: normalized, errors, warnings };
}

function activeIntentForBlock(block) {
    return intentFromAction(legacyMovementAction(block), block.actionTarget);
}

function legacyMovementAction(block) {
    if (!block?.movementMode) return block?.action;
    const prefix = block.action === "dash" ? "dash" : "move";
    const direction = block.movementDirection ?? "toward";
    if (block.movementMode === "absolute") return `${prefix}_${direction}`;
    return ({ toward: prefix === "dash" ? "dash" : "move_inward", away: `${prefix}_outward`, left: `${prefix}_tangent_left`, right: `${prefix}_tangent_right`, toward_left: `${prefix}_diagonal_in_left`, toward_right: `${prefix}_diagonal_in_right`, away_left: `${prefix}_diagonal_out_left`, away_right: `${prefix}_diagonal_out_right` })[direction] ?? "move_stop";
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
    const plan = selectMeleeStrategyActionPlan(configuration, payload);
    return Boolean(plan.dash?.action?.startsWith("dash") && stateFromPayload(payload).player.dashAvailable);
}

export function selectMeleeStrategyIntent(configuration, payload) {
    const plan = selectMeleeStrategyActionPlan(configuration, payload);
    const primary = plan.primary ?? plan.movement ?? plan.dash ?? plan.rotation ?? plan.swing ?? plan.block ?? plan.gun ?? plan.grenade ?? plan.fireball ?? plan.stun;
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
    prepareCustomVariables(state, normalized.customVariables);
    const selected = selectPriorityCandidates(normalized, state);
    const primary = selected
        .flatMap(({ block }) => normalizedBlockActions(block).map((entry) => ({ ...block, ...entry })))
        .find((block) => block.action !== "variable" && isTrainableBlock(block) && actionExecutableNow(block, state)) ?? null;
    const plan = { primary };
    for (const { block: selectedBlock } of selected) {
        for (const block of normalizedBlockActions(selectedBlock).map((entry) => ({ ...selectedBlock, ...entry }))) {
        if (!actionExecutableNow(block, state)) continue;
        if (block.action === "variable") {
            applyVariableAction(block, state, normalized.customVariables);
            continue;
        }
        const action = ACTION_BY_ID.get(block.action) ?? ACTION_TYPES[0];
        if (actionSupportsTarget(action)
            && !(action.coordinateTarget && block.targetMode === "coordinates")
            && !resolveMeleeStrategyTarget(state, block.actionTarget)) continue;
        if (block.action === "no_dash") {
            plan.dash = block;
            continue;
        }
        const executionHead = action.head === "movement" ? "movement"
            : action.head === "rotation" ? "rotation"
            : action.head === "dash" ? "dash"
            : "ability";
        if (action.head === "dash" && !state.player.dashAvailable) continue;
        if (plan[executionHead]) continue;
        plan[executionHead] = block;
        if (executionHead === "dash" && block.action.startsWith("dash") && state.player.dashAvailable) plan.dashMovement = block;
        if (executionHead === "ability") {
            plan[action.head] = block;
        }
        }
    }
    return plan;
}

export function hasMeleeStrategyActions(configuration) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    return normalized.blocks.length > 0
        || normalized.clusters.some((cluster) => cluster.blocks.length > 0)
        || normalized.columns.some((column) => column.branches.length > 0);
}

export function evaluateCondition(condition, state) {
    if (condition?.type === "expression") {
        return evaluateExpressionCondition(condition, state);
    }
    const target = resolveMeleeStrategyTarget(state, condition.target ?? "opponent");
    const distance = target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY;
    const prototypeCondition = /^(my|opponent)_(.+)_(ready|cooldown)$/.exec(condition.type ?? "");
    if (prototypeCondition && PROTOTYPE_ABILITY_STATS[prototypeCondition[2]]) {
        const fighter = prototypeCondition[1] === "my" ? state.player : state.opponent;
        const cooldown = Number(fighter?.abilityCooldowns?.[prototypeCondition[2]] ?? 0);
        return prototypeCondition[3] === "ready" ? cooldown <= 0 : cooldown > 0;
    }
    const preparingCondition = /^(my|opponent)_(.+)_preparing$/.exec(condition.type ?? "");
    if (preparingCondition && PROTOTYPE_ABILITY_STATS[preparingCondition[2]]?.windupMs) {
        const fighter = preparingCondition[1] === "my" ? state.player : state.opponent;
        return fighter?.preparingAbility === preparingCondition[2];
    }
    switch (condition.type) {
        case "always": return true;
        case "enemy_distance_lt": return distance < condition.value;
        case "enemy_distance_gt": return distance > condition.value;
        case "opponent_object_distance_lt":
            return condition.target?.startsWith("object_") && target
                ? distanceBetween(state.opponent, target) < condition.value
                : false;
        case "opponent_object_distance_gt":
            return condition.target?.startsWith("object_") && target
                ? distanceBetween(state.opponent, target) > condition.value
                : false;
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
        case "my_fireball_ready": return state.player.fireballAvailable;
        case "my_fireball_cooldown": return !state.player.fireballAvailable;
        case "my_stun_ready": return state.player.stunAvailable;
        case "my_stun_cooldown": return !state.player.stunAvailable;
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
        case "opponent_fireball_ready": return Boolean(state.opponent?.fireballAvailable);
        case "opponent_fireball_cooldown": return Boolean(state.opponent) && !state.opponent.fireballAvailable;
        case "opponent_stun_ready": return Boolean(state.opponent?.stunAvailable);
        case "opponent_stun_cooldown": return Boolean(state.opponent) && !state.opponent.stunAvailable;
        case "target_exists": return Boolean(target) && condition.target !== "opponent";
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
    return normalizedBlockActions(block).some((entry) => entry.action !== "no_dash" && entry.action !== "none");
}

function normalizedBlockEntries(normalized) {
    if (normalized.columns?.length && !normalized.legacyMode) {
        return normalized.columns.flatMap((column, columnIndex) => treeEntries(column.branches, columnIndex, column.name));
    }
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

function treeEntries(branches, columnIndex, label, depth = 0) {
    return branches.flatMap((block, blockIndex) => [{
        block,
        blockIndex,
        clusterIndex: columnIndex,
        clusterPriority: columnIndex,
        clusterConditions: [],
        label: `${label} ${depth ? `nested ${depth}.` : ""}${blockIndex + 1}`,
    }, ...treeEntries(block.children ?? [], columnIndex, label, depth + 1)]);
}

function selectPriorityCandidates(normalized, state) {
    if (normalized.columns?.length && !normalized.legacyMode) {
        return [...normalized.columns]
            .sort((first, second) => first.createdOrder - second.createdOrder)
            .flatMap((column, columnIndex) => {
                return selectTreeBranches(column.branches, state).map((block, blockIndex) => ({ block, blockIndex, clusterIndex: columnIndex, clusterPriority: columnIndex, clusterConditions: [] }));
            });
    }
    const matching = normalizedBlockEntries(normalized)
        .filter((entry) => (
            evaluateConditionList(entry.clusterConditions, state)
            && evaluateConditionList(entry.block.conditions, state)
            && blockHasExecutableAction(entry.block, state)
        ))
        .sort(comparePriorityEntries);
    return matching;
}

function customVariablesWithReferencedActions(configuration) {
    const variables = Array.isArray(configuration?.customVariables)
        ? [...configuration.customVariables]
        : [];
    const knownIds = new Set(variables.map((variable) => String(variable?.id ?? "")));
    const knownNames = new Set(variables.map((variable) => String(variable?.name ?? "").trim().toLocaleLowerCase()));

    const addVariable = (id, valueType) => {
        if (!/^custom\.[A-Za-z0-9_.-]{1,52}$/.test(id) || knownIds.has(id)) return;
        knownIds.add(id);
        let nameIndex = variables.length + 1;
        while (knownNames.has(`variable ${nameIndex}`)) nameIndex += 1;
        const name = `Variable ${nameIndex}`;
        knownNames.add(name.toLocaleLowerCase());
        variables.push({
            id,
            name,
            valueType,
            initialValue: valueType === "boolean" ? false : 0,
        });
    };

    const visit = (node) => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== "object") return;
        if (node.action === "variable") {
            const id = String(node.variableId ?? "");
            addVariable(id, typeof node.value === "boolean" ? "boolean" : "number");
        }
        if (node.type === "expression" || node.left) {
            addVariable(String(node.left ?? ""), node?.right?.type === "boolean" ? "boolean" : "number");
            if (node?.right?.type === "variable") addVariable(String(node.right.value ?? ""), "number");
        }
        if (node?.operand?.type === "variable") {
            addVariable(String(node.operand.value ?? ""), "number");
        }
        Object.values(node).forEach(visit);
    };

    visit(configuration?.columns);
    visit(configuration?.blocks);
    visit(configuration?.clusters);
    (configuration?.customVariables ?? []).forEach((variable) => visit(variable?.conditions));
    return variables;
}

export function customVariableDefinitions(configuration) {
    return normalizeCustomVariables(configuration?.customVariables).map((variable) => variableDefinition(
        variable.id,
        variable.name,
        variable.valueType,
        { group: "Custom Variables", min: CUSTOM_INTEGER_MIN, max: CUSTOM_INTEGER_MAX, defaultValue: variable.initialValue },
    ));
}

function normalizeCustomVariables(source) {
    if (!Array.isArray(source)) return [];
    const used = new Set();
    let slots = 0;
    const result = [];
    for (let index = 0; index < source.length && slots < MAX_CUSTOM_VARIABLE_SLOTS; index += 1) {
        const candidate = source[index] ?? {};
        const valueType = candidate.valueType === "boolean" ? "boolean" : "number";
        const name = String(candidate.name ?? `Variable ${index + 1}`).trim().slice(0, 40) || `Variable ${index + 1}`;
        let id = String(candidate.id ?? `custom.${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_")}`).slice(0, 60);
        if (!id.startsWith("custom.") || used.has(id)) id = `custom.variable_${index + 1}`;
        used.add(id);
        const availableConditions = Math.max(0, MAX_CUSTOM_VARIABLE_SLOTS - slots - 1);
        const conditions = valueType === "boolean" && Array.isArray(candidate.conditions)
            ? normalizeConditions(candidate.conditions).slice(0, availableConditions)
            : [];
        slots += 1 + conditions.length;
        result.push({
            id,
            name,
            valueType,
            initialValue: valueType === "boolean"
                ? normalizeBoolean(candidate.initialValue, false)
                : clamp(Math.trunc(Number(candidate.initialValue) || 0), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX),
            ...(conditions.length ? { conditions } : {}),
        });
    }
    return result;
}

export function moveLogicColumnPriority(columns, columnIndex, delta) {
    if (!Array.isArray(columns)) return [];
    const targetIndex = columnIndex + delta;
    if (columnIndex < 0 || columnIndex >= columns.length || targetIndex < 0 || targetIndex >= columns.length) return columns;
    const reordered = [...columns];
    [reordered[columnIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[columnIndex]];
    return reordered.map((column, index) => ({ ...column, createdOrder: index }));
}

function selectTreeBranches(branches, state) {
    const ordered = [...(branches ?? [])].sort((first, second) => first.createdOrder - second.createdOrder);
    const selected = [];
    for (const branch of ordered) {
        const matches = branch.branchType === "else" || evaluateConditionList(branch.conditions, state);
        if (!matches) continue;
        selected.push(...selectTreeBranches(branch.children, state));
        if (blockHasExecutableAction(branch, state)) selected.push(branch);
    }
    return selected;
}

function evaluateConditionList(conditions, state) {
    if (!conditions.length) return true;
    return conditions.reduce((matches, condition, index) => {
        const conditionMatches = evaluateCondition(condition, state);
        return index > 0 && condition.join === "or"
            ? matches || conditionMatches
            : matches && conditionMatches;
    }, true);
}

function comparePriorityEntries(first, second) {
    return first.clusterPriority - second.clusterPriority
        || first.block.priority - second.block.priority
        || first.clusterIndex - second.clusterIndex
        || first.blockIndex - second.blockIndex;
}

function andConditionGroups(conditions) {
    return conditions.reduce((groups, condition, index) => {
        if (index > 0 && condition.join === "or") {
            groups.push([condition]);
        } else {
            groups[groups.length - 1].push(condition);
        }
        return groups;
    }, [[]]).filter((group) => group.length > 0);
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
        fireballAvailable: Boolean(payload?.playerModel?.fireballAvailable),
        fireballCooldownRemainingMs: Number(payload?.playerModel?.fireballCooldownRemainingMs) || 0,
        fireballCharges: Number.isFinite(Number(payload?.playerModel?.fireballCharges)) ? Number(payload.playerModel.fireballCharges) : 0,
        fireballReloadRemainingMs: Number(payload?.playerModel?.fireballReloadRemainingMs) || 0,
        stunAvailable: Boolean(payload?.playerModel?.stunAvailable),
        stunCooldownRemainingMs: Number(payload?.playerModel?.stunCooldownRemainingMs) || 0,
        slowedMs: Number(payload?.playerModel?.slowedMs) || 0,
        abilityCooldowns: payload?.playerModel?.abilityCooldowns ?? {},
        abilityCharges: payload?.playerModel?.abilityCharges ?? {},
        abilityActiveMs: payload?.playerModel?.abilityActiveMs ?? {},
        preparingAbility: payload?.playerModel?.preparingAbility ?? null,
        preparingMs: Number(payload?.playerModel?.preparingMs) || 0,
    };
    const opponent = objects.find((object) => object?.type === "opponentModel")
        ?? objects.find((object) => object?.id === "opponent-model" || object?.id === "main")
        ?? null;
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
            fireballAvailable: Boolean(opponent.fireballAvailable),
            fireballCooldownRemainingMs: Number(opponent.fireballCooldownRemainingMs) || 0,
            fireballCharges: Number.isFinite(Number(opponent.fireballCharges)) ? Number(opponent.fireballCharges) : 0,
            fireballReloadRemainingMs: Number(opponent.fireballReloadRemainingMs) || 0,
            stunAvailable: Boolean(opponent.stunAvailable),
            stunCooldownRemainingMs: Number(opponent.stunCooldownRemainingMs) || 0,
            slowedMs: Number(opponent.slowedMs) || 0,
            abilityCooldowns: opponent.abilityCooldowns ?? {},
            abilityCharges: opponent.abilityCharges ?? {},
            abilityActiveMs: opponent.abilityActiveMs ?? {},
            preparingAbility: opponent.preparingAbility ?? null,
            preparingMs: Number(opponent.preparingMs) || 0,
            velocityX: opponent.velocityX ?? 0,
            velocityY: opponent.velocityY ?? 0,
        } : null,
        objects,
        obstacles: strategyObstacleTargets(objects),
    };
}

function strategyObstacleTargets(objects = []) {
    return objects.filter((object) => object?.type && object.type !== "opponentModel");
}

function normalizeConditions(conditions) {
    const source = Array.isArray(conditions) ? conditions : [{ type: CONDITION_TYPES[0].id }];
    return source.slice(0, MAX_CONDITIONS_PER_BLOCK).map((condition, index) => {
        if (condition?.type === "expression" || condition?.left) {
            return withConditionJoin(normalizeExpressionCondition(condition), condition, index);
        }
        const conditionType = normalizeConditionType(condition?.type);
        const definition = CONDITION_BY_ID.get(conditionType) ?? CONDITION_TYPES[0];
        return withConditionJoin({
            type: definition.id,
            ...(definition.requiresValue ? {
                value: clamp(Number(condition?.value) || definition.defaultValue, definition.min, definition.max),
            } : {}),
            ...(definition.supportsTarget ? {
                target: normalizeTarget(condition?.target, definition.defaultTarget ?? "opponent", definition.targetGroup),
            } : {}),
        }, condition, index);
    });
}

function withConditionJoin(normalized, source, index) {
    return index > 0 && source?.join === "or"
        ? { ...normalized, join: "or" }
        : normalized;
}

function normalizeExpressionCondition(condition) {
    const customLeft = String(condition?.left ?? "").startsWith("custom.")
        ? variableDefinition(String(condition.left), String(condition.left), condition?.right?.type === "boolean" ? "boolean" : "number", { min: CUSTOM_INTEGER_MIN, max: CUSTOM_INTEGER_MAX })
        : null;
    const leftDefinition = STATE_VARIABLE_BY_ID.get(condition?.left) ?? customLeft ?? STATE_VARIABLES[0];
    const comparator = leftDefinition.rangeOnly ? "range" : normalizeComparator(condition?.comparator, leftDefinition.valueType);
    const right = normalizeRightOperand(condition?.right, leftDefinition, condition?.comparator);
    return {
        type: "expression",
        left: leftDefinition.id,
        comparator,
        right,
        ...(leftDefinition.supportsAbility ? { ability: normalizeAbilityId(condition?.ability, leftDefinition) } : {}),
        ...(leftDefinition.supportsTarget ? {
            leftTarget: normalizeTarget(
                condition?.leftTarget ?? condition?.target,
                leftDefinition.defaultTarget ?? "opponent",
                leftDefinition.targetGroup ?? null,
            ),
        } : {}),
        ...(right?.type === "variable" && STATE_VARIABLE_BY_ID.get(right.value)?.supportsTarget ? {
            rightTarget: normalizeTarget(
                condition?.rightTarget ?? condition?.target,
                STATE_VARIABLE_BY_ID.get(right.value).defaultTarget ?? "opponent",
                STATE_VARIABLE_BY_ID.get(right.value).targetGroup ?? null,
            ),
        } : {}),
    };
}

function normalizeComparator(comparator, valueType) {
    const definition = COMPARATOR_BY_ID.get(comparator);
    if (definition?.valueTypes.includes(valueType)) return definition.id;
    return valueType === "boolean" ? "eq" : "lt";
}

function normalizeRightOperand(right, leftDefinition, legacyComparator) {
    if (leftDefinition.rangeOnly) {
        const legacyValue = clamp(Number(right?.value ?? 0), leftDefinition.min, leftDefinition.max);
        const legacyLower = ["gt", "gte", "eq"].includes(legacyComparator) ? legacyValue : leftDefinition.min;
        const legacyUpper = ["lt", "lte", "eq"].includes(legacyComparator) ? legacyValue : leftDefinition.max;
        const lower = clamp(Number(right?.type === "range" ? right.min : legacyLower), leftDefinition.min, leftDefinition.max);
        const requestedUpper = clamp(Number(right?.type === "range" ? right.max : legacyUpper), leftDefinition.min, leftDefinition.max);
        const maxRange = Number(leftDefinition.maxRange ?? 360);
        const upper = Math.abs(requestedUpper - lower) <= maxRange
            ? requestedUpper
            : clamp(lower + Math.sign(requestedUpper - lower) * maxRange, leftDefinition.min, leftDefinition.max);
        return { type: "range", min: lower, max: upper };
    }
    if (leftDefinition.valueType === "boolean") {
        return { type: "boolean", value: normalizeBoolean(right?.value, true) };
    }
    if (right?.type === "variable") {
        const rightDefinition = STATE_VARIABLE_BY_ID.get(right.value);
        if (rightDefinition?.valueType === "number" || String(right.value ?? "").startsWith("custom.")) {
            return { type: "variable", value: rightDefinition?.id ?? String(right.value) };
        }
    }
    const value = clamp(Number(right?.value ?? leftDefinition.defaultValue), leftDefinition.min, leftDefinition.max);
    const step = Number(leftDefinition.step ?? 0);
    return {
        type: "number",
        value: step > 0 ? Number((Math.round(value / step) * step).toFixed(10)) : value,
    };
}

function normalizeConditionType(type) {
    if (type === "my_cornered") return "my_edge_distance_lt";
    if (type === "enemy_cornered") return "target_edge_distance_lt";
    return type;
}

function normalizeBlock(block, blockIndex) {
    const actions = normalizedBlockActions(block);
    const primaryAction = actions[0] ?? { action: "none", actionTarget: "opponent" };
    return {
        id: String(block?.id || `logic-${blockIndex + 1}`),
        conditions: normalizeConditions(block?.conditions),
        priority: normalizePriority(block?.priority),
        action: primaryAction.action,
        actionTarget: primaryAction.actionTarget,
        actions,
    };
}

function normalizedBlockActions(block) {
    const source = Array.isArray(block?.actions) && block.actions.length
        ? block.actions
        : [{ action: block?.action ?? "none", actionTarget: block?.actionTarget, targetOffsetX: block?.targetOffsetX, targetOffsetY: block?.targetOffsetY }];
    const seenHeads = new Set();
    const normalized = [];
    for (const entry of source) {
        const migratedEntry = migrateActionEntry(entry);
        const action = ACTION_BY_ID.get(migratedEntry.action) ?? ACTION_TYPES[0];
        const head = actionExecutionHead(action);
        const headKey = head === "variable" ? `${head}:${String(migratedEntry.variableId ?? normalized.length)}` : head;
        if (seenHeads.has(headKey)) continue;
        seenHeads.add(headKey);
        normalized.push({
            action: action.id,
            actionTarget: normalizeActionTarget(migratedEntry.actionTarget, action.id),
            ...(action.movementConfig ? {
                movementMode: ["target", "coordinates", "absolute"].includes(migratedEntry.movementMode) ? migratedEntry.movementMode : "target",
                movementDirection: String(migratedEntry.movementDirection ?? "toward"),
            } : {}),
            ...(action.orientationConfig ? { phaseFacingMode: ["face_target", "keep", "face_origin", "mirror"].includes(migratedEntry.phaseFacingMode) ? migratedEntry.phaseFacingMode : "face_target" } : {}),
            ...(actionSupportsTarget(action) ? {
                targetOffsetX: clamp(Number(migratedEntry.targetOffsetX ?? 0), -ARENA_WIDTH_UNITS, ARENA_WIDTH_UNITS),
                targetOffsetY: clamp(Number(migratedEntry.targetOffsetY ?? 0), -ARENA_HEIGHT_UNITS, ARENA_HEIGHT_UNITS),
            } : {}),
            ...(action.coordinateTarget ? {
                targetMode: action.movementConfig ? (migratedEntry.movementMode === "coordinates" ? "coordinates" : "target") : migratedEntry?.targetMode === "coordinates"
                    || (migratedEntry?.targetMode == null && (migratedEntry?.targetX != null || migratedEntry?.targetY != null))
                    ? "coordinates"
                    : "target",
                targetX: clamp(Number(migratedEntry?.targetX ?? ARENA_WIDTH_UNITS / 2), 0, ARENA_WIDTH_UNITS),
                targetY: clamp(Number(migratedEntry?.targetY ?? ARENA_HEIGHT_UNITS / 2), 0, ARENA_HEIGHT_UNITS),
            } : {}),
            ...(action.variableAction ? {
                variableId: String(migratedEntry.variableId ?? ""),
                operation: ["set", "add", "subtract"].includes(migratedEntry.operation) ? migratedEntry.operation : "set",
                value: migratedEntry.value === true || migratedEntry.value === false
                    ? migratedEntry.value
                    : clamp(Math.trunc(Number(migratedEntry.value) || 0), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX),
                ...(!(migratedEntry.value === true || migratedEntry.value === false) ? {
                    terms: normalizeVariableActionTerms(migratedEntry),
                } : {}),
            } : {}),
        });
    }
    const executable = normalized.filter((entry) => entry.action !== "none");
    return executable.length ? executable : [{ action: "none", actionTarget: "opponent" }];
}

function migrateActionEntry(entry = {}) {
    const id = String(entry.action ?? "none");
    const phaseMode = { phase_strike_keep_facing: "keep", phase_strike_face_origin: "face_origin", phase_strike_mirror_facing: "mirror" }[id];
    if (phaseMode) return { ...entry, action: "phase_strike", phaseFacingMode: phaseMode };
    if (id === "move_walk" || id === "dash" || id === "micro_dash") return entry;
    const prefix = id.startsWith("move_") ? "move_" : id.startsWith("dash_") ? "dash_" : id.startsWith("micro_dash_") ? "micro_dash_" : null;
    if (!prefix) return entry;
    const canonical = prefix === "move_" ? "move_walk" : prefix === "dash_" ? "dash" : "micro_dash";
    const suffix = id.slice(prefix.length);
    const absolute = new Set(["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest", "stop"]);
    const relative = { inward: "toward", outward: "away", tangent_left: "left", tangent_right: "right", diagonal_in_left: "toward_left", diagonal_in_right: "toward_right", diagonal_out_left: "away_left", diagonal_out_right: "away_right", left: "left", right: "right" };
    return { ...entry, action: canonical, movementMode: absolute.has(suffix) ? "absolute" : "target", movementDirection: absolute.has(suffix) ? suffix : (relative[suffix] ?? "toward") };
}

export function actionExecutionHead(action) {
    if (action?.head === "variable") return "variable";
    if (action?.head === "movement") return "movement";
    if (action?.head === "rotation") return "rotation";
    if (action?.head === "dash") return "dash";
    if (action?.head === "none") return "none";
    return "ability";
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
    return Boolean(action.movementConfig)
        || (action.head === "movement" && !TARGETLESS_MOVEMENT_ACTION_IDS.has(action.id))
        || (action.head === "dash" && !TARGETLESS_DASH_ACTION_IDS.has(action.id))
        || action.id === "rotate_toward_enemy"
        || action.locationTarget === true;
}

function blockHasExecutableAction(block, state) {
    return normalizedBlockActions(block).some((entry) => actionExecutableNow({ ...block, ...entry }, state));
}

function normalizeVariableActionTerms(entry) {
    const legacy = [{
        operator: entry.operation ?? "set",
        operand: { type: "number", value: entry.value ?? 0 },
    }];
    const source = Array.isArray(entry.terms) && entry.terms.length ? entry.terms : legacy;
    return source.slice(0, MAX_VARIABLE_ACTION_TERMS).map((term, index) => {
        const operand = term?.operand ?? term ?? {};
        const variable = operand.type === "variable" && STATE_VARIABLE_BY_ID.get(String(operand.value))?.valueType === "number"
            ? String(operand.value)
            : operand.type === "variable" && String(operand.value).startsWith("custom.")
                ? String(operand.value)
                : null;
        return {
            operator: index === 0 && term?.operator === "set"
                ? "set"
                : term?.operator === "subtract" ? "subtract" : "add",
            operand: variable
                ? { type: "variable", value: variable, ...(operand.target ? { target: String(operand.target) } : {}) }
                : { type: "number", value: clamp(Math.trunc(Number(operand.value) || 0), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX) },
        };
    });
}

export function countVariableSlots(configuration) {
    return (configuration?.customVariables ?? []).reduce((slots, variable) => (
        slots + 1 + (variable?.valueType === "boolean" && Array.isArray(variable.conditions) ? variable.conditions.length : 0)
    ), 0);
}

export function countConditionSlots(configuration) {
    const variableCosts = new Map((configuration?.customVariables ?? []).map((variable) => [
        variable.id,
        1 + (variable?.valueType === "boolean" && Array.isArray(variable.conditions) ? variable.conditions.length : 0),
    ]));
    const conditionCost = (condition) => {
        const referenced = new Set([condition?.left, condition?.right?.type === "variable" ? condition.right.value : null]
            .filter((id) => variableCosts.has(id)));
        return referenced.size ? [...referenced].reduce((total, id) => total + variableCosts.get(id), 0) : 1;
    };
    const countBranches = (branches = []) => branches.reduce((total, branch) => (
        total + (branch.conditions ?? []).reduce((sum, condition) => sum + conditionCost(condition), 0)
            + countBranches(branch.children)
    ), 0);
    const derivedConditions = (configuration?.customVariables ?? []).reduce((total, variable) => (
        total + (variable?.valueType === "boolean" ? variable.conditions?.length ?? 0 : 0)
    ), 0);
    return derivedConditions
        + (configuration?.columns ?? []).reduce((total, column) => total + countBranches(column.branches), 0)
        + (configuration?.blocks ?? []).reduce((total, block) => total + (block.conditions ?? []).reduce((sum, condition) => sum + conditionCost(condition), 0), 0)
        + (configuration?.clusters ?? []).reduce((total, cluster) => total
            + (cluster.conditions ?? []).reduce((sum, condition) => sum + conditionCost(condition), 0)
            + (cluster.blocks ?? []).reduce((sum, block) => sum + (block.conditions ?? []).reduce((conditionTotal, condition) => conditionTotal + conditionCost(condition), 0), 0), 0);
}

function actionExecutableNow(block, state) {
    const action = ACTION_BY_ID.get(block?.action) ?? ACTION_TYPES[0];
    if (action.id === "none") return false;
    if (action.id === "variable") return true;
    if (actionSupportsTarget(action)
        && !(action.movementConfig && block.movementMode !== "target")
        && !(action.coordinateTarget && block.targetMode === "coordinates")
        && !resolveMeleeStrategyTarget(state, block.actionTarget)) return false;
    if (action.head === "movement" || action.head === "rotation" || action.id === "no_dash") return true;
    if (action.head === "dash") return Boolean(state.player.dashAvailable);
    const ability = PROTOTYPE_ACTION_TO_ABILITY[action.id] ?? action.id;
    const equipped = state.player.abilities;
    if (Array.isArray(equipped) && equipped.length && !equipped.includes(ability)) return false;
    return selectedAbilityReady(state.player, ability);
}

function normalizeTarget(target, fallback, targetGroup = null) {
    const [base, order, ordinal] = String(target ?? "").split(":");
    const ordered = TARGET_BY_ID.has(base)
        && base !== "opponent"
        && ["closest", "farthest", "oldest", "newest"].includes(order)
        && Number.isInteger(Number(ordinal)) && Number(ordinal) >= 1 && Number(ordinal) <= 100;
    if (!TARGET_BY_ID.has(target) && !ordered) return fallback;
    if (targetGroup === "objects" && !isObjectTarget(target)) return fallback;
    return target;
}

function isObjectTarget(target) {
    const base = String(target).split(":")[0];
    return base !== "opponent" && TARGET_BY_ID.has(base);
}

function validateThresholdRange(errors, conditions, blockLabel, lowerType, upperType, label) {
    const lower = conditions.find((condition) => condition.type === lowerType)?.value;
    const upper = conditions.find((condition) => condition.type === upperType)?.value;
    if (lower != null && upper != null && lower >= upper) {
        errors.push(`${blockLabel} has an impossible ${label} range.`);
    }
}

function evaluateExpressionCondition(condition, state) {
    const customDefinition = state.customVariableDefinitions?.find((candidate) => candidate.id === condition.left);
    const leftDefinition = STATE_VARIABLE_BY_ID.get(condition.left) ?? (customDefinition ? variableDefinition(customDefinition.id, customDefinition.name, customDefinition.valueType, { min: CUSTOM_INTEGER_MIN, max: CUSTOM_INTEGER_MAX }) : null);
    if (!leftDefinition) return false;
    const left = resolveStateVariable(state, condition, leftDefinition.id, condition.leftTarget ?? condition.target);
    if (leftDefinition.rangeOnly) {
        return condition.right?.type === "range"
            && directionFallsInRange(left, Number(condition.right.min), Number(condition.right.max));
    }
    const right = condition.right?.type === "variable"
        ? resolveStateVariable(state, condition, condition.right.value, condition.rightTarget ?? condition.target)
        : condition.right?.value;
    return compareValues(left, condition.comparator, right, leftDefinition.valueType);
}

function resolveStateVariable(state, condition, variableId, targetId = condition.target) {
    if (String(variableId).startsWith("custom.")) return resolveCustomVariable(state, variableId);
    const normalizedTargetId = targetId ?? "opponent";
    const target = resolveMeleeStrategyTarget(state, normalizedTargetId);
    const selectedAbility = String(condition.ability ?? "");
    const genericAbility = /^(my|opponent)\.selectedAbility(Ready|CooldownMs|Ammo|Preparing|PreparationMs)$/.exec(variableId);
    if (genericAbility) {
        const fighter = genericAbility[1] === "my" ? state.player : state.opponent;
        if (genericAbility[2] === "Ready") return selectedAbilityReady(fighter, selectedAbility);
        if (genericAbility[2] === "CooldownMs") return millisecondsToSeconds(selectedAbilityCooldownMs(fighter, selectedAbility));
        if (genericAbility[2] === "Ammo") return selectedAbilityAmmo(fighter, selectedAbility);
        if (genericAbility[2] === "Preparing") return fighter?.preparingAbility === selectedAbility;
        return fighter?.preparingAbility === selectedAbility ? millisecondsToSeconds(fighter?.preparingMs ?? 0) : 0;
    }
    const dynamic = /^(my|opponent)\.(abilityReady|abilityCooldownMs|entityExists|preparing|preparingMs)\.(.+)$/.exec(variableId);
    if (dynamic) {
        const fighter = dynamic[1] === "my" ? state.player : state.opponent;
        if (dynamic[2] === "abilityReady") return Number(fighter?.abilityCooldowns?.[dynamic[3]] ?? 0) <= 0;
        if (dynamic[2] === "abilityCooldownMs") return millisecondsToSeconds(fighter?.abilityCooldowns?.[dynamic[3]] ?? 0);
        if (dynamic[2] === "preparing") return fighter?.preparingAbility === dynamic[3];
        if (dynamic[2] === "preparingMs") return fighter?.preparingAbility === dynamic[3] ? millisecondsToSeconds(fighter?.preparingMs ?? 0) : 0;
        return state.objects.some((object) => object?.abilityId === dynamic[3] && object?.owner === dynamic[1]);
    }
    switch (variableId) {
        case "match.elapsedSeconds": return millisecondsToSeconds(state.player.matchElapsedMs);
        case "my.hp": return state.player.hp;
        case "my.damageTakenLastTick": return Number(state.player.damageTakenLastTick ?? 0);
        case "my.hpNetChangeLastTick": return Number(state.player.hpNetChangeLastTick ?? 0);
        case "my.x": return state.player.x ?? 0;
        case "my.y": return state.player.y ?? 0;
        case "opponent.hp": return state.opponent?.hp ?? 0;
        case "opponent.damageTakenLastTick": return Number(state.opponent?.damageTakenLastTick ?? 0);
        case "opponent.hpNetChangeLastTick": return Number(state.opponent?.hpNetChangeLastTick ?? 0);
        case "opponent.x": return state.opponent?.x ?? 0;
        case "opponent.y": return state.opponent?.y ?? 0;
        case "my.slowedMs": return millisecondsToSeconds(state.player.slowedMs);
        case "opponent.slowedMs": return millisecondsToSeconds(state.opponent?.slowedMs);
        case "target.distance": return target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY;
        case "target.hp": return Math.max(0, Number(target?.hp ?? 0));
        case "target.alive": return Boolean(target) && Number(target.hp ?? 0) > 0;
        case "target.bearingFromMe": {
            const bearing = target ? compassBearing(state.player, target) : 0;
            return bearing > 180 ? bearing - 360 : bearing;
        }
        case "target.movementDirection": {
            const velocityX = Number(target?.velocityX ?? 0);
            const velocityY = Number(target?.velocityY ?? 0);
            if (Math.hypot(velocityX, velocityY) <= 0.001) return Number.NaN;
            const bearing = compassRotation(Math.atan2(velocityY, velocityX) * 180 / Math.PI);
            return bearing > 180 ? bearing - 360 : bearing;
        }
        case "target.velocity": return target ? Math.hypot(Number(target.velocityX ?? 0), Number(target.velocityY ?? 0)) : 0;
        case "my.bearingFromTarget": return target ? compassBearing(target, state.player) : 0;
        case "target.relativeBearing": return target ? Math.abs(signedAngleDelta(state.player?.rotation ?? 0, worldRotation(compassBearing(state.player, target)))) : 0;
        case "target.relativeBearingClockwise": return target ? clockwiseAngleDelta(state.player?.rotation ?? 0, worldRotation(compassBearing(state.player, target))) : 0;
        case "target.relativeBearingCounterclockwise": return target ? clockwiseAngleDelta(worldRotation(compassBearing(state.player, target)), state.player?.rotation ?? 0) : 0;
        case "target.facing": return target === state.opponent ? compassRotation(target.rotation) : 0;
        case "target.count": return matchingStrategyTargets(state, normalizedTargetId).length;
        case "target.age": return millisecondsToSeconds(target?.ageMs ?? target?.timerMs ?? 0);
        case "my.edgeDistance": return edgeDistance(state.player);
        case "target.edgeDistance": return target ? edgeDistance(target) : 0;
        case "my.swingReady": return Boolean(state.player.swingAvailable);
        case "my.swingCooldownMs": return millisecondsToSeconds(state.player.swingCooldownRemainingMs);
        case "my.blockReady": return Boolean(state.player.blockAvailable);
        case "my.shieldUp": return Boolean(state.player.blockActive);
        case "my.shieldCharges": return state.player.blockCharges ?? 0;
        case "my.blockRechargeMs": return millisecondsToSeconds(state.player.blockCooldownRemainingMs);
        case "my.dashReady": return Boolean(state.player.dashAvailable);
        case "my.dashCooldownMs": return millisecondsToSeconds(state.player.dashCooldownRemainingMs);
        case "my.gunReady": return Boolean(state.player.gunAvailable);
        case "my.gunCooldownMs": return millisecondsToSeconds(state.player.gunCooldownRemainingMs);
        case "my.gunAmmo": return state.player.gunAmmo ?? 0;
        case "my.gunReloadMs": return millisecondsToSeconds(state.player.gunReloadRemainingMs);
        case "my.grenadeReady": return Boolean(state.player.grenadeAvailable);
        case "my.grenadeCooldownMs": return millisecondsToSeconds(state.player.grenadeCooldownRemainingMs);
        case "my.fireballReady": return Boolean(state.player.fireballAvailable);
        case "my.fireballCooldownMs": return millisecondsToSeconds(state.player.fireballCooldownRemainingMs);
        case "my.fireballCharges": return state.player.fireballCharges ?? 0;
        case "my.fireballReloadMs": return millisecondsToSeconds(state.player.fireballReloadRemainingMs);
        case "my.stunReady": return Boolean(state.player.stunAvailable);
        case "my.stunCooldownMs": return millisecondsToSeconds(state.player.stunCooldownRemainingMs);
        case "opponent.swingReady": return Boolean(state.opponent?.swingAvailable);
        case "opponent.swingCooldownMs": return millisecondsToSeconds(state.opponent?.swingCooldownRemainingMs);
        case "opponent.blockReady": return Boolean(state.opponent?.blockAvailable);
        case "opponent.shieldUp": return Boolean(state.opponent?.blockActive);
        case "opponent.shieldCharges": return state.opponent?.blockCharges ?? 0;
        case "opponent.blockRechargeMs": return millisecondsToSeconds(state.opponent?.blockCooldownRemainingMs);
        case "opponent.dashReady": return Boolean(state.opponent?.dashAvailable);
        case "opponent.dashCooldownMs": return millisecondsToSeconds(state.opponent?.dashCooldownRemainingMs);
        case "opponent.gunReady": return Boolean(state.opponent?.gunAvailable);
        case "opponent.gunCooldownMs": return millisecondsToSeconds(state.opponent?.gunCooldownRemainingMs);
        case "opponent.gunAmmo": return state.opponent?.gunAmmo ?? 0;
        case "opponent.gunReloadMs": return millisecondsToSeconds(state.opponent?.gunReloadRemainingMs);
        case "opponent.grenadeReady": return Boolean(state.opponent?.grenadeAvailable);
        case "opponent.grenadeCooldownMs": return millisecondsToSeconds(state.opponent?.grenadeCooldownRemainingMs);
        case "opponent.fireballReady": return Boolean(state.opponent?.fireballAvailable);
        case "opponent.fireballCooldownMs": return millisecondsToSeconds(state.opponent?.fireballCooldownRemainingMs);
        case "opponent.fireballCharges": return state.opponent?.fireballCharges ?? 0;
        case "opponent.fireballReloadMs": return millisecondsToSeconds(state.opponent?.fireballReloadRemainingMs);
        case "opponent.stunReady": return Boolean(state.opponent?.stunAvailable);
        case "opponent.stunCooldownMs": return millisecondsToSeconds(state.opponent?.stunCooldownRemainingMs);
        case "target.exists": return Boolean(target);
        default: return null;
    }
}

function selectedAbilityReady(fighter, ability) {
    const readiness = {
        swing: fighter?.swingAvailable, block: fighter?.blockAvailable, dash: fighter?.dashAvailable,
        fire_gun: fighter?.gunAvailable, throw_grenade: fighter?.grenadeAvailable,
        shoot_fireball: fighter?.fireballAvailable, stun: fighter?.stunAvailable,
    };
    return ability in readiness ? Boolean(readiness[ability]) : Number(fighter?.abilityCooldowns?.[ability] ?? 0) <= 0;
}

function selectedAbilityCooldownMs(fighter, ability) {
    const cooldowns = {
        swing: fighter?.swingCooldownRemainingMs, block: fighter?.blockCooldownRemainingMs, dash: fighter?.dashCooldownRemainingMs,
        fire_gun: fighter?.gunCooldownRemainingMs, throw_grenade: fighter?.grenadeCooldownRemainingMs,
        shoot_fireball: fighter?.fireballCooldownRemainingMs, stun: fighter?.stunCooldownRemainingMs,
    };
    return Number(ability in cooldowns ? cooldowns[ability] : fighter?.abilityCooldowns?.[ability]) || 0;
}

function prepareCustomVariables(state, definitions) {
    if (!state.player.customVariables || typeof state.player.customVariables !== "object") state.player.customVariables = {};
    state.customVariableDefinitions = definitions;
    definitions.forEach((definition) => {
        if (!(definition.id in state.player.customVariables)) state.player.customVariables[definition.id] = definition.initialValue;
    });
}

function resolveCustomVariable(state, id, resolving = state.resolvingCustomVariables ?? new Set()) {
    const definition = state.customVariableDefinitions?.find((candidate) => candidate.id === id);
    if (!definition) return undefined;
    if (definition.valueType === "boolean" && definition.conditions?.length) {
        if (resolving.has(id)) return false;
        resolving.add(id);
        const result = evaluateConditionList(definition.conditions, { ...state, resolvingCustomVariables: resolving });
        resolving.delete(id);
        return result;
    }
    return state.player.customVariables?.[id] ?? definition.initialValue;
}

function applyVariableAction(block, state, definitions) {
    // Older editor nodes could visually select the first variable without
    // persisting its id. Keep those saved brains functional after the UI fix.
    const definition = definitions.find((candidate) => candidate.id === block.variableId)
        ?? (!block.variableId ? definitions[0] : null);
    if (!definition || definition.conditions?.length) return;
    if (definition.valueType === "boolean") {
        state.player.customVariables[definition.id] = Boolean(block.value);
        return;
    }
    const current = Number(state.player.customVariables[definition.id] ?? definition.initialValue);
    const terms = Array.isArray(block.terms) && block.terms.length ? block.terms : normalizeVariableActionTerms(block);
    let next = terms[0]?.operator === "set" ? 0 : current;
    for (const term of terms) {
        const amount = term.operand?.type === "variable"
            ? Number(resolveStateVariable(state, { target: term.operand.target }, term.operand.value, term.operand.target)) || 0
            : Number(term.operand?.value) || 0;
        next += term.operator === "subtract" ? -amount : amount;
    }
    state.player.customVariables[definition.id] = clamp(Math.trunc(next), CUSTOM_INTEGER_MIN, CUSTOM_INTEGER_MAX);
}

function directionFallsInRange(value, start, end) {
    const rawSpan = end - start;
    if (![value, start, end].every(Number.isFinite) || Math.abs(rawSpan) > 360) return false;
    const span = Math.abs(rawSpan) === 360 ? 360 : rawSpan >= 0 ? rawSpan : 360 + rawSpan;
    const distance = ((value - start) % 360 + 360) % 360;
    return distance <= span + 1e-9;
}

function selectedAbilityAmmo(fighter, ability) {
    if (ability === "block") return Number(fighter?.blockCharges ?? 0);
    if (ability === "fire_gun") return Number(fighter?.gunAmmo ?? 0);
    if (ability === "shoot_fireball") return Number(fighter?.fireballCharges ?? 0);
    return 0;
}

function millisecondsToSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number / 1000 : 0;
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
        label: numberedOpponentLabel(label),
        valueType,
        defaultValue: valueType === "boolean" ? true : 50,
        min: valueType === "number" ? 0 : undefined,
        max: valueType === "number" ? 100 : undefined,
        ...options,
    };
}

function defaultAbilityForVariable(variable) {
    return BOT_ABILITIES.find((ability) => !variable.requiredTag || ability.tags.includes(variable.requiredTag))?.id ?? BOT_ABILITIES[0]?.id ?? "swing";
}

function normalizeAbilityId(value, variable) {
    const candidate = BOT_ABILITIES.find((ability) => ability.id === value && (!variable.requiredTag || ability.tags.includes(variable.requiredTag)));
    return candidate?.id ?? defaultAbilityForVariable(variable);
}

function normalizeBoolean(value, fallback) {
    if (value === true || value === false) return value;
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
    return fallback;
}

function thresholdCondition(id, label, defaultValue, min, max, suffix, options = {}) {
    return { id, label: numberedOpponentLabel(label), requiresValue: true, defaultValue, min, max, suffix, ...options };
}

function flagCondition(id, label, options = {}) { return { id, label: numberedOpponentLabel(label), requiresValue: false, ...options }; }
function numberedOpponentLabel(label) { return String(label).replace(/^Opponent(?: 1)?\b/, "Opponent 1"); }
function edgeDistance(entity) {
    const halfSize = Math.max(0, Number(entity?.size ?? ENTITY_SIZE) / 2);
    return Math.max(
        0,
        Math.min(
            entity.x - halfSize,
            ARENA_WIDTH_UNITS - halfSize - entity.x,
            entity.y - halfSize,
            ARENA_HEIGHT_UNITS - halfSize - entity.y,
        ),
    );
}
function distanceBetween(first, second) {
    if (!first || !second) return Number.POSITIVE_INFINITY;
    return Math.hypot(second.x - first.x, second.y - first.y);
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function resolveMeleeStrategyTarget(state, target) {
    const [baseTarget, order = "closest", ordinalText = "1"] = String(target ?? "opponent").split(":");
    if (baseTarget !== target) {
        const candidates = matchingStrategyTargets(state, baseTarget);
        const ordinal = Math.max(1, Math.min(100, Number(ordinalText) || 1));
        candidates.sort(targetOrderComparator(order, state?.player));
        return candidates[ordinal - 1] ?? null;
    }
    if (target === "opponent") return state?.opponent ?? null;
    if (target === "my_core") target = `core_${state?.player?.slot ?? 1}`;
    if (target === "opponent_core") target = `core_${state?.opponent?.slot ?? 2}`;
    if (target === "defender_core") target = "core_1";
    if (target === "opponent_grenade") {
        return (state?.objects ?? []).find((object) => (
            object?.type === "grenade"
            && object.ownerId
            && object.ownerId === state?.opponent?.id
        )) ?? null;
    }
    if (target === "opponent_fireball") {
        const fireballs = (state?.objects ?? []).filter((object) => (
            object?.type === "fireball"
            && object.ownerId
            && object.ownerId === state?.opponent?.id
        ));
        return fireballs.sort((first, second) => (
            distanceBetween(state?.player, first) - distanceBetween(state?.player, second)
        ))[0] ?? null;
    }
    if (target === "orbital_zone") {
        return (state?.objects ?? [])
            .filter((object) => object?.type === "orbitalMarker")
            .sort((first, second) => distanceBetween(state?.player, first) - distanceBetween(state?.player, second))[0] ?? null;
    }
    const opponentEntityTypes = {
        opponent_concussive_shot: "concussiveShot",
        opponent_proximity_mine: "proximityMine",
        opponent_gravity_field: "gravityField",
        opponent_hunter_drone: "hunterDrone",
        opponent_orbital_zone: "orbitalMarker",
        opponent_null_zone: "nullZone",
        opponent_silence_wave: "silenceWave",
        opponent_temporal_rewind_zone: "temporalRewindZone",
    };
    if (opponentEntityTypes[target]) {
        return (state?.objects ?? [])
            .filter((object) => object?.type === opponentEntityTypes[target]
                && (object.ownerId === state?.opponent?.id || object.ownerSlot === state?.opponent?.slot))
            .sort((first, second) => distanceBetween(state?.player, first) - distanceBetween(state?.player, second))[0] ?? null;
    }
    const myEntityTypes = {
        my_grenade: "grenade", my_fireball: "fireball", my_concussive_shot: "concussiveShot", my_proximity_mine: "proximityMine",
        my_gravity_field: "gravityField", my_hunter_drone: "hunterDrone", my_orbital_zone: "orbitalMarker",
        my_null_zone: "nullZone", my_silence_wave: "silenceWave", my_temporal_rewind_zone: "temporalRewindZone",
    };
    if (myEntityTypes[target]) return (state?.objects ?? [])
        .filter((object) => object?.type === myEntityTypes[target]
            && (object.ownerId === state?.player?.id || object.ownerSlot === state?.player?.slot))
        .sort((first, second) => distanceBetween(state?.player, first) - distanceBetween(state?.player, second))[0] ?? null;
    return [
        ...(state?.obstacles ?? []),
        ...(state?.objects ?? []),
    ].find((obstacle) => obstacle?.id === target) ?? null;
}

function matchingStrategyTargets(state, target) {
    const base = String(target ?? "").split(":")[0];
    if (base === "opponent") return state?.opponent ? [state.opponent] : [];
    const typeByTarget = {
        orbital_zone: "orbitalMarker", opponent_grenade: "grenade", opponent_fireball: "fireball",
        opponent_concussive_shot: "concussiveShot", opponent_proximity_mine: "proximityMine",
        opponent_gravity_field: "gravityField", opponent_hunter_drone: "hunterDrone",
        opponent_orbital_zone: "orbitalMarker", opponent_null_zone: "nullZone", opponent_temporal_rewind_zone: "temporalRewindZone",
        opponent_silence_wave: "silenceWave", my_grenade: "grenade", my_fireball: "fireball", my_concussive_shot: "concussiveShot",
        my_proximity_mine: "proximityMine", my_gravity_field: "gravityField", my_hunter_drone: "hunterDrone",
        my_orbital_zone: "orbitalMarker", my_null_zone: "nullZone", my_silence_wave: "silenceWave", my_temporal_rewind_zone: "temporalRewindZone",
    };
    const type = typeByTarget[base];
    if (!type) return [];
    const own = base.startsWith("my_");
    return (state?.objects ?? []).filter((object) => object?.type === type && (base === "orbital_zone" || (own
        ? object.ownerId === state?.player?.id || object.ownerSlot === state?.player?.slot
        : object.ownerId === state?.opponent?.id || object.ownerSlot === state?.opponent?.slot)));
}

function targetOrderComparator(order, player) {
    if (order === "oldest" || order === "newest") return (a, b) => {
        const compared = String(a.id ?? "").localeCompare(String(b.id ?? ""));
        return order === "oldest" ? compared : -compared;
    };
    return (a, b) => (order === "farthest" ? -1 : 1) * (distanceBetween(player, a) - distanceBetween(player, b));
}

function compassBearing(from, to) {
    return ((Math.atan2(to.x - from.x, from.y - to.y) * 180 / Math.PI) % 360 + 360) % 360;
}
function compassRotation(rotation) { return ((Number(rotation ?? 0) + 90) % 360 + 360) % 360; }
function worldRotation(compass) { return ((compass - 90) % 360 + 360) % 360; }
function signedAngleDelta(from, to) { return ((to - from + 540) % 360) - 180; }
function clockwiseAngleDelta(from, to) { return ((to - from) % 360 + 360) % 360; }
