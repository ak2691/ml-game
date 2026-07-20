import {
    BLOCK_MAX_CHARGES,
    BLOCK_RECHARGE_MS,
    FIREBALL_BURN_DAMAGE,
    FIREBALL_BURN_TICK_MS,
    FIREBALL_CHARGES_MAX,
    RANGED_AMMO_MAX,
} from "../combat/Moves.js";
import { PROTOTYPE_ABILITY_STATS } from "../loadout/BotLoadout.js";

/** Advances cooldown, resource, timed-effect, and delayed-state components. */
export function tickFighterStatus(shape, elapsedMs, applyDamage) {
    if ((shape.hp ?? 0) <= 0) {
        return { ...shape, hp: 0, hitFlashMs: Math.max(0, Number(shape.hitFlashMs ?? 0) - elapsedMs) };
    }
    const blockRecharge = rechargeBlockCharges(shape, elapsedMs);
    const abilityCooldowns = mapTimers(shape.abilityCooldowns, elapsedMs);
    const abilityActiveMs = mapTimers(shape.abilityActiveMs, elapsedMs);
    const quickJabComboMs = Math.max(0, Number(shape.quickJabComboMs ?? 0) - elapsedMs);
    const shockRemainingMs = Math.max(0, Number(shape.shockRemainingMs ?? 0) - elapsedMs);
    const shockElapsed = Number(shape.shockTickElapsedMs ?? 0) + (Number(shape.shockRemainingMs ?? 0) > 0 ? elapsedMs : 0);
    const shockInterval = Number(PROTOTYPE_ABILITY_STATS.rail_shot.shockTickMs ?? 1000);
    const shockTicked = Number(shape.shockRemainingMs ?? 0) > 0 && shockElapsed >= shockInterval;
    const burnTick = tickBurn(shape, elapsedMs, applyDamage);
    const bleedTick = tickBleed({ ...shape, ...burnTick }, elapsedMs, applyDamage);
    const rewindWasPending = Number(shape.temporalRewindMs ?? 0) > 0;
    const temporalRewindMs = Math.max(0, Number(shape.temporalRewindMs ?? 0) - elapsedMs);
    const rewindCompletes = rewindWasPending && temporalRewindMs <= 0;
    const temporalRewindPulseMs = rewindCompletes ? 400 : timer(shape.temporalRewindPulseMs, elapsedMs);
    const statusHp = shockTicked
        ? Math.max(0, Number(bleedTick.hp ?? shape.hp ?? 0) - Number(PROTOTYPE_ABILITY_STATS.rail_shot.shockDamage ?? 3))
        : bleedTick.hp;
    return {
        ...shape,
        hitFlashMs: timer(shape.hitFlashMs, elapsedMs),
        slowedMs: timer(shape.slowedMs, elapsedMs),
        silencedMs: timer(shape.silencedMs, elapsedMs),
        movementLockMs: Math.max(shockTicked ? Number(PROTOTYPE_ABILITY_STATS.rail_shot.movementLockMs ?? 300) : 0, timer(shape.movementLockMs, elapsedMs)),
        shockRemainingMs,
        shockTickElapsedMs: shockTicked ? shockElapsed - shockInterval : shockElapsed,
        swingCooldownMs: timer(shape.swingCooldownMs, elapsedMs),
        swingActiveMs: timer(shape.swingActiveMs, elapsedMs),
        swingTriggered: false,
        blockCooldownMs: timer(shape.blockCooldownMs, elapsedMs),
        blockActiveMs: 0,
        blockCharges: blockRecharge.charges,
        blockRechargeMs: blockRecharge.rechargeMs,
        gunCooldownMs: timer(shape.gunCooldownMs, elapsedMs),
        gunActiveMs: timer(shape.gunActiveMs, elapsedMs),
        gunShotActive: false,
        ...tickGunReload(shape, elapsedMs),
        grenadeCooldownMs: timer(shape.grenadeCooldownMs, elapsedMs),
        thrownGrenade: null,
        fireballCooldownMs: timer(shape.fireballCooldownMs, elapsedMs),
        fireballActiveMs: timer(shape.fireballActiveMs, elapsedMs),
        ...tickFireballReload(shape, elapsedMs),
        thrownFireball: null,
        stunCooldownMs: timer(shape.stunCooldownMs, elapsedMs),
        stunActiveMs: timer(shape.stunActiveMs, elapsedMs),
        stunnedMs: timer(shape.stunnedMs, elapsedMs),
        stunCastActive: false,
        ...burnTick,
        ...bleedTick,
        x: rewindCompletes ? Number(shape.temporalRewindX ?? shape.x) : shape.x,
        y: rewindCompletes ? Number(shape.temporalRewindY ?? shape.y) : shape.y,
        hp: rewindCompletes ? Math.min(Number(shape.maxHp ?? 100), Number(shape.temporalRewindHp ?? statusHp)) : statusHp,
        temporalRewindMs,
        temporalRewindPulseMs,
        temporalRewindX: rewindCompletes ? null : shape.temporalRewindX,
        temporalRewindY: rewindCompletes ? null : shape.temporalRewindY,
        temporalRewindHp: rewindCompletes ? null : shape.temporalRewindHp,
        temporalRewindVisualX: temporalRewindMs > 0 || temporalRewindPulseMs > 0 ? shape.temporalRewindVisualX : null,
        temporalRewindVisualY: temporalRewindMs > 0 || temporalRewindPulseMs > 0 ? shape.temporalRewindVisualY : null,
        dashCooldownMs: timer(shape.dashCooldownMs, elapsedMs),
        dashActiveMs: timer(shape.dashActiveMs, elapsedMs),
        microDashActiveMs: timer(shape.microDashActiveMs, elapsedMs),
        microDashTrailMs: timer(shape.microDashTrailMs, elapsedMs),
        abilityCooldowns,
        abilityActiveMs,
        prototypeVisual: shape.prototypeVisual ? { ...shape.prototypeVisual, ms: timer(shape.prototypeVisual.ms, elapsedMs) } : null,
        prototypeTriggered: null,
        quickJabComboMs,
        quickJabComboCount: quickJabComboMs > 0 ? Number(shape.quickJabComboCount ?? 0) : 0,
        entityHitIds: [],
    };
}

