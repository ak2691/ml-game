import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { loadBotRoom, loadMatchmaking, loadProfile } from "../routeLoaders";

const actions = [
    { id: "match", icon: "⚔", title: "Queue Match", copy: "Battle another player online", tone: "blue" },
    { id: "room", icon: "◇", title: "Open Bot Room", copy: "Build and test bots in the sandbox", tone: "teal" },
    { id: "actions", icon: "⌘", title: "Action List", copy: "Browse movement, rotation, and abilities", tone: "violet" },
    { id: "conditions", icon: "◆", title: "Conditional List", copy: "Explore the values your bot can read", tone: "cyan" },
];

export default function HomePage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const hasActiveMatch = location.state?.activeMatch === true;
    const username = user?.username ?? "fighter";

    useEffect(() => {
        const prefetchGameplay = () => void Promise.allSettled([loadBotRoom(), loadMatchmaking(), loadProfile(), import("../tutorial/TutorialPage")]);
        if ("requestIdleCallback" in window) {
            const idleId = window.requestIdleCallback(prefetchGameplay, { timeout: 3000 });
            return () => window.cancelIdleCallback(idleId);
        }
        const timeoutId = window.setTimeout(prefetchGameplay, 1000);
        return () => window.clearTimeout(timeoutId);
    }, []);

    const handleLogout = async () => {
        await logout();
        navigate("/login", { replace: true });
    };

    const handleAction = (id) => {
        if (id === "match") navigate("/matchmaking");
        if (id === "room") navigate("/beta");
        if (id === "actions") navigate("/tutorial", { state: { tutorialStep: 2 } });
        if (id === "conditions") navigate("/tutorial", { state: { tutorialStep: 3 } });
    };

    return (
        <main className="home-grid home-dashboard min-h-screen overflow-hidden bg-[#050d16] font-interface text-slate-100">
            <header className="relative z-10 flex min-h-[72px] items-center justify-between border-b border-slate-700/60 bg-[#07111be8] px-5 sm:px-8">
                <button type="button" onClick={() => navigate("/home")} className="flex items-center bg-transparent p-0 hover:border-transparent" aria-label="Go to home">
                    <span className="grid h-11 w-11 place-items-center border border-cyan-400/70 bg-cyan-950/30 font-mono text-lg font-bold tracking-[.14em] text-cyan-300 [clip-path:polygon(25%_0,75%_0,100%_25%,100%_75%,75%_100%,25%_100%,0_75%,0_25%)]">BF</span>
                </button>
                <nav className="flex items-center gap-1 sm:gap-2" aria-label="Account navigation">
                    <button type="button" onClick={() => navigate("/profile")} className="flex items-center gap-3 border border-slate-600/60 bg-slate-900/30 px-3 py-2 text-sm font-bold text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200" aria-label={`Open ${username}'s profile`}>
                        <span className="grid h-8 w-8 place-items-center rounded-full border border-slate-500/70 bg-slate-800 text-slate-300" aria-hidden="true">
                            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7">
                                <circle cx="12" cy="8" r="3.25" />
                                <path d="M5.75 19c.7-3.45 2.78-5.25 6.25-5.25s5.55 1.8 6.25 5.25" />
                            </svg>
                        </span>
                        <span className="max-w-32 truncate">{username}</span>
                    </button>
                    <div className="hidden h-8 w-px bg-slate-700 sm:block" />
                    <button type="button" onClick={handleLogout} className="border border-rose-400/20 bg-rose-950/10 px-4 py-2 text-sm font-bold text-rose-300 hover:border-rose-400/60">↪ <span className="ml-1 hidden sm:inline">Logout</span></button>
                </nav>
            </header>

            <section className="relative z-[1] mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[920px] flex-col justify-center px-5 py-10 sm:px-8">
                <div className="text-center">
                    <h1 className="home-title text-6xl font-bold leading-[.82] tracking-[-.04em] sm:text-8xl">
                        <span className="block text-cyan-400">BOT</span>
                        <span className="block text-fuchsia-400">FIGHT</span>
                    </h1>
                </div>

                <div className="mx-auto mt-12 grid w-full max-w-[800px] gap-4 sm:grid-cols-2">
                    {actions.map((action) => (
                        <button key={action.id} type="button" onClick={() => handleAction(action.id)} className={`home-action home-action-${action.tone} group flex min-h-[116px] items-center gap-5 rounded-2xl border p-5 text-left shadow-[0_18px_40px_rgba(0,0,0,.2)]`}>
                            <span className="grid h-14 w-14 flex-none place-items-center rounded-xl border border-current/30 bg-black/20 text-3xl">{action.icon}</span>
                            <span>
                                <strong className="block text-xl text-white">{action.id === "match" && hasActiveMatch ? "Return to Match" : action.title}</strong>
                                <span className="mt-1 block text-sm text-slate-400">{action.copy}</span>
                            </span>
                            <span className="ml-auto text-xl opacity-50 group-hover:opacity-100">→</span>
                        </button>
                    ))}
                </div>

                <button type="button" onClick={() => navigate("/tutorial")} className="mx-auto mt-7 border-0 bg-transparent px-4 py-2 text-sm font-semibold text-slate-400 hover:border-transparent hover:text-cyan-200">New to Bot Fight? <span className="text-cyan-300">Tutorial</span></button>
            </section>
        </main>
    );
}
