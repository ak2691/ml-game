import { useState, useCallback, useEffect, useRef } from "react";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import StrategyTrainingPanel from "./StrategyTrainingPanel";
import "./BetaModel.css";
import {
    createDefaultMeleeStrategyConfiguration,
    normalizeMeleeStrategyConfiguration,
    selectMeleeStrategyActionPlan,
} from "../ml/MeleeStrategy.js";
import {
    buildModelSubmissionPayload,
    createTrainingSession,
    fetchTrainingSessionDuration,
    submitModelPayload
} from "../ml/ModelSubmission";
import {
    ACTION_SCHEMA_VERSION,
    FEATURE_SCHEMA_VERSION,
    MODEL_ARCHITECTURE_VERSION,
} from "../ml/ModelSubmissionContract";
import {
    BLOCK_MAX_CHARGES,
    BLOCK_RECHARGE_MS,
    MELEE_DAMAGE,
    MELEE_HP,
    SWING_ACTIVE_MS,
    SWING_COOLDOWN_MS,
} from "./classes/MeleeClass.jsx";
import {
    GUN_ACTIVE_MS,
    GUN_COOLDOWN_MS,
    GUN_RANGE,
    GRENADE_COOLDOWN_MS,
    GRENADE_DECELERATION_PER_TICK,
    GRENADE_EXPLOSION_RADIUS,
    GRENADE_SIZE,
    GRENADE_STOP_FUSE_MS,
    GRENADE_THROW_SPEED,
    RANGED_AMMO_MAX,
    RANGED_DAMAGE_FALLOFF,
    RANGED_RELOAD_MS,
} from "./classes/RangedClass.jsx";
import {
    actionIdsForCombatClass,
    combatClassConfig,
    combatClassHp,
    combatClassMoveSpeed,
} from "./classes/CombatClasses.js";

const CANVAS_SIZE = 800;
const MOVE_ACCELERATION_PER_TICK = 4;
const MOVE_BRAKE_ACCELERATION_PER_TICK = 8;
const AUTO_STEP_MS = 100;
const ROTATION_STEP_DEG = 18;
const DASH_DURATION_MS = 1000;
const DASH_COOLDOWN_MS = 4500;
const DASH_SPEED = 20;
const MAX_OBSTACLES = 5;
const DUEL_SLOT_ONE_X = 240;
const DUEL_SLOT_TWO_X = 560;
const HEALTH_PACK_SIZE = 42;
const HEALTH_PACK_HEAL = 50;
const DAMAGE_ZONE_SIZE = 128;
const DAMAGE_ZONE_ENTRY_DAMAGE = 25;
const DAMAGE_ZONE_DAMAGE_MULTIPLIER = 1.5;

const MAIN_SHAPE = {
    id: "main",
    type: "circle",
    x: CANVAS_SIZE / 2,
    y: CANVAS_SIZE / 2,
    size: 60,
    rotation: 0,
    combatClass: "melee",
    hp: MELEE_HP,
    swingCooldownMs: 0,
    swingActiveMs: 0,
    blockCooldownMs: 0,
    blockActiveMs: 0,
    blockCharges: BLOCK_MAX_CHARGES,
    blockRechargeMs: 0,
    gunCooldownMs: 0,
    gunActiveMs: 0,
    gunShotActive: false,
    gunAmmo: 0,
    gunReloadMs: 0,
    grenadeCooldownMs: 0,
    grenadeSerial: 1,
    thrownGrenade: null,
    dashCooldownMs: 0,
    dashActiveMs: 0,
    dashDirectionX: 0,
    dashDirectionY: 0,
    movementVelocityX: 0,
    movementVelocityY: 0,
    velocityX: 0,
    velocityY: 0,
};

let _id = 1;
const genId = () => `shape-${Date.now()}-${_id++}`;
const SESSION_KEY = "arena-training-session-id";

function matchStrategyConfigurationKey(matchId, userId, combatClass) {
    return matchId && userId
        ? `arena-match-strategy-v1-${combatClass}-${matchId}-${userId}`
        : `arena-training-strategy-v1-${combatClass}`;
}

function opponentStrategyConfigurationKey(matchId, userId, combatClass) {
    return matchId && userId
        ? `arena-match-opponent-strategy-v1-${combatClass}-${matchId}-${userId}`
        : `arena-training-opponent-strategy-v1-${combatClass}`;
}

function loadStoredStrategyConfiguration(key) {
    if (!key) return createDefaultMeleeStrategyConfiguration();
    try {
        const stored = localStorage.getItem(key);
        return stored
            ? normalizeMeleeStrategyConfiguration(JSON.parse(stored))
            : createDefaultMeleeStrategyConfiguration();
    } catch {
        return createDefaultMeleeStrategyConfiguration();
    }
}

function sanitizeStrategyConfigurationForClass(configuration, combatClass) {
    const source = configuration && typeof configuration === "object"
        ? configuration
        : createDefaultMeleeStrategyConfiguration();
    const allowedActionIds = new Set(actionIdsForCombatClass(combatClass));
    const sanitizeBlock = (block) => {
        if (!block || typeof block !== "object") return block;
        return allowedActionIds.has(block.action)
            ? block
            : { ...block, action: "move_stop", actionTarget: "opponent" };
    };
    return {
        ...source,
        blocks: Array.isArray(source.blocks) ? source.blocks.map(sanitizeBlock) : [],
        clusters: Array.isArray(source.clusters) ? source.clusters.map((cluster) => ({
            ...cluster,
            blocks: Array.isArray(cluster?.blocks) ? cluster.blocks.map(sanitizeBlock) : [],
        })) : [],
    };
}

function hasStrategyActions(configuration) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    return normalized.blocks.length > 0 || normalized.clusters.some((cluster) => cluster.blocks.length > 0);
}

function countStrategyBlocks(configuration) {
    const normalized = normalizeMeleeStrategyConfiguration(configuration);
    return normalized.blocks.length + normalized.clusters.reduce((total, cluster) => total + cluster.blocks.length, 0);
}

function secondsRemaining(targetTime) {
    if (!targetTime) return null;
    const targetMs = typeof targetTime === "number"
        ? targetTime
        : new Date(targetTime).getTime();
    if (!Number.isFinite(targetMs)) return null;
    return Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
}

function formatClock(totalSeconds) {
    if (totalSeconds == null) return "--:--";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildOpponentShape(opponent) {
    return {
        id: "opponent-model",
        type: "opponentModel",
        x: CANVAS_SIZE / 2 + 180,
        y: CANVAS_SIZE / 2,
        size: 64,
        rotation: 180,
        combatClass: "melee",
        hp: MELEE_HP,
        swingCooldownMs: 0,
        swingActiveMs: 0,
        blockCooldownMs: 0,
        blockActiveMs: 0,
        blockCharges: BLOCK_MAX_CHARGES,
        blockRechargeMs: 0,
        gunCooldownMs: 0,
        gunActiveMs: 0,
        gunShotActive: false,
        gunAmmo: RANGED_AMMO_MAX,
        gunReloadMs: 0,
        grenadeCooldownMs: 0,
        grenadeSerial: 1,
        thrownGrenade: null,
        dashCooldownMs: 0,
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        opponentUsername: opponent?.username,
    };
}

function buildInitialArenaShapes(matchContext) {
    if (matchContext?.matchId) return buildMatchSpawnShapes(matchContext);
    const shapes = [{ ...MAIN_SHAPE }];
    if (matchContext?.opponent) shapes.push(buildOpponentShape(matchContext.opponent));
    return shapes;
}

function buildMatchSpawnShapes(matchContext) {
    const playerClass = matchContext?.player?.selectedClass ?? "melee";
    const opponentClass = matchContext?.opponent?.selectedClass ?? "melee";
    const fighters = [
        resetFighterShape({ ...MAIN_SHAPE, combatClass: playerClass, x: DUEL_SLOT_ONE_X, y: CANVAS_SIZE / 2, rotation: 0 }),
        resetFighterShape({
            ...buildOpponentShape(matchContext?.opponent),
            combatClass: opponentClass,
            x: DUEL_SLOT_TWO_X,
            y: CANVAS_SIZE / 2,
            rotation: 180,
        }),
    ];
    const matchObstacles = matchObstacleShapes(matchContext?.obstacles, true);
    return [
        ...fighters,
        ...(matchObstacles.length
            ? matchObstacles
            : createRandomArenaObstacles(createSeededRandom(obstacleSeed(matchContext)), true, fighters)),
    ];
}

function matchObstacleShapes(obstacles, locked = false) {
    if (!Array.isArray(obstacles)) return [];
    return obstacles
        .filter((obstacle) => isObstacleType(obstacle?.type))
        .slice(0, MAX_OBSTACLES)
        .map((obstacle, index) => ({
            id: obstacle.id ?? `object_${index + 1}`,
            type: obstacle.type,
            x: Number.isFinite(Number(obstacle.x)) ? Number(obstacle.x) : CANVAS_SIZE / 2,
            y: Number.isFinite(Number(obstacle.y)) ? Number(obstacle.y) : CANVAS_SIZE / 2,
            size: Number.isFinite(Number(obstacle.size))
                ? Number(obstacle.size)
                : obstacle.type === "healthPack" ? HEALTH_PACK_SIZE : DAMAGE_ZONE_SIZE,
            rotation: 0,
            locked,
        }));
}

function createRandomArenaObstacles(random = Math.random, locked = false, occupiedShapes = []) {
    const count = 1 + Math.floor(random() * MAX_OBSTACLES);
    const obstacles = [];
    for (let index = 0; index < count; index += 1) {
        const type = random() < 0.5 ? "healthPack" : "damageZone";
        obstacles.push(buildObstacleShape(type, `object_${index + 1}`, random, locked, [...occupiedShapes, ...obstacles]));
    }
    return obstacles;
}

function buildObstacleShape(type, id = genId(), random = Math.random, locked = false, occupiedShapes = []) {
    const size = type === "healthPack" ? HEALTH_PACK_SIZE : DAMAGE_ZONE_SIZE;
    let candidate = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
        candidate = {
            id,
            type,
            x: size / 2 + random() * (CANVAS_SIZE - size),
            y: size / 2 + random() * (CANVAS_SIZE - size),
            size,
            rotation: 0,
            locked,
        };
        if (!occupiedShapes.some((shape) => overlapsShape(shape, candidate, 8))) return candidate;
    }
    return candidate;
}

