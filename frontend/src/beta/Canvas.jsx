import { useEffect, useRef, useState } from "react";
import ShapeObject from "./ShapeObject";
import { CANVAS_SIZE, DISPLAY_ARENA_MAX_SIZE } from "./modelPayloads/arenaConstants";

export default function Canvas({
    shapes,
    selectedId,
    onSelectShape,
    onUpdateShape,
    onDeselectAll,
    editable = true,
    placementSide = null,
    showObjectLabels = true,
}) {
    const frameRef = useRef(null);
    const [displayScale, setDisplayScale] = useState(1);
    const topBoundary = CANVAS_SIZE / 3;
    const bottomBoundary = (CANVAS_SIZE * 2) / 3;

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame || typeof ResizeObserver === "undefined") return undefined;

        const observer = new ResizeObserver(([entry]) => {
            const width = entry?.contentRect?.width ?? CANVAS_SIZE;
            setDisplayScale(Math.max(0.01, width / CANVAS_SIZE));
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={frameRef}
            className="relative mx-auto w-full bg-[#0d1117] border border-border-mid rounded-xl overflow-hidden"
            style={{ width: "100%", maxWidth: DISPLAY_ARENA_MAX_SIZE, aspectRatio: "1 / 1" }}
            onMouseDown={onDeselectAll}
        >
            <div
                className="absolute left-0 top-0"
                style={{
                    width: CANVAS_SIZE,
                    height: CANVAS_SIZE,
                    transform: `scale(${displayScale})`,
                    transformOrigin: "top left",
                }}
            >
                {/* Grid */}
                <div className="absolute inset-0 canvas-grid-bg opacity-60 pointer-events-none" />

                {/* Centre crosshairs */}
                <div className="absolute top-1/2 left-0 right-0 h-px bg-border-mid pointer-events-none -translate-y-px" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-mid pointer-events-none -translate-x-px" />
                {placementSide && (
                    <>
                        <div
                            className={`absolute left-0 right-0 pointer-events-none ${placementSide === "top" ? "bg-cyan-500/8" : "bg-fuchsia-500/8"}`}
                            style={placementSide === "top"
                                ? { top: 0, height: topBoundary }
                                : { top: bottomBoundary, bottom: 0 }}
                        />
                        <div
                            className="absolute left-0 right-0 h-0.5 bg-cyan-300/80 shadow-[0_0_12px_rgba(103,232,249,0.45)] pointer-events-none"
                            style={{ top: topBoundary }}
                        />
                        <div
                            className="absolute left-0 right-0 h-0.5 bg-fuchsia-300/80 shadow-[0_0_12px_rgba(240,171,252,0.45)] pointer-events-none"
                            style={{ top: bottomBoundary }}
                        />
                        <div className="absolute left-3 top-3 rounded border border-cyan-400/50 bg-zinc-950/80 px-2 py-1 font-mono text-[10px] tracking-widest text-cyan-100 pointer-events-none">
                            TOP THIRD
                        </div>
                        <div className="absolute bottom-3 left-3 rounded border border-fuchsia-400/50 bg-zinc-950/80 px-2 py-1 font-mono text-[10px] tracking-widest text-fuchsia-100 pointer-events-none">
                            BOTTOM THIRD
                        </div>
                    </>
                )}

                {/* Corner labels */}
                <span className="absolute top-1 left-1.5 font-mono text-[10px] text-ink-muted pointer-events-none">0,0</span>
                <span className="absolute top-1 right-1.5 font-mono text-[10px] text-ink-muted pointer-events-none">{CANVAS_SIZE},0</span>
                <span className="absolute bottom-1 left-1.5 font-mono text-[10px] text-ink-muted pointer-events-none">0,{CANVAS_SIZE}</span>
                <span className="absolute bottom-1 right-1.5 font-mono text-[10px] text-ink-muted">{CANVAS_SIZE},{CANVAS_SIZE}</span>

                {/* Shapes */}
                {shapes.map((shape) => (
                    <ShapeObject
                        key={shape.id}
                        shape={shape}
                        displayScale={displayScale}
                        isSelected={selectedId === shape.id}
                        onSelect={onSelectShape}
                        onDragEnd={(id, pos) => onUpdateShape(id, pos)}
                        locked={Boolean(shape.locked) || !editable}
                        labeledObjects={showObjectLabels ? shapes.filter((candidate) => candidate.id?.startsWith?.("object_")) : null}
                    />
                ))}
            </div>
        </div>
    );
}
