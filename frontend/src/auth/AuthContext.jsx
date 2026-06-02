import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./auth-context";
import { csrfHeaders } from "../security/csrf";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

async function authFetch(path, options = {}) {
    const method = options.method ?? "GET";
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...csrfHeaders(method),
            ...(options.headers ?? {}),
        },
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(body.message ?? `Request failed with ${response.status}`);
    }

    return body;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState({ authenticated: false, username: "guest" });
    const [isLoading, setIsLoading] = useState(true);

    const refreshUser = useCallback(async () => {
        try {
            const currentUser = await authFetch("/api/auth/me", { method: "GET" });
            setUser(currentUser);
            return currentUser;
        } catch {
            const guest = { authenticated: false, username: "guest" };
            setUser(guest);
            return guest;
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshUser();
    }, [refreshUser]);

    const login = useCallback(async ({ email, password }) => {
        const loggedInUser = await authFetch("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
        setUser(loggedInUser);
        return loggedInUser;
    }, []);

    const register = useCallback(async ({ email, username, password }) => {
        const registeredUser = await authFetch("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ email, username, password }),
        });
        setUser(registeredUser);
        return registeredUser;
    }, []);

    const logout = useCallback(async () => {
        const guest = await authFetch("/api/auth/logout", { method: "POST" });
        setUser(guest);
        return guest;
    }, []);

    const value = useMemo(() => ({
        user,
        isLoading,
        isAuthenticated: user?.authenticated === true,
        login,
        register,
        logout,
        refreshUser,
    }), [user, isLoading, login, register, logout, refreshUser]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
