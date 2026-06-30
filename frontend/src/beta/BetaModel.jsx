import { useState, useCallback, useEffect, useRef } from "react";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import StrategyTrainingPanel from "./StrategyTrainingPanel";
import "./BetaModel.css";
import {
    loadOrCreateModel,
    loadOrCreateMatchModel,
    cloneCombatModel,
    createModel,
    getMatchModelKey,
    getPracticeModelKey,
    saveModel,
    warmUpModel
} from "../ml/Model";
import {
    predictPolicyAction,
    trainMeleeStrategy,
} from "../ml/MeleeStrategyTrainer.js";
import { trainSupervisedMeleeBase } from "../ml/SupervisedMeleeBase";
import { exportApprovedBaseArtifact } from "../ml/BaseModelArtifact";
import {
    createDefaultMeleeStrategyConfiguration,
    normalizeMeleeStrategyConfiguration,
    selectMeleeStrategyIntent,
    shouldAllowMeleeStrategyDash,
} from "../ml/MeleeStrategy.js";
import {
    buildModelSubmissionPayload,
    buildModelFingerprintProbeResponse,
    createTrainingSession,
    fetchTrainingSessionDuration,
    submitModelPayload
} from "../ml/ModelSubmission";
import {
    ACTION_SCHEMA_VERSION,
    FEATURE_SCHEMA_VERSION,
    MODEL_ARCHITECTURE_VERSION,
} from "../ml/ModelSubmissionContract";
//test
const CANVAS_SIZE = 800;
const AUTO_SPEED = 8;
const AUTO_STEP_MS = 100;
const ROTATION_STEP_DEG = 24;
const SWING_COOLDOWN_MS = 1000;
const SWING_ACTIVE_MS = 200;
const BLOCK_ACTIVE_MS = 500;
const BLOCK_COOLDOWN_MS = 1000;
const DASH_DURATION_MS = 1000;
const DASH_COOLDOWN_MS = 4500;
const DASH_SPEED = 20;
const MELEE_DAMAGE = 20;
const MELEE_HP = 100;
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
    dashCooldownMs: 0,
    dashActiveMs: 0,
    dashDirectionX: 0,
    dashDirectionY: 0,
    velocityX: 0,
    velocityY: 0,
};

let _id = 1;
const genId = () => `shape-${Date.now()}-${_id++}`;
const SESSION_KEY = "arena-training-session-id";

