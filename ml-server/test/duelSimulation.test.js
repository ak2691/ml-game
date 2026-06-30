const assert = require("node:assert/strict");
const test = require("node:test");
const tf = require("@tensorflow/tfjs");
const { buildInputVector, INPUT_SIZE, simulateDuelMatch } = require("../src/duelSimulation");

async function createMeleeModelArtifacts(swingBias = -10, movementIndex = 0, dashBias = -10, rotationBias = 0) {
    const input = tf.input({ shape: [INPUT_SIZE] });
    const hidden = tf.layers.dense({ units: 32, activation: "relu" }).apply(input);
    const movementLayer = tf.layers.dense({ units: 9, activation: "softmax", kernelInitializer: "zeros", biasInitializer: "zeros" });
    const movement = movementLayer.apply(hidden);
    const rotation = tf.layers.dense({
        units: 1,
        activation: "tanh",
        kernelInitializer: "zeros",
        biasInitializer: tf.initializers.constant({ value: rotationBias }),
    }).apply(hidden);
    const swing = tf.layers.dense({
        units: 1,
        activation: "sigmoid",
        kernelInitializer: "zeros",
        biasInitializer: tf.initializers.constant({ value: swingBias }),
    }).apply(hidden);
    const block = tf.layers.dense({ units: 1, activation: "sigmoid", kernelInitializer: "zeros", biasInitializer: "zeros" }).apply(hidden);
    const dash = tf.layers.dense({ units: 1, activation: "sigmoid", kernelInitializer: "zeros", biasInitializer: tf.initializers.constant({ value: dashBias }) }).apply(hidden);
    const model = tf.model({ inputs: input, outputs: [movement, rotation, swing, block, dash] });
    const [movementKernel] = movementLayer.getWeights();
    const selectedBias = tf.tensor1d(Array.from({ length: 9 }, (_, index) => index === movementIndex ? 8 : 0));
    movementLayer.setWeights([movementKernel, selectedBias]);
    selectedBias.dispose();
    let artifacts;
    await model.save({ save: async (value) => {
        artifacts = value;
        return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
    } });
    model.dispose();
    return {
        modelTopology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs,
        weightDataBase64: Buffer.from(artifacts.weightData).toString("base64"),
    };
}

async function createIntentSensitiveModelArtifacts(dashBias = -10) {
    const input = tf.input({ shape: [INPUT_SIZE] });
    const movementLayer = tf.layers.dense({ units: 9, activation: "softmax", kernelInitializer: "zeros", biasInitializer: "zeros" });
    const movement = movementLayer.apply(input);
    const rotation = tf.layers.dense({ units: 1, activation: "tanh", kernelInitializer: "zeros", biasInitializer: "zeros" }).apply(input);
    const swing = tf.layers.dense({ units: 1, activation: "sigmoid", kernelInitializer: "zeros", biasInitializer: tf.initializers.constant({ value: -10 }) }).apply(input);
    const block = tf.layers.dense({ units: 1, activation: "sigmoid", kernelInitializer: "zeros", biasInitializer: "zeros" }).apply(input);
    const dash = tf.layers.dense({ units: 1, activation: "sigmoid", kernelInitializer: "zeros", biasInitializer: tf.initializers.constant({ value: dashBias }) }).apply(input);
    const model = tf.model({ inputs: input, outputs: [movement, rotation, swing, block, dash] });
    const [movementKernel, movementBias] = movementLayer.getWeights();
    const kernelBuffer = tf.buffer(movementKernel.shape);
    kernelBuffer.set(10, 56 + 4, 2);
    const intentKernel = kernelBuffer.toTensor();
    movementLayer.setWeights([intentKernel, movementBias]);
    intentKernel.dispose();
    let artifacts;
    await model.save({ save: async (value) => {
        artifacts = value;
        return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
    } });
    model.dispose();
    return {
        modelTopology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs,
        weightDataBase64: Buffer.from(artifacts.weightData).toString("base64"),
    };
}

