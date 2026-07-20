import test from "node:test";
import assert from "node:assert/strict";
import { activeFighterVisual, entityCaption, fighterStatusLabels, isFighterShape, pixiLayerForShape, shapeInterpolationMs } from "./pixiVisualState.js";

test("Pixi renderer classifies every combat snapshot family without changing game state", () => {
    assert.equal(isFighterShape({ id: "main" }), true);
    assert.equal(pixiLayerForShape({ type: "fireball" }), "projectiles");
    assert.equal(pixiLayerForShape({ type: "nullZone" }), "zones");
    assert.equal(pixiLayerForShape({ type: "hunterDrone" }), "entities");
});

test("Pixi movement interpolation follows canonical ability metadata", () => {
    assert.equal(shapeInterpolationMs({ abilityId: "rail_shot", interpolationMs: 100 }), 0);
    assert.equal(shapeInterpolationMs({ abilityId: "shoot_fireball", interpolationMs: 125 }), 125);
});

test("fighter and entity labels derive from calculated snapshot fields", () => {
    assert.deepEqual(fighterStatusLabels({ burnRemainingMs: 100, slowedMs: 100, nullZoneSilenced: true }), ["BURN", "SLOW", "SIL"]);
    assert.equal(activeFighterVisual({ prototypeVisual: { ability: "heavy_slash", ms: 200 } }), "heavy_slash");
    assert.equal(activeFighterVisual({ abilityActiveMs: { reactive_armor: 3000 } }), null);
    assert.equal(entityCaption({ type: "proximityMine", armed: true }), "");
    assert.equal(entityCaption({ type: "orbitalMarker", fuseMs: 900 }), "0.9s");
});
