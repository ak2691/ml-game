export const BASE_BOT_STATS = Object.freeze({
    maxHp: 100,
    moveSpeed: 8,
    attackDamagePercent: 100,
    attackSpeedPercent: 100,
});

export const STAT_POINT_BUDGET_PER_ROUND = 4;
export const MAX_MATCH_STAT_POINTS = 12;
export const MAX_EQUIPPED_ABILITIES = 6;
export const ROUND_ABILITY_DRAFT = Object.freeze({
    1: Object.freeze({ offered: 6, picks: 3 }),
    2: Object.freeze({ offered: 4, picks: 2 }),
    3: Object.freeze({ offered: 3, picks: 1 }),
});
export const SANDBOX_MAX_STAT_POINTS = 100;

export const VISUAL_INTERPOLATION = Object.freeze({
    NONE: "none",
    LINEAR: "linear",
});

const BOT_ABILITY_CATALOG = [
    { id: "swing", label: "Sword Swing", round: 1, kind: "move", visualInterpolation: "none", actions: ["swing"], summary: "Dependable short-range sword sweep." },
    { id: "block", label: "Shield Block", round: 1, kind: "move", visualInterpolation: "none", actions: ["block"], summary: "Directional defense using rechargeable charges." },
    { id: "dash", label: "Dash", round: 1, kind: "move", visualInterpolation: "linear", actions: ["dash"], summary: "Long committed movement configured inside the action." },
    { id: "fire_gun", label: "Fire Gun", round: 1, kind: "move", visualInterpolation: "none", actions: ["fire_gun"], summary: "Hitscan fire with ammunition and distance falloff." },
    { id: "throw_grenade", label: "Throw Grenade", round: 1, kind: "ability", visualInterpolation: "linear", actions: ["throw_grenade"], summary: "A slowing explosive projectile." },
    { id: "shoot_fireball", label: "Shoot Fireball", round: 1, kind: "move", visualInterpolation: "linear", actions: ["shoot_fireball"], summary: "Charge-based projectile that burns its target." },
    { id: "stun", label: "Stun", round: 1, kind: "ability", visualInterpolation: "none", actions: ["stun"], summary: "Visible short-range control cast." },
    { id: "heavy_slash", label: "Heavy Slash", round: 1, kind: "ability", visualInterpolation: "none", actions: ["heavy_slash"], summary: "Wind up a narrow 30-damage sword punish." },
    { id: "repulsor_burst", label: "Repulsor Burst", round: 1, kind: "ability", visualInterpolation: "none", actions: ["repulsor_burst"], summary: "Deal 20 damage and push nearby fighters 250 units; blocking prevents only the damage." },
    { id: "concussive_shot", label: "Concussive Shot", round: 1, kind: "ability", visualInterpolation: "none", actions: ["concussive_shot"], summary: "A blockable projectile that slows on hit." },
    { id: "repair_pulse", label: "Repair Pulse", round: 1, kind: "ability", visualInterpolation: "none", actions: ["repair_pulse"], summary: "Channel briefly to restore 15 HP." },
    { id: "proximity_mine", label: "Proximity Mine", round: 1, kind: "ability", visualInterpolation: "linear", actions: ["proximity_mine"], summary: "Place one visible, destructible proximity trap." },
    { id: "quick_jab", label: "Quick Jab", round: 1, kind: "move", visualInterpolation: "none", actions: ["quick_jab"], summary: "Fast 8-damage narrow melee poke." },
    { id: "pistol_shot", label: "Pistol Shot", round: 1, kind: "move", visualInterpolation: "none", actions: ["pistol_shot"], summary: "Reliable 500-range low-damage hitscan shot." },
    { id: "rail_shot", label: "Rail Shot", round: 2, kind: "ability", visualInterpolation: "none", actions: ["rail_shot"], summary: "Charge a visible long-range 32-damage beam." },
    { id: "gravity_grenade", label: "Gravity Grenade", round: 2, kind: "ability", visualInterpolation: "linear", actions: ["gravity_grenade"], summary: "Deploy a deterministic pulling damage field." },
    { id: "silence_pulse", label: "Silence Pulse", round: 2, kind: "ability", visualInterpolation: "linear", actions: ["silence_pulse"], summary: "Prevent nearby enemies from starting abilities." },
    { id: "reactive_armor", label: "Reactive Armor", round: 2, kind: "ability", visualInterpolation: "none", actions: ["reactive_armor"], summary: "Reduce damage and retaliate up to three times." },
    { id: "hunter_drone", label: "Hunter Drone", round: 2, kind: "ability", visualInterpolation: "linear", actions: ["hunter_drone"], summary: "Deploy a targetable deterministic firing drone." },
    { id: "thrust", label: "Thrust", round: 2, kind: "move", visualInterpolation: "none", actions: ["thrust"], summary: "Narrow 110-range melee attack." },
    { id: "micro_dash", label: "Micro Dash", round: 2, kind: "move", visualInterpolation: "linear", actions: ["micro_dash"], summary: "Dash 150 units quickly using target-relative, coordinate-relative, or absolute movement." },
    { id: "temporal_rewind", label: "Temporal Rewind", round: 3, kind: "ability", visualInterpolation: "none", actions: ["temporal_rewind"], summary: "Snapshot position and HP, then return to them after three seconds." },
    { id: "orbital_strike", label: "Orbital Strike", round: 3, kind: "ability", visualInterpolation: "none", actions: ["orbital_strike"], summary: "Mark a visible zone that detonates after 1.5 seconds." },
    { id: "absolute_guard", label: "Absolute Guard", round: 3, kind: "ability", visualInterpolation: "none", actions: ["absolute_guard"], summary: "Ignore all hostile damage, statuses, interrupts, and displacement for 1.5 seconds." },
    { id: "null_zone", label: "Null Zone", round: 3, kind: "ability", visualInterpolation: "none", actions: ["null_zone"], summary: "Deploy an area where new abilities cannot begin." },
    { id: "phase_strike", label: "Phase Strike", round: 3, kind: "move", visualInterpolation: "linear", actions: ["phase_strike"], summary: "Pass through the opponent and choose the landing facing inside the action." },
];