test("buildInputVector uses the intent-aware obstacle logic-block contract", () => {
    const vector = buildInputVector(
        { x: 400, y: 400, size: 60, rotation: 0, attackCooldownMs: 0, blockCooldownMs: 0, blockActiveMs: 0 },
        { x: 480, y: 400, size: 60, rotation: 180 },
        [{ id: "object_1", type: "healthPack", x: 500, y: 400, size: 42 }],
    );
    assert.equal(vector.length, INPUT_SIZE);
    assert.ok(Math.abs(vector[7] - 0.1) < 0.00001);
    assert.equal(vector[9], 0);
    assert.equal(vector[26], 1);
    assert.equal(vector[27], 1);
    assert.equal(vector[28], 0);
    assert.ok(Math.abs(vector[29] - 0.125) < 0.00001);
});

test("buildInputVector appends selected strategy intent features", () => {
    const vector = buildInputVector(
        { x: 400, y: 400, size: 60, rotation: 0, attackCooldownMs: 0, blockCooldownMs: 0, blockActiveMs: 0 },
        { x: 480, y: 400, size: 60, rotation: 180 },
        [],
        { intent: "seek_object", target: "object_1", movementStyle: "direct_in", dash: 1 },
    );

    assert.equal(vector[56 + 4], 1);
    assert.equal(vector[56 + 10 + 2], 1);
    assert.equal(vector[56 + 10 + 7 + 1], 1);
    assert.equal(vector[INPUT_SIZE - 1], 1);
});

test("buildInputVector gives slot two the same canonical opponent direction", () => {
    const vector = buildInputVector(
        { slot: 2, x: 560, y: 400, size: 60, rotation: 180, attackCooldownMs: 0, blockCooldownMs: 0, blockActiveMs: 0 },
        { slot: 1, x: 240, y: 400, size: 60, rotation: 0 },
    );
    assert.ok(Math.abs(vector[7] - 0.4) < 0.00001);
    assert.ok(Math.abs(vector[8]) < 0.00001);
    assert.equal(vector[0], 0);
});

