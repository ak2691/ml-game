import assert from "node:assert/strict";
import test from "node:test";
import {
    ACTION_TYPES,
    CONDITION_TYPES,
    CONDITION_DEFINITIONS,
    STATE_VARIABLES,
    TARGET_TYPES,
    actionSupportsTarget,
    createDefaultMeleeStrategyConfiguration,
    hasMeleeStrategyActions,
    moveLogicColumnPriority,
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
} from "./BotBrain.js";
import { buildStatePayload } from "../beta/modelPayloads/strategyStatePayload.js";

test("opponent condition and variable labels contain only one ordinal", () => {
    for (const definition of [...CONDITION_DEFINITIONS, ...STATE_VARIABLES]) {
        assert.doesNotMatch(definition.label, /Opponent 1 1\b/, definition.id);
    }
});

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

test("Bot Room resolves Opponent 1 by fighter id for Walk, Dash, and Micro Dash", () => {
    const state = buildStatePayload([
        { id: "main", type: "circle", slot: 1, x: 400, y: 400, rotation: 0, hp: 100, size: 60, abilities: ["dash", "micro_dash"], dashCooldownMs: 0, dashActiveMs: 0, abilityCooldowns: { micro_dash: 0 } },
        // Reproduce the failure: the canvas type drifted, but fighter identity
        // remains the stable opponent-model id.
        { id: "opponent-model", type: "circle", slot: 2, x: 600, y: 500, rotation: 180, hp: 100, size: 60, abilities: [] },
    ], "custom");
    const configuration = {
        version: "melee-logic-tree-v1",
        blocks: [{
            id: "target-actions",
            priority: 1,
            conditions: [{ type: "always" }],
            actions: [
                { action: "move_walk", movementMode: "target", movementDirection: "toward", actionTarget: "opponent" },
                { action: "dash", movementMode: "target", movementDirection: "toward", actionTarget: "opponent" },
                { action: "micro_dash", movementMode: "target", movementDirection: "toward", actionTarget: "opponent" },
            ],
        }],
    };

    assert.equal(state.objects.find((object) => object.id === "opponent-model")?.type, "opponentModel");
    const plan = selectMeleeStrategyActionPlan(configuration, state);
    assert.equal(plan.movement?.action, "move_walk");
    assert.equal(plan.dash?.action, "dash");
    assert.equal(plan.ability?.action, "micro_dash");
});

test("normalizes deterministic logic blocks without training knobs", () => {
    const configuration = normalizeMeleeStrategyConfiguration({
        epochLimit: 999,
        blocks: [{ conditions: [{ type: "my_hp_lt", value: 999 }], action: "move_outward", sampleCount: 99999 }],
    });

    assert.equal(configuration.version, "melee-logic-tree-v1");
    assert.equal(configuration.epochLimit, undefined);
    assert.equal(configuration.blocks[0].sampleCount, undefined);
    assert.equal(configuration.blocks[0].conditions[0].value, 100);
});