function tickGunReload(shape, elapsedMs) {
    if (!hasAbility(shape, "fire_gun")) return { gunAmmo: 0, gunReloadMs: 0 };
    const ammo = Math.max(0, Math.min(RANGED_AMMO_MAX, Math.round(Number(shape.gunAmmo ?? RANGED_AMMO_MAX))));
    const reloadMs = timer(shape.gunReloadMs, elapsedMs);
    return ammo <= 0 && reloadMs <= 0
        ? { gunAmmo: RANGED_AMMO_MAX, gunReloadMs: 0 }
        : { gunAmmo: ammo, gunReloadMs: reloadMs };
}

function tickFireballReload(shape, elapsedMs) {
    if (!hasAbility(shape, "shoot_fireball")) return { fireballCharges: 0, fireballReloadMs: 0 };
    const charges = Math.max(0, Math.min(FIREBALL_CHARGES_MAX, Math.round(Number(shape.fireballCharges ?? FIREBALL_CHARGES_MAX))));
    const reloadMs = timer(shape.fireballReloadMs, elapsedMs);
    return charges <= 0 && reloadMs <= 0
        ? { fireballCharges: FIREBALL_CHARGES_MAX, fireballReloadMs: 0 }
        : { fireballCharges: charges, fireballReloadMs: reloadMs };
}

function tickBurn(shape, elapsedMs, applyDamage) {
    const previousRemainingMs = Math.max(0, Number(shape.burnRemainingMs ?? 0));
    const remainingMs = timer(previousRemainingMs, elapsedMs);
    let nextTickDueMs = Math.max(0, Number(shape.burnTickMs ?? 0));
    let hp = shape.hp;
    const activeElapsedMs = Math.min(elapsedMs, previousRemainingMs);
    while (previousRemainingMs > 0 && nextTickDueMs <= activeElapsedMs) {
        const damaged = applyDamage({ ...shape, hp }, FIREBALL_BURN_DAMAGE * (shape.burnDamageMultiplier ?? 1));
        hp = damaged.hp;
        nextTickDueMs += FIREBALL_BURN_TICK_MS;
    }
    const tickMs = remainingMs > 0 ? Math.max(0, nextTickDueMs - elapsedMs) : 0;
    return { hp, burnRemainingMs: remainingMs, burnTickMs: tickMs, burnDamageMultiplier: remainingMs > 0 ? shape.burnDamageMultiplier ?? 1 : 1 };
}

function tickBleed(shape, elapsedMs, applyDamage) {
    const previousRemainingMs = Math.max(0, Number(shape.bleedRemainingMs ?? 0));
    const remainingMs = timer(previousRemainingMs, elapsedMs);
    let nextTickDueMs = Math.max(0, Number(shape.bleedTickMs ?? 0));
    let hp = shape.hp;
    const activeElapsedMs = Math.min(elapsedMs, previousRemainingMs);
    while (previousRemainingMs > 0 && nextTickDueMs <= activeElapsedMs) {
        const damaged = applyDamage({ ...shape, hp }, Number(shape.bleedDamage ?? 2));
        hp = damaged.hp;
        nextTickDueMs += 1000;
    }
    const tickMs = remainingMs > 0 ? Math.max(0, nextTickDueMs - elapsedMs) : 0;
    return { hp, bleedRemainingMs: remainingMs, bleedTickMs: tickMs, bleedDamage: remainingMs > 0 ? Number(shape.bleedDamage ?? 2) : 0 };
}

function rechargeBlockCharges(shape, elapsedMs) {
    if (!hasAbility(shape, "block")) return { charges: 0, rechargeMs: 0 };
    let charges = Math.max(0, Math.min(BLOCK_MAX_CHARGES, Math.round(Number(shape.blockCharges ?? BLOCK_MAX_CHARGES))));
    let rechargeMs = Math.max(0, Number(shape.blockRechargeMs ?? shape.blockCooldownMs ?? 0));
    if (charges >= BLOCK_MAX_CHARGES) return { charges: BLOCK_MAX_CHARGES, rechargeMs: 0 };
    rechargeMs += elapsedMs;
    while (charges < BLOCK_MAX_CHARGES && rechargeMs >= BLOCK_RECHARGE_MS) {
        charges += 1;
        rechargeMs -= BLOCK_RECHARGE_MS;
    }
    return { charges, rechargeMs: charges >= BLOCK_MAX_CHARGES ? 0 : rechargeMs };
}

function mapTimers(values, elapsedMs) {
    return Object.fromEntries(Object.entries(values ?? {}).map(([id, value]) => [id, timer(value, elapsedMs)]));
}

function timer(value, elapsedMs) {
    return Math.max(0, Number(value ?? 0) - elapsedMs);
}

function hasAbility(shape, ability) {
    return Array.isArray(shape?.abilities) && shape.abilities.includes(ability);
}
