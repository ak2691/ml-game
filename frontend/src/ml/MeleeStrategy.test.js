import assert from "node:assert/strict";
import test from "node:test";
import {
    ACTION_TYPES,
    actionSupportsTarget,
    createDefaultMeleeStrategyConfiguration,
    createExpressionCondition,
    createLogicCluster,
    createLogicBlock,
    normalizeMeleeStrategyConfiguration,
    radialVelocityTowardPlayer,
    selectMeleeStrategyActionPlan,
    selectMeleeStrategyBlock,
    selectMeleeStrategyIntent,
    shouldAllowMeleeStrategyDash,
    shouldSuppressMeleeStrategyDash,
    validateMeleeStrategyConfiguration,
} from "./MeleeStrategy.js";

function payload(overrides = {}) {
    return {
        playerModel: {
            x: 400,
            y: 400,
            size: 60,
            hp: 80,
            swingAvailable: true,
            blockAvailable: true,
            dashAvailable: true,
            gunAvailable: false,
            ...overrides.playerModel,
        },
        objects: [
            {
                id: "opponent-model",
                type: "opponentModel",
                x: 600,
                y: 400,
                size: 60,
                hp: 100,
                gunAvailable: false,
                velocityX: 0,
                velocityY: 0,
                ...overrides.opponent,
            },
            ...(overrides.objects ?? []),
        ],
    };
}

test("normalizes deterministic logic blocks without training knobs", () => {
    const configuration = normalizeMeleeStrategyConfiguration({
        epochLimit: 999,
        blocks: [{ conditions: [{ type: "my_hp_lt", value: 999 }], action: "move_outward", sampleCount: 99999 }],
    });

    assert.equal(configuration.version, "melee-logic-blocks-v2");
    assert.equal(configuration.epochLimit, undefined);
    assert.equal(configuration.blocks[0].sampleCount, undefined);
    assert.equal(configuration.blocks[0].conditions[0].value, 100);
});

test("default strategy starts empty and requires at least one non-veto action", () => {
    const empty = createDefaultMeleeStrategyConfiguration();
    assert.equal(empty.blocks.length, 0);
    assert.ok(validateMeleeStrategyConfiguration(empty).errors.some((error) => error.includes("action logic")));

    const onlyVeto = { blocks: [createLogicBlock("enemy_distance_gt", "no_dash")] };
    assert.ok(validateMeleeStrategyConfiguration(onlyVeto).errors.some((error) => error.includes("action logic")));
});

test("validation catches contradictory and impossible conditions", () => {
    const contradictory = {
        blocks: [{
            ...createLogicBlock("my_swing_ready", "swing"),
            conditions: [{ type: "my_swing_ready" }, { type: "my_swing_cooldown" }],
        }],
    };
    assert.ok(validateMeleeStrategyConfiguration(contradictory).errors.some((error) => error.includes("contradictory")));

    const impossible = {
        blocks: [{
            ...createLogicBlock("enemy_hp_gt", "swing"),
            conditions: [{ type: "enemy_hp_gt", value: 80 }, { type: "enemy_hp_lt", value: 40 }],
        }],
    };
    assert.ok(validateMeleeStrategyConfiguration(impossible).errors.some((error) => error.includes("opponent HP")));
});

test("first matching non-veto block is the selected priority action", () => {
    const closeRetreat = {
        ...createLogicBlock("enemy_distance_lt", "move_outward"),
        conditions: [{ type: "enemy_distance_lt", value: 250 }],
    };
    const alwaysEngage = {
        ...createLogicBlock("enemy_distance_gt", "move_inward"),
        conditions: [{ type: "enemy_distance_gt", value: 10 }],
    };

    const selected = selectMeleeStrategyBlock({ blocks: [closeRetreat, alwaysEngage] }, payload());
    assert.equal(selected.id, closeRetreat.id);

    const intent = selectMeleeStrategyIntent({ blocks: [closeRetreat, alwaysEngage] }, payload());
    assert.equal(intent.intent, "disengage_target");
});

test("always condition can drive arena-relative movement", () => {
    const north = createLogicBlock("always", "move_north");
    const selected = selectMeleeStrategyBlock({ blocks: [north] }, payload());
    const intent = selectMeleeStrategyIntent({ blocks: [north] }, payload());

    assert.equal(selected.id, north.id);
    assert.equal(intent.intent, "reposition");
    assert.equal(intent.target, "none");
    assert.equal(intent.movementStyle, "north");
});

