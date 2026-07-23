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
    customVariableDefinitions,
    countConditionSlots,
    MAX_BRAIN_NODES,
    CUSTOM_INTEGER_MIN,
    CUSTOM_INTEGER_MAX,
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
import CustomVariablesModal from "./CustomVariablesModal.jsx";
import SearchBrainNodesModal from "./SearchBrainNodesModal.jsx";
import TutorialGuide, { TutorialBrainCoach } from "../tutorial/TutorialGuide.jsx";
import MatchToolIcon from "./MatchToolIcon.jsx";

const CONDITION_GROUP_ORDER = ["Basic", "My Bot", "Opponent", "Objects", "Target", "General"];
const LEGACY_MOVEMENT_ACTION = /^(move_(?!walk$)|dash_(?!$)|micro_dash_)/;
const LOGIC_BLOCK_WIDTH = 500;
const LOGIC_BLOCK_HEIGHT_ESTIMATE = 320;
// Used only while rendering a brain that is being migrated from the pre-tree schema.
const CLUSTER_NODE_WIDTH = 1080;
const LOGIC_CANVAS_WIDTH = 10000;
const LOGIC_CANVAS_HEIGHT = 6000;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.35;

function clampNumber(value, min, max, fallback, step = 1) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return text.startsWith("-") ? min : max;
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
    customVariableValues = {},
    opponentCustomVariableValues = {},
    onSaveArenaCheckpoint,
    onResetArenaCheckpoint,
    onFullArenaReset,
    onSurrenderMatch,
    onFinishMatch,
    onOpenPlayerLoadout,
    onOpenOpponentLoadout,
    onSpawnOpponent,
    tutorialMode = false,
    tutorialGuideProps = null,
    tutorialStep = 0,
    onShowTutorialSolution,
}) {
    const [isLogicOpen, setIsLogicOpen] = useState(false);
    const [isCustomVariablesOpen, setIsCustomVariablesOpen] = useState(false);
    const [isNodeSearchOpen, setIsNodeSearchOpen] = useState(false);
    const [activeBrain, setActiveBrain] = useState("player");
    const [canvasZoom, setCanvasZoom] = useState(0.85);
    const [canvasPan, setCanvasPan] = useState({ x: 40, y: 36 });
    const [editHistory, setEditHistory] = useState({ player: { undo: [], redo: [] }, opponent: { undo: [], redo: [] } });
    const currentRound = Math.max(1, Number(matchContext?.roundNumber) || 1);
    const validation = validateMeleeStrategyConfiguration(configuration);
    const editingOpponent = activeBrain === "opponent" && opponentConfiguration && onOpponentChange;
    const playerBotLabel = matchContext?.player?.username ? `${matchContext.player.username}'s bot` : "Your bot";
    const activeClass = editingOpponent ? opponentSelectedClass : selectedClass;
    const activeOpponentClass = editingOpponent ? selectedClass : opponentSelectedClass;
    const activeConfiguration = editingOpponent ? opponentConfiguration : configuration;
    const activeCustomVariableValues = editingOpponent ? opponentCustomVariableValues : customVariableValues;
    const applyActiveConfiguration = (next) => {
        if (editingOpponent) onOpponentChange(next);
        else onChange(next);
    };
    const updateActiveConfiguration = (next) => {
        if (next === activeConfiguration) return;
        setEditHistory((current) => ({ ...current, [activeBrain]: { undo: [...current[activeBrain].undo.slice(-49), activeConfiguration], redo: [] } }));
        applyActiveConfiguration(next);
    };
    const travelHistory = (direction) => {
        if (isTraining) return;
        const history = editHistory[activeBrain];
        const next = history[direction].at(-1);
        if (!next) return;
        const destination = direction === "undo" ? "redo" : "undo";
        setEditHistory((current) => ({ ...current, [activeBrain]: {
            ...current[activeBrain],
            [direction]: current[activeBrain][direction].slice(0, -1),
            [destination]: [...current[activeBrain][destination], activeConfiguration],
        } }));
        applyActiveConfiguration(next);
    };
    const updateColumns = (columns) => updateActiveConfiguration({
        version: "melee-logic-tree-v1",
        columns,
        blocks: [],
        clusters: [],
        customVariables: activeConfiguration?.customVariables ?? [],
    });
    const totalActiveBlocks = countLogicBlocks(activeConfiguration);
    const totalBrainNodes = activeConfiguration?.columns?.length ?? 0;
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
        const builtIns = STATE_VARIABLES.filter((variable) => (
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
        return [...builtIns, ...customVariableDefinitions(activeConfiguration)];
    }, [visibleConditionTypes, activeClass, activeOpponentClass, activeConfiguration]);
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
        if (totalBrainNodes >= MAX_BRAIN_NODES || totalActiveConditions >= MAX_TOTAL_CONDITIONS) return;
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
        <aside className="training-mono h-full min-h-0 w-[23rem] flex-shrink-0 overflow-y-auto border-l border-slate-700/70 bg-[linear-gradient(180deg,rgba(12,22,31,.98),rgba(8,16,24,.98))] p-4 shadow-[-12px_0_30px_rgba(0,0,0,.28)]">
            <div className="space-y-4">
                {tutorialGuideProps && <TutorialGuide {...tutorialGuideProps} />}
                {isMatchTraining && (
                    <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 text-[10px] shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                        <PanelHeading icon="status">MATCH STATUS</PanelHeading>
                        <div className="flex items-center justify-between text-ink-muted">
                            <span>ROUND</span>
                            <strong className="font-interface-numeric text-ink-white">{matchContext?.roundNumber ?? 1}/{totalRounds}</strong>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-ink-muted">
                            <span>TIME</span>
                            <strong className="font-interface-numeric text-amber-200">{formatClock(trainingRemaining)}</strong>
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

                <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                    <div className="flex items-center justify-between text-[10px]">
                        <PanelHeading icon="brain">BOT BRAIN</PanelHeading>
                        <strong className="font-interface-numeric text-ink-muted">{countLogicBlocks(configuration)}/{MAX_LOGIC_BLOCKS} A · {countLogicConditions(configuration)}/{MAX_TOTAL_CONDITIONS} C</strong>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsLogicOpen(true)}
                        className="font-display-action mt-4 flex min-h-14 w-full items-center justify-center gap-3 rounded-lg border border-cyan-500/80 bg-cyan-950/20 px-4 text-base tracking-[.025em] text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,.08)] transition hover:bg-cyan-900/35"
                    >
                        <ToolIcon name="brain" /> OPEN BOT BRAIN
                    </button>
                    {validation.errors.map((error) => <p key={error} className="mt-2 text-[10px] text-red-300">{error}</p>)}
                    {validation.warnings?.map((warning) => <p key={warning} className="mt-2 text-[10px] text-amber-300">WARNING: {warning}</p>)}
                </section>

                <section className="rounded-xl border border-slate-600/70 bg-slate-900/55 p-4 shadow-[0_10px_30px_rgba(0,0,0,.2)]">
                    <div className="mb-4 flex items-center justify-between border-b border-slate-700/80 pb-3 text-[10px]">
                        <PanelHeading icon="tools">MATCH TOOLS</PanelHeading>
                        <span className="font-display-action tracking-[.08em] text-ink-muted">BOT LOADOUT</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2.5">
                        <ControlButton
                            icon="play"
                            onClick={onAutoPlayToggle}
                            disabled={isBaseTraining || isTraining}
                            tone={isAutoPlaying ? "neutral" : "blue"}
                        >
                            {isAutoPlaying ? "STOP" : tutorialMode ? "PLAY" : "AUTO PLAY"}
                        </ControlButton>
                        <ControlButton
                            icon="stats"
                            onClick={onResetArenaStats}
                            disabled={!onResetArenaStats || isBaseTraining || isTraining}
                            tone="neutral"
                        >
                            RESET STATS
                        </ControlButton>
                        <ControlButton icon="measure" onClick={onMeasurementToggle} disabled={!onMeasurementToggle} tone={measurementEnabled ? "blue" : "neutral"}>
                            {measurementEnabled ? "MEASURING ON" : "MEASURING OFF"}
                        </ControlButton>
                        {!isMatchTraining && (
                            <>
                            <ControlButton icon="edit" onClick={onOpenPlayerLoadout} disabled={!onOpenPlayerLoadout || isTraining || isAutoPlaying} tone="violet">
                                EDIT MY LOADOUT
                            </ControlButton>
                            <ControlButton icon="target" onClick={onSpawnOpponent} disabled={!onSpawnOpponent || isTraining || isAutoPlaying} tone="violet">
                                SPAWN OPPONENT
                            </ControlButton>
                            <ControlButton icon="opponent" onClick={onOpenOpponentLoadout} disabled={!onOpenOpponentLoadout || isTraining || isAutoPlaying} tone="violet">
                                EDIT OPPONENT LOADOUT
                            </ControlButton>
                            </>
                        )}
                        <ControlButton
                            icon="save"
                            onClick={onSaveArenaCheckpoint}
                            disabled={!onSaveArenaCheckpoint || isBaseTraining || isTraining || isAutoPlaying}
                            tone="amber"
                        >
                            SAVE POINT
                        </ControlButton>
                        <ControlButton
                            icon="load"
                            onClick={onResetArenaCheckpoint}
                            disabled={!onResetArenaCheckpoint || isBaseTraining || isTraining || !hasArenaCheckpoint}
                            tone="neutral"
                        >
                            LOAD POINT
                        </ControlButton>
                        <ControlButton
                            icon="reset"
                            onClick={onFullArenaReset}
                            disabled={!onFullArenaReset || isBaseTraining || isTraining}
                            tone="red"
                        >
                            RESET TO BEGINNING
                        </ControlButton>
                        {isMatchTraining ? (
                            <>
                            <ControlButton
                                icon="finish"
                                onClick={onFinishMatch}
                                disabled={!canFinishMatch || finishStatus === "FINISHED" || finishStatus === "SURRENDERED" || isFinishingMatch || isTraining}
                                tone={finishStatus === "FINISHED" ? "green" : finishStatus === "SURRENDERED" ? "red" : "green"}
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
                                icon="flag"
                                onClick={onSurrenderMatch}
                                disabled={!onSurrenderMatch || finishStatus === "SURRENDERED" || isFinishingMatch || isTraining}
                                tone="red"
                            >
                                GIVE UP
                            </ControlButton>
                            </>
                        ) : null}
                    </div>
                    {finishError && <p className="mt-2 rounded border border-red-800/70 bg-red-950/40 px-2 py-2 font-mono text-[9px] leading-relaxed text-red-200">{finishError}</p>}
                </section>
            </div>

            {isLogicOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 py-5">
                    <section className="brain-workspace relative flex h-[min(90vh,820px)] w-[min(94vw,1440px)] flex-col overflow-hidden rounded-sm border border-border-mid bg-[#111519] shadow-2xl">
                        <header className="brain-toolbar flex min-h-[84px] flex-shrink-0 items-center gap-4 border-b border-white/10 bg-[#12161a] px-5 py-3 shadow-[0_8px_24px_rgba(0,0,0,.18)]">
                            <div className="brain-toolbar-title flex-none">
                                <div className="font-mono text-[11px] font-bold tracking-widest text-cyan">BOT BRAIN WORKSPACE</div>
                                <div className="mt-1 truncate font-mono text-[8px] tracking-wide text-ink-muted">
                                    {editingOpponent ? "TRAINING OPPONENT" : "YOUR BOT"} - {totalActiveBlocks}/{MAX_LOGIC_BLOCKS} A - {totalActiveConditions}/{MAX_TOTAL_CONDITIONS} C
                                </div>
                            </div>
                            <div className="brain-toolbar-controls min-w-0 flex-1 py-0.5">
                                {opponentConfiguration && onOpponentChange && (
                                    <div className="brain-tab-group">
                                        <BrainTab active={activeBrain === "player"} onClick={() => setActiveBrain("player")}>{playerBotLabel}</BrainTab>
                                        <BrainTab active={activeBrain === "opponent"} onClick={() => setActiveBrain("opponent")}>Opponent bot</BrainTab>
                                    </div>
                                )}
                                <div className="brain-toolbar-tools">
                                    <button type="button" onClick={() => setIsNodeSearchOpen(true)} className="brain-toolbar-button"><span aria-hidden="true" className="brain-toolbar-icon">⌕</span> SEARCH NODES</button>
                                    <button type="button" onClick={() => setIsCustomVariablesOpen(true)} className="brain-toolbar-button"><span aria-hidden="true" className="brain-toolbar-icon">{'{ }'}</span> CUSTOM VARIABLES</button>
                                    <button
                                        type="button"
                                        disabled={isTraining || !viewingCurrentRound
                                            || totalActiveConditions >= MAX_TOTAL_CONDITIONS
                                            || totalActiveBlocks >= MAX_LOGIC_BLOCKS
                                            || totalBrainNodes >= MAX_BRAIN_NODES}
                                        onClick={addLogicColumn}
                                        className="brain-toolbar-button brain-toolbar-button-primary"
                                    >
                                        <span aria-hidden="true" className="brain-toolbar-icon">＋</span> ADD BRAIN NODE ({totalBrainNodes}/{MAX_BRAIN_NODES})
                                    </button>
                                </div>
                                <div className="brain-toolbar-actions">
                                    <div className="brain-toolbar-zoom">
                                        <button
                                            type="button"
                                            aria-label="Zoom out"
                                            onClick={() => changeZoom(-0.1)}
                                            className="brain-toolbar-zoom-button"
                                        >
                                            −
                                        </button>
                                        <span className="brain-toolbar-zoom-value">
                                            {Math.round(canvasZoom * 100)}%
                                        </span>
                                        <button
                                            type="button"
                                            aria-label="Zoom in"
                                            onClick={() => changeZoom(0.1)}
                                            className="brain-toolbar-zoom-button"
                                        >
                                            +
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="Close bot brain workspace"
                                        title="Close"
                                        onClick={() => { setIsNodeSearchOpen(false); setIsCustomVariablesOpen(false); setIsLogicOpen(false); }}
                                        className="brain-toolbar-button brain-toolbar-close"
                                    >
                                        <span aria-hidden="true">×</span><span className="brain-toolbar-close-label">CLOSE</span>
                                    </button>
                                </div>
                            </div>
                        </header>
                        {tutorialMode && <TutorialBrainCoach step={tutorialStep} onShowSolution={onShowTutorialSolution} />}
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
                                canUndo={!isTraining && editHistory[activeBrain].undo.length > 0}
                                canRedo={!isTraining && editHistory[activeBrain].redo.length > 0}
                                onUndo={() => travelHistory("undo")}
                                onRedo={() => travelHistory("redo")}
                                isSearchOpen={isNodeSearchOpen}
                                onSearchClose={() => setIsNodeSearchOpen(false)}
                            />
                        {isCustomVariablesOpen && <CustomVariablesModal configuration={activeConfiguration} currentValues={activeCustomVariableValues} disabled={isTraining} stateVariables={visibleStateVariables} defaultVariable={defaultVariable} targetTypes={visibleTargetTypes} onChange={updateActiveConfiguration} onClose={() => setIsCustomVariablesOpen(false)} renderConditionEditor={(props) => <ConditionEditor {...props} />} />}
                    </section>
                </div>
            )}
        </aside>
    );
}

