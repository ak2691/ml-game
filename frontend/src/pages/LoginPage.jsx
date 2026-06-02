import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import AuthLayout from "./AuthLayout";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function LoginPage() {
    const { isAuthenticated, isLoading, login } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (isAuthenticated) {
            navigate("/home", { replace: true });
        }
    }, [isAuthenticated, navigate]);

    if (!isLoading && isAuthenticated) {
        return <Navigate to="/home" replace />;
    }

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);

        if (!EMAIL_PATTERN.test(email.trim())) {
            setError("Enter a valid email address.");
            return;
        }
        if (password.length === 0) {
            setError("Enter your password.");
            return;
        }

        setIsSubmitting(true);
        try {
            await login({ email: email.trim(), password });
            navigate(location.state?.from?.pathname ?? "/home", { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AuthLayout
            title="Login"
            subtitle="Enter the arena with your saved fighter work."
            footer={<>No account yet? <Link className="text-cyan-300 hover:text-cyan-100" to="/register">Register</Link></>}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block text-left">
                    <span className="text-[11px] uppercase tracking-widest text-ink-muted">Email</span>
                    <input
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm text-ink-white outline-none focus:border-cyan-500"
                        autoComplete="email"
                    />
                </label>
                <label className="block text-left">
                    <span className="text-[11px] uppercase tracking-widest text-ink-muted">Password</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm text-ink-white outline-none focus:border-cyan-500"
                        autoComplete="current-password"
                    />
                </label>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded bg-cyan-800 px-4 py-2 text-sm font-bold text-cyan-50 hover:bg-cyan-700 disabled:opacity-60"
                >
                    {isSubmitting ? "LOGGING IN" : "LOGIN"}
                </button>
            </form>
        </AuthLayout>
    );
}
