import assert from "node:assert/strict";
import test from "node:test";
import { snapWallRotation } from "./ArenaObjects.js";

test("wall rotations snap to the eight allowed angles", () => {
    assert.equal(snapWallRotation(22), 0);
    assert.equal(snapWallRotation(23), 45);
    assert.equal(snapWallRotation(181), 180);
    assert.equal(snapWallRotation(359), 0);
});
