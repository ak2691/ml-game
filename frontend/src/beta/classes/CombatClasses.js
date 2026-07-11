import { MELEE_CLASS } from "./MeleeClass.jsx";
import { RANGED_CLASS } from "./RangedClass.jsx";
import { MAGE_CLASS } from "./MageClass.jsx";

export const COMMON_ACTION_IDS = Object.freeze([
    "move_inward",
    "move_outward",
    "move_tangent_left",
    "move_tangent_right",
    "move_diagonal_in_left",
    "move_diagonal_in_right",
    "move_diagonal_out_left",
    "move_diagonal_out_right",
    "move_center",
    "move_north",
    "move_south",
    "move_east",
    "move_west",
    "move_northeast",
    "move_northwest",
    "move_southeast",
    "move_southwest",
    "move_stop",
    "rotate_toward_enemy",
]);

export const COMBAT_CLASSES = Object.freeze({
    [MELEE_CLASS.id]: MELEE_CLASS,
    [RANGED_CLASS.id]: RANGED_CLASS,
    [MAGE_CLASS.id]: MAGE_CLASS,
});

export function combatClassConfig(combatClass) {
    return COMBAT_CLASSES[combatClass] ?? MELEE_CLASS;
}

export function combatClassHp(combatClass) {
    return combatClassConfig(combatClass).hp;
}

export function combatClassMoveSpeed(combatClass) {
    return combatClassConfig(combatClass).moveSpeed;
}

export function actionTypesForCombatClass(actionTypes, combatClass) {
    const allowedIds = new Set(actionIdsForCombatClass(combatClass));
    return actionTypes.filter((action) => allowedIds.has(action.id));
}

export function actionIdsForCombatClass(combatClass) {
    return [
        ...COMMON_ACTION_IDS,
        ...combatClassConfig(combatClass).actionIds,
    ];
}

export function conditionTypesForCombatClass(conditionTypes, combatClass) {
    return conditionTypesForMatchup(conditionTypes, combatClass, combatClass);
}

export function conditionTypesForMatchup(conditionTypes, ownCombatClass, opponentCombatClass) {
    const ownConfig = combatClassConfig(ownCombatClass);
    const opponentConfig = combatClassConfig(opponentCombatClass);
    const classConditionIds = allClassConditionIds();
    const allowedClassConditionIds = new Set([
        ...(ownConfig.ownConditionIds ?? []),
        ...(opponentConfig.opponentConditionIds ?? []),
    ]);
    return conditionTypes.filter((condition) => (
        !classConditionIds.has(condition.id)
        || allowedClassConditionIds.has(condition.id)
    ));
}

function allClassConditionIds() {
    return new Set(
        Object.values(COMBAT_CLASSES).flatMap((config) => [
            ...(config.ownConditionIds ?? []),
            ...(config.opponentConditionIds ?? []),
        ]),
    );
}
