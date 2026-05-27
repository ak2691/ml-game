import { useState, useCallback, useEffect, useRef } from "react";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import PropertiesPanel from "./PropertiesPanel";
import "./BetaModel.css";
import { loadOrCreateModel, deleteSavedModel, createModel } from "../ml/Model";
import {
    predictDirection, clearMemory, stageStep, clearStaging,
    applyBatchReward, applyOverrideVector, loadTrainerState, MAX_REWIND_STEPS
} from "../ml/Trainer";
<<<<<<< HEAD
//test
=======
//comment to trigger change
>>>>>>> fedb9a7dc53356fa5158c9c15adef5e941cec315
const CANVAS_SIZE = 800;
const AUTO_SPEED = 15;
const AUTO_STEP_MS = 180;

const MAIN_SHAPE = {
    id: "main",
    type: "circle",
    x: CANVAS_SIZE / 2,
    y: CANVAS_SIZE / 2,
    size: 60,
    rotation: 0,
};

let _id = 1;
const genId = () => `shape-${Date.now()}-${_id++}`;

export default function BetaModel() {
    const [shapes, setShapes] = useState([MAIN_SHAPE]);
    const [selectedId, setSelectedId] = useState(null);
    const [submitStatus, setSubmitStatus] = useState(null);
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);
    const [isCleanPlayback, setIsCleanPlayback] = useState(false);
    const [hasStagedSteps, setHasStagedSteps] = useState(false);
    const [stagedCount, setStagedCount] = useState(0);
    const [rewindStepCount, setRewindStepCount] = useState(5);
    const [recentMovements, setRecentMovements] = useState([]);
    const [replayIndex, setReplayIndex] = useState(0);
    const [dragState, setDragState] = useState(null);
    const [isEditingArena, setIsEditingArena] = useState(true);

    const modelRef = useRef(null);
    const autoIntervalRef = useRef(null);
    const lastPlayModeRef = useRef("coach");
    const selectedShape = shapes.find((s) => s.id === selectedId) ?? null;
    const selectedReplayCount = Math.min(rewindStepCount, recentMovements.length);
    const replayMovements = recentMovements.slice(-selectedReplayCount);
    const correctionAnchor = replayMovements[0]?.from ?? null;
    const activeReplayMove = replayMovements.length > 0
        ? replayMovements[replayIndex % replayMovements.length]
        : null;

    useEffect(() => {
        loadTrainerState();
        loadOrCreateModel().then((m) => {
            modelRef.current = m;
            console.log("[arena-ml] Model ready.");
        });

        return () => {
            if (autoIntervalRef.current) {
                clearInterval(autoIntervalRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (selectedReplayCount === 0) return;

        const interval = setInterval(() => {
            setReplayIndex((current) => (current + 1) % selectedReplayCount);
        }, 320);

        return () => clearInterval(interval);
    }, [selectedReplayCount]);

    const MAX_OBJECTS = 10;

    const handleAddShape = useCallback((type) => {
        setShapes((prev) => {
            if (prev.length - 1 >= MAX_OBJECTS) return prev;
            const s = {
                id: genId(),
                type,
                x: Math.round(150 + Math.random() * 500),
                y: Math.round(150 + Math.random() * 500),
                size: 60,
                rotation: 0,
            };
            setSelectedId(s.id);
            return [...prev, s];
        });
    }, []);

    const handleUpdateShape = useCallback((id, updates) => {
        setShapes((prev) =>
            prev.map((s) => {
                if (s.id !== id) return s;
                if (s.id === "main") {
                    const { x, y } = updates;
                    return (x !== undefined || y !== undefined)
                        ? { ...s, x: x ?? s.x, y: y ?? s.y }
                        : s;
                }
                return { ...s, ...updates };
            })
        );
    }, []);

    const handleRemoveSelected = useCallback(() => {
        if (!selectedId || selectedId === "main") return;
        setShapes((prev) => prev.filter((s) => s.id !== selectedId));
        setSelectedId(null);
    }, [selectedId]);

    const buildStatePayload = (currentShapes) => {
        const main = currentShapes.find((s) => s.id === "main");
        return {
            playerModel: { x: Math.round(main.x), y: Math.round(main.y) },
            objects: currentShapes
                .filter((s) => s.id !== "main")
                .map((s) => ({
                    id: s.id,
                    type: s.type,
                    x: Math.round(s.x),
                    y: Math.round(s.y),
                    size: s.size,
                    rotation: Math.round(s.rotation),
                })),
        };
    };

    const rememberMovement = (stateSnapshot, action, from, to) => {
        const movement = { from, to, dx: action.dx, dy: action.dy };
        stageStep(stateSnapshot, action, movement);
        setRecentMovements((prev) => [...prev, movement].slice(-MAX_REWIND_STEPS));
        setHasStagedSteps(true);
        setStagedCount((count) => Math.min(count + 1, MAX_REWIND_STEPS));
    };

    const runAutoPlay = (recordMovements = true) => {
        if (isAutoPlaying || !modelRef.current) return;
        lastPlayModeRef.current = recordMovements ? "coach" : "clean";
        if (!recordMovements) {
            clearCoachingWindow();
        }
        setIsEditingArena(false);
        setIsCleanPlayback(!recordMovements);
        setIsAutoPlaying(true);

        autoIntervalRef.current = setInterval(() => {
            setShapes((prevShapes) => {
                const stateSnapshot = buildStatePayload(prevShapes);
                const prediction = predictDirection(modelRef.current, stateSnapshot);
                const mag = Math.sqrt(prediction.dx ** 2 + prediction.dy ** 2);
                const dx = mag > 0.001 ? prediction.dx / mag : 0;
                const dy = mag > 0.001 ? prediction.dy / mag : 0;
                const mainBefore = prevShapes.find((s) => s.id === "main");

                const nextShapes = prevShapes.map((s) => {
                    if (s.id !== "main") return s;
                    return {
                        ...s,
                        x: Math.max(0, Math.min(CANVAS_SIZE, s.x + dx * AUTO_SPEED)),
                        y: Math.max(0, Math.min(CANVAS_SIZE, s.y + dy * AUTO_SPEED)),
                    };
                });

                if (recordMovements) {
                    const mainAfter = nextShapes.find((s) => s.id === "main");
                    rememberMovement(
                        stateSnapshot,
                        { dx, dy },
                        { x: mainBefore.x, y: mainBefore.y },
                        { x: mainAfter.x, y: mainAfter.y }
                    );
                }

                return nextShapes;
            });
        }, AUTO_STEP_MS);
    };

    const stopAutoPlay = () => {
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
        setIsAutoPlaying(false);
    };

    const clearCoachingWindow = () => {
        clearStaging();
        setHasStagedSteps(false);
        setStagedCount(0);
        setRecentMovements([]);
        setReplayIndex(0);
        setRewindStepCount(5);
        setDragState(null);
    };

    const enterEditMode = () => {
        stopAutoPlay();
        clearCoachingWindow();
        setIsCleanPlayback(false);
        setIsEditingArena(true);
    };

    const enterCoachMode = () => {
        lastPlayModeRef.current = "coach";
        setIsCleanPlayback(false);
        setIsEditingArena(false);
    };

    const handleReward = useCallback(async (rewardValue) => {
        if (!hasStagedSteps || selectedReplayCount === 0) return;
        setSubmitStatus({ ok: null, message: "Training..." });

        try {
            if (modelRef.current) {
                await applyBatchReward(modelRef.current, rewardValue, selectedReplayCount);
            }
            setSubmitStatus({
                ok: true,
                message: `Confirmed last ${selectedReplayCount} step${selectedReplayCount !== 1 ? "s" : ""}`,
            });
        } catch (err) {
            setSubmitStatus({ ok: false, message: err.message });
        }

        setTimeout(() => setSubmitStatus(null), 2000);
    }, [hasStagedSteps, selectedReplayCount]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Enter" && hasStagedSteps) {
                handleReward(1);
                return;
            }

            if (e.key.toLowerCase() === "e") {
                if (isEditingArena) {
                    runAutoPlay(lastPlayModeRef.current !== "clean");
                } else {
                    enterEditMode();
                }
                return;
            }

            if (e.code === "Space") {
                e.preventDefault();
                if (isAutoPlaying) {
                    stopAutoPlay();
                } else if (isCleanPlayback) {
                    runAutoPlay(false);
                } else if (isEditingArena) {
                    runAutoPlay(lastPlayModeRef.current !== "clean");
                } else {
                    runAutoPlay(true);
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    });

    const handleResetModel = async () => {
        if (!window.confirm("Are you sure you want to wipe the model's brain? This cannot be undone.")) return;
        stopAutoPlay();
        await deleteSavedModel();
        clearMemory();
        clearStaging();
        modelRef.current = createModel();
        setHasStagedSteps(false);
        setStagedCount(0);
        setRecentMovements([]);
        setReplayIndex(0);
        setSubmitStatus({ ok: true, message: "Brain wiped. Starting fresh." });
        setTimeout(() => setSubmitStatus(null), 3000);
    };

    const handlePointerDown = (e) => {
        if (isEditingArena || !hasStagedSteps || selectedReplayCount === 0 || !correctionAnchor) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const distToAnchor = Math.hypot(correctionAnchor.x - mouseX, correctionAnchor.y - mouseY);

        if (distToAnchor < 80) {
            setDragState({
                startX: correctionAnchor.x,
                startY: correctionAnchor.y,
                currentX: mouseX,
                currentY: mouseY
            });
        }
    };

    const handlePointerMove = (e) => {
        if (!dragState) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setDragState({
            ...dragState,
            currentX: e.clientX - rect.left,
            currentY: e.clientY - rect.top
        });
    };

    const handlePointerUp = async () => {
        if (!dragState) return;

        const dx = dragState.currentX - dragState.startX;
        const dy = dragState.currentY - dragState.startY;
        const mag = Math.hypot(dx, dy);

        setDragState(null);

        if (mag < 10) return;

        setSubmitStatus({ ok: null, message: "Correcting..." });
        try {
            if (modelRef.current) {
                await applyOverrideVector(modelRef.current, dx, dy, selectedReplayCount);
            }
            setSubmitStatus({
                ok: true,
                message: `Corrected last ${selectedReplayCount} step${selectedReplayCount !== 1 ? "s" : ""}`,
            });
        } catch (err) {
            setSubmitStatus({ ok: false, message: err.message });
        }
        setTimeout(() => setSubmitStatus(null), 2000);
    };

    return (
        <div className="flex flex-col min-h-screen bg-arena-deep text-ink-hi font-ui overflow-hidden">
            {submitStatus && (
                <div className={`
                    fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                    px-4 py-2 rounded shadow-lg border text-xs font-mono tracking-widest
                    transition-opacity duration-300
                    ${submitStatus.ok === true
                        ? "bg-green-950 border-green-700 text-green-400"
                        : submitStatus.ok === false
                            ? "bg-red-950 border-red-700 text-red-400"
                            : "bg-arena-panel border-border-lo text-ink-muted"}
                `}>
                    {submitStatus.message}
                </div>
            )}

            <header className="flex items-center justify-between px-6 h-[52px] bg-arena-panel border-b border-border-lo flex-shrink-0">
                <div className="flex items-center gap-3">
                    <span className="text-xl text-cyan leading-none">M</span>
                    <span className="font-ui text-lg font-bold tracking-[0.15em] text-ink-white">MACHINER</span>
                </div>

                <div className="flex items-center gap-2">
                    {isEditingArena ? (
                        <div className="flex items-center gap-3 bg-zinc-900/40 pl-4 pr-1 py-1 rounded border border-border-lo">
                            <span className="text-[11px] text-ink-muted font-bold tracking-widest uppercase">
                                Edit arena
                            </span>
                            <button
                                onClick={() => runAutoPlay(true)}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-5 py-1 rounded text-sm font-bold"
                            >
                                AUTO PLAY
                            </button>
                            <button
                                onClick={() => runAutoPlay(false)}
                                className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-1 rounded text-sm font-bold"
                            >
                                CLEAN PLAY
                            </button>
                            {hasStagedSteps && (
                                <button
                                    onClick={enterCoachMode}
                                    className="bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-1 rounded text-sm font-bold"
                                >
                                    COACH
                                </button>
                            )}
                        </div>
                    ) : isCleanPlayback ? (
                        <div className="flex items-center gap-3 bg-blue-950/30 pl-4 pr-1 py-1 rounded border border-blue-800/40">
                            <span className="text-[11px] text-blue-300 font-bold tracking-widest uppercase whitespace-nowrap">
                                Clean play
                            </span>
                            <button
                                onClick={isAutoPlaying ? stopAutoPlay : () => runAutoPlay(false)}
                                className={`inline-flex w-[72px] items-center justify-center text-white px-0 py-1 rounded text-sm font-bold ${isAutoPlaying ? "bg-zinc-700 hover:bg-zinc-600" : "bg-blue-700 hover:bg-blue-600"}`}
                            >
                                {isAutoPlaying ? "PAUSE" : "AUTO"}
                            </button>
                            <button
                                onClick={enterEditMode}
                                className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-1 rounded text-sm font-bold"
                            >
                                EDIT
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-3 bg-cyan-900/20 pl-4 pr-1 py-1 rounded border border-cyan-800/30">
                            <span className="text-[11px] text-cyan-300 font-bold tracking-widest uppercase whitespace-nowrap">
                                Coach last {selectedReplayCount} step{selectedReplayCount !== 1 ? "s" : ""}
                            </span>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-ink-muted tracking-widest">REWIND</span>
                                <input
                                    type="range"
                                    min="1"
                                    max={Math.max(1, Math.min(stagedCount, MAX_REWIND_STEPS))}
                                    step="1"
                                    value={Math.max(1, selectedReplayCount)}
                                    onChange={(e) => setRewindStepCount(parseInt(e.target.value))}
                                    className="w-24 accent-cyan-400"
                                />
                            </div>
                            <button
                                onClick={() => handleReward(1)}
                                className="bg-green-600 hover:bg-green-500 text-white px-5 py-1 rounded text-sm font-bold shadow-lg"
                            >
                                CONFIRM (+1)
                            </button>
                            <button
                                onClick={isAutoPlaying ? stopAutoPlay : () => runAutoPlay(true)}
                                className={`inline-flex w-[72px] items-center justify-center text-white px-0 py-1 rounded text-sm font-bold ${isAutoPlaying ? "bg-zinc-700 hover:bg-zinc-600" : "bg-purple-600 hover:bg-purple-500"}`}
                            >
                                {isAutoPlaying ? "PAUSE" : "AUTO"}
                            </button>
                            <button
                                onClick={enterEditMode}
                                className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-1 rounded text-sm font-bold"
                            >
                                EDIT
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <span className="font-mono text-[11px] tracking-widest text-ink-muted">
                        {shapes.length - 1} OBJECTS
                    </span>
                    <button
                        onClick={handleResetModel}
                        className="text-[10px] bg-red-900/30 hover:bg-red-800 text-red-400 border border-red-800/50 px-2 py-1 rounded"
                    >
                        WIPE BRAIN
                    </button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                <Toolbar
                    onAddShape={handleAddShape}
                    onClearSelected={handleRemoveSelected}
                    selectedId={selectedId === "main" ? null : selectedId}
                    submitStatus={submitStatus}
                    objectCount={shapes.length - 1}
                />

                <main className="flex-1 flex items-center justify-center bg-arena-deep overflow-auto p-6">
                    <div
                        className="relative"
                        style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                    >
                        <Canvas
                            shapes={shapes}
                            selectedId={selectedId}
                            onSelectShape={isEditingArena ? setSelectedId : () => { }}
                            onUpdateShape={isEditingArena ? handleUpdateShape : () => { }}
                            onDeselectAll={isEditingArena ? () => setSelectedId(null) : () => { }}
                        />

                        {!isEditingArena && !isCleanPlayback && hasStagedSteps && (
                            <div className="absolute inset-0 z-10 rounded cursor-crosshair shadow-[inset_0_0_0_2px_rgba(6,182,212,0.3)] bg-cyan-900/5">
                                {replayMovements.length > 0 && (
                                    <svg className="absolute inset-0 pointer-events-none" width={CANVAS_SIZE} height={CANVAS_SIZE}>
                                        {correctionAnchor && (
                                            <circle
                                                cx={correctionAnchor.x}
                                                cy={correctionAnchor.y}
                                                r="14"
                                                fill="none"
                                                stroke="#06b6d4"
                                                strokeWidth="3"
                                                opacity="0.9"
                                            />
                                        )}
                                        {replayMovements.map((move, index) => (
                                            <g key={`${move.from.x}-${move.from.y}-${index}`}>
                                                <line
                                                    x1={move.from.x}
                                                    y1={move.from.y}
                                                    x2={move.to.x}
                                                    y2={move.to.y}
                                                    stroke={index === replayIndex ? "#facc15" : "#67e8f9"}
                                                    strokeWidth={index === replayIndex ? "5" : "2"}
                                                    strokeLinecap="round"
                                                    opacity={index === replayIndex ? "0.95" : "0.45"}
                                                />
                                                <circle
                                                    cx={move.to.x}
                                                    cy={move.to.y}
                                                    r={index === replayIndex ? "8" : "4"}
                                                    fill={index === replayIndex ? "#facc15" : "#67e8f9"}
                                                    opacity={index === replayIndex ? "0.95" : "0.5"}
                                                />
                                            </g>
                                        ))}
                                        {activeReplayMove && (
                                            <circle
                                                cx={activeReplayMove.to.x}
                                                cy={activeReplayMove.to.y}
                                                r="13"
                                                fill="none"
                                                stroke="#facc15"
                                                strokeWidth="2"
                                                opacity="0.9"
                                            />
                                        )}
                                    </svg>
                                )}
                                {dragState && (
                                    <svg className="absolute inset-0 pointer-events-none" width={CANVAS_SIZE} height={CANVAS_SIZE}>
                                        <defs>
                                            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                                <polygon points="0 0, 10 3.5, 0 7" fill="#06b6d4" />
                                            </marker>
                                        </defs>
                                        <line
                                            x1={dragState.startX}
                                            y1={dragState.startY}
                                            x2={dragState.currentX}
                                            y2={dragState.currentY}
                                            stroke="#06b6d4"
                                            strokeWidth="4"
                                            strokeLinecap="round"
                                            markerEnd="url(#arrowhead)"
                                        />
                                    </svg>
                                )}
                            </div>
                        )}
                    </div>
                </main>

                <PropertiesPanel
                    shape={selectedShape}
                    onUpdate={handleUpdateShape}
                />
            </div>
        </div>
    );
}