function DeferredNumberInput({ value, onCommit, min = CUSTOM_INTEGER_MIN, max = CUSTOM_INTEGER_MAX, fallback = 0, step = 1, ...props }) {
    const [draft, setDraft] = useState(String(value ?? fallback));
    const commit = () => {
        const normalized = clampNumber(draft, min, max, fallback, step);
        setDraft(String(normalized));
        onCommit(normalized);
    };
    return <input {...props} type="text" inputMode={step < 1 ? "decimal" : "numeric"} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); } }} />;
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
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    isSearchOpen,
    onSearchClose,
}) {
    const viewportRef = useRef(null);
    const [nodeOffsets, setNodeOffsets] = useState({});
    const columns = configuration.columns ?? [];
    const graphActionCount = countLogicBlocks(configuration);
    const graphConditionCount = countLogicConditions(configuration);
    const graph = buildLogicGraph(columns);
    const canvasWidth = LOGIC_CANVAS_WIDTH;
    const canvasHeight = LOGIC_CANVAS_HEIGHT;
    const clampPan = (nextPan) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return nextPan;
        const margin = 80;
        return {
            x: clamp(nextPan.x, rect.width - canvasWidth * zoom - margin, margin),
            y: clamp(nextPan.y, rect.height - canvasHeight * zoom - margin, margin),
        };
    };
    const beginPan = (event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        const start = { x: event.clientX, y: event.clientY, pan };
        const move = (next) => onPanChange(clampPan({ x: start.pan.x + next.clientX - start.x, y: start.pan.y + next.clientY - start.y }));
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
        const graphNode = [...graph.brains, ...graph.conditions, ...graph.actions].find((node) => node.id === key);
        const move = (next) => setNodeOffsets((current) => ({
            ...current,
            [key]: {
                x: clamp(startOffset.x + (next.clientX - start.x) / zoom, -graphNode.x, canvasWidth - graphNode.x - graphNode.width),
                y: clamp(startOffset.y + (next.clientY - start.y) / zoom, -graphNode.y, canvasHeight - graphNode.y - graphNode.height),
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
    const centerOnBrain = (node) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const offset = nodeOffsets[node.id] ?? { x: 0, y: 0 };
        onPanChange(clampPan({
            x: rect.width / 2 - (node.x + offset.x + node.width / 2) * zoom,
            y: rect.height / 2 - (node.y + offset.y + node.height / 2) * zoom,
        }));
    };
    const updateBranch = (columnIndex, path, updater) => onChange(updateTreeBranch(columns, columnIndex, path, updater));
    const removeBranch = (columnIndex, path) => onChange(removeTreeBranch(columns, columnIndex, path));
    return (
        <div
            ref={viewportRef}
            className="brain-board relative min-h-0 flex-1 overflow-hidden bg-zinc-900"
            onPointerDown={beginPan}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={(event) => {
                event.preventDefault();
                const rect = viewportRef.current?.getBoundingClientRect();
                onZoomChange(event.deltaY > 0 ? -0.06 : 0.06, rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
            }}
        >
            {!columns.length && <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] tracking-widest text-ink-muted">ADD A BRAIN NODE TO START</div>}
            <div className="brain-history-rail absolute inset-y-0 left-0 z-20 flex w-14 flex-col items-center justify-end gap-2 border-r border-white/10 bg-[#14181c]/95 px-2 py-4 shadow-[8px_0_20px_rgba(0,0,0,.12)]">
                <button type="button" aria-label="Undo brain edit" title="Undo" disabled={!canUndo} onClick={onUndo} className="brain-history-button">↶</button>
                <button type="button" aria-label="Redo brain edit" title="Redo" disabled={!canRedo} onClick={onRedo} className="brain-history-button">↷</button>
            </div>
            {isSearchOpen && <SearchBrainNodesModal containerRef={viewportRef} columns={columns} nodes={graph.brains} disabled={disabled} canRemove={canRemove} onSelect={centerOnBrain} onRemove={removeColumn} onDeleteAll={() => { if (window.confirm("Delete all brain nodes?")) onChange([]); }} onClose={onSearchClose} />}
            <div className="absolute left-0 top-0 bg-[#171b20] bg-[radial-gradient(circle,rgba(100,116,139,.24)_1px,transparent_1px)] bg-[size:20px_20px]" style={{ width: canvasWidth, height: canvasHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
                <svg className="pointer-events-none absolute inset-0 overflow-hidden" width={canvasWidth} height={canvasHeight}>
                    {graph.edges.map((edge) => <path key={edge.id} d={graphEdgePath(edge, nodeOffsets)} fill="none" stroke="rgba(165,180,252,.72)" strokeWidth="2" />)}
                </svg>
                {graph.brains.map((node) => {
                    const column = columns[node.columnIndex];
                    return <section key={node.id} className="absolute w-[300px] rounded-sm border border-cyan-600 bg-zinc-950 shadow-2xl" style={graphNodeStyle(node, nodeOffsets)}>
                        <header onPointerDown={(event) => beginNodeDrag(event, node.id)} className="flex cursor-move items-center justify-between rounded-t-sm bg-cyan-950 px-3 py-2 font-mono text-[10px] font-bold text-cyan-100"><span>BRAIN NODE {node.columnIndex + 1}</span><span>PRIORITY #{node.columnIndex + 1}</span></header>
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
                    return <GraphActionNode key={node.id} {...{ node, entry, actions, branch, disabled, selectedClass, targetTypes, stateVariables, nodeOffsets, beginNodeDrag }} customVariables={configuration.customVariables ?? []}
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
    const next = actionTypes.find((action) => action.id !== "none" && action.id !== "variable" && !usedHeads.has(actionExecutionHead(action)));
    return next ? setGraphActions(branch, [...actions, { action: next.id, actionTarget: "opponent" }]) : branch;
}

function GraphConditionNode({ node, branch, disabled, canRemove, canAddAction, canAddCondition, stateVariables, defaultVariable, targetTypes, nodeOffsets, beginNodeDrag, onChange, onRemove, onAddConditional, onAddAction }) {
    const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
    const siblingIndex = node.path.at(-1);
    return <section className="absolute w-[460px] rounded-sm border border-blue-500 bg-zinc-950 shadow-2xl" style={graphNodeStyle(node, nodeOffsets)}>
        <header onPointerDown={(event) => beginNodeDrag(event, node.id)} className="flex cursor-move items-center justify-between rounded-t-sm bg-blue-700 px-3 py-2 font-mono text-[10px] font-bold text-white"><span>CONDITIONAL {node.priority}</span><span className="rounded-sm bg-black/30 px-1.5 py-0.5 text-[8px]">{siblingIndex === 0 ? "IF" : "ELSE IF"}</span></header>
        <div className="space-y-2 p-3 text-[10px] [&_button]:!text-[10px] [&_input]:!text-[10px] [&_select]:!text-[10px] [&_span]:!text-[10px]">
            {conditions.map((condition, index) => <ConditionEditor key={`${index}-${condition.type}`} condition={condition} prefix={index ? (condition.join === "or" ? "OR" : "AND") : "IF"} canChangeJoin={index > 0} removable={conditions.length > 1} stateVariables={stateVariables} defaultVariable={defaultVariable} targetTypes={targetTypes} onChange={(next) => onChange({ conditions: conditions.map((item, candidate) => candidate === index ? next : item) })} onRemove={() => onChange({ conditions: conditions.filter((_, candidate) => candidate !== index) })} />)}
            <div className="flex flex-wrap gap-3 border-t border-border-lo pt-2 font-mono text-[10px] font-semibold tracking-wide"><button type="button" disabled={disabled || !canAddCondition || conditions.length >= MAX_CONDITIONS_PER_BLOCK} onClick={() => onChange({ conditions: [...conditions, createExpressionCondition(defaultVariable.id)] })} className="text-blue-200 disabled:opacity-35">+ CONDITION</button><button type="button" disabled={disabled || !canAddCondition} onClick={onAddConditional} className="text-violet-300 disabled:opacity-35">+ CHILD IF</button><button type="button" disabled={disabled || !canAddAction} onClick={onAddAction} className="text-fuchsia-300 disabled:opacity-35">+ ACTION</button></div>
            <div className="flex justify-end border-t border-border-lo pt-2 font-mono text-[9px]"><button type="button" disabled={!canRemove} onClick={onRemove} className="text-red-300">REMOVE</button></div>
        </div>
    </section>;
}

function GraphActionNode({ node, entry, actions, disabled, selectedClass, targetTypes, stateVariables, customVariables, nodeOffsets, beginNodeDrag, onChange, onRemove }) {
    const actionTypes = actionTypesForCombatClass(ACTION_TYPES, selectedClass);
    const selected = actionTypes.find((action) => action.id === entry.action) ?? actionTypes[0];
    const usedHeads = new Set(actions.filter((_, index) => index !== node.actionIndex).map((item) => actionTypes.find((action) => action.id === item.action)).filter(Boolean).map(actionExecutionHead));
    const available = actionTypes.filter((action) => !LEGACY_MOVEMENT_ACTION.test(action.id) && (action.id === "variable" || action.id === entry.action || action.id === "none" || !usedHeads.has(actionExecutionHead(action))));
    const targetMode = selected.movementConfig ? (entry.movementMode ?? "target") : entry.targetMode === "coordinates"
        || (entry.targetMode == null && (entry.targetX != null || entry.targetY != null))
        ? "coordinates"
        : "target";
    const changeAction = (action) => onChange({
        ...entry,
        action,
        movementMode: "target",
        movementDirection: "toward",
        ...(action === "variable" ? {
            variableId: customVariables[0]?.id ?? "",
            operation: "set",
            value: customVariables[0]?.valueType === "boolean" ? false : 0,
        } : {}),
    });
    return <section className="absolute w-[460px] rounded-sm border border-fuchsia-500 bg-zinc-950 shadow-2xl" style={graphNodeStyle(node, nodeOffsets)}>
        <header onPointerDown={(event) => beginNodeDrag(event, node.id)} className="cursor-move rounded-t-sm bg-fuchsia-800 px-3 py-2 font-mono text-[10px] font-bold text-white">ACTION NODE</header>
        <div className="space-y-2 p-3 text-[10px] [&_button]:!text-[10px] [&_input]:!text-[10px] [&_select]:!text-[10px]"><SearchablePicker value={selected.id} options={available} placeholder="Search actions..." onChange={changeAction} />
            {selected.variableAction && <VariableActionControls entry={entry} variables={customVariables} stateVariables={stateVariables} onChange={onChange} />}
            {selected.movementConfig && <MovementConfigurationControls entry={entry} onChange={onChange} />}
            {selected.orientationConfig && <PhaseOrientationControls entry={entry} onChange={onChange} />}
            {selected.coordinateTarget && !selected.movementConfig && <select value={targetMode} onChange={(event) => onChange({ ...entry, targetMode: event.target.value })} className="h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 font-mono text-[9px] text-white"><option value="target">Target object at execution</option><option value="coordinates">Exact coordinates</option></select>}
            {actionSupportsTarget(selected) && (!selected.coordinateTarget || targetMode === "target") && <OrderedTargetPicker value={entry.actionTarget} targetTypes={targetTypes} onChange={(actionTarget) => onChange({ ...entry, actionTarget })} />}
            {actionSupportsTarget(selected) && (!selected.coordinateTarget || targetMode === "target") && <div className="grid grid-cols-2 gap-2"><label className="font-mono text-[9px] text-ink-muted">TARGET OFFSET X<DeferredNumberInput min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={entry.targetOffsetX ?? 0} onCommit={(targetOffsetX) => onChange({ ...entry, targetOffsetX })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white" /></label><label className="font-mono text-[9px] text-ink-muted">TARGET OFFSET Y<DeferredNumberInput min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={entry.targetOffsetY ?? 0} onCommit={(targetOffsetY) => onChange({ ...entry, targetOffsetY })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white" /></label></div>}
            {selected.coordinateTarget && targetMode === "coordinates" && <div className="grid grid-cols-2 gap-2"><label className="font-mono text-[9px] text-ink-muted">TARGET X<DeferredNumberInput min={0} max={1000} value={entry.targetX ?? 500} fallback={500} onCommit={(targetX) => onChange({ ...entry, targetX })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white" /></label><label className="font-mono text-[9px] text-ink-muted">TARGET Y<DeferredNumberInput min={0} max={800} value={entry.targetY ?? 400} fallback={400} onCommit={(targetY) => onChange({ ...entry, targetY })} className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-900 px-2 text-white" /></label></div>}
            <button type="button" disabled={disabled} onClick={onRemove} className="font-mono text-[9px] text-red-300">REMOVE ACTION</button></div>
    </section>;
}

function VariableActionControls({ entry, variables, stateVariables, onChange }) {
    const selected = variables.find((variable) => variable.id === entry.variableId) ?? variables[0];
    if (!selected) return <div className="font-mono text-[9px] text-amber-300">CREATE A CUSTOM VARIABLE FIRST</div>;
    const derived = Boolean(selected.conditions?.length);
    const operation = selected.valueType === "boolean" ? "set" : entry.operation ?? "set";
    const terms = entry.terms?.length ? entry.terms : [{ operator: operation, operand: { type: "number", value: entry.value ?? 0 } }];
    const operands = [...stateVariables.filter((variable) => variable.valueType === "number"), ...variables.filter((variable) => variable.valueType === "number").map((variable) => ({ ...variable, label: variable.name }))];
    const updateTerm = (index, updates) => onChange({ ...entry, variableId: selected.id, terms: terms.map((term, candidate) => candidate === index ? { ...term, ...updates } : term) });
    return <div className="grid grid-cols-3 gap-2">
        <select value={selected.id} onChange={(event) => onChange({ ...entry, variableId: event.target.value, operation: "set", value: 0, terms: [{ operator: "set", operand: { type: "number", value: 0 } }] })} className="h-8 rounded border border-border-lo bg-zinc-950 px-2 text-white">{variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select>
        {selected.valueType === "boolean" ? <><span className="flex h-8 items-center justify-center text-white">=</span><select disabled={derived} value={String(entry.value ?? false)} onChange={(event) => onChange({ ...entry, variableId: selected.id, operation: "set", value: event.target.value === "true" })} className="h-8 rounded border border-border-lo bg-zinc-950 px-2 text-white"><option value="false">FALSE</option><option value="true">TRUE</option></select></> : <div className="col-span-2 space-y-2">{terms.map((term, index) => <div key={index} className="grid grid-cols-[48px_90px_1fr_24px] gap-1"><select value={term.operator} onChange={(event) => updateTerm(index, { operator: event.target.value })} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 text-white">{index === 0 && <option value="set">=</option>}<option value="add">+</option><option value="subtract">-</option></select><select value={term.operand?.type ?? "number"} onChange={(event) => updateTerm(index, { operand: event.target.value === "variable" ? { type: "variable", value: operands[0]?.id ?? "my.hp" } : { type: "number", value: 0 } })} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 text-white"><option value="number">NUMBER</option><option value="variable">VARIABLE</option></select>{term.operand?.type === "variable" ? <select value={term.operand.value} onChange={(event) => updateTerm(index, { operand: { type: "variable", value: event.target.value } })} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 text-white">{operands.map((operand) => <option key={operand.id} value={operand.id}>{operand.label}</option>)}</select> : <DeferredNumberInput min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={term.operand?.value ?? 0} onCommit={(value) => updateTerm(index, { operand: { type: "number", value } })} className="h-8 rounded border border-border-lo bg-zinc-950 px-2 text-white" />}<button type="button" disabled={terms.length === 1} onClick={() => onChange({ ...entry, terms: terms.filter((_, candidate) => candidate !== index).map((item, candidate) => candidate === 0 && item.operator === "set" ? item : item) })} className="text-red-300">×</button></div>)}<button type="button" onClick={() => onChange({ ...entry, variableId: selected.id, terms: [...terms, { operator: "add", operand: { type: "number", value: 0 } }] })} className="text-emerald-300">+ OPERAND</button></div>}
        {derived && <span className="col-span-3 font-mono text-[9px] text-amber-300">Derived booleans are read-only.</span>}
    </div>;
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
                    <DeferredNumberInput
                        min={MIN_PRIORITY}
                        max={MAX_PRIORITY}
                        value={cluster.priority ?? 1}
                        disabled={disabled}
                        fallback={1}
                        onCommit={(priority) => onChange({ priority })}
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
            <DeferredNumberInput
                min={MIN_PRIORITY}
                max={MAX_PRIORITY}
                value={block.priority ?? 1}
                fallback={1}
                onCommit={(priority) => onChange({ priority })}
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
                        {actionSupportsTarget(selectedAction) && (!selectedAction.coordinateTarget || targetMode === "target") && <div className="mt-2 grid grid-cols-2 gap-2"><label className="font-mono text-[9px] text-ink-muted">OFFSET X<DeferredNumberInput min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={entry.targetOffsetX ?? 0} onCommit={(targetOffsetX) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetOffsetX } : candidate))} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 text-ink-white" /></label><label className="font-mono text-[9px] text-ink-muted">OFFSET Y<DeferredNumberInput min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={entry.targetOffsetY ?? 0} onCommit={(targetOffsetY) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetOffsetY } : candidate))} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 text-ink-white" /></label></div>}
                        {selectedAction.coordinateTarget && targetMode === "coordinates" && <div className="mt-2 grid grid-cols-2 gap-2"><label className="font-mono text-[9px] text-ink-muted">TARGET X<DeferredNumberInput min={0} max={1000} value={entry.targetX ?? 500} fallback={500} onCommit={(targetX) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetX } : candidate))} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 text-ink-white" /></label><label className="font-mono text-[9px] text-ink-muted">TARGET Y<DeferredNumberInput min={0} max={800} value={entry.targetY ?? 400} fallback={400} onCommit={(targetY) => updateActions(blockActions.map((candidate, index) => index === actionIndex ? { ...candidate, targetY } : candidate))} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 text-ink-white" /></label></div>}
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
                        <DeferredNumberInput key={definition.id}
                            min={definition.min ?? CUSTOM_INTEGER_MIN}
                            max={definition.max ?? CUSTOM_INTEGER_MAX}
                            value={condition.value}
                            fallback={definition.defaultValue}
                            onCommit={(value) => onChange({ ...condition, value })}
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
    const targetOptionsFor = (definition) => definition?.fighterTargetOnly
        ? targetTypes.filter((target) => target.id === "opponent")
        : definition?.targetGroup === "objects"
        ? objectTargetTypes(targetTypes)
        : targetTypes;
    const selectedTargetFor = (definition, field) => {
        const options = targetOptionsFor(definition);
        const requested = condition[field] ?? condition.target;
        return options.some((target) => target.id === String(requested).split(":")[0])
            ? requested
            : definition?.defaultTarget ?? (definition?.targetGroup === "objects" ? "object_1" : "opponent");
    };

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
            ...createExpressionCondition(nextLeft),
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
                        <DeferredNumberInput
                            aria-label="Minimum target direction"
                            min={leftDefinition.min}
                            max={leftDefinition.max}
                            step={1}
                            value={condition.right?.min ?? leftDefinition.defaultMin}
                            fallback={leftDefinition.defaultMin}
                            onCommit={(min) => onChange({ ...condition, comparator: "range", right: { type: "range", min, max: condition.right?.max ?? leftDefinition.defaultMax } })}
                            className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                        />
                        <span className="font-mono text-[9px] text-ink-muted">° TO</span>
                        <DeferredNumberInput
                            aria-label="Maximum target direction"
                            min={leftDefinition.min}
                            max={leftDefinition.max}
                            step={1}
                            value={condition.right?.max ?? leftDefinition.defaultMax}
                            fallback={leftDefinition.defaultMax}
                            onCommit={(max) => onChange({ ...condition, comparator: "range", right: { type: "range", min: condition.right?.min ?? leftDefinition.defaultMin, max } })}
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
                                <DeferredNumberInput key={leftDefinition.id}
                                    min={leftDefinition.min ?? CUSTOM_INTEGER_MIN}
                                    max={leftDefinition.max ?? CUSTOM_INTEGER_MAX}
                                    step={leftDefinition.step ?? 1}
                                    value={condition.right?.value ?? leftDefinition.defaultValue}
                                    fallback={leftDefinition.defaultValue}
                                    onCommit={(value) => onChange({ ...condition, right: { type: "number", value } })}
                                    className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white"
                                />
                                {leftDefinition.suffix && (
                                    <span className="font-mono text-[9px] text-ink-muted">{leftDefinition.suffix}</span>
                                )}
                            </div>
                        )}
                    </div>
                ))}
                {!isAlways && leftDefinition.supportsTarget && (
                    <label className="col-span-3 grid grid-cols-[72px_1fr] items-center gap-1 font-mono text-[9px] text-ink-muted">
                        <span>LEFT TARGET</span>
                        <OrderedTargetPicker value={selectedTargetFor(leftDefinition, "leftTarget")} targetTypes={targetOptionsFor(leftDefinition)} onChange={(leftTarget) => onChange({ ...condition, leftTarget })} />
                    </label>
                )}
                {!isAlways && rightVariableDefinition?.supportsTarget && (
                    <label className="col-span-3 grid grid-cols-[72px_1fr] items-center gap-1 font-mono text-[9px] text-ink-muted">
                        <span>RIGHT TARGET</span>
                        <OrderedTargetPicker value={selectedTargetFor(rightVariableDefinition, "rightTarget")} targetTypes={targetOptionsFor(rightVariableDefinition)} onChange={(rightTarget) => onChange({ ...condition, rightTarget })} />
                    </label>
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
            <div className={`font-interface-semibold truncate ${color}`}>{label}</div>
            <div className="font-interface-numeric mt-1 text-base text-ink-white">{value}</div>
        </div>
    );
}

function PanelHeading({ icon, children }) {
    return <span className="font-display-action flex items-center gap-2 text-base tracking-[.09em] text-sky-300"><ToolIcon name={icon} />{children}</span>;
}

function ToolIcon({ name }) {
    return <MatchToolIcon name={name} />;
}

function ControlButton({ children, icon, label, onClick, disabled, tone = "neutral", className = "" }) {
    const tones = {
        neutral: "border-slate-600/70 bg-slate-950/25 text-slate-300 hover:border-slate-500 hover:bg-slate-800/60 hover:text-white",
        blue: "border-blue-700/60 bg-blue-950/25 text-blue-300 hover:bg-blue-900/40",
        green: "border-emerald-700/60 bg-emerald-950/25 text-emerald-300 hover:bg-emerald-900/35",
        red: "border-red-700/60 bg-red-950/25 text-red-300 hover:bg-red-900/35",
        violet: "border-violet-700/60 bg-violet-950/25 text-violet-300 hover:bg-violet-900/35",
        amber: "border-amber-700/60 bg-amber-950/25 text-amber-300 hover:bg-amber-900/35",
    };
    const accessibleLabel = label ?? (typeof children === "string" || typeof children === "number" ? String(children) : "Tool");
    return (
        <button
            type="button"
            aria-label={accessibleLabel}
            title={accessibleLabel}
            onClick={onClick}
            disabled={disabled}
            className={`font-display-action flex min-h-11 items-center justify-center rounded-lg border px-2 py-2 text-base shadow-[0_5px_15px_rgba(0,0,0,.12)] transition disabled:cursor-not-allowed disabled:opacity-30 ${tones[tone] ?? tones.neutral} ${className}`}
        >
            {icon && <ToolIcon name={icon} />}<span className="sr-only">{children}</span>
        </button>
    );
}

function BrainTab({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`brain-tab ${active ? "is-active" : ""}`}
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
    return countConditionSlots(configuration);
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
        {ordered && <DeferredNumberInput aria-label="Target ordinal" min={1} max={100} value={ordinal} fallback={1} onCommit={(value) => onChange(encode(base, order, value))} className="h-8 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white" />}
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

function formatClock(value) {
    if (value == null) return "--:--";
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
