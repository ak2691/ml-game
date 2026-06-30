import ShapeObject from "./ShapeObject";

const CANVAS_SIZE = 800;

export default function Canvas({ shapes, selectedId, onSelectShape, onUpdateShape, onDeselectAll }) {
    return (
        <div
            className="relative bg-[#0d1117] border border-border-mid rounded-xl overflow-hidden flex-shrink-0"
            style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
            onMouseDown={onDeselectAll}
        >
            {/* Grid */}
            <div className="absolute inset-0 canvas-grid-bg opacity-60 pointer-events-none" />

            {/* Centre crosshairs */}
            <div className="absolute top-1/2 left-0 right-0 h-px bg-border-mid pointer-events-none -translate-y-px" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-mid pointer-events-none -translate-x-px" />

            {/* Corner labels */}
            <span className="absolute top-1 left-1.5 font-mono text-[10px] text-ink-muted pointer-events-none">0,0</span>
            <span className="absolute top-1 right-1.5 font-mono text-[10px] text-ink-muted pointer-events-none">{CANVAS_SIZE},0</span>
            <span className="absolute bottom-1 left-1.5 font-mono text-[10px] text-ink-muted pointer-events-none">0,{CANVAS_SIZE}</span>
            <span className="absolute bottom-1 right-1.5 font-mono text-[10px] text-ink-muted pointer-events-none">{CANVAS_SIZE},{CANVAS_SIZE}</span>

            {/* Shapes */}
            {shapes.map((shape) => (
                <ShapeObject
                    key={shape.id}
                    shape={shape}
                    isSelected={selectedId === shape.id}
                    onSelect={onSelectShape}
                    onDragEnd={(id, pos) => onUpdateShape(id, pos)}
                    locked={Boolean(shape.locked)}
                />
            ))}
        </div>
    );
}