function isObstacleType(type) {
    return type === "healthPack" || type === "damageZone";
}

function nextObstacleId(shapes) {
    const used = new Set(shapes.map((shape) => shape.id));
    for (let index = 1; index <= MAX_OBSTACLES; index += 1) {
        const id = `object_${index}`;
        if (!used.has(id)) return id;
    }
    return genId();
}

function createSeededRandom(seedValue) {
    const seedText = String(seedValue ?? "machiner-obstacles");
    let state = 2_166_136_261;
    for (let index = 0; index < seedText.length; index += 1) {
        state ^= seedText.charCodeAt(index);
        state = Math.imul(state, 16_777_619);
    }
    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
    };
}

function obstacleSeed(matchContext) {
    return `${matchContext?.simulationSeed ?? matchContext?.matchId ?? 0}:obstacles`;
}

function cloneShape(shape) {
    return {
        ...shape,
        damageZoneIds: shape.damageZoneIds ? [...shape.damageZoneIds] : undefined,
    };
}

function cloneShapes(shapes) {
    return shapes.map(cloneShape);
}

function resetFighterShape(shape) {
    const combatClass = shape.combatClass ?? "melee";
    return {
        ...shape,
        hp: combatClassHp(combatClass),
        swingCooldownMs: 0,
        swingActiveMs: 0,
        blockCooldownMs: 0,
        blockActiveMs: 0,
        blockCharges: combatClass === "melee" ? BLOCK_MAX_CHARGES : 0,
        blockRechargeMs: 0,
        gunCooldownMs: 0,
        gunActiveMs: 0,
        gunShotActive: false,
        gunAmmo: combatClass === "ranged" ? RANGED_AMMO_MAX : 0,
        gunReloadMs: 0,
        grenadeCooldownMs: 0,
        grenadeSerial: 1,
        thrownGrenade: null,
        dashCooldownMs: 0,
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        damageZoneIds: [],
        inDamageZone: false,
    };
}

function buildAutoPlayStartShapes(currentShapes, matchContext, isMatchTraining) {
    const fallbackShapes = isMatchTraining ? buildMatchSpawnShapes(matchContext) : [];
    const fallbackMain = fallbackShapes.find((shape) => shape.id === "main");
    const fallbackOpponent = fallbackShapes.find((shape) => shape.id === "opponent-model");

    const nextShapes = cloneShapes(currentShapes);
    if (!nextShapes.some((shape) => shape.id === "main")) {
        nextShapes.unshift(resetFighterShape(fallbackMain ?? { ...MAIN_SHAPE }));
    }
    if (!nextShapes.some((shape) => shape.id === "opponent-model")) {
        nextShapes.push(resetFighterShape(fallbackOpponent ?? buildOpponentShape(matchContext?.opponent)));
    }

    const fighters = nextShapes.filter((shape) => shape.id === "main" || shape.id === "opponent-model");
    const obstacles = nextShapes.filter((shape) => isObstacleType(shape.type));
    const fallbackObstacles = fallbackShapes.filter((shape) => isObstacleType(shape.type));
    return [
        ...nextShapes,
        ...(!obstacles.length
            ? fallbackObstacles.length
                ? cloneShapes(fallbackObstacles)
                : createRandomArenaObstacles(Math.random, false, fighters)
            : []),
    ];
}

