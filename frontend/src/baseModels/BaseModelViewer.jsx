import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sampleManifest, sampleReplay } from "./sampleMeleeArtifacts";
import "./BaseModelViewer.css";

const ARTIFACT_BASE = "/artifacts/base-models/melee-v0";
const ARENA_SIZE = 800;

function formatNumber(value, fallback = "--") {
    return Number.isFinite(value) ? value.toFixed(2) : fallback;
}

function resolveArtifactPath(path) {
    if (!path || path === "sample") return null;
    return `${ARTIFACT_BASE}/${path}`;
}

function drawFighter(ctx, fighter, color, label) {
    const radius = 24;
    ctx.save();
    ctx.translate(fighter.x, fighter.y);
    ctx.rotate(fighter.facing ?? 0);
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(40, 0);
    ctx.stroke();

    if ((fighter.attackActive ?? 0) > 0) {
        ctx.fillStyle = "rgba(244, 114, 182, 0.22)";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 76, -0.65, 0.65);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(245, 245, 245, 0.9)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`${label} ${Math.round(fighter.hp ?? 0)}hp`, fighter.x - 28, fighter.y - 34);
}

function drawFrame(canvas, frame, replay) {
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    const scale = canvas.width / (replay?.arenaSize ?? ARENA_SIZE);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, ARENA_SIZE, ARENA_SIZE);

    ctx.fillStyle = "#10151f";
    ctx.fillRect(0, 0, ARENA_SIZE, ARENA_SIZE);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, ARENA_SIZE - 2, ARENA_SIZE - 2);

    for (const obstacle of frame.obstacles ?? []) {
        ctx.fillStyle = "#374151";
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        ctx.strokeStyle = "rgba(203, 213, 225, 0.35)";
        ctx.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    }

    if (frame.player && frame.sensors) {
        ctx.strokeStyle = "rgba(34, 211, 238, 0.2)";
        for (const sensor of Object.values(frame.sensors)) {
            ctx.beginPath();
            ctx.moveTo(frame.player.x, frame.player.y);
            ctx.lineTo(
                frame.player.x + Math.cos(sensor.angle) * sensor.distance,
                frame.player.y + Math.sin(sensor.angle) * sensor.distance,
            );
            ctx.stroke();
        }
    }

    drawFighter(ctx, frame.enemy, "#a855f7", "enemy");
    drawFighter(ctx, frame.player, "#06b6d4", "base");

    ctx.restore();
}

