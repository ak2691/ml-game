export const MOVEMENT_ACTIONS = Object.freeze([
    { id: "stop", dx: 0, dy: 0 },
    { id: "right", dx: 1, dy: 0 },
    { id: "left", dx: -1, dy: 0 },
    { id: "down", dx: 0, dy: 1 },
    { id: "up", dx: 0, dy: -1 },
    { id: "down-right", dx: Math.SQRT1_2, dy: Math.SQRT1_2 },
    { id: "up-right", dx: Math.SQRT1_2, dy: -Math.SQRT1_2 },
    { id: "down-left", dx: -Math.SQRT1_2, dy: Math.SQRT1_2 },
    { id: "up-left", dx: -Math.SQRT1_2, dy: -Math.SQRT1_2 },
]);

export const MOVEMENT_ACTION_COUNT = MOVEMENT_ACTIONS.length;
export const STOP_MOVEMENT_INDEX = 0;

export function movementVectorToActionIndex(dx, dy) {
    const magnitude = Math.hypot(dx, dy);
    if (!Number.isFinite(magnitude) || magnitude < 0.001) return STOP_MOVEMENT_INDEX;

    const normalizedDx = dx / magnitude;
    const normalizedDy = dy / magnitude;
    let bestIndex = 1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 1; index < MOVEMENT_ACTIONS.length; index += 1) {
        const action = MOVEMENT_ACTIONS[index];
        const score = normalizedDx * action.dx + normalizedDy * action.dy;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }
    return bestIndex;
}

export function oneHotMovementAction(index) {
    const safeIndex = Number.isInteger(index) && index >= 0 && index < MOVEMENT_ACTION_COUNT
        ? index
        : STOP_MOVEMENT_INDEX;
    return Array.from({ length: MOVEMENT_ACTION_COUNT }, (_, candidate) => (
        candidate === safeIndex ? 1 : 0
    ));
}

export function selectMovementAction(
    probabilities,
    { sample = false, explorationRate = 0, random = Math.random } = {}
) {
    const normalized = normalizeProbabilities(probabilities);
    let index = maxIndex(normalized);

    if (sample) {
        const epsilon = clamp(explorationRate, 0, 1);
        const mixed = normalized.map((probability) => (
            probability * (1 - epsilon) + epsilon / MOVEMENT_ACTION_COUNT
        ));
        index = sampleIndex(mixed, random());
    }

    return { ...MOVEMENT_ACTIONS[index], movementActionIndex: index };
}

function normalizeProbabilities(values) {
    if (!values || values.length !== MOVEMENT_ACTION_COUNT) {
        return oneHotMovementAction(STOP_MOVEMENT_INDEX);
    }
    const safe = Array.from(values, (value) => (
        Number.isFinite(value) && value > 0 ? value : 0
    ));
    const total = safe.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return oneHotMovementAction(STOP_MOVEMENT_INDEX);
    return safe.map((value) => value / total);
}

function maxIndex(values) {
    let bestIndex = 0;
    for (let index = 1; index < values.length; index += 1) {
        if (values[index] > values[bestIndex]) bestIndex = index;
    }
    return bestIndex;
}

function sampleIndex(probabilities, randomValue) {
    const threshold = clamp(randomValue, 0, 1 - Number.EPSILON);
    let cumulative = 0;
    for (let index = 0; index < probabilities.length; index += 1) {
        cumulative += probabilities[index];
        if (threshold < cumulative) return index;
    }
    return probabilities.length - 1;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