function matchStrategyConfigurationKey(matchId, userId, combatClass) {
    return matchId && userId
        ? `arena-match-strategy-v1-${combatClass}-${matchId}-${userId}`
        : null;
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

function learningRateForRound(roundNumber) {
    const round = Math.max(1, Math.round(Number(roundNumber) || 1));
    if (round === 1) return 0.01;
    if (round === 2) return 0.006;
    return 0.004;
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
        dashCooldownMs: 0,
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
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
    const fighters = [
        resetFighterShape({ ...MAIN_SHAPE, x: DUEL_SLOT_ONE_X, y: CANVAS_SIZE / 2, rotation: 0 }),
        resetFighterShape({
            ...buildOpponentShape(matchContext?.opponent),
            x: DUEL_SLOT_TWO_X,
            y: CANVAS_SIZE / 2,
            rotation: 180,
            locked: true,
        }),
    ];
    return [
        ...fighters,
        ...createRandomArenaObstacles(createSeededRandom(obstacleSeed(matchContext)), true, fighters),
    ];
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
    return {
        ...shape,
        hp: MELEE_HP,
        swingCooldownMs: 0,
        swingActiveMs: 0,
        blockCooldownMs: 0,
        blockActiveMs: 0,
        dashCooldownMs: 0,
        dashActiveMs: 0,
        dashDirectionX: 0,
        dashDirectionY: 0,
        velocityX: 0,
        velocityY: 0,
        damageZoneIds: [],
        inDamageZone: false,
    };
}

function buildCleanPlayStartShapes(currentShapes, matchContext, isMatchTraining) {
    if (isMatchTraining) return buildMatchSpawnShapes(matchContext);

    const fighters = currentShapes
        .filter((shape) => shape.id === "main" || shape.id === "opponent-model")
        .map(resetFighterShape);
    if (!fighters.some((shape) => shape.id === "main")) fighters.unshift(resetFighterShape({ ...MAIN_SHAPE }));
    if (!fighters.some((shape) => shape.id === "opponent-model")) fighters.push(resetFighterShape(buildOpponentShape()));

    const obstacles = currentShapes.filter((shape) => isObstacleType(shape.type));
    return [
        ...fighters,
        ...(obstacles.length
            ? cloneShapes(obstacles)
            : createRandomArenaObstacles(Math.random, false, fighters)),
    ];
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
    return {
        ...shape,
        swingCooldownMs: Math.max(0, (shape.swingCooldownMs ?? 0) - elapsedMs),
        swingActiveMs: Math.max(0, (shape.swingActiveMs ?? 0) - elapsedMs),
        blockCooldownMs: Math.max(0, (shape.blockCooldownMs ?? 0) - elapsedMs),
        blockActiveMs: Math.max(0, (shape.blockActiveMs ?? 0) - elapsedMs),
        dashCooldownMs: Math.max(0, (shape.dashCooldownMs ?? 0) - elapsedMs),
        dashActiveMs: Math.max(0, (shape.dashActiveMs ?? 0) - elapsedMs),
    };
}

function applyActionToShape(shape, action, elapsedMs) {
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    const mag = Math.hypot(action.dx ?? 0, action.dy ?? 0);
    const dx = mag > 0.001 ? action.dx / mag : 0;
    const dy = mag > 0.001 ? action.dy / mag : 0;
    const dashAvailable = (shape.dashCooldownMs ?? 0) <= 0;
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
            velocityX: dashX * DASH_SPEED / seconds,
            velocityY: dashY * DASH_SPEED / seconds,
        };
    } else {
        next = {
            ...next,
            x: clamp(shape.x + dx * AUTO_SPEED, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            y: clamp(shape.y + dy * AUTO_SPEED, shape.size / 2, CANVAS_SIZE - shape.size / 2),
            velocityX: dx * AUTO_SPEED / seconds,
            velocityY: dy * AUTO_SPEED / seconds,
        };
    }

    const swingAvailable = (next.swingCooldownMs ?? 0) <= 0;
    if ((action.swing ?? 0) > 0.5 && swingAvailable) {
        next.swingCooldownMs = SWING_COOLDOWN_MS;
        next.swingActiveMs = SWING_ACTIVE_MS;
    }

    const blockAvailable = (next.blockCooldownMs ?? 0) <= 0 && (next.blockActiveMs ?? 0) <= 0;
    if ((action.block ?? 0) > 0.5 && blockAvailable) {
        next.blockActiveMs = BLOCK_ACTIVE_MS;
        next.blockCooldownMs = BLOCK_ACTIVE_MS + BLOCK_COOLDOWN_MS;
    }

    return tickCombat(next, elapsedMs);
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
    if ((defender.blockActiveMs ?? 0) <= 0) return false;

    const incomingAngle = Math.atan2(attacker.y - defender.y, attacker.x - defender.x) * 180 / Math.PI;
    return Math.abs(angleDelta(defender.rotation ?? 0, incomingAngle)) <= 95;
}

function resolveMeleeDamage(first, second) {
    let nextFirst = first;
    let nextSecond = second;

    if (isSwingHitting(first, second) && !isBlockingHit(second, first)) {
        nextSecond = { ...nextSecond, hp: Math.max(0, (nextSecond.hp ?? MELEE_HP) - incomingMeleeDamage(nextSecond)) };
    }

    if (isSwingHitting(second, first) && !isBlockingHit(first, second)) {
        nextFirst = { ...nextFirst, hp: Math.max(0, (nextFirst.hp ?? MELEE_HP) - incomingMeleeDamage(nextFirst)) };
    }

    return [nextFirst, nextSecond];
}

