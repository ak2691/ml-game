import {
    BARRIER_TYPE,
    COMMAND_LOCK_TYPE,
    INHIBITION_TYPE,
    OVERDRIVE_TYPE,
    RADAR_JAMMER_TYPE,
} from "./ArenaObjects.js";

const MAX_OBSTACLES = 6;

export default function Toolbar({
    onAddShape,
    onSelectMain,
    onDeleteSelected,
    selectedId,
    submitStatus,
    obstacleCount,
    obstaclesLocked = false,
    canDeleteSelected = false,
}) {
    const shapes = [
        { type: "main", label: "Player Model", icon: "M" },
        { type: "opponentModel", label: "Opponent Model", icon: "VS" },
    ];
    const obstacles = [
        { type: "healthPack", label: "Health Pack", icon: "+" },
        { type: "projectileWall", label: "Projectile Wall", icon: "|" },
        { type: "bouncyWall", label: "Bouncy Wall", icon: "/" },
        { type: OVERDRIVE_TYPE, label: "Overdrive", icon: "OD" },
        { type: BARRIER_TYPE, label: "Barrier", icon: "SH" },
        { type: INHIBITION_TYPE, label: "Inhibition", icon: "IN" },
        { type: RADAR_JAMMER_TYPE, label: "Radar Jammer", icon: "JX" },
        { type: COMMAND_LOCK_TYPE, label: "Command Lock", icon: "LK" },
    ];

    const atLimit = obstacleCount >= MAX_OBSTACLES;
    const disableObstacleButtons = atLimit || obstaclesLocked;

    return (
        <div className="w-44 flex-shrink-0 bg-arena-panel border-r border-border-lo flex flex-col gap-0 overflow-y-auto px-3.5 py-5">
            <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] tracking-[0.15em] text-ink-muted">MODELS</span>
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
                {shapes.map(({ type, label, icon }) => (
                    <button
                        key={type}
                        onClick={() => type === "main" ? onSelectMain() : onAddShape(type)}
                        className="flex items-center gap-2.5 w-full px-3 py-2 bg-arena-surface border border-border-lo rounded-md font-ui font-semibold text-sm tracking-wide transition-all duration-150 text-ink-mid cursor-pointer hover:bg-arena-hover hover:border-border-hi hover:text-ink-white"
                    >
                        <span className="text-[13px] w-4 text-center text-cyan">{icon}</span>
                        <span className="text-[13px]">{label}</span>
                    </button>
                ))}
            </div>

            <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] tracking-[0.15em] text-ink-muted">OBSTACLES</span>
                <span className={`font-mono text-[10px] tracking-widest ${atLimit ? "text-danger" : "text-ink-muted"}`}>
                    {obstacleCount}/{MAX_OBSTACLES}
                </span>
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
                {obstacles.map(({ type, label, icon }) => (
                    <button
                        key={type}
                        onClick={() => onAddShape(type)}
                        disabled={disableObstacleButtons}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 bg-arena-surface border border-border-lo rounded-md font-ui font-semibold text-sm tracking-wide transition-all duration-150 ${disableObstacleButtons
                            ? "opacity-30 cursor-not-allowed text-ink-muted"
                            : "text-ink-mid cursor-pointer hover:bg-arena-hover hover:border-border-hi hover:text-ink-white"
                            }`}
                    >
                        <span className={`text-[13px] w-4 text-center ${disableObstacleButtons ? "text-ink-muted" : "text-cyan"}`}>{icon}</span>
                        <span className="text-[13px]">{label}</span>
                    </button>
                ))}
            </div>

            {(atLimit || obstaclesLocked) && (
                <p className="font-mono text-[10px] text-danger/70 text-center mb-3 -mt-2">
                    {obstaclesLocked ? "Match obstacles locked" : "Max obstacles reached"}
                </p>
            )}

            {selectedId && (
                <div className="mt-3 rounded border border-cyan-dim bg-cyan/10 px-2.5 py-2 font-mono text-[10px] tracking-widest text-center text-cyan">
                    <div>SELECTED</div>
                    <button
                        type="button"
                        onClick={onDeleteSelected}
                        disabled={!canDeleteSelected}
                        className="mt-2 h-8 w-full rounded border border-red-800/70 bg-red-950/30 text-[10px] font-bold tracking-widest text-red-300 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        DELETE
                    </button>
                </div>
            )}

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
