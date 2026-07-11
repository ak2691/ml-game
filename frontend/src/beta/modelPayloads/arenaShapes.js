import {
    BLOCK_MAX_CHARGES,
    DASH_MAX_CHARGES,
    MELEE_HP,
} from "../classes/MeleeClass.jsx";
import { RANGED_AMMO_MAX } from "../classes/RangedClass.jsx";
import { FIREBALL_CHARGES_MAX } from "../classes/MageClass.jsx";
import {
    BOUNCY_WALL_MAX_USES,
    BOUNCY_WALL_TYPE,
    BUFF_PICKUP_SIZE,
    CENTER_OBJECTIVE_SIZE,
    COMMAND_LOCK_TYPE,
    RADAR_JAMMER_TYPE,
    OVERDRIVE_TYPE,
    BARRIER_TYPE,
    INHIBITION_TYPE,
    PROJECTILE_WALL_LENGTH,
    PROJECTILE_WALL_TYPE,
    snapWallRotation,
} from "../ArenaObjects.js";
import { combatClassHp } from "../classes/CombatClasses.js";
import {
    CANVAS_SIZE,
    DUEL_SLOT_ONE_X,
    DUEL_SLOT_ONE_Y,
    DUEL_SLOT_TWO_X,
    DUEL_SLOT_TWO_Y,
    HEALTH_PACK_SIZE,
    MAX_OBSTACLES,
} from "./arenaConstants.js";

export const MAIN_SHAPE = {
    id: "main",
    type: "circle",
    slot: 1,
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
    fireballCooldownMs: 0,
    fireballActiveMs: 0,
    fireballCharges: 0,
    fireballReloadMs: 0,
    fireballSerial: 1,
    thrownFireball: null,
    stunCooldownMs: 0,
    stunActiveMs: 0,
    stunnedMs: 0,
    stunCastActive: false,
    burnRemainingMs: 0,
    burnTickMs: 0,
    dashCharges: DASH_MAX_CHARGES,
    dashRechargeMs: 0,
    dashChargeRechargeMs: [],
    dashActiveMs: 0,
    dashDirectionX: 0,
    dashDirectionY: 0,
    movementVelocityX: 0,
    movementVelocityY: 0,
    velocityX: 0,
    velocityY: 0,
    shieldHp: 0,
    overdriveMs: 0,
    barrierImmunityMs: 0,
    inhibitionCharges: 0,
    slowedMs: 0,
};

let nextGeneratedId = 1;

export function genId() {
    return `shape-${Date.now()}-${nextGeneratedId++}`;
}

export function buildOpponentShape(opponent) {
    const combatClass = opponent?.selectedClass ?? "melee";
    const slot = Number(opponent?.slot) === 1 ? 1 : 2;
    return {
        id: "opponent-model",
        type: "opponentModel",
        slot,
        x: DUEL_SLOT_TWO_X,
        y: DUEL_SLOT_TWO_Y,
        size: 64,
        rotation: 270,
        combatClass,
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
        fireballCooldownMs: 0,
        fireballActiveMs: 0,
        fireballCharges: combatClass === "mage" ? FIREBALL_CHARGES_MAX : 0,
        fireballReloadMs: 0,
        fireballSerial: 1,
        thrownFireball: null,
        stunCooldownMs: 0,
        stunActiveMs: 0,
        stunnedMs: 0,
        stunCastActive: false,
        burnRemainingMs: 0,
        burnTickMs: 0,
        dashCharges: combatClass === "melee" ? DASH_MAX_CHARGES : 0,
        dashRechargeMs: 0,
        dashChargeRechargeMs: [],
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        shieldHp: 0,
        overdriveMs: 0,
        barrierImmunityMs: 0,
        inhibitionCharges: 0,
        slowedMs: 0,
        jammedMs: 0,
        commandLockedMs: 0,
        commandLockAction: null,
        opponentUsername: opponent?.username,
    };
}

export function buildInitialArenaShapes(matchContext) {
    if (matchContext?.matchId) return buildMatchSpawnShapes(matchContext);
    const shapes = [{ ...MAIN_SHAPE }];
    if (matchContext?.opponent) shapes.push(buildOpponentShape(matchContext.opponent));
    return shapes;
}

