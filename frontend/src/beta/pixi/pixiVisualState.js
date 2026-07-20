import { abilityDefinition, VISUAL_INTERPOLATION } from "../loadout/BotLoadout.js";
import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";

const ZONE_TYPES = new Set(["gravityField", "gravityExplosion", "nullZone", "orbitalMarker", "orbitalExplosion", "silenceWave", "temporalRewindZone"]);
const PROJECTILE_TYPES = new Set(["grenade", "fireball"]);

export function isFighterShape(shape) {
    return shape?.id === "main" || shape?.type === "opponentModel";
}

export function pixiLayerForShape(shape) {
    if (isFighterShape(shape)) return "fighters";
    if (ZONE_TYPES.has(shape?.type)) return "zones";
    if (PROJECTILE_TYPES.has(shape?.type)) return "projectiles";
    return "entities";
}

export function shapeInterpolationMs(shape) {
    if (abilityDefinition(shape?.abilityId)?.visualInterpolation === VISUAL_INTERPOLATION.NONE) return 0;
    return Math.max(0, Number(shape?.interpolationMs ?? AUTO_STEP_MS));
}

export function fighterStatusLabels(shape) {
    const labels = [];
    if (Number(shape?.abilityActiveMs?.reactive_armor ?? 0) > 0) labels.push("RA");
    if (Number(shape?.abilityActiveMs?.absolute_guard ?? 0) > 0) labels.push("AG");
    if (Number(shape?.burnRemainingMs ?? 0) > 0) labels.push("BURN");
    if (Number(shape?.bleedRemainingMs ?? 0) > 0) labels.push("BLEED");
    if (Number(shape?.slowedMs ?? 0) > 0) labels.push("SLOW");
    if (Number(shape?.silencedMs ?? 0) > 0 || shape?.nullZoneSilenced) labels.push("SIL");
    if (Number(shape?.shockRemainingMs ?? 0) > 0) labels.push("SHOCK");
    if (Number(shape?.stunnedMs ?? 0) > 0) labels.push("STUN");
    return labels;
}

export function activeFighterVisual(shape) {
    const active = ["heavy_slash", "quick_jab", "thrust", "pistol_shot", "concussive_shot", "rail_shot", "repulsor_burst", "repair_pulse", "phase_strike", "micro_dash"]
        .find((id) => Number(shape?.abilityActiveMs?.[id] ?? 0) > 0);
    return Number(shape?.prototypeVisual?.ms ?? 0) > 0 ? shape.prototypeVisual.ability : active ?? null;
}

export function entityCaption(shape) {
    if (shape?.type === "hunterDrone") return `${Math.max(0, Math.ceil(Number(shape.hp ?? 50)))} HP`;
    if (shape?.type === "orbitalMarker") return `${(Math.max(0, Number(shape.fuseMs ?? 0)) / 1000).toFixed(1)}s`;
    return "";
}
