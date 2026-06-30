import assert from "node:assert/strict";
import test from "node:test";
import {
    movementVectorToActionIndex,
    MOVEMENT_ACTION_COUNT,
    oneHotMovementAction,
    selectMovementAction,
} from "./MovementActions.js";

test("quantizes movement vectors into one of nine actions", () => {
    assert.equal(MOVEMENT_ACTION_COUNT, 9);
    assert.equal(movementVectorToActionIndex(0, 0), 0);
    assert.equal(movementVectorToActionIndex(10, 1), 1);
    assert.equal(movementVectorToActionIndex(-1, -1), 8);
});

test("clean selection uses the highest-probability movement", () => {
    assert.deepEqual(
        selectMovementAction([0.05, 0.8, 0.05, 0.02, 0.02, 0.02, 0.01, 0.01, 0.02]),
        { id: "right", dx: 1, dy: 0, movementActionIndex: 1 }
    );
});

test("sampling can select the explicit stop action", () => {
    const probabilities = oneHotMovementAction(0);
    assert.equal(selectMovementAction(probabilities, { sample: true, random: () => 0 }).movementActionIndex, 0);
});
