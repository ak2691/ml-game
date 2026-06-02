import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";

export default function ProtectedRoute({ children }) {
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();

    if (isLoading) {
        return (
            <div className="min-h-screen bg-arena-deep text-ink-muted flex items-center justify-center font-mono text-xs tracking-widest">
                LOADING SESSION
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    return children;
}
