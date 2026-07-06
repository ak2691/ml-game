import { useEffect, useRef } from "react";
import { BLOCK_MAX_CHARGES, BLOCK_RECHARGE_MS } from "./classes/MeleeClass.jsx";
import { GUN_COOLDOWN_MS, GUN_RANGE, RANGED_AMMO_MAX, RANGED_RELOAD_MS } from "./classes/RangedClass.jsx";

const CANVAS_SIZE = 800;
const MAIN_RADIUS = 30;

function WeaponVisual({ shape }) {
    const size = shape.id === "main" ? MAIN_RADIUS * 2 : shape.size;
    const isRanged = shape.combatClass === "ranged";
    const gunActiveMs = shape.gunActiveMs ?? 0;
    const gunOpacity = Math.max(0, Math.min(1, gunActiveMs / GUN_COOLDOWN_MS));

    if (isRanged) {
        const barrelLength = size * 0.68;
        const barrelHeight = 10;
        const barrelLeft = size / 2;
        const rayLeft = barrelLeft + barrelLength;
        return (
            <>
                <div
                    className="absolute rounded-sm border border-amber-100 bg-amber-300/65 shadow-[0_0_10px_rgba(251,191,36,0.38)]"
                    style={{
                        width: barrelLength,
                        height: barrelHeight,
                        left: barrelLeft,
                        top: size / 2 - barrelHeight / 2,
                        transformOrigin: "0 50%",
                    }}
                />
                {gunActiveMs > 0 && (
                    <div
                        className="pointer-events-none absolute bg-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.65)]"
                        style={{
                            width: GUN_RANGE,
                            height: 2,
                            left: rayLeft,
                            top: size / 2 - 1,
                            opacity: gunOpacity,
                        }}
                    />
                )}
            </>
        );
    }

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

function ShieldChargeBars({ shape }) {
    if (shape.combatClass !== "melee") return null;

    const rotation = Number.isFinite(Number(shape.rotation)) ? Number(shape.rotation) : 0;
    const charges = Math.max(0, Math.min(
        BLOCK_MAX_CHARGES,
        Math.round(Number(shape.blockCharges ?? BLOCK_MAX_CHARGES)),
    ));
    const rechargeMs = Math.max(0, Math.min(
        BLOCK_RECHARGE_MS,
        Number(shape.blockRechargeMs ?? shape.blockCooldownMs ?? 0),
    ));
    const rechargeIndex = charges < BLOCK_MAX_CHARGES ? charges : -1;
    const rechargePct = rechargeIndex >= 0 ? rechargeMs / BLOCK_RECHARGE_MS : 0;
    const active = (shape.blockActiveMs ?? 0) > 0;

    return (
        <div
            className={`pointer-events-none absolute left-[calc(100%+8px)] top-1/2 flex w-5 -translate-y-1/2 flex-col-reverse gap-0.5 rounded border bg-zinc-950/85 p-1 shadow transition-shadow duration-100 ${active
                ? "border-blue-200 shadow-[0_0_14px_rgba(96,165,250,0.55)]"
                : "border-zinc-700"
            }`}
            style={{ transform: `translateY(-50%) rotate(${-rotation}deg)` }}
            title={`${charges}/${BLOCK_MAX_CHARGES} shield charges`}
        >
            {Array.from({ length: BLOCK_MAX_CHARGES }, (_, index) => {
                const filled = index < charges;
                const recharging = index === rechargeIndex;
                return (
                    <div
                        key={index}
                        className={`relative h-1.5 w-3 overflow-hidden rounded-sm border ${filled
                            ? "border-blue-100 bg-blue-300 shadow-[0_0_6px_rgba(147,197,253,0.55)]"
                            : "border-zinc-600 bg-zinc-800"
                        }`}
                    >
                        {!filled && recharging && (
                            <div
                                className="absolute inset-y-0 left-0 bg-blue-400/70"
                                style={{ width: `${rechargePct * 100}%` }}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function AmmoBars({ shape }) {
    if (shape.combatClass !== "ranged") return null;

    const rotation = Number.isFinite(Number(shape.rotation)) ? Number(shape.rotation) : 0;
    const ammo = Math.max(0, Math.min(
        RANGED_AMMO_MAX,
        Math.round(Number(shape.gunAmmo ?? RANGED_AMMO_MAX)),
    ));
    const reloadMs = Math.max(0, Math.min(RANGED_RELOAD_MS, Number(shape.gunReloadMs ?? 0)));
    const reloadPct = reloadMs > 0 ? 1 - reloadMs / RANGED_RELOAD_MS : 0;

    return (
        <div
            className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 flex w-8 -translate-y-1/2 flex-col gap-1 rounded border border-amber-800/70 bg-zinc-950/85 p-1 shadow"
            style={{ transform: `translateY(-50%) rotate(${-rotation}deg)` }}
            title={reloadMs > 0 ? "Reloading" : `${ammo}/${RANGED_AMMO_MAX} ammo`}
        >
            <div className="text-center font-mono text-[8px] font-bold leading-none text-amber-200">
                {ammo}
            </div>
            <div className="grid grid-cols-5 gap-0.5">
                {Array.from({ length: RANGED_AMMO_MAX }, (_, index) => (
                    <div
                        key={index}
                        className={`h-1.5 rounded-sm border ${index < ammo
                            ? "border-amber-100 bg-amber-300"
                            : "border-zinc-600 bg-zinc-800"
                        }`}
                    />
                ))}
            </div>
            {reloadMs > 0 && (
                <div className="h-1 overflow-hidden rounded bg-zinc-800">
                    <div className="h-full bg-amber-300" style={{ width: `${reloadPct * 100}%` }} />
                </div>
            )}
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
                <ShieldChargeBars shape={shape} />
                <AmmoBars shape={shape} />
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

    if (type === "grenade") {
        return (
            <div
                style={{ width: size, height: size }}
                className="rounded-full border border-lime-100 bg-lime-300 shadow-[0_0_10px_rgba(190,242,100,0.45)]"
            />
        );
    }

    if (type === "grenadeExplosion") {
        return (
            <div
                style={{ width: size, height: size }}
                className="rounded-full border-2 border-orange-200 bg-orange-400/25 shadow-[0_0_24px_rgba(251,146,60,0.6)]"
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
                    <ShieldChargeBars shape={shape} />
                    <AmmoBars shape={shape} />
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
