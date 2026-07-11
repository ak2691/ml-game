import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BetaModel from "../beta/BetaModel";
import Canvas from "../beta/Canvas";
import {
    BOUNCY_WALL_MAX_USES,
    BOUNCY_WALL_TYPE,
    BARRIER_TYPE,
    BUFF_PICKUP_SIZE,
    CENTER_OBJECTIVE_SIZE,
    COMMAND_LOCK_TYPE,
    INHIBITION_TYPE,
    OVERDRIVE_TYPE,
    PROJECTILE_WALL_LENGTH,
    PROJECTILE_WALL_THICKNESS,
    PROJECTILE_WALL_TYPE,
    RADAR_JAMMER_TYPE,
} from "../beta/ArenaObjects";
import { COMBAT_CLASSES } from "../beta/classes/CombatClasses";
import {
    CANVAS_SIZE,
    DISPLAY_ARENA_MAX_SIZE,
    DUEL_SLOT_ONE_X,
    DUEL_SLOT_ONE_Y,
    DUEL_SLOT_TWO_X,
    DUEL_SLOT_TWO_Y,
    HEALTH_PACK_SIZE,
    PLAYER_OBJECT_PLACEMENT_LIMIT,
} from "../beta/modelPayloads/arenaConstants";
import { MAIN_SHAPE } from "../beta/modelPayloads/arenaShapes";
import { objectDisplayName } from "../beta/objectLabels";
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
    mage: {
        summary: "Mid-speed caster that pressures space with fireballs and burn damage.",
        abilities: "Shoot fireball",
        stats: "100 HP, 10 speed, 15 fireball damage, 5s burn",
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
        objectPlacementEndsAtMs: toLocalDeadlineMs(
            event.objectPlacementEndsAt,
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

function shouldApplyObjectPlacementEvent(event, currentStatus, currentEvent) {
    if (event.type !== "PLAYER_OBJECTS_PLACED") return false;
    if (event.status !== "OBJECT_PLACEMENT" || currentStatus !== "OBJECT_PLACEMENT") return false;
    if (currentEvent?.matchId && event.matchId && event.matchId !== currentEvent.matchId) return false;
    const currentRound = Number(currentEvent?.roundNumber ?? 1);
    const eventRound = Number(event.roundNumber ?? currentRound);
    if (Number.isFinite(currentRound) && Number.isFinite(eventRound) && eventRound < currentRound) return false;
    return true;
}

function wasObjectPlacementSubmittedByCurrentPlayer(event) {
    return Boolean(event?.objectPlacementUserId && event?.player?.userId)
        && String(event.objectPlacementUserId) === String(event.player.userId);
}

export default function MatchmakingPage() {
    const navigate = useNavigate();
    const clientRef = useRef(null);
    const serverClockOffsetRef = useRef(null);
    const playbackRef = useRef(null);
    const matchEventRef = useRef(null);
    const roundReadyTimeoutRef = useRef(null);
    const placementSubmittedRef = useRef(false);
    const placementSubmitPendingRef = useRef(false);
    const queueStatusRef = useRef("CONNECTING");
    const [socketStatus, setSocketStatus] = useState("IDLE");
    const [queueStatus, setQueueStatus] = useState("CONNECTING");
    const [matchEvent, setMatchEvent] = useState(null);
    const [playback, setPlayback] = useState(null);
    const [remaining, setRemaining] = useState(0);
    const [hasFinished, setHasFinished] = useState(false);
    const [hasSurrendered, setHasSurrendered] = useState(false);
    const [placementSubmitPending, setPlacementSubmitPending] = useState(false);
    const [confirmedPlacementObjects, setConfirmedPlacementObjects] = useState([]);
    const [classChoice, setClassChoice] = useState("melee");

    useEffect(() => {
        playbackRef.current = playback;
    }, [playback]);

    const updateQueueStatus = (status) => {
        queueStatusRef.current = status;
        setQueueStatus(status);
    };
    const setCurrentMatchEvent = (event) => {
        matchEventRef.current = event;
        setMatchEvent(event);
    };

    useEffect(() => {
        let cancelled = false;

        async function startMatchmakingClient() {
            serverClockOffsetRef.current = await estimateServerClockOffset();
            if (cancelled) return;

            const client = createMatchmakingClient({
                onStatus: (status) => {
                    setSocketStatus(status);
                    if (status === "ERROR" || status === "CLOSED") {
                        placementSubmitPendingRef.current = false;
                        setPlacementSubmitPending(false);
                    }
                },
                onEvent: (rawEvent) => {
                    const event = normalizeEventTimes(rawEvent, serverClockOffsetRef.current);
                    if (event.type === "QUEUE_WAITING") {
                        updateQueueStatus("WAITING");
                    }
                    if (event.type === "MATCH_FOUND") {
                        if (roundReadyTimeoutRef.current != null) {
                            clearTimeout(roundReadyTimeoutRef.current);
                            roundReadyTimeoutRef.current = null;
                        }
                        setCurrentMatchEvent(event);
                        updateQueueStatus(event.status === "CLASS_SELECT" ? "CLASS_SELECT" : "COUNTDOWN");
                        setRemaining(secondsRemaining(
                            event.status === "CLASS_SELECT" ? event.classSelectionEndsAtMs : event.countdownEndsAtMs
                        ));
                        setClassChoice(event.player?.selectedClass ?? "melee");
                        playbackRef.current = null;
                        setPlayback(null);
                        setHasFinished(false);
                        setHasSurrendered(false);
                        placementSubmittedRef.current = false;
                        placementSubmitPendingRef.current = false;
                        setPlacementSubmitPending(false);
                        setConfirmedPlacementObjects([]);
                    }
                    if (event.type === "MATCH_CLASS_SELECTED") {
                        setCurrentMatchEvent(event);
                        updateQueueStatus("CLASS_SELECT");
                        setRemaining(secondsRemaining(event.classSelectionEndsAtMs));
                        setClassChoice(event.player?.selectedClass ?? "melee");
                    }
                    if (event.type === "MATCH_COUNTDOWN_READY") {
                        setCurrentMatchEvent(event);
                        updateQueueStatus("COUNTDOWN");
                        setRemaining(secondsRemaining(event.countdownEndsAtMs));
                        setClassChoice(event.player?.selectedClass ?? "melee");
                        placementSubmitPendingRef.current = false;
                        setPlacementSubmitPending(false);
                    }
                    if (event.type === "MATCH_OBJECT_PLACEMENT_READY"
                        || shouldApplyObjectPlacementEvent(event, queueStatusRef.current, matchEventRef.current)) {
                        setCurrentMatchEvent(event);
                        updateQueueStatus("OBJECT_PLACEMENT");
                        setRemaining(secondsRemaining(event.objectPlacementEndsAtMs));
                        setClassChoice(event.player?.selectedClass ?? "melee");
                        if (event.type === "MATCH_OBJECT_PLACEMENT_READY") {
                            placementSubmittedRef.current = false;
                            placementSubmitPendingRef.current = false;
                            setPlacementSubmitPending(false);
                            setConfirmedPlacementObjects([]);
                        } else if (wasObjectPlacementSubmittedByCurrentPlayer(event)) {
                            placementSubmittedRef.current = true;
                            placementSubmitPendingRef.current = false;
                            setPlacementSubmitPending(false);
                            setConfirmedPlacementObjects(Array.isArray(event.objectPlacements)
                                ? event.objectPlacements
                                : []);
                        }
                    }
                    if (event.type === "MATCH_ROUND_READY") {
                        const showNextRound = () => {
                            roundReadyTimeoutRef.current = null;
                            setCurrentMatchEvent(event);
                            playbackRef.current = null;
                            setPlayback(null);
                            updateQueueStatus(event.status === "OBJECT_PLACEMENT" ? "OBJECT_PLACEMENT" : "COUNTDOWN");
                            setRemaining(secondsRemaining(event.status === "OBJECT_PLACEMENT"
                                ? event.objectPlacementEndsAtMs
                                : event.countdownEndsAtMs));
                            setHasFinished(false);
                            setHasSurrendered(false);
                            placementSubmittedRef.current = false;
                            placementSubmitPendingRef.current = false;
                            setPlacementSubmitPending(false);
                            setConfirmedPlacementObjects([]);
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
                        setCurrentMatchEvent(event);
                        updateQueueStatus(event.status);
                    }
                    if (event.type === "MATCH_PLAYBACK_READY") {
                        setCurrentMatchEvent(event);
                        const nextPlayback = {
                            ...event.playback,
                            playbackStartsAt: event.playbackStartsAt,
                            playbackStartsAtMs: event.playbackStartsAtMs,
                            resultRevealsAt: event.resultRevealsAt,
                            resultRevealsAtMs: event.resultRevealsAtMs,
                        };
                        playbackRef.current = nextPlayback;
                        setPlayback(nextPlayback);
                        updateQueueStatus("PLAYBACK");
                        placementSubmittedRef.current = false;
                        placementSubmitPendingRef.current = false;
                        setPlacementSubmitPending(false);
                    }
                    if (event.type === "MATCH_RESULT_READY") {
                        setCurrentMatchEvent(event);
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
            : queueStatus === "OBJECT_PLACEMENT"
                ? matchEvent?.objectPlacementEndsAtMs
                : queueStatus === "COUNTDOWN"
                ? matchEvent?.countdownEndsAtMs
                : null;
        if (!deadlineMs) return;

        const interval = setInterval(() => {
            const nextRemaining = secondsRemaining(deadlineMs);
            setRemaining(nextRemaining);
            if (queueStatus === "COUNTDOWN" && nextRemaining === 0) {
                updateQueueStatus("PREP");
            }
            if (queueStatus === "OBJECT_PLACEMENT" && nextRemaining === 0) {
                if (!placementSubmittedRef.current && !placementSubmitPendingRef.current) {
                    placementSubmitPendingRef.current = true;
                    setPlacementSubmitPending(true);
                    clientRef.current?.placeObjects([]);
                }
            }
        }, 250);

        return () => clearInterval(interval);
    }, [matchEvent?.classSelectionEndsAtMs, matchEvent?.countdownEndsAtMs, matchEvent?.objectPlacementEndsAtMs, queueStatus]);

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

    const placeObjects = (objects) => {
        if (queueStatusRef.current !== "OBJECT_PLACEMENT"
            || placementSubmittedRef.current
            || placementSubmitPendingRef.current
            || socketStatus !== "CONNECTED") {
            return;
        }
        placementSubmitPendingRef.current = true;
        setPlacementSubmitPending(true);
        clientRef.current?.placeObjects(objects);
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
        objectPlacementEndsAt: matchEvent?.objectPlacementEndsAt,
        objectPlacementEndsAtMs: matchEvent?.objectPlacementEndsAtMs,
        rulesetVersion: matchEvent?.rulesetVersion,
        roundNumber: matchEvent?.roundNumber,
        winsRequired: matchEvent?.winsRequired,
        obstacles: matchEvent?.obstacles ?? [],
        roundBrains: matchEvent?.roundBrains ?? [],
        previousRoundWon: matchEvent?.previousRoundWon ?? null,
        roundBlockLimit: matchEvent?.roundBlockLimit ?? 10,
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
        matchEvent?.objectPlacementEndsAt,
        matchEvent?.objectPlacementEndsAtMs,
        matchEvent?.rulesetVersion,
        matchEvent?.roundNumber,
        matchEvent?.winsRequired,
        matchEvent?.obstacles,
        matchEvent?.roundBrains,
        matchEvent?.previousRoundWon,
        matchEvent?.roundBlockLimit,
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

    if (queueStatus === "OBJECT_PLACEMENT") {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={() => navigate("/home")} socketStatus={socketStatus} />
                <ObjectPlacementScreen
                    key={`${matchEvent?.matchId ?? "match"}-${matchEvent?.roundNumber ?? 1}-${matchEvent?.player?.slot ?? 1}`}
                    player={matchEvent?.player}
                    opponent={opponent}
                    placedObjects={matchEvent?.obstacles ?? []}
                    confirmedObjects={confirmedPlacementObjects}
                    remaining={remaining}
                    onSubmit={placeObjects}
                    submitted={Boolean(matchEvent?.player?.objectPlacementSubmitted)}
                    submitting={placementSubmitPending}
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

const PLACEABLE_OBJECTS = Object.freeze([
    { type: "healthPack", label: "Health Pack" },
    { type: PROJECTILE_WALL_TYPE, label: "Projectile Wall" },
    { type: BOUNCY_WALL_TYPE, label: "Bouncy Wall" },
]);

function ObjectPlacementScreen({
    player,
    opponent,
    placedObjects = [],
    confirmedObjects = [],
    remaining,
    onSubmit,
    submitted,
    submitting,
}) {
    const placementSide = player?.slot === 2 ? "bottom" : "top";
    const spawnY = player?.slot === 2 ? DUEL_SLOT_TWO_Y : DUEL_SLOT_ONE_Y;
    const spawnRotation = player?.slot === 2 ? 270 : 90;
    const [selectedType, setSelectedType] = useState("healthPack");
    const [selectedId, setSelectedId] = useState(null);
    const [objects, setObjects] = useState([]);
    const playerShape = {
        ...MAIN_SHAPE,
        x: player?.slot === 2 ? DUEL_SLOT_TWO_X : DUEL_SLOT_ONE_X,
        y: spawnY,
        rotation: spawnRotation,
        combatClass: player?.selectedClass ?? "melee",
        locked: true,
    };
    const serverObjects = confirmedObjects.map((object, index) => ({
        ...object,
        id: object.id ?? `placement-${index + 1}`,
        usesRemaining: object.usesRemaining ?? (object.type === BOUNCY_WALL_TYPE ? BOUNCY_WALL_MAX_USES : undefined),
    }));
    const visibleObjects = submitted ? serverObjects : objects;
    const localObjects = visibleObjects.map((object) => ({
        ...object,
        locked: submitted,
    }));
    const neutralObjects = placedObjects
        .filter((object) => isNeutralMatchObject(object))
        .map((object) => ({
            id: object.id,
            type: object.type,
            x: Number.isFinite(Number(object.x)) ? Number(object.x) : CANVAS_SIZE / 2,
            y: Number.isFinite(Number(object.y)) ? Number(object.y) : CANVAS_SIZE / 2,
            size: Number.isFinite(Number(object.size))
                ? Number(object.size)
                : object.type === RADAR_JAMMER_TYPE || object.type === COMMAND_LOCK_TYPE
                    ? CENTER_OBJECTIVE_SIZE
                    : BUFF_PICKUP_SIZE,
            rotation: Number(object.rotation) || 0,
            hp: Number(object.hp ?? 0),
            locked: true,
        }));
    const shapes = [playerShape, ...neutralObjects, ...localObjects];
    const maxObjects = PLAYER_OBJECT_PLACEMENT_LIMIT;
    const ownPlacedCount = visibleObjects.length;
    const remainingSlots = maxObjects - ownPlacedCount;
    const playerSubmitted = submitted || Boolean(player?.objectPlacementSubmitted);
    const opponentSubmitted = Boolean(opponent?.objectPlacementSubmitted);

    const addObject = () => {
        if (submitted || ownPlacedCount >= maxObjects) return;
        const size = selectedType === "healthPack"
            ? HEALTH_PACK_SIZE
            : isBuffPickupType(selectedType) ? BUFF_PICKUP_SIZE : PROJECTILE_WALL_LENGTH;
        const bounds = placementBounds(placementSide, size);
        const index = objects.length;
        const object = {
            id: `placement-${index + 1}`,
            type: selectedType,
            x: CANVAS_SIZE * (0.3 + index * 0.2),
            y: (bounds.minY + bounds.maxY) / 2,
            size,
            rotation: selectedType === "healthPack" ? 0 : 0,
            usesRemaining: selectedType === BOUNCY_WALL_TYPE ? BOUNCY_WALL_MAX_USES : undefined,
        };
        const clamped = clampPlacementObject(object, placementSide);
        setObjects((current) => [...current, clamped]);
        setSelectedId(clamped.id);
    };
    const updateObject = (id, updates) => {
        if (submitted) return;
        setObjects((current) => current.map((object) => (
            object.id === id ? clampPlacementObject({ ...object, ...updates }, placementSide) : object
        )));
    };
    const submit = () => {
        if (submitted) return;
        onSubmit(objects.map((object, index) => ({
            id: `p${player?.slot ?? 1}_object_${index + 1}`,
            type: object.type,
            x: object.x,
            y: object.y,
            size: object.size,
            rotation: object.rotation ?? 0,
        })));
    };

    return (
        <section className="flex min-h-[calc(100vh-52px)] flex-col items-center justify-center gap-5 px-6 py-5">
            <div className="flex w-full max-w-[1900px] items-end justify-between gap-4">
                <div>
                    <p className="font-mono text-xs tracking-[0.25em] text-cyan">ROUND OBJECT SETUP</p>
                    <h1 className="mt-2 text-2xl font-bold text-ink-white">Place up to 3 objects on your side</h1>
                    <p className="mt-2 text-sm text-ink-muted">
                        Your side is the highlighted third. Center objectives are locked for this round.
                    </p>
                </div>
                <div className="font-mono text-5xl font-bold text-ink-white">{remaining}</div>
            </div>
            <div className="grid w-full max-w-[1900px] gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <Canvas
                    shapes={shapes}
                    selectedId={selectedId}
                    onSelectShape={(id) => id !== "main" && setSelectedId(id)}
                    onUpdateShape={updateObject}
                    onDeselectAll={() => setSelectedId(null)}
                    editable={!submitted}
                    placementSide={placementSide}
                    showObjectLabels={false}
                />
                <aside className="border border-border-lo bg-arena-panel p-4">
                    <div className="mb-4 border border-border-lo bg-zinc-950/70 p-3">
                        <div className="font-mono text-[10px] tracking-widest text-ink-muted">ROUND CENTER</div>
                        <div className="mt-2 space-y-1.5 font-mono text-[10px] tracking-widest">
                            {neutralObjects.length > 0 ? neutralObjects.map((object) => (
                                <div key={object.id} className="flex justify-between gap-3 text-ink-muted">
                                    <span>{object.id === "object_center" ? "CENTER" : object.id === "object_buff_1" ? "LEFT" : "RIGHT"}</span>
                                    <span className="text-ink-white">{objectDisplayName(object, neutralObjects)}</span>
                                </div>
                            )) : (
                                <div className="text-ink-muted">CENTER OBJECTS LOADING</div>
                            )}
                        </div>
                    </div>
                    <div className="mb-4 grid grid-cols-2 gap-2 font-mono text-[10px] tracking-widest">
                        <div className={`border p-2 ${playerSubmitted ? "border-green-700/70 bg-green-950/30 text-green-200" : "border-border-lo bg-zinc-950 text-amber-200"}`}>
                            YOU<br />{playerSubmitted ? "SUBMITTED" : submitting ? "SUBMITTING" : "PLACING"}
                        </div>
                        <div className={`border p-2 ${opponentSubmitted ? "border-green-700/70 bg-green-950/30 text-green-200" : "border-border-lo bg-zinc-950 text-amber-200"}`}>
                            {opponent?.username ?? "OPP"}<br />{opponentSubmitted ? "SUBMITTED" : "PLACING"}
                        </div>
                    </div>
                    <div className="font-mono text-[10px] tracking-widest text-ink-muted">OBJECT TYPE</div>
                    <div className="mt-3 grid gap-2">
                        {PLACEABLE_OBJECTS.map((object) => (
                            <button
                                key={object.type}
                                type="button"
                                disabled={submitted}
                                onClick={() => setSelectedType(object.type)}
                                className={`h-10 rounded border px-3 text-left font-mono text-[10px] tracking-widest ${selectedType === object.type
                                    ? "border-cyan-400 bg-cyan-950/40 text-cyan-100"
                                    : "border-border-lo bg-zinc-950 text-ink-muted hover:text-ink-white"} disabled:opacity-40`}
                            >
                                {object.label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={addObject}
                        disabled={submitted || remainingSlots <= 0}
                        className="mt-4 h-10 w-full rounded border border-dashed border-cyan-700/70 bg-zinc-950 font-mono text-[10px] tracking-widest text-cyan-200 disabled:opacity-35"
                    >
                        ADD OBJECT ({remainingSlots} LEFT)
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (!selectedId || submitted) return;
                            setObjects((current) => current.filter((object) => object.id !== selectedId));
                            setSelectedId(null);
                        }}
                        disabled={!selectedId || submitted}
                        className="mt-2 h-10 w-full rounded border border-red-800/70 bg-red-950/30 font-mono text-[10px] tracking-widest text-red-300 disabled:opacity-35"
                    >
                        DELETE SELECTED
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={submitted || submitting}
                        className="mt-6 h-11 w-full rounded border border-green-700/70 bg-green-900/30 font-mono text-[11px] font-bold tracking-widest text-green-200 hover:bg-green-900/50 disabled:opacity-45"
                    >
                        {submitted ? "OBJECTS SUBMITTED" : submitting ? "SUBMITTING OBJECTS" : "SUBMIT OBJECTS"}
                    </button>
                </aside>
            </div>
        </section>
    );
}

function placementBounds(side, size) {
    const radius = size / 2;
    return side === "bottom"
        ? { minY: (CANVAS_SIZE * 2) / 3 + radius, maxY: CANVAS_SIZE - radius }
        : { minY: radius, maxY: CANVAS_SIZE / 3 - radius };
}

function clampPlacementObject(object, side) {
    const size = object.size ?? (object.type === "healthPack"
        ? HEALTH_PACK_SIZE
        : isBuffPickupType(object.type) ? BUFF_PICKUP_SIZE : PROJECTILE_WALL_LENGTH);
    const radius = size / 2;
    const bounds = placementBounds(side, size);
    return {
        ...object,
        size,
        x: clamp(Number(object.x) || CANVAS_SIZE / 2, radius, CANVAS_SIZE - radius),
        y: clamp(Number(object.y) || bounds.minY, bounds.minY, Math.max(bounds.minY, bounds.maxY)),
        rotation: object.type === "healthPack" || isBuffPickupType(object.type)
            ? 0
            : Math.round(Number(object.rotation ?? 0) / 45) * 45,
    };
}

function isBuffPickupType(type) {
    return type === OVERDRIVE_TYPE || type === BARRIER_TYPE || type === INHIBITION_TYPE;
}

function isNeutralMatchObject(object) {
    return object?.id === "object_center"
        || object?.id === "object_buff_1"
        || object?.id === "object_buff_2"
        || object?.type === RADAR_JAMMER_TYPE
        || object?.type === COMMAND_LOCK_TYPE
        || isBuffPickupType(object?.type);
}

function MatchHeader({ onExit, socketStatus }) {
    return (
        <header className="flex h-[52px] items-center justify-between border-b border-border-lo bg-arena-panel px-6">
            <button
                type="button"
                onClick={onExit}
                className="flex items-center gap-3 text-left hover:text-cyan-100"
                aria-label="Go to home"
            >
                <span className="text-xl leading-none text-cyan">M</span>
                <span className="text-lg font-bold tracking-[0.15em] text-ink-white">MACHINER</span>
            </button>
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
    const isMage = fighter.combatClass === "mage";
    const hpPercent = clamp(fighter.hp ?? 100, 0, 100);
    const shieldHp = Math.max(0, Number(fighter.shieldHp ?? 0));
    const shieldPercent = clamp(shieldHp, 0, 25) * 4;
    const overdriveActive = Number(fighter.overdriveMs ?? 0) > 0;
    const barrierActive = Number(fighter.barrierImmunityMs ?? 0) > 0;
    const inhibitionCharges = Math.max(0, Number(fighter.inhibitionCharges ?? 0));
    const slowedActive = Number(fighter.slowedMs ?? 0) > 0;
    const jammedActive = Number(fighter.jammedMs ?? 0) > 0;
    const commandLockedActive = Number(fighter.commandLockedMs ?? 0) > 0;
    const ammoMax = isMage ? 4 : 10;
    const ammo = Math.max(0, Math.min(ammoMax, Number(fighter.gunAmmo ?? ammoMax)));
    const reloadMs = Math.max(0, Number(fighter.gunReloadMs ?? 0));
    const bodyClasses = isFirstSlot
        ? "border-cyan bg-cyan/10 text-cyan"
        : "border-fuchsia-400 bg-fuchsia-500/10 text-fuchsia-200";
    const weaponClasses = fighter.attackActive
        ? "border-red-200 bg-red-300/60 shadow-[0_0_14px_rgba(248,113,113,0.65)]"
        : "border-zinc-200/70 bg-zinc-300/35";
    const fighterSizePercent = `${((fighter.size ?? 60) / arenaWidth) * 100}%`;

    return (
        <div
            className="absolute -translate-x-1/2 -translate-y-1/2 font-mono font-bold"
            style={{
                left: `${(fighter.x / arenaWidth) * 100}%`,
                top: `${(fighter.y / arenaHeight) * 100}%`,
                width: fighterSizePercent,
                aspectRatio: "1 / 1",
                fontSize: `${Math.max(8, Math.min(16, (fighter.size ?? 60) / 4))}px`,
            }}
            aria-label={`${fighter.username}, ${Math.round(fighter.hp ?? 100)} health`}
        >
            <div className="absolute -top-[10%] left-1/2 h-[6%] w-full -translate-x-1/2 overflow-hidden rounded bg-zinc-800 ring-1 ring-zinc-700">
                <div className="h-full bg-lime" style={{ width: `${hpPercent}%` }} />
                {shieldHp > 0 && (
                    <div className="absolute inset-y-0 left-0 bg-sky-300/80" style={{ width: `${shieldPercent}%` }} />
                )}
            </div>
            {(overdriveActive || barrierActive || inhibitionCharges > 0 || slowedActive || jammedActive || commandLockedActive) && (
                <div className="absolute -right-5 -top-5 z-20 flex flex-col gap-0.5 text-[9px]">
                    {overdriveActive && <span className="rounded border border-violet-300 bg-violet-950/90 px-1 text-violet-100">OD</span>}
                    {barrierActive && <span className="rounded border border-sky-300 bg-sky-950/90 px-1 text-sky-100">SH</span>}
                    {inhibitionCharges > 0 && <span className="rounded border border-rose-300 bg-rose-950/90 px-1 text-rose-100">IN {inhibitionCharges}</span>}
                    {slowedActive && <span className="rounded border border-zinc-300 bg-zinc-950/90 px-1 text-zinc-100">SLOW</span>}
                    {jammedActive && <span className="rounded border border-amber-300 bg-amber-950/90 px-1 text-amber-100">JAM</span>}
                    {commandLockedActive && <span className="rounded border border-zinc-300 bg-zinc-800/90 px-1 text-zinc-100">LOCK</span>}
                </div>
            )}
            {(isRanged || isMage) && (
                <div className="absolute -top-10 left-1/2 flex min-w-16 -translate-x-1/2 items-center justify-center gap-1 rounded border border-amber-800/70 bg-zinc-950/90 px-1.5 py-0.5 text-[9px] text-amber-200">
                    <span>{ammo}/{ammoMax}</span>
                    {reloadMs > 0 && <span className="text-amber-400">R</span>}
                </div>
            )}
            <div
                className="absolute inset-0"
                style={{ transform: `rotate(${fighter.rotation ?? 0}deg)` }}
            >
                <div className={`absolute inset-0 rounded-full border-2 ${bodyClasses}`} />
                {shieldHp > 0 && (
                    <div className="absolute -inset-1 rounded-full border-2 border-sky-200/80 shadow-[0_0_18px_rgba(125,211,252,0.45)]" />
                )}
                {overdriveActive && (
                    <div className="absolute -inset-2 rounded-full border border-violet-300/80 shadow-[0_0_18px_rgba(167,139,250,0.45)]" />
                )}
                {isRanged ? (
                    <>
                        <div className="absolute left-1/2 top-1/2 h-[14%] w-[68%] -translate-y-1/2 rounded-sm border border-amber-100 bg-amber-300/65 shadow-[0_0_10px_rgba(251,191,36,0.42)]" />
                        {fighter.attackActive && (
                            <div
                                className="absolute left-[140%] top-1/2 h-[2%] -translate-y-1/2 bg-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.65)]"
                                style={{ width: `${(542 / (fighter.size ?? 60)) * 100}%` }}
                            />
                        )}
                    </>
                ) : isMage ? (
                    <div className="absolute left-1/2 top-1/2 h-[14%] w-[54%] -translate-y-1/2 rounded-full border border-orange-100 bg-orange-300/65 shadow-[0_0_10px_rgba(251,146,60,0.5)]" />
                ) : (
                    <div
                        className={`absolute left-1/2 top-1/2 h-2 rounded-sm border ${weaponClasses}`}
                        style={{
                            width: fighter.attackActive ? "96%" : "80%",
                            height: "10%",
                            transformOrigin: "0 50%",
                            transform: `translateY(-50%) rotate(${fighter.attackActive ? -25 : 0}deg)`,
                        }}
                    />
                )}
                {fighter.blockActive && (
                    <div className="absolute left-[88%] top-1/2 h-[80%] w-[10%] -translate-y-1/2 rounded border border-blue-200 bg-blue-300/40 shadow-[0_0_14px_rgba(96,165,250,0.6)]" />
                )}
            </div>
            <span className={`absolute inset-0 flex items-center justify-center ${isFirstSlot ? "text-cyan" : "text-fuchsia-200"}`}>
                {fighter.slot}
            </span>
            <span className="absolute -bottom-[42%] left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-ink-white">
                {fighter.username} · {Math.round(fighter.hp ?? 100)} HP
            </span>
        </div>
    );
}

function centerCapturePct(obstacle) {
    const bySlot = obstacle.captureBySlot ?? {};
    const slotOne = Number(obstacle.slotOneCaptureMs ?? bySlot["1"] ?? bySlot[1] ?? 0);
    const slotTwo = Number(obstacle.slotTwoCaptureMs ?? bySlot["2"] ?? bySlot[2] ?? 0);
    const progressMs = Math.max(
        Number.isFinite(slotOne) ? slotOne : 0,
        Number.isFinite(slotTwo) ? slotTwo : 0
    );
    return Math.max(0, Math.min(1, progressMs / 5000));
}

function PlaybackObstacle({ obstacle, arenaWidth, arenaHeight, obstacles }) {
    const size = obstacle.size ?? (obstacle.type === "healthPack"
        ? 42
        : isBuffPickupType(obstacle.type) ? BUFF_PICKUP_SIZE : obstacle.type === "grenade" ? 12 : obstacle.type === "fireball" ? 30 : 128);
    const left = `${(obstacle.x / arenaWidth) * 100}%`;
    const top = `${(obstacle.y / arenaHeight) * 100}%`;
    const dimension = `${(size / arenaWidth) * 100}%`;
    const label = obstacle.id?.startsWith?.("object_") ? objectDisplayName(obstacle, obstacles) : null;
    const labelNode = label ? (
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-zinc-600 bg-zinc-950/90 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-white">
            {label}
        </span>
    ) : null;

    if (obstacle.type === RADAR_JAMMER_TYPE || obstacle.type === COMMAND_LOCK_TYPE) {
        const jammer = obstacle.type === RADAR_JAMMER_TYPE;
        const capturePct = centerCapturePct(obstacle);
        return (
            <div
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 ${jammer ? "border-amber-200 bg-amber-400/15 shadow-[0_0_20px_rgba(251,191,36,0.35)]" : "border-zinc-200 bg-zinc-500/15 shadow-[0_0_20px_rgba(212,212,216,0.32)]"}`}
                style={{ left, top, width: dimension, aspectRatio: "1 / 1" }}
            >
                {capturePct > 0 && (
                    <div
                        className="absolute inset-[-7px] rounded-full opacity-85"
                        style={{
                            background: `conic-gradient(${jammer ? "rgba(251,191,36,0.9)" : "rgba(228,228,231,0.9)"} ${capturePct * 360}deg, rgba(63,63,70,0.35) 0deg)`,
                            mask: "radial-gradient(circle, transparent 62%, black 64%)",
                            WebkitMask: "radial-gradient(circle, transparent 62%, black 64%)",
                        }}
                    />
                )}
                {jammer ? (
                    <div className="relative h-[54%] w-[66%]">
                        <div className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-amber-100" />
                        <div className="absolute bottom-1 left-1/2 h-5 w-10 -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-amber-100" />
                        <div className="absolute bottom-1 left-1/2 h-9 w-16 -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-amber-100" />
                        <div className="absolute left-1/2 top-1/2 h-1 w-full -translate-x-1/2 rotate-45 rounded bg-red-300" />
                    </div>
                ) : (
                    <div className="relative h-[52%] w-[46%]">
                        <div className="absolute bottom-0 left-0 h-[62%] w-full rounded border-2 border-zinc-100" />
                        <div className="absolute left-1/2 top-0 h-[48%] w-[70%] -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-zinc-100" />
                    </div>
                )}
                {labelNode}
            </div>
        );
    }

    if (obstacle.type === "healthPack") {
        return (
            <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-300 bg-emerald-500/15 shadow-[0_0_14px_rgba(16,185,129,0.28)]"
                style={{ left, top, width: dimension, aspectRatio: "1 / 1" }}
            >
                <div className="absolute left-1/2 top-1/2 h-[58%] w-[18%] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-emerald-200" />
                <div className="absolute left-1/2 top-1/2 h-[18%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-emerald-200" />
                {labelNode}
            </div>
        );
    }

    if (isBuffPickupType(obstacle.type)) {
        const tone = obstacle.type === OVERDRIVE_TYPE
            ? "border-violet-300 bg-violet-500/15 shadow-[0_0_18px_rgba(167,139,250,0.35)] text-violet-100"
            : obstacle.type === BARRIER_TYPE
                ? "border-sky-200 bg-sky-400/15 shadow-[0_0_18px_rgba(125,211,252,0.35)] text-sky-100"
                : "border-rose-300 bg-rose-500/15 shadow-[0_0_18px_rgba(251,113,133,0.35)] text-rose-100";
        return (
            <div
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 ${tone}`}
                style={{ left, top, width: dimension, aspectRatio: "1 / 1" }}
            >
                {obstacle.type === OVERDRIVE_TYPE && (
                    <div className="relative h-[58%] w-[58%] rounded-full border-2 border-current">
                        <div className="absolute left-1/2 top-1/2 h-[34%] w-0.5 -translate-x-1/2 -translate-y-full rounded bg-current" />
                        <div className="absolute left-1/2 top-1/2 h-0.5 w-[32%] -translate-y-1/2 rounded bg-current" />
                    </div>
                )}
                {(obstacle.hp ?? 0) > 0 && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[9px] text-white">{Math.ceil(obstacle.hp)}</span>}
                {obstacle.type === BARRIER_TYPE && <div className="text-3xl font-black leading-none">◇</div>}
                {obstacle.type === INHIBITION_TYPE && <div className="text-2xl font-black leading-none">⌁</div>}
                {labelNode}
            </div>
        );
    }

    if (obstacle.type === PROJECTILE_WALL_TYPE || obstacle.type === BOUNCY_WALL_TYPE) {
        const wallLength = `${(PROJECTILE_WALL_LENGTH / arenaWidth) * 100}%`;
        const wallThickness = `${(PROJECTILE_WALL_THICKNESS / PROJECTILE_WALL_LENGTH) * 100}%`;
        const capSize = `${(14 / arenaWidth) * 100}%`;
        const colorClass = obstacle.type === PROJECTILE_WALL_TYPE ? "bg-yellow-300" : "bg-white";
        return (
            <div
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                    left,
                    top,
                    width: wallLength,
                    aspectRatio: `${PROJECTILE_WALL_LENGTH} / ${PROJECTILE_WALL_LENGTH}`,
                    transform: `translate(-50%, -50%) rotate(${obstacle.rotation ?? 0}deg)`,
                }}
            >
                <div
                    className={`absolute left-0 top-1/2 w-full -translate-y-1/2 shadow-[0_0_8px_rgba(255,255,255,0.55)] ${colorClass}`}
                    style={{ height: wallThickness }}
                />
                <div
                    className={`absolute left-0 top-1/2 rounded-full -translate-x-1/2 -translate-y-1/2 ${colorClass}`}
                    style={{ width: capSize, aspectRatio: "1 / 1" }}
                />
                <div
                    className={`absolute right-0 top-1/2 rounded-full translate-x-1/2 -translate-y-1/2 ${colorClass}`}
                    style={{ width: capSize, aspectRatio: "1 / 1" }}
                />
                <div style={{ transform: `rotate(${-(obstacle.rotation ?? 0)}deg)` }}>
                    {labelNode}
                </div>
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

    if (obstacle.type === "fireball") {
        return (
            <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-100 bg-orange-400 shadow-[0_0_18px_rgba(251,146,60,0.75)]"
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
                className="relative w-full max-w-[1600px] overflow-hidden rounded border border-border-mid bg-[#0d1117]"
                style={{
                    width: `min(100%, ${DISPLAY_ARENA_MAX_SIZE}px, calc(100vh - 190px))`,
                    aspectRatio: `${arenaWidth} / ${arenaHeight}`,
                }}
            >
                <div className="absolute inset-0 canvas-grid-bg opacity-60" />
                {obstacles.map((obstacle) => (
                    <PlaybackObstacle
                        key={obstacle.id}
                        obstacle={obstacle}
                        obstacles={obstacles}
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
