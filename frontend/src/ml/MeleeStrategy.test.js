import assert from "node:assert/strict";
import test from "node:test";
import {
    ACTION_TYPES,
    CONDITION_TYPES,
    actionSupportsTarget,
    createDefaultMeleeStrategyConfiguration,
    createLogicBlock,
    createMeleeStrategyExample,
    generateMeleeStrategyDataset,
    MAX_STRATEGY_EXAMPLES,
    normalizeMeleeStrategyConfiguration,
    radialVelocityTowardPlayer,
    selectMeleeStrategyIntent,
    shouldAllowMeleeStrategyDash,
    shouldSuppressMeleeStrategyDash,
    strategyExampleCount,
    validateMeleeStrategyConfiguration,
} from "./MeleeStrategy.js";
import { INTENT_FEATURE_OFFSET } from "./Featurebuilder.js";
import { movementVectorToActionIndex } from "./MovementActions.js";

const middleRandom = () => 0.5;

test("normalizes logic-block limits and enforces the total sample budget", () => {
    const configuration = normalizeMeleeStrategyConfiguration({
        epochLimit: 999,
        blocks: [{ conditions: [{ type: "my_hp_lt", value: 999 }], action: "move_outward", sampleCount: 99999 }],
    });
    assert.equal(configuration.blocks[0].conditions[0].value, 100);
    assert.equal(configuration.blocks[0].sampleCount, MAX_STRATEGY_EXAMPLES);
    assert.equal(validateMeleeStrategyConfiguration(configuration).errors.length, 0);

    const overBudget = { ...configuration, blocks: [...configuration.blocks, createLogicBlock()] };
    assert.ok(validateMeleeStrategyConfiguration(overBudget).errors.some((error) => error.includes("allocate")));
});

test("AND blocks generate matching HP and rushing examples", () => {
    const block = {
        ...createLogicBlock("my_hp_lt", "move_outward", 32),
        conditions: [{ type: "my_hp_lt", value: 50 }, { type: "enemy_rushing" }],
    };
    const example = createMeleeStrategyExample(block, 1, middleRandom);
    assert.equal(example.diagnostics.matched, true);
    assert.ok(example.input[13] < 0.5);
    assert.ok(example.diagnostics.radialVelocity > 20);
});

test("HP-above conditions generate matching examples and reject impossible ranges", () => {
    const block = {
        ...createLogicBlock("my_hp_gt", "move_inward", 32),
        conditions: [{ type: "my_hp_gt", value: 70 }],
    };
    const example = createMeleeStrategyExample(block, 1, middleRandom);
    assert.equal(example.diagnostics.matched, true);
    assert.ok(example.input[13] > 0.7);

    const impossible = {
        blocks: [{
            ...createLogicBlock("enemy_hp_gt", "swing", 32),
            conditions: [{ type: "enemy_hp_gt", value: 80 }, { type: "enemy_hp_lt", value: 40 }],
        }],
    };
    assert.ok(validateMeleeStrategyConfiguration(impossible).errors.some((error) => error.includes("enemy HP")));
});

test("rushing and fleeing use signed velocity projected onto enemy-to-player sightline", () => {
    const player = { x: 100, y: 100 };
    const opponent = { x: 200, y: 100, velocityX: -80, velocityY: 0 };
    assert.equal(radialVelocityTowardPlayer(player, opponent), 80);
    opponent.velocityX = 80;
    assert.equal(radialVelocityTowardPlayer(player, opponent), -80);
    opponent.velocityX = 0;
    opponent.velocityY = 80;
    assert.equal(radialVelocityTowardPlayer(player, opponent), 0);
});

test("dataset preserves each block's dedicated sample allocation with an 80/20 split", () => {
    const configuration = {
        ...createDefaultMeleeStrategyConfiguration(),
        blocks: [createLogicBlock("enemy_distance_gt", "move_inward", 64)],
    };
    const dataset = generateMeleeStrategyDataset(configuration, { random: middleRandom });
    const total = configuration.blocks.reduce((sum, block) => sum + block.sampleCount, 0);
    assert.equal(dataset.training.length + dataset.validation.length, total);
    assert.equal(dataset.validation.length, Math.ceil(total / 5));
});

test("default strategy starts empty so players author their own trainable logic", () => {
    const configuration = createDefaultMeleeStrategyConfiguration();
    assert.equal(configuration.blocks.length, 0);
    assert.ok(validateMeleeStrategyConfiguration(configuration).errors.some((error) => error.includes("trainable")));
});

test("every supported conditional can generate a matching positive example", () => {
    let state = 123456789;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    for (const condition of CONDITION_TYPES) {
        const block = createLogicBlock(condition.id, "move_stop", 32);
        const example = createMeleeStrategyExample(block, 1, random);
        assert.equal(example.diagnostics.matched, true, condition.id);
    }
});

test("each block reserves contrast examples where its condition is false", () => {
    let state = 987654321;
    const random = () => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        return state / 4294967296;
    };
    for (const condition of CONDITION_TYPES) {
        const block = createLogicBlock(condition.id, "move_stop", 32);
        const example = createMeleeStrategyExample(block, 0, random);
        assert.equal(example.diagnostics.matched, false, condition.id);
    }
});

