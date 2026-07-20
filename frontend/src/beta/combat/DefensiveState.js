/** Defender-owned immunity. Incoming systems must consult this before mutating hostile state. */
export function ignoresHostileEffects(shape) {
    return Number(shape?.abilityActiveMs?.absolute_guard ?? 0) > 0;
}