test("always condition can drive arena-relative dash", () => {
    const northDash = createLogicBlock("always", "dash_north");
    const selected = selectMeleeStrategyBlock({ blocks: [northDash] }, payload());
    const intent = selectMeleeStrategyIntent({ blocks: [northDash] }, payload());

    assert.equal(selected.id, northDash.id);
    assert.equal(intent.intent, "reposition");
    assert.equal(intent.target, "none");
    assert.equal(intent.movementStyle, "north");
    assert.equal(intent.dash, 1);
});

test("lower priority numbers beat higher priority numbers", () => {
    const highPriorityRetreat = {
        ...createLogicBlock("enemy_distance_gt", "move_outward"),
        priority: 1,
        conditions: [{ type: "enemy_distance_gt", value: 10 }],
    };
    const lowerPriorityEngage = {
        ...createLogicBlock("enemy_distance_gt", "move_inward"),
        priority: 5,
        conditions: [{ type: "enemy_distance_gt", value: 10 }],
    };

    const selected = selectMeleeStrategyBlock({ blocks: [lowerPriorityEngage, highPriorityRetreat] }, payload());
    assert.equal(selected.id, highPriorityRetreat.id);
});

test("low-health retreat stays selected over lower-priority distance engage", () => {
    const lowHealthRetreat = {
        ...createLogicBlock("my_hp_lt", "move_outward"),
        priority: 1,
        conditions: [{ type: "my_hp_lt", value: 50 }],
    };
    const distanceEngage = {
        ...createLogicBlock("enemy_distance_gt", "move_inward"),
        priority: 2,
        conditions: [{ type: "enemy_distance_gt", value: 10 }],
    };

    const plan = selectMeleeStrategyActionPlan({
        blocks: [lowHealthRetreat, distanceEngage],
    }, payload({ playerModel: { hp: 30 } }));

    assert.equal(plan.movement.id, lowHealthRetreat.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [lowHealthRetreat, distanceEngage],
    }, payload({ playerModel: { hp: 30 } })).intent, "disengage_target");
});

test("same-priority movement and dash blocks merge by action head", () => {
    const moveBlock = createLogicBlock("enemy_distance_gt", "move_inward");
    const dashBlock = createLogicBlock("enemy_distance_gt", "dash");
    const plan = selectMeleeStrategyActionPlan({ blocks: [moveBlock, dashBlock] }, payload());

    assert.equal(plan.movement.id, moveBlock.id);
    assert.equal(plan.dash.id, dashBlock.id);
    assert.equal(selectMeleeStrategyIntent({ blocks: [moveBlock, dashBlock] }, payload()).dash, 1);
});

test("cluster conditions and cluster priority gate nested logic blocks", () => {
    const fallback = createLogicBlock("enemy_distance_gt", "move_inward");
    const cluster = {
        ...createLogicCluster("my_hp_lt"),
        priority: 1,
        conditions: [{ type: "my_hp_lt", value: 50 }],
        blocks: [createLogicBlock("target_health_pack", "move_inward")],
    };
    cluster.blocks[0].actionTarget = "object_1";
    cluster.blocks[0].conditions = [{ type: "target_health_pack", target: "object_1" }];

    const selectedHealthy = selectMeleeStrategyBlock({
        blocks: [{ ...fallback, priority: 5 }],
        clusters: [cluster],
    }, payload({ objects: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }] }));
    assert.equal(selectedHealthy.id, fallback.id);

    const selectedLowHp = selectMeleeStrategyBlock({
        blocks: [{ ...fallback, priority: 5 }],
        clusters: [cluster],
    }, payload({
        playerModel: { hp: 30 },
        objects: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }],
    }));
    assert.equal(selectedLowHp.id, cluster.blocks[0].id);
});

test("cluster blocks can inherit the cluster condition without their own IF condition", () => {
    const cluster = {
        ...createLogicCluster("my_hp_lt"),
        conditions: [{ type: "my_hp_lt", value: 50 }],
        blocks: [{
            ...createLogicBlock("enemy_distance_gt", "move_outward"),
            conditions: [],
        }],
    };

    const normalized = normalizeMeleeStrategyConfiguration({ clusters: [cluster] });
    assert.equal(normalized.clusters[0].blocks[0].conditions.length, 0);

    const selected = selectMeleeStrategyBlock({ clusters: [cluster] }, payload({ playerModel: { hp: 30 } }));
    assert.equal(selected.id, cluster.blocks[0].id);
});