test("default strategy starts empty and requires at least one non-veto action", () => {
    const empty = createDefaultMeleeStrategyConfiguration();
    assert.equal(empty.blocks.length, 0);
    assert.ok(validateMeleeStrategyConfiguration(empty).errors.some((error) => error.includes("bot brain action")));

    const onlyVeto = { blocks: [createLogicBlock("enemy_distance_gt", "no_dash")] };
    assert.ok(validateMeleeStrategyConfiguration(onlyVeto).errors.some((error) => error.includes("bot brain action")));
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

test("logic tree selects the first matching sibling and descends into nested scopes", () => {
    const configuration = {
        version: "melee-logic-tree-v1",
        columns: [{
            id: "movement",
            name: "Movement",
            createdOrder: 1,
            branches: [{
                id: "parent",
                branchType: "if",
                createdOrder: 1,
                conditions: [createExpressionCondition("my.hp")],
                action: "move_stop",
                children: [
                    { id: "false-child", branchType: "if", createdOrder: 1, conditions: [{ type: "expression", left: "my.hp", comparator: "lt", right: { type: "number", value: 10 } }], action: "move_west" },
                    { id: "fallback-child", branchType: "else", createdOrder: 2, conditions: [], action: "move_east" },
                ],
            }],
        }],
    };
    configuration.columns[0].branches[0].conditions[0] = { type: "always" };
    assert.equal(selectMeleeStrategyBlock(configuration, payload()).action, "move_walk");
});

test("earliest-created matching column wins same-head conflicts without speculative warnings", () => {
    const configuration = {
        version: "melee-logic-tree-v1",
        columns: [
            { id: "later", name: "Later", createdOrder: 20, branches: [{ id: "later-move", branchType: "if", createdOrder: 1, conditions: [{ type: "always" }], action: "move_west" }] },
            { id: "earlier", name: "Earlier", createdOrder: 10, branches: [{ id: "earlier-move", branchType: "if", createdOrder: 1, conditions: [{ type: "always" }], action: "move_east" }] },
        ],
    };
    const plan = selectMeleeStrategyActionPlan(configuration, payload());
    assert.equal(plan.movement.action, "move_walk");
    assert.deepEqual(validateMeleeStrategyConfiguration(configuration).warnings, []);
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

test("brain-node priority controls reorder root columns and execution order", () => {
    const columns = [
        { id: "fireball", name: "Fireball", createdOrder: 0, branches: [{ id: "fire", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: "shoot_fireball" }] }] },
        { id: "concussive", name: "Concussive", createdOrder: 1, branches: [{ id: "conc", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] }] },
    ];
    const reordered = moveLogicColumnPriority(columns, 1, -1);
    const state = payload({ playerModel: {
        abilities: ["shoot_fireball", "concussive_shot"],
        fireballAvailable: true,
        abilityCooldowns: { concussive_shot: 0 },
    } });

    assert.deepEqual(reordered.map((column) => column.id), ["concussive", "fireball"]);
    assert.deepEqual(reordered.map((column) => column.createdOrder), [0, 1]);
    assert.equal(selectMeleeStrategyActionPlan({ version: "melee-logic-tree-v1", columns: reordered }, state).ability.action, "concussive_shot");
});

test("an unavailable higher-priority ability falls through without losing the ability head", () => {
    const configuration = {
        version: "melee-logic-tree-v1",
        columns: [{
            id: "ability-priority",
            createdOrder: 1,
            branches: [
                { id: "fireball-first", branchType: "if", createdOrder: 0, conditions: [{ type: "always" }], actions: [{ action: "shoot_fireball" }] },
                { id: "concussive-second", branchType: "else_if", createdOrder: 1, conditions: [{ type: "always" }], actions: [{ action: "concussive_shot" }] },
            ],
        }],
    };
    const coolingDown = payload({ playerModel: {
        abilities: ["shoot_fireball", "concussive_shot"],
        fireballAvailable: false,
        abilityCooldowns: { concussive_shot: 0 },
    } });
    const ready = payload({ playerModel: {
        abilities: ["shoot_fireball", "concussive_shot"],
        fireballAvailable: true,
        abilityCooldowns: { concussive_shot: 0 },
    } });

    assert.equal(selectMeleeStrategyActionPlan(configuration, coolingDown).ability?.action, "concussive_shot");
    assert.equal(selectMeleeStrategyActionPlan(configuration, ready).ability?.action, "shoot_fireball");
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

test("micro dash executes independently of standard dash availability", () => {
    const plan = selectMeleeStrategyActionPlan({ blocks: [{
        id: "micro-dash-only",
        priority: 1,
        conditions: [{ type: "always" }],
        actions: [{ action: "micro_dash", movementMode: "absolute", movementDirection: "east" }],
    }] }, payload({ playerModel: { dashAvailable: false } }));
    assert.equal(plan.ability?.action, "micro_dash");
    assert.equal(plan.micro_dash?.movementDirection, "east");
    assert.equal(plan.dash, undefined);
});

test("pistol shot remains executable alongside a standard dash", () => {
    const plan = selectMeleeStrategyActionPlan({ blocks: [{
        id: "dash-and-pistol",
        priority: 1,
        conditions: [{ type: "always" }],
        actions: [{ action: "dash", movementMode: "absolute", movementDirection: "east" }, { action: "pistol_shot" }],
    }] }, payload({ playerModel: { dashAvailable: true } }));

    assert.equal(plan.dash?.action, "dash");
    assert.equal(plan.ability?.action, "pistol_shot");
    assert.equal(plan.pistol_shot?.action, "pistol_shot");
});

test("current bot-brain columns count as executable opponent actions", () => {
    const configuration = {
        version: "melee-logic-tree-v1",
        columns: [{
            id: "opponent-pistol-column",
            createdOrder: 1,
            branches: [{
                id: "opponent-pistol",
                branchType: "if",
                createdOrder: 1,
                priority: 1,
                conditions: [{ type: "always" }],
                action: "pistol_shot",
            }],
        }],
        blocks: [],
        clusters: [],
    };

    assert.equal(hasMeleeStrategyActions(configuration), true);
    assert.equal(selectMeleeStrategyActionPlan(configuration, payload()).ability?.action, "pistol_shot");
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

test("fight-only target picker exposes one entry per target type", () => {
    assert.deepEqual(TARGET_TYPES.map((target) => target.id), [
        "opponent",
        "orbital_zone",
        "opponent_grenade",
        "opponent_fireball",
        "opponent_concussive_shot",
        "opponent_proximity_mine",
        "opponent_gravity_field",
        "opponent_silence_wave",
        "opponent_hunter_drone",
        "opponent_temporal_rewind_zone",
        "opponent_orbital_zone",
        "opponent_null_zone",
        "my_grenade",
        "my_fireball",
        "my_concussive_shot",
        "my_proximity_mine",
        "my_gravity_field",
        "my_silence_wave",
        "my_hunter_drone",
        "my_temporal_rewind_zone",
        "my_orbital_zone",
        "my_null_zone",
    ]);
    assert.ok(TARGET_TYPES.every((target) => !target.id.includes(":")));
    const legacyTargetRule = {
        ...createLogicBlock("always", "move_inward"),
        actionTarget: "defender_core",
    };
    assert.equal(normalizeMeleeStrategyConfiguration({ blocks: [legacyTargetRule] }).blocks[0].actionTarget, "opponent");
});

test("missing orbital-zone targets fall through to the next eligible priority", () => {
    const missingZone = {
        ...createLogicBlock("always", "move_inward"),
        priority: 1,
        actions: [{ action: "move_inward", actionTarget: "orbital_zone" }],
    };
    const fallback = { ...createLogicBlock("always", "move_outward"), priority: 2 };
    assert.equal(selectMeleeStrategyBlock({ blocks: [missingZone, fallback] }, payload()).id, fallback.id);
    const zone = { id: "orbital-1", type: "orbitalMarker", x: 500, y: 300, size: 260 };
    assert.equal(selectMeleeStrategyBlock({ blocks: [missingZone, fallback] }, payload({ objects: [zone] })).id, missingZone.id);
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

test("ordered entity selectors require the requested ordinal and target count sees the full type", () => {
    const objects = [
        { id: "fireball-001", type: "fireball", ownerId: "opponent-model", x: 430, y: 400, size: 20, createdOrder: 1 },
        { id: "fireball-002", type: "fireball", ownerId: "opponent-model", x: 600, y: 400, size: 20, createdOrder: 2 },
        { id: "fireball-003", type: "fireball", ownerId: "opponent-model", x: 700, y: 400, size: 20, createdOrder: 3 },
    ];
    const state = { objects, opponent: { id: "opponent-model" }, player: { x: 400, y: 400 }, obstacles: [] };
    assert.equal(resolveMeleeStrategyTarget(state, "opponent_fireball:farthest:2")?.id, "fireball-002");
    assert.equal(resolveMeleeStrategyTarget({ ...state, objects: objects.slice(0, 2) }, "opponent_fireball:oldest:3"), null);

    const countRule = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{ type: "expression", left: "target.count", comparator: "eq", target: "opponent_fireball:newest:3", right: { type: "number", value: 3 } }],
    };
    assert.equal(selectMeleeStrategyBlock({ blocks: [countRule] }, payload({ objects }))?.id, countRule.id);
});

test("rotation variables use north-zero clockwise bearings and fighter-only facing", () => {
    const rules = [
        ["target.bearingFromMe", 90],
        ["my.bearingFromTarget", 270],
        ["target.relativeBearing", 0],
        ["target.facing", 90],
    ].map(([left, value], index) => ({
        ...createLogicBlock("always", "move_stop"),
        id: `rotation-${index}`,
        conditions: [{ type: "expression", left, comparator: left === "target.bearingFromMe" ? "range" : "eq", target: "opponent", right: left === "target.bearingFromMe" ? { type: "range", min: value, max: value } : { type: "number", value } }],
    }));
    const state = payload({ playerModel: { x: 400, y: 400, rotation: 0 }, opponentModel: { x: 500, y: 400, rotation: 0 } });
    for (const rule of rules) assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, state)?.id, rule.id);
});

test("relative bearing offers shortest, clockwise, and counterclockwise angle choices", () => {
    const rules = [
        ["target.relativeBearing", -90],
        ["target.relativeBearingClockwise", 270],
        ["target.relativeBearingCounterclockwise", 90],
    ].map(([left, value], index) => ({
        ...createLogicBlock("always", "move_stop"),
        id: `bearing-mode-${index}`,
        conditions: [{ type: "expression", left, comparator: "eq", target: "opponent", right: { type: "number", value } }],
    }));
    const state = payload({ playerModel: { x: 400, y: 400, rotation: 90 }, opponentModel: { x: 500, y: 400 } });
    for (const rule of rules) assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, state)?.id, rule.id);
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

test("removed object-type, danger-zone, and legacy effect conditions stay hidden", () => {
    const conditionIds = new Set(CONDITION_TYPES.map((condition) => condition.id));
    const variableIds = new Set(STATE_VARIABLES.map((variable) => variable.id));
    for (const id of ["target_missing", "target_health_pack", "target_damage_zone", "target_projectile_wall", "target_bouncy_wall", "inside_damage_zone", "my_jammed", "my_command_locked", "opponent_jammed", "opponent_command_locked"]) {
        assert.equal(conditionIds.has(id), false);
    }
    for (const id of ["my.overdriveMs", "my.barrierMs", "my.slowedMs", "my.jammedMs", "my.commandLockedMs", "opponent.overdriveMs", "opponent.barrierMs", "opponent.slowedMs", "opponent.jammedMs", "opponent.commandLockedMs", "my.jammed", "my.commandLocked", "opponent.jammed", "opponent.commandLocked", "target.isHealthPack", "target.isDamageZone", "target.isProjectileWall", "target.isBouncyWall", "my.insideDamageZone"]) {
        assert.equal(variableIds.has(id), false);
    }
});

test("boost count variables track each fighter's permanent boosts", () => {
    const rule = {
        ...createLogicBlock("always", "move_center"),
        conditions: [{
            type: "expression",
            left: "my.assaultBoostCount",
            comparator: "gte",
            right: { type: "number", value: 2 },
        }],
    };
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, payload({
        playerModel: { assaultBoostStacks: 2 },
    }))?.id, rule.id);
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

});

test("generic selected-ability variables replace per-ability condition menu entries", () => {
    const variableIds = new Set(STATE_VARIABLES.map((variable) => variable.id));
    assert.equal(variableIds.has("my.selectedAbilityReady"), true);
    assert.equal(variableIds.has("my.selectedAbilityAmmo"), true);
    assert.equal(variableIds.has("opponent.selectedAbilityCooldownMs"), true);
    assert.equal(variableIds.has("my.abilityReady.null_zone"), false);
    assert.equal(CONDITION_TYPES.some((condition) => condition.id === "my_null_zone_ready"), false);

    const ready = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "my.selectedAbilityReady",
            ability: "null_zone",
            comparator: "eq",
            right: { type: "boolean", value: true },
        }],
    };
    assert.equal(selectMeleeStrategyBlock({ blocks: [ready] }, payload({ playerModel: { abilityCooldowns: { null_zone: 0 } } }))?.id, ready.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [ready] }, payload({ playerModel: { abilityCooldowns: { null_zone: 500 } } })), null);
});

