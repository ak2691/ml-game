const MOVEMENT_ACTIONS = Object.freeze([
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

function movementFromProbabilities(probabilities, { sample = false, random = Math.random } = {}) {
    if (!probabilities || probabilities.length !== MOVEMENT_ACTIONS.length) {
        throw new Error("movement head must contain nine action probabilities");
    }
    const normalized = normalizeProbabilities(probabilities);
    const index = sample ? sampleIndex(normalized, random()) : maxIndex(normalized);
    return { ...MOVEMENT_ACTIONS[index], movementActionIndex: index };
}

function normalizeProbabilities(probabilities) {
    const safe = Array.from(probabilities, (value) => (
        Number.isFinite(value) && value > 0 ? value : 0
    ));
    const total = safe.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return MOVEMENT_ACTIONS.map((_, index) => index === 0 ? 1 : 0);
    return safe.map((value) => value / total);
}

function maxIndex(probabilities) {
    let bestIndex = 0;
    for (let index = 1; index < probabilities.length; index += 1) {
        if (probabilities[index] > probabilities[bestIndex]) bestIndex = index;
    }
    return bestIndex;
}

function sampleIndex(probabilities, randomValue) {
    const threshold = Math.max(0, Math.min(1 - Number.EPSILON, randomValue));
    let cumulative = 0;
    for (let index = 0; index < probabilities.length; index += 1) {
        cumulative += probabilities[index];
        if (threshold < cumulative) return index;
    }
    return probabilities.length - 1;
}

module.exports = { MOVEMENT_ACTIONS, movementFromProbabilities };
