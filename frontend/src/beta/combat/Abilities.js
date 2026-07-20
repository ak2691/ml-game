export const ABILITY_STATS = Object.freeze({
    throw_grenade: { cooldownMs: 12000, explosionRadius: 70 },
    stun: { cooldownMs: 10000, windupMs: 400, damage: 5, durationMs: 1200, range: 184 },
    heavy_slash: { cooldownMs: 5000, windupMs: 300, visualMs: 400, damage: 30, range: 92, bleedDamage: 2, bleedTickMs: 1000, bleedDurationMs: 5000 },
    repulsor_burst: { cooldownMs: 8000, damage: 20, radius: 110, knockback: 250 },
    concussive_shot: { cooldownMs: 7000, windupMs: 500, damage: 8, range: 500, projectile: true },
    repair_pulse: { cooldownMs: 12000, windupMs: 800, healing: 15 },
    proximity_mine: { cooldownMs: 10000, entity: "mine", maxCharges: 1, damage: 18, radius: 70 },
    rail_shot: { cooldownMs: 11000, windupMs: 900, damage: 40, shockDamage: 3, shockDurationMs: 3000, shockTickMs: 1000, movementLockMs: 300, range: 900, beam: true },
    gravity_grenade: { cooldownMs: 13000, entity: "gravity_field", maxDamage: 35, minDamage: 20, damageStep: 5, radius: 120, durationMs: 2000 },
    silence_pulse: { cooldownMs: 12000, windupMs: 1000, durationMs: 2000, interruptMs: 100, waveSpeedPerTick: 150 },
    reactive_armor: { cooldownMs: 13000, durationMs: 4000, maxCharges: 3 },
    hunter_drone: { cooldownMs: 14000, entity: "hunter_drone", durationMs: 6000, maxCharges: 1, range: 200, shotCooldownMs: 1000, damage: 3 },
    temporal_rewind: { cooldownMs: 18000, delayMs: 3000 },
    orbital_strike: { cooldownMs: 18000, delayMs: 1500, entity: "orbital_marker", damage: 50, radius: 130 },
    absolute_guard: { cooldownMs: 17000, durationMs: 1500 },
    null_zone: { cooldownMs: 18000, windupMs: 1500, entity: "null_zone", durationMs: 5000, radius: 150 },
});

export const GRENADE_COOLDOWN_MS = ABILITY_STATS.throw_grenade.cooldownMs;
export const GRENADE_EXPLOSION_RADIUS = ABILITY_STATS.throw_grenade.explosionRadius;
export const STUN_COOLDOWN_MS = ABILITY_STATS.stun.cooldownMs;
export const STUN_ACTIVE_MS = ABILITY_STATS.stun.windupMs;
export const STUN_DAMAGE = ABILITY_STATS.stun.damage;
export const STUN_DURATION_MS = ABILITY_STATS.stun.durationMs;
export const STUN_RANGE = ABILITY_STATS.stun.range;
