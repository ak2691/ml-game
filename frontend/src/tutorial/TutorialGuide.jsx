import { useState } from "react";
import MatchToolIcon from "../beta/MatchToolIcon.jsx";

const STEPS = [
    {
        eyebrow: "01 · RIGHT TOOLBAR",
        title: "Your arena controls at a glance.",
        body: "These controls change the training room, not the submitted brain.",
        tools: [
            ["play", "Run or stop the brain"],
            ["stats", "Heal and clear cooldowns"],
            ["measure", "Measure arena distances"],
            ["edit", "Edit your sandbox loadout"],
            ["target", "Spawn an opponent bot"],
            ["opponent", "Edit the opponent loadout"],
            ["save", "Save the current setup"],
            ["load", "Restore the saved setup"],
            ["reset", "Return to the original spawn"],
        ],
        task: "The symbols here match the buttons in the toolbar on the right.",
    },
    {
        eyebrow: "02 · BUILD A BRAIN",
        title: "Turn a simple idea into bot logic.",
        body: "Bot Fight is a fighting game where you program decisions instead of controlling the fighter directly. Start with the simplest possible idea:",
        example: "ALWAYS → Move toward target → Opponent 1",
        task: "Click Open Bot Brain on the right. The in-workspace coach will guide your first node and show where Custom Variables live.",
        solution: true,
    },
    {
        eyebrow: "03 · DISTANCE + HP",
        title: "Make the same bot change its mind.",
        body: "The opponent now uses Sword Swing. Approach while Target Distance is greater than its attack range. After taking a few hits, use My HP to switch the same movement head from approach to retreat.",
        example: "IF My HP < 45 → Move away\nELSE IF Target Distance > 92 → Move toward",
        task: "Build both decisions, then press Play to watch the handoff.",
        solution: true,
    },
    {
        eyebrow: "04 · RANGE + BEARING",
        title: "A ready attack is not necessarily a good attack.",
        body: "Your bot starts facing backward and outside Heavy Slash range. Rotate toward Opponent 1, close to 105 units, and attack only when Relative Bearing is nearly zero. This protects the five-second cooldown from a wasted swing.",
        example: "Distance ≤ 105 AND Relative Bearing ≤ 89° → Heavy Slash",
        task: "Build it yourself or reveal the three-node solution.",
        solution: true,
    },
    {
        eyebrow: "05 · DODGE A PROJECTILE",
        title: "Change the target from fighter to threat.",
        body: "Your only ability is Micro Dash. The opponent throws Grenades from close range. Target Opponent Grenade, wait until it is nearby, then dash right relative to the projectile’s approach line.",
        example: "IF Opponent Grenade Distance < 190 → Micro Dash right",
        task: "Press Play after building the dodge and watch the target switch.",
        solution: true,
    },
    {
        eyebrow: "06 · COMBINE THE FUNDAMENTALS",
        title: "Dodge and land Heavy Slash in five seconds.",
        body: "This brain starts empty. Combine projectile targeting, relative movement, range, rotation, and bearing. You pass only by avoiding Grenade damage and landing Heavy Slash before the timer expires.",
        task: "Press Play to begin. A failed run resets when you press Play again.",
        solution: true,
        challenge: true,
    },
    {
        eyebrow: "07 · SURVIVE TEN SECONDS",
        title: "Fight aggressively without throwing your life away.",
        body: "Both bots have Sword Swing, but the 1,000 HP opponent stays in place. Your bot starts looking away from the opponent. Deal as much damage as you can; the only requirement is being alive when the ten seconds end.",
        task: "Survival is the only win condition. But can you at least deal 60 damage? 100?",
        solution: true,
        challenge: true,
    },
    {
        eyebrow: "08 · ROUND ABILITIES",
        title: "Build your loadout as the match progresses.",
        body: "Before each round, you choose from a random set of ability offers. Pick 3 of 6 in Round 1, 2 of 4 in Round 2, and 1 of 3 in Round 3. Earlier picks stay equipped, giving you six abilities by the final round.",
        task: "The ability catalogue will let you review every ability and plan combinations.",
        abilityCatalogue: true,
    },
];

