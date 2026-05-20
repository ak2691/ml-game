import { useRef } from "react";

const CANVAS_SIZE = 800;
const MAIN_RADIUS = 30;

function ShapeVisual({ shape, isSelected }) {
    const { type, size } = shape;
    const sel = isSelected;

    if (type === "circle") {
        return (
            <div
                style={{ width: size, height: size }}
                className={`rounded-full border-2 bg-danger/15 transition-all duration-100 ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : "border-danger"
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

    return null;
}

export default function ShapeObject({ shape, isSelected, onSelect, onDragEnd }) {
    const dragging = useRef(false);
    const hasMoved = useRef(false);
    const offset = useRef({ x: 0, y: 0 });
    const isMain = shape.id === "main";
    const halfSize = isMain ? MAIN_RADIUS : shape.size / 2;

    // Keep a live ref to shape position so move handler never uses a stale closure
    const shapeRef = useRef({ x: shape.x, y: shape.y });
    shapeRef.current = { x: shape.x, y: shape.y };

    const handleMouseDown = (e) => {
        e.stopPropagation();
        e.preventDefault();

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
        transform: `rotate(${isMain ? 0 : shape.rotation}deg)`,
        cursor: "grab",
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
                    <span className="font-mono text-sm font-bold text-cyan tracking-wide">M</span>
                </div>
            </div>
        );
    }

    return (
        <div style={wrapStyle} onMouseDown={handleMouseDown}>
            <ShapeVisual shape={shape} isSelected={isSelected} />
        </div>
    );
}