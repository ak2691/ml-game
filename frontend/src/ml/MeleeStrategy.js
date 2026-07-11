import { MAX_OBSTACLE_SLOTS } from "./Featurebuilder.js";
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
    flagCondition("my_jammed", "I am Jammed", { group: "My Bot" }),
    flagCondition("my_command_locked", "I am Command Locked", { group: "My Bot" }),
    flagCondition("opponent_jammed", "Opponent is Jammed", { group: "Opponent" }),
    flagCondition("opponent_command_locked", "Opponent is Command Locked", { group: "Opponent" }),
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
    flagCondition("target_exists", "Target Object Exists", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects", group: "Objects" }),
    flagCondition("target_missing", "Target Object Does Not Exist", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects", group: "Objects" }),
    flagCondition("target_health_pack", "Target is Health Pack", { supportsTarget: true, defaultTarget: "object_1", group: "Objects" }),
    flagCondition("target_damage_zone", "Target is Damage Zone", { supportsTarget: true, defaultTarget: "object_1", group: "Objects" }),
    flagCondition("target_projectile_wall", "Target is Projectile Wall", { supportsTarget: true, defaultTarget: "object_1", group: "Objects" }),
    flagCondition("target_bouncy_wall", "Target is Bouncy Wall", { supportsTarget: true, defaultTarget: "object_1", group: "Objects" }),
    flagCondition("inside_damage_zone", "I am in a Damage Zone", { group: "Objects" }),
]);
const LEGACY_CONDITION_TYPES = Object.freeze([
    thresholdCondition("enemy_distance_lt", "Target Distance <", 120, 0, 700, "px", { supportsTarget: true, group: "Target" }),
    thresholdCondition("enemy_distance_gt", "Target Distance >", 120, 0, 700, "px", { supportsTarget: true, group: "Target" }),
    thresholdCondition("my_edge_distance_lt", "My Distance From Edge <", 80, 0, 300, "px"),
    thresholdCondition("my_edge_distance_gt", "My Distance From Edge >", 80, 0, 300, "px"),
    thresholdCondition("target_edge_distance_lt", "Target Distance From Edge <", 80, 0, 300, "px", { supportsTarget: true, group: "Target" }),
    thresholdCondition("target_edge_distance_gt", "Target Distance From Edge >", 80, 0, 300, "px", { supportsTarget: true, group: "Target" }),
    thresholdCondition("opponent_object_distance_lt", "Opponent Distance to Object <", 120, 0, 700, "px", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects", group: "Objects" }),
    thresholdCondition("opponent_object_distance_gt", "Opponent Distance to Object >", 120, 0, 700, "px", { supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects", group: "Objects" }),
    thresholdCondition("my_hp_lt", "My HP <", 50, 1, 100, "HP", { group: "My Bot" }),
    thresholdCondition("my_hp_gt", "My HP >", 50, 0, 99, "HP", { group: "My Bot" }),
    thresholdCondition("enemy_hp_lt", "Opponent HP <", 50, 1, 100, "HP", { group: "Opponent" }),
    thresholdCondition("enemy_hp_gt", "Opponent HP >", 50, 0, 99, "HP", { group: "Opponent" }),
    thresholdCondition("my_shield_charges_lt", "My Shield Charges <", 3, 0, 5, "charges", { group: "My Bot" }),
    thresholdCondition("my_shield_charges_gt", "My Shield Charges >", 2, 0, 5, "charges", { group: "My Bot" }),
    thresholdCondition("my_dash_charges_lt", "My Dash Charges <", 1, 0, 2, "charges", { group: "My Bot" }),
    thresholdCondition("my_dash_charges_gt", "My Dash Charges >", 0, 0, 2, "charges", { group: "My Bot" }),
    thresholdCondition("opponent_shield_charges_lt", "Opponent Shield Charges <", 3, 0, 5, "charges", { group: "Opponent" }),
    thresholdCondition("opponent_shield_charges_gt", "Opponent Shield Charges >", 2, 0, 5, "charges", { group: "Opponent" }),
    thresholdCondition("opponent_dash_charges_lt", "Opponent Dash Charges <", 1, 0, 2, "charges", { group: "Opponent" }),
    thresholdCondition("opponent_dash_charges_gt", "Opponent Dash Charges >", 0, 0, 2, "charges", { group: "Opponent" }),
    flagCondition("enemy_attacking", "Opponent is Attacking", { group: "Opponent" }),
    flagCondition("enemy_blocking", "Opponent is Blocking", { group: "Opponent" }),
    flagCondition("enemy_rushing", "Opponent is Rushing", { group: "Opponent" }),
    flagCondition("enemy_fleeing", "Opponent is Fleeing", { group: "Opponent" }),
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
    { id: "shoot_fireball", label: "Action: Shoot Fireball", head: "fireball" },
    { id: "stun", label: "Action: Stun", head: "stun" },
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
    { id: "opponent_fireball", label: "Closest Opponent Fireball" },
    { id: "object_center", label: "Center Objective" },
    { id: "object_buff_1", label: "Left Center Buff" },
    { id: "object_buff_2", label: "Right Center Buff" },
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
    variableDefinition("my.x", "My X Position", "number", { group: "My Bot", min: 0, max: 800, suffix: "px" }),
    variableDefinition("my.y", "My Y Position", "number", { group: "My Bot", min: 0, max: 800, suffix: "px" }),
    variableDefinition("opponent.hp", "Opponent HP", "number", { group: "Opponent", min: 0, max: 100 }),
    variableDefinition("opponent.x", "Opponent X Position", "number", { group: "Opponent", min: 0, max: 800, suffix: "px" }),
    variableDefinition("opponent.y", "Opponent Y Position", "number", { group: "Opponent", min: 0, max: 800, suffix: "px" }),
    variableDefinition("my.overdriveMs", "My Overdrive Timer (seconds)", "number", { group: "My Bot", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("my.barrierMs", "My Barrier Timer (seconds)", "number", { group: "My Bot", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("my.slowedMs", "My Slow Timer (seconds)", "number", { group: "My Bot", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("my.jammedMs", "My Jammed Timer (seconds)", "number", { group: "My Bot", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("my.commandLockedMs", "My Command Lock Timer (seconds)", "number", { group: "My Bot", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("opponent.overdriveMs", "Opponent Overdrive Timer (seconds)", "number", { group: "Opponent", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("opponent.barrierMs", "Opponent Barrier Timer (seconds)", "number", { group: "Opponent", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("opponent.slowedMs", "Opponent Slow Timer (seconds)", "number", { group: "Opponent", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("opponent.jammedMs", "Opponent Jammed Timer (seconds)", "number", { group: "Opponent", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("opponent.commandLockedMs", "Opponent Command Lock Timer (seconds)", "number", { group: "Opponent", min: 0, max: 5, defaultValue: 1, suffix: "s", step: 0.1 }),
    variableDefinition("my.jammed", "I am Jammed", "boolean", { group: "My Bot" }),
    variableDefinition("my.commandLocked", "I am Command Locked", "boolean", { group: "My Bot" }),
    variableDefinition("opponent.jammed", "Opponent Jammed", "boolean", { group: "Opponent" }),
    variableDefinition("opponent.commandLocked", "Opponent Command Locked", "boolean", { group: "Opponent" }),
    variableDefinition("target.distance", "Target Distance", "number", { group: "Target", min: 0, max: 700, supportsTarget: true }),
    variableDefinition("opponent.objectDistance", "Opponent Distance to Object", "number", { group: "Objects", min: 0, max: 700, supportsTarget: true, defaultTarget: "object_1", targetGroup: "objects" }),
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
    variableDefinition("my.dashCharges", "My Dash Charges", "number", { group: "My Bot", min: 0, max: 2, ownConditionId: "my_dash_ready" }),
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
    variableDefinition("opponent.dashCharges", "Opponent Dash Charges", "number", { group: "Opponent", min: 0, max: 2, opponentConditionId: "opponent_dash_ready" }),
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
    variableDefinition("target.exists", "Target Exists", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("target.isHealthPack", "Target is Health Pack", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("target.isDamageZone", "Target is Damage Zone", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("target.isProjectileWall", "Target is Projectile Wall", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
    variableDefinition("target.isBouncyWall", "Target is Bouncy Wall", "boolean", { group: "Objects", supportsTarget: true, targetGroup: "objects" }),
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
                const typeConditions = new Set(conditions.filter((condition) => (
                    (condition.type === "target_health_pack"
                        || condition.type === "target_damage_zone"
                        || condition.type === "target_projectile_wall"
                        || condition.type === "target_bouncy_wall")
                    && (condition.target ?? "object_1") === target.id
                )).map((condition) => condition.type));
                if (typeConditions.size > 1) {
                    errors.push(`${label} requires ${target.label.toLowerCase()} to be multiple obstacle types.`);
                }
                const targetConditionTypes = new Set(conditions.filter((condition) => (
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
            validateThresholdRange(errors, conditions, label, "my_hp_gt", "my_hp_lt", "my HP");
            validateThresholdRange(errors, conditions, label, "enemy_hp_gt", "enemy_hp_lt", "opponent HP");
        }
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
    const selected = selectPriorityCandidates(normalized, state);
    const plan = { primary: selected.find((entry) => isTrainableBlock(entry.block))?.block ?? null };
    for (const { block } of selected) {
        const action = ACTION_BY_ID.get(block.action) ?? ACTION_TYPES[0];
        if (block.action.startsWith("dash") && state.player.dashAvailable && !plan.dashMovement) plan.dashMovement = block;
        if (block.action === "no_dash") plan.dash = block;
        else if (action.head === "dash" && state.player.dashAvailable && !plan.dash) plan.dash = block;
        else if (action.head !== "dash" && !plan[action.head]) plan[action.head] = block;
    }
    return plan;
}

export function evaluateCondition(condition, state) {
    if (condition?.type === "expression") {
        return evaluateExpressionCondition(condition, state);
    }
    const target = resolveMeleeStrategyTarget(state, condition.target ?? "opponent");
    const distance = target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY;
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
        case "my_jammed": return (state.player.jammedMs ?? 0) > 0;
        case "my_command_locked": return (state.player.commandLockedMs ?? 0) > 0;
        case "opponent_jammed": return (state.opponent?.jammedMs ?? 0) > 0;
        case "opponent_command_locked": return (state.opponent?.commandLockedMs ?? 0) > 0;
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
        case "my_dash_charges_lt": return state.player.dashCharges < condition.value;
        case "my_dash_charges_gt": return state.player.dashCharges > condition.value;
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
        case "opponent_dash_charges_lt": return Boolean(state.opponent) && state.opponent.dashCharges < condition.value;
        case "opponent_dash_charges_gt": return Boolean(state.opponent) && state.opponent.dashCharges > condition.value;
        case "opponent_fire_gun_ready": return Boolean(state.opponent?.gunAvailable);
        case "opponent_fire_gun_cooldown": return Boolean(state.opponent) && !state.opponent.gunAvailable;
        case "opponent_grenade_ready": return Boolean(state.opponent?.grenadeAvailable);
        case "opponent_grenade_cooldown": return Boolean(state.opponent) && !state.opponent.grenadeAvailable;
        case "opponent_fireball_ready": return Boolean(state.opponent?.fireballAvailable);
        case "opponent_fireball_cooldown": return Boolean(state.opponent) && !state.opponent.fireballAvailable;
        case "opponent_stun_ready": return Boolean(state.opponent?.stunAvailable);
        case "opponent_stun_cooldown": return Boolean(state.opponent) && !state.opponent.stunAvailable;
        case "target_exists": return Boolean(target) && condition.target !== "opponent";
        case "target_missing": return !target && condition.target !== "opponent";
        case "target_health_pack": return target?.type === "healthPack";
        case "target_damage_zone": return target?.type === "damageZone";
        case "target_projectile_wall": return target?.type === "projectileWall";
        case "target_bouncy_wall": return target?.type === "bouncyWall";
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
            !entryUsesHiddenTarget(entry, state)
            &&
            evaluateConditionList(entry.clusterConditions, state)
            && evaluateConditionList(entry.block.conditions, state)
        ))
        .sort(comparePriorityEntries);
    if (!matching.length) return [];
    const winner = matching[0];
    return matching.filter((entry) => (
        entry.clusterPriority === winner.clusterPriority
        && entry.block.priority === winner.block.priority
    ));
}

function entryUsesHiddenTarget(entry, state) {
    if ((state?.player?.jammedMs ?? 0) <= 0) return false;
    return blockUsesTarget(entry.block)
        || entry.clusterConditions.some(conditionUsesTarget)
        || entry.block.conditions.some(conditionUsesTarget);
}

function blockUsesTarget(block) {
    const action = ACTION_BY_ID.get(block?.action);
    return action ? actionSupportsTarget(action) : false;
}

function conditionUsesTarget(condition) {
    if (!condition) return false;
    if (condition.type === "expression") {
        return variableUsesHiddenTarget(condition.left)
            || (condition.right?.type === "variable" && variableUsesHiddenTarget(condition.right.value));
    }
    const definition = CONDITION_BY_ID.get(condition.type);
    return Boolean(definition?.supportsTarget)
        || condition.type?.startsWith?.("enemy_")
        || condition.type?.startsWith?.("opponent_")
        || condition.type?.startsWith?.("target_");
}

function variableUsesHiddenTarget(variableId) {
    return String(variableId).startsWith("opponent.")
        || String(variableId).startsWith("target.");
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
        dashCharges: Number.isFinite(Number(payload?.playerModel?.dashCharges)) ? Number(payload.playerModel.dashCharges) : 0,
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
        overdriveMs: Number(payload?.playerModel?.overdriveMs) || 0,
        barrierImmunityMs: Number(payload?.playerModel?.barrierImmunityMs) || 0,
        slowedMs: Number(payload?.playerModel?.slowedMs) || 0,
        jammedMs: Number(payload?.playerModel?.jammedMs) || 0,
        commandLockedMs: Number(payload?.playerModel?.commandLockedMs) || 0,
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
            dashCharges: Number.isFinite(Number(opponent.dashCharges)) ? Number(opponent.dashCharges) : 0,
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
            overdriveMs: Number(opponent.overdriveMs) || 0,
            barrierImmunityMs: Number(opponent.barrierImmunityMs) || 0,
            slowedMs: Number(opponent.slowedMs) || 0,
            jammedMs: Number(opponent.jammedMs) || 0,
            commandLockedMs: Number(opponent.commandLockedMs) || 0,
            velocityX: opponent.velocityX ?? 0,
            velocityY: opponent.velocityY ?? 0,
        } : null,
        objects,
        obstacles: strategyObstacleTargets(objects),
    };
}

function strategyObstacleTargets(objects = []) {
    return objects.filter((object) => (
        object?.type === "healthPack"
        || object?.type === "damageZone"
        || object?.type === "projectileWall"
        || object?.type === "bouncyWall"
        || object?.type === "overdrive"
        || object?.type === "barrier"
        || object?.type === "inhibition"
        || object?.type === "radarJammer"
        || object?.type === "commandLock"
    ));
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
    if (targetGroup === "objects" && !String(target).startsWith("object_") && target !== "opponent_grenade" && target !== "opponent_fireball") return fallback;
    return target;
}

function validateThresholdRange(errors, conditions, blockLabel, lowerType, upperType, label) {
    const lower = conditions.find((condition) => condition.type === lowerType)?.value;
    const upper = conditions.find((condition) => condition.type === upperType)?.value;
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
    const target = resolveMeleeStrategyTarget(state, condition.target ?? "opponent");
    switch (variableId) {
        case "my.hp": return state.player.hp;
        case "my.x": return state.player.x ?? 0;
        case "my.y": return state.player.y ?? 0;
        case "opponent.hp": return state.opponent?.hp ?? 0;
        case "opponent.x": return state.opponent?.x ?? 0;
        case "opponent.y": return state.opponent?.y ?? 0;
        case "my.overdriveMs": return millisecondsToSeconds(state.player.overdriveMs);
        case "my.barrierMs": return millisecondsToSeconds(state.player.barrierImmunityMs);
        case "my.slowedMs": return millisecondsToSeconds(state.player.slowedMs);
        case "my.jammedMs": return millisecondsToSeconds(state.player.jammedMs);
        case "my.commandLockedMs": return millisecondsToSeconds(state.player.commandLockedMs);
        case "opponent.overdriveMs": return millisecondsToSeconds(state.opponent?.overdriveMs);
        case "opponent.barrierMs": return millisecondsToSeconds(state.opponent?.barrierImmunityMs);
        case "opponent.slowedMs": return millisecondsToSeconds(state.opponent?.slowedMs);
        case "opponent.jammedMs": return millisecondsToSeconds(state.opponent?.jammedMs);
        case "opponent.commandLockedMs": return millisecondsToSeconds(state.opponent?.commandLockedMs);
        case "my.jammed": return (state.player.jammedMs ?? 0) > 0;
        case "my.commandLocked": return (state.player.commandLockedMs ?? 0) > 0;
        case "opponent.jammed": return (state.opponent?.jammedMs ?? 0) > 0;
        case "opponent.commandLocked": return (state.opponent?.commandLockedMs ?? 0) > 0;
        case "target.distance": return target ? distanceBetween(state.player, target) : Number.POSITIVE_INFINITY;
        case "opponent.objectDistance":
            return condition.target?.startsWith("object_") && target && state.opponent
                ? distanceBetween(state.opponent, target)
                : Number.POSITIVE_INFINITY;
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
        case "my.dashCharges": return state.player.dashCharges ?? 0;
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
        case "opponent.dashCharges": return state.opponent?.dashCharges ?? 0;
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
        case "target.exists": return Boolean(target) && condition.target !== "opponent";
        case "target.isHealthPack": return target?.type === "healthPack";
        case "target.isDamageZone": return target?.type === "damageZone";
        case "target.isProjectileWall": return target?.type === "projectileWall";
        case "target.isBouncyWall": return target?.type === "bouncyWall";
        case "my.insideDamageZone": return state.obstacles.some((obstacle) => (
            obstacle.type === "damageZone" && distanceBetween(state.player, obstacle) <= (state.player.size + obstacle.size) / 2
        ));
        default: return null;
    }
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

export function resolveMeleeStrategyTarget(state, target) {
    if ((state?.player?.jammedMs ?? 0) > 0) return null;
    if (target === "opponent") return state?.opponent ?? null;
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
    return [
        ...(state?.obstacles ?? []),
        ...(state?.objects ?? []),
    ].find((obstacle) => obstacle?.id === target) ?? null;
}
