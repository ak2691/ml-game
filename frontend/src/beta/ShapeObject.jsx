import { useEffect, useRef } from "react";
import { BLOCK_MAX_CHARGES, BLOCK_RECHARGE_MS } from "./classes/MeleeClass.jsx";
import { GUN_COOLDOWN_MS, GUN_RANGE, RANGED_AMMO_MAX, RANGED_RELOAD_MS } from "./classes/RangedClass.jsx";
import {
    FIREBALL_CHARGES_MAX,
    FIREBALL_RELOAD_MS,
    STUN_ACTIVE_MS,
    STUN_COOLDOWN_MS,
    STUN_RANGE,
} from "./classes/MageClass.jsx";
import {
    BOUNCY_WALL_TYPE,
    BARRIER_TYPE,
    COMMAND_LOCK_TYPE,
    INHIBITION_TYPE,
    OVERDRIVE_TYPE,
    PROJECTILE_WALL_LENGTH,
    PROJECTILE_WALL_THICKNESS,
    PROJECTILE_WALL_TYPE,
    RADAR_JAMMER_TYPE,
} from "./ArenaObjects.js";
import { objectDisplayName } from "./objectLabels.js";

const CANVAS_SIZE = 800;
const MAIN_RADIUS = 30;
const STUN_HALF_ARC_DEGREES = 50;

