export default function PropertiesPanel({ shape, onUpdate }) {
    if (!shape) {
        return (
            <div className="w-48 flex-shrink-0 bg-arena-panel border-l border-border-lo flex items-center justify-center p-4">
                <span className="font-mono text-[11px] tracking-wide text-ink-muted text-center leading-relaxed">
                    Select an object<br />to inspect
                </span>
            </div>
        );
    }

    const isMain = shape.id === "main";
    const isWall = shape.type === "projectileWall" || shape.type === "bouncyWall";

    return (
        <div className="w-48 flex-shrink-0 bg-arena-panel border-l border-border-lo p-4">

            {/* Header */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-lo">
                <span className="font-mono text-[11px] tracking-widest text-cyan">
                    {isMain ? "MAIN MODEL" : shape.type === "opponentModel" ? "OPPONENT MODEL" : `OBJ-${shape.id.slice(-4).toUpperCase()}`}
                </span>
                {isMain && (
                    <span className="font-mono text-[9px] tracking-widest text-ink-muted bg-arena-surface border border-border-lo px-1.5 py-0.5 rounded-sm">
                        LOCKED
                    </span>
                )}
            </div>

            {/* Coordinates */}
            <Row label="X">
                <span className="font-mono text-sm text-ink-white">{Math.round(shape.x)}<span className="text-[10px] text-ink-muted ml-0.5">px</span></span>
            </Row>
            <Row label="Y">
                <span className="font-mono text-sm text-ink-white">{Math.round(shape.y)}<span className="text-[10px] text-ink-muted ml-0.5">px</span></span>
            </Row>

            {!isMain && (
                <>
                    <div className="h-px bg-border-lo my-3" />
                    <Row label="SIZE">
                        <SliderInput
                            value={shape.size}
                            min={15}
                            max={200}
                            onUpdate={(val) => onUpdate(shape.id, { size: val })}
                        />
                    </Row>
                    {!isWall && (
                        <Row label="ROT">
                            <SliderInput
                                value={Math.round(shape.rotation)}
                                min={0}
                                max={360}
                                onUpdate={(val) => onUpdate(shape.id, { rotation: val })}
                                suffix="°"
                            />
                        </Row>
                    )}
                    <div className="h-px bg-border-lo my-3" />
                    <Row label="TYPE">
                        <span className="font-mono text-xs tracking-widest text-ink-mid">
                            {shape.type.toUpperCase()}
                        </span>
                    </Row>
                </>
            )}
        </div>
    );
}

function Row({ label, children }) {
    return (
        <div className="flex items-center gap-2 mb-2.5 w-full">
            <span className="font-mono text-[11px] tracking-widest text-ink-muted w-8 flex-shrink-0">
                {label}
            </span>
            {children}
        </div>
    );
}

function SliderInput({ value, onUpdate, min, max, step = 1, suffix = "" }) {
    return (
        <div className="flex items-center gap-2 flex-1 w-full">
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onUpdate(Number(e.target.value))}
                // Removed appearance-none below so the slider thumb is actually visible!
                className="flex-1 min-w-0 h-1.5 bg-arena-surface rounded cursor-pointer accent-cyan"
            />
            <div className="w-10 text-right flex-shrink-0">
                <span className="font-mono text-[13px] text-ink-white">
                    {value}{suffix}
                </span>
            </div>
        </div>
    );
}