test("target direction uses an inclusive signed range", () => {
    const rule = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{ type: "expression", left: "target.bearingFromMe", comparator: "range", target: "opponent", right: { type: "range", min: -100, max: -80 } }],
    };
    const west = payload({ playerModel: { x: 400, y: 400 }, opponent: { x: 300, y: 400 } });
    const east = payload({ playerModel: { x: 400, y: 400 }, opponent: { x: 500, y: 400 } });
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, west)?.id, rule.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, east), null);
});

test("a reversed target direction range wraps around the circle", () => {
    const rule = {
        ...createLogicBlock("always", "move_stop"),
        conditions: [{ type: "expression", left: "target.bearingFromMe", comparator: "range", target: "opponent", right: { type: "range", min: 32, max: 30 } }],
    };
    const east = payload({ opponent: { x: 500, y: 400 } });
    const bearing31 = 31 * Math.PI / 180;
    const excluded = payload({ opponent: { x: 400 + Math.sin(bearing31) * 100, y: 400 - Math.cos(bearing31) * 100 } });
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, east)?.id, rule.id);
    assert.equal(selectMeleeStrategyBlock({ blocks: [rule] }, excluded), null);
    const normalized = normalizeMeleeStrategyConfiguration({ blocks: [rule] });
    assert.deepEqual(normalized.blocks[0].conditions[0].right, { type: "range", min: 32, max: 30 });
});

