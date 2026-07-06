export const RANGED_HP = 100;
export const RANGED_AMMO_MAX = 10;
export const RANGED_RELOAD_MS = 3_000;
export const GUN_COOLDOWN_MS = Math.round(60_000 / 60);
export const GUN_ACTIVE_MS = GUN_COOLDOWN_MS;
export const GUN_RANGE = 700;
export const GRENADE_COOLDOWN_MS = 12_000;
export const GRENADE_SIZE = 12;
export const GRENADE_THROW_SPEED = 32;
export const GRENADE_DECELERATION_PER_TICK = 1.6;
export const GRENADE_STOP_FUSE_MS = 1_000;
export const GRENADE_EXPLOSION_RADIUS = 50;
export const RANGED_MOVE_SPEED = 8;

export const RANGED_DAMAGE_FALLOFF = Object.freeze([
    { distance: 100, damage: 15 },
    { distance: 300, damage: 10 },
    { distance: 500, damage: 5 },
    { distance: 700, damage: 2 },
]);

export const RANGED_CLASS = Object.freeze({
    id: "ranged",
    label: "RANGED",
    hp: RANGED_HP,
    moveSpeed: RANGED_MOVE_SPEED,
    actionIds: Object.freeze(["fire_gun", "throw_grenade"]),
    ownConditionIds: Object.freeze([
        "my_fire_gun_ready",
        "my_fire_gun_cooldown",
        "my_grenade_ready",
        "my_grenade_cooldown",
    ]),
    opponentConditionIds: Object.freeze([
        "opponent_fire_gun_ready",
        "opponent_fire_gun_cooldown",
        "opponent_grenade_ready",
        "opponent_grenade_cooldown",
    ]),
});
