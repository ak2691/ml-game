const assert = require("node:assert/strict");
const test = require("node:test");
const { MOVEMENT_ACTIONS, movementFromProbabilities } = require("../src/movementActions");

test("movement contract exposes stop plus eight directions", () => {
    assert.equal(MOVEMENT_ACTIONS.length, 9);
    assert.deepEqual(movementFromProbabilities([1, 0, 0, 0, 0, 0, 0, 0, 0]), {
        id: "stop",
        dx: 0,
        dy: 0,
        movementActionIndex: 0,
    });
});

test("movement decoder selects the highest probability", () => {
    assert.equal(
        movementFromProbabilities([0, 0, 0, 0, 0, 0, 0.9, 0.1, 0]).id,
        "up-right"
    );
});

test("movement decoder can sample from the full probability distribution", () => {
    const probabilities = [0.1, 0.2, 0.3, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05];
    assert.equal(
        movementFromProbabilities(probabilities, { sample: true, random: () => 0.35 }).id,
        "left"
    );
});