export function buildMatchSpawnShapes(matchContext) {
    const playerClass = matchContext?.player?.selectedClass ?? "melee";
    const opponentClass = matchContext?.opponent?.selectedClass ?? "melee";
    const playerSlot = Number(matchContext?.player?.slot) === 2 ? 2 : 1;
    const opponentSlot = playerSlot === 1 ? 2 : 1;
    const fighters = [
        resetFighterShape({
            ...MAIN_SHAPE,
            combatClass: playerClass,
            x: playerSlot === 1 ? DUEL_SLOT_ONE_X : DUEL_SLOT_TWO_X,
            y: playerSlot === 1 ? DUEL_SLOT_ONE_Y : DUEL_SLOT_TWO_Y,
            rotation: playerSlot === 1 ? 90 : 270,
            slot: playerSlot,
        }),
        resetFighterShape({
            ...buildOpponentShape(matchContext?.opponent),
            combatClass: opponentClass,
            x: opponentSlot === 1 ? DUEL_SLOT_ONE_X : DUEL_SLOT_TWO_X,
            y: opponentSlot === 1 ? DUEL_SLOT_ONE_Y : DUEL_SLOT_TWO_Y,
            rotation: opponentSlot === 1 ? 90 : 270,
            slot: opponentSlot,
        }),
    ];
    const matchObstacles = matchObstacleShapes(matchContext?.obstacles, true);
    return [...fighters, ...(matchObstacles.length > 0 ? matchObstacles : defaultCenterObjectiveShapes())];
}

function defaultCenterObjectiveShapes() {
    const buffOffset = CANVAS_SIZE / 4;
    return [
        {
            id: "object_center",
            type: RADAR_JAMMER_TYPE,
            x: CANVAS_SIZE / 2,
            y: CANVAS_SIZE / 2,
            size: CENTER_OBJECTIVE_SIZE,
            rotation: 0,
            locked: true,
        },
        {
            id: "object_buff_1",
            type: OVERDRIVE_TYPE,
            x: CANVAS_SIZE / 2 - buffOffset,
            y: CANVAS_SIZE / 2,
            size: BUFF_PICKUP_SIZE,
            rotation: 0,
            hp: 50,
            locked: true,
        },
        {
            id: "object_buff_2",
            type: BARRIER_TYPE,
            x: CANVAS_SIZE / 2 + buffOffset,
            y: CANVAS_SIZE / 2,
            size: BUFF_PICKUP_SIZE,
            rotation: 0,
            hp: 50,
            locked: true,
        },
    ];
}

export function matchObstacleShapes(obstacles, locked = false) {
    if (!Array.isArray(obstacles)) return [];
    return obstacles
        .filter((obstacle) => isObstacleType(obstacle?.type))
        .map((obstacle, index) => ({
            id: obstacle.id ?? `object_${index + 1}`,
            type: obstacle.type,
            x: Number.isFinite(Number(obstacle.x)) ? Number(obstacle.x) : CANVAS_SIZE / 2,
            y: Number.isFinite(Number(obstacle.y)) ? Number(obstacle.y) : CANVAS_SIZE / 2,
            size: Number.isFinite(Number(obstacle.size))
                ? Number(obstacle.size)
                : obstacle.type === "healthPack"
                    ? HEALTH_PACK_SIZE
                    : obstacle.type === RADAR_JAMMER_TYPE || obstacle.type === COMMAND_LOCK_TYPE
                        ? CENTER_OBJECTIVE_SIZE
                    : isBuffPickupType(obstacle.type)
                        ? BUFF_PICKUP_SIZE
                    : PROJECTILE_WALL_LENGTH,
            rotation: obstacle.type === PROJECTILE_WALL_TYPE || obstacle.type === BOUNCY_WALL_TYPE
                ? snapWallRotation(obstacle.rotation)
                : 0,
            usesRemaining: obstacle.type === BOUNCY_WALL_TYPE
                ? Number(obstacle.usesRemaining ?? BOUNCY_WALL_MAX_USES)
                : undefined,
            hp: Number(obstacle.hp ?? 0),
            captureBySlot: {
                1: Number(obstacle.slotOneCaptureMs ?? obstacle.captureBySlot?.["1"] ?? obstacle.captureBySlot?.[1] ?? 0),
                2: Number(obstacle.slotTwoCaptureMs ?? obstacle.captureBySlot?.["2"] ?? obstacle.captureBySlot?.[2] ?? 0),
            },
            locked,
        }));
}

