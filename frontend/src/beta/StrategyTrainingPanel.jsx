import { useRef, useState } from "react";
import {
    ACTION_TYPES,
    CONDITION_DEFINITIONS,
    CONDITION_TYPES,
    TARGET_TYPES,
    actionSupportsTarget,
    createLogicBlock,
    MAX_CONDITIONS_PER_BLOCK,
    MAX_LOGIC_BLOCKS,
    MAX_STRATEGY_EPOCHS,
    MAX_STRATEGY_EXAMPLES,
    MIN_BLOCK_EXAMPLES,
    strategyExampleCount,
    STRATEGY_TIME_LIMIT_MS,
    validateMeleeStrategyConfiguration,
} from "../ml/MeleeStrategy.js";

const LOGIC_BLOCK_WIDTH = 360;
const LOGIC_BLOCK_HEIGHT_ESTIMATE = 300;

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
    onStartTraining,
    onStopTraining,
    isTraining,
    progress,
    summary,
    selectedClass = "melee",
    isMatchTraining = false,
    matchContext = null,
    trainingRemaining = null,
    playerRoundWins = 0,
    opponentRoundWins = 0,
    obstacleCount = 0,
    isAutoPlaying = false,
    hasCleanPlaySnapshot = false,
    isBaseTraining = false,
    baseCandidate = null,
    baseExportState = "idle",
    finishStatus = null,
    isFinishingMatch = false,
    canFinishMatch = false,
    onCleanPlayToggle,
    onResetCleanPlay,
    onResetRoundModel,
    onTrainBaseModel,
    onExportBaseModel,
    onFinishMatch,
}) {
    const [isLogicOpen, setIsLogicOpen] = useState(false);
    const [blockPositions, setBlockPositions] = useState({});
    const [activeBlockId, setActiveBlockId] = useState(null);
    const workspaceRef = useRef(null);
    const dragRef = useRef(null);
    const allocated = strategyExampleCount(configuration);
    const remaining = MAX_STRATEGY_EXAMPLES - allocated;
    const validation = validateMeleeStrategyConfiguration(configuration);
    const updateBlocks = (blocks) => onChange({ ...configuration, blocks });
    const updateBlock = (index, updates) => updateBlocks(configuration.blocks.map((block, candidate) => (
        candidate === index ? { ...block, ...updates } : block
    )));
    const totalRounds = Math.max(1, (matchContext?.winsRequired ?? 1) * 2 - 1);
    const positionForBlock = (block, index) => blockPositions[block.id] ?? {
        x: 24 + (index % 2) * (LOGIC_BLOCK_WIDTH + 24),
        y: 24 + Math.floor(index / 2) * (LOGIC_BLOCK_HEIGHT_ESTIMATE + 24),
    };

    const addLogicBlock = () => {
        const block = createLogicBlock();
        setActiveBlockId(block.id);
        updateBlocks([...configuration.blocks, block]);
    };

    const beginDrag = (event, block, index) => {
        if (isTraining) return;
        const position = positionForBlock(block, index);
        setActiveBlockId(block.id);
        dragRef.current = {
            blockId: block.id,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: position.x,
            originY: position.y,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const moveDrag = (event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const bounds = workspaceRef.current?.getBoundingClientRect();
        const maxX = bounds ? Math.max(0, bounds.width - LOGIC_BLOCK_WIDTH - 24) : 720;
        const maxY = bounds ? Math.max(0, bounds.height - 120) : 520;
        const nextX = clamp(drag.originX + event.clientX - drag.startX, 12, maxX);
        const nextY = clamp(drag.originY + event.clientY - drag.startY, 12, maxY);
        setBlockPositions((current) => ({
            ...current,
            [drag.blockId]: { x: nextX, y: nextY },
        }));
    };

    const endDrag = () => {
        dragRef.current = null;
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
                        <strong className={remaining < 0 ? "text-red-300" : "text-ink-muted"}>
                            {allocated}/{MAX_STRATEGY_EXAMPLES}
                        </strong>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsLogicOpen(true)}
                        className="mt-3 h-10 w-full rounded border border-cyan-800/70 bg-cyan-950/30 font-mono text-[11px] font-bold tracking-widest text-cyan-200 hover:bg-cyan-900/40"
                    >
                        OPEN LOGIC BLOCKS
                    </button>
                    <div className="mt-3 flex items-center justify-between font-mono text-[10px] tracking-widest text-ink-muted">
                        <span>BLOCKS</span>
                        <strong className="text-ink-white">{configuration.blocks.length}/{MAX_LOGIC_BLOCKS}</strong>
                    </div>
                    <label className="mt-4 block font-mono text-[10px] tracking-widest text-ink-muted">
                        EPOCH LIMIT
                    </label>
                    <input
                        type="number"
                        min="1"
                        max={MAX_STRATEGY_EPOCHS}
                        value={configuration.epochLimit}
                        disabled={isTraining}
                        onChange={(event) => onChange({ ...configuration, epochLimit: event.target.value })}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                onChange({ ...configuration, epochLimit: clampNumber(event.currentTarget.value, 1, MAX_STRATEGY_EPOCHS, 12) });
                            }
                        }}
                        className="mt-1 h-9 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[11px] text-ink-white"
                    />
                    {validation.errors.map((error) => <p key={error} className="mt-2 text-[10px] text-red-300">{error}</p>)}
                    <div className="mt-3 flex justify-between font-mono text-[10px] text-ink-muted">
                        <span>CLIENT TIME LIMIT</span>
                        <strong className="text-amber-200">{STRATEGY_TIME_LIMIT_MS / 1000}s</strong>
                    </div>
                    <button
                        type="button"
                        onClick={isTraining ? onStopTraining : onStartTraining}
                        disabled={!isTraining && validation.errors.length > 0}
                        className={`mt-4 h-9 w-full rounded border font-mono text-[11px] font-bold tracking-widest disabled:opacity-40 ${isTraining
                            ? "border-red-700/60 bg-red-900/30 text-red-200"
                            : "border-green-700/60 bg-green-900/30 text-green-200"}`}
                    >
                        {isTraining ? "STOP AFTER BATCH" : "GENERATE + TRAIN"}
                    </button>
                </section>

                <section className="rounded border border-border-lo bg-arena-surface p-3">
                    <div className="mb-3 flex items-center justify-between font-mono text-[10px] tracking-widest">
                        <span className="text-cyan">MATCH TOOLS</span>
                        <span className="text-ink-muted">{selectedClass.toUpperCase()}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <ControlButton
                            onClick={onCleanPlayToggle}
                            disabled={isBaseTraining || isTraining}
                            tone={isAutoPlaying ? "neutral" : "blue"}
                        >
                            {isAutoPlaying ? "STOP PLAY" : "CLEAN PLAY"}
                        </ControlButton>
                        <ControlButton
                            onClick={onResetCleanPlay}
                            disabled={isBaseTraining || isTraining || !hasCleanPlaySnapshot}
                            tone="neutral"
                        >
                            RESET PLAY
                        </ControlButton>
                    </div>
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
                                RESET MODEL
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
                                            : "FINISH MODEL"}
                            </ControlButton>
                        </>
                    ) : (
                        <>
                            <ControlButton
                                onClick={onTrainBaseModel}
                                disabled={isBaseTraining || isTraining}
                                tone="violet"
                                className="mt-3 w-full"
                            >
                                {isBaseTraining ? "TRAINING BASE" : "TRAIN BASE"}
                            </ControlButton>
                            <ControlButton
                                onClick={onExportBaseModel}
                                disabled={isBaseTraining || isTraining || !baseCandidate}
                                tone={baseExportState === "exported" ? "green" : baseExportState === "error" ? "red" : "amber"}
                                className="mt-2 w-full"
                            >
                                {baseExportState === "exporting"
                                    ? "EXPORTING..."
                                    : baseExportState === "exported"
                                        ? "EXPORTED"
                                        : baseExportState === "error"
                                            ? "EXPORT FAILED"
                                            : "APPROVE + EXPORT"}
                            </ControlButton>
                        </>
                    )}
                </section>

                {(progress || summary) && (
                    <section className="rounded border border-border-lo bg-arena-surface p-3 font-mono text-[10px]">
                        <div className="tracking-widest text-cyan">TRAINING METRICS</div>
                        {progress && <Metric label="Epoch" value={`${progress.epoch}/${progress.epochs}`} />}
                        <Metric label="Training loss" value={formatLoss(progress?.loss ?? summary?.finalLoss)} />
                        <Metric label="Validation loss" value={formatLoss(progress?.validationLoss ?? summary?.validationLoss)} />
                        {summary && <>
                            <Metric label="Overall logic accuracy" value={formatPercent(summary.logicAccuracy)} />
                            <Metric label="Movement accuracy" value={formatPercent(summary.movementAccuracy)} />
                            <Metric label="Rotation accuracy" value={formatPercent(summary.rotationAccuracy)} />
                            <Metric label="Rotation MAE" value={formatLoss(summary.rotationMeanAbsoluteError)} />
                            <Metric label="Swing accuracy" value={formatPercent(summary.swingAccuracy)} />
                            <Metric label="Block accuracy" value={formatPercent(summary.blockAccuracy)} />
                            <Metric label="Dash accuracy" value={formatPercent(summary.dashAccuracy)} />
                            <Metric label="Validation examples" value={summary.validationSamples} />
                        </>}
                    </section>
                )}
            </div>

            {isLogicOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 py-5">
                    <section className="flex h-[min(88vh,760px)] w-[min(94vw,1120px)] flex-col overflow-hidden rounded border border-border-mid bg-zinc-800 shadow-2xl">
                        <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border-lo px-4">
                            <div>
                                <div className="font-mono text-[11px] font-bold tracking-widest text-cyan">LOGIC BLOCK WORKSPACE</div>
                                <div className="mt-1 font-mono text-[9px] tracking-widest text-ink-muted">
                                    {allocated}/{MAX_STRATEGY_EXAMPLES} SAMPLES
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={isTraining || configuration.blocks.length >= MAX_LOGIC_BLOCKS}
                                    onClick={addLogicBlock}
                                    className="h-8 rounded border border-dashed border-cyan-800/70 px-3 font-mono text-[10px] tracking-widest text-cyan-300 disabled:opacity-35"
                                >
                                    ADD LOGIC BLOCK
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsLogicOpen(false)}
                                    className="h-8 rounded border border-border-lo bg-zinc-900 px-3 font-mono text-[10px] tracking-widest text-ink-mid hover:text-ink-white"
                                >
                                    CLOSE
                                </button>
                            </div>
                        </header>
                        <div
                            ref={workspaceRef}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            className="relative min-h-0 flex-1 overflow-auto bg-zinc-800"
                        >
                            <div
                                className="absolute inset-0 bg-zinc-800"
                                style={{
                                    width: "max(100%, 980px)",
                                    height: `${Math.max(620, 48 + Math.ceil(configuration.blocks.length / 2) * (LOGIC_BLOCK_HEIGHT_ESTIMATE + 24))}px`,
                                }}
                            />
                            {configuration.blocks.length === 0 && (
                                <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] tracking-widest text-ink-muted">
                                    ADD A LOGIC BLOCK TO START
                                </div>
                            )}
                            {configuration.blocks.map((block, blockIndex) => {
                                const position = positionForBlock(block, blockIndex);
                                return (
                                    <LogicBlock
                                        key={block.id}
                                        block={block}
                                        index={blockIndex}
                                        disabled={isTraining}
                                        onChange={(updates) => updateBlock(blockIndex, updates)}
                                        onRemove={() => updateBlocks(configuration.blocks.filter((_, index) => index !== blockIndex))}
                                        className="absolute shadow-xl"
                                        style={{
                                            left: position.x,
                                            top: position.y,
                                            width: LOGIC_BLOCK_WIDTH,
                                            zIndex: activeBlockId === block.id ? 20 : blockIndex + 1,
                                        }}
                                        onSelectBlock={() => setActiveBlockId(block.id)}
                                        onBlockPointerDown={(event) => beginDrag(event, block, blockIndex)}
                                    />
                                );
                            })}
                        </div>
                    </section>
                </div>
            )}
        </aside>
    );
}