test("simulateDuelMatch produces a draw when neither fighter wins", async () => {
    const model = await createMeleeModelArtifacts();
    const result = await simulateDuelMatch({
        matchId: "match-1",
        rulesetVersion: "duel-v1",
        arena: { width: 800, height: 800, durationMs: 200, obstacles: [] },
        fighters: [
            { userId: "fighter-1", username: "One", slot: 1, x: 100, y: 400, size: 60, model },
            { userId: "fighter-2", username: "Two", slot: 2, x: 700, y: 400, size: 60, model },
        ],
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.result, "DRAW");
    assert.equal(result.winnerUserId, null);
    assert.match(result.message, /draw/);
});

test("simulateDuelMatch is deterministic with the same server seed", async () => {
    const firstModel = await createMeleeModelArtifacts(-10, null);
    const secondModel = await createMeleeModelArtifacts(-10, null);
    const request = {
        matchId: "seeded-match",
        rulesetVersion: "duel-v1",
        seed: 981723,
        arena: { width: 800, height: 800, durationMs: 1000, obstacles: [] },
        fighters: [
            { userId: "fighter-1", username: "One", slot: 1, x: 100, y: 400, size: 60, model: firstModel },
            { userId: "fighter-2", username: "Two", slot: 2, x: 700, y: 400, size: 60, model: secondModel },
        ],
    };

    const firstResult = await simulateDuelMatch(request);
    const secondResult = await simulateDuelMatch(request);

    assert.deepEqual(secondResult, firstResult);
});

test("generated fight obstacles do not spawn on top of fighters", async () => {
    const firstModel = await createMeleeModelArtifacts(-10, 0);
    const secondModel = await createMeleeModelArtifacts(-10, 0);
    const result = await simulateDuelMatch({
        matchId: "generated-obstacle-spawn-match",
        rulesetVersion: "duel-v1",
        seed: 42,
        arena: { width: 800, height: 800, durationMs: 0 },
        fighters: [
            { userId: "fighter-1", username: "One", slot: 1, x: 240, y: 400, size: 60, model: firstModel },
            { userId: "fighter-2", username: "Two", slot: 2, x: 560, y: 400, size: 60, model: secondModel },
        ],
    });

    for (const obstacle of result.initialState.obstacles) {
        for (const fighter of result.initialState.fighters) {
            const distance = Math.hypot(obstacle.x - fighter.x, obstacle.y - fighter.y);
            assert.ok(distance > (obstacle.size + 60) / 2);
        }
    }
});

test("health packs are consumed when a fighter edge overlaps them", async () => {
    const model = await createMeleeModelArtifacts();
    const result = await simulateDuelMatch({
        matchId: "health-pack-match",
        rulesetVersion: "duel-v1",
        arena: {
            width: 800,
            height: 800,
            durationMs: 100,
            obstacles: [{ id: "object_1", type: "healthPack", x: 100, y: 400, size: 42 }],
        },
        fighters: [
            { userId: "fighter-1", username: "One", slot: 1, x: 100, y: 400, size: 60, model },
            { userId: "fighter-2", username: "Two", slot: 2, x: 700, y: 400, size: 60, model },
        ],
    });

    assert.equal(result.initialState.obstacles.length, 1);
    assert.equal(result.frames[0].obstacles.length, 0);
});

test("damage zones deal entry damage once while the fighter remains inside", async () => {
    const model = await createMeleeModelArtifacts();
    const result = await simulateDuelMatch({
        matchId: "damage-zone-entry-match",
        rulesetVersion: "duel-v1",
        arena: {
            width: 800,
            height: 800,
            durationMs: 200,
            obstacles: [{ id: "object_1", type: "damageZone", x: 100, y: 400, size: 128 }],
        },
        fighters: [
            { userId: "fighter-1", username: "One", slot: 1, x: 100, y: 400, size: 60, model },
            { userId: "fighter-2", username: "Two", slot: 2, x: 700, y: 400, size: 60, model },
        ],
    });

    assert.equal(result.frames[0].fighters[0].hp, 75);
    assert.equal(result.frames[1].fighters[0].hp, 75);
    assert.equal(result.frames[0].fighters[0].inDamageZone, true);
});

test("damage zones increase melee damage taken while inside", async () => {
    const attacker = await createMeleeModelArtifacts(10);
    const passive = await createMeleeModelArtifacts(-10);
    const result = await simulateDuelMatch({
        matchId: "damage-zone-vulnerability-match",
        rulesetVersion: "duel-v1",
        arena: {
            width: 800,
            height: 800,
            durationMs: 100,
            obstacles: [{ id: "object_1", type: "damageZone", x: 470, y: 400, size: 80 }],
        },
        fighters: [
            { userId: "attacker", username: "Attacker", slot: 1, x: 360, y: 400, rotation: 0, size: 60, model: attacker },
            { userId: "target", username: "Target", slot: 2, x: 440, y: 400, rotation: 180, size: 60, model: passive },
        ],
    });

    assert.equal(result.frames[0].fighters[1].hp, 45);
});

test("dash locks a fast direction for one second and then enters cooldown", async () => {
    const dasher = await createMeleeModelArtifacts(-10, 1, 10);
    const stationary = await createMeleeModelArtifacts(-10, 0, -10);
    const result = await simulateDuelMatch({
        matchId: "dash-match",
        rulesetVersion: "duel-v1",
        arena: { width: 800, height: 800, durationMs: 1200, obstacles: [] },
        fighters: [
            {
                userId: "dasher",
                username: "Dash",
                slot: 1,
                x: 100,
                y: 400,
                size: 60,
                model: dasher,
                strategy: {
                    blocks: [{
                        conditions: [{ type: "enemy_distance_gt", value: 100 }],
                        action: "dash",
                    }],
                },
            },
            { userId: "idle", username: "Idle", slot: 2, x: 700, y: 400, size: 60, model: stationary },
        ],
    });
    const xs = result.frames.map((frame) => frame.fighters[0].x);
    assert.equal(xs[0] - 100, 20);
    assert.ok(xs[9] - xs[0] >= 180);
    assert.equal(result.frames[0].fighters[0].dashActive, true);
});

test("dash locks movement but still allows rotation and attacks", async () => {
    const dashingAttacker = await createMeleeModelArtifacts(10, 0, 10, 10);
    const passive = await createMeleeModelArtifacts(-10, 0, -10);
    const result = await simulateDuelMatch({
        matchId: "dash-attack-match",
        rulesetVersion: "duel-v1",
        arena: { width: 800, height: 800, durationMs: 300, obstacles: [] },
        fighters: [
            {
                userId: "dasher",
                username: "Dash",
                slot: 1,
                x: 360,
                y: 400,
                rotation: 0,
                size: 60,
                model: dashingAttacker,
                strategy: {
                    blocks: [{
                        conditions: [{ type: "enemy_distance_gt", value: 10 }],
                        action: "dash",
                    }],
                },
            },
            { userId: "target", username: "Target", slot: 2, x: 440, y: 400, rotation: 180, size: 60, model: passive },
        ],
    });

    assert.equal(result.frames[0].fighters[0].dashActive, true);
    assert.ok(result.frames[0].fighters[0].rotation > 0);
    assert.ok(result.frames[1].fighters[0].rotation > result.frames[0].fighters[0].rotation);
    assert.ok(result.frames[2].fighters[0].rotation > result.frames[1].fighters[0].rotation);
    assert.equal(result.frames[0].fighters[1].hp, 80);
});

test("simulateDuelMatch decodes the highest-probability discrete movement", async () => {
    const movesRight = await createMeleeModelArtifacts(-10, 1);
    const stationary = await createMeleeModelArtifacts(-10, 0);
    const result = await simulateDuelMatch({
        matchId: "movement-match",
        rulesetVersion: "duel-v1",
        arena: { width: 800, height: 800, durationMs: 100, obstacles: [] },
        fighters: [
            { userId: "fighter-1", username: "One", slot: 1, x: 100, y: 400, size: 60, model: movesRight },
            { userId: "fighter-2", username: "Two", slot: 2, x: 700, y: 400, size: 60, model: stationary },
        ],
    });
    assert.ok(result.frames[0].fighters[0].x > 100);
    assert.equal(result.frames[0].fighters[0].y, 400);
});

test("simulateDuelMatch feeds the first matching logic block intent into the model", async () => {
    const intentModel = await createIntentSensitiveModelArtifacts();
    const passive = await createMeleeModelArtifacts(-10, 0);
    const result = await simulateDuelMatch({
        matchId: "intent-router-match",
        rulesetVersion: "duel-v1",
        arena: {
            width: 800,
            height: 800,
            durationMs: 100,
            obstacles: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }],
        },
        fighters: [
            {
                userId: "intent-fighter",
                username: "Intent",
                slot: 1,
                x: 400,
                y: 400,
                size: 60,
                model: intentModel,
                strategy: {
                    blocks: [{
                        conditions: [{ type: "target_exists", target: "object_1" }],
                        action: "move_inward",
                        actionTarget: "object_1",
                    }],
                },
            },
            { userId: "idle", username: "Idle", slot: 2, x: 700, y: 400, size: 60, model: passive },
        ],
    });

    assert.ok(result.frames[0].fighters[0].x < 400);
});