test("do-not-dash suppresses dash without replacing movement intent", () => {
    const noDashBlock = createLogicBlock("my_hp_gt", "no_dash");
    const moveBlock = createLogicBlock("enemy_distance_gt", "move_inward");
    const configuration = { blocks: [noDashBlock, moveBlock] };

    const intent = selectMeleeStrategyIntent(configuration, payload());
    assert.equal(shouldSuppressMeleeStrategyDash(configuration, payload()), true);
    assert.equal(intent.intent, "engage_target");
    assert.equal(intent.dash, 0);
});

test("opponent cooldown conditionals read opponent ability state", () => {
    const punishCooldown = createLogicBlock("opponent_dash_cooldown", "move_inward");
    const selected = selectMeleeStrategyBlock({
        blocks: [punishCooldown],
    }, payload({
        opponent: {
            dashAvailable: false,
        },
    }));

    assert.equal(selected.id, punishCooldown.id);
});

test("fire gun conditionals select the ranged action head", () => {
    const fireWhenReady = createLogicBlock("my_fire_gun_ready", "fire_gun");
    const plan = selectMeleeStrategyActionPlan({
        blocks: [fireWhenReady],
    }, payload({
        playerModel: {
            gunAvailable: true,
        },
    }));

    assert.equal(plan.gun.id, fireWhenReady.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [fireWhenReady],
    }, payload({
        playerModel: {
            gunAvailable: true,
        },
    })).intent, "attack_target");
});

test("grenade conditionals select the ranged grenade action head", () => {
    const throwWhenReady = createLogicBlock("my_grenade_ready", "throw_grenade");
    const plan = selectMeleeStrategyActionPlan({
        blocks: [throwWhenReady],
    }, payload({
        playerModel: {
            grenadeAvailable: true,
        },
    }));

    assert.equal(plan.grenade.id, throwWhenReady.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [throwWhenReady],
    }, payload({
        playerModel: {
            grenadeAvailable: true,
        },
    })).intent, "attack_target");
});

test("dash is allowed only when a matching dash block owns the action and no veto matches", () => {
    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [createLogicBlock("enemy_distance_gt", "move_inward")],
    }, payload()), false);

    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [createLogicBlock("enemy_distance_gt", "dash")],
    }, payload()), true);

    const dashBlock = createLogicBlock("enemy_distance_gt", "dash");
    const vetoBlock = { ...createLogicBlock("my_hp_gt", "no_dash"), priority: 1 };
    assert.equal(shouldAllowMeleeStrategyDash({
        blocks: [dashBlock, vetoBlock],
    }, payload()), false);
});

test("object target conditions select rules against specific object slots", () => {
    const healthPackRule = {
        ...createLogicBlock("target_health_pack", "move_inward"),
        conditions: [{ type: "target_health_pack", target: "object_1" }],
        actionTarget: "object_1",
    };
    const selected = selectMeleeStrategyBlock({
        blocks: [healthPackRule],
    }, payload({ objects: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }] }));

    assert.equal(selected.id, healthPackRule.id);
});

test("opponent grenade can be used as a condition and movement target", () => {
    const grenadeObject = {
        id: "grenade-opponent-model-1",
        type: "grenade",
        ownerId: "opponent-model",
        x: 500,
        y: 400,
        size: 12,
    };
    const dodgeGrenade = {
        ...createLogicBlock("target_exists", "move_outward"),
        conditions: [{ type: "target_exists", target: "opponent_grenade" }],
        actionTarget: "opponent_grenade",
    };
    const selected = selectMeleeStrategyBlock({
        blocks: [dodgeGrenade],
    }, payload({ objects: [grenadeObject] }));

    assert.equal(selected.id, dodgeGrenade.id);
    assert.equal(selectMeleeStrategyIntent({ blocks: [dodgeGrenade] }, payload({ objects: [grenadeObject] })).target, "opponent_grenade");
});

test("opponent grenade expression variables resolve from target selectors", () => {
    const grenadeNear = {
        ...createLogicBlock("always", "move_outward"),
        conditions: [{
            type: "expression",
            left: "target.exists",
            comparator: "eq",
            target: "opponent_grenade",
            right: { type: "boolean", value: true },
        }],
        actionTarget: "opponent_grenade",
    };

    assert.equal(selectMeleeStrategyBlock({ blocks: [grenadeNear] }, payload({
        objects: [{
            id: "grenade-opponent-model-1",
            type: "grenade",
            ownerId: "opponent-model",
            x: 500,
            y: 400,
            size: 12,
        }],
    })).id, grenadeNear.id);
});