function LogicBlock({ block, index, disabled, onChange, onRemove, className = "", style = null, onSelectBlock = null, onBlockPointerDown = null }) {
    const updateConditions = (conditions) => onChange({ conditions });
    const selectedAction = ACTION_TYPES.find((action) => action.id === block.action) ?? ACTION_TYPES[0];
    const isDashVeto = selectedAction.id === "no_dash";
    return (
        <fieldset
            disabled={disabled}
            onPointerDown={(event) => {
                onSelectBlock?.();
                if (event.target.closest("button,input,select,textarea,label")) return;
                onBlockPointerDown?.(event);
            }}
            onDragStart={(event) => event.preventDefault()}
            className={`select-none rounded border border-border-lo bg-arena-surface p-3 ${onBlockPointerDown ? "cursor-move" : ""} ${className}`}
            style={style}
        >
            <div
                className="flex items-center justify-between font-mono text-[10px] tracking-widest"
            >
                <strong className="text-cyan-200">IF BLOCK {index + 1}</strong>
                <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onRemove} className="text-red-300">REMOVE</button>
            </div>
            <div className="mt-2 grid gap-2">
                {block.conditions.map((condition, conditionIndex) => (
                    <ConditionEditor
                        key={`${conditionIndex}-${condition.type}`}
                        condition={condition}
                        prefix={conditionIndex ? "AND" : "IF"}
                        onChange={(next) => updateConditions(block.conditions.map((value, index) => index === conditionIndex ? next : value))}
                        onRemove={() => updateConditions(block.conditions.filter((_, index) => index !== conditionIndex))}
                        removable={block.conditions.length > 1}
                    />
                ))}
            </div>
            {block.conditions.length < MAX_CONDITIONS_PER_BLOCK && (
                <button
                    type="button"
                    onClick={() => updateConditions([...block.conditions, { type: CONDITION_TYPES[0].id, value: CONDITION_TYPES[0].defaultValue }])}
                    className="mt-2 font-mono text-[9px] tracking-widest text-cyan-300"
                >+ AND CONDITION</button>
            )}
            <label className="mt-3 block font-mono text-[9px] tracking-widest text-ink-muted">THEN</label>
            <select
                value={block.action}
                onChange={(event) => onChange({ action: event.target.value })}
                className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-ink-white"
            >
                {ACTION_TYPES.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
            </select>
            {actionSupportsTarget(selectedAction) && (
                <>
                    <label className="mt-2 block font-mono text-[9px] tracking-widest text-ink-muted">TARGET</label>
                    <select
                        value={block.actionTarget ?? "opponent"}
                        onChange={(event) => onChange({ actionTarget: event.target.value })}
                        className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-ink-white"
                    >
                        {TARGET_TYPES.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                    </select>
                </>
            )}
            {isDashVeto ? (
                <div className="mt-3 rounded border border-border-lo bg-zinc-950 px-2 py-2 font-mono text-[9px] tracking-widest text-ink-muted">
                    DASH VETO
                </div>
            ) : (
                <>
                    <label className="mt-3 block font-mono text-[9px] tracking-widest text-ink-muted">DEDICATED SAMPLES</label>
                    <input
                        type="number"
                        min={MIN_BLOCK_EXAMPLES}
                        max={MAX_STRATEGY_EXAMPLES}
                        step="32"
                        value={block.sampleCount}
                        onChange={(event) => onChange({ sampleCount: event.target.value })}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                onChange({
                                    sampleCount: clampNumber(
                                        event.currentTarget.value,
                                        MIN_BLOCK_EXAMPLES,
                                        MAX_STRATEGY_EXAMPLES,
                                        256,
                                    ),
                                });
                            }
                        }}
                        className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[10px] text-ink-white"
                    />
                </>
            )}
        </fieldset>
    );
}

