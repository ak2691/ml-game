import {
    BLOCK_RECHARGE_MS,
    DASH_MAX_CHARGES,
    MELEE_HP,
} from "../classes/MeleeClass.jsx";
import { RANGED_AMMO_MAX } from "../classes/RangedClass.jsx";
import { FIREBALL_CHARGES_MAX } from "../classes/MageClass.jsx";
import { combatClassConfig } from "../classes/CombatClasses.js";

export function buildStatePayload(currentShapes, selectedClass, actorId = "main") {
    const main = currentShapes.find((shape) => shape.id === actorId);
    return {
        selectedClass,
        playerModel: fighterPayload(main, selectedClass),
        objects: currentShapes
            .filter((shape) => shape.id !== actorId)
            .map((shape) => objectPayload(shape, actorId)),
    };
}

function fighterPayload(shape, selectedClass) {
    const combatClass = shape.combatClass ?? selectedClass;
    return {
        x: Math.round(shape.x),
        y: Math.round(shape.y),
        rotation: Math.round(shape.rotation ?? 0),
        swingAvailable: (shape.swingCooldownMs ?? 0) <= 0,
        swingCooldownRemainingMs: Math.round(shape.swingCooldownMs ?? 0),
        blockAvailable: (shape.blockCharges ?? 0) > 0,
        blockActive: (shape.blockActiveMs ?? 0) > 0,
        blockActiveRemainingMs: (shape.blockActiveMs ?? 0) > 0 ? 1 : 0,
        blockCooldownRemainingMs: rechargeRemainingMs(shape),
        blockCharges: shape.blockCharges ?? 0,
        combatClass,
        gunAvailable: gunAvailable(shape, combatClass),
        gunActive: (shape.gunActiveMs ?? 0) > 0,
        gunCooldownRemainingMs: Math.round(shape.gunCooldownMs ?? 0),
        gunAmmo: shape.gunAmmo ?? (combatClass === "ranged" ? RANGED_AMMO_MAX : 0),
        gunReloadRemainingMs: Math.round(shape.gunReloadMs ?? 0),
        grenadeAvailable: combatClass === "ranged" && (shape.grenadeCooldownMs ?? 0) <= 0,
        grenadeCooldownRemainingMs: Math.round(shape.grenadeCooldownMs ?? 0),
        fireballAvailable: fireballAvailable(shape, combatClass),
        fireballCooldownRemainingMs: Math.round(shape.fireballCooldownMs ?? 0),
        fireballCharges: shape.fireballCharges ?? (combatClass === "mage" ? FIREBALL_CHARGES_MAX : 0),
        fireballReloadRemainingMs: Math.round(shape.fireballReloadMs ?? 0),
        stunAvailable: combatClass === "mage"
            && (shape.stunCooldownMs ?? 0) <= 0
            && (shape.stunActiveMs ?? 0) <= 0,
        stunCooldownRemainingMs: Math.round(shape.stunCooldownMs ?? 0),
        hp: shape.hp ?? MELEE_HP,
        overdriveMs: Math.round(shape.overdriveMs ?? 0),
        barrierImmunityMs: Math.round(shape.barrierImmunityMs ?? 0),
        inhibitionCharges: Math.round(shape.inhibitionCharges ?? 0),
        slowedMs: Math.round(shape.slowedMs ?? 0),
        jammedMs: Math.round(shape.jammedMs ?? 0),
        commandLockedMs: Math.round(shape.commandLockedMs ?? 0),
        size: shape.size,
        dashAvailable: dashAvailable(shape, combatClass),
        dashActive: (shape.dashActiveMs ?? 0) > 0,
        dashCooldownRemainingMs: Math.round(Math.max(shape.dashRechargeMs ?? 0, shape.dashActiveMs ?? 0)),
        dashCharges: shape.dashCharges ?? (combatClass === "melee" ? DASH_MAX_CHARGES : 0),
    };
}

