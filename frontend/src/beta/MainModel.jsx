// MainModel.jsx
import { useCallback } from "react";

const RADIUS = 30;
export const DIAMETER = RADIUS * 2;

export default function MainModel({ position, onUpdate, isSelected, onSelect, containerSize }) {
    const { x, y } = position;

    const handleMouseDown = useCallback(
        (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onSelect();

            const startX = e.clientX;
            const startY = e.clientY;
            const startShapeX = x;
            const startShapeY = y;

            const onMove = (me) => {
                const dx = me.clientX - startX;
                const dy = me.clientY - startY;
                const newX = Math.max(0, Math.min(startShapeX + dx, containerSize - DIAMETER));
                const newY = Math.max(0, Math.min(startShapeY + dy, containerSize - DIAMETER));
                onUpdate({ x: newX, y: newY });
            };
            const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        },
        [x, y, containerSize, onUpdate, onSelect]
    );

    const centerX = Math.round(x + RADIUS);
    const centerY = Math.round(y + RADIUS);

    return (
        <div
            style={{
                position: "absolute",
                left: x,
                top: y,
                width: DIAMETER,
                height: DIAMETER,
                cursor: "grab",
                userSelect: "none",
                zIndex: isSelected ? 10 : 2,
            }}
            onMouseDown={handleMouseDown}
        >
            {/* Outer ring indicating main model */}
            <div
                style={{
                    position: "absolute",
                    inset: -4,
                    borderRadius: "50%",
                    border: "2px dashed #f59e0b",
                    opacity: 0.8,
                    pointerEvents: "none",
                }}
            />

            {/* The circle itself */}
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                    boxShadow: isSelected
                        ? "0 0 0 3px #6366f1, 0 4px 16px rgba(99,102,241,0.4)"
                        : "0 2px 12px rgba(29,78,216,0.35)",
                    transition: "box-shadow 0.15s",
                }}
            />

            {/* "MODEL" label */}
            <div
                style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    color: "#fff",
                    fontSize: 7,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    fontFamily: "monospace",
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                }}
            >
                MODEL
            </div>

            {/* Coordinate badge when selected */}
            {isSelected && (
                <div
                    style={{
                        position: "absolute",
                        bottom: -30,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "rgba(15,15,25,0.85)",
                        color: "#fde68a",
                        fontSize: 11,
                        fontFamily: "monospace",
                        padding: "2px 8px",
                        borderRadius: 6,
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                        zIndex: 30,
                    }}
                >
                    x: {centerX}, y: {centerY} · main
                </div>
            )}
        </div>
    );
}