test("binary rules balance active and inactive labels while movement rules avoid a dominant stop class", () => {
    const movement = createLogicBlock("enemy_distance_gt", "move_inward", 32);
    const swing = createLogicBlock("enemy_distance_lt", "swing", 32);
    const movementExamples = Array.from({ length: 62 }, (_, index) => createMeleeStrategyExample(movement, index, middleRandom));
    const swingExamples = Array.from({ length: 32 }, (_, index) => createMeleeStrategyExample(swing, index, middleRandom));

    assert.equal(movementExamples.filter((example) => example.targets.movementIndex === 0).length, 2);
    assert.equal(swingExamples.filter((example) => example.targets.swing[0] === 0).length, 16);
});

test("rotate-toward-enemy examples target the signed shortest turn", () => {
    let state = 246813579;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const block = createLogicBlock("enemy_distance_gt", "rotate_toward_enemy", 32);
    const example = createMeleeStrategyExample(block, 1, random);
    const playerRotation = example.input[0] * 360;
    const enemyBearing = Math.atan2(example.input[8], example.input[7]) * 180 / Math.PI;
    const delta = ((enemyBearing - playerRotation + 540) % 360) - 180;
    const expected = Math.max(-1, Math.min(1, delta / 90));

    assert.ok(Math.abs(example.targets.rotation[0] - expected) < 1e-6);
    assert.notEqual(example.targets.rotation[0], 0);
});

test("dash direction actions pair dash activation with a movement target", () => {
    const block = createLogicBlock("enemy_distance_gt", "dash_outward", 32);
    const example = createMeleeStrategyExample(block, 1, middleRandom);
    assert.equal(example.trainHead, "dash");
    assert.equal(example.targets.dash[0], 1);
    assert.notEqual(example.targets.movementIndex, 0);
});

test("do-not-dash blocks are veto rules, not trainable examples", () => {
    const block = createLogicBlock("enemy_distance_gt", "no_dash", 256);
    const noDashAction = ACTION_TYPES.find((action) => action.id === "no_dash");
    const configuration = { blocks: [block] };

    assert.equal(strategyExampleCount(configuration), 0);
    assert.equal(actionSupportsTarget(noDashAction), false);
    assert.ok(validateMeleeStrategyConfiguration(configuration).errors.some((error) => error.includes("trainable")));
});

test("do-not-dash blocks suppress dash while movement intent comes from normal blocks", () => {
    const noDashBlock = createLogicBlock("my_hp_gt", "no_dash", 32);
    const moveBlock = createLogicBlock("enemy_distance_gt", "move_inward", 32);
    const payload = {
        playerModel: {
            x: 400, y: 400, size: 60, hp: 80,
            swingAvailable: true, blockAvailable: true, dashAvailable: true,
        },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, size: 60, hp: 100 }],
    };
    const configuration = { blocks: [noDashBlock, moveBlock] };
    const intent = selectMeleeStrategyIntent(configuration, payload);

    assert.equal(shouldSuppressMeleeStrategyDash(configuration, payload), true);
    assert.equal(intent.intent, "engage_target");
    assert.equal(intent.movementStyle, "direct_in");
    assert.equal(intent.dash, 0);
});

test("dash is only allowed when a matching dash block owns the active intent", () => {
    const payload = {
        playerModel: {
            x: 400, y: 400, size: 60, hp: 80,
            swingAvailable: true, blockAvailable: true, dashAvailable: true,
        },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, size: 60, hp: 100 }],
    };

    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [createLogicBlock("enemy_distance_gt", "move_inward", 32)],
    }, payload), false);

    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [createLogicBlock("enemy_distance_gt", "dash", 32)],
    }, payload), true);

    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [
            createLogicBlock("enemy_distance_gt", "dash", 32),
            createLogicBlock("my_hp_gt", "no_dash", 32),
        ],
    }, payload), false);
});

test("dash contrast examples use the fallback no-dash intent when conditions are false", () => {
    const block = {
        ...createLogicBlock("my_hp_lt", "dash", 32),
        conditions: [{ type: "my_hp_lt", value: 50 }, { type: "target_exists", target: "object_1" }],
        actionTarget: "object_1",
    };
    const positive = createMeleeStrategyExample(block, 1, middleRandom);
    const contrast = createMeleeStrategyExample(block, 0, middleRandom);
    const dashIntentOffset = INTENT_FEATURE_OFFSET + 28;

    assert.equal(positive.diagnostics.matched, true);
    assert.equal(positive.targets.dash[0], 1);
    assert.equal(positive.input[dashIntentOffset], 1);
    assert.equal(contrast.diagnostics.matched, false);
    assert.equal(contrast.targets.dash[0], 0);
    assert.equal(contrast.input[dashIntentOffset], 0);
});