test("edge-distance conditionals replace cornered rules with less-than and greater-than options", () => {
    const safeAtCenter = {
        ...createLogicBlock("my_edge_distance_gt", "move_inward"),
        conditions: [{ type: "my_edge_distance_gt", value: 250 }],
    };
    const nearEdgeTarget = {
        ...createLogicBlock("target_edge_distance_lt", "move_outward"),
        conditions: [{ type: "target_edge_distance_lt", value: 60 }],
    };

    assert.equal(selectMeleeStrategyBlock({
        blocks: [safeAtCenter],
    }, payload({ playerModel: { x: 400, y: 400 } })).id, safeAtCenter.id);

    assert.equal(selectMeleeStrategyBlock({
        blocks: [nearEdgeTarget],
    }, payload({ opponent: { x: 45, y: 400 } })).id, nearEdgeTarget.id);

    const legacy = normalizeMeleeStrategyConfiguration({
        blocks: [{ conditions: [{ type: "my_cornered", value: 80 }], action: "move_outward" }],
    });
    assert.equal(legacy.blocks[0].conditions[0].type, "my_edge_distance_lt");
});

test("inside damage zone conditions match overlapping damage zones", () => {
    const rule = createLogicBlock("inside_damage_zone", "move_outward");
    const selected = selectMeleeStrategyBlock({
        blocks: [rule],
    }, payload({ objects: [{ id: "object_1", type: "damageZone", x: 400, y: 400, size: 128 }] }));

    assert.equal(selected.id, rule.id);
});

test("expression conditions compare state variables and numeric literals", () => {
    const lowHp = {
        ...createLogicBlock("always", "move_outward"),
        conditions: [{
            type: "expression",
            left: "my.hp",
            comparator: "lt",
            right: { type: "variable", value: "opponent.hp" },
        }],
    };
    const farTarget = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{
            type: "expression",
            left: "target.distance",
            comparator: "gte",
            right: { type: "number", value: 200 },
        }],
    };

    assert.equal(selectMeleeStrategyBlock({ blocks: [lowHp] }, payload({ playerModel: { hp: 40 }, opponent: { hp: 60 } })).id, lowHp.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [farTarget] }, payload()).id, farTarget.id);
});

test("expression conditions normalize and compare boolean variables", () => {
    const ready = createExpressionCondition("my.dashReady");
    assert.deepEqual(ready.right, { type: "boolean", value: true });
    const dashWhenReady = {
        ...createLogicBlock("always", "dash"),
        conditions: [ready],
    };
    const waitWhenOff = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "my.dashReady",
            comparator: "eq",
            right: { type: "boolean", value: false },
        }],
    };

    assert.equal(selectMeleeStrategyBlock({ blocks: [dashWhenReady] }, payload({ playerModel: { dashAvailable: true } })).id, dashWhenReady.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [waitWhenOff] }, payload({ playerModel: { dashAvailable: false } })).id, waitWhenOff.id);
});

test("rushing and fleeing use signed velocity toward the player", () => {
    const player = { x: 100, y: 100 };
    const opponent = { x: 200, y: 100, velocityX: -80, velocityY: 0 };
    assert.equal(radialVelocityTowardPlayer(player, opponent), 80);
    opponent.velocityX = 80;
    assert.equal(radialVelocityTowardPlayer(player, opponent), -80);
});

test("target support is limited to directional and dash-like actions", () => {
    const move = ACTION_TYPES.find((action) => action.id === "move_inward");
    const north = ACTION_TYPES.find((action) => action.id === "move_north");
    const dash = ACTION_TYPES.find((action) => action.id === "dash");
    const dashNorth = ACTION_TYPES.find((action) => action.id === "dash_north");
    const stop = ACTION_TYPES.find((action) => action.id === "move_stop");
    const noDash = ACTION_TYPES.find((action) => action.id === "no_dash");

    assert.equal(actionSupportsTarget(move), true);
    assert.equal(actionSupportsTarget(north), false);
    assert.equal(actionSupportsTarget(dash), true);
    assert.equal(actionSupportsTarget(dashNorth), false);
    assert.equal(actionSupportsTarget(stop), false);
    assert.equal(actionSupportsTarget(noDash), false);
});
