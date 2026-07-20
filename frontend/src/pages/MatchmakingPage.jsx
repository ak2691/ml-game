import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BetaModel from "../beta/BetaModel";
import PixiCanvas from "../beta/PixiCanvas";
import {
    ASSAULT_BOOST_TYPE,
    BUFF_PICKUP_SIZE,
    CENTER_OBJECTIVE_SIZE,
    MOBILITY_BOOST_TYPE,
    PROJECTILE_WALL_LENGTH,
    PROJECTILE_WALL_THICKNESS,
    PROJECTILE_WALL_TYPE,
    TEMPO_BOOST_TYPE,
    VANGUARD_BEACON_TYPE,
    isBoostType,
} from "../beta/ArenaObjects";
import { BOT_ABILITIES, DEFAULT_BOT_LOADOUT, MAX_EQUIPPED_ABILITIES, ROUND_ABILITY_DRAFT, STAT_POINT_BUDGET_PER_ROUND, botStatsForLoadout, decodeBotLoadout, encodeBotLoadout, normalizedBotLoadout } from "../beta/loadout/BotLoadout";
import {
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    DISPLAY_ARENA_MAX_SIZE,
    DUEL_SLOT_ONE_X,
    DUEL_SLOT_ONE_Y,
    DUEL_SLOT_TWO_X,
    DUEL_SLOT_TWO_Y,
    CORE_HP,
    CORE_TYPE,
    DEFENSE_WALL_TYPE,
    WALL_CORE_HP,
    WALL_CORE_TYPE,
    HEALTH_PACK_SIZE,
    PLAYER_OBJECT_PLACEMENT_LIMIT,
    BOOST_PLACEMENT_LIMIT,
    UTILITY_PLACEMENT_LIMIT,
} from "../beta/modelPayloads/arenaConstants";
import { MAIN_SHAPE, buildCoreShapes } from "../beta/modelPayloads/arenaShapes";
import { createMatchmakingClient } from "../matchmaking/stompClient";

const SimulationReplay = lazy(() => import("../replay/SimulationReplay"));

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
const ROUND_RESULT_HOLD_MS = 3500;
const MATCH_COUNTDOWN_SECONDS = 5;

function ReplayLoadingFallback() {
    return (
        <main className="flex min-h-[calc(100vh-52px)] items-center justify-center bg-arena-deep text-ink-muted">
            <p role="status" className="font-mono text-xs tracking-[0.25em]">LOADING REPLAY...</p>
        </main>
    );
}

