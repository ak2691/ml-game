import { ABILITY_STATS } from "./Abilities.js";
import { MOVE_STATS } from "./Moves.js";

export const EFFECT_TYPES = Object.freeze({
    DAMAGE: "damage",
    HEALING: "healing",
    KNOCKBACK: "knockback",
    PULL: "pull",
    DEBUFF: "debuff",
    INTERRUPT: "interrupt",
    MOVEMENT: "movement",
    TELEPORT: "teleport",
    RESTORE_STATE: "restore_state",
    DAMAGE_REDUCTION: "damage_reduction",
    DAMAGE_IMMUNITY: "damage_immunity",
    DAMAGE_REFLECTION: "damage_reflection",
    SPAWN_ENTITY: "spawn_entity",
});

export const DELIVERY_TYPES = Object.freeze({
    SELF: "self",
    MELEE: "melee",
    RAY: "ray",
    PROJECTILE: "projectile",
    RADIAL: "radial",
    FIELD: "field",
    TRAP: "trap",
    SUMMON: "summon",
    TELEPORT: "teleport",
});

export const SHIELD_MODES = Object.freeze({
    BLOCK: "block",
    IGNORE: "ignore",
    DRAIN_WHILE_ACTIVE: "drain_while_active",
});

export const SHIELD_CHARGE_COSTS = Object.freeze({ ONE: 1, ALL: "all", DISTANCE_SCALED: "distance_scaled" });

const effect = (type, values = {}) => Object.freeze({ type, ...values });
const block = (prevents, values = {}) => Object.freeze({
    mode: SHIELD_MODES.BLOCK,
    halfArcDegrees: 95,
    chargeCost: SHIELD_CHARGE_COSTS.ONE,
    prevents: Object.freeze([...prevents]),
    ...values,
});
const ignore = Object.freeze({ mode: SHIELD_MODES.IGNORE, prevents: Object.freeze([]) });
const drainWhileActive = Object.freeze({ mode: SHIELD_MODES.DRAIN_WHILE_ACTIVE, chargeCost: SHIELD_CHARGE_COSTS.ALL, prevents: Object.freeze([]) });

const A = ABILITY_STATS;
const M = MOVE_STATS;

/**
 * Canonical browser combat metadata. Delivery controls how an effect reaches a
 * target; effects control game-state changes; shieldInteraction filters those
 * effects. Visuals intentionally live outside this catalog.
 */
