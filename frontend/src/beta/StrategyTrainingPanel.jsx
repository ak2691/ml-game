import { useEffect, useMemo, useRef, useState } from "react";
import {
    ACTION_TYPES,
    CONDITION_DEFINITIONS,
    CONDITION_TYPES,
    TARGET_TYPES,
    CONDITION_COMPARATORS,
    STATE_VARIABLES,
    actionSupportsTarget,
    createLogicCluster,
    createLogicBlock,
    createExpressionCondition,
    MAX_CLUSTERS,
    MAX_CONDITIONS_PER_BLOCK,
    MAX_LOGIC_BLOCKS,
    MAX_PRIORITY,
    MIN_PRIORITY,
    validateMeleeStrategyConfiguration,
} from "../ml/MeleeStrategy.js";
import {
    actionTypesForCombatClass,
    COMBAT_CLASSES,
    conditionTypesForMatchup,
} from "./classes/CombatClasses.js";
import { objectTargetTypes as labelObjectTargetTypes } from "./objectLabels.js";

const CONDITION_GROUP_ORDER = ["Basic", "My Bot", "Opponent", "Objects", "Target", "General"];
const LOGIC_BLOCK_WIDTH = 360;
const LOGIC_BLOCK_HEIGHT_ESTIMATE = 320;
const CLUSTER_NODE_WIDTH = 780;
const LOGIC_CANVAS_WIDTH = 3400;
const LOGIC_CANVAS_HEIGHT = 2400;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.35;

