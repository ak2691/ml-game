import { BOT_ABILITIES, actionIdsForLoadout, decodeBotLoadout, decodeSandboxLoadout, encodeBotLoadout, DEFAULT_BOT_LOADOUT } from "../loadout/BotLoadout.js";

export const COMMON_ACTION_IDS = Object.freeze(["none", "move_walk", "rotate_toward_enemy"]);

export const DEFAULT_BOT_CONFIGURATION_ID = encodeBotLoadout(DEFAULT_BOT_LOADOUT);
export function actionTypesForCombatClass(actionTypes, configuration = DEFAULT_BOT_CONFIGURATION_ID) {
    const allowed = new Set(actionIdsForCombatClass(configuration));
    return actionTypes.filter(({ id }) => allowed.has(id));
}
export function actionIdsForCombatClass(configuration) {
    if (String(configuration).startsWith("sandbox:")) {
        const equipped = new Set(decodeSandboxLoadout(configuration).abilities);
        return [...COMMON_ACTION_IDS, ...BOT_ABILITIES.filter(({ id }) => equipped.has(id)).flatMap(({ actions }) => actions)];
    }
    if (String(configuration).startsWith("custom:")) return [...COMMON_ACTION_IDS, ...actionIdsForLoadout(decodeBotLoadout(configuration))];
    return [...COMMON_ACTION_IDS];
}
export function conditionTypesForMatchup(types, ownConfiguration = DEFAULT_BOT_CONFIGURATION_ID, opponentConfiguration = DEFAULT_BOT_CONFIGURATION_ID) {
    const own = abilitiesForConfiguration(ownConfiguration);
    const opponent = abilitiesForConfiguration(opponentConfiguration);
    return types.filter(({ id }) => !id.startsWith("my_") ? !id.startsWith("opponent_") || conditionAbility(id) == null || opponent.has(conditionAbility(id)) : conditionAbility(id) == null || own.has(conditionAbility(id)));
}
function abilitiesForConfiguration(configuration) {
    if (String(configuration).startsWith("sandbox:")) return new Set(decodeSandboxLoadout(configuration).abilities);
    if (String(configuration).startsWith("custom:")) return new Set(decodeBotLoadout(configuration).abilities);
    return new Set();
}
function conditionAbility(id) {
    const stripped = id.replace(/^(my|opponent)_/, "").replace(/_(ready|cooldown|preparing)$/, "");
    if (BOT_ABILITIES.some((ability) => ability.id === stripped)) return stripped;
    if (id.includes("swing")) return "swing";
    if (id.includes("block") || id.includes("shield")) return "block";
    if (id.includes("dash")) return "dash";
    if (id.includes("fire_gun") || id.includes("gun")) return "fire_gun";
    if (id.includes("grenade")) return "throw_grenade";
    if (id.includes("fireball")) return "shoot_fireball";
    if (id.includes("stun")) return "stun";
    return null;
}