test("simulateDuelMatch lets do-not-dash blocks suppress dash without blocking movement intent", async () => {
    const intentModel = await createIntentSensitiveModelArtifacts(10);
    const passive = await createMeleeModelArtifacts(-10, 0);
    const result = await simulateDuelMatch({
        matchId: "no-dash-fallthrough-match",
        rulesetVersion: "duel-v1",
        arena: {
            width: 800,
            height: 800,
            durationMs: 100,
            obstacles: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }],
        },
        fighters: [
            {
                userId: "intent-fighter",
                username: "Intent",
                slot: 1,
                x: 400,
                y: 400,
                size: 60,
                model: intentModel,
                strategy: {
                    blocks: [
                        {
                            conditions: [{ type: "my_hp_gt", value: 50 }],
                            action: "no_dash",
                        },
                        {
                            conditions: [{ type: "target_exists", target: "object_1" }],
                            action: "move_inward",
                            actionTarget: "object_1",
                        },
                    ],
                },
            },
            { userId: "idle", username: "Idle", slot: 2, x: 700, y: 400, size: 60, model: passive },
        ],
    });

    assert.ok(result.frames[0].fighters[0].x < 400);
    assert.equal(result.frames[0].fighters[0].dashActive, false);
});

test("simulateDuelMatch only allows dash when a dash logic block is active", async () => {
    const eagerDasher = await createMeleeModelArtifacts(-10, 1, 10);
    const passive = await createMeleeModelArtifacts(-10, 0);
    const result = await simulateDuelMatch({
        matchId: "dash-gated-match",
        rulesetVersion: "duel-v1",
        arena: { width: 800, height: 800, durationMs: 100, obstacles: [] },
        fighters: [
            {
                userId: "eager-dasher",
                username: "Dashy",
                slot: 1,
                x: 100,
                y: 400,
                size: 60,
                model: eagerDasher,
                strategy: {
                    blocks: [{
                        conditions: [{ type: "enemy_distance_gt", value: 100 }],
                        action: "move_inward",
                    }],
                },
            },
            { userId: "idle", username: "Idle", slot: 2, x: 700, y: 400, size: 60, model: passive },
        ],
    });

    assert.equal(result.frames[0].fighters[0].dashActive, false);
    assert.equal(result.frames[0].fighters[0].x - 100, 8);
});

