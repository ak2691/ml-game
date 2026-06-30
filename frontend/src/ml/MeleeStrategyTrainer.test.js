import assert from "node:assert/strict";
import test from "node:test";
import * as tf from "@tensorflow/tfjs";
import { cloneCombatModel, createModel } from "./Model.js";
import { predictPolicyAction, trainMeleeStrategy } from "./MeleeStrategyTrainer.js";
import { createLogicBlock, selectMeleeStrategyIntent } from "./MeleeStrategy.js";

test("trains a bounded supervised strategy and disposes dataset tensors", async () => {
    const model = createModel();
    try {
        const metrics = await trainMeleeStrategy(model, {
            blocks: [{
                id: "engage",
                conditions: [{ type: "enemy_distance_gt", value: 100 }],
                action: "move_inward",
                sampleCount: 128,
            }],
            epochLimit: 1,
        }, {
            random: () => 0.5,
            timeLimitMs: 5_000,
        });

        assert.equal(metrics.epochsCompleted, 1);
        assert.equal(metrics.trainingSamples, 102);
        assert.equal(metrics.validationSamples, 26);
        assert.ok(Number.isFinite(metrics.finalLoss));
        assert.ok(Number.isFinite(metrics.validationLoss));
        assert.ok(metrics.headWeightDeltas.movement > 0);
        const tensorsAfterFirstRun = tf.memory().numTensors;

        await trainMeleeStrategy(model, {
            blocks: [{
                id: "retreat",
                conditions: [{ type: "my_hp_lt", value: 50 }, { type: "enemy_rushing" }],
                action: "move_outward",
                sampleCount: 128,
            }],
            epochLimit: 1,
        }, {
            random: () => 0.5,
            timeLimitMs: 5_000,
        });

        // Adam retains optimizer slots, but temporary dataset tensors must not
        // accumulate with each run.
        assert.ok(tf.memory().numTensors <= tensorsAfterFirstRun + 2);
    } finally {
        model.dispose();
    }
});

test("a training attempt changes a checkpoint clone without mutating the checkpoint", async () => {
    const checkpoint = createModel();
    const candidate = cloneCombatModel(checkpoint);
    const checkpointMovementBefore = Array.from(checkpoint.getLayer("movement").getWeights()[0].dataSync());

    try {
        await trainMeleeStrategy(candidate, {
            blocks: [{
                id: "attempt",
                conditions: [{ type: "enemy_distance_gt", value: 100 }],
                action: "move_inward",
                sampleCount: 128,
            }],
            epochLimit: 1,
        }, { random: () => 0.5, timeLimitMs: 5_000 });

        const checkpointMovementAfter = Array.from(checkpoint.getLayer("movement").getWeights()[0].dataSync());
        const candidateMovement = Array.from(candidate.getLayer("movement").getWeights()[0].dataSync());
        assert.deepEqual(checkpointMovementAfter, checkpointMovementBefore);
        assert.notDeepEqual(candidateMovement, checkpointMovementBefore);
    } finally {
        checkpoint.dispose();
        candidate.dispose();
    }
});

test("authored engage-and-swing strategy advances toward a distant enemy and only swings in range", async () => {
    const model = createModel();
    let state = 1000;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const payload = {
        selectedClass: "melee",
        playerModel: {
            x: 400, y: 400, rotation: 0, hp: 100, size: 60,
            swingAvailable: true, swingCooldownRemainingMs: 0,
            blockAvailable: true, blockActive: false,
            blockActiveRemainingMs: 0, blockCooldownRemainingMs: 0,
            dashAvailable: true, dashActive: false, dashCooldownRemainingMs: 0,
        },
        objects: [{
            id: "opponent-model", type: "opponentModel",
            x: 580, y: 400, size: 64, rotation: 180, hp: 100,
            swingActive: false, blockActive: false, velocityX: 0, velocityY: 0,
        }],
    };

    const configuration = {
        epochLimit: 30,
        blocks: [
            createLogicBlock("enemy_distance_gt", "move_inward", 512),
            {
                ...createLogicBlock("enemy_distance_lt", "swing", 512),
                conditions: [
                    { type: "enemy_distance_lt", value: 92 },
                    { type: "my_swing_ready" },
                ],
            },
        ],
    };

    try {
        await trainMeleeStrategy(model, configuration, {
            random,
            timeLimitMs: 15_000,
        });
        const farAction = predictPolicyAction(model, {
            ...payload,
            intent: selectMeleeStrategyIntent(configuration, payload),
        });
        const nearPayload = {
            ...payload,
            objects: [{ ...payload.objects[0], x: 480 }],
        };
        const nearAction = predictPolicyAction(model, {
            ...nearPayload,
            intent: selectMeleeStrategyIntent(configuration, nearPayload),
        });

        assert.ok(farAction.dx > 0, `expected movement toward enemy, received ${farAction.id}`);
        assert.ok(farAction.swing < 0.5);
        assert.ok(nearAction.swing >= 0.5);
    } finally {
        model.dispose();
    }
});
