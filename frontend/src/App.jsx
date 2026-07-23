import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import { loadBotRoom, loadMatchmaking, loadProfile } from './routeLoaders'
import './App.css'

const BetaModel = lazy(loadBotRoom)
const MatchmakingPage = lazy(loadMatchmaking)
const ProfilePage = lazy(loadProfile)
const TutorialPage = lazy(() => import('./tutorial/TutorialPage'))

function RouteLoadingFallback() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-arena-deep text-ink-muted">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-300" aria-hidden="true" />
      <p role="status" className="font-mono text-xs tracking-[0.25em]">LOADING ARENA...</p>
    </main>
  )
}

function App() {


  return (

    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/home"
              element={(
                <ProtectedRoute>
                  <HomePage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/beta"
              element={(
                <ProtectedRoute>
                  <BetaModel />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/tutorial"
              element={(
                <ProtectedRoute>
                  <TutorialPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/matchmaking"
              element={(
                <ProtectedRoute>
                  <MatchmakingPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/profile"
              element={(
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              )}
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