test("slot two canonical forward movement points toward slot one", async () => {
    const stationary = await createMeleeModelArtifacts(-10, 0);
    const movesCanonicalRight = await createMeleeModelArtifacts(-10, 1);
    const result = await simulateDuelMatch({
        matchId: "slot-two-movement-match",
        rulesetVersion: "duel-v1",
        arena: { width: 800, height: 800, durationMs: 100, obstacles: [] },
        fighters: [
            { userId: "fighter-1", username: "One", slot: 1, x: 100, y: 400, size: 60, model: stationary },
            { userId: "fighter-2", username: "Two", slot: 2, x: 700, y: 400, size: 60, model: movesCanonicalRight },
        ],
    });
    assert.ok(result.frames[0].fighters[1].x < 700);
    assert.equal(result.frames[0].fighters[1].y, 400);
});

test("simulateDuelMatch awards victory only by winning the fight", async () => {
    const attacker = await createMeleeModelArtifacts(10);
    const passive = await createMeleeModelArtifacts(-10);
    const result = await simulateDuelMatch({
        matchId: "match-2",
        rulesetVersion: "duel-v1",
        arena: { width: 800, height: 800, durationMs: 6000, obstacles: [] },
        fighters: [
            { userId: "fighter-1", username: "One", slot: 1, x: 360, y: 400, rotation: 0, size: 60, model: attacker },
            { userId: "fighter-2", username: "Two", slot: 2, x: 440, y: 400, rotation: 180, size: 60, model: passive },
        ],
    });
    assert.equal(result.result, "FIGHTER_WIN");
    assert.equal(result.winnerUserId, "fighter-1");
    assert.match(result.message, /wins the fight/);
});