test("target age uses seconds at one-decimal tick precision", () => {
    const definition = STATE_VARIABLES.find((variable) => variable.id === "target.age");
    assert.equal(definition.suffix, "s");
    assert.equal(definition.step, 0.1);
    const block = {
        ...createLogicBlock("always", "move_inward"),
        conditions: [{
            type: "expression",
            left: "target.age",
            comparator: "gte",
            right: { type: "number", value: 1.34 },
            target: "opponent_proximity_mine",
        }],
    };
    const normalized = normalizeMeleeStrategyConfiguration({ blocks: [block] });
    assert.equal(normalized.blocks[0].conditions[0].right.value, 1.3);
});

test("generic selected-ability ammo reads gun ammo, fireball charges, and block charges", () => {
    const condition = (ability, expected) => ({
        ...createLogicBlock("always", "move_stop"),
        conditions: [{
            type: "expression",
            left: "my.selectedAbilityAmmo",
            ability,
            comparator: "eq",
            right: { type: "number", value: expected },
        }],
    });
    const state = payload({ playerModel: {
        gunAmmo: 7,
        fireballCharges: 3,
        blockCharges: 4,
    } });

    assert.ok(selectMeleeStrategyBlock({ blocks: [condition("fire_gun", 7)] }, state));
    assert.ok(selectMeleeStrategyBlock({ blocks: [condition("shoot_fireball", 3)] }, state));
    assert.ok(selectMeleeStrategyBlock({ blocks: [condition("block", 4)] }, state));
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
    const microDash = ACTION_TYPES.find((action) => action.id === "micro_dash");

    assert.equal(actionSupportsTarget(move), true);
    assert.equal(actionSupportsTarget(north), false);
    assert.equal(actionSupportsTarget(dash), true);
    assert.equal(actionSupportsTarget(dashNorth), false);
    assert.equal(actionSupportsTarget(stop), false);
    assert.equal(actionSupportsTarget(noDash), false);
    assert.equal(actionSupportsTarget(microDash), true);
});

test("one conditional can execute movement rotation and one ability", () => {
    const branch = {
        ...createLogicBlock("always", "none"),
        conditions: [{ type: "always" }],
        actions: [
            { action: "move_inward", actionTarget: "opponent" },
            { action: "rotate_toward_enemy", actionTarget: "opponent" },
            { action: "swing", actionTarget: "opponent" },
        ],
    };

    const plan = selectMeleeStrategyActionPlan({ blocks: [branch] }, payload());

    assert.equal(plan.movement?.action, "move_walk");
    assert.equal(plan.rotation?.action, "rotate_toward_enemy");
    assert.equal(plan.ability?.action, "swing");
});

test("normalization keeps only one action per execution category", () => {
    const normalized = normalizeMeleeStrategyConfiguration({
        blocks: [{
            ...createLogicBlock("always", "none"),
            actions: [
                { action: "move_inward", actionTarget: "opponent" },
                { action: "move_outward", actionTarget: "opponent" },
                { action: "swing" },
                { action: "block" },
                { action: "none" },
            ],
        }],
    });

    assert.deepEqual(normalized.blocks[0].actions.map((entry) => entry.action), ["move_walk", "swing"]);
});
