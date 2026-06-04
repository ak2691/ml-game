const tf = require("@tensorflow/tfjs");

const CANVAS_SIZE = 800;
const MAX_OBJECTS = 10;
const FEATURES = 6;
const MAX_DIST = Math.sqrt(2) * CANVAS_SIZE;
const MAX_SIZE = 200;
const TYPE_MAP = {
    circle: 0,
    square: 1,
    triangle: 2,
    opponentModel: 3,
};
const TYPE_COUNT = Object.keys(TYPE_MAP).length;
const STEP_MS = 100;
const MOVE_SPEED = 8;

function base64ToArrayBuffer(value) {
    const buffer = Buffer.from(value, "base64");
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadTfjsModel(modelArtifacts) {
    if (!modelArtifacts?.modelTopology || !Array.isArray(modelArtifacts.weightSpecs)) {
        throw new Error("model artifacts are missing modelTopology or weightSpecs");
    }

    return tf.loadLayersModel({
        load: async () => ({
            modelTopology: modelArtifacts.modelTopology,
            weightSpecs: modelArtifacts.weightSpecs,
            weightData: base64ToArrayBuffer(modelArtifacts.weightDataBase64 ?? ""),
        }),
    });
}

function buildInputVector(player, opponent) {
    const vector = new Float32Array(MAX_OBJECTS * FEATURES);
    const objects = [{
        type: "opponentModel",
        x: opponent.x,
        y: opponent.y,
        size: opponent.size,
        rotation: 0,
    }];

    objects
        .map((object) => {
            const dx = object.x - player.x;
            const dy = object.y - player.y;
            return { ...object, distSq: dx * dx + dy * dy };
        })
        .sort((a, b) => a.distSq - b.distSq)
        .slice(0, MAX_OBJECTS)
        .forEach((object, index) => {
            const offset = index * FEATURES;
            const absDist = Math.sqrt(object.distSq);
            const typeOrdinal = TYPE_MAP[object.type] ?? 0;
            vector[offset] = (object.x - player.x) / CANVAS_SIZE;
            vector[offset + 1] = (object.y - player.y) / CANVAS_SIZE;
            vector[offset + 2] = Math.min(absDist / MAX_DIST, 1);
            vector[offset + 3] = typeOrdinal / Math.max(TYPE_COUNT - 1, 1);
            vector[offset + 4] = Math.min(object.size / MAX_SIZE, 1);
            vector[offset + 5] = 0;
        });

    return vector;
}

function normalizeMove(dx, dy) {
    const mag = Math.hypot(dx, dy);
    if (!Number.isFinite(mag) || mag < 0.001) {
        return { dx: 0, dy: 0 };
    }

    return { dx: dx / mag, dy: dy / mag };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toPlacement(fighter) {
    return {
        userId: fighter.userId,
        username: fighter.username,
        role: fighter.role,
        slot: fighter.slot,
        x: Number(fighter.x.toFixed(3)),
        y: Number(fighter.y.toFixed(3)),
    };
}

function isTagged(chaser, runner, tagRadius) {
    return Math.hypot(chaser.x - runner.x, chaser.y - runner.y) <= tagRadius;
}

async function predictMove(model, player, opponent) {
    return tf.tidy(() => {
        const input = tf.tensor2d([buildInputVector(player, opponent)]);
        const output = model.predict(input);
        const [dx, dy] = output.dataSync();
        return normalizeMove(dx, dy);
    });
}

async function simulateTagMatch(request) {
    if (request?.rulesetVersion !== "tag-v1") {
        throw new Error("rulesetVersion must be tag-v1");
    }

    const fighters = (request.fighters ?? []).map((fighter) => ({ ...fighter }));
    const chaser = fighters.find((fighter) => fighter.role === "CHASER");
    const runner = fighters.find((fighter) => fighter.role === "RUNNER");

    if (!chaser || !runner || fighters.length !== 2) {
        throw new Error("tag-v1 requires exactly one CHASER and one RUNNER");
    }

    const models = new Map();
    try {
        for (const fighter of fighters) {
            models.set(fighter.userId, await loadTfjsModel(fighter.model));
        }

        const arena = {
            width: request.arena?.width ?? 800,
            height: request.arena?.height ?? 800,
            tagRadius: request.arena?.tagRadius ?? 60,
            durationMs: request.arena?.durationMs ?? 30000,
        };
        const frames = [];
        const initialState = {
            width: arena.width,
            height: arena.height,
            tagRadius: arena.tagRadius,
            fighters: fighters.map(toPlacement),
        };

        for (let elapsedMs = 0, tick = 0; elapsedMs <= arena.durationMs; elapsedMs += STEP_MS, tick++) {
            const chaserMove = await predictMove(models.get(chaser.userId), chaser, runner);
            const runnerMove = await predictMove(models.get(runner.userId), runner, chaser);

            for (const [fighter, move] of [[chaser, chaserMove], [runner, runnerMove]]) {
                const radius = (fighter.size ?? 60) / 2;
                fighter.x = clamp(fighter.x + move.dx * MOVE_SPEED, radius, arena.width - radius);
                fighter.y = clamp(fighter.y + move.dy * MOVE_SPEED, radius, arena.height - radius);
            }

            const tagged = isTagged(chaser, runner, arena.tagRadius);
            frames.push({
                tick,
                elapsedMs,
                fighters: fighters.map(toPlacement),
                tagged,
            });

            if (tagged) {
                return {
                    matchId: request.matchId,
                    rulesetVersion: "tag-v1",
                    status: "COMPLETED",
                    initialState,
                    frames,
                    result: "CHASER_WIN",
                    winnerUserId: chaser.userId,
                    winnerRole: "CHASER",
                    message: `${chaser.username} wins as chaser.`,
                };
            }
        }

        return {
            matchId: request.matchId,
            rulesetVersion: "tag-v1",
            status: "COMPLETED",
            initialState,
            frames,
            result: "RUNNER_WIN",
            winnerUserId: runner.userId,
            winnerRole: "RUNNER",
            message: `${runner.username} wins as runner by timeout.`,
        };
    } finally {
        for (const model of models.values()) {
            model.dispose();
        }
    }
}

module.exports = {
    simulateTagMatch,
    buildInputVector,
};