function ConditionEditor({ condition, prefix, onChange, onRemove, removable }) {
    const definition = CONDITION_DEFINITIONS.find((candidate) => candidate.id === condition.type) ?? CONDITION_TYPES[0];
    const targetOptions = definition.targetGroup === "objects"
        ? TARGET_TYPES.filter((target) => target.id.startsWith("object_"))
        : TARGET_TYPES;
    const selectedTarget = targetOptions.some((target) => target.id === condition.target)
        ? condition.target
        : definition.defaultTarget ?? "opponent";
    const selectType = (type) => {
        const next = CONDITION_TYPES.find((candidate) => candidate.id === type);
        onChange({
            type,
            ...(next.requiresValue ? { value: next.defaultValue } : {}),
            ...(next.supportsTarget ? { target: next.defaultTarget ?? "opponent" } : {}),
        });
    };
    return (
        <div className="grid grid-cols-[28px_1fr_auto] items-center gap-1">
            <span className="font-mono text-[9px] text-amber-200">{prefix}</span>
            <div className="flex gap-1">
                <select value={condition.type} onChange={(event) => selectType(event.target.value)} className="h-8 min-w-0 flex-1 rounded border border-border-lo bg-zinc-950 px-1 font-mono text-[9px] text-ink-white">
                    {!CONDITION_TYPES.some((candidate) => candidate.id === condition.type) && (
                        <option value={definition.id}>{definition.label}</option>
                    )}
                    {CONDITION_TYPES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
                {definition.requiresValue && <input
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
                />}
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
            className={`min-h-9 rounded border px-2 py-1 font-mono text-[10px] font-bold tracking-widest disabled:cursor-not-allowed disabled:opacity-35 ${tones[tone] ?? tones.neutral} ${className}`}
        >
            {children}
        </button>
    );
}

function Metric({ label, value }) {
    return <div className="mt-2 flex justify-between gap-3 text-ink-muted"><span>{label}</span><strong className="text-ink-white">{value ?? "--"}</strong></div>;
}

function formatLoss(value) {
    return Number.isFinite(value) ? value.toFixed(4) : "--";
}

function formatPercent(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "--";
}

function formatClock(value) {
    if (value == null) return "--:--";
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
