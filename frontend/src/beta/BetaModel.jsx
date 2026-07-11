import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import StrategyTrainingPanel from "./StrategyTrainingPanel";
import "./BetaModel.css";
import {
    createDefaultMeleeStrategyConfiguration,
    normalizeMeleeStrategyConfiguration,
    resolveMeleeStrategyTarget,
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
    DASH_MAX_CHARGES,
    DASH_RECHARGE_MS,
    MELEE_DAMAGE,
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
    FIREBALL_ACTIVE_MS,
    FIREBALL_BURN_DAMAGE,
    FIREBALL_BURN_DURATION_MS,
    FIREBALL_BURN_TICK_MS,
    FIREBALL_CHARGES_MAX,
    FIREBALL_COOLDOWN_MS,
    FIREBALL_DAMAGE,
    FIREBALL_RANGE,
    FIREBALL_RELOAD_MS,
    FIREBALL_SIZE,
    FIREBALL_SPEED,
    STUN_ACTIVE_MS,
    STUN_COOLDOWN_MS,
    STUN_DAMAGE,
    STUN_DURATION_MS,
    STUN_RANGE,
} from "./classes/MageClass.jsx";
import {
    BOUNCY_WALL_MAX_USES,
    BOUNCY_WALL_TYPE,
    BARRIER_TYPE,
    CENTER_OBJECTIVE_SIZE,
    COMMAND_LOCK_TYPE,
    INHIBITION_TYPE,
    OVERDRIVE_TYPE,
    PROJECTILE_WALL_LENGTH,
    PROJECTILE_WALL_THICKNESS,
    PROJECTILE_WALL_TYPE,
    RADAR_JAMMER_TYPE,
    snapWallRotation,
} from "./ArenaObjects.js";
import {
    actionIdsForCombatClass,
    combatClassConfig,
    combatClassHp,
    combatClassMoveSpeed,
} from "./classes/CombatClasses.js";
import {
    AUTO_STEP_MS,
    CANVAS_SIZE,
    DISPLAY_ARENA_MAX_SIZE,
    DAMAGE_ZONE_DAMAGE_MULTIPLIER,
    DAMAGE_ZONE_ENTRY_DAMAGE,
    DASH_DURATION_MS,
    DASH_SPEED,
    HEALTH_PACK_HEAL,
    MAX_OBSTACLES,
    MOVE_ACCELERATION_PER_TICK,
    MOVE_BRAKE_ACCELERATION_PER_TICK,
    ROTATION_STEP_DEG,
    SESSION_KEY,
} from "./modelPayloads/arenaConstants.js";
import {
    MAIN_SHAPE,
    buildAutoPlayStartShapes,
    buildInitialArenaShapes,
    matchObstacleShapes,
    buildObstacleShape,
    buildOpponentShape,
    cloneShape,
    cloneShapes,
    genId,
    isObstacleType,
    nextObstacleId,
    resetArenaStartShapes,
    resetFighterShape,
} from "./modelPayloads/arenaShapes.js";
import { buildStatePayload } from "./modelPayloads/strategyStatePayload.js";

const CENTER_OBJECTIVE_CAPTURE_MS = 5000;
const BUFF_DURATION_MS = 5000;
const CENTER_EFFECT_DURATION_MS = 5000;
const KILLABLE_BUFF_HP = 50;
const BARRIER_SHIELD_HP = 25;
const INHIBITION_ATTACK_CHARGES = 3;
const INHIBITION_SLOW_MS = 2000;
const INHIBITION_SPEED_MULTIPLIER = 0.6;