const ENTITY_CAPABILITIES = Object.freeze({
    throw_grenade: { entityType: "grenade", entityLabel: "Grenade", tags: ["projectile", "entity", "hittable"] },
    shoot_fireball: { entityType: "fireball", entityLabel: "Fireball", tags: ["projectile", "entity", "hittable", "chainable"] },
    concussive_shot: { entityType: "concussive_shot", entityLabel: "Concussive Shot", tags: ["projectile", "entity", "hittable", "chainable"] },
    proximity_mine: { entityType: "proximity_mine", entityLabel: "Proximity Mine", tags: ["trap", "entity", "hittable", "chainable", "destructible"] },
    gravity_grenade: { entityType: "gravity_field", entityLabel: "Gravity Field", tags: ["projectile", "zone", "entity"] },
    silence_pulse: { entityType: "silence_wave", entityLabel: "Silence Pulse", tags: ["projectile", "entity", "hittable", "chainable"] },
    hunter_drone: { entityType: "hunter_drone", entityLabel: "Hunter Drone", tags: ["summon", "entity", "hittable", "chainable", "destructible"] },
    orbital_strike: { entityType: "orbital_zone", entityLabel: "Orbital Strike Zone", tags: ["zone", "entity"] },
    null_zone: { entityType: "null_zone", entityLabel: "Null Zone", tags: ["zone", "entity"] },
    temporal_rewind: { entityType: "temporal_rewind_zone", entityLabel: "Temporal Rewind Clock", tags: ["zone", "entity"] },
});

function abilityCapabilities(ability) {
    const stats = ABILITY_STATS[ability.id] ?? MOVE_STATS[ability.id] ?? {};
    const entity = ENTITY_CAPABILITIES[ability.id] ?? {};
    const tags = new Set([ability.kind, ...(entity.tags ?? [])]);
    if (stats.windupMs) tags.add("wind-up");
    if (stats.beam) tags.add("ray");
    if (stats.durationMs) tags.add("duration");
    tags.add(ability.visualInterpolation === VISUAL_INTERPOLATION.LINEAR ? "interpolated-visual" : "instant-visual");
    const gameplay = abilityContract(ability.id);
    return Object.freeze({
        ...ability,
        ...entity,
        delivery: gameplay?.delivery ?? null,
        effects: gameplay?.effects ?? Object.freeze([]),
        shieldInteraction: gameplay?.shieldInteraction ?? null,
        tags: Object.freeze([...tags]),
    });
}

