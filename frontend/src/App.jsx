import { BrowserRouter, Routes, Route } from 'react-router-dom'
import BetaModel from './beta/BetaModel'
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