function incomingMeleeDamage(defender) {
    return Math.round(MELEE_DAMAGE * (defender.inDamageZone ? DAMAGE_ZONE_DAMAGE_MULTIPLIER : 1));
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
            hp: Math.min(MELEE_HP, (nextFighters[collectorIndex].hp ?? MELEE_HP) + HEALTH_PACK_HEAL),
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

function buildScriptedMeleeOpponentAction(opponent, target) {
    if (!opponent || !target) return { dx: 0, dy: 0, dRot: 0, swing: 0, block: 0, dash: 0 };

    const dx = target.x - opponent.x;
    const dy = target.y - opponent.y;
    const distance = Math.hypot(dx, dy);
    const bearing = Math.atan2(dy, dx) * 180 / Math.PI;
    const turn = angleDelta(opponent.rotation ?? 0, bearing);
    const facingTarget = Math.abs(turn) <= 35;
    const targetSwinging = (target.swingActiveMs ?? 0) > 0;
    const targetFacing = Math.abs(angleDelta(target.rotation ?? 0, bearing + 180)) <= 55;
    const shouldBlock = targetSwinging && targetFacing && distance <= 130;
    const shouldSwing = facingTarget && distance <= 96 && (opponent.swingCooldownMs ?? 0) <= 0;
    const shouldDash = distance > 260 && (opponent.dashCooldownMs ?? 0) <= 0;

    return {
        dx: distance > 82 ? dx : 0,
        dy: distance > 82 ? dy : 0,
        dRot: clamp(turn / ROTATION_STEP_DEG, -1, 1),
        swing: shouldSwing ? 1 : 0,
        block: shouldBlock ? 1 : 0,
        dash: shouldDash ? 1 : 0,
    };
}

export default function BetaModel({
    matchContext = null,
    finishStatus = null,
    onFinishMatch = null
}) {
    const matchId = matchContext?.matchId;
    const matchUserId = matchContext?.player?.userId;
    const isMatchTraining = Boolean(matchId && matchUserId);
    const playerRoundWins = Math.max(0, Number(matchContext?.player?.roundWins) || 0);
    const opponentRoundWins = Math.max(0, Number(matchContext?.opponent?.roundWins) || 0);
    const selectedClass = "melee";
    const strategyStorageKey = matchStrategyConfigurationKey(matchId, matchUserId, selectedClass);
    const [shapes, setShapes] = useState(() => buildInitialArenaShapes(matchContext));
    const [selectedId, setSelectedId] = useState(null);
    const [submitStatus, setSubmitStatus] = useState(null);
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);
    const [hasCleanPlaySnapshot, setHasCleanPlaySnapshot] = useState(false);
    const [isBaseTraining, setIsBaseTraining] = useState(false);
    const [baseCandidate, setBaseCandidate] = useState(null);
    const [baseExportState, setBaseExportState] = useState("idle");
    const [isEditingArena, setIsEditingArena] = useState(true);
    const [trainingConfiguration, setTrainingConfiguration] = useState(() => (
        isMatchTraining ? loadStoredStrategyConfiguration(strategyStorageKey) : createDefaultMeleeStrategyConfiguration()
    ));
    const [isStrategyTraining, setIsStrategyTraining] = useState(false);
    const [trainingProgress, setTrainingProgress] = useState(null);
    const [trainingSummary, setTrainingSummary] = useState(null);
    const [trainingSessionId, setTrainingSessionId] = useState(() => isMatchTraining
        ? null
        : localStorage.getItem(SESSION_KEY));
    const [submittedModelId, setSubmittedModelId] = useState(null);
    const [isFinishingMatch, setIsFinishingMatch] = useState(false);
    const [trainingRemaining, setTrainingRemaining] = useState(() =>
        secondsRemaining(matchContext?.trainingEndsAtMs ?? matchContext?.trainingEndsAt));

    const modelRef = useRef(null);
    const roundCheckpointRef = useRef(null);
    const autoIntervalRef = useRef(null);
    const cleanPlayInitialShapesRef = useRef(null);
    const finishHandlerRef = useRef(null);
    const handledProbeIdsRef = useRef(new Set());
    const trainingRunRef = useRef(null);
    const trainingSummaryRef = useRef(null);

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
        let cancelled = false;
        async function initializeModel() {
            if (isMatchTraining) {
                return loadOrCreateMatchModel(matchId, matchUserId, selectedClass);
            }
            return loadOrCreateModel(selectedClass);
        }

        initializeModel().then(async (m) => {
            try {
                await warmUpModel(m);
            } catch (err) {
                console.warn("[arena-ml] Model warmup failed; continuing without full warmup.", err);
            }
            if (cancelled) {
                m.dispose();
                return;
            }
            modelRef.current?.dispose();
            roundCheckpointRef.current?.dispose();
            modelRef.current = m;
            roundCheckpointRef.current = cloneCombatModel(m);
            console.log(`[arena-ml] ${isMatchTraining ? "Fresh match round checkpoint" : "Practice checkpoint"} ready.`);
        });
        const trainingSessionTimeoutId = window.setTimeout(() => ensureTrainingSession(), 0);

        return () => {
            cancelled = true;
            window.clearTimeout(trainingSessionTimeoutId);
            if (autoIntervalRef.current) {
                clearInterval(autoIntervalRef.current);
            }
            modelRef.current?.dispose();
            roundCheckpointRef.current?.dispose();
            modelRef.current = null;
            roundCheckpointRef.current = null;
        };
    }, [ensureTrainingSession, isMatchTraining, matchId, matchUserId, selectedClass]);

    useEffect(() => {
        if (!matchContext?.opponent) return;
        const timeoutId = window.setTimeout(() => {
            setShapes((prev) => {
                if (prev.some((shape) => shape.type === "opponentModel")) {
                    return prev.map((shape) => shape.type === "opponentModel"
                        ? { ...shape, opponentUsername: matchContext.opponent.username }
                        : shape);
                }
                return [...prev, buildOpponentShape(matchContext.opponent)];
            });
        }, 0);
        return () => window.clearTimeout(timeoutId);
    }, [matchContext?.opponent]);

    useEffect(() => {
        const probe = matchContext?.probeRequest;
        if (!isMatchTraining || !probe?.probeId || handledProbeIdsRef.current.has(probe.probeId)) return;
        handledProbeIdsRef.current.add(probe.probeId);

        let cancelled = false;
        const respond = async () => {
            if (cancelled || !modelRef.current || !matchContext?.onProbeResponse) return;

            try {
                const response = await buildModelFingerprintProbeResponse({
                    model: modelRef.current,
                    probe,
                    trainingStepCount: trainingSummaryRef.current?.trainingSamples ?? 0,
                });
                if (!cancelled) {
                    matchContext.onProbeResponse(response);
                }
            } catch (err) {
                console.warn("[arena-ml] Model fingerprint probe failed.", err);
            }
        };

        const idleCallbackId = typeof window.requestIdleCallback === "function"
            ? window.requestIdleCallback(respond, { timeout: 500 })
            : null;
        const timeoutId = idleCallbackId == null ? window.setTimeout(respond, 0) : null;

        return () => {
            cancelled = true;
            if (idleCallbackId != null && typeof window.cancelIdleCallback === "function") {
                window.cancelIdleCallback(idleCallbackId);
            }
            if (timeoutId != null) {
                window.clearTimeout(timeoutId);
            }
        };
    }, [isMatchTraining, matchContext]);

    const fetchTrustedTrainingDuration = async (sessionId = trainingSessionId) => {
        if (!sessionId) return null;

        try {
            return await fetchTrainingSessionDuration(sessionId);
        } catch {
            return null;
        }
    };

    const updateTrainingConfiguration = (configuration) => {
        setTrainingConfiguration(configuration);
        if (strategyStorageKey) {
            localStorage.setItem(strategyStorageKey, JSON.stringify(configuration));
        }
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
                combatClass: type === "opponentModel" ? "melee" : undefined,
                hp: type === "opponentModel" ? MELEE_HP : undefined,
                swingCooldownMs: 0,
                swingActiveMs: 0,
                blockCooldownMs: 0,
                blockActiveMs: 0,
                dashCooldownMs: 0,
                dashActiveMs: 0,
                dashDirectionX: 0,
                dashDirectionY: 0,
                velocityX: 0,
                velocityY: 0,
            };
            setSelectedId(s.id);
            return [...prev, s];
        });
    }, [isMatchTraining]);

    const handleUpdateShape = useCallback((id, updates) => {
        setShapes((prev) =>
            prev.map((s) => {
                if (s.id !== id) return s;
                if (s.locked) return s;
                if (s.id === "main") {
                    const { x, y, rotation, hp, swingCooldownMs, swingActiveMs, blockCooldownMs, blockActiveMs } = updates;
                    return (x !== undefined || y !== undefined || rotation !== undefined || hp !== undefined
                        || swingCooldownMs !== undefined || swingActiveMs !== undefined
                        || blockCooldownMs !== undefined || blockActiveMs !== undefined)
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
                        }
                        : s;
                }
                return { ...s, ...updates };
            })
        );
    }, []);

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
                blockAvailable: (main.blockCooldownMs ?? 0) <= 0 && (main.blockActiveMs ?? 0) <= 0,
                blockActive: (main.blockActiveMs ?? 0) > 0,
                blockActiveRemainingMs: Math.round(main.blockActiveMs ?? 0),
                blockCooldownRemainingMs: Math.round(main.blockCooldownMs ?? 0),
                hp: main.hp ?? MELEE_HP,
                size: main.size,
                dashAvailable: (main.dashCooldownMs ?? 0) <= 0 && (main.dashActiveMs ?? 0) <= 0,
                dashActive: (main.dashActiveMs ?? 0) > 0,
                dashCooldownRemainingMs: Math.round(main.dashCooldownMs ?? 0),
            },
            objects: currentShapes
                .filter((s) => s.id !== actorId)
                .map((s) => ({
                    id: s.id,
                    type: s.id === "main" && actorId !== "main" ? "opponentModel" : s.type,
                    x: Math.round(s.x),
                    y: Math.round(s.y),
                    size: s.size,
                    rotation: Math.round(s.rotation),
                    combatClass: s.combatClass,
                    hp: s.hp ?? MELEE_HP,
                    swingActive: (s.swingActiveMs ?? 0) > 0,
                    blockActive: (s.blockActiveMs ?? 0) > 0,
                    velocityX: s.velocityX ?? 0,
                    velocityY: s.velocityY ?? 0,
                })),
        };
    };

    const runCleanPlay = () => {
        if (isAutoPlaying || !modelRef.current) return;
        setIsEditingArena(false);
        setIsAutoPlaying(true);
        setSelectedId(null);
        setShapes((prevShapes) => {
            const initialShapes = buildCleanPlayStartShapes(prevShapes, matchContext, isMatchTraining);
            cleanPlayInitialShapesRef.current = cloneShapes(initialShapes);
            return initialShapes;
        });
        setHasCleanPlaySnapshot(true);

        autoIntervalRef.current = setInterval(() => {
            setShapes((prevShapes) => {
                const stateSnapshot = buildStatePayload(prevShapes);
                const activeIntent = selectMeleeStrategyIntent(trainingConfiguration, stateSnapshot);
                const predictedAction = predictPolicyAction(modelRef.current, {
                    ...stateSnapshot,
                    intent: activeIntent,
                });
                const playerAction = shouldAllowMeleeStrategyDash(trainingConfiguration, stateSnapshot)
                    ? predictedAction
                    : { ...predictedAction, dash: 0 };
                const mainBefore = prevShapes.find((s) => s.id === "main");
                const opponentBefore = prevShapes.find((s) => s.id === "opponent-model");
                const opponentAction = buildScriptedMeleeOpponentAction(opponentBefore, mainBefore);

                let mainAfter = applyActionToShape(mainBefore, playerAction, AUTO_STEP_MS);
                let opponentAfter = opponentBefore
                    ? applyActionToShape(opponentBefore, opponentAction, AUTO_STEP_MS)
                    : null;

                let obstacleShapes = prevShapes.filter((shape) => isObstacleType(shape.type));
                if (opponentAfter) {
                    const resolved = resolveObstacleEffects([mainAfter, opponentAfter], obstacleShapes);
                    [mainAfter, opponentAfter] = resolved.fighters;
                    obstacleShapes = resolved.obstacles;
                    [mainAfter, opponentAfter] = resolveMeleeDamage(mainAfter, opponentAfter);
                } else {
                    const resolved = resolveObstacleEffects([mainAfter], obstacleShapes);
                    [mainAfter] = resolved.fighters;
                    obstacleShapes = resolved.obstacles;
                }
                const obstacleById = new Map(obstacleShapes.map((shape) => [shape.id, shape]));

                const nextShapes = prevShapes.map((s) => {
                    if (s.id === "main") return mainAfter;
                    if (s.id === "opponent-model" && opponentAfter) return opponentAfter;
                    if (isObstacleType(s.type)) return obstacleById.get(s.id) ?? null;
                    return tickCombat(s, AUTO_STEP_MS);
                }).filter(Boolean);

                return nextShapes;
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

    const resetCleanPlay = () => {
        if (!cleanPlayInitialShapesRef.current) return;
        setSelectedId(null);
        setShapes(cloneShapes(cleanPlayInitialShapesRef.current));
    };

    const stopStrategyTraining = () => {
        if (trainingRunRef.current) {
            trainingRunRef.current.cancelled = true;
            setSubmitStatus({ ok: null, message: "Stopping after the current batch..." });
        }
    };

    const startStrategyTraining = async () => {
        if (isStrategyTraining || isBaseTraining || !modelRef.current || !roundCheckpointRef.current) return;
        const configuration = normalizeMeleeStrategyConfiguration(trainingConfiguration);
        stopAutoPlay();
        setBaseCandidate(null);
        setBaseExportState("idle");
        const serverDeadline = matchContext?.trainingEndsAtMs ?? matchContext?.trainingEndsAt;
        const parsedServerDeadline = serverDeadline ? new Date(serverDeadline).getTime() : Number.POSITIVE_INFINITY;
        // Event-handler wall-clock check; intentionally sampled at click time.
        // eslint-disable-next-line react-hooks/purity
        const serverTimeRemainingMs = parsedServerDeadline - Date.now();
        if (serverDeadline && (!Number.isFinite(serverTimeRemainingMs) || serverTimeRemainingMs <= 0)) {
            setSubmitStatus({ ok: false, message: "The ten-minute training window has ended." });
            return;
        }

        const run = { cancelled: false };
        trainingRunRef.current = run;
        updateTrainingConfiguration(configuration);
        setTrainingProgress(null);
        setTrainingSummary(null);
        setIsEditingArena(false);
        setIsStrategyTraining(true);
        setSubmitStatus({ ok: null, message: "Generating temporary supervised examples..." });

        let candidateModel = cloneCombatModel(roundCheckpointRef.current);
        const previousModel = modelRef.current;
        modelRef.current = candidateModel;
        try {
            await warmUpModel(candidateModel);
            const summary = await trainMeleeStrategy(candidateModel, configuration, {
                timeLimitMs: serverDeadline ? Math.min(15_000, serverTimeRemainingMs) : 15_000,
                learningRate: isMatchTraining ? learningRateForRound(matchContext?.roundNumber) : 0.01,
                shouldStop: () => run.cancelled,
                onEpoch: (progress) => {
                    setTrainingProgress(progress);
                    setSubmitStatus({
                        ok: null,
                        message: `Training ${progress.epoch}/${progress.epochs} · loss ${progress.loss?.toFixed(4) ?? "—"} · validation ${progress.validationLoss?.toFixed(4) ?? "—"}`,
                    });
                },
            });
            if (summary.stoppedByUser) {
                throw new Error("Training stopped; the previous round candidate remains active.");
            }
            await saveModel(
                candidateModel,
                isMatchTraining
                    ? getMatchModelKey(matchId, matchUserId, selectedClass)
                    : getPracticeModelKey(selectedClass)
            );
            candidateModel = null;
            previousModel?.dispose();
            setSubmittedModelId(null);
            trainingSummaryRef.current = summary;
            setTrainingSummary(summary);
            setSubmitStatus({ ok: null, message: "Training complete. Submitting round candidate..." });
            await handleSubmitModel({ preserveStatus: true });
        } catch (err) {
            if (candidateModel && modelRef.current === candidateModel) {
                modelRef.current = previousModel;
            }
            console.warn("[arena-ml] Supervised strategy training failed.", err);
            setSubmitStatus({ ok: false, message: `Training failed: ${err.message}` });
        } finally {
            candidateModel?.dispose();
            trainingRunRef.current = null;
            setIsStrategyTraining(false);
            setIsEditingArena(true);
        }
    };

    const handleTrainBaseModel = async () => {
        if (isBaseTraining || isStrategyTraining || isMatchTraining) return;
        stopAutoPlay();
        setBaseCandidate(null);
        setBaseExportState("idle");
        setIsEditingArena(false);
        setIsBaseTraining(true);
        setSubmitStatus({ ok: null, message: "Preparing fresh supervised base..." });
        const freshModel = createModel();

        try {
            await warmUpModel(freshModel);
            const metrics = await trainSupervisedMeleeBase(freshModel, {
                onEpoch: ({ epoch, epochs, loss }) => {
                    setSubmitStatus({
                        ok: null,
                        message: `Training melee base ${epoch}/${epochs} · loss ${loss.toFixed(4)}`,
                    });
                },
            });

            trainingSummaryRef.current = null;
            setTrainingSummary(null);
            setTrainingProgress(null);
            await saveModel(freshModel, getPracticeModelKey(selectedClass));
            modelRef.current?.dispose();
            modelRef.current = freshModel;
            roundCheckpointRef.current?.dispose();
            roundCheckpointRef.current = cloneCombatModel(freshModel);
            setBaseCandidate({ combatClass: selectedClass, metrics });
            setSubmitStatus({
                ok: true,
                message: `Base ready · swing ${(metrics.swingAccuracy * 100).toFixed(1)}% · rotation MAE ${metrics.rotationMeanAbsoluteError.toFixed(3)}`,
            });
            setTimeout(() => setSubmitStatus(null), 6000);
        } catch (err) {
            freshModel.dispose();
            setSubmitStatus({ ok: false, message: `Base training failed: ${err.message}` });
        } finally {
            setIsBaseTraining(false);
            setIsEditingArena(true);
        }
    };

    const handleExportBaseModel = async () => {
        if (isBaseTraining || isStrategyTraining || isMatchTraining) return;
        if (!baseCandidate) {
            setBaseExportState("error");
            setSubmitStatus({
                ok: false,
                message: "Train a fresh base candidate before approving it. A page refresh clears candidate approval state.",
            });
            return;
        }
        if (!modelRef.current) {
            setBaseExportState("error");
            setSubmitStatus({ ok: false, message: "The base model is still loading. Try export again in a moment." });
            return;
        }

        setBaseExportState("exporting");
        setSubmitStatus({ ok: null, message: "Approving and exporting base artifact..." });

        try {
            const { metrics } = baseCandidate;
            const artifact = await exportApprovedBaseArtifact({
                model: modelRef.current,
                combatClass: baseCandidate.combatClass,
                trainingMetrics: {
                    finalLoss: metrics.finalLoss,
                    rotationMeanAbsoluteError: metrics.rotationMeanAbsoluteError,
                    swingAccuracy: metrics.swingAccuracy,
                    validationSamples: metrics.validationSamples,
                },
                trainingRecipe: {
                    type: "synthetic-supervised-mechanics",
                    sampleCount: metrics.sampleCount,
                    epochs: metrics.epochs,
                    batchSize: metrics.batchSize,
                    trainedHeads: ["rotation", "swing"],
                    neutralHeads: ["movement", "block", "dash"],
                },
            });
            setSubmitStatus({
                ok: true,
                message: `Exported approved ${artifact.baseModel.artifactId}`,
            });
            setBaseExportState("exported");
            setTimeout(() => setSubmitStatus(null), 6000);
        } catch (err) {
            setBaseExportState("error");
            setSubmitStatus({ ok: false, message: `Base export failed: ${err.message}` });
        }
    };

    const handleCleanPlayToggle = () => {
        if (isAutoPlaying) {
            stopAutoPlay();
            setIsEditingArena(true);
            return;
        }
        runCleanPlay();
    };

    const handleResetRoundModel = async () => {
        if (!isMatchTraining || isBaseTraining || isStrategyTraining || finishStatus !== "TRAINING") return;
        if (!roundCheckpointRef.current) return;

        const resetModel = cloneCombatModel(roundCheckpointRef.current);
        const previousModel = modelRef.current;
        try {
            await warmUpModel(resetModel);
            await saveModel(resetModel, getMatchModelKey(matchId, matchUserId, selectedClass));
            modelRef.current = resetModel;
            previousModel?.dispose();
            setSubmittedModelId(null);
            trainingSummaryRef.current = null;
            setTrainingSummary(null);
            setTrainingProgress(null);
            setSubmitStatus({ ok: true, message: "Round model reset to checkpoint." });
            setTimeout(() => setSubmitStatus(null), 3000);
        } catch (err) {
            resetModel.dispose();
            setSubmitStatus({ ok: false, message: `Reset failed: ${err.message}` });
        }
    };

    const handleSubmitModel = async ({ preserveStatus = false } = {}) => {
        if (!modelRef.current) return null;
        setSubmitStatus({ ok: null, message: "Submitting model..." });

        try {
            const activeTrainingSessionId = trainingSessionId ?? await ensureTrainingSession({ required: true });
            if (!activeTrainingSessionId) {
                throw new Error("A server training session is required before submission.");
            }
            const trustedDurationMs = await fetchTrustedTrainingDuration(activeTrainingSessionId);
            const trainingMetrics = trainingSummaryRef.current ?? {
                version: "melee-supervised-training-metrics-v1",
                configuration: normalizeMeleeStrategyConfiguration(trainingConfiguration),
                trainingSamples: 0,
                validationSamples: 0,
                epochsCompleted: 0,
            };
            const payload = await buildModelSubmissionPayload({
                model: modelRef.current,
                matchId: isMatchTraining ? matchId : null,
                trainingSessionId: activeTrainingSessionId,
                trainingSteps: trainingMetrics.trainingSamples * trainingMetrics.epochsCompleted,
                selectedClass,
                trainingMetrics,
            });

            payload.trainingDurationMs = trustedDurationMs;

            const result = await submitModelPayload(payload);
            console.info("[arena-ml] Submitted model contract:", payload);
            if (result.modelSubmissionId) {
                setSubmittedModelId(result.modelSubmissionId);
            }
            setSubmitStatus({
                ok: result.accepted !== false,
                message: result.message ?? "Model contract submitted",
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
            setSubmitStatus({ ok: true, message: "Model submitted. Waiting for opponent." });
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
                    {/*
                        <>
                    <button
                        onClick={handleExportBaseModel}
                        disabled={isBaseTraining || isStrategyTraining || isMatchTraining}
                        title={baseCandidate
                            ? "Freeze this candidate as the approved class base artifact."
                            : "Train a fresh base candidate before exporting."}
                        className={`text-[10px] border px-2 py-1 rounded ${isBaseTraining || isStrategyTraining || isMatchTraining
                            ? "bg-zinc-900 text-ink-muted border-border-lo cursor-not-allowed"
                            : baseExportState === "exported"
                                ? "bg-green-900/40 text-green-300 border-green-700/60"
                                : baseExportState === "error"
                                    ? "bg-red-900/40 hover:bg-red-800 text-red-200 border-red-700/60"
                            : "bg-amber-900/40 hover:bg-amber-800 text-amber-200 border-amber-800/50"
                            }`}
                    >
                        {baseExportState === "exporting"
                            ? "EXPORTING..."
                            : baseExportState === "exported"
                                ? "EXPORTED ✓"
                                : baseExportState === "error"
                                    ? "EXPORT FAILED"
                                    : "APPROVE + EXPORT"}
                    </button>
                        </>
                    */}
                </div>
            </header>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                <Toolbar
                    onAddShape={handleAddShape}
                    onSelectMain={() => setSelectedId("main")}
                    selectedId={selectedId}
                    submitStatus={submitStatus}
                    obstacleCount={shapes.filter((shape) => isObstacleType(shape.type)).length}
                    obstaclesLocked={isMatchTraining}
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
                    onStartTraining={startStrategyTraining}
                    onStopTraining={stopStrategyTraining}
                    isTraining={isStrategyTraining}
                    progress={trainingProgress}
                    summary={trainingSummary}
                    selectedClass={selectedClass}
                    isMatchTraining={isMatchTraining}
                    matchContext={matchContext}
                    trainingRemaining={trainingRemaining}
                    playerRoundWins={playerRoundWins}
                    opponentRoundWins={opponentRoundWins}
                    obstacleCount={shapes.filter((shape) => isObstacleType(shape.type)).length}
                    isAutoPlaying={isAutoPlaying}
                    hasCleanPlaySnapshot={hasCleanPlaySnapshot}
                    isBaseTraining={isBaseTraining}
                    baseCandidate={baseCandidate}
                    baseExportState={baseExportState}
                    finishStatus={finishStatus}
                    isFinishingMatch={isFinishingMatch}
                    canFinishMatch={Boolean(onFinishMatch)}
                    onCleanPlayToggle={handleCleanPlayToggle}
                    onResetCleanPlay={resetCleanPlay}
                    onResetRoundModel={handleResetRoundModel}
                    onTrainBaseModel={handleTrainBaseModel}
                    onExportBaseModel={handleExportBaseModel}
                    onFinishMatch={handleFinishMatch}
                />
            </div>
        </div>
    );
}
