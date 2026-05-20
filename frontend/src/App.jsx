import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import BetaModel from './beta/betamodel'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'


function App() {


  return (

    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BetaModel />} />

      </Routes>
    </BrowserRouter>
  )
}

export default App
