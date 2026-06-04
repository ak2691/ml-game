import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BetaModel from "../beta/BetaModel";
import { createMatchmakingClient } from "../matchmaking/stompClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

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
    const [socketStatus, setSocketStatus] = useState("IDLE");
    const [queueStatus, setQueueStatus] = useState("CONNECTING");
    const [matchEvent, setMatchEvent] = useState(null);
    const [playback, setPlayback] = useState(null);
    const [remaining, setRemaining] = useState(0);
    const [hasFinished, setHasFinished] = useState(false);
    const [hasSurrendered, setHasSurrendered] = useState(false);

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
                        setMatchEvent(event);
                        setQueueStatus("COUNTDOWN");
                        setRemaining(secondsRemaining(event.countdownEndsAtMs));
                    }
                    if (event.type === "PLAYER_FINISHED") {
                        setMatchEvent(event);
                        setQueueStatus(event.status);
                    }
                    if (event.type === "MATCH_PLAYBACK_READY") {
                        setMatchEvent(event);
                        setPlayback({
                            ...event.playback,
                            playbackStartsAt: event.playbackStartsAt,
                            playbackStartsAtMs: event.playbackStartsAtMs,
                            resultRevealsAt: event.resultRevealsAt,
                            resultRevealsAtMs: event.resultRevealsAtMs,
                        });
                        setQueueStatus("PLAYBACK");
                    }
                    if (event.type === "MATCH_RESULT_READY") {
                        setMatchEvent(event);
                        setPlayback((currentPlayback) => ({
                            ...(currentPlayback ?? {}),
                            playbackStartsAt: event.playbackStartsAt ?? currentPlayback?.playbackStartsAt,
                            playbackStartsAtMs: event.playbackStartsAtMs ?? currentPlayback?.playbackStartsAtMs,
                            resultRevealsAt: event.resultRevealsAt ?? currentPlayback?.resultRevealsAt,
                            resultRevealsAtMs: event.resultRevealsAtMs ?? currentPlayback?.resultRevealsAtMs,
                            status: event.playback?.status ?? currentPlayback?.status,
                            result: event.playback?.result ?? currentPlayback?.result,
                            winnerUserId: event.playback?.winnerUserId ?? currentPlayback?.winnerUserId,
                            winnerRole: event.playback?.winnerRole ?? currentPlayback?.winnerRole,
                            message: event.playback?.message ?? event.message ?? currentPlayback?.message,
                        }));
                    }
                },
            });

            clientRef.current = client;
            client.connect();
        }

        startMatchmakingClient();

        return () => {
            cancelled = true;
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

    const opponent = matchEvent?.opponent ?? null;
    const matchContext = useMemo(() => ({
        matchId: matchEvent?.matchId,
        player: matchEvent?.player,
        opponent,
        trainingEndsAt: matchEvent?.trainingEndsAt,
        trainingEndsAtMs: matchEvent?.trainingEndsAtMs,
        rulesetVersion: matchEvent?.rulesetVersion,
        message: matchEvent?.message,
        status: matchEvent?.status,
    }), [
        matchEvent?.matchId,
        matchEvent?.player,
        opponent,
        matchEvent?.trainingEndsAt,
        matchEvent?.trainingEndsAtMs,
        matchEvent?.rulesetVersion,
        matchEvent?.message,
        matchEvent?.status,
    ]);

    if (playback) {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={() => navigate("/home")} socketStatus={socketStatus} />
                <TagPlayback playback={playback} />
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
                        {matchEvent?.player?.role && (
                            <p className="mt-2 font-mono text-xs tracking-widest text-cyan">
                                ROLE: {matchEvent.player.role}
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

function interpolateNumber(start, end, progress) {
    return start + (end - start) * progress;
}

function interpolateFighters(currentFrame, nextFrame, elapsedMs, fallbackFighters) {
    const currentFighters = currentFrame?.fighters ?? fallbackFighters;
    if (!currentFrame || !nextFrame) return currentFighters;

    const startMs = currentFrame.elapsedMs ?? 0;
    const endMs = nextFrame.elapsedMs ?? startMs;
    const progress = endMs === startMs
        ? 0
        : clamp((elapsedMs - startMs) / (endMs - startMs), 0, 1);
    const nextByUserId = new Map((nextFrame.fighters ?? []).map((fighter) => [fighter.userId, fighter]));

    return currentFighters.map((fighter) => {
        const nextFighter = nextByUserId.get(fighter.userId);
        if (!nextFighter) return fighter;

        return {
            ...fighter,
            x: interpolateNumber(fighter.x, nextFighter.x, progress),
            y: interpolateNumber(fighter.y, nextFighter.y, progress),
        };
    });
}

function TagPlayback({ playback }) {
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
    const nextFrame = frames[Math.min(frameIndex + 1, Math.max(frames.length - 1, 0))];
    const fallbackFighters = playback.initialState?.fighters ?? [];
    const fighters = interpolateFighters(activeFrame, nextFrame, displayElapsedMs, fallbackFighters);
    const arenaWidth = playback.initialState?.width ?? 800;
    const arenaHeight = playback.initialState?.height ?? 800;
    const lastFrameIndex = Math.max(frames.length - 1, 0);
    const hasReachedFinalFrame = frames.length === 0 || frameIndex >= lastFrameIndex;
    const taggedFrame = frames.find((frame) => frame.tagged === true);
    const hasShownTag = taggedFrame
        ? displayElapsedMs >= (taggedFrame.elapsedMs ?? 0)
        : activeFrame?.tagged === true;
    const hasOfficialResult = Boolean(playback.result);
    const shouldRevealResult = hasOfficialResult && (playback.result === "CHASER_WIN"
        ? hasShownTag
        : hasReachedFinalFrame);
    const resultTitle = shouldRevealResult
        ? playback.result === "CHASER_WIN"
            ? "Chaser wins by tag"
            : playback.result === "RUNNER_WIN"
                ? "Runner wins by timeout"
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
                <p className="font-mono text-xs tracking-[0.25em] text-cyan">{playback.rulesetVersion ?? "tag-v1"}</p>
                <h1 className="mt-2 text-2xl font-bold text-ink-white">
                    {resultTitle}
                </h1>
                <p className="mt-2 text-sm text-ink-muted">
                    {shouldRevealResult
                        ? playback.message
                        : hasReachedFinalFrame
                            ? "Waiting for the server to publish the result."
                            : "Watching the submitted models run the tag simulation."}
                </p>
            </div>
            <div
                className="relative h-[min(72vw,620px)] w-[min(92vw,620px)] overflow-hidden rounded border border-border-mid bg-[#0d1117]"
                style={{ aspectRatio: `${arenaWidth} / ${arenaHeight}` }}
            >
                <div className="absolute inset-0 canvas-grid-bg opacity-60" />
                {fighters.map((fighter) => (
                    <div
                        key={fighter.userId}
                        className={`absolute flex h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 font-mono text-sm font-bold ${fighter.slot === 1
                            ? "border-cyan bg-cyan/10 text-cyan"
                            : "border-fuchsia-400 bg-fuchsia-500/10 text-fuchsia-200"
                            }`}
                        style={{
                            left: `${(fighter.x / arenaWidth) * 100}%`,
                            top: `${(fighter.y / arenaHeight) * 100}%`,
                        }}
                    >
                        {fighter.role === "CHASER" ? "C" : "R"}
                    </div>
                ))}
            </div>
            <p className="font-mono text-xs tracking-widest text-ink-muted">
                {`${(displayElapsedMs / 1000).toFixed(1)}s`}
            </p>
        </section>
    );
}
