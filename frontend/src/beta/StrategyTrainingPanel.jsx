import { useEffect, useMemo, useRef, useState } from "react";
import {
    ACTION_TYPES,
    CONDITION_DEFINITIONS,
    CONDITION_TYPES,
    TARGET_TYPES,
    CONDITION_COMPARATORS,
    STATE_VARIABLES,
    actionExecutionHead,
    actionSupportsTarget,
    createLogicBlock,
    createLogicColumn,
    createExpressionCondition,
    MAX_CONDITIONS_PER_BLOCK,
    MAX_LOGIC_BLOCKS,
    MAX_TOTAL_CONDITIONS,
    MAX_PRIORITY,
    MIN_PRIORITY,
    moveLogicColumnPriority,
    validateMeleeStrategyConfiguration,
    normalizeMeleeStrategyConfiguration,
} from "../logic/BotBrain.js";
import {
    actionTypesForCombatClass,
    conditionTypesForMatchup,
} from "./combat/CombatLoadouts.js";
import { BOT_ABILITIES, decodeBotLoadout, decodeSandboxLoadout } from "./loadout/BotLoadout.js";

const CONDITION_GROUP_ORDER = ["Basic", "My Bot", "Opponent", "Objects", "Target", "General"];
const LEGACY_MOVEMENT_ACTION = /^(move_(?!walk$)|dash_(?!$)|micro_dash_)/;
const LOGIC_BLOCK_WIDTH = 500;
const LOGIC_BLOCK_HEIGHT_ESTIMATE = 320;
// Used only while rendering a brain that is being migrated from the pre-tree schema.
const CLUSTER_NODE_WIDTH = 1080;
const LOGIC_CANVAS_WIDTH = 3400;
const LOGIC_CANVAS_HEIGHT = 2400;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.35;

function clampNumber(value, min, max, fallback, step = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const bounded = Math.max(min, Math.min(max, numeric));
    return Number((Math.round(bounded / step) * step).toFixed(10));
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
    opponentSelectedClass = "melee",
    isMatchTraining = false,
    matchContext = null,
    trainingRemaining = null,
    playerRoundWins = 0,
    opponentRoundWins = 0,
    isAutoPlaying = false,
    hasArenaCheckpoint = false,
    measurementEnabled = false,
    onMeasurementToggle,
    isBaseTraining = false,
    finishStatus = null,
    finishError = null,
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
    onOpenPlayerLoadout,
    onOpenOpponentLoadout,
    onSpawnOpponent,
}) {
    const [isLogicOpen, setIsLogicOpen] = useState(false);
    const [activeBrain, setActiveBrain] = useState("player");
    const [canvasZoom, setCanvasZoom] = useState(0.85);
    const [canvasPan, setCanvasPan] = useState({ x: 40, y: 36 });
    const currentRound = Math.max(1, Number(matchContext?.roundNumber) || 1);
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
    const updateColumns = (columns) => updateActiveConfiguration({
        version: "melee-logic-tree-v1",
        columns,
        blocks: [],
        clusters: [],
    });
    const totalActiveBlocks = countLogicBlocks(activeConfiguration);
    const totalActiveConditions = countLogicConditions(activeConfiguration);
    const usesTree = Array.isArray(activeConfiguration?.columns);
    const viewingCurrentRound = true;
    const roundDeleteLocked = false;
    const selectedLogicRound = currentRound;
    const currentRoundBlockCount = totalActiveBlocks;
    const roundBlockLimit = MAX_LOGIC_BLOCKS;
    const totalRounds = isMatchTraining ? 3 : Math.max(1, (matchContext?.winsRequired ?? 1) * 2 - 1);
    const visibleConditionTypes = useMemo(
        () => {
            const matchupConditionTypes = conditionTypesForMatchup(CONDITION_TYPES, activeClass, activeOpponentClass);
            if (matchupConditionTypes.some((condition) => condition.id === "always")) return matchupConditionTypes;
            const alwaysCondition = CONDITION_TYPES.find((condition) => condition.id === "always");
            return alwaysCondition ? [alwaysCondition, ...matchupConditionTypes] : matchupConditionTypes;
        },
        [activeClass, activeOpponentClass],
    );
    const visibleStateVariables = useMemo(() => {
        const visibleConditionIds = new Set(visibleConditionTypes.map((condition) => condition.id));
        const ownAbilities = abilityIdsForConfiguration(activeClass);
        const opponentAbilities = abilityIdsForConfiguration(activeOpponentClass);
        return STATE_VARIABLES.filter((variable) => (
            (!variable.ownConditionId || visibleConditionIds.has(variable.ownConditionId))
            && (!variable.opponentConditionId || visibleConditionIds.has(variable.opponentConditionId))
        )).map((variable) => {
            if (!variable.supportsAbility) return variable;
            const equipped = variable.abilityOwner === "opponent" ? opponentAbilities : ownAbilities;
            return {
                ...variable,
                abilityOptions: BOT_ABILITIES.filter((ability) => equipped.has(ability.id) && (!variable.requiredTag || ability.tags.includes(variable.requiredTag))),
            };
        }).filter((variable) => !variable.supportsAbility || variable.abilityOptions.length > 0);
    }, [visibleConditionTypes, activeClass, activeOpponentClass]);
    const defaultCondition = visibleConditionTypes[0] ?? CONDITION_TYPES[0];
    const defaultVariable = visibleStateVariables.find((variable) => variable.id === "target.distance")
        ?? visibleStateVariables[0]
        ?? STATE_VARIABLES[0];
    const visibleTargetTypes = useMemo(
        () => targetTypesForLoadouts(activeClass, activeOpponentClass),
        [activeClass, activeOpponentClass],
    );
    useEffect(() => {
        const sanitized = sanitizeConfigurationConditions(activeConfiguration, visibleConditionTypes, defaultCondition);
        if (sanitized === activeConfiguration) return;
        if (editingOpponent) onOpponentChange?.(sanitized);
        else onChange(sanitized);
    }, [activeConfiguration, activeClass, activeOpponentClass, defaultCondition, editingOpponent, onChange, onOpponentChange, visibleConditionTypes]);

    useEffect(() => {
        if (!isLogicOpen || usesTree) return;
        const migrated = normalizeMeleeStrategyConfiguration(activeConfiguration);
        const tree = { version: migrated.version, columns: migrated.columns, blocks: [], clusters: [] };
        if (editingOpponent) onOpponentChange?.(tree);
        else onChange(tree);
    }, [activeConfiguration, editingOpponent, isLogicOpen, onChange, onOpponentChange, usesTree]);

    const addLogicColumn = () => {
        if (totalActiveConditions >= MAX_TOTAL_CONDITIONS) return;
        const column = createLogicColumn(`Column ${(activeConfiguration.columns ?? []).length + 1}`);
        const block = {
            ...createLogicBlock(defaultCondition.id, "none"),
            branchType: "if",
            createdOrder: Date.now(),
            conditions: [createExpressionCondition(defaultVariable.id)],
            actions: [],
            children: [],
        };
        column.branches = [block];
        updateColumns([...(activeConfiguration.columns ?? []), column]);
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
                        <span className="text-cyan">BOT BRAIN</span>
                        <strong className="text-ink-muted">{countLogicBlocks(configuration)}/{MAX_LOGIC_BLOCKS} A · {countLogicConditions(configuration)}/{MAX_TOTAL_CONDITIONS} C</strong>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsLogicOpen(true)}
                        className="mt-3 h-10 w-full rounded border border-cyan-800/70 bg-cyan-950/30 font-mono text-[11px] font-bold tracking-widest text-cyan-200 hover:bg-cyan-900/40"
                    >
                        OPEN BOT BRAIN
                    </button>
                    {validation.errors.map((error) => <p key={error} className="mt-2 text-[10px] text-red-300">{error}</p>)}
                    {validation.warnings?.map((warning) => <p key={warning} className="mt-2 text-[10px] text-amber-300">WARNING: {warning}</p>)}
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
                        <span className="text-ink-muted">BOT LOADOUT</span>
                    </div>
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
                    <ControlButton onClick={onMeasurementToggle} disabled={!onMeasurementToggle} tone={measurementEnabled ? "blue" : "neutral"} className="mt-2 w-full">
                        {measurementEnabled ? "MEASURING ON" : "MEASURING OFF"}
                    </ControlButton>
                    {!isMatchTraining && (
                        <div className="mt-2 grid grid-cols-1 gap-1.5">
                            <ControlButton onClick={onOpenPlayerLoadout} disabled={!onOpenPlayerLoadout || isTraining || isAutoPlaying} tone="blue">
                                EDIT MY LOADOUT
                            </ControlButton>
                            <ControlButton onClick={onSpawnOpponent} disabled={!onSpawnOpponent || isTraining || isAutoPlaying} tone="violet">
                                SPAWN OPPONENT
                            </ControlButton>
                            <ControlButton onClick={onOpenOpponentLoadout} disabled={!onOpenOpponentLoadout || isTraining || isAutoPlaying} tone="violet">
                                EDIT OPPONENT LOADOUT
                            </ControlButton>
                        </div>
                    )}
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
                            {finishError && <p className="mt-2 rounded border border-red-800/70 bg-red-950/40 px-2 py-2 font-mono text-[9px] leading-relaxed text-red-200">{finishError}</p>}
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
                                <div className="font-mono text-[11px] font-bold tracking-widest text-cyan">BOT BRAIN WORKSPACE</div>
                                <div className="mt-1 font-mono text-[9px] tracking-widest text-ink-muted">
                                    {editingOpponent ? "TRAINING OPPONENT" : "YOUR BOT"} - {totalActiveBlocks}/{MAX_LOGIC_BLOCKS} ACTIONS - {totalActiveConditions}/{MAX_TOTAL_CONDITIONS} CONDITIONS
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
                                        || totalActiveConditions >= MAX_TOTAL_CONDITIONS
                                        || totalActiveBlocks >= MAX_LOGIC_BLOCKS}
                                    onClick={addLogicColumn}
                                    className="h-8 rounded border border-dashed border-cyan-800/70 px-3 font-mono text-[10px] tracking-widest text-cyan-300 disabled:opacity-35"
                                >
                                    ADD BRAIN NODE
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
                        {isMatchTraining && !editingOpponent && currentRound < 0 && (
                            <div className="border-b border-border-lo bg-zinc-950 px-4 py-2">
                                {currentRound >= 3 && <div className="mb-2 border border-amber-800/70 bg-amber-950/30 px-3 py-2 font-mono text-[9px] tracking-widest text-amber-200">ROUNDS 1-2 LOGIC ARCHIVED · NOT USED FOR YOUR NEW ROLE</div>}
                                <div className="flex items-center gap-1">
                                {Array.from({ length: currentRound }, (_, index) => index + 1).map((round) => (
                                    <button
                                        key={round}
                                        type="button"
                                        onClick={() => {}}
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
                                            : roundDeleteLocked ? "LOCKED" : "DELETE ONLY"}
                                </span>
                                </div>
                            </div>
                        )}
                        <TreeLogicBoard
                                configuration={activeConfiguration}
                                disabled={isTraining || !viewingCurrentRound}
                                canRemove={!isTraining && !roundDeleteLocked}
                                selectedClass={activeClass}
                                conditionTypes={visibleConditionTypes}
                                stateVariables={visibleStateVariables}
                                defaultVariable={defaultVariable}
                                targetTypes={visibleTargetTypes}
                                onChange={updateColumns}
                                zoom={canvasZoom}
                                pan={canvasPan}
                                onPanChange={setCanvasPan}
                                onZoomChange={changeZoom}
                            />
                    </section>
                </div>
            )}
        </aside>
    );
}

