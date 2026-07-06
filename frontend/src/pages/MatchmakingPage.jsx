import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BetaModel from "../beta/BetaModel";
import { COMBAT_CLASSES } from "../beta/classes/CombatClasses";
import { createMatchmakingClient } from "../matchmaking/stompClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
const ROUND_RESULT_HOLD_MS = 3500;
const CLASS_DETAILS = Object.freeze({
    melee: {
        summary: "Close-range fighter with dash, sword swings, and limited shield charges.",
        abilities: "Swing, block, dash",
        stats: "100 HP, 12 speed, 20 sword damage",
    },
    ranged: {
        summary: "Distance fighter with no dash or block, built around gun pressure and grenades.",
        abilities: "Fire gun, throw grenade",
        stats: "100 HP, 8 speed, 2-15 gun damage, 25-50 grenade damage",
    },
});

function secondsRemaining(countdownEndsAt) {
    if (!countdownEndsAt) return 0;
    return Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000));
}

async function estimateServerClockOffset() {
    try {
        const startedAtMs = Date.now();
        const response = await fetch(`${API_BASE_URL}/api/time`, {
            credentials: "include",
        });
        const receivedAtMs = Date.now();
        if (!response.ok) return null;

        const body = await response.json();
        const serverNowMs = new Date(body.serverNow).getTime();
        if (!Number.isFinite(serverNowMs)) return null;

        const roundTripMs = receivedAtMs - startedAtMs;
        const estimatedServerAtReceiveMs = serverNowMs + roundTripMs / 2;
        return estimatedServerAtReceiveMs - receivedAtMs;
    } catch {
        return null;
    }
}

function toLocalDeadlineMs(targetTime, serverNow, receivedAtMs, serverClockOffsetMs) {
    if (!targetTime) return null;

    const targetMs = new Date(targetTime).getTime();
    const serverNowMs = serverNow ? new Date(serverNow).getTime() : null;
    if (!Number.isFinite(targetMs)) return null;
    if (Number.isFinite(serverClockOffsetMs)) return targetMs - serverClockOffsetMs;
    if (!Number.isFinite(serverNowMs)) return targetMs;

    return receivedAtMs + (targetMs - serverNowMs);
}

function normalizeEventTimes(event, serverClockOffsetMs) {
    const receivedAtMs = Date.now();

    return {
        ...event,
        classSelectionEndsAtMs: toLocalDeadlineMs(
            event.classSelectionEndsAt,
            event.serverNow,
            receivedAtMs,
            serverClockOffsetMs
        ),
        countdownEndsAtMs: toLocalDeadlineMs(
            event.countdownEndsAt,
            event.serverNow,
            receivedAtMs,
            serverClockOffsetMs
        ),
        trainingEndsAtMs: toLocalDeadlineMs(
            event.trainingEndsAt,
            event.serverNow,
            receivedAtMs,
            serverClockOffsetMs
        ),
        playbackStartsAtMs: toLocalDeadlineMs(
            event.playbackStartsAt,
            event.serverNow,
            receivedAtMs,
            serverClockOffsetMs
        ),
        resultRevealsAtMs: toLocalDeadlineMs(
            event.resultRevealsAt,
            event.serverNow,
            receivedAtMs,
            serverClockOffsetMs
        ),
    };
}