const BRAIN_COACHES = {
    1: {
        eyebrow: "FIRST BRAIN NODE",
        items: [
            ["ADD BRAIN NODE", "Creates an independent decision group. Each Brain Node can own several conditionals."],
            ["+ CONDITIONAL", "Adds the first decision to the Brain Node. Keep it set to ALWAYS for this lesson."],
            ["+ CHILD IF", "Nests a conditional beneath the current one. The child is considered only after its parent matches, so use it for a second decision that depends on the first."],
            ["+ ACTION", "Add Movement → Walk → Toward target → Opponent 1 to make this first brain move."],
            ["EDITOR INPUTS", "Type to search dropdowns, press Tab to move forward, and press Enter to choose."],
            ["CUSTOM VARIABLES", "Use the workspace toolbar later to create named counters, numbers, or flags for multi-step tactics."],
        ],
    },
    2: {
        eyebrow: "IF, ELSE IF + PRIORITY",
        items: [

            ["Two + CONDITIONALS", "Adds a sibling. The first node is IF and later nodes are ELSE IF choices checked in order, so put the most important case first."]
        ],
    },
    3: {
        eyebrow: "COMBINE CONDITIONS WITH AND",
        items: [
            ["+ CONDITION", "Adds another comparison inside the same conditional instead of creating a new sibling or child."],
            ["AND", "Requires every joined comparison to be true before the actions can run. Change the join to OR when either comparison should be enough."],
            ["THIS LESSON", "Use Distance ≤ 105 AND Relative Bearing ≤ 16° so Heavy Slash runs only while the target is both in range and lined up."],
            ["WHY IT MATTERS", "Combining checks protects a long cooldown from being spent when only part of the attack setup is ready."],
        ],
    },
    6: {
        eyebrow: "MULTI-ACTION CONDITIONALS",
        items: [
            ["+ ACTION", "A matching conditional can contribute several compatible actions during the same decision tick."],
            ["COMBINE TYPES", "For example, one conditional can rotate toward the opponent and use Sword Swing, while another can move and rotate."],
            ["ONE PER TYPE", "You cannot place two movement actions, two rotation actions, or two ability actions on the same conditional. Choose one action from each type you need."],
            ["PRIORITY STILL APPLIES", "If another Brain Node also supplies that action type, the higher-priority node wins the conflict."],
        ],
    },
};

export function TutorialBrainCoach({ step, onShowSolution }) {
    const coach = BRAIN_COACHES[step];
    if (!coach) return null;

    return (
        <aside className="absolute right-5 top-24 z-30 max-h-[calc(100%-7rem)] w-80 overflow-y-auto rounded-xl border border-cyan-400/40 bg-[#07111cf2] p-4 shadow-2xl">
            <p className="font-mono text-[9px] font-bold tracking-[.2em] text-cyan-300">{coach.eyebrow}</p>
            <ol className="mt-3 space-y-2 text-xs leading-5 text-slate-200">
                {coach.items.map(([label, copy], index) => (
                    <li key={label}><strong className="text-white">{index + 1}. {label}:</strong> {copy}</li>
                ))}
            </ol>
            <button type="button" onClick={onShowSolution} className="mt-4 w-full rounded border border-cyan-400/50 bg-cyan-950/50 px-3 py-2 text-xs font-bold text-cyan-100">SHOW THIS SOLUTION</button>
        </aside>
    );
}