function TreeLogicBoard({
    configuration,
    disabled,
    canRemove,
    selectedClass,
    conditionTypes,
    stateVariables,
    defaultVariable,
    targetTypes,
    onChange,
    zoom,
    pan,
    onPanChange,
    onZoomChange,
}) {
    const viewportRef = useRef(null);
    const [nodeOffsets, setNodeOffsets] = useState({});
    const columns = configuration.columns ?? [];
    const graphActionCount = countLogicBlocks(configuration);
    const graphConditionCount = countLogicConditions(configuration);
    const beginPan = (event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        const start = { x: event.clientX, y: event.clientY, pan };
        const move = (next) => onPanChange({ x: start.pan.x + next.clientX - start.x, y: start.pan.y + next.clientY - start.y });
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };
    const updateColumn = (columnIndex, updates) => onChange(columns.map((column, index) => index === columnIndex ? { ...column, ...updates } : column));
    const removeColumn = (columnIndex) => onChange(columns.filter((_, index) => index !== columnIndex));
    const moveColumn = (columnIndex, delta) => {
        const reordered = moveLogicColumnPriority(columns, columnIndex, delta);
        if (reordered !== columns) onChange(reordered);
    };
    const beginNodeDrag = (event, key) => {
        if (disabled || event.button !== 0 || event.target?.closest?.("button,input,select,textarea,label")) return;
        event.stopPropagation();
        const startOffset = nodeOffsets[key] ?? { x: 0, y: 0 };
        const start = { x: event.clientX, y: event.clientY };
        const move = (next) => setNodeOffsets((current) => ({
            ...current,
            [key]: {
                x: startOffset.x + (next.clientX - start.x) / zoom,
                y: startOffset.y + (next.clientY - start.y) / zoom,
            },
        }));
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };
    const graph = buildLogicGraph(columns);
    const updateBranch = (columnIndex, path, updater) => onChange(updateTreeBranch(columns, columnIndex, path, updater));
    const removeBranch = (columnIndex, path) => onChange(removeTreeBranch(columns, columnIndex, path));
    return (
        <div
            ref={viewportRef}
            className="relative min-h-0 flex-1 overflow-hidden bg-zinc-900"
            onPointerDown={beginPan}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={(event) => {
                event.preventDefault();
                const rect = viewportRef.current?.getBoundingClientRect();
                onZoomChange(event.deltaY > 0 ? -0.06 : 0.06, rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
            }}
        >
            {!columns.length && <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] tracking-widest text-ink-muted">ADD A BRAIN NODE TO START</div>}
            <div className="absolute left-0 top-0 bg-[linear-gradient(rgba(63,63,70,0.28)_1px,transparent_1px),linear-gradient(90deg,rgba(63,63,70,0.28)_1px,transparent_1px)] bg-[size:32px_32px]" style={{ width: Math.max(LOGIC_CANVAS_WIDTH, graph.width), height: Math.max(LOGIC_CANVAS_HEIGHT, graph.height), transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
                <svg className="pointer-events-none absolute inset-0 overflow-visible" width={Math.max(LOGIC_CANVAS_WIDTH, graph.width)} height={Math.max(LOGIC_CANVAS_HEIGHT, graph.height)}>
                    {graph.edges.map((edge) => <path key={edge.id} d={graphEdgePath(edge, nodeOffsets)} fill="none" stroke="rgba(165,180,252,.72)" strokeWidth="2" />)}
                </svg>
                {graph.brains.map((node) => {
                    const column = columns[node.columnIndex];
                    return <section key={node.id} className="absolute w-[300px] rounded border border-cyan-600 bg-zinc-950 shadow-2xl" style={graphNodeStyle(node, nodeOffsets)}>
                        <header onPointerDown={(event) => beginNodeDrag(event, node.id)} className="flex cursor-move items-center justify-between rounded-t bg-cyan-950 px-3 py-2 font-mono text-[10px] font-bold tracking-widest text-cyan-100"><span>BRAIN NODE {node.columnIndex + 1}</span><span>PRIORITY #{node.columnIndex + 1}</span></header>
                        <div className="space-y-2 p-3"><input value={column.name} disabled={disabled} onChange={(event) => updateColumn(node.columnIndex, { name: event.target.value })} className="h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[10px] text-white" />
                            <div className="flex items-center justify-between gap-2 font-mono text-[9px]"><button type="button" disabled={disabled || node.columnIndex === 0} onClick={() => moveColumn(node.columnIndex, -1)} className="text-cyan-300 disabled:opacity-35">HIGHER PRIORITY</button><button type="button" disabled={disabled || node.columnIndex >= columns.length - 1} onClick={() => moveColumn(node.columnIndex, 1)} className="text-cyan-300 disabled:opacity-35">LOWER PRIORITY</button></div>
                            <div className="flex justify-between"><button type="button" disabled={disabled || graphConditionCount >= MAX_TOTAL_CONDITIONS} onClick={() => updateColumn(node.columnIndex, { branches: [...(column.branches ?? []), newTreeBranch(column.branches?.length ? "else_if" : "if", defaultVariable)] })} className="font-mono text-[9px] text-cyan-300 disabled:opacity-35">+ CONDITIONAL</button><button type="button" disabled={!canRemove} onClick={() => removeColumn(node.columnIndex)} className="font-mono text-[9px] text-red-300 disabled:opacity-35">REMOVE</button></div>
                        </div>
                    </section>;
                })}
                {graph.conditions.map((node) => {
                    const branch = treeBranchAt(columns[node.columnIndex]?.branches, node.path);
                    if (!branch) return null;
                    return <GraphConditionNode key={node.id} {...{ node, branch, disabled, canRemove, conditionTypes, stateVariables, defaultVariable, targetTypes, nodeOffsets, beginNodeDrag }} canAddAction={graphActionCount < MAX_LOGIC_BLOCKS} canAddCondition={graphConditionCount < MAX_TOTAL_CONDITIONS}
                        onChange={(updates) => updateBranch(node.columnIndex, node.path, (current) => ({ ...current, ...updates }))}
                        onRemove={() => removeBranch(node.columnIndex, node.path)}
                        onAddConditional={() => updateBranch(node.columnIndex, node.path, (current) => ({ ...current, children: [...(current.children ?? []), newTreeBranch(current.children?.length ? "else_if" : "if", defaultVariable)] }))}
                        onAddAction={() => updateBranch(node.columnIndex, node.path, (current) => addGraphAction(current, selectedClass))} />;
                })}
                {graph.actions.map((node) => {
                    const branch = treeBranchAt(columns[node.columnIndex]?.branches, node.path);
                    const actions = graphBranchActions(branch);
                    const entry = actions[node.actionIndex];
                    if (!branch || !entry) return null;
                    return <GraphActionNode key={node.id} {...{ node, entry, actions, branch, disabled, selectedClass, targetTypes, nodeOffsets, beginNodeDrag }}
                        onChange={(nextEntry) => updateBranch(node.columnIndex, node.path, (current) => setGraphActions(current, actions.map((item, index) => index === node.actionIndex ? nextEntry : item)))}
                        onRemove={() => updateBranch(node.columnIndex, node.path, (current) => setGraphActions(current, actions.filter((_, index) => index !== node.actionIndex)))} />;
                })}
            </div>
        </div>
    );
}

const GRAPH_NODE_WIDTH = 460;
const GRAPH_NODE_GAP = 80;
const GRAPH_LEVEL_GAP = 250;

function buildLogicGraph(columns) {
    const graph = { brains: [], conditions: [], actions: [], edges: [], width: 0, height: 0 };
    let forestX = 80;
    const measureBranch = (branch) => {
        const actions = graphBranchActions(branch).length;
        const childWidth = (branch.children ?? []).reduce((sum, child) => sum + measureBranch(child), 0);
        return Math.max(GRAPH_NODE_WIDTH + GRAPH_NODE_GAP, actions * (GRAPH_NODE_WIDTH + GRAPH_NODE_GAP) + childWidth, GRAPH_NODE_WIDTH + GRAPH_NODE_GAP);
    };
    const measureLevel = (branches) => Math.max(GRAPH_NODE_WIDTH + GRAPH_NODE_GAP, (branches ?? []).reduce((sum, branch) => sum + measureBranch(branch), 0));
    const addBranch = (branch, columnIndex, path, left, y, parent) => {
        const width = measureBranch(branch);
        const condition = { id: `condition:${branch.id}`, columnIndex, path, x: left + width / 2 - GRAPH_NODE_WIDTH / 2, y, width: GRAPH_NODE_WIDTH, height: 190, priority: path.at(-1) + 1 };
        graph.conditions.push(condition);
        graph.edges.push({ id: `${parent.id}->${condition.id}`, fromId: parent.id, toId: condition.id, x1: parent.x + parent.width / 2, y1: parent.y + parent.height, x2: condition.x + condition.width / 2, y2: condition.y });
        let childX = left;
        const childY = y + GRAPH_LEVEL_GAP;
        graphBranchActions(branch).forEach((_, actionIndex) => {
            const action = { id: `action:${branch.id}:${actionIndex}`, columnIndex, path, actionIndex, x: childX, y: childY, width: GRAPH_NODE_WIDTH, height: 150 };
            graph.actions.push(action);
            graph.edges.push({ id: `${condition.id}->${action.id}`, fromId: condition.id, toId: action.id, x1: condition.x + condition.width / 2, y1: condition.y + condition.height, x2: action.x + action.width / 2, y2: action.y });
            childX += GRAPH_NODE_WIDTH + GRAPH_NODE_GAP;
        });
        (branch.children ?? []).forEach((child, childIndex) => {
            const childWidth = measureBranch(child);
            addBranch(child, columnIndex, [...path, childIndex], childX, childY, condition);
            childX += childWidth;
        });
        graph.height = Math.max(graph.height, childY + 230);
        return width;
    };
    columns.forEach((column, columnIndex) => {
        const treeWidth = measureLevel(column.branches);
        const brain = { id: `column:${column.id}`, columnIndex, x: forestX + treeWidth / 2 - 150, y: 50, width: 300, height: 130 };
        graph.brains.push(brain);
        let branchX = forestX;
        (column.branches ?? []).forEach((branch, branchIndex) => {
            branchX += addBranch(branch, columnIndex, [branchIndex], branchX, 300, brain);
        });
        forestX += treeWidth + 140;
    });
    graph.width = forestX + 100;
    graph.height = Math.max(graph.height, 900);
    return graph;
}

function graphNodeStyle(node, offsets) {
    const offset = offsets[node.id] ?? { x: 0, y: 0 };
    return { left: node.x + offset.x, top: node.y + offset.y };
}

function graphEdgePath(edge, offsets) {
    const from = offsets[edge.fromId] ?? { x: 0, y: 0 };
    const to = offsets[edge.toId] ?? { x: 0, y: 0 };
    const x1 = edge.x1 + from.x;
    const y1 = edge.y1 + from.y;
    const x2 = edge.x2 + to.x;
    const y2 = edge.y2 + to.y;
    return `M ${x1} ${y1} C ${x1} ${y1 + 70}, ${x2} ${y2 - 70}, ${x2} ${y2}`;
}

function treeBranchAt(branches, path = []) {
    let branch = branches?.[path[0]];
    for (let index = 1; branch && index < path.length; index += 1) branch = branch.children?.[path[index]];
    return branch;
}

function mapBranchAt(branches, path, updater) {
    const [head, ...tail] = path;
    return (branches ?? []).map((branch, index) => {
        if (index !== head) return branch;
        if (!tail.length) return updater(branch);
        return { ...branch, children: mapBranchAt(branch.children, tail, updater) };
    });
}

function updateTreeBranch(columns, columnIndex, path, updater) {
    return columns.map((column, index) => index === columnIndex ? { ...column, branches: mapBranchAt(column.branches, path, updater) } : column);
}

function normalizeSiblingTypes(branches) {
    return branches.map((branch, index) => ({ ...branch, branchType: index === 0 ? "if" : "else_if", createdOrder: index }));
}

function removeTreeBranch(columns, columnIndex, path) {
    const parentPath = path.slice(0, -1);
    const removeIndex = path.at(-1);
    if (!parentPath.length) return columns.map((column, index) => index === columnIndex ? { ...column, branches: normalizeSiblingTypes((column.branches ?? []).filter((_, candidate) => candidate !== removeIndex)) } : column);
    return updateTreeBranch(columns, columnIndex, parentPath, (parent) => ({ ...parent, children: normalizeSiblingTypes((parent.children ?? []).filter((_, candidate) => candidate !== removeIndex)) }));
}

function graphBranchActions(branch) {
    if (Array.isArray(branch?.actions)) return branch.actions.filter((entry) => entry.action && entry.action !== "none");
    return branch?.action && branch.action !== "none" ? [{ action: branch.action, actionTarget: branch.actionTarget ?? "opponent" }] : [];
}

function setGraphActions(branch, actions) {
    const first = actions[0] ?? { action: "none", actionTarget: "opponent" };
    return { ...branch, actions, ...first };
}

function addGraphAction(branch, selectedClass) {
    const actions = graphBranchActions(branch);
    const actionTypes = actionTypesForCombatClass(ACTION_TYPES, selectedClass);
    const usedHeads = new Set(actions.map((entry) => actionTypes.find((action) => action.id === entry.action)).filter(Boolean).map(actionExecutionHead));
    const next = actionTypes.find((action) => action.id !== "none" && !usedHeads.has(actionExecutionHead(action)));
    return next ? setGraphActions(branch, [...actions, { action: next.id, actionTarget: "opponent" }]) : branch;
}

function GraphConditionNode({ node, branch, disabled, canRemove, canAddAction, canAddCondition, stateVariables, defaultVariable, targetTypes, nodeOffsets, beginNodeDrag, onChange, onRemove, onAddConditional, onAddAction }) {
    const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
    const siblingIndex = node.path.at(-1);
    return <section className="absolute w-[460px] rounded border border-blue-500 bg-zinc-950 shadow-2xl" style={graphNodeStyle(node, nodeOffsets)}>
        <header onPointerDown={(event) => beginNodeDrag(event, node.id)} className="flex cursor-move items-center justify-between rounded-t bg-blue-700 px-3 py-2 font-mono text-[10px] font-bold tracking-widest text-white"><span>CONDITIONAL {node.priority}</span><span className="rounded bg-black/30 px-1.5 py-0.5 text-[8px]">{siblingIndex === 0 ? "IF" : "ELSE IF"}</span></header>
        <div className="space-y-2 p-3 text-[10px] [&_button]:!text-[10px] [&_input]:!text-[10px] [&_select]:!text-[10px] [&_span]:!text-[10px]">
            {conditions.map((condition, index) => <ConditionEditor key={`${index}-${condition.type}`} condition={condition} prefix={index ? (condition.join === "or" ? "OR" : "AND") : "IF"} canChangeJoin={index > 0} removable={conditions.length > 1} stateVariables={stateVariables} defaultVariable={defaultVariable} targetTypes={targetTypes} onChange={(next) => onChange({ conditions: conditions.map((item, candidate) => candidate === index ? next : item) })} onRemove={() => onChange({ conditions: conditions.filter((_, candidate) => candidate !== index) })} />)}
            <div className="flex flex-wrap gap-3 border-t border-border-lo pt-2 font-mono text-[10px] font-semibold tracking-wide"><button type="button" disabled={disabled || !canAddCondition || conditions.length >= MAX_CONDITIONS_PER_BLOCK} onClick={() => onChange({ conditions: [...conditions, createExpressionCondition(defaultVariable.id)] })} className="text-blue-200 disabled:opacity-35">+ CONDITION</button><button type="button" disabled={disabled || !canAddCondition} onClick={onAddConditional} className="text-violet-300 disabled:opacity-35">+ CHILD IF</button><button type="button" disabled={disabled || !canAddAction} onClick={onAddAction} className="text-fuchsia-300 disabled:opacity-35">+ ACTION</button></div>
            <div className="flex justify-end border-t border-border-lo pt-2 font-mono text-[9px]"><button type="button" disabled={!canRemove} onClick={onRemove} className="text-red-300">REMOVE</button></div>
        </div>
    </section>;
}

function GraphActionNode({ node, entry, actions, disabled, selectedClass, targetTypes, nodeOffsets, beginNodeDrag, onChange, onRemove }) {
    const actionTypes = actionTypesForCombatClass(ACTION_TYPES, selectedClass);
    const selected = actionTypes.find((action) => action.id === entry.action) ?? actionTypes[0];
    const usedHeads = new Set(actions.filter((_, index) => index !== node.actionIndex).map((item) => actionTypes.find((action) => action.id === item.action)).filter(Boolean).map(actionExecutionHead));
    const available = actionTypes.filter((action) => !LEGACY_MOVEMENT_ACTION.test(action.id) && (action.id === entry.action || action.id === "none" || !usedHeads.has(actionExecutionHead(action))));
    const targetMode = selected.movementConfig ? (entry.movementMode ?? "target") : entry.targetMode === "coordinates"
        || (entry.targetMode == null && (entry.targetX != null || entry.targetY != null))
        ? "coordinates"
        : "target";
    return <section className="absolute w-[460px] rounded border border-fuchsia-500 bg-zinc-950 shadow-2xl" style={graphNodeStyle(node, nodeOffsets)}>
        <header onPointerDown={(event) => beginNodeDrag(event, node.id)} className="cursor-move rounded-t bg-fuchsia-800 px-3 py-2 font-mono text-[10px] font-bold tracking-widest text-white">ACTION NODE</header>
        <div className="space-y-2 p-3 text-[10px] [&_button]:!text-[10px] [&_input]:!text-[10px] [&_select]:!text-[10px]"><SearchablePicker value={selected.id} options={available} placeholder="Search actions..." onChange={(action) => onChange({ ...entry, action, movementMode: "target", movementDirection: "toward" })} />
            {selected.movementConfig && <MovementConfigurationControls entry={entry} onChange={onChange} />}
            {selected.orientationConfig && <PhaseOrientationControls entry={entry} onChange={onChange} />}
            {selected.coordinateTarget && !selected.movementConfig && <select value={targetMode} onChange={(event) => onChange({ ...entry, targetMode: event.target.value })} className="h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[9px] text-white"><option value="target">Target object at execution</option><option value="coordinates">Exact coordinates</option></select>}
            {actionSupportsTarget(selected) && (!selected.coordinateTarget || targetMode === "target") && <OrderedTargetPicker value={entry.actionTarget} targetTypes={targetTypes} onChange={(actionTarget) => onChange({ ...entry, actionTarget })} />}
            {actionSupportsTarget(selected) && (!selected.coordinateTarget || targetMode === "target") && <div className="grid grid-cols-2 gap-2"><label className="font-mono text-[9px] text-ink-muted">TARGET OFFSET X<input type="number" value={entry.targetOffsetX ?? 0} onChange={(event) => onChange({ ...entry, targetOffsetX: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white" /></label><label className="font-mono text-[9px] text-ink-muted">TARGET OFFSET Y<input type="number" value={entry.targetOffsetY ?? 0} onChange={(event) => onChange({ ...entry, targetOffsetY: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white" /></label></div>}
            {selected.coordinateTarget && targetMode === "coordinates" && <div className="grid grid-cols-2 gap-2"><label className="font-mono text-[9px] text-ink-muted">TARGET X<input type="number" min="0" max="1000" value={entry.targetX ?? 500} onChange={(event) => onChange({ ...entry, targetX: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white" /></label><label className="font-mono text-[9px] text-ink-muted">TARGET Y<input type="number" min="0" max="800" value={entry.targetY ?? 400} onChange={(event) => onChange({ ...entry, targetY: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white" /></label></div>}
            <button type="button" disabled={disabled} onClick={onRemove} className="font-mono text-[9px] text-red-300">REMOVE ACTION</button></div>
    </section>;
}

function MovementConfigurationControls({ entry, onChange }) {
    const mode = entry.movementMode ?? "target";
    const absolute = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest", "stop"];
    const relative = [["toward", "Toward"], ["away", "Away"], ["left", "Left perpendicular"], ["right", "Right perpendicular"], ["toward_left", "Toward + left"], ["toward_right", "Toward + right"], ["away_left", "Away + left"], ["away_right", "Away + right"]];
    return <><select value={mode} onChange={(event) => onChange({ ...entry, movementMode: event.target.value, movementDirection: event.target.value === "absolute" ? "north" : "toward" })} className="h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[9px] text-white"><option value="target">Relative to target</option><option value="coordinates">Relative to coordinates</option><option value="absolute">Absolute arena direction</option></select><select value={entry.movementDirection ?? (mode === "absolute" ? "north" : "toward")} onChange={(event) => onChange({ ...entry, movementDirection: event.target.value })} className="h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[9px] text-white">{mode === "absolute" ? absolute.map((direction) => <option key={direction} value={direction}>{direction.replace("stop", "hold ground").replaceAll("_", " ").toUpperCase()}</option>) : relative.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></>;
}

function PhaseOrientationControls({ entry, onChange }) {
    return <label className="block font-mono text-[9px] text-ink-muted">LANDING FACING<select value={entry.phaseFacingMode ?? "face_target"} onChange={(event) => onChange({ ...entry, phaseFacingMode: event.target.value })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white"><option value="face_target">Face target after passing through</option><option value="keep">Keep current facing</option><option value="face_origin">Face the position phased from</option><option value="mirror">Mirror facing across the phase line</option></select></label>;
}

function newTreeBranch(branchType, defaultVariable) {
    const block = createLogicBlock("always", "none");
    return {
        ...block,
        branchType,
        createdOrder: Date.now() + Math.random(),
        conditions: branchType === "else" ? [] : [createExpressionCondition(defaultVariable.id)],
        actions: [],
        children: [],
    };
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
                    ADD A BRAIN ACTION OR CONDITIONAL TO START
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
    stateVariables = STATE_VARIABLES,
    defaultVariable = STATE_VARIABLES[0],
    targetTypes = TARGET_TYPES,
    conditionsOptional = false,
    branchLabel = null,
    hidePriority = false,
    hideConditions = false,
    hideActions = false,
}) {
    const updateConditions = (conditions) => onChange({ conditions });
    const conditions = Array.isArray(block.conditions) ? block.conditions : [];
    const actionTypes = actionTypesForCombatClass(ACTION_TYPES, selectedClass);
    const blockActions = Array.isArray(block.actions) && block.actions.length
        ? block.actions
        : [{ action: block.action ?? "none", actionTarget: block.actionTarget ?? "opponent" }];
    const updateActions = (actions) => {
        const nextActions = actions.length ? actions : [{ action: "none", actionTarget: "opponent" }];
        onChange({ actions: nextActions, ...nextActions[0] });
    };
    const usedHeads = new Set(blockActions
        .map((entry) => actionTypes.find((action) => action.id === entry.action))
        .filter(Boolean)
        .map(actionExecutionHead)
        .filter((head) => head !== "none"));
    const canAddAction = ["movement", "rotation", "ability"].some((head) => !usedHeads.has(head));
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
                <strong className="text-cyan-200">{branchLabel ?? `IF BLOCK ${index + 1}`}</strong>
                <button type="button" disabled={!canRemove} onPointerDown={(event) => event.stopPropagation()} onClick={onRemove} className="text-red-300 disabled:opacity-35">REMOVE</button>
            </div>
            {!hidePriority && <><label className="mt-3 block font-mono text-[9px] tracking-widest text-ink-muted">PRIORITY</label>
            <input
                type="number"
                min={MIN_PRIORITY}
                max={MAX_PRIORITY}
                value={block.priority ?? 1}
                onChange={(event) => onChange({ priority: clampNumber(event.target.value, MIN_PRIORITY, MAX_PRIORITY, 1) })}
                className="mt-1 h-8 w-20 rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[10px] text-ink-white"
            /></>}
            {!hideConditions && <div className="mt-2 grid gap-2">
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
            </div>}
            {!hideConditions && conditions.length < MAX_CONDITIONS_PER_BLOCK && (
                <button
                    type="button"
                    onClick={() => updateConditions([...conditions, createExpressionCondition(defaultVariable.id)])}
                    className="mt-2 font-mono text-[9px] tracking-widest text-cyan-300"
                >+ CONDITION</button>
            )}
            {!hideActions && <><label className="mt-3 block font-mono text-[9px] tracking-widest text-ink-muted">THEN</label>
            <div className="mt-1 space-y-2">
                {blockActions.map((entry, actionIndex) => {
                    const selectedAction = actionTypes.find((action) => action.id === entry.action) ?? ACTION_TYPES[0];
                    const currentHead = actionExecutionHead(selectedAction);
                    const targetMode = selectedAction.movementConfig ? (entry.movementMode ?? "target") : entry.targetMode === "coordinates"
                        || (entry.targetMode == null && (entry.targetX != null || entry.targetY != null))
                        ? "coordinates"
                        : "target";
                    const availableActions = actionTypes.filter((action) => {
                        if (LEGACY_MOVEMENT_ACTION.test(action.id)) return false;
                        const head = actionExecutionHead(action);
                        return head === "none" || head === currentHead || !usedHeads.has(head);
                    });
                    return <div key={`${actionIndex}-${entry.action}`} className="rounded border border-border-lo bg-zinc-950/70 p-2">
                        <div className="flex gap-2">
                            <SearchablePicker
                                value={selectedAction.id}
                                onChange={(value) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { action: value, actionTarget: candidate.actionTarget ?? "opponent", movementMode: "target", movementDirection: "toward" } : candidate))}
                                options={availableActions}
                                placeholder="Search actions..."
                            />
                            {blockActions.length > 1 && <button type="button" onClick={() => updateActions(blockActions.filter((_, index) => index !== actionIndex))} className="px-2 font-mono text-[9px] text-red-300">REMOVE</button>}
                        </div>
                        {selectedAction.movementConfig && <><select value={targetMode} onChange={(event) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, movementMode: event.target.value } : candidate))} className="mt-2 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-ink-white"><option value="target">Relative to target</option><option value="coordinates">Relative to coordinates</option><option value="absolute">Absolute arena direction</option></select><select value={entry.movementDirection ?? "toward"} onChange={(event) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, movementDirection: event.target.value } : candidate))} className="mt-2 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-ink-white">{targetMode === "absolute" ? <><option value="north">North</option><option value="northeast">Northeast</option><option value="east">East</option><option value="southeast">Southeast</option><option value="south">South</option><option value="southwest">Southwest</option><option value="west">West</option><option value="northwest">Northwest</option><option value="stop">Hold Ground</option></> : <><option value="toward">Toward</option><option value="away">Away</option><option value="left">Left perpendicular</option><option value="right">Right perpendicular</option><option value="toward_left">Toward + left</option><option value="toward_right">Toward + right</option><option value="away_left">Away + left</option><option value="away_right">Away + right</option></>}</select></>}
                        {selectedAction.orientationConfig && <PhaseOrientationControls entry={entry} onChange={(nextEntry) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? nextEntry : candidate))} />}
                        {selectedAction.coordinateTarget && !selectedAction.movementConfig && <select
                            value={targetMode}
                            onChange={(event) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetMode: event.target.value } : candidate))}
                            className="mt-2 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-ink-white"
                        ><option value="target">Target object at execution</option><option value="coordinates">Exact coordinates</option></select>}
                        {actionSupportsTarget(selectedAction) && (!selectedAction.coordinateTarget || targetMode === "target") && <div className="mt-2"><OrderedTargetPicker value={entry.actionTarget} targetTypes={targetTypes} onChange={(actionTarget) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, actionTarget } : candidate))} /></div>}
                        {actionSupportsTarget(selectedAction) && (!selectedAction.coordinateTarget || targetMode === "target") && <div className="mt-2 grid grid-cols-2 gap-2"><label className="font-mono text-[9px] text-ink-muted">OFFSET X<input type="number" value={entry.targetOffsetX ?? 0} onChange={(event) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetOffsetX: event.target.value } : candidate))} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 text-ink-white" /></label><label className="font-mono text-[9px] text-ink-muted">OFFSET Y<input type="number" value={entry.targetOffsetY ?? 0} onChange={(event) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetOffsetY: event.target.value } : candidate))} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 text-ink-white" /></label></div>}
                        {selectedAction.coordinateTarget && targetMode === "coordinates" && <div className="mt-2 grid grid-cols-2 gap-2"><label className="font-mono text-[9px] text-ink-muted">TARGET X<input type="number" min="0" max="1000" value={entry.targetX ?? 500} onChange={(event) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetX: event.target.value } : candidate))} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 text-ink-white" /></label><label className="font-mono text-[9px] text-ink-muted">TARGET Y<input type="number" min="0" max="800" value={entry.targetY ?? 400} onChange={(event) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetY: event.target.value } : candidate))} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 text-ink-white" /></label></div>}
                    </div>;
                })}
            </div>
            <button type="button" disabled={!canAddAction} onClick={() => {
                const next = actionTypes.find((action) => action.id !== "none" && !usedHeads.has(actionExecutionHead(action)));
                if (next) updateActions([...blockActions.filter((entry) => entry.action !== "none"), { action: next.id, actionTarget: "opponent" }]);
            }} className="mt-2 font-mono text-[9px] text-cyan-300 disabled:opacity-35">+ ACTION</button></>}
        </fieldset>
    );
}