export const ABILITY_CONTRACTS = Object.freeze({
    swing: contract(DELIVERY_TYPES.MELEE, [effect(EFFECT_TYPES.DAMAGE, { amount: M.swing.damage })], block([EFFECT_TYPES.DAMAGE])),
    block: contract(DELIVERY_TYPES.SELF, [], ignore),
    dash: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.MOVEMENT, { distance: M.dash.distance })], ignore),
    fire_gun: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { falloff: true })], block([EFFECT_TYPES.DAMAGE])),
    throw_grenade: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "grenade" })], block([EFFECT_TYPES.DAMAGE], { halfArcDegrees: 180, chargeCost: SHIELD_CHARGE_COSTS.DISTANCE_SCALED })),
    shoot_fireball: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DAMAGE, { amount: M.shoot_fireball.damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "burn", durationMs: M.shoot_fireball.burnDurationMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "fireball" })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF])),
    stun: contract(DELIVERY_TYPES.MELEE, [effect(EFFECT_TYPES.DAMAGE, { amount: A.stun.damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "stun", durationMs: A.stun.durationMs })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF])),
    heavy_slash: contract(DELIVERY_TYPES.MELEE, [effect(EFFECT_TYPES.DAMAGE, { amount: A.heavy_slash.damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "bleed", durationMs: A.heavy_slash.bleedDurationMs })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF], { chargeCost: SHIELD_CHARGE_COSTS.ALL })),
    repulsor_burst: contract(DELIVERY_TYPES.RADIAL, [effect(EFFECT_TYPES.DAMAGE, { amount: A.repulsor_burst.damage }), effect(EFFECT_TYPES.KNOCKBACK, { distance: A.repulsor_burst.knockback })], block([EFFECT_TYPES.DAMAGE])),
    concussive_shot: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { amount: A.concussive_shot.damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "slow", durationMs: 2000 })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF])),
    repair_pulse: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.HEALING, { amount: A.repair_pulse.healing })], ignore),
    proximity_mine: contract(DELIVERY_TYPES.TRAP, [effect(EFFECT_TYPES.DAMAGE, { amount: A.proximity_mine.damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "proximity_mine" })], block([EFFECT_TYPES.DAMAGE], { halfArcDegrees: 45, chargeCost: SHIELD_CHARGE_COSTS.ALL })),
    quick_jab: contract(DELIVERY_TYPES.MELEE, [effect(EFFECT_TYPES.DAMAGE, { amount: A.quick_jab?.damage ?? M.quick_jab.damage })], block([EFFECT_TYPES.DAMAGE])),
    pistol_shot: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { falloff: true })], block([EFFECT_TYPES.DAMAGE])),
    rail_shot: contract(DELIVERY_TYPES.RAY, [effect(EFFECT_TYPES.DAMAGE, { amount: A.rail_shot.damage }), effect(EFFECT_TYPES.DEBUFF, { debuff: "shock", durationMs: A.rail_shot.shockDurationMs })], block([EFFECT_TYPES.DAMAGE, EFFECT_TYPES.DEBUFF])),
    gravity_grenade: contract(DELIVERY_TYPES.FIELD, [effect(EFFECT_TYPES.PULL, { perTick: 6 }), effect(EFFECT_TYPES.DAMAGE, { falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "gravity_field" })], block([EFFECT_TYPES.DAMAGE], { halfArcDegrees: 45, chargeCost: SHIELD_CHARGE_COSTS.ALL })),
    silence_pulse: contract(DELIVERY_TYPES.PROJECTILE, [effect(EFFECT_TYPES.DEBUFF, { debuff: "silence", durationMs: A.silence_pulse.durationMs }), effect(EFFECT_TYPES.INTERRUPT, { durationMs: A.silence_pulse.interruptMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "silence_wave" })], block([EFFECT_TYPES.DEBUFF, EFFECT_TYPES.INTERRUPT])),
    reactive_armor: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.DAMAGE_REDUCTION, { multiplier: 0.5 }), effect(EFFECT_TYPES.DAMAGE_REFLECTION, { multiplier: 0.5 })], ignore),
    hunter_drone: contract(DELIVERY_TYPES.SUMMON, [effect(EFFECT_TYPES.DAMAGE, { amount: A.hunter_drone.damage }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "hunter_drone" })], block([EFFECT_TYPES.DAMAGE])),
    thrust: contract(DELIVERY_TYPES.MELEE, [effect(EFFECT_TYPES.DAMAGE, { amount: M.thrust.damage }), effect(EFFECT_TYPES.KNOCKBACK, { distance: M.thrust.knockback })], ignore),
    micro_dash: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.MOVEMENT, { distance: M.micro_dash.distance })], ignore),
    temporal_rewind: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.RESTORE_STATE, { delayMs: A.temporal_rewind.delayMs }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "temporal_rewind_zone" })], ignore),
    orbital_strike: contract(DELIVERY_TYPES.FIELD, [effect(EFFECT_TYPES.DAMAGE, { amount: A.orbital_strike.damage, falloff: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "orbital_zone" })], drainWhileActive),
    absolute_guard: contract(DELIVERY_TYPES.SELF, [effect(EFFECT_TYPES.DAMAGE_IMMUNITY, { durationMs: A.absolute_guard.durationMs })], ignore),
    null_zone: contract(DELIVERY_TYPES.FIELD, [effect(EFFECT_TYPES.DEBUFF, { debuff: "silence", whileInside: true }), effect(EFFECT_TYPES.SPAWN_ENTITY, { entityType: "null_zone" })], ignore),
    phase_strike: contract(DELIVERY_TYPES.TELEPORT, [effect(EFFECT_TYPES.TELEPORT, { passThroughDistance: M.phase_strike.passThroughDistance }), effect(EFFECT_TYPES.DAMAGE, { amount: M.phase_strike.damage })], ignore),
});

function contract(deliveryType, effects, shieldInteraction) {
    return Object.freeze({
        delivery: Object.freeze({ type: deliveryType }),
        effects: Object.freeze(effects),
        shieldInteraction,
    });
}

export function abilityContract(abilityId) {
    return ABILITY_CONTRACTS[abilityId] ?? null;
}

export function hasEffect(abilityId, effectType) {
    return Boolean(abilityContract(abilityId)?.effects.some(({ type }) => type === effectType));
}
