import assert from "node:assert/strict";
import test from "node:test";
import { buildInputVector, INPUT_SIZE, INTENT_FEATURE_OFFSET } from "./Featurebuilder.js";
import { INTENT_TARGET_TYPES, INTENT_TYPES, MOVEMENT_STYLE_TYPES } from "./IntentFeatures.js";

function state({ rotation = 0, enemyX = 500, enemyY = 400 } = {}) {
    return {
        playerModel: {
            x: 400,
            y: 400,
            rotation,
            swingAvailable: true,
            blockAvailable: true,
        },
        objects: [{
            id: "opponent",
            type: "opponentModel",
            x: enemyX,
            y: enemyY,
            size: 64,
            rotation: 0,
        }],
    };
}

test("encodes enemy bearing relative to player facing", () => {
    const ahead = buildInputVector(state());
    const right = buildInputVector(state({ enemyX: 400, enemyY: 500 }));
    const turnedAhead = buildInputVector(state({ rotation: 90, enemyX: 400, enemyY: 500 }));

    assert.equal(ahead[9], 0);
    assert.equal(right[9], 0.5);
    assert.equal(turnedAhead[9], 0);
    assert.equal(ahead.length, INPUT_SIZE);
    assert.equal(ahead[10], 1);
});

test("appends the selected logic-block intent", () => {
    const vector = buildInputVector({
        ...state(),
        intent: {
            intent: "seek_object",
            target: "object_1",
            movementStyle: "direct_in",
            dash: 1,
        },
    });

    assert.equal(vector.length, INPUT_SIZE);
    assert.equal(vector[INTENT_FEATURE_OFFSET + INTENT_TYPES.indexOf("seek_object")], 1);
    const targetOffset = INTENT_FEATURE_OFFSET + INTENT_TYPES.length;
    assert.equal(vector[targetOffset + INTENT_TARGET_TYPES.indexOf("object_1")], 1);
    const movementOffset = targetOffset + INTENT_TARGET_TYPES.length;
    assert.equal(vector[movementOffset + MOVEMENT_STYLE_TYPES.indexOf("direct_in")], 1);
    assert.equal(vector[INPUT_SIZE - 1], 1);
});

test("ignores non-opponent objects and zero-fills a missing opponent", () => {
    const withDecoration = state();
    withDecoration.objects.unshift({
        id: "decoration",
        type: "circle",
        x: 401,
        y: 401,
        size: 200,
        rotation: 180,
    });
    assert.deepEqual(buildInputVector(withDecoration), buildInputVector(state()));

    const withoutOpponent = buildInputVector({ ...state(), objects: [] });
    assert.equal(withoutOpponent.length, INPUT_SIZE);
    assert.deepEqual(Array.from(withoutOpponent.slice(7, 13)), [0, 0, 0, 0, 0, 0]);
});

test("encodes up to five obstacle slots after duel features", () => {
    const payload = state();
    payload.objects.push(
        { id: "object_1", type: "healthPack", x: 500, y: 400, size: 42 },
        { id: "object_2", type: "damageZone", x: 400, y: 300, size: 128 },
        { id: "object_3", type: "projectileWall", x: 300, y: 400, size: 120 },
    );

    const vector = buildInputVector(payload);

    assert.equal(vector[26], 1);
    assert.equal(vector[27], 1);
    assert.equal(vector[28], 0);
    assert.ok(Math.abs(vector[29] - 0.125) < 0.00001);
    assert.equal(vector[32], 1);
    assert.equal(vector[33], 0);
    assert.equal(vector[34], 1);
    assert.ok(Math.abs(vector[36] + 0.125) < 0.00001);
    assert.equal(vector[38], 1);
    assert.equal(vector[39], 0);
    assert.equal(vector[40], 0);
    assert.ok(Math.abs(vector[41] + 0.125) < 0.00001);
});

test("encodes HP, edge distance, enemy combat state, and radial velocity", () => {
    const payload = state({ enemyX: 500, enemyY: 400 });
    payload.playerModel.hp = 40;
    payload.playerModel.size = 60;
    payload.playerModel.dashAvailable = true;
    Object.assign(payload.objects[0], {
        hp: 25,
        swingActive: true,
        blockActive: true,
        velocityX: -100,
        velocityY: 0,
    });
    const vector = buildInputVector(payload);
    assert.ok(Math.abs(vector[13] - 0.4) < 0.00001);
    assert.ok(Math.abs(vector[18] - 0.25) < 0.00001);
    assert.equal(vector[20], 1);
    assert.equal(vector[21], 1);
    assert.ok(vector[24] > 0);
});