function SearchablePicker({ value, onChange, options, placeholder = "Search..." }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const rootRef = useRef(null);
    const selected = options.find((option) => option.id === value);
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
        ? options.filter((option) => `${option.label} ${option.id}`.toLocaleLowerCase().includes(normalized))
        : options;
    useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [open]);
    return (
        <div ref={rootRef} className="relative min-w-0 flex-1">
            <button type="button" onClick={() => { setOpen((current) => !current); setQuery(""); }} className="flex h-8 w-full items-center justify-between rounded border border-border-lo bg-zinc-950 px-2 text-left font-mono text-[10px] text-ink-white">
                <span className="truncate">{selected?.label ?? "Choose..."}</span><span className="text-ink-muted">⌄</span>
            </button>
            {open && <div onWheel={(event) => event.stopPropagation()} className="absolute left-0 top-full z-50 mt-1 w-full min-w-56 rounded border border-border-mid bg-zinc-950 p-2 shadow-2xl">
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="h-8 w-full rounded border border-cyan-900 bg-zinc-900 px-2 font-mono text-[10px] text-white outline-none focus:border-cyan-500" />
                <div className="mt-1 max-h-52 overflow-y-auto">
                    {filtered.map((option) => <button key={option.id} type="button" onClick={() => { onChange(option.id); setOpen(false); }} className={`block w-full rounded px-2 py-1.5 text-left font-mono text-[10px] hover:bg-cyan-950 ${option.id === value ? "text-cyan-200" : "text-ink-white"}`}>{option.label}</button>)}
                    {!filtered.length && <div className="px-2 py-3 font-mono text-[9px] text-ink-muted">NO MATCHES</div>}
                </div>
            </div>}
        </div>
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
    if (condition?.type === "expression" || condition?.type === "always") {
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
    const visibleConditionTypes = conditionTypes.filter((candidate) => candidate.id === "always");
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
    const selectedTarget = targetOptions.some((target) => target.id === String(condition.target).split(":")[0])
        ? condition.target
        : definition.defaultTarget ?? "opponent";
    const selectType = (type) => {
        const selectedVariable = stateVariables.find((variable) => variable.id === type);
        if (selectedVariable) {
            onChange({
                ...createExpressionCondition(selectedVariable.id),
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
        <div className="grid grid-cols-[42px_1fr_auto] items-center gap-1 text-[10px] [&_button]:!text-[10px] [&_input]:!text-[10px] [&_select]:!text-[10px] [&_span]:!text-[10px]">
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
                    <optgroup label="BASIC">
                        {visibleConditionTypes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                    </optgroup>
                    {groupedStateVariables(stateVariables).map(({ group, variables }) => (
                        <optgroup key={group} label={group}>
                            {variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.label}</option>)}
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
                    <div className="min-w-56"><OrderedTargetPicker value={selectedTarget} targetTypes={targetOptions} onChange={(target) => onChange({ ...condition, target })} /></div>
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
    const isAlways = condition?.type === "always";
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
    const targetOptions = leftDefinition.fighterTargetOnly
        ? targetTypes.filter((target) => target.id === "opponent")
        : targetGroup === "objects"
        ? objectTargetTypes(targetTypes)
        : targetTypes;
    const showTarget = leftDefinition.supportsTarget || Boolean(rightVariableDefinition?.supportsTarget);
    const selectedTarget = targetOptions.some((target) => target.id === String(condition.target).split(":")[0])
        ? condition.target
        : targetGroup === "objects" ? "object_1" : "opponent";

    const changeLeft = (left) => {
        if (left === "always") {
            onChange({
                type: "always",
                ...(condition.join === "or" ? { join: "or" } : {}),
            });
            return;
        }
        const nextLeft = variables.find((variable) => variable.id === left) ?? variables[0];
        onChange({
            ...createExpressionCondition(nextLeft.id),
            ...(nextLeft.supportsAbility && nextLeft.abilityOptions?.length ? { ability: nextLeft.abilityOptions[0].id } : {}),
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
        <div className="grid grid-cols-[42px_1fr_auto] items-center gap-1 text-[10px] [&_button]:!text-[10px] [&_input]:!text-[10px] [&_select]:!text-[10px] [&_span]:!text-[10px]">
            <ConditionJoinControl
                prefix={prefix}
                canChangeJoin={canChangeJoin}
                condition={condition}
                onChange={onChange}
            />
            <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] gap-1">
                <SearchablePicker
                    value={isAlways ? "always" : leftDefinition.id}
                    onChange={changeLeft}
                    options={[{ id: "always", label: "ALWAYS" }, ...variables]}
                    placeholder="Search conditionals..."
                />
                {!isAlways && leftDefinition.supportsAbility && (
                    <select
                        aria-label="Selected ability"
                        value={leftDefinition.abilityOptions?.some((ability) => ability.id === condition.ability) ? condition.ability : leftDefinition.abilityOptions?.[0]?.id ?? ""}
                        onChange={(event) => onChange({ ...condition, ability: event.target.value })}
                        className="h-8 min-w-36 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                    >
                        {(leftDefinition.abilityOptions ?? []).map((ability) => <option key={ability.id} value={ability.id}>{ability.label}</option>)}
                    </select>
                )}
                {!isAlways && (leftDefinition.rangeOnly ? (
                    <span className="flex h-8 items-center rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-ink-muted">BETWEEN</span>
                ) : valueType === "boolean" ? (
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
                ))}
                {!isAlways && (leftDefinition.rangeOnly ? (
                    <div className="flex min-w-0 items-center gap-1">
                        <input
                            aria-label="Minimum target direction"
                            type="number"
                            min={leftDefinition.min}
                            max={leftDefinition.max}
                            step={1}
                            value={condition.right?.min ?? leftDefinition.defaultMin}
                            onChange={(event) => onChange({ ...condition, comparator: "range", right: { type: "range", min: event.target.value, max: condition.right?.max ?? leftDefinition.defaultMax } })}
                            className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        />
                        <span className="font-mono text-[9px] text-ink-muted">° TO</span>
                        <input
                            aria-label="Maximum target direction"
                            type="number"
                            min={leftDefinition.min}
                            max={leftDefinition.max}
                            step={1}
                            value={condition.right?.max ?? leftDefinition.defaultMax}
                            onChange={(event) => onChange({ ...condition, comparator: "range", right: { type: "range", min: condition.right?.min ?? leftDefinition.defaultMin, max: event.target.value } })}
                            className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        />
                        <span className="font-mono text-[9px] text-ink-muted">°</span>
                    </div>
                ) : valueType === "boolean" ? (
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
                            <SearchablePicker
                                value={rightVariableDefinition?.id ?? numericVariables[0]?.id}
                                onChange={(value) => onChange({
                                    ...condition,
                                    right: { type: "variable", value },
                                })}
                                options={numericVariables}
                                placeholder="Search variables..."
                            />
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
                                                        leftDefinition.step ?? 1,
                                                    ),
                                                },
                                            });
                                        }
                                    }}
                                    onBlur={(event) => onChange({
                                        ...condition,
                                        right: {
                                            type: "number",
                                            value: clampNumber(event.currentTarget.value, leftDefinition.min, leftDefinition.max, leftDefinition.defaultValue, leftDefinition.step ?? 1),
                                        },
                                    })}
                                    className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                                />
                                {leftDefinition.suffix && (
                                    <span className="font-mono text-[9px] text-ink-muted">{leftDefinition.suffix}</span>
                                )}
                            </div>
                        )}
                    </div>
                ))}
                {!isAlways && showTarget && (
                    <div className="col-span-3"><OrderedTargetPicker value={selectedTarget} targetTypes={targetOptions} onChange={(target) => onChange({ ...condition, target })} /></div>
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
        const children = Array.isArray(block?.children) ? sanitizeBranches(block.children) : block?.children;
        return conditions === block?.conditions && children === block?.children ? block : { ...block, conditions, children };
    };
    const sanitizeBranches = (branches) => {
        let branchChanged = false;
        const next = branches.map((branch) => {
            const conditions = sanitizeConditions(branch?.conditions);
            const children = Array.isArray(branch?.children) ? sanitizeBranches(branch.children) : branch?.children;
            if (conditions !== branch?.conditions || children !== branch?.children) {
                branchChanged = true;
                return { ...branch, conditions, children };
            }
            return branch;
        });
        return branchChanged ? next : branches;
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
    const columns = Array.isArray(configuration?.columns)
        ? configuration.columns.map((column) => {
            const branches = sanitizeBranches(column.branches ?? []);
            if (branches !== column.branches) {
                changed = true;
                return { ...column, branches };
            }
            return column;
        })
        : configuration?.columns;

    return changed ? { ...configuration, columns, blocks, clusters } : configuration;
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
    return (configuration.columns ?? []).reduce((total, column) => total + countTreeBranches(column.branches), 0)
        + (configuration.blocks?.length ?? 0)
        + (configuration.clusters ?? []).reduce((total, cluster) => total + (cluster.blocks?.length ?? 0), 0);
}

function countLogicConditions(configuration) {
    const countBranches = (branches = []) => branches.reduce((total, branch) => (
        total + (branch.conditions?.length ?? 0) + countBranches(branch.children)
    ), 0);
    return (configuration.columns ?? []).reduce((total, column) => total + countBranches(column.branches), 0)
        + (configuration.blocks ?? []).reduce((total, block) => total + (block.conditions?.length ?? 0), 0)
        + (configuration.clusters ?? []).reduce((total, cluster) => total
            + (cluster.conditions?.length ?? 0)
            + (cluster.blocks ?? []).reduce((sum, block) => sum + (block.conditions?.length ?? 0), 0), 0);
}

function countTreeBranches(branches = []) {
    return branches.reduce((total, branch) => {
        const actions = Array.isArray(branch.actions) && branch.actions.length ? branch.actions : [branch];
        return total + actions.filter((entry) => entry.action !== "none").length + countTreeBranches(branch.children);
    }, 0);
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

function groupedStateVariables(stateVariables = STATE_VARIABLES) {
    return CONDITION_GROUP_ORDER
        .map((group) => ({
            group,
            variables: stateVariables.filter((variable) => (variable.group ?? "General") === group),
        }))
        .filter((entry) => entry.variables.length > 0);
}

function abilityIdsForConfiguration(configuration) {
    const encoded = String(configuration);
    return encoded.startsWith("sandbox:") ? new Set(decodeSandboxLoadout(encoded).abilities)
        : encoded.startsWith("custom:") ? new Set(decodeBotLoadout(encoded).abilities) : new Set();
}

function targetTypesForLoadouts(ownClass, opponentClass) {
    const ownAbilities = abilityIdsForConfiguration(ownClass), opponentAbilities = abilityIdsForConfiguration(opponentClass);
    return TARGET_TYPES
        .filter((target) => {
            if (!target.abilityId) return true;
            return (target.owner === "my" ? ownAbilities : opponentAbilities).has(target.abilityId);
        });
}

function OrderedTargetPicker({ value = "opponent", targetTypes = TARGET_TYPES, onChange }) {
    const [baseValue, encodedOrder, encodedOrdinal] = String(value).split(":");
    const base = targetTypes.some((target) => target.id === baseValue) ? baseValue : targetTypes[0]?.id ?? "opponent";
    const order = ["closest", "farthest", "oldest", "newest"].includes(encodedOrder) ? encodedOrder : "closest";
    const ordinal = Math.max(1, Math.min(100, Number(encodedOrdinal) || 1));
    const ordered = base !== "opponent";
    const encode = (nextBase, nextOrder = order, nextOrdinal = ordinal) => nextBase === "opponent"
        ? "opponent"
        : `${nextBase}:${nextOrder}:${Math.max(1, Math.min(100, Number(nextOrdinal) || 1))}`;
    return <div className={`grid gap-1 ${ordered ? "grid-cols-[minmax(0,1fr)_6rem_4rem]" : "grid-cols-1"}`}>
        <select value={base} onChange={(event) => onChange(encode(event.target.value))} className="h-8 min-w-0 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white">
            {targetTypes.map((target) => <option key={target.id} value={target.id}>{target.label.replace(/^Closest /, "")}</option>)}
        </select>
        {ordered && <select aria-label="Target ordering" value={order} onChange={(event) => onChange(encode(base, event.target.value))} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white">
            <option value="closest">Closest</option><option value="farthest">Farthest</option><option value="oldest">Oldest</option><option value="newest">Newest</option>
        </select>}
        {ordered && <input aria-label="Target ordinal" type="number" min="1" max="100" value={ordinal} onChange={(event) => onChange(encode(base, order, event.target.value))} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white" />}
    </div>;
}

function objectTargetTypes(targetTypes = TARGET_TYPES) {
    return targetTypes.filter((target) => (
        Boolean(target.abilityId)
        ||
        target.id.includes(":")
        ||
        target.id.startsWith("object_")
        || /^p[12]_object_[1-6]$/.test(target.id)
        || target.id.startsWith("wall_core_")
        || target.id === "defender_core"
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
