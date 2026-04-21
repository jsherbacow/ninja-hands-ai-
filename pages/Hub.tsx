import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords, Zap, Shield, Target, Sparkles, LogIn, LogOut, User } from 'lucide-react';
import { motion } from 'motion/react';
import { auth, signInWithGoogle } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

export default function Hub() {
  const navigate = useNavigate();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Sign in failed", error);
    }
  };

  const handleSignOut = () => {
    auth.signOut();
  };

  return (
    <div className="relative w-full h-screen bg-slate-950 text-white overflow-hidden flex flex-col items-center justify-center font-sans">
      {/* Auth Header */}
      <div className="absolute top-0 right-0 p-6 z-50">
        {!loading && (
          user ? (
            <div className="flex items-center gap-4 bg-slate-900/80 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-xl">
              <div className="flex flex-col items-end leading-none">
                <span className="text-white font-bold text-sm tracking-tight">{user.displayName}</span>
                <button 
                  onClick={handleSignOut}
                  className="text-slate-500 hover:text-red-400 text-[10px] font-black uppercase tracking-widest mt-1 transition-colors"
                >
                  Sign Out
                </button>
              </div>
              <img 
                src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} 
                alt="Profile" 
                className="w-10 h-10 rounded-full border-2 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <button 
              onClick={handleSignIn}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-widest text-xs px-6 py-3 rounded-full transition-all hover:scale-105 active:scale-95 shadow-lg shadow-emerald-500/20"
            >
              <LogIn className="w-4 h-4" />
              Sign In
            </button>
          )
        )}
      </div>

      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-500/10 blur-[150px] rounded-full animate-pulse delay-1000" />
        
        {/* Animated Grid */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(to right, #1e293b 1px, transparent 1px), linear-gradient(to bottom, #1e293b 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(ellipse at center, black, transparent 80%)'
          }}
        />
      </div>

      {/* Content Container */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center text-center px-6 max-w-4xl"
      >
        {/* Decorative Icon */}
        <motion.div
           initial={{ scale: 0 }}
           animate={{ scale: 1, rotate: [0, 10, -10, 0] }}
           transition={{ 
             delay: 0.2,
             scale: { type: "spring", stiffness: 260, damping: 20 },
             rotate: { duration: 1, ease: "easeInOut" }
           }}
           className="mb-8"
        >
          <div className="bg-gradient-to-br from-emerald-400 to-teal-600 p-6 rounded-[2.5rem] shadow-[0_0_50px_rgba(52,211,153,0.3)] border border-emerald-300/20">
            <Swords className="w-16 h-16 text-white" strokeWidth={1.5} />
          </div>
        </motion.div>

        {/* Title Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <h1 className="text-7xl md:text-9xl font-black italic tracking-tighter mb-4 leading-none select-none">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-400 to-blue-500 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">
              NINJA
            </span>
            <br />
            <span className="text-white drop-shadow-[0_5px_15px_rgba(0,0,0,0.5)]">HANDS</span>
          </h1>
          
          <div className="flex items-center justify-center gap-2 mb-12">
            <div className="h-[2px] w-12 bg-gradient-to-r from-transparent to-emerald-500" />
            <span className="text-emerald-400 font-bold tracking-[0.4em] uppercase text-sm">
              The Path of the Shadow Blade
            </span>
            <div className="h-[2px] w-12 bg-gradient-to-l from-transparent to-emerald-500" />
          </div>
        </motion.div>

        {/* Main Action Card */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate('/play/ninja')}
          className="group relative"
        >
          {/* Glowing Shadow */}
          <div className="absolute inset-0 bg-emerald-500/30 blur-2xl group-hover:bg-emerald-400/40 transition-all rounded-3xl" />
          
          <div className="relative bg-slate-900/50 backdrop-blur-xl border border-white/10 p-1 bg-gradient-to-br from-white/10 to-transparent rounded-3xl overflow-hidden">
            <div className="bg-slate-900 py-6 px-12 rounded-[22px] flex items-center gap-6 border border-white/5">
              <div className="flex flex-col items-start leading-tight">
                <span className="text-emerald-400 font-black text-3xl italic tracking-tighter uppercase group-hover:translate-x-1 transition-transform">
                  Enter Dojo
                </span>
                <span className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">
                  Click to Activate Webcam
                </span>
              </div>
              <div className="bg-emerald-500 p-3 rounded-full group-hover:rotate-12 transition-transform">
                <Sparkles className="w-6 h-6 text-slate-950 fill-white/20" />
              </div>
            </div>
          </div>
        </motion.button>

        {/* Feature Highlights */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 w-full"
        >
          {[
            { icon: Zap, label: "AI Slicing" },
            { icon: Target, label: "Precise Tracking" },
            { icon: Shield, label: "Sensei Ready" },
            { icon: Sparkles, label: "Epic Effects" }
          ].map((feat, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-slate-900 border border-white/5 flex items-center justify-center text-slate-500 pulse">
                <feat.icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{feat.label}</span>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Decorative Accents */}
      <div className="absolute top-10 left-10 text-slate-800 font-black text-[10vw] select-none opacity-20 pointer-events-none">
        01
      </div>
      <div className="absolute bottom-10 right-10 text-slate-800 font-black text-[10vw] select-none opacity-20 pointer-events-none">
        DOJO
      </div>
    </div>
  );
}