export default function TutorialGuide({ step, onStepChange, challenge, onShowSolution, solutionShown, onAbilityCatalogue }) {
    const [minimized, setMinimized] = useState(false);
    const current = STEPS[step] ?? STEPS[0];

    if (minimized) {
        return (
            <button type="button" onClick={() => setMinimized(false)} className="fixed left-4 top-20 z-30 flex items-center gap-2 rounded-lg border border-cyan-400/40 bg-[#07111cf2] px-3 py-2 text-left shadow-2xl" aria-label="Expand tutorial">
                <span className="font-mono text-[9px] font-bold tracking-[.16em] text-cyan-300">TUTORIAL {step + 1}/{STEPS.length}</span>
                <span aria-hidden="true" className="text-sm text-slate-300">▣</span>
            </button>
        );
    }

    return (
        <section className="fixed left-4 top-20 z-30 h-[27rem] max-h-[calc(100vh-6rem)] w-[21rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-cyan-400/30 bg-[#07111cf2] shadow-[0_18px_50px_rgba(0,0,0,.48)]" aria-label="Tutorial walkthrough">
            <div className="h-1 rounded-t-xl bg-gradient-to-r from-cyan-400 via-indigo-500 to-transparent" />
            <div className="flex h-[calc(100%-0.25rem)] flex-col p-3.5">
                <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[9px] font-bold tracking-[.18em] text-cyan-300">{current.eyebrow}</p>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] text-slate-500">{step + 1}/{STEPS.length}</span>
                        <button type="button" onClick={() => setMinimized(true)} className="rounded border border-white/10 px-2 py-0.5 text-sm leading-4 text-slate-300 hover:bg-white/10" aria-label="Minimize tutorial" title="Minimize tutorial">−</button>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    <h2 className="mt-2 text-sm font-bold leading-snug text-white">{current.title}</h2>
                    <p className="mt-1.5 text-[11px] leading-[1.1rem] text-slate-300">{current.body}</p>
                    {current.example && <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-2.5 font-mono text-[9px] leading-4 text-cyan-100">{current.example}</pre>}
                    {current.tools && <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">{current.tools.map(([icon, copy]) => <li key={icon} className="flex items-center gap-2 text-[9px] leading-3 text-slate-300"><span className="text-cyan-300"><MatchToolIcon name={icon} className="h-4 w-4" /></span><span>{copy}</span></li>)}</ul>}
                    {current.challenge && <ChallengeStatus challenge={challenge} />}
                    <p className="mt-2 border-l-2 border-indigo-400 pl-2.5 text-[9px] leading-4 text-indigo-100">{current.task}</p>
                </div>
                <div className="flex-none border-t border-white/10 pt-2.5">
                    <div className="flex gap-2">
                        {current.solution && <button type="button" onClick={onShowSolution} className="flex-1 rounded border border-indigo-400/40 bg-indigo-950/35 px-3 py-1.5 text-[9px] font-bold text-indigo-100">{solutionShown ? "RESET TO EMPTY" : "SHOW SOLUTION"}</button>}
                        {current.abilityCatalogue && <button type="button" onClick={onAbilityCatalogue} className="flex-1 rounded border border-cyan-400/60 bg-cyan-900/50 px-3 py-1.5 text-[9px] font-bold text-cyan-50">ABILITY CATALOGUE →</button>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                        <button type="button" disabled={step === 0} onClick={() => onStepChange(step - 1)} className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-[9px] font-bold text-slate-200 disabled:opacity-30">BACK</button>
                        {step < STEPS.length - 1 && <button type="button" onClick={() => onStepChange(step + 1)} className="ml-auto rounded border border-cyan-400/60 bg-cyan-900/50 px-3 py-1.5 text-[9px] font-bold text-cyan-50">NEXT →</button>}
                    </div>
                </div>
            </div>
        </section>
    );
}

const CHALLENGE_MESSAGES = {
    ready: "Build the lesson brain, then press Play.",
    ready_again: "Press Play to run this lesson again.",
    stopped: "Run stopped. Press Play when you are ready to restart.",
    demonstration_running: "Demonstration running. Press Stop when you are done.",
    reading_brain: "Reading your brain…",
    combo_passed: "Clean dodge and confirmed hit. You passed.",
    combo_took_damage: "The grenade connected. Adjust the dodge rule, then press Play to restart.",
    combo_timed_out: "Time expired before Heavy Slash landed. Press Play to restart.",
    survive_passed: "Ten seconds complete. Your bot stayed alive.",
    survive_defeated: "Your bot was defeated. Add an HP retreat rule and try again.",
};

function ChallengeStatus({ challenge }) {
    const status = challenge ?? { status: "idle", remainingMs: 0, code: "ready" };
    const message = CHALLENGE_MESSAGES[status.code];
    return (
        <div className={`mt-2 rounded-lg border p-2 ${status.status === "passed" ? "border-emerald-400/50 bg-emerald-950/40" : status.status === "failed" ? "border-rose-400/50 bg-rose-950/40" : "border-cyan-400/30 bg-cyan-950/25"}`}>
            <div className="flex items-center justify-between font-mono text-[9px] font-bold"><span>{status.status.toUpperCase()}</span><span className="text-cyan-200">{(status.remainingMs / 1000).toFixed(1)}s</span></div>
            {message && <p className="mt-1 text-[8px] leading-3 text-slate-300">{message}</p>}
        </div>
    );
}