function Metric({ label, value }) {
    return (
        <div className="base-model-viewer__metric">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

export default function BaseModelViewer() {
    const navigate = useNavigate();
    const canvasRef = useRef(null);
    const [manifest, setManifest] = useState(null);
    const [replay, setReplay] = useState(null);
    const [selectedCheckpointId, setSelectedCheckpointId] = useState(null);
    const [frameIndex, setFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [artifactStatus, setArtifactStatus] = useState("Loading training artifacts...");

    useEffect(() => {
        let cancelled = false;
        async function loadManifest() {
            try {
                const response = await fetch(`${ARTIFACT_BASE}/manifest.json`, { cache: "no-store" });
                if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
                const payload = await response.json();
                if (cancelled) return;
                setManifest(payload);
                setSelectedCheckpointId(payload.checkpoints?.at(-1)?.id ?? null);
                setArtifactStatus("Loaded local training artifacts.");
            } catch (err) {
                if (cancelled) return;
                setManifest(sampleManifest);
                setSelectedCheckpointId(sampleManifest.checkpoints[0].id);
                setReplay(sampleReplay);
                setArtifactStatus("No generated artifacts found yet. Showing a built-in sample replay.");
                console.info("[base-model-viewer] Falling back to sample replay.", err);
            }
        }
        loadManifest();
        return () => {
            cancelled = true;
        };
    }, []);

    const selectedCheckpoint = useMemo(() => {
        return manifest?.checkpoints?.find((checkpoint) => checkpoint.id === selectedCheckpointId)
            ?? manifest?.checkpoints?.at(-1)
            ?? null;
    }, [manifest, selectedCheckpointId]);

    useEffect(() => {
        if (!selectedCheckpoint) return;
        const replayPath = resolveArtifactPath(selectedCheckpoint.replayPath);
        if (!replayPath) {
            setReplay(sampleReplay);
            setFrameIndex(0);
            return;
        }

        let cancelled = false;
        async function loadReplay() {
            const response = await fetch(replayPath, { cache: "no-store" });
            if (!response.ok) throw new Error(`Replay returned ${response.status}`);
            const payload = await response.json();
            if (!cancelled) {
                setReplay(payload);
                setFrameIndex(0);
            }
        }
        loadReplay().catch((err) => {
            console.warn("[base-model-viewer] Unable to load replay.", err);
            if (!cancelled) {
                setReplay(sampleReplay);
                setFrameIndex(0);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [selectedCheckpoint]);

    useEffect(() => {
        const frame = replay?.frames?.[frameIndex];
        drawFrame(canvasRef.current, frame, replay);
    }, [replay, frameIndex]);

    useEffect(() => {
        if (!isPlaying || !replay?.frames?.length) return undefined;
        const interval = window.setInterval(() => {
            setFrameIndex((current) => (current + 1) % replay.frames.length);
        }, 90);
        return () => window.clearInterval(interval);
    }, [isPlaying, replay]);

    const frame = replay?.frames?.[frameIndex];
    const metrics = selectedCheckpoint?.metrics ?? {};
    const actionScores = Object.entries(frame?.actionScores ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    return (
        <main className="base-model-viewer">
            <header className="base-model-viewer__header">
                <button type="button" onClick={() => navigate("/home")} className="base-model-viewer__ghost-button">
                    Home
                </button>
                <div>
                    <h1>Base Model Checkpoints</h1>
                    <p>{manifest?.rulesetVersion ?? "melee-v0"} · {artifactStatus}</p>
                </div>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="base-model-viewer__primary-button"
                >
                    Refresh
                </button>
            </header>

            <section className="base-model-viewer__layout">
                <aside className="base-model-viewer__sidebar">
                    <div className="base-model-viewer__panel">
                        <h2>Checkpoints</h2>
                        <div className="base-model-viewer__checkpoint-list">
                            {(manifest?.checkpoints ?? []).map((checkpoint) => (
                                <button
                                    type="button"
                                    key={checkpoint.id}
                                    onClick={() => setSelectedCheckpointId(checkpoint.id)}
                                    className={checkpoint.id === selectedCheckpoint?.id ? "is-selected" : ""}
                                >
                                    <span>{checkpoint.id}</span>
                                    <small>episode {checkpoint.episode}</small>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="base-model-viewer__panel">
                        <h2>Eval</h2>
                        <div className="base-model-viewer__metrics">
                            <Metric label="Return" value={formatNumber(metrics.averageReturn)} />
                            <Metric label="Win rate" value={`${Math.round((metrics.winRate ?? 0) * 100)}%`} />
                            <Metric label="Hits" value={metrics.hitCount ?? "--"} />
                            <Metric label="Blocked" value={metrics.blockedMovementCount ?? "--"} />
                        </div>
                    </div>
                </aside>

                <section className="base-model-viewer__arena-panel">
                    <canvas ref={canvasRef} width="800" height="800" aria-label="Melee base model replay" />
                    <div className="base-model-viewer__timeline">
                        <button type="button" onClick={() => setIsPlaying((value) => !value)}>
                            {isPlaying ? "Pause" : "Play"}
                        </button>
                        <input
                            type="range"
                            min="0"
                            max={Math.max(0, (replay?.frames?.length ?? 1) - 1)}
                            value={frameIndex}
                            onChange={(event) => setFrameIndex(Number(event.target.value))}
                        />
                        <span>{frameIndex + 1}/{replay?.frames?.length ?? 0}</span>
                    </div>
                </section>

                <aside className="base-model-viewer__sidebar">
                    <div className="base-model-viewer__panel">
                        <h2>Frame</h2>
                        <div className="base-model-viewer__frame-readout">
                            <span>tick</span><strong>{frame?.tick ?? "--"}</strong>
                            <span>action</span><strong>{frame?.action ?? "--"}</strong>
                            <span>reward</span><strong>{formatNumber(frame?.reward)}</strong>
                            <span>player hp</span><strong>{Math.round(frame?.player?.hp ?? 0)}</strong>
                            <span>enemy hp</span><strong>{Math.round(frame?.enemy?.hp ?? 0)}</strong>
                        </div>
                    </div>

                    <div className="base-model-viewer__panel">
                        <h2>Action Scores</h2>
                        <div className="base-model-viewer__bars">
                            {actionScores.map(([name, value]) => (
                                <div key={name} className="base-model-viewer__bar-row">
                                    <span>{name}</span>
                                    <div>
                                        <i style={{ width: `${Math.max(4, Math.min(100, (value + 1) * 35))}%` }} />
                                    </div>
                                    <strong>{formatNumber(value)}</strong>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="base-model-viewer__panel">
                        <h2>Reward Events</h2>
                        <div className="base-model-viewer__events">
                            {(frame?.combatEvents?.length ? frame.combatEvents : [{ type: "none", value: 0 }]).map((event, index) => (
                                <div key={`${event.type}-${index}`}>
                                    <span>{event.type}</span>
                                    <strong>{formatNumber(event.value)}</strong>
                                </div>
                            ))}
                        </div>
                    </div>
                </aside>
            </section>
        </main>
    );
}
