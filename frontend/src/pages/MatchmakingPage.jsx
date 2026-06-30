import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BetaModel from "../beta/BetaModel";
import { createMatchmakingClient } from "../matchmaking/stompClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
const ROUND_RESULT_HOLD_MS = 3500;

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
    const [probeRequest, setProbeRequest] = useState(null);
    const [remaining, setRemaining] = useState(0);
    const [hasFinished, setHasFinished] = useState(false);
    const [hasSurrendered, setHasSurrendered] = useState(false);

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
                    if (event.type === "MODEL_PROBE_REQUEST") {
                        setProbeRequest(event.probe);
                        return;
                    }
                    if (event.type === "QUEUE_WAITING") {
                        setQueueStatus("WAITING");
                    }
                    if (event.type === "MATCH_FOUND") {
                        if (roundReadyTimeoutRef.current != null) {
                            clearTimeout(roundReadyTimeoutRef.current);
                            roundReadyTimeoutRef.current = null;
                        }
                        setMatchEvent(event);
                        setQueueStatus("COUNTDOWN");
                        setRemaining(secondsRemaining(event.countdownEndsAtMs));
                        playbackRef.current = null;
                        setPlayback(null);
                        setHasFinished(false);
                        setHasSurrendered(false);
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
        if (!matchEvent?.countdownEndsAtMs || queueStatus !== "COUNTDOWN") return;

        const interval = setInterval(() => {
            const nextRemaining = secondsRemaining(matchEvent.countdownEndsAtMs);
            setRemaining(nextRemaining);
            if (nextRemaining === 0) {
                setQueueStatus("PREP");
            }
        }, 250);

        return () => clearInterval(interval);
    }, [matchEvent?.countdownEndsAtMs, queueStatus]);

    const finishMatch = (modelSubmissionId) => {
        setHasFinished(true);
        clientRef.current?.finish(modelSubmissionId);
    };

    const surrenderMatch = () => {
        setHasSurrendered(true);
        clientRef.current?.surrender();
    };

    const respondToProbe = useCallback((response) => {
        clientRef.current?.sendProbeResponse(response);
    }, []);

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
        message: matchEvent?.message,
        status: matchEvent?.status,
        probeRequest,
        onProbeResponse: respondToProbe,
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
        matchEvent?.message,
        matchEvent?.status,
        probeRequest,
        respondToProbe,
    ]);

    if (playback) {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={() => navigate("/home")} socketStatus={socketStatus} />
                <DuelPlayback playback={playback} />
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
    const hpPercent = clamp(fighter.hp ?? 100, 0, 100);
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
            <div
                className="absolute inset-0"
                style={{ transform: `rotate(${fighter.rotation ?? 0}deg)` }}
            >
                <div className={`absolute inset-0 rounded-full border-2 ${bodyClasses}`} />
                <div
                    className={`absolute left-1/2 top-1/2 h-2 rounded-sm border ${weaponClasses}`}
                    style={{
                        width: fighter.attackActive ? 58 : 48,
                        transformOrigin: "0 50%",
                        transform: `translateY(-50%) rotate(${fighter.attackActive ? -25 : 0}deg)`,
                    }}
                />
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
    const size = obstacle.size ?? (obstacle.type === "healthPack" ? 42 : 128);
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
    const obstacles = activeFrame?.obstacles ?? playback.initialState?.obstacles ?? [];
    const arenaWidth = playback.initialState?.width ?? 800;
    const arenaHeight = playback.initialState?.height ?? 800;
    const lastFrameIndex = Math.max(frames.length - 1, 0);
    const hasReachedFinalFrame = frames.length === 0 || frameIndex >= lastFrameIndex;
    const hasOfficialResult = Boolean(playback.result);
    const shouldRevealResult = hasOfficialResult && hasReachedFinalFrame;
    const resultTitle = shouldRevealResult
        ? playback.result === "FIGHTER_WIN"
            ? `${winnerName} won the round`
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
        <section className="flex min-h-[calc(100vh-52px)] flex-col items-center justify-center gap-5 px-6">
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
                            : "Watching the submitted models fight."}
                </p>
            </div>
            <div
                className="relative h-[min(72vw,620px)] w-[min(92vw,620px)] overflow-hidden rounded border border-border-mid bg-[#0d1117]"
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
