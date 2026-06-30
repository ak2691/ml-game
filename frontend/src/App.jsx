import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import BetaModel from './beta/BetaModel'
import BaseModelViewer from './baseModels/BaseModelViewer'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import MatchmakingPage from './pages/MatchmakingPage'
import RegisterPage from './pages/RegisterPage'
import './App.css'


function App() {


  return (

    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
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
            path="/base-models"
            element={<BaseModelViewer />}
          />
          <Route
            path="/matchmaking"
            element={(
              <ProtectedRoute>
                <MatchmakingPage />
              </ProtectedRoute>
            )}
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