function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export default function StrategyTrainingPanel({
    configuration,
    onChange,
    opponentConfiguration = null,
    onOpponentChange = null,
    onStartTraining,
    onStopTraining,
    isTraining,
    selectedClass = "melee",
    onClassChange = null,
    opponentSelectedClass = "melee",
    onOpponentClassChange = null,
    canChangeClass = false,
    canChangeOpponentClass = false,
    isMatchTraining = false,
    matchContext = null,
    trainingRemaining = null,
    playerRoundWins = 0,
    opponentRoundWins = 0,
    obstacleCount = 0,
    obstacleObjects = [],
    isAutoPlaying = false,
    hasArenaCheckpoint = false,
    isBaseTraining = false,
    finishStatus = null,
    isFinishingMatch = false,
    canFinishMatch = false,
    onAutoPlayToggle,
    onResetArenaStats,
    onSaveArenaCheckpoint,
    onResetArenaCheckpoint,
    onFullArenaReset,
    onResetRoundModel,
    onSurrenderMatch,
    onFinishMatch,
}) {
    const [isLogicOpen, setIsLogicOpen] = useState(false);
    const [activeBrain, setActiveBrain] = useState("player");
    const [nodePositions, setNodePositions] = useState({});
    const [activeBlockId, setActiveBlockId] = useState(null);
    const [canvasZoom, setCanvasZoom] = useState(0.85);
    const [canvasPan, setCanvasPan] = useState({ x: 40, y: 36 });
    const currentRound = Math.max(1, Number(matchContext?.roundNumber) || 1);
    const [selectedLogicRound, setSelectedLogicRound] = useState(currentRound);
    const validation = validateMeleeStrategyConfiguration(configuration);
    const editingOpponent = activeBrain === "opponent" && opponentConfiguration && onOpponentChange;
    const playerBotLabel = matchContext?.player?.username ? `${matchContext.player.username}'s bot` : "Your bot";
    const activeClass = editingOpponent ? opponentSelectedClass : selectedClass;
    const activeOpponentClass = editingOpponent ? selectedClass : opponentSelectedClass;
    const activeConfiguration = editingOpponent ? opponentConfiguration : configuration;
    const updateActiveConfiguration = (next) => {
        if (editingOpponent) onOpponentChange(next);
        else onChange(next);
    };
    const updateBlocks = (blocks) => updateActiveConfiguration({ ...activeConfiguration, blocks });
    const updateBlock = (index, updates) => updateBlocks((activeConfiguration.blocks ?? []).map((block, candidate) => (
        candidate === index ? { ...block, ...updates } : block
    )));
    const updateClusters = (clusters) => updateActiveConfiguration({ ...activeConfiguration, clusters });
    const updateCluster = (index, updates) => updateClusters((activeConfiguration.clusters ?? []).map((cluster, candidate) => (
        candidate === index ? { ...cluster, ...updates } : cluster
    )));
    const totalActiveBlocks = countLogicBlocks(activeConfiguration);
    const roundBrains = editingOpponent ? [] : matchContext?.roundBrains ?? [];
    const blockRoundById = useMemo(
        () => blockIntroductionRounds(roundBrains, activeConfiguration, currentRound),
        [activeConfiguration, currentRound, roundBrains],
    );
    const displayedConfiguration = useMemo(
        () => configurationForRound(activeConfiguration, blockRoundById, selectedLogicRound),
        [activeConfiguration, blockRoundById, selectedLogicRound],
    );
    const roundBlockLimit = Math.max(1, Number(matchContext?.roundBlockLimit) || 10);
    const currentRoundBlockCount = [...blockRoundById.values()]
        .filter((round) => round === currentRound).length;
    const viewingCurrentRound = selectedLogicRound === currentRound;
    const viewingPreviousRound = selectedLogicRound === currentRound - 1;
    const previousRoundWon = Boolean(matchContext?.previousRoundWon);
    const roundFieldsLocked = !viewingCurrentRound
        && (!viewingPreviousRound || previousRoundWon);
    const roundDeleteLocked = selectedLogicRound <= currentRound - 2;
    const totalRounds = Math.max(1, (matchContext?.winsRequired ?? 1) * 2 - 1);
    const visibleConditionTypes = useMemo(
        () => conditionTypesForMatchup(CONDITION_TYPES, activeClass, activeOpponentClass),
        [activeClass, activeOpponentClass],
    );
    const visibleStateVariables = useMemo(() => {
        const visibleConditionIds = new Set(visibleConditionTypes.map((condition) => condition.id));
        return STATE_VARIABLES.filter((variable) => (
            (!variable.ownConditionId || visibleConditionIds.has(variable.ownConditionId))
            && (!variable.opponentConditionId || visibleConditionIds.has(variable.opponentConditionId))
        ));
    }, [visibleConditionTypes]);
    const defaultCondition = visibleConditionTypes[0] ?? CONDITION_TYPES[0];
    const defaultVariable = visibleStateVariables.find((variable) => variable.id === "target.distance")
        ?? visibleStateVariables[0]
        ?? STATE_VARIABLES[0];
    const visibleTargetTypes = useMemo(
        () => labelObjectTargetTypes(
            targetTypesForOpponentClass(activeOpponentClass),
            obstacleObjects,
        ),
        [activeOpponentClass, obstacleObjects],
    );
    useEffect(() => setSelectedLogicRound(currentRound), [currentRound]);
    const nodeKey = (type, id) => `${activeBrain}:${type}:${id}`;
    const positionForNode = (key, index, type = "block") => nodePositions[key] ?? {
        x: 120 + (index % 3) * 460,
        y: 100 + Math.floor(index / 3) * 420 + (type === "cluster" ? 60 : 0),
    };

    useEffect(() => {
        const sanitized = sanitizeConfigurationConditions(activeConfiguration, visibleConditionTypes, defaultCondition);
        if (sanitized === activeConfiguration) return;
        if (editingOpponent) onOpponentChange?.(sanitized);
        else onChange(sanitized);
    }, [activeConfiguration, activeClass, activeOpponentClass, defaultCondition, editingOpponent, onChange, onOpponentChange, visibleConditionTypes]);

    const addLogicBlock = () => {
        if (!viewingCurrentRound || currentRoundBlockCount >= roundBlockLimit) return;
        const block = {
            ...createLogicBlock(defaultCondition.id),
            conditions: [createExpressionCondition(defaultVariable.id)],
        };
        setActiveBlockId(block.id);
        updateBlocks([...(activeConfiguration.blocks ?? []), block]);
    };

    const addCluster = () => {
        if (!viewingCurrentRound || currentRoundBlockCount >= roundBlockLimit) return;
        const cluster = {
            ...createLogicCluster(defaultCondition.id),
            conditions: [createExpressionCondition(defaultVariable.id)],
        };
        updateClusters([...(activeConfiguration.clusters ?? []), cluster]);
    };

    const addClusterBlock = (clusterIndex) => {
        if (!viewingCurrentRound || currentRoundBlockCount >= roundBlockLimit) return;
        const block = {
            ...createLogicBlock(defaultCondition.id),
            conditions: [createExpressionCondition(defaultVariable.id)],
        };
        setActiveBlockId(block.id);
        updateCluster(clusterIndex, {
            blocks: [...((activeConfiguration.clusters ?? [])[clusterIndex]?.blocks ?? []), block],
        });
    };
    const updateDisplayedBlock = (index, updates) => {
        const id = displayedConfiguration.blocks?.[index]?.id;
        updateBlocks((activeConfiguration.blocks ?? []).map((block) => (
            block.id === id ? { ...block, ...updates } : block
        )));
    };
    const removeDisplayedBlock = (index) => {
        const id = displayedConfiguration.blocks?.[index]?.id;
        updateBlocks((activeConfiguration.blocks ?? []).filter((block) => block.id !== id));
    };
    const displayedClusterId = (index) => displayedConfiguration.clusters?.[index]?.id;
    const activeClusterIndex = (displayIndex) => (activeConfiguration.clusters ?? [])
        .findIndex((cluster) => cluster.id === displayedClusterId(displayIndex));

    const beginNodeDrag = (event, { key, index, type = "block", activeId = null }) => {
        if (isTraining || event.button !== 0) return;
        const position = positionForNode(key, index, type);
        setActiveBlockId(activeId);

        const moveDrag = (moveEvent) => {
            const nextX = clamp(position.x + (moveEvent.clientX - event.clientX) / canvasZoom, 24, LOGIC_CANVAS_WIDTH - 420);
            const nextY = clamp(position.y + (moveEvent.clientY - event.clientY) / canvasZoom, 24, LOGIC_CANVAS_HEIGHT - 360);
            setNodePositions((current) => ({
                ...current,
                [key]: { x: nextX, y: nextY },
            }));
        };

        const endDrag = () => {
            window.removeEventListener("pointermove", moveDrag);
            window.removeEventListener("pointerup", endDrag);
            window.removeEventListener("pointercancel", endDrag);
        };

        event.currentTarget.setPointerCapture?.(event.pointerId);
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
    };

    const changeZoom = (delta, origin = null) => {
        setCanvasZoom((currentZoom) => {
            const nextZoom = clamp(Number((currentZoom + delta).toFixed(2)), MIN_ZOOM, MAX_ZOOM);
            if (origin && nextZoom !== currentZoom) {
                setCanvasPan((currentPan) => ({
                    x: origin.x - ((origin.x - currentPan.x) / currentZoom) * nextZoom,
                    y: origin.y - ((origin.y - currentPan.y) / currentZoom) * nextZoom,
                }));
            }
            return nextZoom;
        });
    };

    return (
        <aside className="h-full min-h-0 w-80 flex-shrink-0 overflow-y-auto border-l border-border-lo bg-arena-panel p-4">
            <div className="space-y-4">
                {isMatchTraining && (
                    <section className="rounded border border-border-lo bg-arena-surface p-3 font-mono text-[10px] tracking-widest">
                        <div className="flex items-center justify-between text-ink-muted">
                            <span>ROUND</span>
                            <strong className="text-ink-white">{matchContext?.roundNumber ?? 1}/{totalRounds}</strong>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-ink-muted">
                            <span>TIME</span>
                            <strong className="text-amber-200">{formatClock(trainingRemaining)}</strong>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <ScoreBox label="YOU" value={playerRoundWins} tone="cyan" />
                            <ScoreBox label={matchContext?.opponent?.username ?? "OPP"} value={opponentRoundWins} tone="pink" />
                        </div>
                        {matchContext?.opponent?.finished && finishStatus !== "FINISHED" && (
                            <div className="mt-3 rounded border border-green-800/50 bg-green-950/30 px-2 py-2 text-green-300">
                                OPPONENT FINISHED
                            </div>
                        )}
                    </section>
                )}

                <section className="rounded border border-border-lo bg-arena-surface p-3">
                    <div className="flex items-center justify-between font-mono text-[10px] tracking-widest">
                        <span className="text-cyan">LOGIC BLOCKS</span>
                        <strong className="text-ink-muted">{countLogicBlocks(configuration)}/{MAX_LOGIC_BLOCKS}</strong>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsLogicOpen(true)}
                        className="mt-3 h-10 w-full rounded border border-cyan-800/70 bg-cyan-950/30 font-mono text-[11px] font-bold tracking-widest text-cyan-200 hover:bg-cyan-900/40"
                    >
                        OPEN LOGIC BLOCKS
                    </button>
                    {validation.errors.map((error) => <p key={error} className="mt-2 text-[10px] text-red-300">{error}</p>)}
                    <button
                        type="button"
                        onClick={isTraining ? onStopTraining : onStartTraining}
                        disabled={!isTraining && validation.errors.length > 0}
                        className={`mt-4 h-9 w-full rounded border font-mono text-[11px] font-bold tracking-widest disabled:opacity-40 ${isTraining
                            ? "border-red-700/60 bg-red-900/30 text-red-200"
                            : "border-green-700/60 bg-green-900/30 text-green-200"}`}
                    >
                        {isTraining ? "STOP CHECK" : "CHECK + SUBMIT"}
                    </button>
                </section>

                <section className="rounded border border-border-lo bg-arena-surface p-3">
                    <div className="mb-3 flex items-center justify-between font-mono text-[10px] tracking-widest">
                        <span className="text-cyan">MATCH TOOLS</span>
                        <span className="text-ink-muted">{selectedClass.toUpperCase()}</span>
                    </div>
                    {onClassChange && (
                        <ClassSelect
                            label={playerBotLabel}
                            value={selectedClass}
                            disabled={!canChangeClass}
                            onChange={onClassChange}
                        />
                    )}
                    {onOpponentClassChange && !isMatchTraining && (
                        <ClassSelect
                            label="Opponent bot"
                            value={opponentSelectedClass}
                            disabled={!canChangeOpponentClass}
                            onChange={onOpponentClassChange}
                            className="mb-3"
                        />
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                        <ControlButton
                            onClick={onAutoPlayToggle}
                            disabled={isBaseTraining || isTraining}
                            tone={isAutoPlaying ? "neutral" : "blue"}
                        >
                            {isAutoPlaying ? "STOP" : "AUTO PLAY"}
                        </ControlButton>
                        <ControlButton
                            onClick={onResetArenaStats}
                            disabled={!onResetArenaStats || isBaseTraining || isTraining}
                            tone="neutral"
                        >
                            RESET STATS
                        </ControlButton>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <ControlButton
                            onClick={onSaveArenaCheckpoint}
                            disabled={!onSaveArenaCheckpoint || isBaseTraining || isTraining || isAutoPlaying}
                            tone="amber"
                        >
                            SAVE POINT
                        </ControlButton>
                        <ControlButton
                            onClick={onResetArenaCheckpoint}
                            disabled={!onResetArenaCheckpoint || isBaseTraining || isTraining || !hasArenaCheckpoint}
                            tone="neutral"
                        >
                            LOAD POINT
                        </ControlButton>
                    </div>
                    <ControlButton
                        onClick={onFullArenaReset}
                        disabled={!onFullArenaReset || isBaseTraining || isTraining}
                        tone="red"
                        className="mt-1.5 w-full"
                    >
                        FULL RESET
                    </ControlButton>
                    <div className="mt-2 flex justify-between font-mono text-[10px] tracking-widest text-ink-muted">
                        <span>OBSTACLES</span>
                        <strong className="text-ink-white">{obstacleCount}</strong>
                    </div>
                    {isMatchTraining ? (
                        <>
                            <ControlButton
                                onClick={onResetRoundModel}
                                disabled={isBaseTraining || isTraining || finishStatus !== "TRAINING"}
                                tone="neutral"
                                className="mt-3 w-full"
                            >
                                RESET BRAIN
                            </ControlButton>
                            <ControlButton
                                onClick={onFinishMatch}
                                disabled={!canFinishMatch || finishStatus === "FINISHED" || finishStatus === "SURRENDERED" || isFinishingMatch || isTraining}
                                tone={finishStatus === "FINISHED" ? "green" : finishStatus === "SURRENDERED" ? "red" : "green"}
                                className="mt-2 w-full"
                            >
                                {finishStatus === "FINISHED"
                                    ? "FINISHED"
                                    : finishStatus === "SURRENDERED"
                                        ? "RESIGNED"
                                        : isFinishingMatch
                                            ? "SUBMITTING"
                                            : "FINISH BOT"}
                            </ControlButton>
                            <ControlButton
                                onClick={onSurrenderMatch}
                                disabled={!onSurrenderMatch || finishStatus === "SURRENDERED" || isFinishingMatch || isTraining}
                                tone="red"
                                className="mt-2 w-full"
                            >
                                GIVE UP
                            </ControlButton>
                        </>
                    ) : null}
                </section>
            </div>

            {isLogicOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 py-5">
                    <section className="flex h-[min(94vh,900px)] w-[min(98vw,1480px)] flex-col overflow-hidden rounded border border-border-mid bg-zinc-800 shadow-2xl">
                        <header className="flex min-h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-border-lo px-4 py-2">
                            <div>
                                <div className="font-mono text-[11px] font-bold tracking-widest text-cyan">LOGIC BLOCK WORKSPACE</div>
                                <div className="mt-1 font-mono text-[9px] tracking-widest text-ink-muted">
                                    {editingOpponent ? "TRAINING OPPONENT" : "YOUR BOT"} - {activeClass.toUpperCase()} - {totalActiveBlocks}/{MAX_LOGIC_BLOCKS} RULES
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {opponentConfiguration && onOpponentChange && (
                                    <div className="grid grid-cols-2 rounded border border-border-lo bg-zinc-950 p-0.5">
                                        <BrainTab active={activeBrain === "player"} onClick={() => setActiveBrain("player")}>{playerBotLabel}</BrainTab>
                                        <BrainTab active={activeBrain === "opponent"} onClick={() => setActiveBrain("opponent")}>Opponent bot</BrainTab>
                                    </div>
                                )}
                                <button
                                    type="button"
                                    disabled={isTraining || !viewingCurrentRound
                                        || totalActiveBlocks >= MAX_LOGIC_BLOCKS
                                        || currentRoundBlockCount >= roundBlockLimit}
                                    onClick={addLogicBlock}
                                    className="h-8 rounded border border-dashed border-cyan-800/70 px-3 font-mono text-[10px] tracking-widest text-cyan-300 disabled:opacity-35"
                                >
                                    ADD BLOCK
                                </button>
                                <button
                                    type="button"
                                    disabled={isTraining || !viewingCurrentRound
                                        || (activeConfiguration.clusters ?? []).length >= MAX_CLUSTERS
                                        || totalActiveBlocks >= MAX_LOGIC_BLOCKS
                                        || currentRoundBlockCount >= roundBlockLimit}
                                    onClick={addCluster}
                                    className="h-8 rounded border border-dashed border-violet-800/70 px-3 font-mono text-[10px] tracking-widest text-violet-300 disabled:opacity-35"
                                >
                                    ADD CLUSTER
                                </button>
                                <div className="flex items-center gap-1 rounded border border-border-lo bg-zinc-950 p-1">
                                    <button
                                        type="button"
                                        onClick={() => changeZoom(-0.1)}
                                        className="h-7 w-7 rounded bg-zinc-900 font-mono text-sm font-bold text-ink-mid hover:text-ink-white"
                                    >
                                        -
                                    </button>
                                    <span className="w-12 text-center font-mono text-[10px] tracking-widest text-ink-muted">
                                        {Math.round(canvasZoom * 100)}%
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => changeZoom(0.1)}
                                        className="h-7 w-7 rounded bg-zinc-900 font-mono text-sm font-bold text-ink-mid hover:text-ink-white"
                                    >
                                        +
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsLogicOpen(false)}
                                    className="h-8 rounded border border-border-lo bg-zinc-900 px-3 font-mono text-[10px] tracking-widest text-ink-mid hover:text-ink-white"
                                >
                                    CLOSE
                                </button>
                            </div>
                        </header>
                        {isMatchTraining && !editingOpponent && (
                            <div className="flex items-center gap-1 border-b border-border-lo bg-zinc-950 px-4 py-2">
                                {Array.from({ length: currentRound }, (_, index) => index + 1).map((round) => (
                                    <button
                                        key={round}
                                        type="button"
                                        onClick={() => setSelectedLogicRound(round)}
                                        className={`h-7 border px-3 font-mono text-[9px] tracking-widest ${
                                            selectedLogicRound === round
                                                ? "border-cyan-500 bg-cyan-950 text-cyan-100"
                                                : "border-border-lo bg-zinc-900 text-ink-muted"
                                        }`}
                                    >
                                        ROUND {round}
                                    </button>
                                ))}
                                <span className="ml-auto font-mono text-[9px] tracking-widest text-ink-muted">
                                    {viewingCurrentRound
                                        ? `${currentRoundBlockCount}/${roundBlockLimit} NEW BLOCKS`
                                        : roundFieldsLocked
                                            ? roundDeleteLocked ? "LOCKED" : "DELETE ONLY"
                                            : "MODIFY OR DELETE"}
                                </span>
                            </div>
                        )}
                        <LogicBoard
                            configuration={displayedConfiguration}
                            disabled={isTraining || roundDeleteLocked}
                            canRemove={!isTraining && !roundDeleteLocked}
                            activeBlockId={activeBlockId}
                            totalBlocks={totalActiveBlocks}
                            zoom={canvasZoom}
                            pan={canvasPan}
                            onPanChange={setCanvasPan}
                            onZoomChange={changeZoom}
                            positionForNode={positionForNode}
                            nodeKey={nodeKey}
                            onBeginNodeDrag={beginNodeDrag}
                            onBlockChange={roundFieldsLocked ? () => {} : updateDisplayedBlock}
                            onBlockRemove={removeDisplayedBlock}
                            onClusterChange={!viewingCurrentRound
                                ? () => {}
                                : (clusterIndex, updates) => updateCluster(activeClusterIndex(clusterIndex), updates)}
                            onClusterRemove={(clusterIndex) => {
                                const id = displayedClusterId(clusterIndex);
                                if (viewingCurrentRound) {
                                    updateClusters((activeConfiguration.clusters ?? []).filter((cluster) => cluster.id !== id));
                                    return;
                                }
                                const displayedIds = new Set(
                                    displayedConfiguration.clusters?.[clusterIndex]?.blocks?.map((block) => block.id) ?? [],
                                );
                                updateClusters((activeConfiguration.clusters ?? []).map((cluster) => (
                                    cluster.id === id
                                        ? { ...cluster, blocks: cluster.blocks.filter((block) => !displayedIds.has(block.id)) }
                                        : cluster
                                )));
                            }}
                            onClusterAddBlock={roundFieldsLocked
                                ? () => {}
                                : (clusterIndex) => addClusterBlock(activeClusterIndex(clusterIndex))}
                            onClusterBlockChange={roundFieldsLocked ? () => {} : (clusterIndex, blockIndex, updates) => updateCluster(activeClusterIndex(clusterIndex), {
                                blocks: (activeConfiguration.clusters ?? [])[activeClusterIndex(clusterIndex)].blocks.map((block) => (
                                    block.id === displayedConfiguration.clusters?.[clusterIndex]?.blocks?.[blockIndex]?.id
                                        ? { ...block, ...updates }
                                        : block
                                )),
                            })}
                            onClusterBlockRemove={(clusterIndex, blockIndex) => updateCluster(activeClusterIndex(clusterIndex), {
                                blocks: (activeConfiguration.clusters ?? [])[activeClusterIndex(clusterIndex)].blocks.filter((block) => (
                                    block.id !== displayedConfiguration.clusters?.[clusterIndex]?.blocks?.[blockIndex]?.id
                                )),
                            })}
                            onSelectBlock={setActiveBlockId}
                            selectedClass={activeClass}
                            conditionTypes={visibleConditionTypes}
                            stateVariables={visibleStateVariables}
                            defaultVariable={defaultVariable}
                            defaultCondition={defaultCondition}
                            targetTypes={visibleTargetTypes}
                        />
                    </section>
                </div>
            )}
        </aside>
    );
}

