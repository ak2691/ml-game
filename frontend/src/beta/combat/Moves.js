export const MOVE_STATS = Object.freeze({
    swing: { damage: 20, cooldownMs: 1000, activeMs: 400, range: 92, arcDegrees: 100 },
    block: { maxCharges: 5, rechargeMs: 5000, coverageDegrees: 180 },
    dash: { cooldownMs: 4500, durationMs: 1000, distance: 400 },
    fire_gun: { ammoMax: 10, reloadMs: 3000, cooldownMs: 1000, activeMs: 1000, range: 700 },
    shoot_fireball: { maxCharges: 4, reloadMs: 3000, cooldownMs: Math.round(60_000 / 90), range: 400, size: 30, speed: 36, damage: 15, burnDamage: 2, burnTickMs: 1000, burnDurationMs: 5000 },
    quick_jab: { cooldownMs: 450, damage: 8, maxComboDamage: 15, comboWindowMs: 1000, range: 75 },
    pistol_shot: { cooldownMs: 700, damage: 8, range: 500, falloffDamage: [8, 6, 4] },
    thrust: { cooldownMs: 1000, damage: 15, range: 110, knockback: 30 },
    micro_dash: { cooldownMs: 1500, distance: 150, durationMs: 200, speedPerTick: 75 },
    phase_strike: { cooldownMs: 1800, damage: 14, range: 160, passThroughDistance: 50 },
});

export const SWING_COOLDOWN_MS = MOVE_STATS.swing.cooldownMs;
export const MELEE_DAMAGE = MOVE_STATS.swing.damage;
export const SWING_ACTIVE_MS = MOVE_STATS.swing.activeMs;
export const BLOCK_MAX_CHARGES = MOVE_STATS.block.maxCharges;
export const BLOCK_RECHARGE_MS = MOVE_STATS.block.rechargeMs;
export const DASH_COOLDOWN_MS = MOVE_STATS.dash.cooldownMs;
export const RANGED_AMMO_MAX = MOVE_STATS.fire_gun.ammoMax;
export const RANGED_RELOAD_MS = MOVE_STATS.fire_gun.reloadMs;
export const GUN_COOLDOWN_MS = MOVE_STATS.fire_gun.cooldownMs;
export const GUN_ACTIVE_MS = MOVE_STATS.fire_gun.activeMs;
export const GUN_RANGE = MOVE_STATS.fire_gun.range;
export const FIREBALL_CHARGES_MAX = MOVE_STATS.shoot_fireball.maxCharges;
export const FIREBALL_RELOAD_MS = MOVE_STATS.shoot_fireball.reloadMs;
export const FIREBALL_COOLDOWN_MS = MOVE_STATS.shoot_fireball.cooldownMs;
export const FIREBALL_ACTIVE_MS = MOVE_STATS.shoot_fireball.cooldownMs;
export const FIREBALL_RANGE = MOVE_STATS.shoot_fireball.range;
export const FIREBALL_SIZE = MOVE_STATS.shoot_fireball.size;
export const FIREBALL_SPEED = MOVE_STATS.shoot_fireball.speed;
export const FIREBALL_DAMAGE = MOVE_STATS.shoot_fireball.damage;
export const FIREBALL_BURN_DAMAGE = MOVE_STATS.shoot_fireball.burnDamage;
export const FIREBALL_BURN_TICK_MS = MOVE_STATS.shoot_fireball.burnTickMs;
export const FIREBALL_BURN_DURATION_MS = MOVE_STATS.shoot_fireball.burnDurationMs;

export const BASE_FIGHTER_HP = 100;
export const BASE_MOVE_SPEED = 8;

export const RANGED_DAMAGE_FALLOFF = Object.freeze([
    { distance: 100, damage: 15 }, { distance: 300, damage: 10 },
    { distance: 500, damage: 5 }, { distance: 700, damage: 2 },
]);

export const GRENADE_SIZE = 12;
export const GRENADE_THROW_SPEED = 32;
export const GRENADE_DECELERATION_PER_TICK = 1.6;
export const GRENADE_STOP_FUSE_MS = 1000;
