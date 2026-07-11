import assert from "node:assert/strict";
import test from "node:test";
import {
    ACTION_TYPES,
    CONDITION_TYPES,
    actionSupportsTarget,
    createDefaultMeleeStrategyConfiguration,
    createExpressionCondition,
    createLogicCluster,
    createLogicBlock,
    normalizeMeleeStrategyConfiguration,
    radialVelocityTowardPlayer,
    resolveMeleeStrategyTarget,
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

test("dash blocks do not keep moving while dash is on cooldown", () => {
    const grenadeObject = {
        id: "grenade-opponent-model-1",
        type: "grenade",
        ownerId: "opponent-model",
        x: 500,
        y: 400,
        size: 12,
    };
    const dodgeGrenade = {
        ...createLogicBlock("target_exists", "dash_tangent_right"),
        conditions: [{ type: "target_exists", target: "opponent_grenade" }],
        actionTarget: "opponent_grenade",
    };
    const readyPlan = selectMeleeStrategyActionPlan({ blocks: [dodgeGrenade] }, payload({
        playerModel: { dashAvailable: true },
        objects: [grenadeObject],
    }));
    const cooldownPlan = selectMeleeStrategyActionPlan({ blocks: [dodgeGrenade] }, payload({
        playerModel: { dashAvailable: false },
        objects: [grenadeObject],
    }));

    assert.equal(readyPlan.dash.id, dodgeGrenade.id);
    assert.equal(readyPlan.dashMovement.id, dodgeGrenade.id);
    assert.equal(cooldownPlan.dash, undefined);
    assert.equal(cooldownPlan.dashMovement, undefined);
    assert.equal(shouldAllowMeleeStrategyDash({ blocks: [dodgeGrenade] }, payload({
        playerModel: { dashAvailable: false },
        objects: [grenadeObject],
    })), false);
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

test("fireball conditionals select the mage fireball action head", () => {
    const shootWhenReady = createLogicBlock("my_fireball_ready", "shoot_fireball");
    const plan = selectMeleeStrategyActionPlan({
        blocks: [shootWhenReady],
    }, payload({
        playerModel: {
            fireballAvailable: true,
            fireballCharges: 4,
        },
    }));

    assert.equal(plan.fireball.id, shootWhenReady.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [shootWhenReady],
    }, payload({
        playerModel: {
            fireballAvailable: true,
            fireballCharges: 4,
        },
    })).intent, "attack_target");
});

test("stun conditionals select the mage stun action head", () => {
    const stunWhenReady = createLogicBlock("my_stun_ready", "stun");
    const plan = selectMeleeStrategyActionPlan({
        blocks: [stunWhenReady],
    }, payload({
        playerModel: {
            stunAvailable: true,
        },
    }));

    assert.equal(plan.stun.id, stunWhenReady.id);
    assert.equal(selectMeleeStrategyIntent({
        blocks: [stunWhenReady],
    }, payload({
        playerModel: {
            stunAvailable: true,
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
    assert.equal(selectMeleeStrategyIntent({ blocks: [healthPackRule] }, payload({
        objects: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }],
    })).target, "object_1");
    assert.equal(resolveMeleeStrategyTarget(payload({
        objects: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }],
    }), "object_1")?.type, "healthPack");
});

test("all arena object types can be movement targets", () => {
    const targetableObjects = [
        ["object_center", "radarJammer"],
        ["object_center", "commandLock"],
        ["object_buff_1", "overdrive"],
        ["object_buff_2", "barrier"],
        ["object_buff_1", "inhibition"],
        ["object_1", "healthPack"],
        ["object_1", "projectileWall"],
        ["object_1", "bouncyWall"],
    ];

    for (const [targetId, type] of targetableObjects) {
        const rule = {
            ...createLogicBlock("target_exists", "move_inward"),
            conditions: [{ type: "target_exists", target: targetId }],
            actionTarget: targetId,
        };
        const state = payload({
            playerModel: { x: 100, y: 400 },
            objects: [{ id: targetId, type, x: 500, y: 400, size: 76 }],
        });

        assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, state)?.id, rule.id);
        assert.equal(selectMeleeStrategyIntent({ blocks: [rule] }, state).target, targetId);
        assert.equal(resolveMeleeStrategyTarget(state, targetId)?.type, type);
    }
});

