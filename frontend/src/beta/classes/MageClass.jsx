export const MAGE_HP = 100;
export const MAGE_MOVE_SPEED = 10;
export const FIREBALL_CHARGES_MAX = 4;
export const FIREBALL_RELOAD_MS = 1_000;
export const FIREBALL_COOLDOWN_MS = Math.round(60_000 / 90);
export const FIREBALL_ACTIVE_MS = FIREBALL_COOLDOWN_MS;
export const FIREBALL_RANGE = 400;
export const FIREBALL_SIZE = 30;
export const FIREBALL_SPEED = 36;
export const FIREBALL_DAMAGE = 15;
export const FIREBALL_BURN_DAMAGE = 2;
export const FIREBALL_BURN_TICK_MS = 1_000;
export const FIREBALL_BURN_DURATION_MS = 5_000;
export const STUN_COOLDOWN_MS = 10_000;
export const STUN_ACTIVE_MS = 200;
export const STUN_DAMAGE = 10;
export const STUN_DURATION_MS = 1_500;
export const STUN_RANGE = 184;

export const MAGE_CLASS = Object.freeze({
    id: "mage",
    label: "MAGE",
    hp: MAGE_HP,
    moveSpeed: MAGE_MOVE_SPEED,
    actionIds: Object.freeze(["shoot_fireball", "stun"]),
    ownConditionIds: Object.freeze([
        "my_fireball_ready",
        "my_fireball_cooldown",
        "my_stun_ready",
        "my_stun_cooldown",
    ]),
    opponentConditionIds: Object.freeze([
        "opponent_fireball_ready",
        "opponent_fireball_cooldown",
        "opponent_stun_ready",
        "opponent_stun_cooldown",
    ]),
});
