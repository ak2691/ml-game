import { useEffect, useRef } from "react";

const CANVAS_SIZE = 800;
const MAIN_RADIUS = 30;

function WeaponVisual({ shape }) {
    const size = shape.id === "main" ? MAIN_RADIUS * 2 : shape.size;
    const activeSwing = (shape.swingActiveMs ?? 0) > 0;
    const activeBlock = (shape.blockActiveMs ?? 0) > 0;
    const width = activeSwing ? size * 1.08 : activeBlock ? size * 0.95 : size * 0.72;
    const height = activeBlock ? 12 : 8;

    return (
        <div
            className={`absolute rounded-sm border transition-all duration-100 ${activeBlock
                ? "bg-blue-300/40 border-blue-200 shadow-[0_0_12px_rgba(96,165,250,0.45)]"
                : activeSwing
                    ? "bg-red-300/45 border-red-200 shadow-[0_0_12px_rgba(248,113,113,0.45)]"
                    : "bg-zinc-300/40 border-zinc-100/70"
                }`}
            style={{
                width,
                height,
                left: size / 2,
                top: size / 2 - height / 2,
                transformOrigin: "0 50%",
                transform: activeSwing ? "rotate(-24deg)" : "rotate(0deg)",
            }}
        />
    );
}

function HealthBar({ shape }) {
    if (shape.hp == null) return null;
    const hpPct = Math.max(0, Math.min(1, shape.hp / 100));

    return (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-16 rounded border border-zinc-700 bg-zinc-950/90 px-1 py-0.5 shadow">
            <div className="text-center font-mono text-[9px] font-bold leading-none text-lime">
                {Math.ceil(shape.hp)} HP
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded bg-zinc-800">
                <div
                    className="h-full bg-lime"
                    style={{ width: `${hpPct * 100}%` }}
                />
            </div>
        </div>
    );
}

function objectSlotLabel(shape) {
    const slot = shape.id?.match(/^object_(\d)$/)?.[1];
    return slot ? `Object ${slot}` : null;
}

function ShapeVisual({ shape, isSelected }) {
    const { type, size } = shape;
    const sel = isSelected;
    const dashing = (shape.dashActiveMs ?? 0) > 0;

    if (type === "circle") {
        return (
            <div
                style={{ width: size, height: size }}
                className={`rounded-full border-2 bg-danger/15 transition-all duration-100 ${dashing ? "shadow-[0_0_20px_rgba(34,211,238,0.8)]" : ""} ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : "border-danger"
                    }`}
            />
        );
    }

    if (type === "square") {
        return (
            <div
                style={{ width: size, height: size }}
                className={`rounded-sm border-2 bg-amber/[0.12] transition-all duration-100 ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : "border-amber"
                    }`}
            />
        );
    }

    if (type === "triangle") {
        return (
            <div style={{ width: size, height: size }}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} overflow="visible">
                    <polygon
                        points={`${size / 2},4 ${size - 4},${size - 4} 4,${size - 4}`}
                        fill="rgba(100,120,255,0.15)"
                        stroke={sel ? "white" : "#6478ff"}
                        strokeWidth="2"
                    />
                </svg>
            </div>
        );
    }

    if (type === "opponentModel") {
        return (
            <div
                style={{ width: size, height: size }}
                className={`relative rounded-full border-2 bg-fuchsia-500/10 flex items-center justify-center transition-all duration-100 ${dashing ? "shadow-[0_0_20px_rgba(34,211,238,0.8)]" : ""} ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : "border-fuchsia-400"
                    }`}
            >
                <HealthBar shape={shape} />
                <WeaponVisual shape={shape} />
                <span className="font-mono text-xs font-bold tracking-widest text-fuchsia-200">OP</span>
            </div>
        );
    }

    if (type === "healthPack") {
        return (
            <div
                style={{ width: size, height: size }}
                className={`relative rounded-full border-2 bg-emerald-500/15 flex items-center justify-center transition-all duration-100 ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : "border-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.28)]"
                    }`}
            >
                <div className="absolute h-[58%] w-[18%] rounded-sm bg-emerald-200" />
                <div className="absolute h-[18%] w-[58%] rounded-sm bg-emerald-200" />
            </div>
        );
    }

    if (type === "damageZone") {
        return (
            <div
                style={{ width: size, height: size }}
                className={`rounded-full border-2 bg-red-500/14 transition-all duration-100 ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : "border-red-400 shadow-[inset_0_0_24px_rgba(248,113,113,0.2)]"
                    }`}
            />
        );
    }

    return null;
}

export default function ShapeObject({ shape, isSelected, onSelect, onDragEnd, locked = false }) {
    const dragging = useRef(false);
    const hasMoved = useRef(false);
    const offset = useRef({ x: 0, y: 0 });
    const isMain = shape.id === "main";
    const halfSize = isMain ? MAIN_RADIUS : shape.size / 2;
    const label = objectSlotLabel(shape);

    // Keep a live ref to shape position so move handler never uses a stale closure
    const shapeRef = useRef({ x: shape.x, y: shape.y });

    useEffect(() => {
        shapeRef.current = { x: shape.x, y: shape.y };
    }, [shape.x, shape.y]);

    const handleMouseDown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (locked) return;

        // 1. Select the shape IMMEDIATELY when the mouse is pressed
        onSelect(shape.id);

        dragging.current = true;
        hasMoved.current = false;

        // Compute offset from current position, not a stale closure value
        offset.current = {
            x: e.clientX - shapeRef.current.x,
            y: e.clientY - shapeRef.current.y,
        };

        const handleMove = (me) => {
            if (!dragging.current) return;
            hasMoved.current = true;
            const limit = isMain ? MAIN_RADIUS : shape.size / 2;
            const nx = Math.max(limit, Math.min(me.clientX - offset.current.x, CANVAS_SIZE - limit));
            const ny = Math.max(limit, Math.min(me.clientY - offset.current.y, CANVAS_SIZE - limit));
            onDragEnd(shape.id, { x: nx, y: ny });
        };

        const handleUp = () => {
            dragging.current = false;
            // 2. Removed onSelect from here! 
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
        };

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleUp);
    };

    const wrapStyle = {
        position: "absolute",
        left: shape.x - halfSize,
        top: shape.y - halfSize,
        transform: `rotate(${shape.rotation ?? 0}deg)`,
        cursor: locked ? "default" : "grab",
        userSelect: "none",
    };

    if (isMain) {
        return (
            <div style={wrapStyle} onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
                <div
                    style={{ width: MAIN_RADIUS * 2, height: MAIN_RADIUS * 2 }}
                    className={`main-orbit relative rounded-full border-2 border-cyan bg-cyan/10 flex items-center justify-center transition-all duration-150 ${isSelected ? "shadow-cyan-ring" : "shadow-cyan-subtle"
                        }`}
                >
                    <HealthBar shape={shape} />
                    <WeaponVisual shape={shape} />
                    <span className="font-mono text-sm font-bold text-cyan tracking-wide">M</span>
                </div>
            </div>
        );
    }

    return (
        <div style={wrapStyle} onMouseDown={handleMouseDown}>
            {label && (
                <div className={`absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-widest shadow ${isSelected
                    ? "border-white bg-zinc-950 text-white"
                    : "border-border-hi bg-zinc-950/90 text-ink-mid"
                }`}>
                    {label}
                </div>
            )}
            <ShapeVisual shape={shape} isSelected={isSelected} />
        </div>
    );
}