export function buildObstacleShape(type, id = genId(), random = Math.random, locked = false, occupiedShapes = []) {
    const size = type === "healthPack"
        ? HEALTH_PACK_SIZE
        : type === RADAR_JAMMER_TYPE || type === COMMAND_LOCK_TYPE
            ? CENTER_OBJECTIVE_SIZE
        : isBuffPickupType(type)
            ? BUFF_PICKUP_SIZE
        : PROJECTILE_WALL_LENGTH;
    let candidate = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
        candidate = {
            id,
            type,
            x: size / 2 + random() * (CANVAS_SIZE - size),
            y: size / 2 + random() * (CANVAS_SIZE - size),
            size,
            rotation: 0,
            usesRemaining: type === BOUNCY_WALL_TYPE ? BOUNCY_WALL_MAX_USES : undefined,
            locked,
        };
        if (!occupiedShapes.some((shape) => overlapsShape(shape, candidate, 8))) return candidate;
    }
    return candidate;
}

export function isObstacleType(type) {
    return type === "healthPack"
        || type === PROJECTILE_WALL_TYPE
        || type === BOUNCY_WALL_TYPE
        || type === RADAR_JAMMER_TYPE
        || type === COMMAND_LOCK_TYPE
        || isBuffPickupType(type);
}

export function isBuffPickupType(type) {
    return type === OVERDRIVE_TYPE
        || type === BARRIER_TYPE
        || type === INHIBITION_TYPE;
}

export function nextObstacleId(shapes) {
    const used = new Set(shapes.map((shape) => shape.id));
    for (let index = 1; index <= MAX_OBSTACLES; index += 1) {
        const id = `object_${index}`;
        if (!used.has(id)) return id;
    }
    return genId();
}

export function cloneShape(shape) {
    return {
        ...shape,
        damageZoneIds: shape.damageZoneIds ? [...shape.damageZoneIds] : undefined,
        dashChargeRechargeMs: shape.dashChargeRechargeMs ? [...shape.dashChargeRechargeMs] : undefined,
    };
}

export function cloneShapes(shapes) {
    return shapes.map(cloneShape);
}

export function resetFighterShape(shape) {
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
        fireballCooldownMs: 0,
        fireballActiveMs: 0,
        fireballCharges: combatClass === "mage" ? FIREBALL_CHARGES_MAX : 0,
        fireballReloadMs: 0,
        fireballSerial: 1,
        thrownFireball: null,
        stunCooldownMs: 0,
        stunActiveMs: 0,
        stunnedMs: 0,
        stunCastActive: false,
        burnRemainingMs: 0,
        burnTickMs: 0,
        dashCharges: combatClass === "melee" ? DASH_MAX_CHARGES : 0,
        dashRechargeMs: 0,
        dashChargeRechargeMs: [],
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        movementVelocityX: 0,
        movementVelocityY: 0,
        velocityX: 0,
        velocityY: 0,
        shieldHp: 0,
        overdriveMs: 0,
        barrierImmunityMs: 0,
        inhibitionCharges: 0,
        slowedMs: 0,
        damageZoneIds: [],
        inDamageZone: false,
    };
}

export function buildAutoPlayStartShapes(currentShapes, matchContext, isMatchTraining) {
    const fallbackShapes = isMatchTraining ? buildMatchSpawnShapes(matchContext) : [];
    const fallbackMain = fallbackShapes.find((shape) => shape.id === "main");

    const nextShapes = cloneShapes(currentShapes);
    if (!nextShapes.some((shape) => shape.id === "main")) {
        nextShapes.unshift(resetFighterShape(fallbackMain ?? { ...MAIN_SHAPE }));
    }

    const obstacles = nextShapes.filter((shape) => isObstacleType(shape.type));
    const fallbackObstacles = fallbackShapes.filter((shape) => isObstacleType(shape.type));
    if (isMatchTraining) {
        return [
            ...nextShapes.filter((shape) => !isObstacleType(shape.type)),
            ...cloneShapes(fallbackObstacles),
        ];
    }
    return [
        ...nextShapes,
        ...(!obstacles.length
            ? fallbackObstacles.length
                ? cloneShapes(fallbackObstacles)
                : []
            : []),
    ];
}

export function resetArenaStartShapes(shapes, selectedClass, opponentSelectedClass) {
    return shapes.map((shape) => {
        if (shape.id === "main") return resetFighterShape({ ...shape, combatClass: selectedClass });
        if (shape.id === "opponent-model") {
            return resetFighterShape({ ...shape, combatClass: opponentSelectedClass, locked: false });
        }
        return cloneShape(shape);
    });
}

function overlapsShape(first, second, padding = 0) {
    return Math.hypot(first.x - second.x, first.y - second.y)
        <= (first.size + second.size) / 2 + padding;
}
