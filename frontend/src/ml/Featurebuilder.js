/**
 * Converts the arena state into a flat Float32Array for TensorFlow.js.
 *
 * Input shape:
 *   7 legacy player combat features + 6 legacy opponent features
 *   + 13 duel strategy features + 5 obstacle slots of 6 features
 *   + 29 active intent features = 85
 *
 * Player combat features:
 *   [0] rotation
 *   [1] swingAvailable
 *   [2] swingCooldownRemaining
 *   [3] blockAvailable
 *   [4] blockActive
 *   [5] blockActiveRemaining
 *   [6] blockCooldownRemaining
 *
 * Legacy opponent features:
 *   [0] relX
 *   [1] relY
 *   [2] relativeBearing (-1 left through 0 ahead to 1 right)
 *   [3] present (1 when an opponent exists)
 *   [4] size
 *   [5] rotation
 *
 * Duel strategy features:
 *   [13] player HP
 *   [14] player distance to nearest arena edge
 *   [15] dashAvailable
 *   [16] dashActive
 *   [17] dashCooldownRemaining
 *   [18] opponent HP
 *   [19] opponent distance to nearest arena edge
 *   [20] opponent attacking
 *   [21] opponent blocking
 *   [22] opponent velocity X
 *   [23] opponent velocity Y
 *   [24] opponent radial velocity toward player (negative means fleeing)
 *   [25] opponent distance
 *
 * Obstacle slots:
 *   slot N starts at 26 + N * 6
 *   [0] present
 *   [1] health pack
 *   [2] damage zone
 *   [3] relX
 *   [4] relY
 *   [5] distance
 *
 * Active intent features:
 *   start after obstacle slots and encode the selected logic-block action:
 *   intent type, target object/opponent, movement style, and dash request.
 */

import { DEFAULT_INTENT, INTENT_FEATURE_SIZE, encodeIntentFeatures } from "./IntentFeatures.js";

const CANVAS_SIZE = 800;
const PLAYER_FEATURES = 7;
const OPPONENT_FEATURES = 6;
const STRATEGY_FEATURES = 13;
export const MAX_OBSTACLE_SLOTS = 5;
const OBSTACLE_FEATURES = 6;
const MAX_SIZE = 200;
const MAX_HP = 100;
const MAX_VELOCITY = 250;
const MAX_SWING_COOLDOWN_MS = 1000;
const MAX_BLOCK_ACTIVE_MS = 1500;
const MAX_BLOCK_COOLDOWN_MS = 1000;
const MAX_DASH_COOLDOWN_MS = 4500;

