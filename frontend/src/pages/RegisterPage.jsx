import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import AuthLayout from "./AuthLayout";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function RegisterPage() {
    const { isAuthenticated, isLoading, register } = useAuth();
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();

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
        if (username.trim().length < 3 || username.trim().length > 30) {
            setError("Username must be between 3 and 30 characters.");
            return;
        }
        if (password.length === 0) {
            setError("Enter a password.");
            return;
        }

        setIsSubmitting(true);
        try {
            await register({ email: email.trim(), username: username.trim(), password });
            navigate("/home", { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AuthLayout
            title="Register"
            subtitle="Create a pilot account for model submissions and match history."
            footer={<>Already registered? <Link className="text-cyan-300 hover:text-cyan-100" to="/login">Login</Link></>}
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
                    <span className="text-[11px] uppercase tracking-widest text-ink-muted">Username</span>
                    <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm text-ink-white outline-none focus:border-cyan-500"
                        autoComplete="username"
                    />
                </label>
                <label className="block text-left">
                    <span className="text-[11px] uppercase tracking-widest text-ink-muted">Password</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm text-ink-white outline-none focus:border-cyan-500"
                        autoComplete="new-password"
                    />
                </label>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded bg-cyan-800 px-4 py-2 text-sm font-bold text-cyan-50 hover:bg-cyan-700 disabled:opacity-60"
                >
                    {isSubmitting ? "REGISTERING" : "REGISTER"}
                </button>
            </form>
        </AuthLayout>
    );
}
