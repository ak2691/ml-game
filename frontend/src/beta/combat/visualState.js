import { MOVE_STATS } from "./Moves.js";

export const COMBAT_VISUAL_MS = 300;

export function healthBarPercent(hp, maxHp) {
    const safeMaxHp = Math.max(1, Number(maxHp) || 1);
    return clamp01((Number(hp) || 0) / safeMaxHp) * 100;
}

export function gunRayOpacity(shape) {
    const activeMs = Math.max(0, Number(shape?.gunActiveMs ?? 0));
    return Math.max(0, Math.min(1, activeMs / Number(MOVE_STATS.fire_gun.activeMs)));
}

export function prototypeVisualOpacity(shape, ability, durationMs = COMBAT_VISUAL_MS) {
    return clamp01(combatVisualRemainingMs(shape, ability) / durationMs);
}

/**
 * Bot-room fights carry the transient effect in prototypeVisual while
 * authoritative replay frames carry the same timer in abilityActiveMs.
 */
export function combatVisualRemainingMs(shape, ability) {
    if (!ability) return 0;
    const prototypeMs = shape?.prototypeVisual?.ability === ability
        ? Number(shape.prototypeVisual.ms ?? 0)
        : 0;
    return Math.max(0, prototypeMs, Number(shape?.abilityActiveMs?.[ability] ?? 0));
}

export function visualProgress(remainingMs, durationMs = COMBAT_VISUAL_MS) {
    return 1 - clamp01(Number(remainingMs ?? 0) / durationMs);
}

export function swordSweepAngle(remainingMs, durationMs, startAngle = -50, endAngle = 50, frameStepMs = 100) {
    // A zero timer is no longer rendered. Map the last visible simulation
    // frame to the positive edge so the cosmetic sweep reaches both sides.
    const visibleDurationMs = Math.max(1, Number(durationMs) - Number(frameStepMs));
    const progress = Math.max(0, Math.min(1, (Number(durationMs) - Number(remainingMs ?? 0)) / visibleDurationMs));
    return startAngle + (endAngle - startAngle) * progress;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
