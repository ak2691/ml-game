import { useEffect, useState } from "react";
import PixiCanvas from "../beta/PixiCanvas";
import { PROJECTILE_WALL_LENGTH, PROJECTILE_WALL_TYPE } from "../beta/ArenaObjects";
import { decodeBotLoadout } from "../beta/loadout/BotLoadout";
import { DEFENSE_WALL_TYPE, ARENA_WIDTH_UNITS } from "../beta/modelPayloads/arenaConstants";
import { GUN_RANGE, MOVE_STATS } from "../beta/combat/Moves.js";

export default function SimulationReplay({ playback }) {
    const frames = playback.frames ?? [];
    const playbackStartMs = playback.playbackStartsAtMs
        ?? (playback.playbackStartsAt ? new Date(playback.playbackStartsAt).getTime() : null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const elapsedPlaybackMs = playbackStartMs == null ? 0 : Math.max(0, nowMs - playbackStartMs);
    const countdownRemainingMs = playbackStartMs == null ? 0 : Math.max(0, playbackStartMs - nowMs);
    const countdownNumber = Math.max(1, Math.ceil(countdownRemainingMs / 1000));
    const entranceProgress = countdownRemainingMs <= 0
        ? 1
        : Math.max(0, Math.min(1, 1 - countdownRemainingMs / 3000));
    const finalElapsedMs = frames.length === 0 ? 0 : frames[frames.length - 1].elapsedMs ?? 0;
    const displayElapsedMs = frames.length === 0 ? 0 : Math.min(elapsedPlaybackMs, finalElapsedMs);
    const frameIndex = frames.length === 0 ? 0 : frameIndexForElapsedMs(frames, displayElapsedMs);
    const activeFrame = frames[Math.min(frameIndex, Math.max(frames.length - 1, 0))];
    const initialFighters = playback.initialState?.fighters ?? [];
    const fighters = countdownRemainingMs > 0 ? initialFighters : activeFrame?.fighters ?? initialFighters;
    const obstacles = countdownRemainingMs > 0
        ? playback.initialState?.obstacles ?? []
        : activeFrame?.obstacles ?? playback.initialState?.obstacles ?? [];
    const winner = [...fighters, ...initialFighters].find((fighter) => String(fighter.userId) === String(playback.winnerUserId));
    const winnerName = winner?.username ?? "A fighter";
    const winnerHp = winner?.hp == null ? null : Math.max(0, Math.round(winner.hp));
    const hasReachedFinalFrame = frames.length === 0 || frameIndex >= Math.max(frames.length - 1, 0);
    const shouldRevealResult = Boolean(playback.result) && hasReachedFinalFrame;
    const resultTitle = shouldRevealResult
        ? playback.result === "FIGHTER_WIN" || playback.result === "WIN"
            ? `${winnerName} won the round${winnerHp == null ? "" : ` with ${winnerHp} HP`}`
            : playback.result === "DRAW" ? "Fight drawn"
                : playback.result === "RESIGNATION_WIN" ? "Won by resignation" : "Simulation failed"
        : hasReachedFinalFrame ? "Awaiting official result" : "Replay in progress";

    useEffect(() => {
        let animationFrameId = null;
        let timeoutId = null;
        let cancelled = false;
        const tick = () => {
            if (cancelled) return;
            setNowMs(Date.now());
            if (typeof requestAnimationFrame === "function" && !document.hidden) animationFrameId = requestAnimationFrame(tick);
            else timeoutId = setTimeout(tick, 250);
        };
        tick();
        return () => {
            cancelled = true;
            if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
            if (timeoutId != null) clearTimeout(timeoutId);
        };
    }, [playbackStartMs]);

    const activeElapsedMs = Number(activeFrame?.elapsedMs ?? 0);
    const recentFrames = frames.filter((frame) => Number(frame.elapsedMs ?? 0) >= activeElapsedMs - 200
        && Number(frame.elapsedMs ?? 0) < activeElapsedMs);
    const shapes = replayArenaShapes(fighters, obstacles, recentFrames, entranceProgress, frames, frameIndex);

    return <section className="flex min-h-[calc(100vh-52px)] flex-col items-center justify-center gap-5 px-6 py-5">
        <div className="text-center">
            <p className="font-mono text-xs tracking-[0.25em] text-cyan">{playback.rulesetVersion ?? "duel-v1"}</p>
            <h1 className="mt-2 text-2xl font-bold text-ink-white" aria-live="polite">
                {countdownRemainingMs > 0 ? `Simulation starts in ${countdownNumber}...` : resultTitle}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
                {countdownRemainingMs > 0 ? "Fighters entering the arena."
                    : shouldRevealResult ? playback.message
                        : hasReachedFinalFrame ? "Waiting for the server to publish the result."
                            : "Watching the submitted bot brains fight."}
            </p>
        </div>
        <PixiCanvas shapes={shapes} selectedId={null} onSelectShape={() => {}} onUpdateShape={() => {}}
            onDeselectAll={() => {}} editable={false} fillAvailable />
    </section>;
}

function replayArenaShapes(fighters, obstacles, recentFrames = [], entranceProgress = 1, frames = [], frameIndex = 0) {
    const recentlyDamagedIds = new Set();
    for (const frame of recentFrames) {
        for (const previous of [...(frame.fighters ?? []), ...(frame.obstacles ?? [])]) {
            const current = [...fighters, ...obstacles].find((candidate) => String(candidate.id ?? candidate.userId) === String(previous.id ?? previous.userId));
            if (current && Number(current.hp ?? 0) < Number(previous.hp ?? 0)) recentlyDamagedIds.add(String(current.id ?? current.userId));
        }
    }
    const fighterShapes = fighters.map((fighter) => fighterReplayShape(fighter, recentlyDamagedIds, entranceProgress, frames, frameIndex));
    const obstacleShapes = obstacles.map((obstacle) => ({
        ...obstacle,
        size: obstacle.size ?? 60,
        rotation: obstacle.rotation ?? 0,
        armed: obstacle.armed,
        fuseMs: obstacle.timerMs,
        remainingMs: obstacle.timerMs,
        captureBySlot: { 1: obstacle.slotOneCaptureMs ?? 0, 2: obstacle.slotTwoCaptureMs ?? 0 },
        locked: true,
        interpolationMs: 50,
        hitFlashMs: recentlyDamagedIds.has(String(obstacle.id)) ? 200 : 0,
    }));
    return [
        ...fighterShapes.map((fighter) => ({
            ...fighter,
            gunRayLength: fighter.gunShotActive ? replayGunRayLength(fighter, obstacleShapes) : undefined,
        })),
        ...obstacleShapes,
    ];
}

function fighterReplayShape(fighter, recentlyDamagedIds, entranceProgress, frames, frameIndex) {
    const isMain = Number(fighter.slot) === 1;
    const easedEntrance = 1 - Math.pow(1 - entranceProgress, 3);
    const entranceX = isMain ? -Number(fighter.size ?? 60) : ARENA_WIDTH_UNITS + Number(fighter.size ?? 60);
    const combatClass = fighter.combatClass ?? "melee";
    const abilities = Array.isArray(fighter.abilities) && fighter.abilities.length
        ? fighter.abilities
        : String(combatClass).startsWith("custom:") ? decodeBotLoadout(combatClass).abilities
            : combatClass === "ranged" ? ["fire_gun", "throw_grenade"]
                : combatClass === "mage" ? ["shoot_fireball", "stun"] : ["swing", "block", "dash"];
    const legacyAttackActive = Boolean(fighter.attackActive);
    const gunShotActive = fighter.gunShotActive ?? (legacyAttackActive && abilities.includes("fire_gun"));
    const swingActive = fighter.swingActive ?? (legacyAttackActive && abilities.includes("swing") && !gunShotActive);
    const fireballActive = fighter.fireballActive ?? (legacyAttackActive && abilities.includes("shoot_fireball"));
    const stunActive = fighter.stunActive ?? (legacyAttackActive && abilities.includes("stun") && !fireballActive);
    const visualOrigin = replayRayOrigin(fighter, frames, frameIndex);
    const replaySwingActiveMs = replayActiveTimer(fighter, frames, frameIndex, "swingActive", MOVE_STATS.swing.activeMs);
    return {
        ...fighter,
        x: entranceX + (Number(fighter.x ?? 0) - entranceX) * easedEntrance,
        id: isMain ? "main" : "opponent-model",
        type: isMain ? "circle" : "opponentModel",
        size: fighter.size ?? 60,
        combatClass,
        abilities,
        maxHp: Number(fighter.maxHp ?? 100),
        swingActiveMs: swingActive ? replaySwingActiveMs : 0,
        gunShotActive,
        gunActiveMs: visualOrigin.replayGunActiveMs ?? (gunShotActive ? 100 : 0),
        fireballActiveMs: fireballActive ? 100 : 0,
        fireballCharges: Number(fighter.fireballCharges ?? 0),
        fireballReloadMs: Number(fighter.fireballReloadMs ?? 0),
        swingCooldownMs: Number(fighter.swingCooldownMs ?? fighter.attackCooldownMs ?? 0),
        blockCharges: Number(fighter.blockCharges ?? 0),
        blockCooldownMs: Number(fighter.blockCooldownMs ?? 0),
        blockRechargeMs: Number(fighter.blockRechargeMs ?? 0),
        dashCooldownMs: Number(fighter.dashCooldownMs ?? 0),
        gunCooldownMs: Number(fighter.gunCooldownMs ?? 0),
        grenadeCooldownMs: Number(fighter.grenadeCooldownMs ?? 0),
        fireballCooldownMs: Number(fighter.fireballCooldownMs ?? 0),
        stunCooldownMs: Number(fighter.stunCooldownMs ?? 0),
        stunActiveMs: stunActive ? 100 : 0,
        stunCastActive: stunActive,
        dashActiveMs: fighter.dashActive ? 100 : 0,
        blockActiveMs: fighter.blockActive ? 100 : 0,
        locked: true,
        interpolationMs: entranceProgress < 1 ? 0 : 50,
        opponentUsername: fighter.username,
        hitFlashMs: recentlyDamagedIds.has(String(fighter.userId)) ? 200 : 0,
        ...visualOrigin,
    };
}

function replayActiveTimer(fighter, frames, frameIndex, activeField, durationMs) {
    if (!fighter?.[activeField]) return 0;
    const activation = firstActiveFighter(fighter, frames, frameIndex, (candidate) => candidate?.[activeField]);
    const currentElapsedMs = Number(frames[frameIndex]?.elapsedMs ?? activation.elapsedMs);
    return Math.max(0, Number(durationMs) - (currentElapsedMs - activation.elapsedMs));
}

function replayRayOrigin(fighter, frames, frameIndex) {
    if (fighter.gunShotActive) {
        const activation = firstActiveFighter(fighter, frames, frameIndex, (candidate) => candidate.gunShotActive);
        const currentElapsedMs = Number(frames[frameIndex]?.elapsedMs ?? activation.elapsedMs);
        return {
            gunRayOriginX: Number(activation.fighter.x ?? fighter.x),
            gunRayOriginY: Number(activation.fighter.y ?? fighter.y),
            gunRayRotation: Number(activation.fighter.rotation ?? fighter.rotation ?? 0),
            replayGunActiveMs: Math.max(0, 1000 - (currentElapsedMs - activation.elapsedMs)),
        };
    }
    const ability = ["pistol_shot", "concussive_shot", "rail_shot"]
        .find((id) => Number(fighter.abilityActiveMs?.[id] ?? 0) > 0);
    if (!ability) return {};
    const activation = firstActiveFighter(fighter, frames, frameIndex,
        (candidate) => Number(candidate.abilityActiveMs?.[ability] ?? 0) > 0);
    return {
        visualOriginX: Number(activation.fighter.x ?? fighter.x),
        visualOriginY: Number(activation.fighter.y ?? fighter.y),
        visualOriginRotation: Number(activation.fighter.rotation ?? fighter.rotation ?? 0),
    };
}

function firstActiveFighter(fighter, frames, frameIndex, isActive) {
    let activationFighter = fighter;
    let elapsedMs = Number(frames[frameIndex]?.elapsedMs ?? 0);
    for (let index = Math.min(frameIndex, frames.length - 1); index >= 0; index -= 1) {
        const candidate = (frames[index]?.fighters ?? []).find((entry) => String(entry.userId) === String(fighter.userId));
        if (!candidate || !isActive(candidate)) break;
        activationFighter = candidate;
        elapsedMs = Number(frames[index]?.elapsedMs ?? elapsedMs);
    }
    return { fighter: activationFighter, elapsedMs };
}

function replayGunRayLength(fighter, obstacles) {
    const originX = Number(fighter.gunRayOriginX ?? fighter.x);
    const originY = Number(fighter.gunRayOriginY ?? fighter.y);
    const radians = Number(fighter.gunRayRotation ?? fighter.rotation ?? 0) * Math.PI / 180;
    const directionX = Math.cos(radians);
    const directionY = Math.sin(radians);
    return obstacles.filter((wall) => wall.type === PROJECTILE_WALL_TYPE || wall.type === DEFENSE_WALL_TYPE)
        .reduce((nearest, wall) => {
            const wallRadians = Number(wall.rotation ?? 0) * Math.PI / 180;
            const half = Number(wall.size ?? PROJECTILE_WALL_LENGTH) / 2;
            const ax = wall.x - Math.cos(wallRadians) * half;
            const ay = wall.y - Math.sin(wallRadians) * half;
            const bx = wall.x + Math.cos(wallRadians) * half;
            const by = wall.y + Math.sin(wallRadians) * half;
            const segmentX = bx - ax;
            const segmentY = by - ay;
            const denominator = directionX * segmentY - directionY * segmentX;
            if (Math.abs(denominator) < 0.000001) return nearest;
            const offsetX = ax - originX;
            const offsetY = ay - originY;
            const distance = (offsetX * segmentY - offsetY * segmentX) / denominator;
            const segmentT = (offsetX * directionY - offsetY * directionX) / denominator;
            return distance >= 0 && distance <= GUN_RANGE && segmentT >= 0 && segmentT <= 1
                ? Math.min(nearest, distance) : nearest;
        }, GUN_RANGE);
}

function frameIndexForElapsedMs(frames, elapsedMs) {
    let selectedIndex = 0;
    for (let index = 0; index < frames.length; index += 1) {
        if ((frames[index].elapsedMs ?? 0) > elapsedMs) break;
        selectedIndex = index;
    }
    return selectedIndex;
}