test("object compare conditions preserve health pack movement targets", () => {
    const healthPackRule = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{
            type: "expression",
            left: "target.isHealthPack",
            comparator: "eq",
            right: { type: "boolean", value: true },
            target: "object_1",
        }],
        actionTarget: "object_1",
    };
    const state = payload({
        playerModel: { x: 100, y: 400 },
        objects: [{ id: "object_1", type: "healthPack", x: 300, y: 400, size: 42 }],
    });

    assert.equal(selectMeleeStrategyBlock({ blocks: [healthPackRule] }, state)?.id, healthPackRule.id);
    assert.equal(selectMeleeStrategyIntent({ blocks: [healthPackRule] }, state).target, "object_1");
    assert.equal(resolveMeleeStrategyTarget(state, "object_1")?.type, "healthPack");
});

test("center objective targets remain valid movement targets", () => {
    const jammerRule = {
        ...createLogicBlock("target_exists", "move_inward"),
        conditions: [{ type: "target_exists", target: "object_center" }],
        actionTarget: "object_center",
    };
    const state = payload({
        playerModel: { x: 100, y: 400 },
        objects: [{ id: "object_center", type: "radarJammer", x: 400, y: 400, size: 92 }],
    });

    assert.equal(selectMeleeStrategyBlock({ blocks: [jammerRule] }, state).id, jammerRule.id);
    assert.equal(selectMeleeStrategyIntent({ blocks: [jammerRule] }, state).target, "object_center");

    const compareJammerRule = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{
            type: "expression",
            left: "target.exists",
            comparator: "eq",
            right: { type: "boolean", value: true },
            target: "object_center",
        }],
        actionTarget: "object_center",
    };
    assert.equal(selectMeleeStrategyBlock({ blocks: [compareJammerRule] }, state).id, compareJammerRule.id);
    assert.equal(selectMeleeStrategyIntent({ blocks: [compareJammerRule] }, state).target, "object_center");
});

test("projectile walls are targetable arena objects", () => {
    const wallRule = {
        ...createLogicBlock("target_projectile_wall", "move_inward"),
        conditions: [{ type: "target_projectile_wall", target: "object_1" }],
        actionTarget: "object_1",
    };
    const selected = selectMeleeStrategyBlock({
        blocks: [wallRule],
    }, payload({
        objects: [{
            id: "object_1",
            type: "projectileWall",
            x: 500,
            y: 300,
            size: 120,
        }],
    }));

    assert.equal(selected?.id, wallRule.id);
});

test("bouncy walls are targetable arena objects", () => {
    const wallRule = {
        ...createLogicBlock("target_bouncy_wall", "move_inward"),
        conditions: [{ type: "target_bouncy_wall", target: "object_1" }],
        actionTarget: "object_1",
    };
    const selected = selectMeleeStrategyBlock({
        blocks: [wallRule],
    }, payload({
        objects: [{
            id: "object_1",
            type: "bouncyWall",
            x: 500,
            y: 300,
            size: 120,
            rotation: 45,
        }],
    }));

    assert.equal(selected?.id, wallRule.id);
});

test("wall compare conditions preserve projectile and bouncy wall movement targets", () => {
    for (const [type, variable] of [
        ["projectileWall", "target.isProjectileWall"],
        ["bouncyWall", "target.isBouncyWall"],
    ]) {
        const wallRule = {
            ...createLogicBlock("always", "move_inward"),
            conditions: [{
                type: "expression",
                left: variable,
                comparator: "eq",
                right: { type: "boolean", value: true },
                target: "object_1",
            }],
            actionTarget: "object_1",
        };
        const state = payload({
            playerModel: { x: 100, y: 300 },
            objects: [{
                id: "object_1",
                type,
                x: 500,
                y: 300,
                size: 120,
            }],
        });

        assert.equal(selectMeleeStrategyBlock({ blocks: [wallRule] }, state)?.id, wallRule.id);
        assert.equal(selectMeleeStrategyIntent({ blocks: [wallRule] }, state).target, "object_1");
        assert.equal(resolveMeleeStrategyTarget(state, "object_1")?.type, type);
    }
});

