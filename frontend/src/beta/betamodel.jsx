import { useState, useCallback } from "react";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import PropertiesPanel from "./PropertiesPanel";
import "./BetaModel.css";

const CANVAS_SIZE = 800;

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

    const selectedShape = shapes.find((s) => s.id === selectedId) ?? null;

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
                    // Main model: only allow position updates
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

    const handleSubmit = useCallback(async () => {
        const main = shapes.find((s) => s.id === "main");
        const payload = {
            playerModel: { x: Math.round(main.x), y: Math.round(main.y) },
            objects: shapes
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

        setSubmitStatus({ ok: null, message: "Transmitting..." });

        try {
            const res = await fetch("http://localhost:8080/api/coordinates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            setSubmitStatus(
                res.ok
                    ? { ok: true, message: `✓ ${shapes.length} objects sent` }
                    : { ok: false, message: `✗ Server error ${res.status}` }
            );
        } catch (err) {
            setSubmitStatus({ ok: false, message: `✗ ${err.message}` });
        }

        setTimeout(() => setSubmitStatus(null), 3000);
    }, [shapes]);

    return (
        <div className="flex flex-col min-h-screen bg-arena-deep text-ink-hi font-ui overflow-hidden">

            {/* Header */}
            <header className="flex items-center justify-between px-6 h-[52px] bg-arena-panel border-b border-border-lo flex-shrink-0">
                <div className="flex items-center gap-3">
                    <span className="text-xl text-cyan leading-none">⬟</span>
                    <span className="font-ui text-lg font-bold tracking-[0.15em] text-ink-white">MACHINER</span>
                    <span className="font-mono text-[11px] tracking-widest text-ink-muted px-2 py-0.5 bg-arena-surface border border-border-mid rounded-sm">
                        ARENA EDITOR
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <span className="font-mono text-[11px] tracking-widest text-danger bg-danger/[0.08] border border-danger-dim px-2.5 py-0.5 rounded-sm">
                        PVP TRAINING
                    </span>
                    <span className="font-mono text-[11px] tracking-widest text-ink-muted">
                        {shapes.length - 1} OBJECTS
                    </span>
                </div>
            </header>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
                <Toolbar
                    onAddShape={handleAddShape}
                    onSubmit={handleSubmit}
                    onClearSelected={handleRemoveSelected}
                    selectedId={selectedId === "main" ? null : selectedId}
                    submitStatus={submitStatus}
                    objectCount={shapes.length - 1}
                />

                <main className="flex-1 flex items-center justify-center bg-arena-deep overflow-auto p-6">
                    <Canvas
                        shapes={shapes}
                        selectedId={selectedId}
                        onSelectShape={setSelectedId}
                        onUpdateShape={handleUpdateShape}
                        onDeselectAll={() => setSelectedId(null)}
                    />
                </main>

                <PropertiesPanel
                    shape={selectedShape}
                    onUpdate={handleUpdateShape}
                />
            </div>
        </div>
    );
}