function buildStunBoltPath(angleDegrees, startDistance) {
    const angle = angleDegrees * Math.PI / 180;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const perpendicularX = -directionY;
    const perpendicularY = directionX;
    const distances = [startDistance, STUN_RANGE * 0.38, STUN_RANGE * 0.7, STUN_RANGE];

    return distances.map((distance, index) => {
        const zigzagOffset = index === 1 ? 7 : index === 2 ? -7 : 0;
        const x = distance * directionX + zigzagOffset * perpendicularX;
        const y = distance * directionY + zigzagOffset * perpendicularY;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
}

function WeaponVisual({ shape }) {
    const size = shape.id === "main" ? MAIN_RADIUS * 2 : shape.size;
    const isRanged = shape.combatClass === "ranged";
    const isMage = shape.combatClass === "mage";
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
                    <>
                        <div
                            className="pointer-events-none absolute bg-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.65)]"
                            style={{
                                width: Math.max(
                                    0,
                                    (shape.gunRayLength ?? GUN_RANGE) - (rayLeft - size / 2),
                                ),
                                height: 2,
                                left: rayLeft,
                                top: size / 2 - 1,
                                opacity: gunOpacity,
                            }}
                        />
                        {shape.gunBounceRay && (
                            <div
                                className="pointer-events-none absolute bg-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.65)]"
                                style={{
                                    width: shape.gunBounceRay.length,
                                    height: 2,
                                    left: size / 2 + shape.gunBounceRay.distance,
                                    top: size / 2 - 1,
                                    opacity: gunOpacity,
                                    transformOrigin: "0 50%",
                                    transform: `rotate(${shape.gunBounceRay.angle}deg)`,
                                }}
                            />
                        )}
                    </>
                )}
            </>
        );
    }

    if (isMage) {
        const stunActiveMs = shape.stunActiveMs ?? 0;
        const stunOpacity = Math.max(0, Math.min(1, stunActiveMs / STUN_ACTIVE_MS));
        const wandLength = size * 0.48;
        const wandHeight = 10;
        const wandLeft = size / 2;
        const tipLeft = wandLeft + wandLength;
        const stunAngles = [
            -STUN_HALF_ARC_DEGREES,
            -STUN_HALF_ARC_DEGREES / 3,
            STUN_HALF_ARC_DEGREES / 3,
            STUN_HALF_ARC_DEGREES,
        ];
        const stunVerticalReach = STUN_RANGE * Math.sin(STUN_HALF_ARC_DEGREES * Math.PI / 180);
        return (
            <>
                <div
                    className="absolute rounded-full border border-orange-100 bg-orange-300/60 shadow-[0_0_12px_rgba(251,146,60,0.55)]"
                    style={{
                        width: wandLength,
                        height: wandHeight,
                        left: wandLeft,
                        top: size / 2 - wandHeight / 2,
                        transformOrigin: "0 50%",
                    }}
                />
                {stunActiveMs > 0 && (
                    <svg
                        className="pointer-events-none absolute overflow-visible"
                        width={STUN_RANGE}
                        height={stunVerticalReach * 2}
                        viewBox={`0 ${-stunVerticalReach} ${STUN_RANGE} ${stunVerticalReach * 2}`}
                        style={{
                            left: size / 2,
                            top: size / 2 - stunVerticalReach,
                            opacity: stunOpacity,
                        }}
                    >
                        {stunAngles.map((angle) => (
                            <path
                                key={angle}
                                d={buildStunBoltPath(angle, tipLeft - size / 2)}
                                fill="none"
                                stroke="#fef08a"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="4"
                                className="drop-shadow-[0_0_8px_rgba(250,204,21,0.85)]"
                            />
                        ))}
                    </svg>
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
    const shieldHp = Math.max(0, Math.ceil(Number(shape.shieldHp ?? 0)));

    return (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-16 rounded border border-zinc-700 bg-zinc-950/90 px-1 py-0.5 shadow">
            <div className="text-center font-mono text-[9px] font-bold leading-none text-lime">
                {Math.ceil(shape.hp)} HP{shieldHp > 0 ? ` +${shieldHp}` : ""}
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

function BuffStatusIndicators({ shape }) {
    const rotation = Number.isFinite(Number(shape.rotation)) ? Number(shape.rotation) : 0;
    const statuses = [];
    if ((shape.overdriveMs ?? 0) > 0) {
        statuses.push({ key: "od", label: "OD", className: "border-violet-200 bg-violet-500 text-violet-50" });
    }
    if ((shape.shieldHp ?? 0) > 0 || (shape.barrierImmunityMs ?? 0) > 0) {
        statuses.push({ key: "ba", label: "BA", className: "border-sky-100 bg-sky-400 text-sky-950" });
    }
    if ((shape.inhibitionCharges ?? 0) > 0) {
        statuses.push({ key: "in", label: `IN${Math.ceil(shape.inhibitionCharges)}`, className: "border-rose-200 bg-rose-500 text-rose-50" });
    }
    if ((shape.slowedMs ?? 0) > 0) {
        statuses.push({ key: "sl", label: "SL", className: "border-yellow-100 bg-yellow-300 text-zinc-950" });
    }
    if ((shape.jammedMs ?? 0) > 0) {
        statuses.push({ key: "jm", label: "JM", className: "border-amber-100 bg-amber-400 text-zinc-950" });
    }
    if ((shape.commandLockedMs ?? 0) > 0) {
        statuses.push({ key: "cl", label: "CL", className: "border-zinc-100 bg-zinc-700 text-zinc-50" });
    }
    if (!statuses.length) return null;

    return (
        <div
            className="pointer-events-none absolute -bottom-7 left-1/2 z-20 flex -translate-x-1/2 gap-1"
            style={{ transform: `translateX(-50%) rotate(${-rotation}deg)` }}
        >
            {statuses.map((status) => (
                <div
                    key={status.key}
                    className={`rounded border px-1 py-0.5 font-mono text-[8px] font-black leading-none shadow ${status.className}`}
                >
                    {status.label}
                </div>
            ))}
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

function FireballChargeBars({ shape }) {
    if (shape.combatClass !== "mage") return null;

    const rotation = Number.isFinite(Number(shape.rotation)) ? Number(shape.rotation) : 0;
    const charges = Math.max(0, Math.min(
        FIREBALL_CHARGES_MAX,
        Math.round(Number(shape.fireballCharges ?? FIREBALL_CHARGES_MAX)),
    ));
    const reloadMs = Math.max(0, Math.min(FIREBALL_RELOAD_MS, Number(shape.fireballReloadMs ?? 0)));
    const reloadPct = reloadMs > 0 ? 1 - reloadMs / FIREBALL_RELOAD_MS : 0;

    return (
        <div
            className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 flex w-7 -translate-y-1/2 flex-col gap-1 rounded border border-orange-800/70 bg-zinc-950/85 p-1 shadow"
            style={{ transform: `translateY(-50%) rotate(${-rotation}deg)` }}
            title={reloadMs > 0 ? "Channeling" : `${charges}/${FIREBALL_CHARGES_MAX} fireballs`}
        >
            <div className="text-center font-mono text-[8px] font-bold leading-none text-orange-200">
                {charges}
            </div>
            <div className="grid grid-cols-4 gap-0.5">
                {Array.from({ length: FIREBALL_CHARGES_MAX }, (_, index) => (
                    <div
                        key={index}
                        className={`h-2 rounded-full border ${index < charges
                            ? "border-orange-100 bg-orange-300 shadow-[0_0_5px_rgba(251,146,60,0.55)]"
                            : "border-zinc-600 bg-zinc-800"
                        }`}
                    />
                ))}
            </div>
            {reloadMs > 0 && (
                <div className="h-1 overflow-hidden rounded bg-zinc-800">
                    <div className="h-full bg-orange-300" style={{ width: `${reloadPct * 100}%` }} />
                </div>
            )}
        </div>
    );
}

function StunCooldownIndicator({ shape }) {
    if (shape.combatClass !== "mage") return null;

    const rotation = Number.isFinite(Number(shape.rotation)) ? Number(shape.rotation) : 0;
    const cooldownMs = Math.max(0, Math.min(
        STUN_COOLDOWN_MS,
        Number(shape.stunCooldownMs ?? 0),
    ));
    const readyPct = 1 - cooldownMs / STUN_COOLDOWN_MS;
    const ready = cooldownMs <= 0;

    return (
        <div
            className="pointer-events-none absolute right-[calc(100%+8px)] top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full shadow"
            style={{
                background: `conic-gradient(#fde047 ${readyPct * 360}deg, #3f3f46 0deg)`,
                transform: `translateY(-50%) rotate(${-rotation}deg)`,
            }}
            title={ready ? "Stun ready" : `Stun ready in ${(cooldownMs / 1000).toFixed(1)}s`}
        >
            <div className={`grid h-5 w-5 place-items-center rounded-full bg-zinc-950 text-sm leading-none ${ready ? "text-yellow-300" : "text-zinc-500"}`}>
                ⚡
            </div>
        </div>
    );
}

function objectSlotLabel(shape, labeledObjects) {
    if (!labeledObjects || !shape.id?.startsWith?.("object_")) return null;
    return objectDisplayName(shape, labeledObjects);
}

function ShapeVisual({ shape, isSelected }) {
    const { type, size } = shape;
    const sel = isSelected;
    const dashing = (shape.dashActiveMs ?? 0) > 0;
    const overdriveActive = (shape.overdriveMs ?? 0) > 0;
    const barrierActive = (shape.shieldHp ?? 0) > 0 || (shape.barrierImmunityMs ?? 0) > 0;
    const slowed = (shape.slowedMs ?? 0) > 0;

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
                className={`relative rounded-full border-2 bg-fuchsia-500/10 flex items-center justify-center transition-all duration-100 ${dashing ? "shadow-[0_0_20px_rgba(34,211,238,0.8)]" : ""} ${overdriveActive ? "ring-2 ring-violet-300 shadow-[0_0_18px_rgba(167,139,250,0.55)]" : ""} ${barrierActive ? "outline outline-2 outline-sky-200/80" : ""} ${slowed ? "opacity-75 saturate-50" : ""} ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : "border-fuchsia-400"
                    }`}
            >
                <HealthBar shape={shape} />
                <BuffStatusIndicators shape={shape} />
                <ShieldChargeBars shape={shape} />
                <AmmoBars shape={shape} />
                <FireballChargeBars shape={shape} />
                <StunCooldownIndicator shape={shape} />
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

    if (type === RADAR_JAMMER_TYPE || type === COMMAND_LOCK_TYPE) {
        const captureBySlot = shape.captureBySlot ?? {};
        const capturePct = Math.max(
            0,
            Math.min(1, Math.max(Number(captureBySlot["1"] ?? 0), Number(captureBySlot["2"] ?? 0)) / 5000),
        );
        const jammer = type === RADAR_JAMMER_TYPE;
        return (
            <div
                style={{ width: size, height: size }}
                className={`relative flex items-center justify-center rounded-full border-2 ${jammer ? "border-amber-200 bg-amber-400/15 shadow-[0_0_20px_rgba(251,191,36,0.35)]" : "border-zinc-200 bg-zinc-500/15 shadow-[0_0_20px_rgba(212,212,216,0.32)]"} transition-all duration-100 ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : ""}`}
            >
                {capturePct > 0 && (
                    <div
                        className="absolute inset-0 rounded-full opacity-70"
                        style={{ background: `conic-gradient(rgba(255,255,255,0.65) ${capturePct * 360}deg, transparent 0deg)` }}
                    />
                )}
                {jammer ? (
                    <div className="relative h-[54%] w-[66%]">
                        <div className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-amber-100" />
                        <div className="absolute bottom-1 left-1/2 h-5 w-10 -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-amber-100" />
                        <div className="absolute bottom-1 left-1/2 h-9 w-16 -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-amber-100" />
                        <div className="absolute left-1/2 top-1/2 h-1 w-full -translate-x-1/2 rotate-45 rounded bg-red-300" />
                    </div>
                ) : (
                    <div className="relative h-[52%] w-[46%]">
                        <div className="absolute bottom-0 left-0 h-[62%] w-full rounded border-2 border-zinc-100" />
                        <div className="absolute left-1/2 top-0 h-[48%] w-[70%] -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-zinc-100" />
                    </div>
                )}
            </div>
        );
    }

    if (type === OVERDRIVE_TYPE || type === BARRIER_TYPE || type === INHIBITION_TYPE) {
        const color = type === OVERDRIVE_TYPE
            ? { border: "border-violet-300", bg: "bg-violet-500/15", text: "text-violet-100", shadow: "shadow-[0_0_18px_rgba(167,139,250,0.35)]" }
            : type === BARRIER_TYPE
                ? { border: "border-sky-200", bg: "bg-sky-400/15", text: "text-sky-100", shadow: "shadow-[0_0_18px_rgba(125,211,252,0.35)]" }
                : { border: "border-rose-300", bg: "bg-rose-500/15", text: "text-rose-100", shadow: "shadow-[0_0_18px_rgba(251,113,133,0.35)]" };
        return (
            <div
                style={{ width: size, height: size }}
                className={`relative flex items-center justify-center rounded-full border-2 ${color.border} ${color.bg} ${color.shadow} transition-all duration-100 ${sel ? "border-white shadow-[0_0_0_3px_rgba(255,255,255,0.2)]" : ""}`}
            >
                {(shape.hp ?? 0) > 0 && <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[9px] text-white">{Math.ceil(shape.hp)}</div>}
                {type === OVERDRIVE_TYPE && (
                    <div className="relative h-[58%] w-[58%] rounded-full border-2 border-violet-100">
                        <div className="absolute left-1/2 top-1/2 h-[34%] w-0.5 -translate-x-1/2 -translate-y-full rounded bg-violet-100" />
                        <div className="absolute left-1/2 top-1/2 h-0.5 w-[32%] -translate-y-1/2 rounded bg-violet-100" />
                    </div>
                )}
                {type === BARRIER_TYPE && (
                    <div className={`text-3xl font-black leading-none ${color.text}`}>◇</div>
                )}
                {type === INHIBITION_TYPE && (
                    <div className={`text-2xl font-black leading-none ${color.text}`}>⌁</div>
                )}
            </div>
        );
    }

    if (type === PROJECTILE_WALL_TYPE || type === BOUNCY_WALL_TYPE) {
        const capSize = PROJECTILE_WALL_THICKNESS + 6;
        const colorClass = type === PROJECTILE_WALL_TYPE ? "bg-yellow-300" : "bg-white";
        return (
            <div
                className="relative"
                style={{ width: PROJECTILE_WALL_LENGTH, height: PROJECTILE_WALL_LENGTH }}
            >
                <div
                    className={`absolute left-0 top-1/2 w-full -translate-y-1/2 shadow-[0_0_8px_rgba(255,255,255,0.55)] ${colorClass}`}
                    style={{ height: PROJECTILE_WALL_THICKNESS }}
                />
                <div
                    className={`absolute left-0 top-1/2 rounded-full -translate-x-1/2 -translate-y-1/2 ${colorClass}`}
                    style={{ width: capSize, height: capSize }}
                />
                <div
                    className={`absolute right-0 top-1/2 rounded-full translate-x-1/2 -translate-y-1/2 ${colorClass}`}
                    style={{ width: capSize, height: capSize }}
                />
            </div>
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

    if (type === "fireball") {
        return (
            <div
                style={{ width: size, height: size }}
                className="rounded-full border border-orange-100 bg-orange-400 shadow-[0_0_18px_rgba(251,146,60,0.75)]"
            />
        );
    }

    return null;
}

export default function ShapeObject({ shape, displayScale = 1, isSelected, onSelect, onDragEnd, locked = false, labeledObjects = null }) {
    const dragging = useRef(false);
    const hasMoved = useRef(false);
    const offset = useRef({ x: 0, y: 0 });
    const wrapperRef = useRef(null);
    const isMain = shape.id === "main";
    const isWall = shape.type === PROJECTILE_WALL_TYPE || shape.type === BOUNCY_WALL_TYPE;
    const halfSize = isMain ? MAIN_RADIUS : shape.size / 2;
    const label = objectSlotLabel(shape, labeledObjects);

    // Keep a live ref to shape position so move handler never uses a stale closure
    const shapeRef = useRef({ x: shape.x, y: shape.y });

    const arenaPoint = (event) => {
        const arenaElement = wrapperRef.current?.parentElement;
        const bounds = arenaElement?.getBoundingClientRect();
        if (!bounds || displayScale <= 0) return null;
        return {
            x: (event.clientX - bounds.left) / displayScale,
            y: (event.clientY - bounds.top) / displayScale,
        };
    };

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

        const point = arenaPoint(e);
        if (!point) return;

        // Keep drag coordinates in logical arena units while the canvas is scaled.
        offset.current = {
            x: point.x - shapeRef.current.x,
            y: point.y - shapeRef.current.y,
        };

        const handleMove = (me) => {
            if (!dragging.current) return;
            hasMoved.current = true;
            const point = arenaPoint(me);
            if (!point) return;
            const limit = isMain ? MAIN_RADIUS : shape.size / 2;
            const nx = Math.max(limit, Math.min(point.x - offset.current.x, CANVAS_SIZE - limit));
            const ny = Math.max(limit, Math.min(point.y - offset.current.y, CANVAS_SIZE - limit));
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

    const handleRotationMouseDown = (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (locked) return;

        const bounds = wrapperRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;

        const handleMove = (moveEvent) => {
            const angle = Math.atan2(
                moveEvent.clientY - centerY,
                moveEvent.clientX - centerX,
            ) * 180 / Math.PI;
            const snappedRotation = ((Math.round(angle / 45) * 45) % 360 + 360) % 360;
            onDragEnd(shape.id, { rotation: snappedRotation });
        };
        const handleUp = () => {
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
        const overdriveActive = (shape.overdriveMs ?? 0) > 0;
        const barrierActive = (shape.shieldHp ?? 0) > 0 || (shape.barrierImmunityMs ?? 0) > 0;
        const slowed = (shape.slowedMs ?? 0) > 0;
        return (
            <div ref={wrapperRef} style={wrapStyle} onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}>
                <div
                    style={{ width: MAIN_RADIUS * 2, height: MAIN_RADIUS * 2 }}
                    className={`main-orbit relative rounded-full border-2 border-cyan bg-cyan/10 flex items-center justify-center transition-all duration-150 ${overdriveActive ? "ring-2 ring-violet-300 shadow-[0_0_18px_rgba(167,139,250,0.55)]" : ""} ${barrierActive ? "outline outline-2 outline-sky-200/80" : ""} ${slowed ? "opacity-75 saturate-50" : ""} ${isSelected ? "shadow-cyan-ring" : "shadow-cyan-subtle"
                        }`}
                >
                    <HealthBar shape={shape} />
                    <BuffStatusIndicators shape={shape} />
                    <ShieldChargeBars shape={shape} />
                    <AmmoBars shape={shape} />
                    <FireballChargeBars shape={shape} />
                    <StunCooldownIndicator shape={shape} />
                    <WeaponVisual shape={shape} />
                    <span className="font-mono text-sm font-bold text-cyan tracking-wide">M</span>
                </div>
            </div>
        );
    }

    return (
        <div ref={wrapperRef} style={wrapStyle} onMouseDown={handleMouseDown}>
            {isWall && isSelected && !locked && (
                <button
                    type="button"
                    title="Drag to rotate wall"
                    aria-label="Drag to rotate wall"
                    className="absolute left-full top-1/2 z-30 h-5 w-5 -translate-y-1/2 translate-x-2 cursor-grab rounded-full border-2 border-cyan-100 bg-cyan-500 shadow-[0_0_10px_rgba(34,211,238,0.75)] active:cursor-grabbing"
                    style={{ transform: `translate(8px, -50%) rotate(${-(shape.rotation ?? 0)}deg)` }}
                    onMouseDown={handleRotationMouseDown}
                />
            )}
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