function LogicBoard({
    configuration,
    disabled,
    canRemove = true,
    activeBlockId,
    totalBlocks,
    zoom,
    pan,
    onPanChange,
    onZoomChange,
    positionForNode,
    nodeKey,
    onBeginNodeDrag,
    onBlockChange,
    onBlockRemove,
    onClusterChange,
    onClusterRemove,
    onClusterAddBlock,
    onClusterBlockChange,
    onClusterBlockRemove,
    onSelectBlock,
    selectedClass,
    conditionTypes,
    stateVariables,
    defaultVariable,
    defaultCondition,
    targetTypes,
}) {
    const viewportRef = useRef(null);
    const blocks = configuration.blocks ?? [];
    const clusters = configuration.clusters ?? [];
    const hasNodes = blocks.length > 0 || clusters.length > 0;

    const beginPan = (event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        const startPan = pan;
        const startX = event.clientX;
        const startY = event.clientY;

        const movePan = (moveEvent) => {
            onPanChange({
                x: startPan.x + moveEvent.clientX - startX,
                y: startPan.y + moveEvent.clientY - startY,
            });
        };

        const endPan = () => {
            window.removeEventListener("pointermove", movePan);
            window.removeEventListener("pointerup", endPan);
            window.removeEventListener("pointercancel", endPan);
        };

        window.addEventListener("pointermove", movePan);
        window.addEventListener("pointerup", endPan);
        window.addEventListener("pointercancel", endPan);
    };

    const handleWheel = (event) => {
        event.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        const origin = rect
            ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
            : null;
        onZoomChange(event.deltaY > 0 ? -0.06 : 0.06, origin);
    };

    return (
        <div
            ref={viewportRef}
            onPointerDown={beginPan}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={handleWheel}
            className="relative min-h-0 flex-1 overflow-hidden bg-zinc-900"
        >
            {!hasNodes && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] tracking-widest text-ink-muted">
                    ADD A LOGIC BLOCK OR CLUSTER TO START
                </div>
            )}
            <div
                className="absolute left-0 top-0"
                style={{
                    width: LOGIC_CANVAS_WIDTH,
                    height: LOGIC_CANVAS_HEIGHT,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "0 0",
                }}
            >
                <div className="absolute inset-0 bg-[linear-gradient(rgba(63,63,70,0.32)_1px,transparent_1px),linear-gradient(90deg,rgba(63,63,70,0.32)_1px,transparent_1px)] bg-[size:48px_48px]" />
                {blocks.map((block, blockIndex) => {
                    const key = nodeKey("block", block.id);
                    const position = positionForNode(key, blockIndex, "block");
                    return (
                        <LogicBlock
                            key={block.id}
                            block={block}
                            index={blockIndex}
                            disabled={disabled}
                            canRemove={canRemove}
                            onChange={(updates) => onBlockChange(blockIndex, updates)}
                            onRemove={() => onBlockRemove(blockIndex)}
                            className={`absolute shadow-xl ${activeBlockId === block.id ? "ring-1 ring-cyan-400" : ""}`}
                            style={{
                                left: position.x,
                                top: position.y,
                                width: LOGIC_BLOCK_WIDTH,
                                minHeight: LOGIC_BLOCK_HEIGHT_ESTIMATE,
                                zIndex: activeBlockId === block.id ? 20 : blockIndex + 1,
                            }}
                            onSelectBlock={() => onSelectBlock(block.id)}
                            selectedClass={selectedClass}
                            conditionTypes={conditionTypes}
                            defaultCondition={defaultCondition}
                            stateVariables={stateVariables}
                            defaultVariable={defaultVariable}
                            targetTypes={targetTypes}
                            onBlockPointerDown={(event) => onBeginNodeDrag(event, {
                                key,
                                index: blockIndex,
                                type: "block",
                                activeId: block.id,
                            })}
                        />
                    );
                })}
                {clusters.map((cluster, clusterIndex) => {
                    const key = nodeKey("cluster", cluster.id);
                    const position = positionForNode(key, blocks.length + clusterIndex, "cluster");
                    return (
                        <ClusterNode
                            key={cluster.id}
                            cluster={cluster}
                            index={clusterIndex}
                            disabled={disabled}
                            canRemove={canRemove}
                            totalBlocks={totalBlocks}
                            activeBlockId={activeBlockId}
                            onChange={(updates) => onClusterChange(clusterIndex, updates)}
                            onRemove={() => onClusterRemove(clusterIndex)}
                            onAddBlock={() => onClusterAddBlock(clusterIndex)}
                            onBlockChange={(blockIndex, updates) => onClusterBlockChange(clusterIndex, blockIndex, updates)}
                            onBlockRemove={(blockIndex) => onClusterBlockRemove(clusterIndex, blockIndex)}
                            onSelectBlock={onSelectBlock}
                            selectedClass={selectedClass}
                            conditionTypes={conditionTypes}
                            defaultCondition={defaultCondition}
                            stateVariables={stateVariables}
                            defaultVariable={defaultVariable}
                            targetTypes={targetTypes}
                            onNodePointerDown={(event) => onBeginNodeDrag(event, {
                                key,
                                index: blocks.length + clusterIndex,
                                type: "cluster",
                                activeId: cluster.id,
                            })}
                            style={{
                                left: position.x,
                                top: position.y,
                                width: CLUSTER_NODE_WIDTH,
                                zIndex: activeBlockId === cluster.id ? 20 : blocks.length + clusterIndex + 1,
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function ClusterNode({
    cluster,
    index,
    disabled,
    canRemove,
    totalBlocks,
    activeBlockId,
    onChange,
    onRemove,
    onAddBlock,
    onBlockChange,
    onBlockRemove,
    onSelectBlock,
    onNodePointerDown,
    style,
    selectedClass,
    conditionTypes,
    defaultCondition,
    stateVariables,
    defaultVariable,
    targetTypes,
}) {
    const updateConditions = (conditions) => onChange({ conditions });
    return (
        <section
            onPointerDown={(event) => {
                onSelectBlock(cluster.id);
                if (event.target?.closest?.("button,input,select,textarea,label")) return;
                onNodePointerDown(event);
            }}
            onDragStart={(event) => event.preventDefault()}
            className={`absolute cursor-move select-none rounded border border-violet-900/70 bg-zinc-950 p-3 shadow-xl ${activeBlockId === cluster.id ? "ring-1 ring-violet-300" : ""}`}
            style={style}
        >
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] tracking-widest">
                <div className="flex min-w-0 items-center gap-2">
                    <strong className="text-violet-200">CLUSTER {index + 1}</strong>
                    <input
                        type="text"
                        value={cluster.name}
                        disabled={disabled}
                        onChange={(event) => onChange({ name: event.target.value })}
                        className="h-8 min-w-0 rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[10px] text-ink-white"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-ink-muted">PRIORITY</label>
                    <input
                        type="number"
                        min={MIN_PRIORITY}
                        max={MAX_PRIORITY}
                        value={cluster.priority ?? 1}
                        disabled={disabled}
                        onChange={(event) => onChange({ priority: clampNumber(event.target.value, MIN_PRIORITY, MAX_PRIORITY, 1) })}
                        className="h-8 w-16 rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[10px] text-ink-white"
                    />
                    <button type="button" disabled={!canRemove} onClick={onRemove} className="text-red-300 disabled:opacity-35">REMOVE</button>
                </div>
            </div>
            <div className="mt-3 grid gap-3">
                <div className="rounded border border-border-lo bg-zinc-900 p-3">
                    <div className="mb-2 font-mono text-[9px] tracking-widest text-ink-muted">CLUSTER CONDITIONS</div>
                    <div className="grid gap-2">
                        {cluster.conditions.map((condition, conditionIndex) => (
                            <ConditionEditor
                                key={`${conditionIndex}-${condition.type}`}
                                condition={condition}
                                prefix={conditionIndex ? (condition.join === "or" ? "OR" : "AND") : "IF"}
                                canChangeJoin={conditionIndex > 0}
                                onChange={(next) => updateConditions(cluster.conditions.map((value, candidate) => candidate === conditionIndex ? next : value))}
                                onRemove={() => updateConditions(cluster.conditions.filter((_, candidate) => candidate !== conditionIndex))}
                                removable={cluster.conditions.length > 1}
                                conditionTypes={conditionTypes}
                                stateVariables={stateVariables}
                                defaultVariable={defaultVariable}
                                targetTypes={targetTypes}
                            />
                        ))}
                    </div>
                    {cluster.conditions.length < MAX_CONDITIONS_PER_BLOCK && (
                        <button
                            type="button"
                            disabled={disabled}
                            canRemove={canRemove}
                            onClick={() => updateConditions([...cluster.conditions, createExpressionCondition(defaultVariable.id)])}
                            className="mt-2 font-mono text-[9px] tracking-widest text-cyan-300 disabled:opacity-35"
                        >+ CONDITION</button>
                    )}
                </div>
                <div className="flex items-center justify-between border-t border-border-lo pt-3 font-mono text-[10px] tracking-widest">
                    <span className="text-ink-muted">{cluster.blocks.length} BLOCKS</span>
                    <button
                        type="button"
                        disabled={disabled || totalBlocks >= MAX_LOGIC_BLOCKS}
                        onClick={onAddBlock}
                        className="h-8 rounded border border-dashed border-cyan-800/70 px-3 text-cyan-300 disabled:opacity-35"
                    >
                        ADD BLOCK
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-3" onPointerDown={(event) => event.stopPropagation()}>
                    {cluster.blocks.map((block, blockIndex) => (
                        <LogicBlock
                            key={block.id}
                            block={block}
                            index={blockIndex}
                            disabled={disabled}
                            onChange={(updates) => onBlockChange(blockIndex, updates)}
                            onRemove={() => onBlockRemove(blockIndex)}
                            className={activeBlockId === block.id ? "ring-1 ring-cyan-400" : ""}
                            style={{ width: LOGIC_BLOCK_WIDTH, minHeight: LOGIC_BLOCK_HEIGHT_ESTIMATE }}
                            onSelectBlock={() => onSelectBlock(block.id)}
                            selectedClass={selectedClass}
                            conditionTypes={conditionTypes}
                            defaultCondition={defaultCondition}
                            stateVariables={stateVariables}
                            defaultVariable={defaultVariable}
                            targetTypes={targetTypes}
                            conditionsOptional
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}

function LogicBlock({
    block,
    index,
    disabled,
    canRemove = true,
    onChange,
    onRemove,
    className = "",
    style = null,
    onSelectBlock = null,
    onBlockPointerDown = null,
    selectedClass = "melee",
    conditionTypes = CONDITION_TYPES,
    defaultCondition = CONDITION_TYPES[0],
    stateVariables = STATE_VARIABLES,
    defaultVariable = STATE_VARIABLES[0],
    targetTypes = TARGET_TYPES,
    conditionsOptional = false,
}) {
    const updateConditions = (conditions) => onChange({ conditions });
    const conditions = Array.isArray(block.conditions) ? block.conditions : [];
    const actionTypes = actionTypesForCombatClass(ACTION_TYPES, selectedClass);
    const selectedAction = actionTypes.find((action) => action.id === block.action) ?? actionTypes[0] ?? ACTION_TYPES[0];
    const isDashVeto = selectedAction.id === "no_dash";
    return (
        <fieldset
            disabled={disabled}
            onPointerDown={(event) => {
                onSelectBlock?.();
                if (event.target?.closest?.("button,input,select,textarea,label")) return;
                onBlockPointerDown?.(event);
            }}
            onDragStart={(event) => event.preventDefault()}
            className={`select-none rounded border border-border-lo bg-zinc-950 p-3 ${onBlockPointerDown ? "cursor-move" : ""} ${className}`}
            style={style}
        >
            <div
                className="flex items-center justify-between font-mono text-[10px] tracking-widest"
            >
                <strong className="text-cyan-200">IF BLOCK {index + 1}</strong>
                <button type="button" disabled={!canRemove} onPointerDown={(event) => event.stopPropagation()} onClick={onRemove} className="text-red-300 disabled:opacity-35">REMOVE</button>
            </div>
            <label className="mt-3 block font-mono text-[9px] tracking-widest text-ink-muted">PRIORITY</label>
            <input
                type="number"
                min={MIN_PRIORITY}
                max={MAX_PRIORITY}
                value={block.priority ?? 1}
                onChange={(event) => onChange({ priority: clampNumber(event.target.value, MIN_PRIORITY, MAX_PRIORITY, 1) })}
                className="mt-1 h-8 w-20 rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[10px] text-ink-white"
            />
            <div className="mt-2 grid gap-2">
                {conditions.map((condition, conditionIndex) => (
                    <ConditionEditor
                        key={`${conditionIndex}-${condition.type}`}
                        condition={condition}
                        prefix={conditionIndex ? (condition.join === "or" ? "OR" : "AND") : "IF"}
                        canChangeJoin={conditionIndex > 0}
                        onChange={(next) => updateConditions(conditions.map((value, index) => index === conditionIndex ? next : value))}
                        onRemove={() => updateConditions(conditions.filter((_, index) => index !== conditionIndex))}
                        removable={conditionsOptional || conditions.length > 1}
                        conditionTypes={conditionTypes}
                        stateVariables={stateVariables}
                        defaultVariable={defaultVariable}
                        targetTypes={targetTypes}
                    />
                ))}
            </div>
            {conditions.length < MAX_CONDITIONS_PER_BLOCK && (
                <button
                    type="button"
                    onClick={() => updateConditions([...conditions, createExpressionCondition(defaultVariable.id)])}
                    className="mt-2 font-mono text-[9px] tracking-widest text-cyan-300"
                >+ CONDITION</button>
            )}
            <label className="mt-3 block font-mono text-[9px] tracking-widest text-ink-muted">THEN</label>
            <select
                value={selectedAction.id}
                onChange={(event) => onChange({ action: event.target.value })}
                className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-ink-white"
            >
                {actionTypes.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
            </select>
            {actionSupportsTarget(selectedAction) && (
                <>
                    <label className="mt-2 block font-mono text-[9px] tracking-widest text-ink-muted">TARGET</label>
                    <select
                        value={block.actionTarget ?? "opponent"}
                        onChange={(event) => onChange({ actionTarget: event.target.value })}
                        className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-ink-white"
                    >
                        {targetTypes.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                    </select>
                </>
            )}
            {isDashVeto ? (
                <div className="mt-3 rounded border border-border-lo bg-zinc-950 px-2 py-2 font-mono text-[9px] tracking-widest text-ink-muted">
                    DASH VETO
                </div>
            ) : (
                <div className="mt-3 rounded border border-border-lo bg-zinc-950 px-2 py-2 font-mono text-[9px] tracking-widest text-ink-muted">
                    PRIORITY ACTION
                </div>
            )}
        </fieldset>
    );
}

function ConditionEditor({
    condition,
    prefix,
    canChangeJoin = false,
    onChange,
    onRemove,
    removable,
    conditionTypes = CONDITION_TYPES,
    stateVariables = STATE_VARIABLES,
    defaultVariable = STATE_VARIABLES[0],
    targetTypes = TARGET_TYPES,
}) {
    if (condition?.type === "expression") {
        return (
            <ExpressionConditionEditor
                condition={condition}
                prefix={prefix}
                canChangeJoin={canChangeJoin}
                onChange={onChange}
                onRemove={onRemove}
                removable={removable}
                stateVariables={stateVariables}
                defaultVariable={defaultVariable}
                targetTypes={targetTypes}
            />
        );
    }
    const visibleConditionTypes = conditionTypes.length ? conditionTypes : CONDITION_TYPES;
    const legacyDefinition = CONDITION_DEFINITIONS.find((candidate) => (
        candidate.id === condition.type
        && !CONDITION_TYPES.some((current) => current.id === candidate.id)
    ));
    const definition = visibleConditionTypes.find((candidate) => candidate.id === condition.type)
        ?? legacyDefinition
        ?? visibleConditionTypes[0]
        ?? CONDITION_TYPES[0];
    const targetOptions = definition.targetGroup === "objects"
        ? objectTargetTypes(targetTypes)
        : targetTypes;
    const selectedTarget = targetOptions.some((target) => target.id === condition.target)
        ? condition.target
        : definition.defaultTarget ?? "opponent";
    const selectType = (type) => {
        if (type === "expression") {
            onChange({
                ...createExpressionCondition(defaultVariable.id),
                ...(condition.join === "or" ? { join: "or" } : {}),
            });
            return;
        }
        const next = visibleConditionTypes.find((candidate) => candidate.id === type) ?? visibleConditionTypes[0];
        onChange({
            type,
            ...(condition.join === "or" ? { join: "or" } : {}),
            ...(next.requiresValue ? { value: next.defaultValue } : {}),
            ...(next.supportsTarget ? { target: next.defaultTarget ?? "opponent" } : {}),
        });
    };
    return (
        <div className="grid grid-cols-[42px_1fr_auto] items-center gap-1">
            <ConditionJoinControl
                prefix={prefix}
                canChangeJoin={canChangeJoin}
                condition={condition}
                onChange={onChange}
            />
            <div className="flex gap-1">
                <select value={definition.id} onChange={(event) => selectType(event.target.value)} className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white">
                    {!visibleConditionTypes.some((candidate) => candidate.id === definition.id) && (
                        <option value={definition.id}>{definition.label}</option>
                    )}
                    {groupedConditionTypes(visibleConditionTypes).map(({ group, conditions }) => (
                        <optgroup key={group} label={group}>
                            {conditions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                        </optgroup>
                    ))}
                </select>
                {definition.requiresValue && (
                    <div className="flex h-8 items-center gap-1">
                        <input
                            type="number"
                            min={definition.min}
                            max={definition.max}
                            value={condition.value}
                            onChange={(event) => onChange({ ...condition, value: event.target.value })}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    onChange({
                                        ...condition,
                                        value: clampNumber(
                                            event.currentTarget.value,
                                            definition.min,
                                            definition.max,
                                            definition.defaultValue,
                                        ),
                                    });
                                }
                            }}
                            className="h-8 w-16 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        />
                        {definition.suffix && (
                            <span className="font-mono text-[9px] text-ink-muted">{definition.suffix}</span>
                        )}
                    </div>
                )}
                {definition.supportsTarget && (
                    <select
                        value={selectedTarget}
                        onChange={(event) => onChange({ ...condition, target: event.target.value })}
                        className="h-8 w-24 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                    >
                        {targetOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                    </select>
                )}
            </div>
            {removable ? <button type="button" onClick={onRemove} className="text-red-300">x</button> : <span />}
        </div>
    );
}

function ExpressionConditionEditor({
    condition,
    prefix,
    canChangeJoin = false,
    onChange,
    onRemove,
    removable,
    stateVariables,
    defaultVariable,
    targetTypes,
}) {
    const variables = stateVariables.length ? stateVariables : STATE_VARIABLES;
    const leftDefinition = variables.find((variable) => variable.id === condition.left)
        ?? defaultVariable
        ?? variables[0]
        ?? STATE_VARIABLES[0];
    const rightVariableDefinition = condition.right?.type === "variable"
        ? variables.find((variable) => variable.id === condition.right.value)
        : null;
    const valueType = leftDefinition.valueType;
    const comparators = CONDITION_COMPARATORS.filter((comparator) => comparator.valueTypes.includes(valueType));
    const comparator = comparators.some((candidate) => candidate.id === condition.comparator)
        ? condition.comparator
        : comparators[0]?.id ?? "eq";
    const numericVariables = variables.filter((variable) => variable.valueType === "number");
    const canUseVariableOperand = valueType === "number" && numericVariables.length > 0;
    const targetGroup = expressionTargetGroup(leftDefinition, rightVariableDefinition);
    const targetOptions = targetGroup === "objects"
        ? objectTargetTypes(targetTypes)
        : targetTypes;
    const showTarget = leftDefinition.supportsTarget || Boolean(rightVariableDefinition?.supportsTarget);
    const selectedTarget = targetOptions.some((target) => target.id === condition.target)
        ? condition.target
        : targetGroup === "objects" ? "object_1" : "opponent";

    const changeLeft = (left) => {
        const nextLeft = variables.find((variable) => variable.id === left) ?? variables[0];
        onChange({
            ...createExpressionCondition(nextLeft.id),
            ...(condition.join === "or" ? { join: "or" } : {}),
        });
    };
    const changeRightType = (type) => {
        if (type === "variable") {
            onChange({
                ...condition,
                right: { type: "variable", value: numericVariables[0]?.id ?? "my.hp" },
            });
            return;
        }
        onChange({
            ...condition,
            right: { type: "number", value: leftDefinition.defaultValue },
        });
    };

    return (
        <div className="grid grid-cols-[42px_1fr_auto] items-center gap-1">
            <ConditionJoinControl
                prefix={prefix}
                canChangeJoin={canChangeJoin}
                condition={condition}
                onChange={onChange}
            />
            <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] gap-1">
                <select
                    value={leftDefinition.id}
                    onChange={(event) => changeLeft(event.target.value)}
                    className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                >
                    {groupedStateVariables(variables).map(({ group, variables: groupedVariables }) => (
                        <optgroup key={group} label={group}>
                            {groupedVariables.map((variable) => (
                                <option key={variable.id} value={variable.id}>{variable.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                {valueType === "boolean" ? (
                    <span className="flex h-8 items-center rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-ink-muted">IS</span>
                ) : (
                    <select
                        value={comparator}
                        onChange={(event) => onChange({ ...condition, comparator: event.target.value })}
                        className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                    >
                        {comparators.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                        ))}
                    </select>
                )}
                {valueType === "boolean" ? (
                    <select
                        value={String(condition.right?.value ?? true)}
                        onChange={(event) => onChange({
                            ...condition,
                            comparator: "eq",
                            right: { type: "boolean", value: event.target.value === "true" },
                        })}
                        className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                    >
                        <option value="true">TRUE</option>
                        <option value="false">FALSE</option>
                    </select>
                ) : (
                    <div className="flex min-w-0 gap-1">
                        <select
                            value={condition.right?.type === "variable" ? "variable" : "number"}
                            onChange={(event) => changeRightType(event.target.value)}
                            className="h-8 w-16 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        >
                            <option value="number">#</option>
                            {canUseVariableOperand && <option value="variable">VAR</option>}
                        </select>
                        {condition.right?.type === "variable" ? (
                            <select
                                value={rightVariableDefinition?.id ?? numericVariables[0]?.id}
                                onChange={(event) => onChange({
                                    ...condition,
                                    right: { type: "variable", value: event.target.value },
                                })}
                                className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                            >
                                {groupedStateVariables(numericVariables).map(({ group, variables: groupedVariables }) => (
                                    <optgroup key={group} label={group}>
                                        {groupedVariables.map((variable) => (
                                            <option key={variable.id} value={variable.id}>{variable.label}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        ) : (
                            <div className="flex min-w-0 flex-1 items-center gap-1">
                                <input
                                    type="number"
                                    min={leftDefinition.min}
                                    max={leftDefinition.max}
                                    step={leftDefinition.step ?? 1}
                                    value={condition.right?.value ?? leftDefinition.defaultValue}
                                    onChange={(event) => onChange({
                                        ...condition,
                                        right: { type: "number", value: event.target.value },
                                    })}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            onChange({
                                                ...condition,
                                                right: {
                                                    type: "number",
                                                    value: clampNumber(
                                                        event.currentTarget.value,
                                                        leftDefinition.min,
                                                        leftDefinition.max,
                                                        leftDefinition.defaultValue,
                                                    ),
                                                },
                                            });
                                        }
                                    }}
                                    className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                                />
                                {leftDefinition.suffix && (
                                    <span className="font-mono text-[9px] text-ink-muted">{leftDefinition.suffix}</span>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {showTarget && (
                    <select
                        value={selectedTarget}
                        onChange={(event) => onChange({ ...condition, target: event.target.value })}
                        className="col-span-3 h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                    >
                        {targetOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                    </select>
                )}
            </div>
            {removable ? <button type="button" onClick={onRemove} className="text-red-300">x</button> : <span />}
        </div>
    );
}

function ConditionJoinControl({ prefix, canChangeJoin, condition, onChange }) {
    if (!canChangeJoin) {
        return <span className="font-mono text-[9px] text-amber-200">{prefix}</span>;
    }
    return (
        <select
            value={condition.join === "or" ? "or" : "and"}
            onChange={(event) => onChange({
                ...condition,
                ...(event.target.value === "or" ? { join: "or" } : { join: undefined }),
            })}
            className="h-8 rounded border border-border-lo bg-zinc-950 px-0.5 font-mono text-[8px] text-amber-200"
        >
            <option value="and">AND</option>
            <option value="or">OR</option>
        </select>
    );
}

function sanitizeConfigurationConditions(configuration, conditionTypes, defaultCondition) {
    const allowedIds = new Set(conditionTypes.map((condition) => condition.id));
    const sanitizeConditions = (conditions) => {
        if (!Array.isArray(conditions)) return conditions;
        let changed = false;
        const nextConditions = conditions.map((condition) => {
            if (condition?.type === "expression") {
                return condition;
            }
            if (allowedIds.has(condition?.type)) return condition;
            changed = true;
            return createDefaultCondition(defaultCondition);
        });
        return changed ? nextConditions : conditions;
    };
    const sanitizeBlock = (block) => {
        const conditions = sanitizeConditions(block?.conditions);
        return conditions === block?.conditions ? block : { ...block, conditions };
    };

    let changed = false;
    const blocks = Array.isArray(configuration?.blocks)
        ? configuration.blocks.map((block) => {
            const nextBlock = sanitizeBlock(block);
            if (nextBlock !== block) changed = true;
            return nextBlock;
        })
        : configuration?.blocks;
    const clusters = Array.isArray(configuration?.clusters)
        ? configuration.clusters.map((cluster) => {
            const conditions = sanitizeConditions(cluster?.conditions);
            let blockChanged = false;
            const clusterBlocks = Array.isArray(cluster?.blocks)
                ? cluster.blocks.map((block) => {
                    const nextBlock = sanitizeBlock(block);
                    if (nextBlock !== block) blockChanged = true;
                    return nextBlock;
                })
                : cluster?.blocks;
            if (conditions !== cluster?.conditions || blockChanged) {
                changed = true;
                return { ...cluster, conditions, blocks: clusterBlocks };
            }
            return cluster;
        })
        : configuration?.clusters;

    return changed ? { ...configuration, blocks, clusters } : configuration;
}

function ScoreBox({ label, value, tone }) {
    const color = tone === "cyan" ? "text-cyan-200" : "text-fuchsia-200";
    return (
        <div className="rounded border border-border-lo bg-zinc-950/50 p-2">
            <div className={`truncate ${color}`}>{label}</div>
            <div className="mt-1 text-base text-ink-white">{value}</div>
        </div>
    );
}

function ClassSelect({ label, value, disabled, onChange, className = "mb-2" }) {
    return (
        <label className={`block ${className}`}>
            <span className="mb-1 block font-mono text-[9px] tracking-widest text-ink-muted">{label}</span>
            <select
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                className="h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] font-bold tracking-widest text-ink-white disabled:cursor-not-allowed disabled:opacity-45"
            >
                {Object.values(COMBAT_CLASSES).map((combatClass) => (
                    <option key={combatClass.id} value={combatClass.id}>
                        {combatClass.label ?? combatClass.id.toUpperCase()}
                    </option>
                ))}
            </select>
        </label>
    );
}

function ControlButton({ children, onClick, disabled, tone = "neutral", className = "" }) {
    const tones = {
        neutral: "border-border-lo bg-zinc-900 text-ink-mid hover:bg-zinc-800 hover:text-ink-white",
        blue: "border-blue-800/50 bg-blue-900/40 text-blue-200 hover:bg-blue-800",
        green: "border-green-700/60 bg-green-900/30 text-green-200 hover:bg-green-800/40",
        red: "border-red-700/60 bg-red-900/30 text-red-200 hover:bg-red-800/40",
        violet: "border-violet-800/50 bg-violet-900/40 text-violet-200 hover:bg-violet-800",
        amber: "border-amber-800/50 bg-amber-900/40 text-amber-200 hover:bg-amber-800",
    };
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`min-h-7 rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-widest disabled:cursor-not-allowed disabled:opacity-35 ${tones[tone] ?? tones.neutral} ${className}`}
        >
            {children}
        </button>
    );
}

function BrainTab({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`min-h-7 rounded px-2 font-mono text-[9px] font-bold tracking-widest ${active
                ? "bg-cyan-950 text-cyan-200"
                : "bg-transparent text-ink-muted hover:text-ink-white"}`}
        >
            {children}
        </button>
    );
}

function countLogicBlocks(configuration) {
    return (configuration.blocks?.length ?? 0)
        + (configuration.clusters ?? []).reduce((total, cluster) => total + (cluster.blocks?.length ?? 0), 0);
}

function allLogicBlocks(configuration) {
    return [
        ...(configuration?.blocks ?? []),
        ...(configuration?.clusters ?? []).flatMap((cluster) => cluster.blocks ?? []),
    ];
}

function blockIntroductionRounds(roundBrains, configuration, currentRound) {
    const roundsById = new Map();
    [...roundBrains]
        .sort((first, second) => first.roundNumber - second.roundNumber)
        .forEach((round) => {
            allLogicBlocks(round.brain).forEach((block) => {
                if (block?.id && !roundsById.has(block.id)) {
                    roundsById.set(block.id, round.roundNumber);
                }
            });
        });
    allLogicBlocks(configuration).forEach((block) => {
        if (block?.id && !roundsById.has(block.id)) {
            roundsById.set(block.id, currentRound);
        }
    });
    return roundsById;
}

function configurationForRound(configuration, roundsById, roundNumber) {
    return {
        ...configuration,
        blocks: (configuration?.blocks ?? []).filter((block) => roundsById.get(block.id) === roundNumber),
        clusters: (configuration?.clusters ?? [])
            .map((cluster) => ({
                ...cluster,
                blocks: (cluster.blocks ?? []).filter((block) => roundsById.get(block.id) === roundNumber),
            }))
            .filter((cluster) => cluster.blocks.length > 0),
    };
}

function createDefaultCondition(definition) {
    if (definition.id === "expression") {
        return createExpressionCondition("target.distance");
    }
    return {
        type: definition.id,
        ...(definition.requiresValue ? { value: definition.defaultValue } : {}),
        ...(definition.supportsTarget ? { target: definition.defaultTarget ?? "opponent" } : {}),
    };
}

function groupedConditionTypes(conditionTypes = CONDITION_TYPES) {
    return CONDITION_GROUP_ORDER
        .map((group) => ({
            group,
            conditions: conditionTypes.filter((condition) => (condition.group ?? "General") === group),
        }))
        .filter((entry) => entry.conditions.length > 0);
}

function groupedStateVariables(stateVariables = STATE_VARIABLES) {
    return CONDITION_GROUP_ORDER
        .map((group) => ({
            group,
            variables: stateVariables.filter((variable) => (variable.group ?? "General") === group),
        }))
        .filter((entry) => entry.variables.length > 0);
}

function targetTypesForOpponentClass(opponentClass) {
    return TARGET_TYPES
        .filter((target) => target.id !== "opponent_grenade" || opponentClass === "ranged")
        .filter((target) => target.id !== "opponent_fireball" || opponentClass === "mage");
}

function objectTargetTypes(targetTypes = TARGET_TYPES) {
    return targetTypes.filter((target) => (
        target.id.startsWith("object_")
        || target.id === "opponent_grenade"
        || target.id === "opponent_fireball"
    ));
}

function expressionTargetGroup(leftDefinition, rightDefinition) {
    return leftDefinition?.targetGroup ?? rightDefinition?.targetGroup ?? null;
}

function formatClock(value) {
    if (value == null) return "--:--";
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
