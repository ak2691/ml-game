const MAX_OBJECTS = 10;

export default function Toolbar({ onAddShape, onSubmit, onClearSelected, selectedId, submitStatus, objectCount }) {
    const shapes = [
        { type: "circle", label: "Circle", icon: "⬤" },
        { type: "square", label: "Square", icon: "■" },
        { type: "triangle", label: "Triangle", icon: "▲" },
    ];

    const atLimit = objectCount >= MAX_OBJECTS;

    return (
        <div className="w-44 flex-shrink-0 bg-arena-panel border-r border-border-lo flex flex-col gap-0 overflow-y-auto px-3.5 py-5">

            {/* Shapes */}
            <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] tracking-[0.15em] text-ink-muted">OBJECTS</span>
                <span className={`font-mono text-[10px] tracking-widest ${atLimit ? "text-danger" : "text-ink-muted"}`}>
                    {objectCount}/{MAX_OBJECTS}
                </span>
            </div>
            <div className="flex flex-col gap-1.5 mb-4">
                {shapes.map(({ type, label, icon }) => (
                    <button
                        key={type}
                        onClick={() => onAddShape(type)}
                        disabled={atLimit}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 bg-arena-surface border border-border-lo rounded-md font-ui font-semibold text-sm tracking-wide transition-all duration-150 ${atLimit
                                ? "opacity-30 cursor-not-allowed text-ink-muted"
                                : "text-ink-mid cursor-pointer hover:bg-arena-hover hover:border-border-hi hover:text-ink-white"
                            }`}
                    >
                        <span className={`text-[13px] w-4 text-center ${atLimit ? "text-ink-muted" : "text-cyan"}`}>{icon}</span>
                        <span className="text-[13px]">{label}</span>
                    </button>
                ))}
            </div>
            {atLimit && (
                <p className="font-mono text-[10px] text-danger/70 text-center mb-3 -mt-2">
                    Max objects reached
                </p>
            )}

            <div className="h-px bg-border-lo my-1 mb-3" />

            {/* Actions */}
            <span className="font-mono text-[10px] tracking-[0.15em] text-ink-muted mb-2 block">
                ACTIONS
            </span>
            <div className="flex flex-col gap-1.5 mb-2">
                <button
                    onClick={onSubmit}
                    className="w-full px-3 py-2 rounded-md font-mono text-xs tracking-widest cursor-pointer transition-all duration-150 bg-cyan/[0.07] border border-cyan-dim text-cyan hover:bg-cyan/[0.12] hover:border-cyan"
                >
                    ⬆ SUBMIT
                </button>
            </div>

            {/* Remove selected */}
            {selectedId && (
                <>
                    <div className="h-px bg-border-lo my-3" />
                    <span className="font-mono text-[10px] tracking-[0.15em] text-ink-muted mb-2 block">
                        SELECTED
                    </span>
                    <button
                        onClick={onClearSelected}
                        className="w-full px-3 py-2 rounded-md font-mono text-xs tracking-widest cursor-pointer transition-all duration-150 bg-danger/[0.07] border border-danger-dim text-danger hover:bg-danger/[0.15] hover:border-danger"
                    >
                        ✕ REMOVE
                    </button>
                </>
            )}

            {/* Submit status */}
            {submitStatus && (
                <div className={`mt-3 px-2.5 py-1.5 rounded font-mono text-[11px] tracking-wide text-center border ${submitStatus.ok === true ? "bg-lime/10 text-lime border-lime/30" :
                        submitStatus.ok === false ? "bg-danger/10 text-danger border-danger-dim" :
                            "bg-cyan/10 text-cyan border-cyan-dim"
                    }`}>
                    {submitStatus.message}
                </div>
            )}
        </div>
    );
}