test("opponent object distance conditions measure from the opponent", () => {
    const nearObjectRule = {
        ...createLogicBlock("opponent_object_distance_lt", "move_stop"),
        conditions: [{
            type: "opponent_object_distance_lt",
            value: 75,
            target: "object_1",
        }],
    };
    const selected = selectMeleeStrategyBlock({
        blocks: [nearObjectRule],
    }, payload({
        opponent: { x: 600, y: 400 },
        objects: [{
            id: "object_1",
            type: "healthPack",
            x: 650,
            y: 400,
            size: 40,
        }],
    }));

    assert.equal(selected?.id, nearObjectRule.id);
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
    assert.equal(resolveMeleeStrategyTarget({
        objects: payload({ objects: [grenadeObject] }).objects,
        opponent: { id: "opponent-model" },
        obstacles: [],
    }, "opponent_grenade")?.id, grenadeObject.id);
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

test("opponent fireball target resolves the closest opponent fireball", () => {
    const farFireball = {
        id: "fireball-opponent-model-1",
        type: "fireball",
        ownerId: "opponent-model",
        x: 700,
        y: 400,
        size: 30,
    };
    const closeFireball = {
        id: "fireball-opponent-model-2",
        type: "fireball",
        ownerId: "opponent-model",
        x: 430,
        y: 400,
        size: 30,
    };
    const dodgeFireball = {
        ...createLogicBlock("target_exists", "move_outward"),
        conditions: [{ type: "target_exists", target: "opponent_fireball" }],
        actionTarget: "opponent_fireball",
    };
    const statePayload = payload({ objects: [farFireball, closeFireball] });

    assert.equal(selectMeleeStrategyBlock({ blocks: [dodgeFireball] }, statePayload).id, dodgeFireball.id);
    assert.equal(resolveMeleeStrategyTarget({
        objects: statePayload.objects,
        opponent: { id: "opponent-model" },
        player: statePayload.playerModel,
        obstacles: [],
    }, "opponent_fireball")?.id, closeFireball.id);
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

test("condition joins can use OR and expression variables expose x/y positions", () => {
    const anySidePosition = {
        ...createLogicBlock("always", "move_center"),
        conditions: [
            {
                type: "expression",
                left: "my.x",
                comparator: "lt",
                right: { type: "number", value: 100 },
            },
            {
                type: "expression",
                join: "or",
                left: "opponent.y",
                comparator: "eq",
                right: { type: "number", value: 400 },
            },
        ],
    };
    const andPosition = {
        ...createLogicBlock("always", "move_stop"),
        conditions: anySidePosition.conditions.map((condition) => ({ ...condition, join: undefined })),
    };

    const normalized = normalizeMeleeStrategyConfiguration({ blocks: [anySidePosition] });
    assert.equal(normalized.blocks[0].conditions[0].join, undefined);
    assert.equal(normalized.blocks[0].conditions[1].join, "or");
    assert.equal(selectMeleeStrategyBlock({ blocks: [anySidePosition] }, payload()).id, anySidePosition.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [andPosition] }, payload()), null);

    const readyOrCoolingDown = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [
            { type: "my_dash_ready" },
            { type: "my_dash_cooldown", join: "or" },
        ],
    };
    assert.deepEqual(validateMeleeStrategyConfiguration({ blocks: [readyOrCoolingDown] }).errors, []);
});

test("position expression variables can read player and opponent coordinates", () => {
    const playerLeft = {
        ...createLogicBlock("always", "move_east"),
        conditions: [{ type: "expression", left: "my.x", comparator: "lt", right: { type: "number", value: 200 } }],
    };
    const playerLow = {
        ...createLogicBlock("always", "move_north"),
        conditions: [{ type: "expression", left: "my.y", comparator: "gt", right: { type: "number", value: 500 } }],
    };
    const opponentRight = {
        ...createLogicBlock("always", "move_center"),
        conditions: [{ type: "expression", left: "opponent.x", comparator: "gt", right: { type: "number", value: 650 } }],
    };
    const opponentHigh = {
        ...createLogicBlock("always", "move_south"),
        conditions: [{ type: "expression", left: "opponent.y", comparator: "lt", right: { type: "number", value: 250 } }],
    };

    assert.equal(selectMeleeStrategyBlock({ blocks: [playerLeft] }, payload({ playerModel: { x: 150 } })).id, playerLeft.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [playerLow] }, payload({ playerModel: { y: 650 } })).id, playerLow.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [opponentRight] }, payload({ opponent: { x: 700 } })).id, opponentRight.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [opponentHigh] }, payload({ opponent: { y: 200 } })).id, opponentHigh.id);
});