function objectPayload(shape, actorId) {
    return {
        id: shape.id,
        ownerId: shape.ownerId,
        type: shape.id === "main" && actorId !== "main" ? "opponentModel" : shape.type,
        x: Math.round(shape.x),
        y: Math.round(shape.y),
        size: shape.size,
        rotation: Math.round(shape.rotation),
        combatClass: shape.combatClass,
        hp: shape.hp ?? MELEE_HP,
        overdriveMs: Math.round(shape.overdriveMs ?? 0),
        barrierImmunityMs: Math.round(shape.barrierImmunityMs ?? 0),
        inhibitionCharges: Math.round(shape.inhibitionCharges ?? 0),
        slowedMs: Math.round(shape.slowedMs ?? 0),
        jammedMs: Math.round(shape.jammedMs ?? 0),
        commandLockedMs: Math.round(shape.commandLockedMs ?? 0),
        swingActive: (shape.swingActiveMs ?? 0) > 0,
        swingAvailable: (shape.swingCooldownMs ?? 0) <= 0,
        swingCooldownRemainingMs: Math.round(shape.swingCooldownMs ?? 0),
        blockActive: (shape.blockActiveMs ?? 0) > 0,
        blockAvailable: (shape.blockCharges ?? 0) > 0,
        blockCooldownRemainingMs: rechargeRemainingMs(shape),
        blockCharges: shape.blockCharges ?? 0,
        gunActive: (shape.gunActiveMs ?? 0) > 0,
        gunAvailable: gunAvailable(shape, shape.combatClass),
        gunCooldownRemainingMs: Math.round(shape.gunCooldownMs ?? 0),
        gunAmmo: shape.gunAmmo ?? (shape.combatClass === "ranged" ? RANGED_AMMO_MAX : 0),
        gunReloadRemainingMs: Math.round(shape.gunReloadMs ?? 0),
        grenadeAvailable: shape.combatClass === "ranged" && (shape.grenadeCooldownMs ?? 0) <= 0,
        grenadeCooldownRemainingMs: Math.round(shape.grenadeCooldownMs ?? 0),
        fireballAvailable: fireballAvailable(shape, shape.combatClass),
        fireballCooldownRemainingMs: Math.round(shape.fireballCooldownMs ?? 0),
        fireballCharges: shape.fireballCharges ?? (shape.combatClass === "mage" ? FIREBALL_CHARGES_MAX : 0),
        fireballReloadRemainingMs: Math.round(shape.fireballReloadMs ?? 0),
        stunAvailable: shape.combatClass === "mage"
            && (shape.stunCooldownMs ?? 0) <= 0
            && (shape.stunActiveMs ?? 0) <= 0,
        stunCooldownRemainingMs: Math.round(shape.stunCooldownMs ?? 0),
        dashActive: (shape.dashActiveMs ?? 0) > 0,
        dashAvailable: dashAvailable(shape, shape.combatClass),
        dashCooldownRemainingMs: Math.round(Math.max(shape.dashRechargeMs ?? 0, shape.dashActiveMs ?? 0)),
        dashCharges: shape.dashCharges ?? (shape.combatClass === "melee" ? DASH_MAX_CHARGES : 0),
        velocityX: shape.velocityX ?? 0,
        velocityY: shape.velocityY ?? 0,
    };
}

function rechargeRemainingMs(shape) {
    return Math.max(0, BLOCK_RECHARGE_MS - Math.round(shape.blockRechargeMs ?? shape.blockCooldownMs ?? 0));
}

function gunAvailable(shape, combatClass) {
    return combatClass === "ranged"
        && (shape.gunAmmo ?? RANGED_AMMO_MAX) > 0
        && (shape.gunReloadMs ?? 0) <= 0
        && (shape.gunCooldownMs ?? 0) <= 0
        && (shape.gunActiveMs ?? 0) <= 0;
}

function fireballAvailable(shape, combatClass) {
    return combatClass === "mage"
        && (shape.fireballCharges ?? FIREBALL_CHARGES_MAX) > 0
        && (shape.fireballReloadMs ?? 0) <= 0
        && (shape.fireballCooldownMs ?? 0) <= 0
        && (shape.fireballActiveMs ?? 0) <= 0;
}

function dashAvailable(shape, combatClass) {
    return combatClassConfig(combatClass).actionIds.includes("dash")
        && (shape.dashCharges ?? 0) > 0
        && (shape.dashActiveMs ?? 0) <= 0;
}
