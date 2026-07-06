export const MELEE_HP = 100;
export const MELEE_DAMAGE = 20;
export const SWING_COOLDOWN_MS = 1000;
export const SWING_ACTIVE_MS = 200;
export const BLOCK_MAX_CHARGES = 5;
export const BLOCK_RECHARGE_MS = 3000;
export const MELEE_MOVE_SPEED = 12;

export const MELEE_CLASS = Object.freeze({
    id: "melee",
    label: "MELEE",
    hp: MELEE_HP,
    moveSpeed: MELEE_MOVE_SPEED,
    actionIds: Object.freeze([
        "swing",
        "block",
        "no_dash",
        "dash",
        "dash_outward",
        "dash_tangent_left",
        "dash_tangent_right",
        "dash_diagonal_in_left",
        "dash_diagonal_in_right",
        "dash_diagonal_out_left",
        "dash_diagonal_out_right",
        "dash_north",
        "dash_south",
        "dash_east",
        "dash_west",
        "dash_northeast",
        "dash_northwest",
        "dash_southeast",
        "dash_southwest",
    ]),
    ownConditionIds: Object.freeze([
        "my_swing_ready",
        "my_swing_cooldown",
        "my_block_ready",
        "my_block_cooldown",
        "my_shield_up",
        "my_shield_down",
        "my_shield_charges_lt",
        "my_shield_charges_gt",
        "my_dash_ready",
        "my_dash_cooldown",
    ]),
    opponentConditionIds: Object.freeze([
        "opponent_swing_ready",
        "opponent_swing_cooldown",
        "opponent_block_ready",
        "opponent_block_cooldown",
        "opponent_shield_up",
        "opponent_shield_down",
        "opponent_shield_charges_lt",
        "opponent_shield_charges_gt",
        "opponent_dash_ready",
        "opponent_dash_cooldown",
    ]),
});
