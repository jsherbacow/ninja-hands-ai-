import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import NinjaGame from './components/NinjaGame';
import Hub from './pages/Hub';

export default function App() {
  return (
    <div className="w-full h-screen bg-slate-900 text-white overflow-hidden pointer-events-auto">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Hub />} />
          <Route path="/play/ninja" element={<NinjaGame />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}