export default function MatchmakingPage() {
    const navigate = useNavigate();
    const clientRef = useRef(null);
    const serverClockOffsetRef = useRef(null);
    const playbackRef = useRef(null);
    const roundReadyTimeoutRef = useRef(null);
    const [socketStatus, setSocketStatus] = useState("IDLE");
    const [queueStatus, setQueueStatus] = useState("CONNECTING");
    const [matchEvent, setMatchEvent] = useState(null);
    const [playback, setPlayback] = useState(null);
    const [remaining, setRemaining] = useState(0);
    const [hasFinished, setHasFinished] = useState(false);
    const [hasSurrendered, setHasSurrendered] = useState(false);
    const [classChoice, setClassChoice] = useState("melee");

    useEffect(() => {
        playbackRef.current = playback;
    }, [playback]);

    useEffect(() => {
        let cancelled = false;

        async function startMatchmakingClient() {
            serverClockOffsetRef.current = await estimateServerClockOffset();
            if (cancelled) return;

            const client = createMatchmakingClient({
                onStatus: setSocketStatus,
                onEvent: (rawEvent) => {
                    const event = normalizeEventTimes(rawEvent, serverClockOffsetRef.current);
                    if (event.type === "QUEUE_WAITING") {
                        setQueueStatus("WAITING");
                    }
                    if (event.type === "MATCH_FOUND") {
                        if (roundReadyTimeoutRef.current != null) {
                            clearTimeout(roundReadyTimeoutRef.current);
                            roundReadyTimeoutRef.current = null;
                        }
                        setMatchEvent(event);
                        setQueueStatus(event.status === "CLASS_SELECT" ? "CLASS_SELECT" : "COUNTDOWN");
                        setRemaining(secondsRemaining(
                            event.status === "CLASS_SELECT" ? event.classSelectionEndsAtMs : event.countdownEndsAtMs
                        ));
                        setClassChoice(event.player?.selectedClass ?? "melee");
                        playbackRef.current = null;
                        setPlayback(null);
                        setHasFinished(false);
                        setHasSurrendered(false);
                    }
                    if (event.type === "MATCH_CLASS_SELECTED") {
                        setMatchEvent(event);
                        setQueueStatus("CLASS_SELECT");
                        setRemaining(secondsRemaining(event.classSelectionEndsAtMs));
                        setClassChoice(event.player?.selectedClass ?? "melee");
                    }
                    if (event.type === "MATCH_COUNTDOWN_READY") {
                        setMatchEvent(event);
                        setQueueStatus("COUNTDOWN");
                        setRemaining(secondsRemaining(event.countdownEndsAtMs));
                        setClassChoice(event.player?.selectedClass ?? "melee");
                    }
                    if (event.type === "MATCH_ROUND_READY") {
                        const showNextRound = () => {
                            roundReadyTimeoutRef.current = null;
                            setMatchEvent(event);
                            playbackRef.current = null;
                            setPlayback(null);
                            setQueueStatus("COUNTDOWN");
                            setRemaining(secondsRemaining(event.countdownEndsAtMs));
                            setHasFinished(false);
                            setHasSurrendered(false);
                        };

                        if (playbackRef.current) {
                            if (roundReadyTimeoutRef.current != null) {
                                clearTimeout(roundReadyTimeoutRef.current);
                            }
                            roundReadyTimeoutRef.current = setTimeout(showNextRound, ROUND_RESULT_HOLD_MS);
                        } else {
                            showNextRound();
                        }
                    }
                    if (event.type === "PLAYER_FINISHED") {
                        setMatchEvent(event);
                        setQueueStatus(event.status);
                    }
                    if (event.type === "MATCH_PLAYBACK_READY") {
                        setMatchEvent(event);
                        const nextPlayback = {
                            ...event.playback,
                            playbackStartsAt: event.playbackStartsAt,
                            playbackStartsAtMs: event.playbackStartsAtMs,
                            resultRevealsAt: event.resultRevealsAt,
                            resultRevealsAtMs: event.resultRevealsAtMs,
                        };
                        playbackRef.current = nextPlayback;
                        setPlayback(nextPlayback);
                        setQueueStatus("PLAYBACK");
                    }
                    if (event.type === "MATCH_RESULT_READY") {
                        setMatchEvent(event);
                        setPlayback((currentPlayback) => {
                            const nextPlayback = {
                                ...(currentPlayback ?? {}),
                                playbackStartsAt: event.playbackStartsAt ?? currentPlayback?.playbackStartsAt,
                                playbackStartsAtMs: event.playbackStartsAtMs ?? currentPlayback?.playbackStartsAtMs,
                                resultRevealsAt: event.resultRevealsAt ?? currentPlayback?.resultRevealsAt,
                                resultRevealsAtMs: event.resultRevealsAtMs ?? currentPlayback?.resultRevealsAtMs,
                                status: event.playback?.status ?? currentPlayback?.status,
                                result: event.playback?.result ?? currentPlayback?.result,
                                winnerUserId: event.playback?.winnerUserId ?? currentPlayback?.winnerUserId,
                                message: event.playback?.message ?? event.message ?? currentPlayback?.message,
                            };
                            playbackRef.current = nextPlayback;
                            return nextPlayback;
                        });
                    }
                },
            });

            clientRef.current = client;
            client.connect();
        }

        startMatchmakingClient();

        return () => {
            cancelled = true;
            if (roundReadyTimeoutRef.current != null) {
                clearTimeout(roundReadyTimeoutRef.current);
                roundReadyTimeoutRef.current = null;
            }
            clientRef.current?.leaveQueue();
            clientRef.current?.disconnect();
        };
    }, []);

    useEffect(() => {
        if (socketStatus === "CONNECTED") {
            clientRef.current?.joinQueue();
        }
    }, [socketStatus]);

    useEffect(() => {
        const deadlineMs = queueStatus === "CLASS_SELECT"
            ? matchEvent?.classSelectionEndsAtMs
            : queueStatus === "COUNTDOWN"
                ? matchEvent?.countdownEndsAtMs
                : null;
        if (!deadlineMs) return;

        const interval = setInterval(() => {
            const nextRemaining = secondsRemaining(deadlineMs);
            setRemaining(nextRemaining);
            if (queueStatus === "COUNTDOWN" && nextRemaining === 0) {
                setQueueStatus("PREP");
            }
        }, 250);

        return () => clearInterval(interval);
    }, [matchEvent?.classSelectionEndsAtMs, matchEvent?.countdownEndsAtMs, queueStatus]);

    const finishMatch = (modelSubmissionId) => {
        setHasFinished(true);
        clientRef.current?.finish(modelSubmissionId);
    };

    const surrenderMatch = () => {
        setHasSurrendered(true);
        clientRef.current?.surrender();
    };

    const lockClass = () => {
        clientRef.current?.selectClass(classChoice);
    };

    const opponent = matchEvent?.opponent ?? null;
    const matchContext = useMemo(() => ({
        matchId: matchEvent?.matchId,
        simulationSeed: matchEvent?.simulationSeed,
        player: matchEvent?.player,
        opponent,
        players: matchEvent?.players ?? [],
        trainingEndsAt: matchEvent?.trainingEndsAt,
        trainingEndsAtMs: matchEvent?.trainingEndsAtMs,
        rulesetVersion: matchEvent?.rulesetVersion,
        roundNumber: matchEvent?.roundNumber,
        winsRequired: matchEvent?.winsRequired,
        obstacles: matchEvent?.obstacles ?? [],
        message: matchEvent?.message,
        status: matchEvent?.status,
    }), [
        matchEvent?.matchId,
        matchEvent?.simulationSeed,
        matchEvent?.player,
        opponent,
        matchEvent?.players,
        matchEvent?.trainingEndsAt,
        matchEvent?.trainingEndsAtMs,
        matchEvent?.rulesetVersion,
        matchEvent?.roundNumber,
        matchEvent?.winsRequired,
        matchEvent?.obstacles,
        matchEvent?.message,
        matchEvent?.status,
    ]);

    if (playback) {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={() => navigate("/home")} socketStatus={socketStatus} />
                <DuelPlayback playback={playback} />
            </main>
        );
    }

    if (queueStatus === "CLASS_SELECT") {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={() => navigate("/home")} socketStatus={socketStatus} />
                <ClassSelectScreen
                    selectedClass={classChoice}
                    onSelectClass={setClassChoice}
                    onLockClass={lockClass}
                    player={matchEvent?.player}
                    opponent={opponent}
                    remaining={remaining}
                />
            </main>
        );
    }

    if (queueStatus === "PREP" || queueStatus === "WAITING_FOR_FINISH" || queueStatus === "READY_FOR_PLAYBACK") {
        return (
            <BetaModel
                matchContext={matchContext}
                finishStatus={hasSurrendered ? "SURRENDERED" : hasFinished ? "FINISHED" : "TRAINING"}
                onFinishMatch={finishMatch}
                onSurrenderMatch={surrenderMatch}
            />
        );
    }

    return (
        <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
            <MatchHeader onExit={() => navigate("/home")} socketStatus={socketStatus} />
            <section className="relative flex min-h-[calc(100vh-52px)] items-center justify-center px-6">
                {queueStatus === "COUNTDOWN" ? (
                    <div className="text-center">
                        <p className="mb-3 font-mono text-xs tracking-[0.25em] text-cyan">MATCH FOUND</p>
                        <div className="font-mono text-8xl font-bold text-ink-white">{remaining}</div>
                        <p className="mt-4 text-sm text-ink-muted">
                            Opponent: <span className="text-ink-white">{opponent?.username ?? "unknown"}</span>
                        </p>
                        {matchEvent?.roundNumber && (
                            <p className="mt-2 font-mono text-xs tracking-widest text-ink-muted">
                                ROUND {matchEvent.roundNumber} · BEST OF {Math.max(1, (matchEvent.winsRequired ?? 1) * 2 - 1)}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="w-full max-w-[520px] border border-border-lo bg-arena-panel p-6">
                        <p className="font-mono text-xs tracking-[0.25em] text-cyan">CASUAL QUEUE</p>
                        <h1 className="mt-3 text-2xl font-bold text-ink-white">Finding another player</h1>
                        <p className="mt-3 text-sm leading-6 text-ink-muted">
                            The first multiplayer pass uses random matching so the real-time lifecycle can be tested before Elo and validation rules are added.
                        </p>
                        <div className="mt-5 font-mono text-xs tracking-widest text-ink-muted">
                            {queueStatus === "WAITING" ? "WAITING FOR OPPONENT" : "CONNECTING TO MATCHMAKING"}
                        </div>
                    </div>
                )}
            </section>
        </main>
    );
}

function ClassSelectScreen({ selectedClass, onSelectClass, onLockClass, player, opponent, remaining }) {
    const playerLocked = Boolean(player?.classSelected);
    const opponentLocked = Boolean(opponent?.classSelected);

    return (
        <section className="flex min-h-[calc(100vh-52px)] items-center justify-center px-6 py-8">
            <div className="w-full max-w-[860px]">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="font-mono text-xs tracking-[0.25em] text-cyan">CLASS SELECT</p>
                        <h1 className="mt-3 text-3xl font-bold text-ink-white">Choose your fighter</h1>
                    </div>
                    <div className="font-mono text-5xl font-bold text-ink-white">{remaining}</div>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {Object.values(COMBAT_CLASSES).map((combatClass) => {
                        const details = CLASS_DETAILS[combatClass.id] ?? CLASS_DETAILS.melee;
                        const active = selectedClass === combatClass.id;
                        return (
                            <button
                                key={combatClass.id}
                                type="button"
                                onClick={() => !playerLocked && onSelectClass(combatClass.id)}
                                disabled={playerLocked}
                                className={`min-h-[220px] rounded border p-5 text-left transition ${active
                                    ? "border-cyan bg-cyan-950/30 text-ink-white"
                                    : "border-border-lo bg-arena-panel text-ink-muted hover:border-border-hi hover:text-ink-white"} disabled:cursor-not-allowed`}
                            >
                                <div className="flex items-center justify-between font-mono text-xs tracking-widest">
                                    <span>{combatClass.label}</span>
                                    <span>{active ? "SELECTED" : "AVAILABLE"}</span>
                                </div>
                                <p className="mt-4 text-sm leading-6">{details.summary}</p>
                                <dl className="mt-5 space-y-3 font-mono text-[10px] tracking-widest">
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-ink-muted">ABILITIES</dt>
                                        <dd className="text-right text-ink-white">{details.abilities}</dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-ink-muted">STATS</dt>
                                        <dd className="text-right text-ink-white">{details.stats}</dd>
                                    </div>
                                </dl>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-border-lo bg-arena-panel p-4">
                    <div className="font-mono text-[10px] tracking-widest text-ink-muted">
                        YOU: <span className={playerLocked ? "text-green-300" : "text-amber-200"}>{playerLocked ? "LOCKED" : "CHOOSING"}</span>
                        <span className="mx-3 text-border-hi">/</span>
                        {opponent?.username ?? "OPP"}: <span className={opponentLocked ? "text-green-300" : "text-amber-200"}>{opponentLocked ? "LOCKED" : "CHOOSING"}</span>
                    </div>
                    <button
                        type="button"
                        onClick={onLockClass}
                        disabled={playerLocked}
                        className="h-10 rounded border border-green-700/60 bg-green-900/30 px-5 font-mono text-[11px] font-bold tracking-widest text-green-200 hover:bg-green-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {playerLocked ? "CLASS LOCKED" : `LOCK ${selectedClass.toUpperCase()}`}
                    </button>
                </div>
            </div>
        </section>
    );
}

function MatchHeader({ onExit, socketStatus }) {
    return (
        <header className="flex h-[52px] items-center justify-between border-b border-border-lo bg-arena-panel px-6">
            <div className="flex items-center gap-3">
                <span className="text-xl leading-none text-cyan">M</span>
                <span className="text-lg font-bold tracking-[0.15em] text-ink-white">MACHINER</span>
            </div>
            <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] tracking-widest text-ink-muted">{socketStatus}</span>
                <button
                    onClick={onExit}
                    className="rounded border border-border-lo bg-zinc-900 px-3 py-1 text-xs font-bold text-ink-muted hover:text-ink-white"
                >
                    EXIT
                </button>
            </div>
        </header>
    );
}

function frameIndexForElapsedMs(frames, elapsedMs) {
    if (frames.length === 0) return 0;

    let selectedIndex = 0;
    for (let index = 0; index < frames.length; index++) {
        if ((frames[index].elapsedMs ?? 0) > elapsedMs) {
            break;
        }
        selectedIndex = index;
    }

    return selectedIndex;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function PlaybackFighter({ fighter, arenaWidth, arenaHeight }) {
    const isFirstSlot = fighter.slot === 1;
    const isRanged = fighter.combatClass === "ranged";
    const hpPercent = clamp(fighter.hp ?? 100, 0, 100);
    const ammo = Math.max(0, Math.min(10, Number(fighter.gunAmmo ?? 10)));
    const reloadMs = Math.max(0, Number(fighter.gunReloadMs ?? 0));
    const bodyClasses = isFirstSlot
        ? "border-cyan bg-cyan/10 text-cyan"
        : "border-fuchsia-400 bg-fuchsia-500/10 text-fuchsia-200";
    const weaponClasses = fighter.attackActive
        ? "border-red-200 bg-red-300/60 shadow-[0_0_14px_rgba(248,113,113,0.65)]"
        : "border-zinc-200/70 bg-zinc-300/35";

    return (
        <div
            className="absolute h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 font-mono text-sm font-bold"
            style={{
                left: `${(fighter.x / arenaWidth) * 100}%`,
                top: `${(fighter.y / arenaHeight) * 100}%`,
            }}
            aria-label={`${fighter.username}, ${Math.round(fighter.hp ?? 100)} health`}
        >
            <div className="absolute -top-4 left-1/2 h-1.5 w-16 -translate-x-1/2 overflow-hidden rounded bg-zinc-800 ring-1 ring-zinc-700">
                <div className="h-full bg-lime" style={{ width: `${hpPercent}%` }} />
            </div>
            {isRanged && (
                <div className="absolute -top-10 left-1/2 flex min-w-16 -translate-x-1/2 items-center justify-center gap-1 rounded border border-amber-800/70 bg-zinc-950/90 px-1.5 py-0.5 text-[9px] text-amber-200">
                    <span>{ammo}/10</span>
                    {reloadMs > 0 && <span className="text-amber-400">R</span>}
                </div>
            )}
            <div
                className="absolute inset-0"
                style={{ transform: `rotate(${fighter.rotation ?? 0}deg)` }}
            >
                <div className={`absolute inset-0 rounded-full border-2 ${bodyClasses}`} />
                {isRanged ? (
                    <>
                        <div className="absolute left-1/2 top-1/2 h-2.5 w-12 -translate-y-1/2 rounded-sm border border-amber-100 bg-amber-300/65 shadow-[0_0_10px_rgba(251,191,36,0.42)]" />
                        {fighter.attackActive && (
                            <div
                                className="absolute left-[84px] top-1/2 h-0.5 -translate-y-1/2 bg-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.65)]"
                                style={{ width: "min(70vw, 542px)" }}
                            />
                        )}
                    </>
                ) : (
                    <div
                        className={`absolute left-1/2 top-1/2 h-2 rounded-sm border ${weaponClasses}`}
                        style={{
                            width: fighter.attackActive ? 58 : 48,
                            transformOrigin: "0 50%",
                            transform: `translateY(-50%) rotate(${fighter.attackActive ? -25 : 0}deg)`,
                        }}
                    />
                )}
                {fighter.blockActive && (
                    <div className="absolute left-[58px] top-1/2 h-12 w-3 -translate-y-1/2 rounded border border-blue-200 bg-blue-300/40 shadow-[0_0_14px_rgba(96,165,250,0.6)]" />
                )}
            </div>
            <span className={`absolute inset-0 flex items-center justify-center ${isFirstSlot ? "text-cyan" : "text-fuchsia-200"}`}>
                {fighter.slot}
            </span>
            <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-ink-white">
                {fighter.username} · {Math.round(fighter.hp ?? 100)} HP
            </span>
        </div>
    );
}

function PlaybackObstacle({ obstacle, arenaWidth, arenaHeight }) {
    const size = obstacle.size ?? (obstacle.type === "healthPack" ? 42 : obstacle.type === "grenade" ? 12 : 128);
    const left = `${(obstacle.x / arenaWidth) * 100}%`;
    const top = `${(obstacle.y / arenaHeight) * 100}%`;
    const dimension = `${(size / arenaWidth) * 100}%`;

    if (obstacle.type === "healthPack") {
        return (
            <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-300 bg-emerald-500/15 shadow-[0_0_14px_rgba(16,185,129,0.28)]"
                style={{ left, top, width: dimension, aspectRatio: "1 / 1" }}
            >
                <div className="absolute left-1/2 top-1/2 h-[58%] w-[18%] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-emerald-200" />
                <div className="absolute left-1/2 top-1/2 h-[18%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-emerald-200" />
            </div>
        );
    }

    if (obstacle.type === "grenade") {
        return (
            <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-lime-100 bg-lime-300 shadow-[0_0_10px_rgba(190,242,100,0.45)]"
                style={{ left, top, width: dimension, aspectRatio: "1 / 1" }}
            />
        );
    }

    if (obstacle.type === "grenadeExplosion") {
        return (
            <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-orange-200 bg-orange-400/25 shadow-[0_0_24px_rgba(251,146,60,0.6)]"
                style={{ left, top, width: dimension, aspectRatio: "1 / 1" }}
            />
        );
    }

    return (
        <div
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-400 bg-red-500/14 shadow-[inset_0_0_24px_rgba(248,113,113,0.2)]"
            style={{ left, top, width: dimension, aspectRatio: "1 / 1" }}
        />
    );
}

function DuelPlayback({ playback }) {
    const frames = playback.frames ?? [];
    const playbackStartMs = playback.playbackStartsAtMs
        ?? (playback.playbackStartsAt ? new Date(playback.playbackStartsAt).getTime() : null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const elapsedPlaybackMs = playbackStartMs == null
        ? 0
        : Math.max(0, nowMs - playbackStartMs);
    const finalElapsedMs = frames.length === 0
        ? 0
        : frames[frames.length - 1].elapsedMs ?? 0;
    const displayElapsedMs = frames.length === 0
        ? 0
        : Math.min(elapsedPlaybackMs, finalElapsedMs);
    const frameIndex = frames.length === 0
        ? 0
        : frameIndexForElapsedMs(frames, displayElapsedMs);
    const activeFrame = frames[Math.min(frameIndex, Math.max(frames.length - 1, 0))];
    const fallbackFighters = playback.initialState?.fighters ?? [];
    const fighters = activeFrame?.fighters ?? fallbackFighters;
    const winner = [...fighters, ...fallbackFighters].find((fighter) =>
        String(fighter.userId) === String(playback.winnerUserId));
    const winnerName = winner?.username ?? "A fighter";
    const winnerHp = winner?.hp == null ? null : Math.max(0, Math.round(winner.hp));
    const obstacles = activeFrame?.obstacles ?? playback.initialState?.obstacles ?? [];
    const arenaWidth = playback.initialState?.width ?? 800;
    const arenaHeight = playback.initialState?.height ?? 800;
    const lastFrameIndex = Math.max(frames.length - 1, 0);
    const hasReachedFinalFrame = frames.length === 0 || frameIndex >= lastFrameIndex;
    const hasOfficialResult = Boolean(playback.result);
    const shouldRevealResult = hasOfficialResult && hasReachedFinalFrame;
    const resultTitle = shouldRevealResult
        ? playback.result === "FIGHTER_WIN"
            ? `${winnerName} won the round${winnerHp == null ? "" : ` with ${winnerHp} HP`}`
            : playback.result === "DRAW"
                ? "Fight drawn"
                : playback.result === "RESIGNATION_WIN"
                    ? "Won by resignation"
                    : "Simulation failed"
        : hasReachedFinalFrame
            ? "Awaiting official result"
            : "Replay in progress";

    useEffect(() => {
        let animationFrameId = null;
        let timeoutId = null;
        let cancelled = false;

        const tick = () => {
            if (cancelled) return;
            setNowMs(Date.now());

            if (typeof requestAnimationFrame === "function" && !document.hidden) {
                animationFrameId = requestAnimationFrame(tick);
            } else {
                timeoutId = setTimeout(tick, 250);
            }
        };

        tick();

        return () => {
            cancelled = true;
            if (animationFrameId != null) {
                cancelAnimationFrame(animationFrameId);
            }
            if (timeoutId != null) {
                clearTimeout(timeoutId);
            }
        };
    }, [playbackStartMs]);

    return (
        <section className="flex min-h-[calc(100vh-52px)] flex-col items-center justify-center gap-5 px-6 py-5">
            <div className="text-center">
                <p className="font-mono text-xs tracking-[0.25em] text-cyan">{playback.rulesetVersion ?? "duel-v1"}</p>
                <h1 className="mt-2 text-2xl font-bold text-ink-white">
                    {resultTitle}
                </h1>
                <p className="mt-2 text-sm text-ink-muted">
                    {shouldRevealResult
                        ? playback.message
                        : hasReachedFinalFrame
                            ? "Waiting for the server to publish the result."
                            : "Watching the submitted bot brains fight."}
                </p>
            </div>
            <div
                className="relative h-[min(calc(100vh-210px),800px)] w-[min(calc(100vw-48px),800px)] overflow-hidden rounded border border-border-mid bg-[#0d1117]"
                style={{ aspectRatio: `${arenaWidth} / ${arenaHeight}` }}
            >
                <div className="absolute inset-0 canvas-grid-bg opacity-60" />
                {obstacles.map((obstacle) => (
                    <PlaybackObstacle
                        key={obstacle.id}
                        obstacle={obstacle}
                        arenaWidth={arenaWidth}
                        arenaHeight={arenaHeight}
                    />
                ))}
                {fighters.map((fighter) => (
                    <PlaybackFighter
                        key={fighter.userId}
                        fighter={fighter}
                        arenaWidth={arenaWidth}
                        arenaHeight={arenaHeight}
                    />
                ))}
            </div>
        </section>
    );
}