export function buildInputVector(payload) {
    const { playerModel, objects } = payload;
    const arenaWidth = payload.arenaWidth ?? CANVAS_SIZE;
    const arenaHeight = payload.arenaHeight ?? CANVAS_SIZE;
    const vector = new Float32Array(INPUT_SIZE);

    vector[0] = normalizeRotation(playerModel.rotation ?? 0);
    vector[1] = playerModel.swingAvailable ? 1 : 0;
    vector[2] = normalizeRemaining(playerModel.swingCooldownRemainingMs, MAX_SWING_COOLDOWN_MS);
    vector[3] = playerModel.blockAvailable ? 1 : 0;
    vector[4] = playerModel.blockActive ? 1 : 0;
    vector[5] = normalizeRemaining(playerModel.blockActiveRemainingMs, MAX_BLOCK_ACTIVE_MS);
    vector[6] = normalizeRemaining(playerModel.blockCooldownRemainingMs, MAX_BLOCK_COOLDOWN_MS);
    vector[13] = clamp((playerModel.hp ?? MAX_HP) / MAX_HP, 0, 1);
    vector[14] = normalizeEdgeDistance(playerModel, arenaWidth, arenaHeight);
    vector[15] = playerModel.dashAvailable ? 1 : 0;
    vector[16] = playerModel.dashActive ? 1 : 0;
    vector[17] = normalizeRemaining(playerModel.dashCooldownRemainingMs, MAX_DASH_COOLDOWN_MS);

    const opponent = objects?.find((obj) => obj.type === "opponentModel");
    if (opponent) {
        const dx = opponent.x - playerModel.x;
        const dy = opponent.y - playerModel.y;
        const relX = dx / CANVAS_SIZE;
        const relY = dy / CANVAS_SIZE;
        const bearingDegrees = Math.atan2(dy, dx) * 180 / Math.PI;
        const relativeBearing = normalizeAngleDelta(bearingDegrees - (playerModel.rotation ?? 0)) / 180;
        const sizeNorm = Math.min((opponent.size ?? 0) / MAX_SIZE, 1);
        const rotNorm = normalizeRotation(opponent.rotation ?? 0);
        const offset = PLAYER_FEATURES;

        vector[offset + 0] = relX;
        vector[offset + 1] = relY;
        vector[offset + 2] = relativeBearing;
        vector[offset + 3] = 1;
        vector[offset + 4] = sizeNorm;
        vector[offset + 5] = rotNorm;
        const velocityX = opponent.velocityX ?? 0;
        const velocityY = opponent.velocityY ?? 0;
        const distance = Math.hypot(dx, dy);
        const towardX = distance > 0.001 ? -dx / distance : 0;
        const towardY = distance > 0.001 ? -dy / distance : 0;
        const radialVelocity = velocityX * towardX + velocityY * towardY;

        vector[18] = clamp((opponent.hp ?? MAX_HP) / MAX_HP, 0, 1);
        vector[19] = normalizeEdgeDistance(opponent, arenaWidth, arenaHeight);
        vector[20] = opponent.swingActive ? 1 : 0;
        vector[21] = opponent.blockActive ? 1 : 0;
        vector[22] = clamp(velocityX / MAX_VELOCITY, -1, 1);
        vector[23] = clamp(velocityY / MAX_VELOCITY, -1, 1);
        vector[24] = clamp(radialVelocity / MAX_VELOCITY, -1, 1);
        vector[25] = clamp(distance / Math.hypot(arenaWidth, arenaHeight), 0, 1);
    }

    obstacleSlots(objects).forEach((obstacle, slotIndex) => {
        const offset = PLAYER_FEATURES + OPPONENT_FEATURES + STRATEGY_FEATURES + slotIndex * OBSTACLE_FEATURES;
        const dx = obstacle.x - playerModel.x;
        const dy = obstacle.y - playerModel.y;
        vector[offset] = 1;
        vector[offset + 1] = obstacle.type === "healthPack" ? 1 : 0;
        vector[offset + 2] = obstacle.type === "damageZone" ? 1 : 0;
        vector[offset + 3] = clamp(dx / arenaWidth, -1, 1);
        vector[offset + 4] = clamp(dy / arenaHeight, -1, 1);
        vector[offset + 5] = clamp(Math.hypot(dx, dy) / Math.hypot(arenaWidth, arenaHeight), 0, 1);
    });

    const intentFeatures = encodeIntentFeatures(payload.intent ?? DEFAULT_INTENT);
    vector.set(intentFeatures, INTENT_FEATURE_OFFSET);

    return vector;
}

export function obstacleSlots(objects = []) {
    return [...objects]
        .filter((obj) => obj?.type === "healthPack" || obj?.type === "damageZone")
        .sort((first, second) => String(first.id ?? "").localeCompare(String(second.id ?? "")))
        .slice(0, MAX_OBSTACLE_SLOTS);
}

function normalizeRotation(rotation) {
    return ((rotation % 360) + 360) % 360 / 360;
}

function normalizeAngleDelta(degrees) {
    return ((degrees + 540) % 360) - 180;
}

function normalizeRemaining(value, maxValue) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(value / maxValue, 1);
}

function normalizeEdgeDistance(entity, width, height) {
    const radius = (entity.size ?? 60) / 2;
    const distance = Math.max(0, Math.min(
        entity.x - radius,
        width - radius - entity.x,
        entity.y - radius,
        height - radius - entity.y
    ));
    return clamp(distance / (Math.min(width, height) / 2), 0, 1);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export const INPUT_SIZE = PLAYER_FEATURES + OPPONENT_FEATURES + STRATEGY_FEATURES
    + MAX_OBSTACLE_SLOTS * OBSTACLE_FEATURES
    + INTENT_FEATURE_SIZE;
export const INTENT_FEATURE_OFFSET = PLAYER_FEATURES + OPPONENT_FEATURES + STRATEGY_FEATURES
    + MAX_OBSTACLE_SLOTS * OBSTACLE_FEATURES;