function secondsRemaining(countdownEndsAt, maximum = Number.POSITIVE_INFINITY) {
    if (!countdownEndsAt) return 0;
    return Math.min(maximum, Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000)));
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
    const [finishError, setFinishError] = useState(null);
    const [placementSubmitPending, setPlacementSubmitPending] = useState(false);
    const [confirmedPlacementObjects, setConfirmedPlacementObjects] = useState([]);
    const [loadoutChoice, setLoadoutChoice] = useState(() => normalizedBotLoadout(DEFAULT_BOT_LOADOUT));

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
                        setRemaining(event.status === "CLASS_SELECT"
                            ? secondsRemaining(event.classSelectionEndsAtMs)
                            : secondsRemaining(event.countdownEndsAtMs, MATCH_COUNTDOWN_SECONDS));
                        setLoadoutChoice(decodeBotLoadout(event.player?.selectedClass));
                        playbackRef.current = null;
                        setPlayback(null);
                        setHasFinished(false);
                        setFinishError(null);
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
                    }
                    if (event.type === "MATCH_COUNTDOWN_READY") {
                        setCurrentMatchEvent(event);
                        updateQueueStatus("COUNTDOWN");
                        setRemaining(secondsRemaining(event.countdownEndsAtMs, MATCH_COUNTDOWN_SECONDS));
                        setLoadoutChoice(decodeBotLoadout(event.player?.selectedClass));
                        placementSubmitPendingRef.current = false;
                        setPlacementSubmitPending(false);
                    }
                    if (event.type === "MATCH_OBJECT_PLACEMENT_READY"
                        || shouldApplyObjectPlacementEvent(event, queueStatusRef.current, matchEventRef.current)) {
                        setCurrentMatchEvent(event);
                        updateQueueStatus("OBJECT_PLACEMENT");
                        setRemaining(secondsRemaining(event.objectPlacementEndsAtMs));
                        setLoadoutChoice(decodeBotLoadout(event.player?.selectedClass));
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
                            updateQueueStatus(event.status === "CLASS_SELECT" ? "CLASS_SELECT" : "COUNTDOWN");
                            setRemaining(event.status === "CLASS_SELECT"
                                ? secondsRemaining(event.classSelectionEndsAtMs)
                                : secondsRemaining(event.countdownEndsAtMs, MATCH_COUNTDOWN_SECONDS));
                            setHasFinished(false);
                            setHasSurrendered(false);
                            setLoadoutChoice(decodeBotLoadout(event.player?.selectedClass));
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
                    if (event.type === "MATCH_ERROR") {
                        setHasFinished(false);
                        setFinishError(event.message ?? "The server rejected the bot submission. Review the bot and try again.");
                        updateQueueStatus("TRAINING");
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
            const nextRemaining = secondsRemaining(
                deadlineMs,
                queueStatus === "COUNTDOWN" ? MATCH_COUNTDOWN_SECONDS : Number.POSITIVE_INFINITY,
            );
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
        setFinishError(null);
        setHasFinished(true);
        clientRef.current?.finish(modelSubmissionId);
    };

    const surrenderMatch = () => {
        setHasSurrendered(true);
        clientRef.current?.surrender();
    };

    const lockClass = () => {
        clientRef.current?.selectClass(encodeBotLoadout(loadoutChoice));
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
        loadout: loadoutChoice,
        opponentLoadout: decodeBotLoadout(matchEvent?.opponent?.selectedClass),
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
        matchEvent?.opponent?.selectedClass,
        loadoutChoice,
    ]);

    if (playback) {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={() => navigate("/home")} socketStatus={socketStatus} />
                <Suspense fallback={<ReplayLoadingFallback />}>
                    <SimulationReplay playback={playback} />
                </Suspense>
            </main>
        );
    }

    if (queueStatus === "CLASS_SELECT") {
        return (
            <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
                <MatchHeader onExit={() => navigate("/home")} socketStatus={socketStatus} />
                <ClassSelectScreen
                    loadout={loadoutChoice}
                    onChange={setLoadoutChoice}
                    onLockClass={lockClass}
                    player={matchEvent?.player}
                    opponent={opponent}
                    roundNumber={matchEvent?.roundNumber ?? 1}
                    abilityOffers={matchEvent?.abilityOffers ?? []}
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
                    placedObjects={matchEvent?.obstacles ?? []}
                    confirmedObjects={confirmedPlacementObjects}
                    remaining={remaining}
                    onSubmit={placeObjects}
                    submitted={Boolean(matchEvent?.player?.objectPlacementSubmitted)}
                    submitting={placementSubmitPending}
                    roundNumber={matchEvent?.roundNumber ?? 1}
                />
            </main>
        );
    }

    if (queueStatus === "PREP" || queueStatus === "WAITING_FOR_FINISH" || queueStatus === "READY_FOR_PLAYBACK") {
        return (
            <BetaModel
                matchContext={matchContext}
                finishStatus={hasSurrendered ? "SURRENDERED" : hasFinished ? "FINISHED" : "TRAINING"}
                finishError={finishError}
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
                                ROUND {matchEvent.roundNumber} OF 3
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

function ClassSelectScreen({ loadout, onChange, onLockClass, player, opponent, remaining, roundNumber, abilityOffers }) {
    const playerLocked = Boolean(player?.classSelected);
    const opponentLocked = Boolean(opponent?.classSelected);
    const normalized = normalizedBotLoadout(loadout);
    const inheritedLoadout = decodeBotLoadout(player?.selectedClass);
    const inheritedAbilities = playerLocked
        ? normalized.abilities
        : Number(roundNumber) > 1 ? inheritedLoadout.abilities : [];
    const inheritedAbilityIds = new Set(inheritedAbilities);
    const draftedAbilities = normalized.abilities.filter((ability) => !inheritedAbilityIds.has(ability));
    const draftedAbilityIds = new Set(draftedAbilities);
    const draftRule = ROUND_ABILITY_DRAFT[Math.max(1, Number(roundNumber) || 1)] ?? { offered: 0, picks: 0 };
    const offeredAbilityIds = new Set(Array.isArray(abilityOffers) ? abilityOffers : []);
    const spent = Object.values(normalized.statPoints).reduce((sum, value) => sum + value, 0);
    const roundBudget = STAT_POINT_BUDGET_PER_ROUND * Math.max(1, Number(roundNumber) || 1);
    const stats = botStatsForLoadout(normalized);
    const toggleAbility = (id) => {
        if (inheritedAbilityIds.has(id) || !offeredAbilityIds.has(id)) return;
        const abilities = draftedAbilityIds.has(id)
            ? normalized.abilities.filter((ability) => ability !== id)
            : draftedAbilities.length < draftRule.picks ? [...normalized.abilities, id] : normalized.abilities;
        onChange(normalizedBotLoadout({ ...normalized, abilities }));
    };
    const changePoint = (key, delta) => {
        if (delta > 0 && spent >= roundBudget) return;
        onChange(normalizedBotLoadout({ ...normalized, statPoints: { ...normalized.statPoints, [key]: Math.max(0, normalized.statPoints[key] + delta) } }));
    };

    return (
        <section className="flex min-h-[calc(100vh-52px)] items-center justify-center px-6 py-8">
            <div className="w-full max-w-[860px]">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="font-mono text-xs tracking-[0.25em] text-cyan">ROUND LOADOUT</p>
                        <h1 className="mt-3 text-3xl font-bold text-ink-white">Build your bot</h1>
                        <p className="mt-2 text-sm text-ink-muted">Choose {draftRule.picks} from your {draftRule.offered} random Round {roundNumber} offers. Your previous picks stay equipped.</p>
                    </div>
                    <div className="font-mono text-5xl font-bold text-ink-white">{remaining}</div>
                </div>
                <div className="mt-6 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
                    <div>
                        <div className="mb-4 grid grid-cols-3 gap-3" aria-label="Ability slots">
                            {Array.from({ length: MAX_EQUIPPED_ABILITIES }, (_, index) => {
                                const abilityId = normalized.abilities[index];
                                const ability = BOT_ABILITIES.find((candidate) => candidate.id === abilityId);
                                const isDraft = draftedAbilityIds.has(abilityId);
                                return <button type="button" key={index} disabled={!isDraft || playerLocked} onClick={isDraft ? () => toggleAbility(abilityId) : undefined} aria-label={isDraft ? `Remove ${ability?.label} from slot ${index + 1}` : `Ability slot ${index + 1}${ability ? `: ${ability.label}` : ": empty"}`} className={`min-h-20 rounded border p-3 text-left ${ability ? isDraft ? "cursor-pointer border-cyan bg-cyan-950/30 hover:border-red-300" : "cursor-default border-green-800/70 bg-green-950/20" : "cursor-default border-dashed border-border-lo bg-zinc-950/40"}`}><div className="font-mono text-[9px] tracking-widest text-ink-muted">SLOT {index + 1}</div><div className="mt-2 text-xs font-bold text-ink-white">{ability?.label ?? "EMPTY"}</div>{isDraft && <div className="mt-1 font-mono text-[8px] tracking-widest text-cyan">ROUND {roundNumber} PICK · CLICK TO REMOVE</div>}</button>;
                            })}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {BOT_ABILITIES.filter((ability) => offeredAbilityIds.has(ability.id)).map((ability) => { const active = draftedAbilityIds.has(ability.id); return <button key={ability.id} type="button" disabled={playerLocked || (!active && draftedAbilities.length >= draftRule.picks)} onClick={() => toggleAbility(ability.id)} className={`rounded border p-4 text-left transition ${active ? "border-cyan bg-cyan-950/30 -translate-y-1" : "border-border-lo bg-arena-panel"}`}><div className="flex items-center justify-between gap-2 font-mono text-xs tracking-widest text-ink-white"><span>{active ? "SELECTED - " : ""}{ability.label}</span><span className="text-[8px] text-cyan">{ability.kind.toUpperCase()}</span></div><p className="mt-2 text-xs text-ink-muted">{ability.summary}</p></button>; })}
                        </div>
                    </div>
                    <div className="border border-border-lo bg-arena-panel p-5">
                        <div className="font-mono text-xs tracking-widest text-cyan">STAT POINTS {spent}/{roundBudget}</div>
                        {[ ["maxHp", "HP", stats.maxHp], ["moveSpeed", "MOVE", stats.moveSpeed], ["attackDamage", "DAMAGE", `${stats.attackDamagePercent}%`], ["attackSpeed", "ATTACK SPEED", `${stats.attackSpeedPercent}%`] ].map(([key,label,value]) => <div key={key} className="mt-4 flex items-center justify-between gap-3"><span className="font-mono text-[10px] tracking-widest text-ink-muted">{label}</span><div className="flex items-center gap-3"><button type="button" disabled={playerLocked || normalized.statPoints[key] <= 0} onClick={() => changePoint(key,-1)} className="h-8 w-8 border border-border-lo">-</button><span className="w-14 text-center font-mono text-sm">{value}</span><button type="button" disabled={playerLocked || spent >= roundBudget} onClick={() => changePoint(key,1)} className="h-8 w-8 border border-border-lo">+</button></div></div>)}
                    </div>
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
                        disabled={playerLocked || draftedAbilities.length !== draftRule.picks || normalized.abilities.length > MAX_EQUIPPED_ABILITIES}
                        className="h-10 rounded border border-green-700/60 bg-green-900/30 px-5 font-mono text-[11px] font-bold tracking-widest text-green-200 hover:bg-green-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {playerLocked ? "LOADOUT LOCKED" : draftedAbilities.length === draftRule.picks ? "LOCK LOADOUT" : `SELECT ${draftRule.picks - draftedAbilities.length} MORE`}
                    </button>
                </div>
            </div>
        </section>
    );
}

const PLACEABLE_OBJECTS = Object.freeze([
    { type: ASSAULT_BOOST_TYPE, label: "Assault Boost", category: "boost" },
    { type: TEMPO_BOOST_TYPE, label: "Tempo Boost", category: "boost" },
    { type: MOBILITY_BOOST_TYPE, label: "Mobility Boost", category: "boost" },
    { type: "healthPack", label: "Health Pack", category: "utility" },
    { type: PROJECTILE_WALL_TYPE, label: "Healing Projectile Wall", category: "utility" },
]);

function ObjectPlacementScreen({
    player,
    placedObjects = [],
    confirmedObjects = [],
    remaining,
    onSubmit,
    submitted,
    submitting,
    roundNumber,
}) {
    const placementSide = player?.slot === 2 ? "bottom" : "top";
    const spawnY = player?.slot === 2 ? DUEL_SLOT_TWO_Y : DUEL_SLOT_ONE_Y;
    const spawnRotation = player?.slot === 2 ? 270 : 90;
    const [selectedType, setSelectedType] = useState("healthPack");
    const [selectedId, setSelectedId] = useState(null);
    const [objects, setObjects] = useState([]);
    if (player?.slot !== 2) {
        return <section className="flex min-h-[calc(100vh-52px)] items-center justify-center px-6">
            <div className="border border-emerald-800/70 bg-arena-panel px-10 py-12 text-center shadow-2xl">
                <p className="font-mono text-xs tracking-[0.3em] text-emerald-300">DEFENDER</p>
                <h1 className="mt-4 text-2xl font-bold text-ink-white">Waiting for attacker to choose objects</h1>
                <p className="mt-3 font-mono text-sm text-ink-muted">{remaining}s remaining</p>
            </div>
        </section>;
    }
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
            x: Number.isFinite(Number(object.x)) ? Number(object.x) : ARENA_WIDTH_UNITS / 2,
            y: Number.isFinite(Number(object.y)) ? Number(object.y) : ARENA_HEIGHT_UNITS / 2,
            size: Number.isFinite(Number(object.size))
                ? Number(object.size)
                : object.type === VANGUARD_BEACON_TYPE
                    ? CENTER_OBJECTIVE_SIZE
                    : BUFF_PICKUP_SIZE,
            rotation: Number(object.rotation) || 0,
            hp: Number(object.hp ?? 0),
            locked: true,
        }));
    const shapes = [...buildCoreShapes(), playerShape, ...neutralObjects, ...localObjects];
    const maxObjects = PLAYER_OBJECT_PLACEMENT_LIMIT;
    const ownPlacedCount = visibleObjects.length;
    const remainingSlots = maxObjects - ownPlacedCount;
    const boostCount = visibleObjects.filter((object) => isBoostType(object.type)).length;
    const utilityCount = ownPlacedCount - boostCount;

    const addObject = () => {
        const selectedIsBoost = isBoostType(selectedType);
        if (submitted || ownPlacedCount >= maxObjects
            || (selectedIsBoost ? boostCount >= BOOST_PLACEMENT_LIMIT : utilityCount >= UTILITY_PLACEMENT_LIMIT)) return;
        const size = selectedType === "healthPack"
            ? HEALTH_PACK_SIZE
            : isBoostType(selectedType) ? BUFF_PICKUP_SIZE : PROJECTILE_WALL_LENGTH;
        const bounds = placementBounds(placementSide, size);
        const index = objects.length;
        const object = {
            id: `placement-${index + 1}`,
            type: selectedType,
            x: ARENA_WIDTH_UNITS * (0.3 + index * 0.2),
            y: (bounds.minY + bounds.maxY) / 2,
            size,
            rotation: selectedType === "healthPack" ? 0 : 0,
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
                    <p className="font-mono text-xs tracking-[0.25em] text-cyan">{roundNumber === 3 ? "SIDES SWITCHED · NEW ATTACKER" : "ROUND OBJECT SETUP"}</p>
                    <h1 className="mt-2 text-2xl font-bold text-ink-white">Place two boosts and two utilities</h1>
                    <p className="mt-2 text-sm text-ink-muted">
                        Your side is the highlighted third. Center objectives are locked for this round.
                    </p>
                </div>
                <div className="font-mono text-5xl font-bold text-ink-white">{remaining}</div>
            </div>
            <div className="grid w-full max-w-[1900px] gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <PixiCanvas
                    shapes={shapes}
                    selectedId={selectedId}
                    onSelectShape={(id) => id !== "main" && setSelectedId(id)}
                    onUpdateShape={updateObject}
                    onDeselectAll={() => setSelectedId(null)}
                    editable={!submitted}
                    placementSide={placementSide}
                />
                <aside className="border border-border-lo bg-arena-panel p-4">
                    <div className="mb-4 border border-border-lo bg-zinc-950/70 p-3">
                        <div className="font-mono text-[10px] tracking-widest text-ink-muted">ROUND CENTER</div>
                        <div className="mt-2 space-y-1.5 font-mono text-[10px] tracking-widest">
                            {neutralObjects.length > 0 ? neutralObjects.map((object) => (
                                <div key={object.id} className="flex justify-between gap-3 text-ink-muted">
                                    <span>{object.id === "object_center" ? "CENTER" : object.id === "object_buff_1" ? "LEFT" : "RIGHT"}</span>
                                    <span className="text-ink-white">{object.type}</span>
                                </div>
                            )) : (
                                <div className="text-ink-muted">CENTER OBJECTS LOADING</div>
                            )}
                        </div>
                    </div>
                    <div className="font-mono text-[10px] tracking-widest text-ink-muted">BOOSTS {boostCount}/{BOOST_PLACEMENT_LIMIT} · UTILITIES {utilityCount}/{UTILITY_PLACEMENT_LIMIT}</div>
                    <div className="mt-3 grid gap-2">
                        {PLACEABLE_OBJECTS.map((object) => (
                            <button
                                key={object.type}
                                type="button"
                                disabled={submitted || (object.category === "boost" ? boostCount >= BOOST_PLACEMENT_LIMIT : utilityCount >= UTILITY_PLACEMENT_LIMIT)}
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
        ? { minY: (ARENA_HEIGHT_UNITS * 2) / 3 + radius, maxY: ARENA_HEIGHT_UNITS - radius }
        : { minY: radius, maxY: ARENA_HEIGHT_UNITS / 3 - radius };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clampPlacementObject(object, side) {
    const size = object.size ?? (object.type === "healthPack"
        ? HEALTH_PACK_SIZE
        : isBoostType(object.type) ? BUFF_PICKUP_SIZE : PROJECTILE_WALL_LENGTH);
    const radius = size / 2;
    const bounds = placementBounds(side, size);
    const x = clamp(Number(object.x) || ARENA_WIDTH_UNITS / 2, radius, ARENA_WIDTH_UNITS - radius);
    const y = clamp(Number(object.y) || bounds.minY, bounds.minY, Math.max(bounds.minY, bounds.maxY));
    return {
        ...object,
        size,
        x,
        y,
        rotation: object.type === "healthPack" || isBoostType(object.type)
            ? 0
            : Math.round(Number(object.rotation ?? 0) / 45) * 45,
    };
}

function isNeutralMatchObject(object) {
    return object?.id === "object_center"
        || object?.type === VANGUARD_BEACON_TYPE;
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
