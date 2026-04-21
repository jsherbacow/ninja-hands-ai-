import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, Swords, Rocket, Puzzle, Zap } from 'lucide-react';

const GAMES = [
  {
    id: 'ninja',
    title: 'NINJA HANDS',
    description: 'Use your webcam to physically slice flying fruit!',
    path: '/play/ninja',
    icon: Swords,
    color: 'from-green-500 to-emerald-700',
    status: 'ACTIVE',
    badge: 'NEW',
  }
];

export default function Hub() {
  const navigate = useNavigate();

  return (
    <div className="w-full h-full min-h-screen bg-slate-950 text-white p-8 overflow-y-auto">
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent z-0" />

      {/* Header */}
      <div className="relative z-10 max-w-6xl mx-auto mb-12 mt-8 flex items-center justify-between">
        <div>
          <h1 className="text-5xl md:text-7xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]">
            COOL GAMING HUB
          </h1>
          <p className="text-blue-400 font-bold tracking-[0.3em] uppercase text-sm mt-2 ml-1">
            Browser Based Legends
          </p>
        </div>
        
        <div className="hidden md:flex items-center gap-4 text-slate-400">
           <div className="flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full border border-slate-800">
             <Gamepad2 className="w-5 h-5 text-purple-400" />
             <span className="font-bold">1 Game Active</span>
           </div>
        </div>
      </div>

      {/* Game Grid - Single card centered */}
      <div className="relative z-10 max-w-6xl mx-auto flex justify-center">
        {GAMES.map((game) => {
          const Icon = game.icon;
          const isActive = game.path !== '#';

          return (
            <button
              key={game.id}
              onClick={() => isActive && navigate(game.path)}
              disabled={!isActive}
              className="group relative text-left overflow-hidden rounded-3xl p-8 transition-all duration-300 cursor-pointer hover:scale-[1.02] active:scale-[0.98] w-full max-w-xl"
            >
              {/* Card Background gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${game.color} opacity-80 group-hover:opacity-100 transition-opacity`} />
              
              {/* Vignette / Darkener */}
              <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors" />

              {/* Content */}
              <div className="relative z-10 flex flex-col h-full justify-between min-h-[200px]">
                <div className="flex justify-between items-start">
                  <div className="bg-black/30 p-4 rounded-2xl backdrop-blur-sm border border-white/10 group-hover:scale-110 transition-transform origin-top-left">
                    <Icon className="w-10 h-10 text-white" />
                  </div>
                  
                  {game.badge && (
                    <span className="bg-yellow-400 text-black font-black uppercase tracking-widest text-xs px-3 py-1 rounded-full animate-pulse shadow-[0_0_10px_rgba(250,204,21,0.5)]">
                      {game.badge}
                    </span>
                  )}
                </div>

                <div className="mt-8">
                  <h2 className="text-4xl font-black italic tracking-tight mb-2 group-hover:translate-x-2 transition-transform">
                    {game.title}
                  </h2>
                  <p className="text-white/80 font-medium text-lg leading-snug max-w-sm group-hover:translate-x-2 transition-transform delay-75">
                    {game.description}
                  </p>
                </div>
                
                {/* Status Indicator */}
                <div className="absolute bottom-8 right-8 flex items-center gap-2 font-bold tracking-widest text-xs uppercase text-white/50 bg-black/20 px-3 py-1.5 rounded-full backdrop-blur-sm">
                   {isActive ? (
                     <><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/> PLAY NOW</>
                   ) : (
                     <><div className="w-2 h-2 rounded-full bg-yellow-400"/> IN DEV</>
                   )}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      
      {/* Footer */}
      <div className="relative z-10 max-w-6xl mx-auto mt-16 text-center text-slate-500 text-sm font-bold tracking-widest uppercase">
        Ready for Vercel / GitHub Pages Deployment
      </div>
    </div>
  );
}