test("contrast examples fall through to the next matching block intent", () => {
    const engageBlock = createLogicBlock("enemy_distance_gt", "move_inward", 32);
    const swingBlock = {
        ...createLogicBlock("enemy_distance_lt", "swing", 32),
        conditions: [{ type: "enemy_distance_lt", value: 92 }, { type: "my_swing_ready" }],
    };
    const contrast = createMeleeStrategyExample(swingBlock, 0, middleRandom, [engageBlock, swingBlock]);

    assert.equal(contrast.diagnostics.matched, false);
    assert.equal(contrast.input[INTENT_FEATURE_OFFSET + 1], 1);
    assert.equal(contrast.input[INTENT_FEATURE_OFFSET + 17 + 1], 1);
    assert.equal(contrast.targets.swing[0], 0);
});

test("movement actions can target a specific obstacle slot", () => {
    const block = {
        ...createLogicBlock("target_health_pack", "move_inward", 32),
        conditions: [{ type: "target_health_pack", target: "object_1" }],
        actionTarget: "object_1",
    };
    const example = createMeleeStrategyExample(block, 1, middleRandom);
    const objectDx = example.input[29];
    const objectDy = example.input[30];

    assert.equal(example.diagnostics.actionTarget, "object_1");
    assert.equal(example.input[27], 1);
    assert.equal(example.targets.movementIndex, movementVectorToActionIndex(objectDx, objectDy));
    assert.equal(example.input[INTENT_FEATURE_OFFSET + 4], 1);
    assert.equal(example.input[INTENT_FEATURE_OFFSET + 10 + 2], 1);
});

test("selects intent from the first matching logic block", () => {
    const payload = {
        playerModel: {
            x: 400,
            y: 400,
            size: 60,
            hp: 40,
            swingAvailable: true,
            blockAvailable: true,
            dashAvailable: true,
        },
        objects: [
            { id: "opponent-model", type: "opponentModel", x: 500, y: 400, size: 60, hp: 100 },
            { id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 },
        ],
    };
    const intent = selectMeleeStrategyIntent({
        blocks: [
            {
                conditions: [{ type: "my_hp_lt", value: 50 }, { type: "target_exists", target: "object_1" }],
                action: "move_inward",
                actionTarget: "object_1",
            },
            {
                conditions: [{ type: "enemy_distance_lt", value: 200 }],
                action: "move_inward",
                actionTarget: "opponent",
            },
        ],
    }, payload);

    assert.equal(intent.intent, "seek_object");
    assert.equal(intent.target, "object_1");
    assert.equal(intent.movementStyle, "direct_in");
});

test("do-not-dash does not need to be ordered before movement to suppress dash", () => {
    const payload = {
        playerModel: {
            x: 400, y: 400, size: 60, hp: 80,
            swingAvailable: true, blockAvailable: true, dashAvailable: true,
        },
        objects: [{ id: "opponent-model", type: "opponentModel", x: 600, y: 400, size: 60, hp: 100 }],
    };
    const intent = selectMeleeStrategyIntent({
        blocks: [
            {
                ...createLogicBlock("enemy_distance_gt", "move_inward", 32),
                conditions: [{ type: "enemy_distance_gt", value: 100 }],
            },
            {
                ...createLogicBlock("my_hp_gt", "no_dash", 32),
                conditions: [{ type: "my_hp_gt", value: 50 }],
            },
        ],
    }, payload);
    const suppress = shouldSuppressMeleeStrategyDash({
        blocks: [
            {
                ...createLogicBlock("enemy_distance_gt", "move_inward", 32),
                conditions: [{ type: "enemy_distance_gt", value: 100 }],
            },
            {
                ...createLogicBlock("my_hp_gt", "no_dash", 32),
                conditions: [{ type: "my_hp_gt", value: 50 }],
            },
        ],
    }, payload);

    assert.equal(intent.intent, "engage_target");
    assert.equal(intent.movementStyle, "direct_in");
    assert.equal(intent.dash, 0);
    assert.equal(suppress, true);
});

test("object-exists conditions generate examples with and without the requested slot", () => {
    const block = {
        ...createLogicBlock("target_exists", "move_stop", 32),
        conditions: [{ type: "target_exists", target: "object_3" }],
    };
    const positive = createMeleeStrategyExample(block, 1, middleRandom);
    const contrast = createMeleeStrategyExample(block, 0, middleRandom);

    assert.equal(positive.diagnostics.matched, true);
    assert.equal(positive.input[26 + 2 * 6], 1);
    assert.equal(contrast.diagnostics.matched, false);
    assert.equal(contrast.input[26 + 2 * 6], 0);
});

test("object-missing conditions generate examples with and without the requested slot", () => {
    const block = {
        ...createLogicBlock("target_missing", "move_stop", 32),
        conditions: [{ type: "target_missing", target: "object_3" }],
    };
    const positive = createMeleeStrategyExample(block, 1, middleRandom);
    const contrast = createMeleeStrategyExample(block, 0, middleRandom);

    assert.equal(positive.diagnostics.matched, true);
    assert.equal(positive.input[26], 1);
    assert.equal(positive.input[26 + 2 * 6], 0);
    assert.equal(contrast.diagnostics.matched, false);
    assert.equal(contrast.input[26 + 2 * 6], 1);
});
