import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { loadBotRoom, loadMatchmaking } from "../routeLoaders";

export default function HomePage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const prefetchGameplay = () => {
            void Promise.allSettled([loadBotRoom(), loadMatchmaking()]);
        };
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

    return (
        <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
            <header className="flex h-[52px] items-center justify-between border-b border-border-lo bg-arena-panel px-6">
                <button
                    type="button"
                    onClick={() => navigate("/home")}
                    className="flex items-center gap-3 text-left hover:text-cyan-100"
                    aria-label="Go to home"
                >
                    <span className="text-xl text-cyan leading-none">M</span>
                    <span className="text-lg font-bold tracking-[0.15em] text-ink-white">MACHINER</span>
                </button>
                <button
                    onClick={handleLogout}
                    className="rounded border border-border-lo bg-zinc-900 px-3 py-1 text-xs font-bold text-ink-muted hover:text-ink-white"
                >
                    LOGOUT
                </button>
            </header>

            <section className="mx-auto flex min-h-[calc(100vh-52px)] max-w-[720px] flex-col justify-center px-6">
                <div className="mb-5 rounded border border-border-lo bg-arena-panel px-4 py-3 font-mono text-xs tracking-widest text-ink-muted">
                    username: {user?.username ?? "guest"}
                </div>
                <h1 className="text-3xl font-bold tracking-wide text-ink-white">Machiner</h1>
                <p className="mt-3 max-w-[560px] text-sm text-ink-muted">
                    Build a deterministic fighter brain, submit it to the server, and iterate through rated bot battles.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                    <button
                        onClick={() => navigate("/matchmaking")}
                        className="rounded bg-cyan-800 px-5 py-2 text-sm font-bold text-cyan-50 hover:bg-cyan-700"
                    >
                        START MATCHMAKING
                    </button>
                    <button
                        onClick={() => navigate("/beta")}
                        className="rounded border border-border-lo bg-zinc-900 px-5 py-2 text-sm font-bold text-ink-muted hover:text-ink-white"
                    >
                        OPEN BOT ROOM
                    </button>
                </div>
            </section>
        </main>
    );
}