/** Canonical metadata used to derive action state, condition controls, and entity targets. */
export const BOT_ABILITIES = Object.freeze(BOT_ABILITY_CATALOG.map(abilityCapabilities));

export function abilityDefinition(id) {
    return BOT_ABILITIES.find((ability) => ability.id === id) ?? null;
}

export function shouldInterpolateAbilityVisual(id) {
    return abilityDefinition(id)?.visualInterpolation === VISUAL_INTERPOLATION.LINEAR;
}

export function entityTargetDefinitions() {
    return BOT_ABILITIES.filter((ability) => ability.tags.includes("entity") && ability.entityType);
}

const BASE_ACTION_IDS = new Set(["swing", "block", "dash", "fire_gun", "throw_grenade", "shoot_fireball", "stun"]);
export const PROTOTYPE_ABILITY_STATS = Object.freeze(Object.fromEntries(
    Object.entries({ ...ABILITY_STATS, ...MOVE_STATS }).filter(([id]) => !BASE_ACTION_IDS.has(id)),
));

export const PROTOTYPE_ACTION_TO_ABILITY = Object.freeze({
    ...Object.fromEntries(BOT_ABILITIES.filter(({ id }) => PROTOTYPE_ABILITY_STATS[id]).flatMap((ability) => ability.actions.map((action) => [action, ability.id]))),
    ...Object.fromEntries(["micro_dash_outward", "micro_dash_left", "micro_dash_right", "micro_dash_toward_left", "micro_dash_toward_right", "micro_dash_away_left", "micro_dash_away_right", "micro_dash_north", "micro_dash_south", "micro_dash_east", "micro_dash_west", "micro_dash_northeast", "micro_dash_northwest", "micro_dash_southeast", "micro_dash_southwest"].map((action) => [action, "micro_dash"])),
    ...Object.fromEntries(["phase_strike_keep_facing", "phase_strike_face_origin", "phase_strike_mirror_facing"].map((action) => [action, "phase_strike"])),
});

export const DEFAULT_BOT_LOADOUT = Object.freeze({
    abilities: Object.freeze([]),
    statPoints: Object.freeze({ maxHp: 0, moveSpeed: 0, attackDamage: 0, attackSpeed: 0 }),
});

export function normalizedBotLoadout(loadout) {
    const known = new Set(BOT_ABILITIES.map((ability) => ability.id));
    const abilities = [...new Set(Array.isArray(loadout?.abilities) ? loadout.abilities : DEFAULT_BOT_LOADOUT.abilities)]
        .filter((ability) => known.has(ability))
        .slice(0, MAX_EQUIPPED_ABILITIES);
    const rawPoints = loadout?.statPoints ?? {};
    const pointKeys = ["maxHp", "moveSpeed", "attackDamage", "attackSpeed"];
    const statPoints = Object.fromEntries(pointKeys.map((key) => [key, Math.max(0, Math.floor(Number(rawPoints[key]) || 0))]));
    let overflow = Math.max(0, Object.values(statPoints).reduce((sum, value) => sum + value, 0) - MAX_MATCH_STAT_POINTS);
    for (const key of [...pointKeys].reverse()) {
        const removed = Math.min(statPoints[key], overflow);
        statPoints[key] -= removed;
        overflow -= removed;
    }
    return { abilities, statPoints };
}

export function botStatsForLoadout(loadout) {
    const { statPoints } = normalizedBotLoadout(loadout);
    return {
        maxHp: BASE_BOT_STATS.maxHp + statPoints.maxHp * 10,
        moveSpeed: BASE_BOT_STATS.moveSpeed + statPoints.moveSpeed,
        attackDamagePercent: BASE_BOT_STATS.attackDamagePercent + statPoints.attackDamage * 10,
        attackSpeedPercent: BASE_BOT_STATS.attackSpeedPercent + statPoints.attackSpeed * 10,
    };
}

export function actionIdsForLoadout(loadout) {
    const selected = new Set(normalizedBotLoadout(loadout).abilities);
    return BOT_ABILITIES.filter((ability) => selected.has(ability.id)).flatMap((ability) => ability.actions);
}