function targetObstacleShapes(shapes) {
    return cloneShapes((Array.isArray(shapes) ? shapes : []).filter((shape) => isObstacleType(shape.type)));
}

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
    const overdriveActive = (shape.overdriveMs ?? 0) > 0;
    const overdriveMs = Math.max(0, (shape.overdriveMs ?? 0) - elapsedMs);
    const cooldownElapsedMs = overdriveActive ? elapsedMs * 2 : elapsedMs;
    const blockRecharge = rechargeBlockCharges(shape, cooldownElapsedMs);
    return {
        ...shape,
        overdriveMs,
        barrierImmunityMs: Math.max(0, (shape.barrierImmunityMs ?? 0) - elapsedMs),
        slowedMs: Math.max(0, (shape.slowedMs ?? 0) - elapsedMs),
        jammedMs: Math.max(0, (shape.jammedMs ?? 0) - elapsedMs),
        commandLockedMs: Math.max(0, (shape.commandLockedMs ?? 0) - elapsedMs),
        commandLockAction: (shape.commandLockedMs ?? 0) > elapsedMs ? shape.commandLockAction : null,
        swingCooldownMs: Math.max(0, (shape.swingCooldownMs ?? 0) - cooldownElapsedMs),
        swingActiveMs: Math.max(0, (shape.swingActiveMs ?? 0) - elapsedMs),
        blockCooldownMs: blockRecharge.rechargeMs,
        blockActiveMs: 0,
        blockCharges: blockRecharge.charges,
        blockRechargeMs: blockRecharge.rechargeMs,
        gunCooldownMs: Math.max(0, (shape.gunCooldownMs ?? 0) - cooldownElapsedMs),
        gunActiveMs: Math.max(0, (shape.gunActiveMs ?? 0) - elapsedMs),
        gunShotActive: false,
        ...tickGunReload(shape, cooldownElapsedMs),
        grenadeCooldownMs: Math.max(0, (shape.grenadeCooldownMs ?? 0) - cooldownElapsedMs),
        thrownGrenade: null,
        fireballCooldownMs: Math.max(0, (shape.fireballCooldownMs ?? 0) - cooldownElapsedMs),
        fireballActiveMs: Math.max(0, (shape.fireballActiveMs ?? 0) - elapsedMs),
        ...tickFireballReload(shape, cooldownElapsedMs),
        thrownFireball: null,
        stunCooldownMs: Math.max(0, (shape.stunCooldownMs ?? 0) - cooldownElapsedMs),
        stunActiveMs: Math.max(0, (shape.stunActiveMs ?? 0) - elapsedMs),
        stunnedMs: Math.max(0, (shape.stunnedMs ?? 0) - elapsedMs),
        stunCastActive: false,
        ...tickBurn(shape, elapsedMs),
        ...tickDashRecharge(shape, cooldownElapsedMs),
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

function tickFireballReload(shape, elapsedMs) {
    if (shape.combatClass !== "mage") return { fireballCharges: 0, fireballReloadMs: 0 };
    const charges = Math.max(0, Math.min(FIREBALL_CHARGES_MAX, Math.round(Number(shape.fireballCharges ?? FIREBALL_CHARGES_MAX))));
    const reloadMs = Math.max(0, Number(shape.fireballReloadMs ?? 0) - elapsedMs);
    if (charges <= 0 && reloadMs <= 0) {
        return { fireballCharges: FIREBALL_CHARGES_MAX, fireballReloadMs: 0 };
    }
    return { fireballCharges: charges, fireballReloadMs: reloadMs };
}

function tickBurn(shape, elapsedMs) {
    let remainingMs = Math.max(0, Number(shape.burnRemainingMs ?? 0) - elapsedMs);
    let tickMs = Math.max(0, Number(shape.burnTickMs ?? 0) - elapsedMs);
    let hp = shape.hp;
    let shieldHp = shape.shieldHp;
    while (remainingMs > 0 && tickMs <= 0) {
        const damaged = applyDamageToShape({ ...shape, hp, shieldHp }, FIREBALL_BURN_DAMAGE * (shape.burnDamageMultiplier ?? 1));
        hp = damaged.hp;
        shieldHp = damaged.shieldHp;
        tickMs += FIREBALL_BURN_TICK_MS;
    }
    if (remainingMs <= 0) tickMs = 0;
    return {
        hp,
        shieldHp,
        burnRemainingMs: remainingMs,
        burnTickMs: tickMs,
        burnDamageMultiplier: remainingMs > 0 ? shape.burnDamageMultiplier ?? 1 : 1,
    };
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

function tickDashRecharge(shape, elapsedMs) {
    if (shape.combatClass !== "melee") return { dashCharges: 0, dashRechargeMs: 0, dashChargeRechargeMs: [] };
    let charges = Math.max(0, Math.min(DASH_MAX_CHARGES, Math.round(Number(shape.dashCharges ?? DASH_MAX_CHARGES))));
    const timers = Array.isArray(shape.dashChargeRechargeMs) ? shape.dashChargeRechargeMs : [];
    const nextTimers = [];
    for (const timer of timers) {
        const nextMs = Math.max(0, Number(timer) - elapsedMs);
        if (nextMs <= 0 && charges < DASH_MAX_CHARGES) charges += 1;
        else if (nextMs > 0) nextTimers.push(nextMs);
    }
    const dashRechargeMs = nextTimers.length ? Math.min(...nextTimers) : 0;
    return { dashCharges: charges, dashRechargeMs, dashChargeRechargeMs: nextTimers };
}

function consumeDashCharge(shape) {
    if (shape.combatClass !== "melee" || (shape.dashCharges ?? 0) <= 0) return shape;
    const rechargeMs = (shape.overdriveMs ?? 0) > 0 ? DASH_RECHARGE_MS * 0.5 : DASH_RECHARGE_MS;
    const nextTimers = [...(Array.isArray(shape.dashChargeRechargeMs) ? shape.dashChargeRechargeMs : []), rechargeMs];
    return {
        ...shape,
        dashCharges: Math.max(0, (shape.dashCharges ?? DASH_MAX_CHARGES) - 1),
        dashRechargeMs: Math.min(...nextTimers),
        dashChargeRechargeMs: nextTimers,
    };
}

function applyActionToShape(shape, action, elapsedMs) {
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    const mag = Math.hypot(action.dx ?? 0, action.dy ?? 0);
    const dx = mag > 0.001 ? action.dx / mag : 0;
    const dy = mag > 0.001 ? action.dy / mag : 0;
    const dashAvailable = combatClassConfig(shape.combatClass).actionIds.includes("dash")
        && (shape.dashCharges ?? 0) > 0;
    const overdriveActive = (shape.overdriveMs ?? 0) > 0;
    const cooldownMultiplier = overdriveActive ? 0.5 : 1;
    const attackCooldownMultiplier = overdriveActive ? 0.75 : 1;
    const speedMultiplier = (shape.slowedMs ?? 0) > 0 ? INHIBITION_SPEED_MULTIPLIER : 1;
    const maxMoveSpeed = combatClassMoveSpeed(shape.combatClass) * speedMultiplier;
    let next = { ...shape };
    const isContinuingDash = (shape.dashActiveMs ?? 0) > 0;
    next.rotation = normalizeAngle((shape.rotation ?? 0) + clamp(action.dRot ?? 0, -1, 1) * ROTATION_STEP_DEG);

    if ((shape.stunnedMs ?? 0) > 0) {
        const ticked = tickCombat({
            ...next,
            dashActiveMs: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
        }, elapsedMs);
        return {
            ...ticked,
            dashActiveMs: 0,
            movementVelocityX: 0,
            movementVelocityY: 0,
            velocityX: 0,
            velocityY: 0,
        };
    }

    if (isContinuingDash) {
        const dashX = shape.dashDirectionX ?? 0;
        const dashY = shape.dashDirectionY ?? 0;
        next = {
            ...next,
            x: clamp(shape.x + dashX * DASH_SPEED * speedMultiplier, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            y: clamp(shape.y + dashY * DASH_SPEED * speedMultiplier, shape.size / 2, CANVAS_SIZE - shape.size / 2),
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
            dashDirectionX: dashX,
            dashDirectionY: dashY,
            movementVelocityX: dashX * maxMoveSpeed,
            movementVelocityY: dashY * maxMoveSpeed,
            velocityX: dashX * DASH_SPEED * speedMultiplier / seconds,
            velocityY: dashY * DASH_SPEED * speedMultiplier / seconds,
        };
        next = consumeDashCharge(next);
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
        next.swingCooldownMs = SWING_COOLDOWN_MS * attackCooldownMultiplier;
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
        next.gunReloadMs = nextAmmo <= 0 ? RANGED_RELOAD_MS * cooldownMultiplier : 0;
        next.gunActiveMs = GUN_ACTIVE_MS;
        next.gunCooldownMs = GUN_COOLDOWN_MS * cooldownMultiplier;
    }

    const grenadeAvailable = !blockActive && next.combatClass === "ranged" && (next.grenadeCooldownMs ?? 0) <= 0;
    const threwGrenade = (action.grenade ?? 0) > 0.5 && grenadeAvailable;
    if (threwGrenade) {
        next.grenadeCooldownMs = GRENADE_COOLDOWN_MS * cooldownMultiplier;
        next.thrownGrenade = createGrenadeShape(next);
        next.grenadeSerial = (next.grenadeSerial ?? 1) + 1;
    }

    const fireballAvailable = !blockActive && next.combatClass === "mage"
        && (next.fireballCharges ?? FIREBALL_CHARGES_MAX) > 0
        && (next.fireballReloadMs ?? 0) <= 0
        && (next.fireballCooldownMs ?? 0) <= 0
        && (next.fireballActiveMs ?? 0) <= 0;
    const shotFireball = (action.fireball ?? 0) > 0.5 && fireballAvailable;
    if (shotFireball) {
        const nextCharges = Math.max(0, (next.fireballCharges ?? FIREBALL_CHARGES_MAX) - 1);
        next.fireballCharges = nextCharges;
        next.fireballReloadMs = nextCharges <= 0 ? FIREBALL_RELOAD_MS * cooldownMultiplier : 0;
        next.fireballActiveMs = FIREBALL_ACTIVE_MS;
        next.fireballCooldownMs = FIREBALL_COOLDOWN_MS * cooldownMultiplier;
        next.thrownFireball = createFireballShape(next);
        next.fireballSerial = (next.fireballSerial ?? 1) + 1;
    }

    const stunAvailable = !blockActive && next.combatClass === "mage"
        && (next.stunCooldownMs ?? 0) <= 0
        && (next.stunActiveMs ?? 0) <= 0;
    const castStun = (action.stun ?? 0) > 0.5 && stunAvailable;
    if (castStun) {
        next.stunActiveMs = STUN_ACTIVE_MS;
        next.stunCooldownMs = STUN_COOLDOWN_MS * cooldownMultiplier;
        next.stunCastActive = true;
    }

    const ticked = tickCombat(next, elapsedMs);
    return {
        ...ticked,
        blockActiveMs: blockActive ? 1 : ticked.blockActiveMs,
        gunShotActive: firedGun,
        stunCastActive: castStun,
        stunActiveMs: castStun ? STUN_ACTIVE_MS : ticked.stunActiveMs,
        thrownGrenade: next.thrownGrenade ?? null,
        thrownFireball: next.thrownFireball ?? null,
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

function resolveCombatDamage(first, second, obstacles = []) {
    let nextObstacles = obstacles.map((obstacle) => ({ ...obstacle }));
    let nextFirst = {
        ...first,
        gunBounceRay: first.gunShotActive ? null : first.gunBounceRay,
        gunRayLength: first.gunShotActive
            ? gunRangeBeforeProjectileWall(first, obstacles)
            : first.gunRayLength ?? GUN_RANGE,
    };
    let nextSecond = {
        ...second,
        gunBounceRay: second.gunShotActive ? null : second.gunBounceRay,
        gunRayLength: second.gunShotActive
            ? gunRangeBeforeProjectileWall(second, obstacles)
            : second.gunRayLength ?? GUN_RANGE,
    };
    [nextFirst, nextSecond, nextObstacles] = applyBouncedGunShots(
        nextFirst,
        nextSecond,
        nextObstacles,
    );

    if (isSwingHitting(first, second)) {
        if (isBlockingHit(second, first)) {
            nextSecond = consumeBlockCharges(nextSecond, 1);
        } else {
            nextSecond = applyDamageToShape(nextSecond, incomingMeleeDamage(nextSecond));
            [nextFirst, nextSecond] = applyInhibitionHit(nextFirst, nextSecond);
        }
    }

    if (isSwingHitting(second, first)) {
        if (isBlockingHit(first, second)) {
            nextFirst = consumeBlockCharges(nextFirst, 1);
        } else {
            nextFirst = applyDamageToShape(nextFirst, incomingMeleeDamage(nextFirst));
            [nextSecond, nextFirst] = applyInhibitionHit(nextSecond, nextFirst);
        }
    }

    if (isGunHitting(first, second) && !isGunBlockedByWall(first, second, obstacles)) {
        if (isBlockingHit(second, first)) {
            nextSecond = consumeBlockCharges(nextSecond, 1);
        } else {
            nextSecond = applyDamageToShape(nextSecond, incomingGunDamage(first, second));
            [nextFirst, nextSecond] = applyInhibitionHit(nextFirst, nextSecond);
        }
    }

    if (isGunHitting(second, first) && !isGunBlockedByWall(second, first, obstacles)) {
        if (isBlockingHit(first, second)) {
            nextFirst = consumeBlockCharges(nextFirst, 1);
        } else {
            nextFirst = applyDamageToShape(nextFirst, incomingGunDamage(second, first));
            [nextSecond, nextFirst] = applyInhibitionHit(nextSecond, nextFirst);
        }
    }

    [nextFirst, nextObstacles] = applyKillableBuffDamage(nextFirst, nextObstacles);
    [nextSecond, nextObstacles] = applyKillableBuffDamage(nextSecond, nextObstacles);

    return [nextFirst, nextSecond, nextObstacles];
}

function applyKillableBuffDamage(attacker, obstacles) {
    if (!attacker?.swingActiveMs && !attacker?.gunShotActive && !attacker?.fireballActiveMs) return [attacker, obstacles];
    let nextAttacker = attacker;
    let consumedHit = false;
    const nextObstacles = [];
    for (const obstacle of obstacles) {
        if (!isBuffPickupType(obstacle.type) || consumedHit) {
            nextObstacles.push(obstacle);
            continue;
        }
        let damage = 0;
        if ((attacker.swingActiveMs ?? 0) > 0 && isSwingHitting(attacker, obstacle)) {
            damage = MELEE_DAMAGE;
        } else if (attacker.gunShotActive && isGunHitting(attacker, obstacle) && !isGunBlockedByWall(attacker, obstacle, obstacles)) {
            damage = incomingGunDamage(attacker, obstacle);
        } else if ((attacker.fireballActiveMs ?? 0) > 0 && isGunHitting(attacker, obstacle)) {
            damage = FIREBALL_DAMAGE;
        }
        if (damage <= 0) {
            nextObstacles.push(obstacle);
            continue;
        }
        consumedHit = true;
        const hp = Math.max(0, Number(obstacle.hp ?? KILLABLE_BUFF_HP) - damage);
        if (hp <= 0) {
            nextAttacker = applyBuffPickup(nextAttacker, obstacle.type);
        } else {
            nextObstacles.push({ ...obstacle, hp });
        }
    }
    return [nextAttacker, nextObstacles];
}

function applyDamageToShape(shape, damage) {
    let remaining = Math.max(0, Number(damage) || 0);
    let shieldHp = Math.max(0, Number(shape.shieldHp ?? 0));
    if (shieldHp > 0 && remaining > 0) {
        const absorbed = Math.min(shieldHp, remaining);
        shieldHp -= absorbed;
        remaining -= absorbed;
    }
    return {
        ...shape,
        shieldHp,
        hp: remaining > 0 ? Math.max(0, (shape.hp ?? combatClassHp(shape.combatClass)) - remaining) : shape.hp,
    };
}

function applyInhibitionHit(attacker, defender) {
    if ((attacker.inhibitionCharges ?? 0) <= 0) return [attacker, defender];
    return [
        { ...attacker, inhibitionCharges: Math.max(0, (attacker.inhibitionCharges ?? 0) - 1) },
        { ...defender, slowedMs: INHIBITION_SLOW_MS },
    ];
}

function applyBouncedGunShots(first, second, obstacles) {
    const fighters = [first, second];
    let nextFighters = fighters;
    let nextObstacles = obstacles;
    fighters.forEach((initialAttacker) => {
        const attacker = nextFighters.find((fighter) => fighter.id === initialAttacker.id) ?? initialAttacker;
        if (!attacker.gunShotActive) return;
        const reflection = traceBouncyGunShot(attacker, nextFighters, nextObstacles);
        if (!reflection) return;
        nextObstacles = nextObstacles
            .map((obstacle) => obstacle.id === reflection.wall.id
                ? { ...obstacle, usesRemaining: (obstacle.usesRemaining ?? BOUNCY_WALL_MAX_USES) - 1 }
                : obstacle)
            .filter((obstacle) => obstacle.type !== BOUNCY_WALL_TYPE || obstacle.usesRemaining > 0);
        if (reflection.hitFighter) {
            const defender = nextFighters.find((fighter) => fighter.id === reflection.hitFighter.id);
            if (defender) {
                const damaged = applyDamageToShape(defender, Math.round(incomingGunDamage(attacker, defender) * 1.5));
                const [nextAttacker, nextDefender] = applyInhibitionHit(attacker, damaged);
                nextFighters = nextFighters.map((fighter) => {
                    if (fighter.id === nextAttacker.id) return nextAttacker;
                    if (fighter.id === nextDefender.id) return nextDefender;
                    return fighter;
                });
            }
        }
        const bounceAngle = Math.atan2(reflection.outY, reflection.outX) * 180 / Math.PI
            - (attacker.rotation ?? 0);
        nextFighters = nextFighters.map((fighter) => fighter.id === attacker.id ? {
            ...fighter,
            gunRayLength: reflection.distance,
            gunBounceRay: {
                distance: reflection.distance,
                angle: bounceAngle,
                length: reflection.outgoingLength,
            },
        } : fighter);
    });
    return [nextFighters[0], nextFighters[1], nextObstacles];
}

function traceBouncyGunShot(attacker, fighters, obstacles) {
    const radians = (attacker.rotation ?? 0) * Math.PI / 180;
    const directionX = Math.cos(radians);
    const directionY = Math.sin(radians);
    const wallHit = obstacles
        .filter((wall) => wall.type === BOUNCY_WALL_TYPE)
        .map((wall) => {
            const [start, end] = wallEndpoints(wall);
            return {
                wall,
                distance: raySegmentIntersectionDistance(
                    attacker.x, attacker.y, directionX, directionY,
                    start.x, start.y, end.x, end.y,
                ),
            };
        })
        .filter((candidate) => candidate.distance != null)
        .sort((a, b) => a.distance - b.distance)[0];
    if (!wallHit) return null;

    const wallRadians = snapWallRotation(wallHit.wall.rotation) * Math.PI / 180;
    let normalX = -Math.sin(wallRadians);
    let normalY = Math.cos(wallRadians);
    if (directionX * normalX + directionY * normalY > 0) {
        normalX *= -1;
        normalY *= -1;
    }
    const hitX = attacker.x + directionX * wallHit.distance;
    const hitY = attacker.y + directionY * wallHit.distance;
    const maxOutgoing = Math.max(0, GUN_RANGE - wallHit.distance);
    const hitFighter = fighters
        .map((fighter) => ({
            fighter,
            distance: rayCircleEntryDistance(
                hitX + normalX * (PROJECTILE_WALL_THICKNESS / 2 + 0.1),
                hitY + normalY * (PROJECTILE_WALL_THICKNESS / 2 + 0.1),
                normalX,
                normalY,
                fighter.x,
                fighter.y,
                (fighter.size ?? 60) / 2,
            ),
        }))
        .filter((candidate) => candidate.distance != null && candidate.distance <= maxOutgoing)
        .sort((a, b) => a.distance - b.distance)[0];
    return {
        wall: wallHit.wall,
        distance: wallHit.distance,
        outX: normalX,
        outY: normalY,
        outgoingLength: hitFighter?.distance ?? maxOutgoing,
        hitFighter: hitFighter?.fighter ?? null,
    };
}

function rayCircleEntryDistance(originX, originY, directionX, directionY, centerX, centerY, radius) {
    const offsetX = centerX - originX;
    const offsetY = centerY - originY;
    const projection = offsetX * directionX + offsetY * directionY;
    const perpendicularSquared = offsetX * offsetX + offsetY * offsetY - projection * projection;
    const radiusSquared = radius * radius;
    if (perpendicularSquared > radiusSquared) return null;
    const entry = projection - Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared));
    return entry >= 0 ? entry : null;
}

function gunRangeBeforeProjectileWall(attacker, obstacles) {
    const radians = (attacker.rotation ?? 0) * Math.PI / 180;
    const directionX = Math.cos(radians);
    const directionY = Math.sin(radians);
    return obstacles
        .filter((wall) => wall.type === PROJECTILE_WALL_TYPE)
        .reduce((nearest, wall) => {
            const [start, end] = wallEndpoints(wall);
            const distance = raySegmentIntersectionDistance(
                attacker.x,
                attacker.y,
                directionX,
                directionY,
                start.x,
                start.y,
                end.x,
                end.y,
            );
            return distance == null ? nearest : Math.min(nearest, distance);
        }, GUN_RANGE);
}

function raySegmentIntersectionDistance(originX, originY, directionX, directionY, ax, ay, bx, by) {
    const segmentX = bx - ax;
    const segmentY = by - ay;
    const denominator = cross(0, 0, directionX, directionY, segmentX, segmentY);
    if (Math.abs(denominator) <= 0.000001) return null;
    const offsetX = ax - originX;
    const offsetY = ay - originY;
    const distance = (offsetX * segmentY - offsetY * segmentX) / denominator;
    const segmentT = (offsetX * directionY - offsetY * directionX) / denominator;
    return distance >= 0 && distance <= GUN_RANGE && segmentT >= 0 && segmentT <= 1
        ? distance
        : null;
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

function isGunBlockedByWall(attacker, defender, obstacles) {
    if (!attacker.gunShotActive) return false;
    return obstacles.some((wall) => (
        (wall.type === PROJECTILE_WALL_TYPE || wall.type === BOUNCY_WALL_TYPE)
        && (() => {
            const [start, end] = wallEndpoints(wall);
            return segmentDistance(
            attacker.x,
            attacker.y,
            defender.x,
            defender.y,
            start.x,
            start.y,
            end.x,
            end.y,
        ) <= PROJECTILE_WALL_THICKNESS / 2;
        })()
    ));
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

function createFireballShape(shape) {
    const angle = (shape.rotation ?? 0) * Math.PI / 180;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const spawnDistance = (shape.size ?? 60) / 2 + FIREBALL_SIZE / 2 + 2;
    return {
        id: `fireball-${shape.id}-${shape.fireballSerial ?? 1}`,
        type: "fireball",
        ownerId: shape.id,
        x: shape.x + directionX * spawnDistance,
        y: shape.y + directionY * spawnDistance,
        size: FIREBALL_SIZE,
        rotation: shape.rotation ?? 0,
        velocityX: directionX * FIREBALL_SPEED,
        velocityY: directionY * FIREBALL_SPEED,
        traveled: 0,
        locked: true,
    };
}

function updateGrenades(grenades, fighters, obstacles = []) {
    const remaining = [];
    const explosions = [];
    let nextObstacles = obstacles;
    for (const grenade of grenades) {
        if (grenade.type === "grenadeExplosion") {
            const remainingMs = Math.max(0, (grenade.remainingMs ?? 0) - AUTO_STEP_MS);
            if (remainingMs > 0) remaining.push({ ...grenade, remainingMs });
            continue;
        }
        let next = advanceGrenade(grenade);
        if (projectileTouchesWall(grenade, next, nextObstacles)) continue;
        const reflection = reflectMovingProjectile(grenade, next, nextObstacles);
        if (reflection) {
            next = reflection.projectile;
            nextObstacles = reflection.obstacles;
        }
        const touchedOpponent = fighters.some((fighter) => (
            (fighter.id !== next.ownerId || next.reflected) && overlapsShape(fighter, next)
        ));
        const stoppedLongEnough = Math.hypot(next.velocityX ?? 0, next.velocityY ?? 0) <= 0.001
            && (next.stoppedMs ?? 0) >= GRENADE_STOP_FUSE_MS;
        if (touchedOpponent || stoppedLongEnough) {
            explosions.push(createGrenadeExplosionShape(next));
        } else {
            remaining.push(next);
        }
    }
    return { grenades: remaining, explosions, obstacles: nextObstacles };
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
        damageMultiplier: grenade.damageMultiplier ?? 1,
        locked: true,
    };
}

function applyGrenadeExplosionDamage(fighters, explosions) {
    let nextFighters = fighters;
    for (const explosion of explosions) {
        nextFighters = nextFighters.map((fighter) => {
            const damage = grenadeDamageToFighter(explosion, fighter);
            const shieldCharges = grenadeShieldChargesToFighter(explosion, fighter);
            if (damage <= 0 && shieldCharges <= 0) return fighter;
            if ((fighter.blockActiveMs ?? 0) > 0 && (fighter.blockCharges ?? 0) > 0 && shieldCharges > 0) {
                return consumeBlockCharges(fighter, shieldCharges);
            }
            return damage > 0 ? applyDamageToShape(fighter, damage) : fighter;
        });
        const attacker = nextFighters.find((fighter) => fighter.id === explosion.ownerId);
        if (!attacker || (attacker.inhibitionCharges ?? 0) <= 0) continue;
        const hitDefender = nextFighters.find((fighter) => (
            fighter.id !== attacker.id
            && grenadeDamageToFighter(explosion, fighter) > 0
            && (fighter.barrierImmunityMs ?? 0) <= 0
        ));
        if (!hitDefender) continue;
        const [nextAttacker, nextDefender] = applyInhibitionHit(attacker, hitDefender);
        nextFighters = nextFighters.map((fighter) => {
            if (fighter.id === nextAttacker.id) return nextAttacker;
            if (fighter.id === nextDefender.id) return nextDefender;
            return fighter;
        });
    }
    return nextFighters;
}

function applyFireballHits(fighters, hits) {
    let nextFighters = fighters;
    for (const hit of hits) {
        const defender = nextFighters.find((fighter) => fighter.id === hit.fighterId);
        if (!defender) continue;
        const damageMultiplier = hit.fireball.damageMultiplier ?? 1;
        const damaged = applyDamageToShape(defender, FIREBALL_DAMAGE * damageMultiplier);
        let nextDefender = {
            ...damaged,
            burnRemainingMs: FIREBALL_BURN_DURATION_MS,
            burnTickMs: FIREBALL_BURN_TICK_MS,
            burnDamageMultiplier: damageMultiplier,
        };
        const attacker = nextFighters.find((fighter) => fighter.id === hit.fireball.ownerId);
        let nextAttacker = attacker;
        if (attacker && attacker.id !== defender.id && (defender.barrierImmunityMs ?? 0) <= 0) {
            [nextAttacker, nextDefender] = applyInhibitionHit(attacker, nextDefender);
        }
        nextFighters = nextFighters.map((fighter) => {
            if (nextAttacker && fighter.id === nextAttacker.id) return nextAttacker;
            if (fighter.id === nextDefender.id) return nextDefender;
            return fighter;
        });
    }
    return nextFighters;
}

function applyStunHits(fighters) {
    let nextFighters = fighters;
    for (const defender of fighters) {
        const attacker = nextFighters.find((candidate) => (
            candidate.id !== defender.id
            && stunHits(candidate, defender)
            && !isBlockingHit(defender, candidate)
        ));
        if (!attacker) continue;
        const currentDefender = nextFighters.find((fighter) => fighter.id === defender.id) ?? defender;
        let nextDefender = applyDamageToShape(currentDefender, STUN_DAMAGE);
        let nextAttacker = attacker;
        if ((currentDefender.barrierImmunityMs ?? 0) <= 0) {
            [nextAttacker, nextDefender] = applyInhibitionHit(attacker, nextDefender);
            nextDefender = {
                ...nextDefender,
                stunnedMs: Math.max(currentDefender.stunnedMs ?? 0, STUN_DURATION_MS),
                dashActiveMs: 0,
                movementVelocityX: 0,
                movementVelocityY: 0,
                velocityX: 0,
                velocityY: 0,
            };
        }
        nextFighters = nextFighters.map((fighter) => {
            if (fighter.id === nextAttacker.id) return nextAttacker;
            if (fighter.id === nextDefender.id) return nextDefender;
            return fighter;
        });
    }
    return nextFighters.map((fighter) => {
        const blockedStuns = nextFighters.filter((attacker) => (
            attacker.id !== fighter.id
            && stunHits(attacker, fighter)
            && isBlockingHit(fighter, attacker)
        )).length;
        return blockedStuns > 0 ? consumeBlockCharges(fighter, blockedStuns) : fighter;
    });
}

function updateFireballs(fireballs, fighters, obstacles = []) {
    const remaining = [];
    const hits = [];
    let nextObstacles = obstacles;
    for (const fireball of fireballs) {
        let next = advanceFireball(fireball);
        if (projectileTouchesWall(fireball, next, nextObstacles)) continue;
        const reflection = reflectMovingProjectile(fireball, next, nextObstacles);
        if (reflection) {
            next = reflection.projectile;
            nextObstacles = reflection.obstacles;
        }
        const hitFighter = fighters.find((fighter) => (
            (fighter.id !== next.ownerId || next.reflected) && overlapsShape(fighter, next)
        ));
        if (hitFighter) {
            hits.push({ fireball: next, fighterId: hitFighter.id });
        } else if ((next.traveled ?? 0) < FIREBALL_RANGE && isInsideArena(next)) {
            remaining.push(next);
        }
    }
    return { fireballs: remaining, hits, obstacles: nextObstacles };
}

function reflectMovingProjectile(previous, next, obstacles) {
    const velocityX = next.velocityX ?? 0;
    const velocityY = next.velocityY ?? 0;
    const speed = Math.hypot(velocityX, velocityY);
    if (speed <= 0.000001) return null;
    const directionX = velocityX / speed;
    const directionY = velocityY / speed;
    const hit = obstacles
        .filter((wall) => wall.type === BOUNCY_WALL_TYPE)
        .map((wall) => {
            const [start, end] = wallEndpoints(wall);
            return {
                wall,
                distance: raySegmentIntersectionDistance(
                    previous.x, previous.y, directionX, directionY,
                    start.x, start.y, end.x, end.y,
                ),
            };
        })
        .filter((candidate) => candidate.distance != null && candidate.distance <= speed)
        .sort((a, b) => a.distance - b.distance)[0];
    if (!hit) return null;

    const wallRadians = snapWallRotation(hit.wall.rotation) * Math.PI / 180;
    let normalX = -Math.sin(wallRadians);
    let normalY = Math.cos(wallRadians);
    if (directionX * normalX + directionY * normalY > 0) {
        normalX *= -1;
        normalY *= -1;
    }
    const reflectedSpeed = speed * 1.25;
    const clearance = (next.size ?? 0) / 2 + PROJECTILE_WALL_THICKNESS / 2 + 0.1;
    const hitX = previous.x + directionX * hit.distance;
    const hitY = previous.y + directionY * hit.distance;
    const reflectedProjectile = {
        ...next,
        x: hitX + normalX * clearance,
        y: hitY + normalY * clearance,
        velocityX: normalX * reflectedSpeed,
        velocityY: normalY * reflectedSpeed,
        reflected: true,
        damageMultiplier: (next.damageMultiplier ?? 1) * 1.5,
    };
    const nextObstacles = obstacles
        .map((obstacle) => obstacle.id === hit.wall.id
            ? { ...obstacle, usesRemaining: (obstacle.usesRemaining ?? BOUNCY_WALL_MAX_USES) - 1 }
            : obstacle)
        .filter((obstacle) => obstacle.type !== BOUNCY_WALL_TYPE || obstacle.usesRemaining > 0);
    return { projectile: reflectedProjectile, obstacles: nextObstacles };
}

function projectileTouchesWall(previous, next, obstacles) {
    const projectileRadius = (next.size ?? 0) / 2;
    return obstacles.some((wall) => (
        wall.type === PROJECTILE_WALL_TYPE
        && (() => {
            const [start, end] = wallEndpoints(wall);
            return segmentDistance(
            previous.x,
            previous.y,
            next.x,
            next.y,
            start.x,
            start.y,
            end.x,
            end.y,
        ) <= projectileRadius + PROJECTILE_WALL_THICKNESS / 2;
        })()
    ));
}

function wallEndpoints(wall) {
    const radians = snapWallRotation(wall.rotation) * Math.PI / 180;
    const halfLength = (wall.size ?? PROJECTILE_WALL_LENGTH) / 2;
    const offsetX = Math.cos(radians) * halfLength;
    const offsetY = Math.sin(radians) * halfLength;
    return [
        { x: wall.x - offsetX, y: wall.y - offsetY },
        { x: wall.x + offsetX, y: wall.y + offsetY },
    ];
}

function segmentDistance(ax, ay, bx, by, cx, cy, dx, dy) {
    if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
        pointToSegmentDistance(ax, ay, cx, cy, dx, dy),
        pointToSegmentDistance(bx, by, cx, cy, dx, dy),
        pointToSegmentDistance(cx, cy, ax, ay, bx, by),
        pointToSegmentDistance(dx, dy, ax, ay, bx, by),
    );
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0.000001) return Math.hypot(px - ax, py - ay);
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const abC = cross(ax, ay, bx, by, cx, cy);
    const abD = cross(ax, ay, bx, by, dx, dy);
    const cdA = cross(cx, cy, dx, dy, ax, ay);
    const cdB = cross(cx, cy, dx, dy, bx, by);
    if (Math.abs(abC) <= 0.000001 && pointOnSegment(cx, cy, ax, ay, bx, by)) return true;
    if (Math.abs(abD) <= 0.000001 && pointOnSegment(dx, dy, ax, ay, bx, by)) return true;
    if (Math.abs(cdA) <= 0.000001 && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true;
    if (Math.abs(cdB) <= 0.000001 && pointOnSegment(bx, by, cx, cy, dx, dy)) return true;
    return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function cross(ax, ay, bx, by, px, py) {
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

function pointOnSegment(px, py, ax, ay, bx, by) {
    return px >= Math.min(ax, bx) - 0.000001
        && px <= Math.max(ax, bx) + 0.000001
        && py >= Math.min(ay, by) - 0.000001
        && py <= Math.max(ay, by) + 0.000001;
}

function advanceFireball(fireball) {
    const velocityX = fireball.velocityX ?? 0;
    const velocityY = fireball.velocityY ?? 0;
    return {
        ...fireball,
        x: fireball.x + velocityX,
        y: fireball.y + velocityY,
        traveled: (fireball.traveled ?? 0) + Math.hypot(velocityX, velocityY),
    };
}

function isInsideArena(shape) {
    return shape.x >= -shape.size && shape.x <= CANVAS_SIZE + shape.size
        && shape.y >= -shape.size && shape.y <= CANVAS_SIZE + shape.size;
}

function stunHits(attacker, defender) {
    if (!attacker?.stunCastActive || attacker.combatClass !== "mage") return false;
    const dx = defender.x - attacker.x;
    const dy = defender.y - attacker.y;
    const distance = Math.hypot(dx, dy);
    if (distance > STUN_RANGE + (defender.size ?? 60) / 2) return false;
    const bearing = Math.atan2(dy, dx) * 180 / Math.PI;
    return Math.abs(angleDelta(attacker.rotation ?? 0, bearing)) <= 50;
}

function grenadeDamageToFighter(explosion, fighter) {
    const nearestBodyDistance = Math.max(0, Math.hypot(fighter.x - explosion.x, fighter.y - explosion.y) - (fighter.size ?? 60) / 2);
    if (nearestBodyDistance > GRENADE_EXPLOSION_RADIUS) return 0;
    const rawDamage = interpolateDamage(nearestBodyDistance, 0, GRENADE_EXPLOSION_RADIUS, 50, 25);
    return clamp(Math.round(rawDamage / 5) * 5, 25, 50) * (explosion.damageMultiplier ?? 1);
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

function fighterCaptureSlot(fighter) {
    if (Number(fighter?.slot) === 2) return "2";
    if (Number(fighter?.slot) === 1) return "1";
    return fighter?.id === "opponent-model" ? "2" : "1";
}

function isBuffPickupType(type) {
    return type === OVERDRIVE_TYPE || type === BARRIER_TYPE || type === INHIBITION_TYPE;
}

function isCenterObjectiveType(type) {
    return type === RADAR_JAMMER_TYPE || type === COMMAND_LOCK_TYPE;
}

function updateCenterObjectiveCapture(obstacle, fighters) {
    const previous = obstacle.captureBySlot ?? {};
    const captureBySlot = {};
    for (const fighter of fighters) {
        if (!fighter) continue;
        const slot = fighterCaptureSlot(fighter);
        captureBySlot[slot] = overlapsObstacle(fighter, obstacle)
            ? Math.min(CENTER_OBJECTIVE_CAPTURE_MS, Number(previous[slot] ?? 0) + AUTO_STEP_MS)
            : 0;
    }
    return { ...obstacle, captureBySlot };
}

function centerObjectiveCollectorIndex(obstacle, fighters) {
    const captureBySlot = obstacle.captureBySlot ?? {};
    if (Number(captureBySlot["1"] ?? 0) < CENTER_OBJECTIVE_CAPTURE_MS && Number(captureBySlot["2"] ?? 0) < CENTER_OBJECTIVE_CAPTURE_MS) {
        return -1;
    }
    const winningSlot = Number(captureBySlot["1"] ?? 0) >= Number(captureBySlot["2"] ?? 0) ? "1" : "2";
    return fighters.findIndex((fighter) => fighterCaptureSlot(fighter) === winningSlot);
}

function applyBuffPickup(fighter, type) {
    if (type === OVERDRIVE_TYPE) {
        return { ...fighter, overdriveMs: BUFF_DURATION_MS };
    }
    if (type === BARRIER_TYPE) {
        return {
            ...fighter,
            shieldHp: Math.max(0, Number(fighter.shieldHp ?? 0)) + BARRIER_SHIELD_HP,
            barrierImmunityMs: BUFF_DURATION_MS,
        };
    }
    if (type === INHIBITION_TYPE) {
        return { ...fighter, inhibitionCharges: INHIBITION_ATTACK_CHARGES };
    }
    return fighter;
}

function resolveObstacleEffects(fighters, obstacles) {
    let nextFighters = fighters.map((fighter) => ({ ...fighter }));
    const remainingObstacles = [];

    for (const obstacle of obstacles) {
        if (obstacle.type !== "healthPack" && !isCenterObjectiveType(obstacle.type)) {
            remainingObstacles.push(obstacle);
            continue;
        }
        if (isCenterObjectiveType(obstacle.type)) {
            const capturedObstacle = updateCenterObjectiveCapture(obstacle, nextFighters);
            const collectorIndex = centerObjectiveCollectorIndex(capturedObstacle, nextFighters);
            if (collectorIndex === -1) {
                remainingObstacles.push(capturedObstacle);
                continue;
            }
            const targetIndex = nextFighters.findIndex((fighter, index) => index !== collectorIndex);
            if (targetIndex >= 0) {
                nextFighters[targetIndex] = applyCenterObjectiveEffect(
                    nextFighters[targetIndex],
                    capturedObstacle.type,
                    nextFighters[targetIndex].lastPredictedAction,
                );
            }
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
        const damaged = entered ? applyDamageToShape(fighter, DAMAGE_ZONE_ENTRY_DAMAGE) : fighter;
        return {
            ...damaged,
            damageZoneIds: currentZoneIds,
            inDamageZone: currentZoneIds.length > 0,
        };
    });

    return { fighters: nextFighters, obstacles: remainingObstacles };
}

function applyCenterObjectiveEffect(target, type, predictedAction) {
    if (type === RADAR_JAMMER_TYPE) {
        return { ...target, jammedMs: CENTER_EFFECT_DURATION_MS };
    }
    if (type === COMMAND_LOCK_TYPE) {
        return {
            ...target,
            commandLockedMs: CENTER_EFFECT_DURATION_MS,
            commandLockAction: predictedAction ?? target.commandLockAction ?? null,
        };
    }
    return target;
}

function buildDeterministicLogicAction(configuration, stateSnapshot) {
    const plan = selectMeleeStrategyActionPlan(configuration, stateSnapshot);
    const movementBlock = plan.movement ?? plan.dashMovement ?? null;
    const facingBlock = plan.rotation ?? plan.swing ?? plan.block ?? plan.grenade ?? plan.fireball ?? plan.stun;
    const movementTarget = resolveActionTarget(stateSnapshot, movementBlock?.actionTarget);
    const facingTarget = resolveActionTarget(stateSnapshot, facingBlock?.actionTarget ?? movementBlock?.actionTarget);
    const movement = movementVectorForAction(movementBlock?.action ?? "move_stop", stateSnapshot.playerModel, movementTarget);
    const turnAction = facingBlock?.action ?? "move_stop";
    const shouldTurn = turnAction === "rotate_toward_enemy" || turnAction === "swing" || turnAction === "block" || turnAction === "throw_grenade" || turnAction === "shoot_fireball" || turnAction === "stun";
    return {
        dx: movement.dx,
        dy: movement.dy,
        dRot: shouldTurn ? turnTowardTarget(stateSnapshot.playerModel, facingTarget) : 0,
        swing: plan.swing?.action === "swing" ? 1 : 0,
        block: plan.block?.action === "block" ? 1 : 0,
        gun: plan.gun?.action === "fire_gun" ? 1 : 0,
        grenade: plan.grenade?.action === "throw_grenade" ? 1 : 0,
        fireball: plan.fireball?.action === "shoot_fireball" ? 1 : 0,
        stun: plan.stun?.action === "stun" ? 1 : 0,
        dash: plan.dash?.action?.startsWith("dash") ? 1 : 0,
    };
}

function commandLockedAction(fighter, predicted) {
    if (!fighter || (fighter.commandLockedMs ?? 0) <= 0 || !fighter.commandLockAction) return predicted;
    const locked = fighter.commandLockAction;
    const dashNow = (predicted.dash ?? 0) > 0.5;
    return {
        dx: dashNow ? predicted.dx : locked.dx,
        dy: dashNow ? predicted.dy : locked.dy,
        dRot: locked.dRot,
        swing: locked.swing,
        block: predicted.block,
        gun: locked.gun,
        grenade: predicted.grenade,
        fireball: locked.fireball,
        stun: predicted.stun,
        dash: predicted.dash,
    };
}

function resolveActionTarget(stateSnapshot, actionTarget = "opponent") {
    const objects = Array.isArray(stateSnapshot?.objects) ? stateSnapshot.objects : [];
    const opponent = objects.find((object) => object.type === "opponentModel") ?? null;
    return resolveMeleeStrategyTarget({
        player: stateSnapshot?.playerModel,
        opponent,
        objects,
        obstacles: objects,
    }, actionTarget ?? "opponent");
}

function movementVectorForAction(action, player, target) {
    if (!player || action === "move_stop" || action === "rotate_toward_enemy" || action === "swing" || action === "block" || action === "fire_gun" || action === "throw_grenade" || action === "shoot_fireball" || action === "stun") {
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
        fireball: 0,
        stun: 0,
        dash: 0,
    };
}

export default function BetaModel({
    matchContext = null,
    finishStatus = null,
    onFinishMatch = null,
    onSurrenderMatch = null
}) {
    const navigate = useNavigate();
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
    const [isEditingArena, setIsEditingArena] = useState(() => !isMatchTraining);
    const [trainingConfiguration, setTrainingConfiguration] = useState(() => (
        sanitizeStrategyConfigurationForClass(
            matchContext?.roundBrains?.at(-1)?.brain
                ?? loadStoredStrategyConfiguration(strategyStorageKey),
            selectedClass,
        )
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
    const [targetObstacleObjects, setTargetObstacleObjects] = useState(() => targetObstacleShapes(buildInitialArenaShapes(matchContext)));
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

    useEffect(() => {
        if (!isMatchTraining) return;
        const matchObstacles = matchObstacleShapes(matchContext?.obstacles, true);
        setTargetObstacleObjects(targetObstacleShapes(matchObstacles));
        setShapes((prev) => [
            ...prev.filter((shape) => !isObstacleType(shape.type)),
            ...matchObstacles,
        ]);
    }, [isMatchTraining, matchContext?.obstacles]);

    useEffect(() => {
        if (isMatchTraining || isAutoPlaying || isStrategyTraining) return;
        const catalogSource = hasArenaCheckpoint && arenaCheckpointShapesRef.current
            ? arenaCheckpointShapesRef.current
            : shapes;
        setTargetObstacleObjects(targetObstacleShapes(catalogSource));
    }, [hasArenaCheckpoint, isAutoPlaying, isMatchTraining, isStrategyTraining, shapes]);

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
                ? resetFighterShape({ ...shape, combatClass })
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
                ? resetFighterShape({ ...shape, combatClass })
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
                fireballCooldownMs: 0,
                fireballActiveMs: 0,
                fireballCharges: type === "opponentModel" && opponentSelectedClass === "mage" ? FIREBALL_CHARGES_MAX : 0,
                fireballReloadMs: 0,
                fireballSerial: 1,
                thrownFireball: null,
                stunCooldownMs: 0,
                stunActiveMs: 0,
                stunnedMs: 0,
                stunCastActive: false,
                dashCharges: type === "opponentModel" && opponentSelectedClass === "melee" ? DASH_MAX_CHARGES : 0,
                dashRechargeMs: 0,
                dashChargeRechargeMs: [],
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
                if ((s.type === PROJECTILE_WALL_TYPE || s.type === BOUNCY_WALL_TYPE)
                    && updates.rotation !== undefined) {
                    return { ...s, ...updates, rotation: snapWallRotation(updates.rotation) };
                }
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
                        fireballCooldownMs,
                        fireballActiveMs,
                        fireballCharges,
                        fireballReloadMs,
                        fireballSerial,
                        thrownFireball,
                        burnRemainingMs,
                        burnTickMs,
                        stunCooldownMs,
                        stunActiveMs,
                        stunnedMs,
                        stunCastActive,
                        dashCharges,
                        dashRechargeMs,
                        dashChargeRechargeMs,
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
                        || fireballCooldownMs !== undefined || fireballActiveMs !== undefined
                        || fireballCharges !== undefined || fireballReloadMs !== undefined
                        || fireballSerial !== undefined || thrownFireball !== undefined
                        || burnRemainingMs !== undefined || burnTickMs !== undefined
                        || stunCooldownMs !== undefined || stunActiveMs !== undefined
                        || stunnedMs !== undefined || stunCastActive !== undefined
                        || dashCharges !== undefined || dashRechargeMs !== undefined
                        || dashChargeRechargeMs !== undefined || dashActiveMs !== undefined
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
                            fireballCooldownMs: fireballCooldownMs ?? s.fireballCooldownMs,
                            fireballActiveMs: fireballActiveMs ?? s.fireballActiveMs,
                            fireballCharges: fireballCharges ?? s.fireballCharges,
                            fireballReloadMs: fireballReloadMs ?? s.fireballReloadMs,
                            fireballSerial: fireballSerial ?? s.fireballSerial,
                            thrownFireball: thrownFireball ?? s.thrownFireball,
                            burnRemainingMs: burnRemainingMs ?? s.burnRemainingMs,
                            burnTickMs: burnTickMs ?? s.burnTickMs,
                            stunCooldownMs: stunCooldownMs ?? s.stunCooldownMs,
                            stunActiveMs: stunActiveMs ?? s.stunActiveMs,
                            stunnedMs: stunnedMs ?? s.stunnedMs,
                            stunCastActive: stunCastActive ?? s.stunCastActive,
                            dashCharges: dashCharges ?? s.dashCharges,
                            dashRechargeMs: dashRechargeMs ?? s.dashRechargeMs,
                            dashChargeRechargeMs: dashChargeRechargeMs ?? s.dashChargeRechargeMs,
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

    const runAutoPlay = () => {
        if (isAutoPlaying) return;
        if (!isMatchTraining) {
            const catalogSource = hasArenaCheckpoint && arenaCheckpointShapesRef.current
                ? arenaCheckpointShapesRef.current
                : shapes;
            setTargetObstacleObjects(targetObstacleShapes(catalogSource));
        }
        setIsEditingArena(false);
        setIsAutoPlaying(true);
        setSelectedId(null);
        setShapes((prevShapes) => buildAutoPlayStartShapes(prevShapes, matchContext, isMatchTraining));

        autoIntervalRef.current = setInterval(() => {
            setShapes((prevShapes) => {
                const stateSnapshot = buildStatePayload(prevShapes, selectedClass);
                const mainBefore = prevShapes.find((s) => s.id === "main");
                const opponentBefore = prevShapes.find((s) => s.id === "opponent-model");
                const playerPredictedAction = buildDeterministicLogicAction(trainingConfiguration, stateSnapshot);
                const opponentPredictedAction = opponentBefore && hasStrategyActions(opponentTrainingConfiguration)
                    ? buildDeterministicLogicAction(opponentTrainingConfiguration, buildStatePayload(prevShapes, selectedClass, "opponent-model"))
                    : idleAction();
                const playerAction = commandLockedAction(mainBefore, playerPredictedAction);
                const opponentAction = commandLockedAction(opponentBefore, opponentPredictedAction);

                let mainAfter = applyActionToShape({ ...mainBefore, lastPredictedAction: playerPredictedAction }, playerAction, AUTO_STEP_MS);
                let opponentAfter = opponentBefore
                    ? applyActionToShape({ ...opponentBefore, lastPredictedAction: opponentPredictedAction }, opponentAction, AUTO_STEP_MS)
                    : null;
                let grenadeShapes = prevShapes.filter((shape) => shape.type === "grenade" || shape.type === "grenadeExplosion");
                grenadeShapes.push(...[mainAfter.thrownGrenade, opponentAfter?.thrownGrenade].filter(Boolean));
                let fireballShapes = prevShapes.filter((shape) => shape.type === "fireball");
                fireballShapes.push(...[mainAfter.thrownFireball, opponentAfter?.thrownFireball].filter(Boolean));
                mainAfter = { ...mainAfter, thrownGrenade: null };
                mainAfter = { ...mainAfter, thrownFireball: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, thrownGrenade: null };
                if (opponentAfter) opponentAfter = { ...opponentAfter, thrownFireball: null };

                let obstacleShapes = prevShapes.filter((shape) => isObstacleType(shape.type));
                if (opponentAfter) {
                    const resolved = resolveObstacleEffects([mainAfter, opponentAfter], obstacleShapes);
                    [mainAfter, opponentAfter] = resolved.fighters;
                    obstacleShapes = resolved.obstacles;
                    [mainAfter, opponentAfter, obstacleShapes] = resolveCombatDamage(mainAfter, opponentAfter, obstacleShapes);
                    const grenadeUpdate = updateGrenades(grenadeShapes, [mainAfter, opponentAfter], obstacleShapes);
                    obstacleShapes = grenadeUpdate.obstacles;
                    [mainAfter, opponentAfter] = applyGrenadeExplosionDamage([mainAfter, opponentAfter], grenadeUpdate.explosions);
                    grenadeShapes = [...grenadeUpdate.grenades, ...grenadeUpdate.explosions];
                    const fireballUpdate = updateFireballs(fireballShapes, [mainAfter, opponentAfter], obstacleShapes);
                    obstacleShapes = fireballUpdate.obstacles;
                    [mainAfter, opponentAfter] = applyFireballHits([mainAfter, opponentAfter], fireballUpdate.hits);
                    [mainAfter, opponentAfter] = applyStunHits([mainAfter, opponentAfter]);
                    fireballShapes = fireballUpdate.fireballs;
                } else {
                    const resolved = resolveObstacleEffects([mainAfter], obstacleShapes);
                    [mainAfter] = resolved.fighters;
                    obstacleShapes = resolved.obstacles;
                    const grenadeUpdate = updateGrenades(grenadeShapes, [mainAfter], obstacleShapes);
                    obstacleShapes = grenadeUpdate.obstacles;
                    [mainAfter] = applyGrenadeExplosionDamage([mainAfter], grenadeUpdate.explosions);
                    grenadeShapes = [...grenadeUpdate.grenades, ...grenadeUpdate.explosions];
                    const fireballUpdate = updateFireballs(fireballShapes, [mainAfter], obstacleShapes);
                    obstacleShapes = fireballUpdate.obstacles;
                    [mainAfter] = applyFireballHits([mainAfter], fireballUpdate.hits);
                    [mainAfter] = applyStunHits([mainAfter]);
                    fireballShapes = fireballUpdate.fireballs;
                }
                const obstacleById = new Map(obstacleShapes.map((shape) => [shape.id, shape]));

                const nextShapes = prevShapes.map((s) => {
                    if (s.id === "main") return mainAfter;
                    if (s.id === "opponent-model" && opponentAfter) return opponentAfter;
                    if (isObstacleType(s.type)) return obstacleById.get(s.id) ?? null;
                    if (s.type === "grenade" || s.type === "grenadeExplosion" || s.type === "fireball") return null;
                    return tickCombat(s, AUTO_STEP_MS);
                }).filter(Boolean);

                return [...nextShapes, ...grenadeShapes, ...fireballShapes];
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
            .filter((shape) => shape.type !== "fireball")
            .map((shape) => (shape.id === "main" || shape.id === "opponent-model")
                ? resetFighterShape(shape)
                : cloneShape(shape)));
        setSubmitStatus({ ok: true, message: "Bot stats reset." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleSaveArenaCheckpoint = () => {
        if (isAutoPlaying || isStrategyTraining || isBaseTraining) return;
        arenaCheckpointShapesRef.current = cloneShapes(shapes);
        setTargetObstacleObjects(targetObstacleShapes(arenaCheckpointShapesRef.current));
        setHasArenaCheckpoint(true);
        setSubmitStatus({ ok: true, message: "Training checkpoint saved." });
        setTimeout(() => setSubmitStatus(null), 2500);
    };

    const handleResetArenaCheckpoint = () => {
        if (!arenaCheckpointShapesRef.current || isStrategyTraining || isBaseTraining) return;
        stopAutoPlay();
        setIsEditingArena(true);
        setSelectedId(null);
        const checkpointShapes = cloneShapes(arenaCheckpointShapesRef.current);
        setTargetObstacleObjects(targetObstacleShapes(checkpointShapes));
        setShapes(checkpointShapes);
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
        const resetShapes = resetArenaStartShapes(cloneShapes(originalShapes), selectedClass, opponentSelectedClass);
        arenaCheckpointShapesRef.current = null;
        setHasArenaCheckpoint(false);
        setTargetObstacleObjects(targetObstacleShapes(resetShapes));
        setShapes(resetShapes);
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
                <button
                    type="button"
                    onClick={() => navigate("/home")}
                    className="flex items-center gap-3 text-left hover:text-cyan-100"
                    aria-label="Go to home"
                >
                    <span className="text-xl text-cyan leading-none">M</span>
                    <span className="font-ui text-lg font-bold tracking-[0.15em] text-ink-white">MACHINER</span>
                </button>

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
                {!isMatchTraining && (
                    <Toolbar
                        onAddShape={handleAddShape}
                        onSelectMain={() => setSelectedId("main")}
                        onDeleteSelected={handleDeleteSelectedShape}
                        selectedId={selectedId}
                        submitStatus={submitStatus}
                        obstacleCount={shapes.filter((shape) => isObstacleType(shape.type)).length}
                        canDeleteSelected={canDeleteSelectedShape}
                    />
                )}

                <main className="min-w-0 flex-1 flex items-center justify-center bg-arena-deep overflow-auto p-6">
                    <div
                        className="relative w-full"
                        style={{ maxWidth: DISPLAY_ARENA_MAX_SIZE }}
                    >
                        <Canvas
                            shapes={shapes}
                            selectedId={selectedId}
                            onSelectShape={isEditingArena ? setSelectedId : () => { }}
                            onUpdateShape={isEditingArena ? handleUpdateShape : () => { }}
                            onDeselectAll={isEditingArena ? () => setSelectedId(null) : () => { }}
                            editable={isEditingArena}
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
                    obstacleCount={targetObstacleObjects.length}
                    obstacleObjects={targetObstacleObjects}
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