function resetArenaStartShapes(shapes, selectedClass, opponentSelectedClass) {
    return shapes.map((shape) => {
        if (shape.id === "main") return resetFighterShape({ ...shape, combatClass: selectedClass });
        if (shape.id === "opponent-model") {
            return resetFighterShape({ ...shape, combatClass: opponentSelectedClass, locked: false });
        }
        return cloneShape(shape);
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeAngle(degrees) {
    return ((degrees % 360) + 360) % 360;
}

function angleDelta(fromDeg, toDeg) {
    return ((toDeg - fromDeg + 540) % 360) - 180;
}

function tickCombat(shape, elapsedMs) {
    const blockRecharge = rechargeBlockCharges(shape, elapsedMs);
    return {
        ...shape,
        swingCooldownMs: Math.max(0, (shape.swingCooldownMs ?? 0) - elapsedMs),
        swingActiveMs: Math.max(0, (shape.swingActiveMs ?? 0) - elapsedMs),
        blockCooldownMs: blockRecharge.rechargeMs,
        blockActiveMs: 0,
        blockCharges: blockRecharge.charges,
        blockRechargeMs: blockRecharge.rechargeMs,
        gunCooldownMs: Math.max(0, (shape.gunCooldownMs ?? 0) - elapsedMs),
        gunActiveMs: Math.max(0, (shape.gunActiveMs ?? 0) - elapsedMs),
        gunShotActive: false,
        ...tickGunReload(shape, elapsedMs),
        grenadeCooldownMs: Math.max(0, (shape.grenadeCooldownMs ?? 0) - elapsedMs),
        thrownGrenade: null,
        dashCooldownMs: Math.max(0, (shape.dashCooldownMs ?? 0) - elapsedMs),
        dashActiveMs: Math.max(0, (shape.dashActiveMs ?? 0) - elapsedMs),
    };
}

function tickGunReload(shape, elapsedMs) {
    if (shape.combatClass !== "ranged") return { gunAmmo: 0, gunReloadMs: 0 };
    const ammo = Math.max(0, Math.min(RANGED_AMMO_MAX, Math.round(Number(shape.gunAmmo ?? RANGED_AMMO_MAX))));
    const reloadMs = Math.max(0, Number(shape.gunReloadMs ?? 0) - elapsedMs);
    if (ammo <= 0 && reloadMs <= 0) {
        return { gunAmmo: RANGED_AMMO_MAX, gunReloadMs: 0 };
    }
    return { gunAmmo: ammo, gunReloadMs: reloadMs };
}

function rechargeBlockCharges(shape, elapsedMs) {
    if (shape.combatClass !== "melee") return { charges: 0, rechargeMs: 0 };
    let charges = Math.max(0, Math.min(BLOCK_MAX_CHARGES, Math.round(Number(shape.blockCharges ?? BLOCK_MAX_CHARGES))));
    let rechargeMs = Math.max(0, Number(shape.blockRechargeMs ?? shape.blockCooldownMs ?? 0));
    if (charges >= BLOCK_MAX_CHARGES) return { charges: BLOCK_MAX_CHARGES, rechargeMs: 0 };
    rechargeMs += elapsedMs;
    while (charges < BLOCK_MAX_CHARGES && rechargeMs >= BLOCK_RECHARGE_MS) {
        charges += 1;
        rechargeMs -= BLOCK_RECHARGE_MS;
    }
    if (charges >= BLOCK_MAX_CHARGES) rechargeMs = 0;
    return { charges, rechargeMs };
}

function applyActionToShape(shape, action, elapsedMs) {
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    const mag = Math.hypot(action.dx ?? 0, action.dy ?? 0);
    const dx = mag > 0.001 ? action.dx / mag : 0;
    const dy = mag > 0.001 ? action.dy / mag : 0;
    const dashAvailable = combatClassConfig(shape.combatClass).actionIds.includes("dash")
        && (shape.dashCooldownMs ?? 0) <= 0;
    const maxMoveSpeed = combatClassMoveSpeed(shape.combatClass);
    let next = { ...shape };
    const isContinuingDash = (shape.dashActiveMs ?? 0) > 0;
    next.rotation = normalizeAngle((shape.rotation ?? 0) + clamp(action.dRot ?? 0, -1, 1) * ROTATION_STEP_DEG);

    if (isContinuingDash) {
        const dashX = shape.dashDirectionX ?? 0;
        const dashY = shape.dashDirectionY ?? 0;
        next = {
            ...next,
            x: clamp(shape.x + dashX * DASH_SPEED, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            y: clamp(shape.y + dashY * DASH_SPEED, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            movementVelocityX: dashX * maxMoveSpeed,
            movementVelocityY: dashY * maxMoveSpeed,
            velocityX: dashX * DASH_SPEED / seconds,
            velocityY: dashY * DASH_SPEED / seconds,
        };
    } else if ((action.dash ?? 0) > 0.5 && dashAvailable) {
        const facingRadians = (next.rotation ?? 0) * Math.PI / 180;
        const dashX = mag > 0.001 ? dx : Math.cos(facingRadians);
        const dashY = mag > 0.001 ? dy : Math.sin(facingRadians);
        next = {
            ...next,
            x: clamp(shape.x + dashX * DASH_SPEED, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            y: clamp(shape.y + dashY * DASH_SPEED, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            dashActiveMs: DASH_DURATION_MS,
            dashCooldownMs: DASH_COOLDOWN_MS,
            dashDirectionX: dashX,
            dashDirectionY: dashY,
            movementVelocityX: dashX * maxMoveSpeed,
            movementVelocityY: dashY * maxMoveSpeed,
            velocityX: dashX * DASH_SPEED / seconds,
            velocityY: dashY * DASH_SPEED / seconds,
        };
    } else {
        const movementVelocity = nextMovementVelocity(shape, dx, dy, mag, maxMoveSpeed);
        next = {
            ...next,
            x: clamp(shape.x + movementVelocity.dx, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            y: clamp(shape.y + movementVelocity.dy, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            movementVelocityX: movementVelocity.dx,
            movementVelocityY: movementVelocity.dy,
            velocityX: movementVelocity.dx / seconds,
            velocityY: movementVelocity.dy / seconds,
        };
    }

    const blockActive = shape.combatClass === "melee" && (action.block ?? 0) > 0.5 && (next.blockCharges ?? 0) > 0;
    if (blockActive) {
        next.blockActiveMs = 1;
    }

    const swingAvailable = !blockActive && (next.swingCooldownMs ?? 0) <= 0;
    if ((action.swing ?? 0) > 0.5 && swingAvailable) {
        next.swingCooldownMs = SWING_COOLDOWN_MS;
        next.swingActiveMs = SWING_ACTIVE_MS;
    }

    const gunAvailable = !blockActive && next.combatClass === "ranged"
        && (next.gunAmmo ?? RANGED_AMMO_MAX) > 0
        && (next.gunReloadMs ?? 0) <= 0
        && (next.gunCooldownMs ?? 0) <= 0
        && (next.gunActiveMs ?? 0) <= 0;
    const firedGun = (action.gun ?? 0) > 0.5 && gunAvailable;
    if (firedGun) {
        const nextAmmo = Math.max(0, (next.gunAmmo ?? RANGED_AMMO_MAX) - 1);
        next.gunAmmo = nextAmmo;
        next.gunReloadMs = nextAmmo <= 0 ? RANGED_RELOAD_MS : 0;
        next.gunActiveMs = GUN_ACTIVE_MS;
        next.gunCooldownMs = GUN_COOLDOWN_MS;
    }

    const grenadeAvailable = !blockActive && next.combatClass === "ranged" && (next.grenadeCooldownMs ?? 0) <= 0;
    const threwGrenade = (action.grenade ?? 0) > 0.5 && grenadeAvailable;
    if (threwGrenade) {
        next.grenadeCooldownMs = GRENADE_COOLDOWN_MS;
        next.thrownGrenade = createGrenadeShape(next);
        next.grenadeSerial = (next.grenadeSerial ?? 1) + 1;
    }

    const ticked = tickCombat(next, elapsedMs);
    return {
        ...ticked,
        blockActiveMs: blockActive ? 1 : ticked.blockActiveMs,
        gunShotActive: firedGun,
        thrownGrenade: next.thrownGrenade ?? null,
    };
}

function nextMovementVelocity(shape, inputX, inputY, inputMagnitude, maxMoveSpeed) {
    const current = {
        dx: shape.movementVelocityX ?? 0,
        dy: shape.movementVelocityY ?? 0,
    };
    if (!Number.isFinite(inputMagnitude) || inputMagnitude <= 0.001) {
        return {
            dx: decelerateVelocityComponent(current.dx, MOVE_ACCELERATION_PER_TICK),
            dy: decelerateVelocityComponent(current.dy, MOVE_ACCELERATION_PER_TICK),
        };
    }

    return clampVelocity({
        dx: nextVelocityComponent(current.dx, inputX),
        dy: nextVelocityComponent(current.dy, inputY),
    }, maxMoveSpeed);
}

function nextVelocityComponent(current, input) {
    if (!Number.isFinite(current) || !Number.isFinite(input)) return 0;
    if (Math.abs(input) <= 0.001) {
        return decelerateVelocityComponent(current, MOVE_ACCELERATION_PER_TICK);
    }
    const acceleration = current * input < -0.001
        ? MOVE_BRAKE_ACCELERATION_PER_TICK
        : MOVE_ACCELERATION_PER_TICK;
    return current + input * acceleration;
}

function decelerateVelocityComponent(value, amount) {
    if (!Number.isFinite(value) || Math.abs(value) <= amount) return 0;
    return value > 0 ? value - amount : value + amount;
}

function clampVelocity(velocity, maxSpeed) {
    const speed = Math.hypot(velocity.dx, velocity.dy);
    if (!Number.isFinite(speed) || speed <= maxSpeed) return velocity;
    return {
        dx: velocity.dx / speed * maxSpeed,
        dy: velocity.dy / speed * maxSpeed,
    };
}

function isSwingHitting(attacker, defender) {
    if ((attacker.swingActiveMs ?? 0) <= 0) return false;

    const angle = (attacker.rotation ?? 0) * Math.PI / 180;
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    const rightX = -forwardY;
    const rightY = forwardX;
    const relX = defender.x - attacker.x;
    const relY = defender.y - attacker.y;
    const forwardDistance = relX * forwardX + relY * forwardY;
    const sideDistance = relX * rightX + relY * rightY;
    const swordLength = attacker.size;
    const swordWidth = 18;
    const defenderRadius = defender.size / 2;

    return forwardDistance >= 0
        && forwardDistance <= swordLength + defenderRadius
        && Math.abs(sideDistance) <= swordWidth / 2 + defenderRadius;
}

function isBlockingHit(defender, attacker) {
    if ((defender.blockActiveMs ?? 0) <= 0 || (defender.blockCharges ?? 0) <= 0) return false;

    const incomingAngle = Math.atan2(attacker.y - defender.y, attacker.x - defender.x) * 180 / Math.PI;
    return Math.abs(angleDelta(defender.rotation ?? 0, incomingAngle)) <= 95;
}

function resolveCombatDamage(first, second) {
    let nextFirst = first;
    let nextSecond = second;

    if (isSwingHitting(first, second)) {
        if (isBlockingHit(second, first)) {
            nextSecond = consumeBlockCharges(nextSecond, 1);
        } else {
            nextSecond = { ...nextSecond, hp: Math.max(0, (nextSecond.hp ?? MELEE_HP) - incomingMeleeDamage(nextSecond)) };
        }
    }

    if (isSwingHitting(second, first)) {
        if (isBlockingHit(first, second)) {
            nextFirst = consumeBlockCharges(nextFirst, 1);
        } else {
            nextFirst = { ...nextFirst, hp: Math.max(0, (nextFirst.hp ?? MELEE_HP) - incomingMeleeDamage(nextFirst)) };
        }
    }

    if (isGunHitting(first, second)) {
        if (isBlockingHit(second, first)) {
            nextSecond = consumeBlockCharges(nextSecond, 1);
        } else {
            nextSecond = { ...nextSecond, hp: Math.max(0, (nextSecond.hp ?? MELEE_HP) - incomingGunDamage(first, second)) };
        }
    }

    if (isGunHitting(second, first)) {
        if (isBlockingHit(first, second)) {
            nextFirst = consumeBlockCharges(nextFirst, 1);
        } else {
            nextFirst = { ...nextFirst, hp: Math.max(0, (nextFirst.hp ?? MELEE_HP) - incomingGunDamage(second, first)) };
        }
    }

    return [nextFirst, nextSecond];
}

function consumeBlockCharges(fighter, charges) {
    const nextCharges = Math.max(0, (fighter.blockCharges ?? 0) - charges);
    return {
        ...fighter,
        blockCharges: nextCharges,
        blockRechargeMs: nextCharges < BLOCK_MAX_CHARGES ? (fighter.blockRechargeMs ?? fighter.blockCooldownMs ?? 0) : 0,
        blockCooldownMs: nextCharges < BLOCK_MAX_CHARGES ? (fighter.blockRechargeMs ?? fighter.blockCooldownMs ?? 0) : 0,
        blockActiveMs: nextCharges > 0 ? fighter.blockActiveMs : 0,
    };
}

function incomingMeleeDamage(defender) {
    return Math.round(MELEE_DAMAGE * (defender.inDamageZone ? DAMAGE_ZONE_DAMAGE_MULTIPLIER : 1));
}

function isGunHitting(attacker, defender) {
    if (!attacker.gunShotActive) return false;

    const angle = (attacker.rotation ?? 0) * Math.PI / 180;
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    const rightX = -forwardY;
    const rightY = forwardX;
    const relX = defender.x - attacker.x;
    const relY = defender.y - attacker.y;
    const forwardDistance = relX * forwardX + relY * forwardY;
    const sideDistance = relX * rightX + relY * rightY;
    const defenderRadius = defender.size / 2;

    return forwardDistance >= 0
        && forwardDistance <= GUN_RANGE + defenderRadius
        && Math.abs(sideDistance) <= defenderRadius;
}

function incomingGunDamage(attacker, defender) {
    const distance = Math.hypot(defender.x - attacker.x, defender.y - attacker.y);
    let damage = 0;
    const falloff = RANGED_DAMAGE_FALLOFF;
    if (distance <= falloff[0].distance) damage = falloff[0].damage;
    else {
        for (let index = 1; index < falloff.length; index += 1) {
            const previous = falloff[index - 1];
            const next = falloff[index];
            if (distance <= next.distance) {
                damage = interpolateDamage(distance, previous.distance, next.distance, previous.damage, next.damage);
                break;
            }
        }
    }
    return Math.round(damage * (defender.inDamageZone ? DAMAGE_ZONE_DAMAGE_MULTIPLIER : 1));
}

function createGrenadeShape(shape) {
    const angle = (shape.rotation ?? 0) * Math.PI / 180;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const spawnDistance = (shape.size ?? 60) / 2 + GRENADE_SIZE / 2 + 2;
    return {
        id: `grenade-${shape.id}-${shape.grenadeSerial ?? 1}`,
        type: "grenade",
        ownerId: shape.id,
        x: shape.x + directionX * spawnDistance,
        y: shape.y + directionY * spawnDistance,
        size: GRENADE_SIZE,
        rotation: 0,
        velocityX: directionX * GRENADE_THROW_SPEED,
        velocityY: directionY * GRENADE_THROW_SPEED,
        stoppedMs: 0,
        locked: true,
    };
}

function updateGrenades(grenades, fighters) {
    const remaining = [];
    const explosions = [];
    for (const grenade of grenades) {
        if (grenade.type === "grenadeExplosion") {
            const remainingMs = Math.max(0, (grenade.remainingMs ?? 0) - AUTO_STEP_MS);
            if (remainingMs > 0) remaining.push({ ...grenade, remainingMs });
            continue;
        }
        const next = advanceGrenade(grenade);
        const touchedOpponent = fighters.some((fighter) => (
            fighter.id !== next.ownerId && overlapsShape(fighter, next)
        ));
        const stoppedLongEnough = Math.hypot(next.velocityX ?? 0, next.velocityY ?? 0) <= 0.001
            && (next.stoppedMs ?? 0) >= GRENADE_STOP_FUSE_MS;
        if (touchedOpponent || stoppedLongEnough) {
            explosions.push(createGrenadeExplosionShape(next));
        } else {
            remaining.push(next);
        }
    }
    return { grenades: remaining, explosions };
}

function advanceGrenade(grenade) {
    const intendedX = grenade.x + (grenade.velocityX ?? 0);
    const intendedY = grenade.y + (grenade.velocityY ?? 0);
    let next = {
        ...grenade,
        x: clamp(intendedX, GRENADE_SIZE / 2, CANVAS_SIZE - GRENADE_SIZE / 2),
        y: clamp(intendedY, GRENADE_SIZE / 2, CANVAS_SIZE - GRENADE_SIZE / 2),
    };
    const hitWall = next.x !== intendedX || next.y !== intendedY;
    if (hitWall) {
        next.velocityX = 0;
        next.velocityY = 0;
    } else {
        const speed = Math.hypot(next.velocityX ?? 0, next.velocityY ?? 0);
        if (speed <= GRENADE_DECELERATION_PER_TICK) {
            next.velocityX = 0;
            next.velocityY = 0;
        } else {
            const nextSpeed = speed - GRENADE_DECELERATION_PER_TICK;
            next.velocityX = next.velocityX / speed * nextSpeed;
            next.velocityY = next.velocityY / speed * nextSpeed;
        }
    }
    next.stoppedMs = Math.hypot(next.velocityX ?? 0, next.velocityY ?? 0) <= 0.001
        ? (next.stoppedMs ?? 0) + AUTO_STEP_MS
        : 0;
    return next;
}

function createGrenadeExplosionShape(grenade) {
    return {
        id: `${grenade.id}-explosion`,
        type: "grenadeExplosion",
        ownerId: grenade.ownerId,
        x: grenade.x,
        y: grenade.y,
        size: GRENADE_EXPLOSION_RADIUS * 2,
        rotation: 0,
        remainingMs: 200,
        locked: true,
    };
}

function applyGrenadeExplosionDamage(fighters, explosions) {
    return fighters.map((fighter) => {
        const damage = explosions.reduce((total, explosion) => total + grenadeDamageToFighter(explosion, fighter), 0);
        const shieldCharges = explosions.reduce((total, explosion) => total + grenadeShieldChargesToFighter(explosion, fighter), 0);
        if ((fighter.blockActiveMs ?? 0) > 0 && (fighter.blockCharges ?? 0) > 0 && shieldCharges > 0) {
            return consumeBlockCharges(fighter, shieldCharges);
        }
        return damage > 0
            ? { ...fighter, hp: Math.max(0, (fighter.hp ?? MELEE_HP) - damage) }
            : fighter;
    });
}

function grenadeDamageToFighter(explosion, fighter) {
    const nearestBodyDistance = Math.max(0, Math.hypot(fighter.x - explosion.x, fighter.y - explosion.y) - (fighter.size ?? 60) / 2);
    if (nearestBodyDistance > GRENADE_EXPLOSION_RADIUS) return 0;
    const rawDamage = interpolateDamage(nearestBodyDistance, 0, GRENADE_EXPLOSION_RADIUS, 50, 25);
    return clamp(Math.round(rawDamage / 5) * 5, 25, 50);
}

function grenadeShieldChargesToFighter(explosion, fighter) {
    const nearestBodyDistance = Math.max(0, Math.hypot(fighter.x - explosion.x, fighter.y - explosion.y) - (fighter.size ?? 60) / 2);
    if (nearestBodyDistance > GRENADE_EXPLOSION_RADIUS) return 0;
    const rawCharges = interpolateDamage(nearestBodyDistance, 0, GRENADE_EXPLOSION_RADIUS, 5, 1);
    return clamp(Math.round(rawCharges), 1, 5);
}

function interpolateDamage(distance, minDistance, maxDistance, nearDamage, farDamage) {
    const t = clamp((distance - minDistance) / (maxDistance - minDistance), 0, 1);
    return nearDamage + (farDamage - nearDamage) * t;
}

function overlapsObstacle(shape, obstacle) {
    return overlapsShape(shape, obstacle);
}

function overlapsShape(first, second, padding = 0) {
    return Math.hypot(first.x - second.x, first.y - second.y) <= ((first.size ?? 60) + (second.size ?? 0)) / 2 + padding;
}

function resolveObstacleEffects(fighters, obstacles) {
    let nextFighters = fighters.map((fighter) => ({ ...fighter }));
    const remainingObstacles = [];

    for (const obstacle of obstacles) {
        if (obstacle.type !== "healthPack") {
            remainingObstacles.push(obstacle);
            continue;
        }
        const collectorIndex = nextFighters.findIndex((fighter) => overlapsObstacle(fighter, obstacle));
        if (collectorIndex === -1) {
            remainingObstacles.push(obstacle);
            continue;
        }
        nextFighters[collectorIndex] = {
            ...nextFighters[collectorIndex],
            hp: Math.min(
                combatClassHp(nextFighters[collectorIndex].combatClass),
                (nextFighters[collectorIndex].hp ?? combatClassHp(nextFighters[collectorIndex].combatClass)) + HEALTH_PACK_HEAL,
            ),
        };
    }

    const damageZones = remainingObstacles.filter((obstacle) => obstacle.type === "damageZone");
    nextFighters = nextFighters.map((fighter) => {
        const previousZoneIds = new Set(fighter.damageZoneIds ?? []);
        const currentZoneIds = damageZones
            .filter((zone) => overlapsObstacle(fighter, zone))
            .map((zone) => zone.id);
        const entered = currentZoneIds.some((id) => !previousZoneIds.has(id));
        return {
            ...fighter,
            hp: entered ? Math.max(0, (fighter.hp ?? MELEE_HP) - DAMAGE_ZONE_ENTRY_DAMAGE) : fighter.hp,
            damageZoneIds: currentZoneIds,
            inDamageZone: currentZoneIds.length > 0,
        };
    });

    return { fighters: nextFighters, obstacles: remainingObstacles };
}

function buildDeterministicLogicAction(configuration, stateSnapshot) {
    const plan = selectMeleeStrategyActionPlan(configuration, stateSnapshot);
    const movementBlock = plan.movement ?? plan.dashMovement ?? null;
    const facingBlock = plan.rotation ?? plan.swing ?? plan.block ?? plan.grenade;
    const movementTarget = resolveActionTarget(stateSnapshot, movementBlock?.actionTarget);
    const facingTarget = resolveActionTarget(stateSnapshot, facingBlock?.actionTarget ?? movementBlock?.actionTarget);
    const movement = movementVectorForAction(movementBlock?.action ?? "move_stop", stateSnapshot.playerModel, movementTarget);
    const turnAction = facingBlock?.action ?? "move_stop";
    const shouldTurn = turnAction === "rotate_toward_enemy" || turnAction === "swing" || turnAction === "block" || turnAction === "throw_grenade";
    return {
        dx: movement.dx,
        dy: movement.dy,
        dRot: shouldTurn ? turnTowardTarget(stateSnapshot.playerModel, facingTarget) : 0,
        swing: plan.swing?.action === "swing" ? 1 : 0,
        block: plan.block?.action === "block" ? 1 : 0,
        gun: plan.gun?.action === "fire_gun" ? 1 : 0,
        grenade: plan.grenade?.action === "throw_grenade" ? 1 : 0,
        dash: plan.dash?.action?.startsWith("dash") ? 1 : 0,
    };
}

function resolveActionTarget(stateSnapshot, actionTarget = "opponent") {
    const objects = Array.isArray(stateSnapshot?.objects) ? stateSnapshot.objects : [];
    if (actionTarget && actionTarget !== "opponent") {
        return objects.find((object) => object.id === actionTarget) ?? null;
    }
    return objects.find((object) => object.type === "opponentModel") ?? null;
}

function movementVectorForAction(action, player, target) {
    if (!player || action === "move_stop" || action === "rotate_toward_enemy" || action === "swing" || action === "block" || action === "fire_gun" || action === "throw_grenade") {
        return { dx: 0, dy: 0 };
    }
    if (action === "move_center") {
        return { dx: CANVAS_SIZE / 2 - player.x, dy: CANVAS_SIZE / 2 - player.y };
    }
    if (action === "move_north") return { dx: 0, dy: -1 };
    if (action === "move_south") return { dx: 0, dy: 1 };
    if (action === "move_east") return { dx: 1, dy: 0 };
    if (action === "move_west") return { dx: -1, dy: 0 };
    if (action === "move_northeast") return { dx: Math.SQRT1_2, dy: -Math.SQRT1_2 };
    if (action === "move_northwest") return { dx: -Math.SQRT1_2, dy: -Math.SQRT1_2 };
    if (action === "move_southeast") return { dx: Math.SQRT1_2, dy: Math.SQRT1_2 };
    if (action === "move_southwest") return { dx: -Math.SQRT1_2, dy: Math.SQRT1_2 };
    if (action === "dash_north") return { dx: 0, dy: -1 };
    if (action === "dash_south") return { dx: 0, dy: 1 };
    if (action === "dash_east") return { dx: 1, dy: 0 };
    if (action === "dash_west") return { dx: -1, dy: 0 };
    if (action === "dash_northeast") return { dx: Math.SQRT1_2, dy: -Math.SQRT1_2 };
    if (action === "dash_northwest") return { dx: -Math.SQRT1_2, dy: -Math.SQRT1_2 };
    if (action === "dash_southeast") return { dx: Math.SQRT1_2, dy: Math.SQRT1_2 };
    if (action === "dash_southwest") return { dx: -Math.SQRT1_2, dy: Math.SQRT1_2 };
    if (!target) return { dx: 0, dy: 0 };
    const inward = { dx: target.x - player.x, dy: target.y - player.y };
    const outward = { dx: -inward.dx, dy: -inward.dy };
    const tangentLeft = { dx: inward.dy, dy: -inward.dx };
    const tangentRight = { dx: -inward.dy, dy: inward.dx };
    if (action === "move_inward" || action === "dash") return inward;
    if (action === "move_outward" || action === "dash_outward") return outward;
    if (action === "move_tangent_left" || action === "dash_tangent_left") return tangentLeft;
    if (action === "move_tangent_right" || action === "dash_tangent_right") return tangentRight;
    if (action === "move_diagonal_in_left" || action === "dash_diagonal_in_left") return addVectors(inward, tangentLeft);
    if (action === "move_diagonal_in_right" || action === "dash_diagonal_in_right") return addVectors(inward, tangentRight);
    if (action === "move_diagonal_out_left" || action === "dash_diagonal_out_left") return addVectors(outward, tangentLeft);
    if (action === "move_diagonal_out_right" || action === "dash_diagonal_out_right") return addVectors(outward, tangentRight);
    return { dx: 0, dy: 0 };
}

function addVectors(first, second) {
    return { dx: first.dx + second.dx, dy: first.dy + second.dy };
}

function turnTowardTarget(player, target) {
    if (!player || !target) return 0;
    const bearing = Math.atan2(target.y - player.y, target.x - player.x) * 180 / Math.PI;
    return clamp(angleDelta(player.rotation ?? 0, bearing) / ROTATION_STEP_DEG, -1, 1);
}

function idleAction() {
    return {
        dx: 0,
        dy: 0,
        dRot: 0,
        swing: 0,
        block: 0,
        gun: 0,
        grenade: 0,
        dash: 0,
    };
}

export default function BetaModel({
    matchContext = null,
    finishStatus = null,
    onFinishMatch = null,
    onSurrenderMatch = null
}) {
    const matchId = matchContext?.matchId;
    const matchUserId = matchContext?.player?.userId;
    const isMatchTraining = Boolean(matchId && matchUserId);
    const playerRoundWins = Math.max(0, Number(matchContext?.player?.roundWins) || 0);
    const opponentRoundWins = Math.max(0, Number(matchContext?.opponent?.roundWins) || 0);
    const [selectedClass, setSelectedClass] = useState(() => matchContext?.player?.selectedClass ?? "melee");
    const [opponentSelectedClass, setOpponentSelectedClass] = useState(() => matchContext?.opponent?.selectedClass ?? "melee");
    const strategyStorageKey = matchStrategyConfigurationKey(matchId, matchUserId, selectedClass);
    const opponentStrategyStorageKey = opponentStrategyConfigurationKey(matchId, matchUserId, opponentSelectedClass);
    const [shapes, setShapes] = useState(() => buildInitialArenaShapes(matchContext));
    const [selectedId, setSelectedId] = useState(null);
    const [submitStatus, setSubmitStatus] = useState(null);
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);
    const [hasArenaCheckpoint, setHasArenaCheckpoint] = useState(false);
    const [isBaseTraining] = useState(false);
    const [baseCandidate] = useState(null);
    const [baseExportState] = useState("idle");
    const [isEditingArena, setIsEditingArena] = useState(true);
    const [trainingConfiguration, setTrainingConfiguration] = useState(() => (
        sanitizeStrategyConfigurationForClass(loadStoredStrategyConfiguration(strategyStorageKey), selectedClass)
    ));
    const [opponentTrainingConfiguration, setOpponentTrainingConfiguration] = useState(() => (
        sanitizeStrategyConfigurationForClass(loadStoredStrategyConfiguration(opponentStrategyStorageKey), opponentSelectedClass)
    ));
    const [isStrategyTraining, setIsStrategyTraining] = useState(false);
    const [, setTrainingProgress] = useState(null);
    const [, setTrainingSummary] = useState(null);
    const [trainingSessionId, setTrainingSessionId] = useState(() => isMatchTraining
        ? null
        : localStorage.getItem(SESSION_KEY));
    const [submittedModelId, setSubmittedModelId] = useState(null);
    const [isFinishingMatch, setIsFinishingMatch] = useState(false);
    const [trainingRemaining, setTrainingRemaining] = useState(() =>
        secondsRemaining(matchContext?.trainingEndsAtMs ?? matchContext?.trainingEndsAt));

    const autoIntervalRef = useRef(null);
    const originalArenaShapesRef = useRef(null);
    const arenaCheckpointShapesRef = useRef(null);
    const finishHandlerRef = useRef(null);
    const trainingRunRef = useRef(null);
    const trainingSummaryRef = useRef(null);

    useEffect(() => {
        if (!originalArenaShapesRef.current) {
            originalArenaShapesRef.current = resetArenaStartShapes(
                cloneShapes(shapes),
                selectedClass,
                opponentSelectedClass,
            );
        }
    }, [opponentSelectedClass, selectedClass, shapes]);

    const ensureTrainingSession = useCallback(async ({ required = false } = {}) => {
        try {
            const session = await createTrainingSession(isMatchTraining ? matchId : null);
            if (!isMatchTraining) {
                localStorage.setItem(SESSION_KEY, session.trainingSessionId);
            }
            setTrainingSessionId(session.trainingSessionId);
            return session.trainingSessionId;
        } catch (err) {
            console.warn("[arena-ml] Unable to create server training session.", err);
            setSubmitStatus({
                ok: false,
                message: "Server training session unavailable",
            });
            setTimeout(() => setSubmitStatus(null), 3000);
            if (required) {
                throw err;
            }
            return null;
        }
    }, [isMatchTraining, matchId]);

    useEffect(() => {
        const trainingSessionTimeoutId = window.setTimeout(() => ensureTrainingSession(), 0);

        return () => {
            window.clearTimeout(trainingSessionTimeoutId);
            if (autoIntervalRef.current) {
                clearInterval(autoIntervalRef.current);
            }
        };
    }, [ensureTrainingSession]);

    useEffect(() => {
        if (!matchContext?.opponent) return;
        const timeoutId = window.setTimeout(() => {
            setShapes((prev) => {
                if (prev.some((shape) => shape.type === "opponentModel")) {
                    return prev.map((shape) => shape.type === "opponentModel"
                        ? {
                            ...shape,
                            opponentUsername: matchContext.opponent.username,
                            combatClass: matchContext.opponent.selectedClass ?? shape.combatClass ?? "melee",
                            hp: combatClassHp(matchContext.opponent.selectedClass ?? shape.combatClass ?? "melee"),
                        }
                        : shape);
                }
                return [...prev, buildOpponentShape(matchContext.opponent)];
            });
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [matchContext?.opponent]);

    const fetchTrustedTrainingDuration = async (sessionId = trainingSessionId) => {
        if (!sessionId) return null;

        try {
            return await fetchTrainingSessionDuration(sessionId);
        } catch {
            return null;
        }
    };

    const updateTrainingConfiguration = (configuration) => {
        const sanitized = sanitizeStrategyConfigurationForClass(configuration, selectedClass);
        setTrainingConfiguration(sanitized);
        if (strategyStorageKey) {
            localStorage.setItem(strategyStorageKey, JSON.stringify(sanitized));
        }
    };

    const updateOpponentTrainingConfiguration = (configuration) => {
        const sanitized = sanitizeStrategyConfigurationForClass(configuration, opponentSelectedClass);
        setOpponentTrainingConfiguration(sanitized);
        localStorage.setItem(opponentStrategyStorageKey, JSON.stringify(sanitized));
    };

    const handleClassChange = (combatClass) => {
        if (isMatchTraining || isAutoPlaying || isStrategyTraining) return;
        setSelectedClass(combatClass);
        setTrainingConfiguration(sanitizeStrategyConfigurationForClass(
            loadStoredStrategyConfiguration(matchStrategyConfigurationKey(matchId, matchUserId, combatClass)),
            combatClass,
        ));
        setShapes((prev) => prev.map((shape) => (
            shape.id === "main"
                ? {
                    ...shape,
                    combatClass,
                    hp: combatClassHp(combatClass),
                    blockCooldownMs: 0,
                    blockActiveMs: 0,
                    blockCharges: combatClass === "melee" ? BLOCK_MAX_CHARGES : 0,
                    blockRechargeMs: 0,
                    gunCooldownMs: 0,
                    gunActiveMs: 0,
                    gunShotActive: false,
                    gunAmmo: combatClass === "ranged" ? RANGED_AMMO_MAX : 0,
                    gunReloadMs: 0,
                    grenadeCooldownMs: 0,
                    grenadeSerial: 1,
                    thrownGrenade: null,
                    movementVelocityX: 0,
                    movementVelocityY: 0,
                }
                : shape
        )));
    };

    const handleOpponentClassChange = (combatClass) => {
        if (isMatchTraining || isAutoPlaying || isStrategyTraining) return;
        setOpponentSelectedClass(combatClass);
        setOpponentTrainingConfiguration(sanitizeStrategyConfigurationForClass(
            loadStoredStrategyConfiguration(opponentStrategyConfigurationKey(matchId, matchUserId, combatClass)),
            combatClass,
        ));
        setShapes((prev) => prev.map((shape) => (
            shape.id === "opponent-model"
                ? {
                    ...shape,
                    combatClass,
                    hp: combatClassHp(combatClass),
                    blockCooldownMs: 0,
                    blockActiveMs: 0,
                    blockCharges: combatClass === "melee" ? BLOCK_MAX_CHARGES : 0,
                    blockRechargeMs: 0,
                    gunCooldownMs: 0,
                    gunActiveMs: 0,
                    gunShotActive: false,
                    gunAmmo: combatClass === "ranged" ? RANGED_AMMO_MAX : 0,
                    gunReloadMs: 0,
                    grenadeCooldownMs: 0,
                    grenadeSerial: 1,
                    thrownGrenade: null,
                    movementVelocityX: 0,
                    movementVelocityY: 0,
                }
                : shape
        )));
    };

    const handleAddShape = useCallback((type) => {
        setShapes((prev) => {
            if (type === "main") {
                setSelectedId("main");
                return prev;
            }
            const existingOpponent = prev.find((shape) => shape.id === "opponent-model");
            if (type === "opponentModel" && existingOpponent) {
                setSelectedId(existingOpponent.id);
                return prev;
            }
            if (isObstacleType(type)) {
                if (isMatchTraining) return prev;
                if (prev.filter((shape) => isObstacleType(shape.type)).length >= MAX_OBSTACLES) return prev;
                const obstacle = buildObstacleShape(type, nextObstacleId(prev), Math.random, false, prev);
                setSelectedId(obstacle.id);
                return [...prev, obstacle];
            }
            const s = {
                id: type === "opponentModel" ? "opponent-model" : genId(),
                type,
                x: Math.round(150 + Math.random() * 500),
                y: Math.round(150 + Math.random() * 500),
                size: type === "opponentModel" ? 64 : 60,
                rotation: 0,
                combatClass: type === "opponentModel" ? opponentSelectedClass : undefined,
                hp: type === "opponentModel" ? combatClassHp(opponentSelectedClass) : undefined,
                swingCooldownMs: 0,
                swingActiveMs: 0,
                blockCooldownMs: 0,
                blockActiveMs: 0,
                blockCharges: type === "opponentModel" && opponentSelectedClass === "melee" ? BLOCK_MAX_CHARGES : 0,
                blockRechargeMs: 0,
                gunCooldownMs: 0,
                gunActiveMs: 0,
                gunShotActive: false,
                gunAmmo: type === "opponentModel" && opponentSelectedClass === "ranged" ? RANGED_AMMO_MAX : 0,
                gunReloadMs: 0,
                grenadeCooldownMs: 0,
                grenadeSerial: 1,
                thrownGrenade: null,
                dashCooldownMs: 0,
                dashActiveMs: 0,
                dashDirectionX: 0,
                dashDirectionY: 0,
                movementVelocityX: 0,
                movementVelocityY: 0,
                velocityX: 0,
                velocityY: 0,
            };
            setSelectedId(s.id);
            return [...prev, s];
        });
    }, [isMatchTraining, opponentSelectedClass]);

    const handleUpdateShape = useCallback((id, updates) => {
        setShapes((prev) =>
            prev.map((s) => {
                if (s.id !== id) return s;
                if (s.locked) return s;
                if (s.id === "main") {
                    const {
                        x,
                        y,
                        rotation,
                        hp,
                        swingCooldownMs,
                        swingActiveMs,
                        blockCooldownMs,
                        blockActiveMs,
                        blockCharges,
                        blockRechargeMs,
                        gunCooldownMs,
                        gunActiveMs,
                        gunShotActive,
                        gunAmmo,
                        gunReloadMs,
                        grenadeCooldownMs,
                        grenadeSerial,
                        thrownGrenade,
                        dashCooldownMs,
                        dashActiveMs,
                        dashDirectionX,
                        dashDirectionY,
                        movementVelocityX,
                        movementVelocityY,
                        velocityX,
                        velocityY,
                    } = updates;
                    return (x !== undefined || y !== undefined || rotation !== undefined || hp !== undefined
                        || swingCooldownMs !== undefined || swingActiveMs !== undefined
                        || blockCooldownMs !== undefined || blockActiveMs !== undefined
                        || blockCharges !== undefined || blockRechargeMs !== undefined
                        || gunCooldownMs !== undefined || gunActiveMs !== undefined || gunShotActive !== undefined
                        || gunAmmo !== undefined || gunReloadMs !== undefined
                        || grenadeCooldownMs !== undefined || grenadeSerial !== undefined || thrownGrenade !== undefined
                        || dashCooldownMs !== undefined || dashActiveMs !== undefined
                        || dashDirectionX !== undefined || dashDirectionY !== undefined
                        || movementVelocityX !== undefined || movementVelocityY !== undefined
                        || velocityX !== undefined || velocityY !== undefined)
                        ? {
                            ...s,
                            x: x ?? s.x,
                            y: y ?? s.y,
                            rotation: rotation ?? s.rotation,
                            hp: hp ?? s.hp,
                            swingCooldownMs: swingCooldownMs ?? s.swingCooldownMs,
                            swingActiveMs: swingActiveMs ?? s.swingActiveMs,
                            blockCooldownMs: blockCooldownMs ?? s.blockCooldownMs,
                            blockActiveMs: blockActiveMs ?? s.blockActiveMs,
                            blockCharges: blockCharges ?? s.blockCharges,
                            blockRechargeMs: blockRechargeMs ?? s.blockRechargeMs,
                            gunCooldownMs: gunCooldownMs ?? s.gunCooldownMs,
                            gunActiveMs: gunActiveMs ?? s.gunActiveMs,
                            gunShotActive: gunShotActive ?? s.gunShotActive,
                            gunAmmo: gunAmmo ?? s.gunAmmo,
                            gunReloadMs: gunReloadMs ?? s.gunReloadMs,
                            grenadeCooldownMs: grenadeCooldownMs ?? s.grenadeCooldownMs,
                            grenadeSerial: grenadeSerial ?? s.grenadeSerial,
                            thrownGrenade: thrownGrenade ?? s.thrownGrenade,
                            dashCooldownMs: dashCooldownMs ?? s.dashCooldownMs,
                            dashActiveMs: dashActiveMs ?? s.dashActiveMs,
                            dashDirectionX: dashDirectionX ?? s.dashDirectionX,
                            dashDirectionY: dashDirectionY ?? s.dashDirectionY,
                            movementVelocityX: movementVelocityX ?? s.movementVelocityX,
                            movementVelocityY: movementVelocityY ?? s.movementVelocityY,
                            velocityX: velocityX ?? s.velocityX,
                            velocityY: velocityY ?? s.velocityY,
                        }
                        : s;
                }
                return { ...s, ...updates };
            })
        );
    }, []);

    const handleDeleteSelectedShape = useCallback(() => {
        setShapes((prev) => {
            const selected = prev.find((shape) => shape.id === selectedId);
            if (!isEditingArena || !selected || selected.id === "main" || selected.locked) return prev;
            setSelectedId(null);
            return prev.filter((shape) => shape.id !== selected.id);
        });
    }, [isEditingArena, selectedId]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key !== "Delete" && event.key !== "Backspace") return;
            if (event.target?.closest?.("input,select,textarea,button")) return;
            const selected = shapes.find((shape) => shape.id === selectedId);
            if (!selected || selected.id === "main" || selected.locked || !isEditingArena) return;
            event.preventDefault();
            handleDeleteSelectedShape();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleDeleteSelectedShape, isEditingArena, selectedId, shapes]);

    const buildStatePayload = (currentShapes, actorId = "main") => {
        const main = currentShapes.find((s) => s.id === actorId);
        return {
            selectedClass,
            playerModel: {
                x: Math.round(main.x),
                y: Math.round(main.y),
                rotation: Math.round(main.rotation ?? 0),
                swingAvailable: (main.swingCooldownMs ?? 0) <= 0,
                swingCooldownRemainingMs: Math.round(main.swingCooldownMs ?? 0),
                blockAvailable: (main.blockCharges ?? 0) > 0,
                blockActive: (main.blockActiveMs ?? 0) > 0,
                blockActiveRemainingMs: (main.blockActiveMs ?? 0) > 0 ? 1 : 0,
                blockCooldownRemainingMs: Math.max(0, BLOCK_RECHARGE_MS - Math.round(main.blockRechargeMs ?? main.blockCooldownMs ?? 0)),
                blockCharges: main.blockCharges ?? 0,
                combatClass: main.combatClass ?? selectedClass,
                gunAvailable: (main.combatClass ?? selectedClass) === "ranged"
                    && (main.gunAmmo ?? RANGED_AMMO_MAX) > 0
                    && (main.gunReloadMs ?? 0) <= 0
                    && (main.gunCooldownMs ?? 0) <= 0
                    && (main.gunActiveMs ?? 0) <= 0,
                gunActive: (main.gunActiveMs ?? 0) > 0,
                gunCooldownRemainingMs: Math.round(main.gunCooldownMs ?? 0),
                gunAmmo: main.gunAmmo ?? ((main.combatClass ?? selectedClass) === "ranged" ? RANGED_AMMO_MAX : 0),
                gunReloadRemainingMs: Math.round(main.gunReloadMs ?? 0),
                grenadeAvailable: (main.combatClass ?? selectedClass) === "ranged" && (main.grenadeCooldownMs ?? 0) <= 0,
                grenadeCooldownRemainingMs: Math.round(main.grenadeCooldownMs ?? 0),
                hp: main.hp ?? MELEE_HP,
                size: main.size,
                dashAvailable: combatClassConfig(main.combatClass ?? selectedClass).actionIds.includes("dash")
                    && (main.dashCooldownMs ?? 0) <= 0 && (main.dashActiveMs ?? 0) <= 0,
                dashActive: (main.dashActiveMs ?? 0) > 0,
                dashCooldownRemainingMs: Math.round(main.dashCooldownMs ?? 0),
            },
            objects: currentShapes
                .filter((s) => s.id !== actorId)
                .map((s) => ({
                    id: s.id,
                    ownerId: s.ownerId,
                    type: s.id === "main" && actorId !== "main" ? "opponentModel" : s.type,
                    x: Math.round(s.x),
                    y: Math.round(s.y),
                    size: s.size,
                    rotation: Math.round(s.rotation),
                    combatClass: s.combatClass,
                    hp: s.hp ?? MELEE_HP,
                    swingActive: (s.swingActiveMs ?? 0) > 0,
                    swingAvailable: (s.swingCooldownMs ?? 0) <= 0,
                    swingCooldownRemainingMs: Math.round(s.swingCooldownMs ?? 0),
                    blockActive: (s.blockActiveMs ?? 0) > 0,
                    blockAvailable: (s.blockCharges ?? 0) > 0,
                    blockCooldownRemainingMs: Math.max(0, BLOCK_RECHARGE_MS - Math.round(s.blockRechargeMs ?? s.blockCooldownMs ?? 0)),
                    blockCharges: s.blockCharges ?? 0,
                    gunActive: (s.gunActiveMs ?? 0) > 0,
                    gunAvailable: s.combatClass === "ranged"
                        && (s.gunAmmo ?? RANGED_AMMO_MAX) > 0
                        && (s.gunReloadMs ?? 0) <= 0
                        && (s.gunCooldownMs ?? 0) <= 0
                        && (s.gunActiveMs ?? 0) <= 0,
                    gunCooldownRemainingMs: Math.round(s.gunCooldownMs ?? 0),
                    gunAmmo: s.gunAmmo ?? (s.combatClass === "ranged" ? RANGED_AMMO_MAX : 0),
                    gunReloadRemainingMs: Math.round(s.gunReloadMs ?? 0),
                    grenadeAvailable: s.combatClass === "ranged" && (s.grenadeCooldownMs ?? 0) <= 0,
                    grenadeCooldownRemainingMs: Math.round(s.grenadeCooldownMs ?? 0),
                    dashActive: (s.dashActiveMs ?? 0) > 0,
                    dashAvailable: combatClassConfig(s.combatClass).actionIds.includes("dash")
                        && (s.dashCooldownMs ?? 0) <= 0 && (s.dashActiveMs ?? 0) <= 0,
                    dashCooldownRemainingMs: Math.round(s.dashCooldownMs ?? 0),
                    velocityX: s.velocityX ?? 0,
                    velocityY: s.velocityY ?? 0,
                })),
        };
    };

    const runAutoPlay = () => {
        if (isAutoPlaying) return;
        setIsEditingArena(false);
        setIsAutoPlaying(true);
        setSelectedId(null);
        setShapes((prevShapes) => buildAutoPlayStartShapes(prevShapes, matchContext, isMatchTraining));

        autoIntervalRef.current = setInterval(() => {
            setShapes((prevShapes) => {
                const stateSnapshot = buildStatePayload(prevShapes);
                const playerAction = buildDeterministicLogicAction(trainingConfiguration, stateSnapshot);
                const mainBefore = prevShapes.find((s) => s.id === "main");
                const opponentBefore = prevShapes.find((s) => s.id === "opponent-model");
                const opponentAction = opponentBefore && hasStrategyActions(opponentTrainingConfiguration)
                    ? buildDeterministicLogicAction(opponentTrainingConfiguration, buildStatePayload(prevShapes, "opponent-model"))
                    : idleAction();

                let mainAfter = applyActionToShape(mainBefore, playerAction, AUTO_STEP_MS);
                let opponentAfter = opponentBefore
                    ? applyActionToShape(opponentBefore, opponentAction, AUTO_STEP_MS)
                    : null;
                let grenadeShapes = prevShapes.filter((shape) => shape.type === "grenade" || shape.type === "grenadeExplosion");
                grenadeShapes.push(...[mainAfter.thrownGrenade, opponentAfter?.thrownGrenade].filter(Boolean));
                mainAfter = { ...mainAfter, thrownGrenade: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, thrownGrenade: null };

                let obstacleShapes = prevShapes.filter((shape) => isObstacleType(shape.type));
                if (opponentAfter) {
                    const resolved = resolveObstacleEffects([mainAfter, opponentAfter], obstacleShapes);
                    [mainAfter, opponentAfter] = resolved.fighters;
                    obstacleShapes = resolved.obstacles;
                    [mainAfter, opponentAfter] = resolveCombatDamage(mainAfter, opponentAfter);
                    const grenadeUpdate = updateGrenades(grenadeShapes, [mainAfter, opponentAfter]);
                    [mainAfter, opponentAfter] = applyGrenadeExplosionDamage([mainAfter, opponentAfter], grenadeUpdate.explosions);
                    grenadeShapes = [...grenadeUpdate.grenades, ...grenadeUpdate.explosions];
                } else {
                    const resolved = resolveObstacleEffects([mainAfter], obstacleShapes);
                    [mainAfter] = resolved.fighters;
                    obstacleShapes = resolved.obstacles;
                    const grenadeUpdate = updateGrenades(grenadeShapes, [mainAfter]);
                    [mainAfter] = applyGrenadeExplosionDamage([mainAfter], grenadeUpdate.explosions);
                    grenadeShapes = [...grenadeUpdate.grenades, ...grenadeUpdate.explosions];
                }
                const obstacleById = new Map(obstacleShapes.map((shape) => [shape.id, shape]));

                const nextShapes = prevShapes.map((s) => {
                    if (s.id === "main") return mainAfter;
                    if (s.id === "opponent-model" && opponentAfter) return opponentAfter;
                    if (isObstacleType(s.type)) return obstacleById.get(s.id) ?? null;
                    if (s.type === "grenade" || s.type === "grenadeExplosion") return null;
                    return tickCombat(s, AUTO_STEP_MS);
                }).filter(Boolean);

                return [...nextShapes, ...grenadeShapes];
            });
        }, AUTO_STEP_MS);
    };

    const stopAutoPlay = () => {
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
        setIsAutoPlaying(false);
    };

    const resetArenaStats = () => {
        setSelectedId(null);
        setShapes((prevShapes) => prevShapes
            .filter((shape) => shape.type !== "grenade" && shape.type !== "grenadeExplosion")
            .map((shape) => (shape.id === "main" || shape.id === "opponent-model")
                ? resetFighterShape(shape)
                : cloneShape(shape)));
        setSubmitStatus({ ok: true, message: "Bot stats reset." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleSaveArenaCheckpoint = () => {
        if (isAutoPlaying || isStrategyTraining || isBaseTraining) return;
        arenaCheckpointShapesRef.current = cloneShapes(shapes);
        setHasArenaCheckpoint(true);
        setSubmitStatus({ ok: true, message: "Training checkpoint saved." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleResetArenaCheckpoint = () => {
        if (!arenaCheckpointShapesRef.current || isStrategyTraining || isBaseTraining) return;
        stopAutoPlay();
        setIsEditingArena(true);
        setSelectedId(null);
        setShapes(cloneShapes(arenaCheckpointShapesRef.current));
        setSubmitStatus({ ok: true, message: "Restored training checkpoint." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleFullArenaReset = () => {
        if (isStrategyTraining || isBaseTraining) return;
        const originalShapes = originalArenaShapesRef.current
            ?? resetArenaStartShapes(buildInitialArenaShapes(matchContext), selectedClass, opponentSelectedClass);
        stopAutoPlay();
        setIsEditingArena(true);
        setSelectedId(null);
        setShapes(resetArenaStartShapes(cloneShapes(originalShapes), selectedClass, opponentSelectedClass));
        setSubmitStatus({ ok: true, message: "Arena reset to the original start." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const stopStrategyTraining = () => {
        if (trainingRunRef.current) {
            trainingRunRef.current.cancelled = true;
            setSubmitStatus({ ok: null, message: "Stopping bot check..." });
        }
    };

    const startStrategyTraining = async () => {
        if (isStrategyTraining || isBaseTraining) return;
        const configuration = normalizeMeleeStrategyConfiguration(
            sanitizeStrategyConfigurationForClass(trainingConfiguration, selectedClass),
        );
        stopAutoPlay();
        const serverDeadline = matchContext?.trainingEndsAtMs ?? matchContext?.trainingEndsAt;
        const parsedServerDeadline = serverDeadline ? new Date(serverDeadline).getTime() : Number.POSITIVE_INFINITY;
        // Event-handler wall-clock check; intentionally sampled at click time.
        // eslint-disable-next-line react-hooks/purity
        const serverTimeRemainingMs = parsedServerDeadline - Date.now();
        if (serverDeadline && (!Number.isFinite(serverTimeRemainingMs) || serverTimeRemainingMs <= 0)) {
            setSubmitStatus({ ok: false, message: "The tuning window has ended." });
            return;
        }

        const run = { cancelled: false };
        const summary = {
            version: "deterministic-logic-check-v1",
            configuration,
            ruleCount: countStrategyBlocks(configuration),
        };
        trainingRunRef.current = run;
        updateTrainingConfiguration(configuration);
        setTrainingProgress(null);
        setTrainingSummary(summary);
        trainingSummaryRef.current = summary;
        setIsEditingArena(false);
        setIsStrategyTraining(true);
        setSubmitStatus({ ok: null, message: "Checking deterministic bot rules..." });

        try {
            setSubmittedModelId(null);
            setSubmitStatus({ ok: null, message: "Bot rules checked. Submitting brain..." });
            await handleSubmitModel({ preserveStatus: true });
        } catch (err) {
            console.warn("[arena-bot] Deterministic bot check failed.", err);
            setSubmitStatus({ ok: false, message: `Bot check failed: ${err.message}` });
        } finally {
            trainingRunRef.current = null;
            setIsStrategyTraining(false);
            setIsEditingArena(true);
        }
    };

    const handleTrainBaseModel = async () => {
        setSubmitStatus({ ok: false, message: "Base model training was removed. Bots now submit deterministic logic." });
    };

    const handleExportBaseModel = async () => {
        setSubmitStatus({ ok: false, message: "Base artifact export was removed. Logic blocks are the submitted brain." });
    };
    const handleAutoPlayToggle = () => {
        if (isAutoPlaying) {
            stopAutoPlay();
            setIsEditingArena(true);
            return;
        }
        runAutoPlay();
    };

    const handleResetRoundModel = async () => {
        if (!isMatchTraining || isBaseTraining || isStrategyTraining || finishStatus !== "TRAINING") return;
        setSubmittedModelId(null);
        trainingSummaryRef.current = null;
        setTrainingSummary(null);
        setTrainingProgress(null);
        setSubmitStatus({ ok: true, message: "Submitted bot brain reset. Current logic blocks are still editable." });
        setTimeout(() => setSubmitStatus(null), 3000);
    };
    const handleSubmitModel = async ({ preserveStatus = false } = {}) => {
        setSubmitStatus({ ok: null, message: "Submitting bot brain..." });

        try {
            const activeTrainingSessionId = trainingSessionId ?? await ensureTrainingSession({ required: true });
            if (!activeTrainingSessionId) {
                throw new Error("A server tuning session is required before submission.");
            }
            const trustedDurationMs = await fetchTrustedTrainingDuration(activeTrainingSessionId);
            const configuration = normalizeMeleeStrategyConfiguration(
                sanitizeStrategyConfigurationForClass(trainingConfiguration, selectedClass),
            );
            const trainingMetrics = trainingSummaryRef.current ?? {
                version: "deterministic-logic-submission-v1",
                configuration,
                trainingSamples: 0,
                validationSamples: 0,
                epochsCompleted: 0,
            };
            const payload = await buildModelSubmissionPayload({
                brain: configuration,
                matchId: isMatchTraining ? matchId : null,
                trainingSessionId: activeTrainingSessionId,
                trainingSteps: 0,
                selectedClass,
                trainingMetrics,
            });

            payload.trainingDurationMs = trustedDurationMs;

            const result = await submitModelPayload(payload);
            console.info("[arena-bot] Submitted bot brain contract:", payload);
            if (result.modelSubmissionId) {
                setSubmittedModelId(result.modelSubmissionId);
            }
            setSubmitStatus({
                ok: result.accepted !== false,
                message: result.message ?? "Bot brain submitted",
            });
            if (!preserveStatus) {
                setTimeout(() => setSubmitStatus(null), 4000);
            }
            return result;
        } catch (err) {
            setSubmitStatus({
                ok: false,
                message: err.message,
            });
            if (!preserveStatus) {
                setTimeout(() => setSubmitStatus(null), 4000);
            }
            return null;
        }
    };
    const handleFinishMatch = async () => {
        if (!onFinishMatch || finishStatus === "FINISHED" || finishStatus === "SURRENDERED" || isFinishingMatch) return;
        setIsFinishingMatch(true);

        const result = submittedModelId
            ? { modelSubmissionId: submittedModelId, accepted: true }
            : await handleSubmitModel({ preserveStatus: true });

        if (result?.modelSubmissionId && result.accepted !== false) {
            onFinishMatch(result.modelSubmissionId);
            setSubmitStatus({ ok: true, message: "Bot brain submitted. Waiting for opponent." });
        } else {
            setIsFinishingMatch(false);
        }
    };
    useEffect(() => {
        finishHandlerRef.current = handleFinishMatch;
    });

    useEffect(() => {
        const trainingDeadline = matchContext?.trainingEndsAtMs ?? matchContext?.trainingEndsAt;
        if (!trainingDeadline || !onFinishMatch || finishStatus === "FINISHED") return;

        const interval = setInterval(() => {
            const remaining = secondsRemaining(trainingDeadline);
            setTrainingRemaining(remaining);
            if (remaining === 0) {
                clearInterval(interval);
                finishHandlerRef.current?.();
            }
        }, 250);

        return () => clearInterval(interval);
    }, [matchContext?.trainingEndsAt, matchContext?.trainingEndsAtMs, finishStatus, onFinishMatch]);

    const selectedShape = shapes.find((shape) => shape.id === selectedId);
    const canDeleteSelectedShape = Boolean(
        isEditingArena
        && selectedShape
        && selectedShape.id !== "main"
        && !selectedShape.locked,
    );

    return (
        <div className="flex h-screen flex-col bg-arena-deep text-ink-hi font-ui overflow-hidden">
            {submitStatus && (
                <div role="status" aria-live="polite" className={`
                    fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                    px-4 py-2 rounded shadow-lg border text-xs font-mono tracking-widest
                    transition-opacity duration-300
                    ${submitStatus.ok === true
                        ? "bg-green-950 border-green-700 text-green-400"
                        : submitStatus.ok === false
                            ? "bg-red-950 border-red-700 text-red-400"
                            : "bg-arena-panel border-border-lo text-ink-muted"}
                `}>
                    {submitStatus.message}
                </div>
            )}

            <header className="flex items-center justify-between px-6 h-[52px] bg-arena-panel border-b border-border-lo flex-shrink-0">
                <div className="flex items-center gap-3">
                    <span className="text-xl text-cyan leading-none">M</span>
                    <span className="font-ui text-lg font-bold tracking-[0.15em] text-ink-white">MACHINER</span>
                </div>

                <div className="flex items-center gap-4">
                    {isMatchTraining && (
                        <span className="hidden lg:inline font-mono text-[10px] tracking-widest text-ink-muted">
                            {formatClock(trainingRemaining)}
                        </span>
                    )}
                    {matchContext?.opponent?.finished && finishStatus !== "FINISHED" && (
                        <span className="hidden lg:inline font-mono text-[10px] tracking-widest text-green-400">
                            OPPONENT FINISHED
                        </span>
                    )}
                    <div className="hidden xl:flex flex-col items-end font-mono text-[10px] tracking-widest text-ink-muted leading-tight">
                        <span>{MODEL_ARCHITECTURE_VERSION}</span>
                        <span>{FEATURE_SCHEMA_VERSION} / {ACTION_SCHEMA_VERSION}</span>
                    </div>
                    <span className="font-mono text-[11px] tracking-widest text-cyan-200">
                        {selectedClass.toUpperCase()}
                    </span>
                    {isMatchTraining && (
                        <span className="font-mono text-[10px] tracking-widest text-ink-muted">
                            ROUND {matchContext?.roundNumber ?? 1}/{Math.max(1, (matchContext?.winsRequired ?? 1) * 2 - 1)}
                        </span>
                    )}
                    {isMatchTraining && (
                        <div className="hidden md:flex items-center gap-2 rounded border border-border-lo bg-zinc-950/50 px-2 py-1 font-mono text-[10px] tracking-widest">
                            <span className="text-cyan-200">
                                YOU {playerRoundWins} WINS
                            </span>
                            <span className="text-ink-muted">/</span>
                            <span className="text-fuchsia-200">
                                {matchContext?.opponent?.username ?? "OPP"} {opponentRoundWins} WINS
                            </span>
                        </div>
                    )}
                    <span className="hidden lg:inline font-mono text-[11px] tracking-widest text-ink-muted">
                        {shapes.filter((shape) => isObstacleType(shape.type)).length} OBSTACLES
                    </span>

                </div>
            </header>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                <Toolbar
                    onAddShape={handleAddShape}
                    onSelectMain={() => setSelectedId("main")}
                    onDeleteSelected={handleDeleteSelectedShape}
                    selectedId={selectedId}
                    submitStatus={submitStatus}
                    obstacleCount={shapes.filter((shape) => isObstacleType(shape.type)).length}
                    obstaclesLocked={isMatchTraining}
                    canDeleteSelected={canDeleteSelectedShape}
                />

                <main className="min-w-0 flex-1 flex items-center justify-center bg-arena-deep overflow-auto p-6">
                    <div
                        className="relative"
                        style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
                    >
                        <Canvas
                            shapes={shapes}
                            selectedId={selectedId}
                            onSelectShape={isEditingArena ? setSelectedId : () => { }}
                            onUpdateShape={isEditingArena ? handleUpdateShape : () => { }}
                            onDeselectAll={isEditingArena ? () => setSelectedId(null) : () => { }}
                        />
                    </div>
                </main>

                <StrategyTrainingPanel
                    configuration={trainingConfiguration}
                    onChange={updateTrainingConfiguration}
                    opponentConfiguration={opponentTrainingConfiguration}
                    onOpponentChange={updateOpponentTrainingConfiguration}
                    onStartTraining={startStrategyTraining}
                    onStopTraining={stopStrategyTraining}
                    isTraining={isStrategyTraining}
                    selectedClass={selectedClass}
                    onClassChange={handleClassChange}
                    opponentSelectedClass={opponentSelectedClass}
                    onOpponentClassChange={handleOpponentClassChange}
                    canChangeClass={!isMatchTraining && !isAutoPlaying && !isStrategyTraining}
                    canChangeOpponentClass={!isMatchTraining && !isAutoPlaying && !isStrategyTraining}
                    isMatchTraining={isMatchTraining}
                    matchContext={matchContext}
                    trainingRemaining={trainingRemaining}
                    playerRoundWins={playerRoundWins}
                    opponentRoundWins={opponentRoundWins}
                    obstacleCount={shapes.filter((shape) => isObstacleType(shape.type)).length}
                    isAutoPlaying={isAutoPlaying}
                    hasArenaCheckpoint={hasArenaCheckpoint}
                    isBaseTraining={isBaseTraining}
                    baseCandidate={baseCandidate}
                    baseExportState={baseExportState}
                    finishStatus={finishStatus}
                    isFinishingMatch={isFinishingMatch}
                    canFinishMatch={Boolean(onFinishMatch)}
                    onAutoPlayToggle={handleAutoPlayToggle}
                    onResetArenaStats={resetArenaStats}
                    onSaveArenaCheckpoint={handleSaveArenaCheckpoint}
                    onResetArenaCheckpoint={handleResetArenaCheckpoint}
                    onFullArenaReset={handleFullArenaReset}
                    onResetRoundModel={handleResetRoundModel}
                    onTrainBaseModel={handleTrainBaseModel}
                    onExportBaseModel={handleExportBaseModel}
                    onFinishMatch={handleFinishMatch}
                    onSurrenderMatch={onSurrenderMatch}
                />
            </div>
        </div>
    );
}