const ABILITY_CODES = Object.freeze({ swing: "s", block: "b", dash: "d", fire_gun: "g", throw_grenade: "r", shoot_fireball: "f", stun: "t", heavy_slash: "h", repulsor_burst: "u", concussive_shot: "c", repair_pulse: "e", proximity_mine: "m", quick_jab: "j", pistol_shot: "p", rail_shot: "R", gravity_grenade: "G", silence_pulse: "S", reactive_armor: "A", hunter_drone: "H", thrust: "T", micro_dash: "M", temporal_rewind: "w", orbital_strike: "o", absolute_guard: "a", null_zone: "n", phase_strike: "P" });
const ABILITY_BY_CODE = Object.freeze(Object.fromEntries(Object.entries(ABILITY_CODES).map(([id, code]) => [code, id])));

export function encodeBotLoadout(loadout) {
    const normalized = normalizedBotLoadout(loadout);
    const abilities = normalized.abilities.map((id) => ABILITY_CODES[id]).filter(Boolean).sort().join("");
    const points = ["maxHp", "moveSpeed", "attackDamage", "attackSpeed"].map((key) => normalized.statPoints[key]).join(",");
    return `custom:${abilities}:${points}`;
}

export function decodeBotLoadout(value) {
    if (typeof value !== "string" || !value.startsWith("custom:")) return normalizedBotLoadout(DEFAULT_BOT_LOADOUT);
    const [, abilityCodes = "", points = "0,0,0,0"] = value.split(":");
    const abilities = [...abilityCodes].map((code) => ABILITY_BY_CODE[code]).filter(Boolean);
    const [maxHp = 0, moveSpeed = 0, attackDamage = 0, attackSpeed = 0] = points.split(",").map(Number);
    return normalizedBotLoadout({ abilities, statPoints: { maxHp, moveSpeed, attackDamage, attackSpeed } });
}

export function normalizedSandboxLoadout(loadout) {
    const known = new Set(BOT_ABILITIES.map((ability) => ability.id));
    const abilities = [...new Set(Array.isArray(loadout?.abilities) ? loadout.abilities : [])]
        .filter((ability) => known.has(ability));
    const rawPoints = loadout?.statPoints ?? {};
    const keys = ["maxHp", "moveSpeed", "attackDamage", "attackSpeed"];
    const statPoints = Object.fromEntries(keys.map((key) => [key, Math.max(0, Math.min(SANDBOX_MAX_STAT_POINTS, Math.floor(Number(rawPoints[key]) || 0)))]));
    return { abilities, statPoints };
}

export function encodeSandboxLoadout(loadout) {
    const normalized = normalizedSandboxLoadout(loadout);
    return `sandbox:${normalized.abilities.join(",")}:${["maxHp", "moveSpeed", "attackDamage", "attackSpeed"].map((key) => normalized.statPoints[key]).join(",")}`;
}

export function decodeSandboxLoadout(value) {
    if (typeof value !== "string" || !value.startsWith("sandbox:")) return normalizedSandboxLoadout(DEFAULT_BOT_LOADOUT);
    const [, abilities = "", points = "0,0,0,0"] = value.split(":");
    const [maxHp = 0, moveSpeed = 0, attackDamage = 0, attackSpeed = 0] = points.split(",").map(Number);
    return normalizedSandboxLoadout({ abilities: abilities ? abilities.split(",") : [], statPoints: { maxHp, moveSpeed, attackDamage, attackSpeed } });
}

export function botStatsForSandboxLoadout(loadout) {
    const { statPoints } = normalizedSandboxLoadout(loadout);
    return {
        maxHp: BASE_BOT_STATS.maxHp + statPoints.maxHp * 10,
        moveSpeed: BASE_BOT_STATS.moveSpeed + statPoints.moveSpeed,
        attackDamagePercent: BASE_BOT_STATS.attackDamagePercent + statPoints.attackDamage * 10,
        attackSpeedPercent: BASE_BOT_STATS.attackSpeedPercent + statPoints.attackSpeed * 10,
    };
}
import { ABILITY_STATS } from "../combat/Abilities.js";
import { abilityContract } from "../combat/AbilityContracts.js";
import { MOVE_STATS } from "../combat/Moves.js";