test("buff and effect timer variables use comparator choices", () => {
    const overdriveActive = {
        ...createLogicBlock("always", "move_center"),
        conditions: [{ type: "expression", left: "my.overdriveMs", comparator: "gt", right: { type: "number", value: 2 } }],
    };
    const opponentJammedAlmostDone = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{ type: "expression", left: "opponent.jammedMs", comparator: "lte", right: { type: "number", value: 1 } }],
    };

    assert.equal(selectMeleeStrategyBlock({
        blocks: [overdriveActive],
    }, payload({ playerModel: { overdriveMs: 3000 } })).id, overdriveActive.id);
    assert.equal(selectMeleeStrategyBlock({
        blocks: [opponentJammedAlmostDone],
    }, payload({ opponent: { jammedMs: 900 } })).id, opponentJammedAlmostDone.id);
});

test("radar jammer suppresses blocks that use visible targets", () => {
    const chaseTarget = {
        ...createLogicBlock("always", "move_inward"),
        actionTarget: "opponent",
    };
    const checkOwnJammed = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{ type: "expression", left: "my.jammed", comparator: "eq", right: { type: "boolean", value: true } }],
    };

    assert.equal(selectMeleeStrategyBlock({
        blocks: [chaseTarget],
    }, payload({ playerModel: { jammedMs: 3000 } })), null);
    assert.equal(selectMeleeStrategyBlock({
        blocks: [checkOwnJammed],
    }, payload({ playerModel: { jammedMs: 3000 } })).id, checkOwnJammed.id);
});

test("cooldown expression variables use seconds and behavior shortcuts stay hidden", () => {
    const visibleConditionIds = new Set(CONDITION_TYPES.map((condition) => condition.id));
    assert.equal(visibleConditionIds.has("expression"), false);
    assert.equal(visibleConditionIds.has("my_hp_lt"), false);
    assert.equal(visibleConditionIds.has("my_hp_gt"), false);
    assert.equal(visibleConditionIds.has("enemy_distance_lt"), false);
    assert.equal(visibleConditionIds.has("enemy_distance_gt"), false);
    assert.equal(visibleConditionIds.has("enemy_rushing"), false);
    assert.equal(visibleConditionIds.has("enemy_fleeing"), false);
    assert.equal(visibleConditionIds.has("enemy_attacking"), false);
    assert.equal(visibleConditionIds.has("enemy_blocking"), false);

    const dashStillCoolingDown = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "my.dashCooldownMs",
            comparator: "gt",
            right: { type: "number", value: 0.5 },
        }],
    };

    assert.equal(selectMeleeStrategyBlock({
        blocks: [dashStillCoolingDown],
    }, payload({ playerModel: { dashCooldownRemainingMs: 750 } })).id, dashStillCoolingDown.id);
    assert.equal(selectMeleeStrategyBlock({
        blocks: [dashStillCoolingDown],
    }, payload({ playerModel: { dashCooldownRemainingMs: 250 } })), null);

    const dashHasCharges = {
        ...createLogicBlock("always", "dash"),
        conditions: [{
            type: "expression",
            left: "my.dashCharges",
            comparator: "gt",
            right: { type: "number", value: 1 },
        }],
    };

    assert.equal(selectMeleeStrategyBlock({
        blocks: [dashHasCharges],
    }, payload({ playerModel: { dashCharges: 2 } })).id, dashHasCharges.id);
    assert.equal(selectMeleeStrategyBlock({
        blocks: [dashHasCharges],
    }, payload({ playerModel: { dashCharges: 1 } })), null);
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
