// RewardSelector.jsx
export default function RewardSelector({ value, onChange, stepCount }) {
    const color =
        value > 0.15 ? "#22c55e"
            : value < -0.15 ? "#ef4444"
                : "#888";

    const label =
        value > 0.15 ? "Good"
            : value < -0.15 ? "Bad"
                : "Neutral";

    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-ink-muted mr-1">
                Rate {stepCount} step{stepCount !== 1 ? "s" : ""}:
            </span>
            <input
                type="range"
                min="-1"
                max="1"
                step="0.1"
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-28"
                style={{ accentColor: color }}
            />
            <span
                className="text-sm font-bold tabular-nums w-10 text-center"
                style={{ color }}
            >
                {value >= 0 ? "+" : ""}{value.toFixed(1)}
            </span>
            <span className="text-xs w-10" style={{ color }}>
                {label}
            </span>
        </div>
    );
}