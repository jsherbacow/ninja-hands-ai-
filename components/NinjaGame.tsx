import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HandLandmarker } from '@mediapipe/tasks-vision';
import { createHandLandmarker } from '../utils/handDetection';
import { Loader2, Camera, Play, RotateCcw, AlertCircle, Trophy, User, LogIn, LogOut, ArrowLeft, AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, signInWithGoogle, signOut, submitScore, getTopScores, LeaderboardEntry } from '../lib/firebase';
import { getSenseiCommentary } from '../lib/gemini';
import { User as FirebaseUser } from 'firebase/auth';

// --- Types ---

type GameState = 'home' | 'playing' | 'gameover';

interface Point {
  x: number;
  y: number;
}

interface Fruit {
  id: number;
  x: number;
  y: number;
  vx: number; // Velocity X
  vy: number; // Velocity Y
  emoji: string;
  radius: number;
  sliced: boolean;
  type: 'fruit' | 'bomb' | 'slowmo' | 'frenzy' | 'shield';
  life: number;
}

interface Notification {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number; // 1.0 to 0
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0 to 1
  color: string;
  size: number;
  angle: number;
  rotationSpeed: number;
  gravityMult?: number;
}

interface Splat {
  id: number;
  x: number;
  y: number;
  color: string;
  life: number; // 1.0 to 0
}

interface Avatar {
  id: string;
  name: string;
  emoji: string;
  color: string;
  personality: 'mean' | 'heroic' | 'calm' | 'sarcastic';
}

interface Blade {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

interface Region {
  name: string;
  fruits: string[];
  colors: [string, string]; // [inner, outer]
  accent: string;
}

// --- Game Constants ---
const REGIONS: Region[] = [
  { 
    name: "Zen Orchard", 
    fruits: ['🍎', '🍏', '🍌', '🍐', '🍊', '🍓'], 
    colors: ['#064e3b', '#022c22'],
    accent: 'text-emerald-500'
  },
  { 
    name: "Tropical Bay", 
    fruits: ['🍍', '🥥', '🥭', '🥝', '🍉', '🍋'], 
    colors: ['#1e3a8a', '#1e1b4b'],
    accent: 'text-blue-500'
  },
  { 
    name: "Shadow Peaks", 
    fruits: ['🍇', '🫐', '🍑', '🍒', '🍅', '🫒'], 
    colors: ['#4c1d95', '#2e1065'],
    accent: 'text-purple-500'
  },
  { 
    name: "Imperial Harvest", 
    fruits: ['🌽', '🥕', '🍆', '🫑', '🥦', '🧅'], 
    colors: ['#7c2d12', '#431407'],
    accent: 'text-orange-600'
  }
];

const AVATARS: Avatar[] = [
  { id: 'shadow', name: 'Shadow', emoji: '🥷', color: 'border-slate-800 bg-slate-900', personality: 'mean' },
  { id: 'spark', name: 'Spark', emoji: '🦊', color: 'border-orange-500 bg-orange-900/20', personality: 'heroic' },
  { id: 'zen', name: 'Zen', emoji: '🐼', color: 'border-blue-500 bg-blue-900/20', personality: 'calm' },
  { id: 'rogue', name: 'Rogue', emoji: '😼', color: 'border-purple-500 bg-purple-900/20', personality: 'sarcastic' }
];

const BLADES: Blade[] = [
  { id: 'sword', name: 'Katana', emoji: '🗡️', color: 'border-zinc-500 bg-zinc-900/40' },
  { id: 'star', name: 'Shuriken', emoji: '💠', color: 'border-cyan-500 bg-cyan-900/40' },
  { id: 'dragon', name: 'Dragon', emoji: '🐉', color: 'border-emerald-600 bg-emerald-900/40' },
  { id: 'funny', name: 'Baguette', emoji: '🥖', color: 'border-amber-600 bg-amber-900/40' }
];

const FRUIT_COLORS: Record<string, string> = {
  '🍎': '#ff4444', '🍏': '#a3e635', '🍌': '#facc15', '🍐': '#bef264', '🍊': '#fb923c', '🍓': '#f43f5e',
  '🍍': '#fef08a', '🥥': '#f8fafc', '🥭': '#fbbf24', '🥝': '#84cc16', '🍉': '#ef4444', '🍋': '#fde047',
  '🍇': '#a855f7', '🫐': '#3b82f6', '🍑': '#fca5a5', '🍒': '#dc2626', '🍅': '#ef4444', '🫒': '#65a30d',
  '🌽': '#eab308', '🥕': '#f97316', '🍆': '#8b5cf6', '🫑': '#22c55e', '🥦': '#16a34a', '🧅': '#f1f5f9'
};

const GRAVITY = 0.25;
const FRUIT_SPAWN_RATE = 60; // Frames between spawns
const BLADE_LENGTH = 7; // Shorter trail for performance
const BOMB = '💣';
const SPECIAL_FRUITS = {
  slowmo: '❄️',
  frenzy: '🔥',
  shield: '🛡️'
};
const BOMB_CHANCE = 0.15; 

const NinjaGame: React.FC = () => {
  const navigate = useNavigate();
  // UI State
  const [gameState, setGameState] = useState<GameState>('home');
  const [score, setScore] = useState(0);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [timeLeft, setTimeLeft] = useState(60);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [isPaused, setIsPaused] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [senseiComment, setSenseiComment] = useState<string>("");
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar>(AVATARS[0]);
  const [selectedBlade, setSelectedBlade] = useState<Blade>(BLADES[0]);
  const [avatarComment, setAvatarComment] = useState<string>("Ready, Ninja?");
  const [showRegionCutscene, setShowRegionCutscene] = useState(false);
  const [showBombExplosion, setShowBombExplosion] = useState(false);
  const [transitionRegion, setTransitionRegion] = useState<Region>(REGIONS[0]);
  const commentTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const consecutiveSlicesRef = useRef(0);

  // Refs for Game Loop & Physics (Mutable state without re-renders)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number>();
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Game State Ref (Crucial for avoiding stale closures in the loop)
  const gameStateRef = useRef<GameState>('home');
  const isTransitioningRef = useRef(false);
  const isPausedRef = useRef(false);
  
  // Game Entities Refs
  const fruitsRef = useRef<Fruit[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const bladePathRef = useRef<Point[]>([]);
  const frameCountRef = useRef(0);
  const scoreRef = useRef(0);
  const levelRef = useRef(1);
  const comboRef = useRef(0);
  const comboResetTimerRef = useRef<number | null>(null);
  const timeScaleRef = useRef(1.0);
  const hasShieldRef = useRef(false);
  const notificationsRef = useRef<Notification[]>([]);
  const splatsRef = useRef<Splat[]>([]);
  const handAngleRef = useRef(0);
  const isHandVisibleRef = useRef(false);
  const handPosRef = useRef<Point>({ x: -1, y: -1 });
  const cachedGradientRef = useRef<CanvasGradient | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const shakeRef = useRef(0);
  const hitstopFramesRef = useRef(0);
  
  // Sync gameState state with ref
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      setUser(u);
    });
    // Initial leaderboard fetch
    getTopScores(5).then(setLeaderboard);
    return unsub;
  }, []);

  // Sync gameState state with ref
  useEffect(() => {
    gameStateRef.current = gameState;
    if (gameState === 'home') {
      getTopScores(5).then(setLeaderboard);
    }
  }, [gameState]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  
  // 1. Initialization: Load AI Model and Setup Camera
  const handleEnableCamera = async () => {
    setIsInitializing(true);
    setErrorMessage(null);
    
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support webcam access.");
      }

      // Load MediaPipe Hand Landmarker if not loaded
      if (!landmarkerRef.current) {
        landmarkerRef.current = await createHandLandmarker();
      }
      
      // Setup Webcam
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 }, 
          facingMode: "user" 
        } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise((resolve) => {
          if (videoRef.current) {
            videoRef.current.onloadedmetadata = resolve;
          }
        });
        // Explicitly play the video
        await videoRef.current.play().catch(e => console.error("Video play failed", e));
      }
      
      setIsInitializing(false);
      startGame();
    } catch (err: any) {
      console.error("Initialization error:", err);
      setErrorMessage(err.message || "Camera access failed.");
      setIsInitializing(false);
      setGameState('home');
    }
  };

  useEffect(() => {
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 2. Game Logic Helper Functions

  const spawnFruit = (width: number, height: number) => {
    // Determine region based on level (changes every 2 levels)
    const regionIdx = Math.min(Math.floor((levelRef.current - 1) / 2), REGIONS.length - 1);
    const region = REGIONS[regionIdx];

    // Increase bomb chance with level - starting at 18% for level 1
    const currentBombChance = Math.min(0.18 + (levelRef.current - 1) * 0.05, 0.45);
    const rng = Math.random();
    
    let type: Fruit['type'] = 'fruit';
    let emoji = region.fruits[Math.floor(Math.random() * region.fruits.length)];
    
    if (rng < currentBombChance) {
      type = 'bomb';
      emoji = BOMB;
    } else if (rng < currentBombChance + 0.05) { // 5% chance for special
      const specialRng = Math.random();
      if (specialRng < 0.33) {
        type = 'slowmo';
        emoji = SPECIAL_FRUITS.slowmo;
      } else if (specialRng < 0.66) {
        type = 'frenzy';
        emoji = SPECIAL_FRUITS.frenzy;
      } else {
        type = 'shield';
        emoji = SPECIAL_FRUITS.shield;
      }
    }

    const radius = 30;
    
    // Spawn at bottom, random X
    const x = Math.random() * (width - 100) + 50;
    const y = height + 50;
    
    // Scale velocity with level
    const velocityScale = 1 + (levelRef.current - 1) * 0.15;
    const vx = (Math.random() - 0.5) * 8 * velocityScale; 
    const vy = -(Math.random() * 8 + 12) * velocityScale; // Upward velocity

    fruitsRef.current.push({
      id: Date.now() + Math.random(),
      x, y, vx, vy,
      emoji,
      radius,
      sliced: false,
      type,
      life: 1.0
    });
  };

  const createExplosion = (x: number, y: number, color: string, count: number = 10, ignoreLimit: boolean = false) => {
    // Optimization: limit total active particles
    if (!ignoreLimit && particlesRef.current.length > 80) return;

    for (let i = 0; i < count; i++) {
        const speed = Math.random() * 8 + 4;
        const angle = Math.random() * Math.PI * 2;
      particlesRef.current.push({
        id: Math.random(),
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color,
        size: Math.random() * 6 + 2,
        angle: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2,
        gravityMult: 1.0
      });
    }
    shakeRef.current = 15;
  };

  const createEnvironmentalParticles = () => {
    // Optimization: limit total active particles
    if (particlesRef.current.length > 100 || Math.random() > 0.3) return; 

    const regionIdx = Math.min(Math.floor((levelRef.current - 1) / 2), REGIONS.length - 1);
    const region = REGIONS[regionIdx];
    const canvas = canvasRef.current;
    if (!canvas) return;

    let color = '#fff';
    if (region.name === "Zen Orchard") color = '#fecdd3'; // Pink blossoms
    if (region.name === "Tropical Bay") color = '#7dd3fc'; // Blue sparkles
    if (region.name === "Shadow Peaks") color = '#d8b4fe'; // Purple mist
    if (region.name === "Imperial Harvest") color = '#fbbf24'; // Golden leaves

    particlesRef.current.push({
        id: Math.random(),
        x: Math.random() * canvas.width,
        y: -20,
        vx: (Math.random() - 0.5) * 2,
        vy: Math.random() * 2 + 1,
        life: 1.0,
        color,
        size: Math.random() * 4 + 2,
        angle: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.05,
        gravityMult: 0.1 // Environment particles float more
    });
  };

  const createJuice = (x: number, y: number, color: string) => {
    // Optimization: limit juice if too many particles
    if (particlesRef.current.length > 100) return;
    
    for (let i = 0; i < 8; i++) {
        const speed = Math.random() * 6 + 2;
        const angle = Math.random() * Math.PI * 2;
        particlesRef.current.push({
            id: Math.random(),
            x, y,
            vx: Math.cos(angle) * speed,
            vy: (Math.random() - 0.7) * 10, // upward spray
            life: 0.8 + Math.random() * 0.4,
            color,
            size: Math.random() * 5 + 1,
            angle: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3,
            gravityMult: 1.0
        });
    }
    // Small flash at slice location
    particlesRef.current.push({
        id: Math.random(),
        x, y,
        vx: 0, vy: 0,
        life: 0.2,
        color: '#ffffff',
        size: 40,
        angle: 0,
        rotationSpeed: 0
    });
    shakeRef.current = Math.max(shakeRef.current, 8);
  };

  const addNotification = (x: number, y: number, text: string, color: string = '#fff') => {
    // Limit total notifications to prevent memory issues
    if (notificationsRef.current.length > 10) {
      notificationsRef.current.shift();
    }
    const newNotif = {
      id: Math.random(),
      x, y, text, color,
      life: 1.0
    };
    notificationsRef.current.push(newNotif);

    // Avatar Commentary Logic
    triggerAvatarComment('success', text);
  };

  const spawnBladeParticles = (x: number, y: number) => {
    // Only spawn a few particles per frame to avoid lag
    const count = 2;
    for (let i = 0; i < count; i++) {
        let color = '#fff';
        let size = 2;
        let vx = (Math.random() - 0.5) * 4;
        let vy = (Math.random() - 0.5) * 4;
        let life = 0.3 + Math.random() * 0.3;
        let gravityMult = 0.5;

        if (selectedBlade.id === 'star') {
            color = Math.random() > 0.5 ? '#22d3ee' : '#fff';
            size = 3;
        } else if (selectedBlade.id === 'dragon') {
            color = ['#f97316', '#ef4444', '#facc15'][Math.floor(Math.random() * 3)];
            size = Math.random() * 6 + 2;
            vy = -Math.random() * 5 - 2; // Flame rises
            gravityMult = -0.2; // Rises naturally
            life = 0.4 + Math.random() * 0.4;
        } else if (selectedBlade.id === 'funny') {
            color = ['#b45309', '#d97706', '#fcd34d'][Math.floor(Math.random() * 3)];
            size = Math.random() * 4 + 1;
            vy = Math.random() * 3 + 1; // Falling crumbs
            vx = (Math.random() - 0.5) * 2;
            gravityMult = 1.0;
        }

        particlesRef.current.push({
            id: Math.random(),
            x: x + (Math.random() - 0.5) * 10,
            y: y + (Math.random() - 0.5) * 10,
            vx, vy, life, color, size,
            angle: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.2,
            gravityMult
        });
    }
  };

  const triggerAvatarComment = (type: 'success' | 'failure' | 'neutral', event?: string) => {
    const p = selectedAvatar.personality;
    let comment = "";

    const comments = {
      success: {
        mean: ["Not bad.", "Keep that up.", "Hmph. Adequate.", "You have some potential."],
        heroic: ["YES! UNSTOPPABLE!", "THAT'S THE SPIRIT!", "ABSOLUTELY BRILLIANT!", "YOU'RE A NATURAL!"],
        calm: ["Good focus.", "Harmony in motion.", "Well placed.", "The blade is an extension of you."],
        sarcastic: ["Impressive, for a rookie.", "I like your style.", "Smooth move.", "Check you out!"]
      },
      failure: {
        mean: ["Pathetic.", "My eyes hurt watching you.", "Leave the dojo.", "Waste of time."],
        heroic: ["NOOOO!", "WAKE UP!", "THAT WAS TERRIBLE!", "FOCUS, NINJA, FOCUS!"],
        calm: ["Your mind is wandering.", "Focus is required.", "Breathe... you're off-balance.", "Sloppy."],
        sarcastic: ["Yikes.", "Was that a slice or a tickle?", "Maybe try closing your eyes next time?", "Embarrassing."]
      }
    };

    if (type === 'success') {
      const list = comments.success[p as keyof typeof comments.success];
      if (event?.includes('COMBO')) {
        comment = p === 'mean' ? "A decent combo. Finally." : 
                  p === 'heroic' ? "WHAT A COMBO!!! LEGENDARY!" : 
                  p === 'calm' ? "Excellent flow. Triple strike." :
                  "Triple threat! Look at you go.";
      } else {
        comment = list[Math.floor(Math.random() * list.length)];
      }
    } else if (type === 'failure') {
      const list = comments.failure[p as keyof typeof comments.failure];
      if (event?.includes('BOMB')) {
        comment = p === 'mean' ? "BOOM. You're a disgrace." :
                  p === 'heroic' ? "WATCH THE BOMBS!! NOOO!" :
                  p === 'calm' ? "You let your guards down. Distraction." :
                  "Boom. Well, that's one way to end a career.";
      } else {
        comment = list[Math.floor(Math.random() * list.length)];
      }
    }

    if (comment) {
      setAvatarComment(comment);
      if (commentTimeoutRef.current) clearTimeout(commentTimeoutRef.current);
      commentTimeoutRef.current = setTimeout(() => setAvatarComment(""), 3000);
    }
  };

  const handleMiss = () => {
    consecutiveSlicesRef.current = 0;
    triggerAvatarComment('failure', 'MISS');
  };

  const addSplat = (x: number, y: number, color: string) => {
    splatsRef.current.push({
      id: Math.random(),
      x, y, color,
      life: 1.0
    });
  };

  // 3. The Main Game Loop
  const loop = () => {
    // Schedule next frame immediately so errors don't stop the loop
    requestRef.current = requestAnimationFrame(loop);
    
    // Check against Ref to ensure we have the latest state inside the loop
    const currentState = gameStateRef.current;
    if (currentState !== 'playing' && currentState !== 'gameover') {
        cancelAnimationFrame(requestRef.current);
        return;
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (!canvas || !ctx || !video || !landmarker) return;

    // Wait until video has valid dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    // Calculate scaling to cover the canvas with the video (Object-Fit: Cover)
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const videoRatio = videoWidth / videoHeight;
    const canvasRatio = canvas.width / canvas.height;
    
    let drawW, drawH, drawX, drawY;
    
    if (videoRatio > canvasRatio) {
      drawH = canvas.height;
      drawW = canvas.height * videoRatio;
      drawX = (canvas.width - drawW) / 2;
      drawY = 0;
    } else {
      drawW = canvas.width;
      drawH = canvas.width / videoRatio;
      drawX = 0;
      drawY = (canvas.height - drawH) / 2;
    }

    // Check for hitstop
    if (hitstopFramesRef.current > 0) {
        hitstopFramesRef.current--;
        return;
    }

    // A. Detect Hands (Only if not paused and playing)
    let handX = -1;
    let handY = -1;
    
    if (!isPausedRef.current && currentState === 'playing' && !isTransitioningRef.current) {
      if (video.readyState >= 2) {
        let startTimeMs = performance.now();
        if (startTimeMs > lastVideoTimeRef.current) {
          lastVideoTimeRef.current = startTimeMs;
          try {
            const results = landmarker.detectForVideo(video, startTimeMs);
            
            if (results.landmarks && results.landmarks.length > 0) {
              isHandVisibleRef.current = true;
              // Get Index Finger Tip (Landmark 8) and Base (Landmark 5)
              const hand = results.landmarks[0];
              const indexTip = hand[8];
              const indexBase = hand[5];
              
              // Convert normalized coordinates (0-1) to canvas coordinates using cover scale
              // Ensure we mirror it if the video feed is mirrored
              handX = drawX + (1 - indexTip.x) * drawW;
              handY = drawY + indexTip.y * drawH;

              const baseX = drawX + (1 - indexBase.x) * drawW;
              const baseY = drawY + indexBase.y * drawH;

              // Calculate angle of the finger
              handAngleRef.current = Math.atan2(handY - baseY, handX - baseX) + Math.PI / 2;
              handPosRef.current = { x: handX, y: handY };

              // Update Blade Path
              bladePathRef.current.push({ x: handX, y: handY });
              if (bladePathRef.current.length > BLADE_LENGTH) {
                bladePathRef.current.shift();
              }

              // Spawn Custom Blade Particles
              spawnBladeParticles(handX, handY);
            } else {
              isHandVisibleRef.current = false;
              // If no hand, shorten path gradually
              if (bladePathRef.current.length > 0) bladePathRef.current.shift();
            }
          } catch (e) {
            console.error("Hand tracking failed for this frame:", e);
            if (bladePathRef.current.length > 0) bladePathRef.current.shift();
          }
        }
      }
    } else if (isPausedRef.current || currentState !== 'playing') {
        // Gradually shorten blade if hand lost during pause/transition
        if (bladePathRef.current.length > 0) bladePathRef.current.shift();
    }

    // B. Clear & Update Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply Screen Shake
    if (shakeRef.current > 0) {
        ctx.save();
        const sx = (Math.random() - 0.5) * shakeRef.current;
        const sy = (Math.random() - 0.5) * shakeRef.current;
        ctx.translate(sx, sy);
        shakeRef.current *= 0.9;
        if (shakeRef.current < 0.1) shakeRef.current = 0;
    }

    // Dynamic Background Gradient (shifts with region)
    const regionIdx = Math.min(Math.floor((levelRef.current - 1) / 2), REGIONS.length - 1);
    const region = REGIONS[regionIdx];
    
    if (!cachedGradientRef.current) {
        const grad = ctx.createRadialGradient(
          canvas.width / 2, 
          canvas.height / 2, 
          0, 
          canvas.width / 2, 
          canvas.height / 2, 
          canvas.width
        );
        grad.addColorStop(0, region.colors[0]);
        grad.addColorStop(1, region.colors[1]);
        cachedGradientRef.current = grad;
    }
    ctx.fillStyle = cachedGradientRef.current;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // C. Draw Video Feed (Optional: Semi-transparent background)
    ctx.save();
    ctx.globalAlpha = 0.3;
    // Mirror the video by drawing with negative width from the offset position
    ctx.drawImage(video, canvas.width - drawX, drawY, -drawW, drawH);
    ctx.restore();

    // Visual indicator for tracking (Now drawn AFTER clear and video)
    if (handX !== -1 && handY !== -1) {
      ctx.save();
      ctx.fillStyle = 'rgba(34, 211, 238, 0.6)';
      ctx.beginPath();
      ctx.arc(handX, handY, 15, 0, Math.PI * 2);
      ctx.fill();
      // Outer glow ring
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(handX, handY, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Draw Splats
    for (let i = splatsRef.current.length - 1; i >= 0; i--) {
        const s = splatsRef.current[i];
        s.life -= 0.005;
        if (s.life <= 0) {
            splatsRef.current.splice(i, 1);
        } else {
            ctx.save();
            ctx.globalAlpha = s.life * 0.4;
            ctx.fillStyle = s.color;
            ctx.beginPath();
            // Procedural splat (cluster of circles)
            for(let j=0; j<6; j++) {
                const offX = Math.cos(j) * 20 * (1 - s.life);
                const offY = Math.sin(j) * 20 * (1 - s.life);
                ctx.arc(s.x + offX, s.y + offY, 15 * s.life, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.restore();
        }
    }

    if (currentState === 'gameover') {
       // Just keep drawing the last frame of background, but stop updates
       return; 
    }

    // Skip gameplay logic if transitioning or paused
    if (currentState === 'playing' && !isPausedRef.current && !isTransitioningRef.current) {
      // D. Update Physics & Draw Fruits
      // Use reverse loop to safely splice items
      for (let i = fruitsRef.current.length - 1; i >= 0; i--) {
        // Stop processing immediately if a level transition was triggered by a previous slice in this frame
        if (gameStateRef.current !== 'playing') break;

        const fruit = fruitsRef.current[i];
        if (!fruit) continue;
        
        // Apply Gravity with timeScale
        fruit.vy += GRAVITY * timeScaleRef.current;
        fruit.x += fruit.vx * timeScaleRef.current;
        fruit.y += fruit.vy * timeScaleRef.current;
        if (fruit.sliced) fruit.life -= 0.05 * timeScaleRef.current;

        // Draw Fruit
        ctx.save();
        ctx.translate(fruit.x, fruit.y);
        ctx.font = `${fruit.radius * 2}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (fruit.sliced) {
            // Draw two halves
            const sliceOffset = (1.0 - fruit.life) * 50; // Use a life property or frame count?
            // Fruit doesn't have life, I'll use a simple timer or just velocity
            // Let's use a simple horizontal separation
            
            // Left half
            ctx.save();
            ctx.translate(-sliceOffset, 0);
            ctx.rotate(-sliceOffset * 0.1);
            ctx.beginPath();
            ctx.rect(-fruit.radius * 2, -fruit.radius * 2, fruit.radius * 2, fruit.radius * 4);
            ctx.clip();
            ctx.fillText(fruit.emoji, 0, 0);
            ctx.restore();

            // Right half
            ctx.save();
            ctx.translate(sliceOffset, 0);
            ctx.rotate(sliceOffset * 0.1);
            ctx.beginPath();
            ctx.rect(0, -fruit.radius * 2, fruit.radius * 2, fruit.radius * 4);
            ctx.clip();
            ctx.fillText(fruit.emoji, 0, 0);
            ctx.restore();
        } else {
            ctx.fillText(fruit.emoji, 0, 0);
        }
        ctx.restore();

        // Remove if off screen or decayed
        if (fruit.y > canvas.height + 100 || (fruit.sliced && fruit.life <= 0)) {
          if (fruit.type === 'fruit' && !fruit.sliced) {
            handleMiss();
          }
          fruitsRef.current.splice(i, 1);
          continue;
        }

        // Check Collision with Blade
        if (!fruit.sliced && bladePathRef.current.length >= 2) {
          const tip = bladePathRef.current[bladePathRef.current.length - 1];
          const prev = bladePathRef.current[bladePathRef.current.length - 2];
          
          const dx = tip.x - fruit.x;
          const dy = tip.y - fruit.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Calculate speed of finger
          const speed = Math.sqrt(Math.pow(tip.x - prev.x, 2) + Math.pow(tip.y - prev.y, 2));

          // Hit detection
          if (dist < fruit.radius && speed > 5) {
            if (fruit.type === 'bomb') {
              if (hasShieldRef.current) {
                hasShieldRef.current = false;
                addNotification(fruit.x, fruit.y, 'SHIELD BROKEN!', '#ff0000');
                createExplosion(fruit.x, fruit.y, '#ff4444');
                fruitsRef.current.splice(i, 1);
              } else {
                handleGameOver();
              }
            } else {
              // Slice!
              scoreRef.current += 10;
              setScore(scoreRef.current);
              
              const fruitColor = FRUIT_COLORS[fruit.emoji] || '#ffffff';
              createJuice(fruit.x, fruit.y, fruitColor);
              addNotification(fruit.x, fruit.y, '+10', fruitColor);

              // Splat on background (Limit total splats)
              if (splatsRef.current.length > 15) {
                  splatsRef.current.shift();
              }
              splatsRef.current.push({
                  id: Math.random(),
                  x: fruit.x,
                  y: fruit.y,
                  color: fruitColor,
                  life: 1.0
              });

              fruit.sliced = true;
              fruit.vx *= 0.5;
              fruit.vy = -2;
              hitstopFramesRef.current = 3; // 3 frames of pause for impact

              consecutiveSlicesRef.current++;
              if (consecutiveSlicesRef.current % 5 === 0) {
                triggerAvatarComment('success', 'SLICE');
              }
              
              // Combo Logic
              comboRef.current++;
              if (comboResetTimerRef.current) clearTimeout(comboResetTimerRef.current);
              comboResetTimerRef.current = window.setTimeout(() => {
                if (comboRef.current > 1) {
                  const bonus = comboRef.current * 10;
                  scoreRef.current += bonus;
                  setScore(scoreRef.current);
                  addNotification(canvas.width / 2, canvas.height / 2, `COMBO BONUS +${bonus}`, '#ffff00');
                }
                comboRef.current = 0;
              }, 400); // 400ms window for combo

              if (comboRef.current >= 3) {
                addNotification(fruit.x, fruit.y - 40, `COMBO x${comboRef.current}!`, '#ffff00');
                // Combo Flash
                ctx.save();
                ctx.globalAlpha = 0.1;
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
              }

              // Special Effects
              if (fruit.type === 'slowmo') {
                timeScaleRef.current = 0.4;
                addNotification(canvas.width / 2, canvas.height / 2, 'SLOW MO!', '#00ffff');
                setTimeout(() => { 
                  timeScaleRef.current = 1.0; 
                }, 5000);
              } else if (fruit.type === 'frenzy') {
                addNotification(canvas.width / 2, canvas.height / 2, 'FRENZY!', '#ff4400');
                const frenzyTimer = setInterval(() => {
                  spawnFruit(canvas.width, canvas.height);
                }, 150);
                setTimeout(() => {
                  clearInterval(frenzyTimer);
                }, 3000);
              } else if (fruit.type === 'shield') {
                hasShieldRef.current = true;
                addNotification(fruit.x, fruit.y, 'SHIELD ON!', '#4ade80');
              }

              // Level progression logic: strict sequential thresholds
              if (scoreRef.current >= levelRef.current * 100) {
                startLevelTransition();
              }

              const splatColor = fruit.type === 'fruit' ? 'rgba(255, 255, 0, 0.6)' : 'rgba(0, 255, 255, 0.6)';
              addSplat(fruit.x, fruit.y, splatColor);
              createExplosion(fruit.x, fruit.y, fruit.type !== 'fruit' ? '#00ffff' : '#ffff00'); 
              // Remove fruit instantly
              fruitsRef.current.splice(i, 1);
            }
          }
        }
      }

      // E. Spawn New Fruits
      createEnvironmentalParticles();
      frameCountRef.current++;
      // Decrease spawn interval as level increases
      const spawnRate = Math.max(65 - (levelRef.current - 1) * 3, 25);
      if (frameCountRef.current % (Math.floor(spawnRate / timeScaleRef.current)) === 0) {
        spawnFruit(canvas.width, canvas.height);
      }

      // F. Update & Draw Particles
      // Iterate backwards to allow removal
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        if (!p) continue;
        p.x += p.vx * timeScaleRef.current;
        p.y += p.vy * timeScaleRef.current;
        p.vy += (GRAVITY * 0.5 * (p.gravityMult ?? 1.0)) * timeScaleRef.current;
        p.life -= 0.02 * timeScaleRef.current;

        if (p.life <= 0) {
          particlesRef.current.splice(i, 1);
        } else {
          p.angle += p.rotationSpeed * timeScaleRef.current;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.life;
          ctx.beginPath();
          // Draw a small square for bits, circle for juice
          if (p.size > 2) {
            ctx.rect(-p.size/2, -p.size/2, p.size, p.size);
          } else {
            ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.restore();
        }
      }

      // Update and Draw Notifications
      for (let i = notificationsRef.current.length - 1; i >= 0; i--) {
        const n = notificationsRef.current[i];
        n.y -= 1; // Float up
        n.life -= 0.01;
        if (n.life <= 0) {
          notificationsRef.current.splice(i, 1);
        } else {
          ctx.save();
          ctx.font = `bold ${20 + n.life * 8}px Inter`;
          ctx.fillStyle = n.color;
          ctx.globalAlpha = n.life;
          ctx.textAlign = 'center';
          ctx.fillText(n.text, n.x, n.y);
          ctx.restore();
        }
      }

      ctx.globalAlpha = 1.0;
    } else if (currentState === 'playing' && isPausedRef.current) {
       // While paused, still DRAW the static objects 
       for (const fruit of fruitsRef.current) {
         ctx.font = `${fruit.radius * 2}px Arial`;
         ctx.textAlign = "center";
         ctx.textBaseline = "middle";
         ctx.fillText(fruit.emoji, fruit.x, fruit.y);
       }
       for (const p of particlesRef.current) {
         ctx.fillStyle = p.color;
         ctx.globalAlpha = p.life;
         ctx.beginPath();
         ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
         ctx.fill();
       }
       ctx.globalAlpha = 1.0;
    }

    // G. Draw Blade Trail (Optimized)
    const path = bladePathRef.current;
    if (path.length > 2) {
      ctx.save();
      // Glow Sub-layer (Single pass)
      ctx.beginPath();
      ctx.strokeStyle = 'cyan';
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.3; // Lighter alpha is cheaper than heavy shadow
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();

      // Sharp Core (Tapered but simpler)
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff';
      for (let i = 1; i < path.length; i++) {
        ctx.lineWidth = 6 * (i / path.length);
        ctx.beginPath();
        ctx.moveTo(path[i-1].x, path[i-1].y);
        ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // H. Draw Visual Blade
    if (isHandVisibleRef.current && currentState === 'playing' && !isPausedRef.current) {
        drawBlade(ctx, handPosRef.current.x, handPosRef.current.y, handAngleRef.current);
    }

    if (shakeRef.current > 0) {
        ctx.restore();
    }
  };

  // 4. Game Control Functions
  const drawBlade = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) => {
    switch (selectedBlade.id) {
      case 'star': drawShuriken(ctx, x, y); break;
      case 'dragon': drawDragonBlade(ctx, x, y, angle); break;
      case 'funny': drawBaguette(ctx, x, y, angle); break;
      default: drawKatana(ctx, x, y, angle);
    }
  };

  const drawKatana = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(0.8, 0.8);

    // 1. Blade
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(5, 100, 10, 250);
    ctx.lineTo(-10, 250);
    ctx.quadraticCurveTo(-5, 100, 0, 0);
    ctx.closePath();

    const bladeGrad = ctx.createLinearGradient(-10, 0, 10, 0);
    bladeGrad.addColorStop(0, '#71717a');
    bladeGrad.addColorStop(0.3, '#f4f4f5');
    bladeGrad.addColorStop(0.7, '#a1a1aa');
    ctx.fillStyle = bladeGrad;
    ctx.fill();

    // Edge
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.quadraticCurveTo(-5, 100, -8, 250);
    ctx.stroke();

    // Guard
    ctx.beginPath();
    ctx.ellipse(0, 250, 30, 15, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#09090b';
    ctx.fill();
    ctx.strokeStyle = '#d4d4d8';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Handle
    ctx.fillStyle = '#450606';
    ctx.beginPath();
    ctx.roundRect(-12, 250, 24, 80, 5);
    ctx.fill();

    // Wrap
    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 2;
    for (let i = 260; i < 330; i += 12) {
      ctx.beginPath();
      ctx.moveTo(-12, i); ctx.lineTo(12, i + 10); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, i); ctx.lineTo(-12, i + 10); ctx.stroke();
    }

    // Polish Glow
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = 'cyan';
    ctx.beginPath();
    ctx.ellipse(0, 100, 20, 150, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawShuriken = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(frameCountRef.current * 0.4);
    
    for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-15, 40);
        ctx.lineTo(0, 70);
        ctx.lineTo(15, 40);
        ctx.closePath();

        const grad = ctx.createLinearGradient(-15, 0, 15, 70);
        grad.addColorStop(0, '#334155');
        grad.addColorStop(0.5, '#f8fafc');
        grad.addColorStop(1, '#64748b');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#020617';
    ctx.fill();
    ctx.stroke();
    
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(0, 0, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawDragonBlade = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(1.1, 1.1);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(40, 100, 60, 180, 20, 280);
    ctx.lineTo(-15, 280);
    ctx.bezierCurveTo(30, 200, 20, 100, 0, 0);
    ctx.closePath();

    const bladeGrad = ctx.createLinearGradient(0, 0, 40, 280);
    bladeGrad.addColorStop(0, '#065f46');
    bladeGrad.addColorStop(0.5, '#34d399');
    bladeGrad.addColorStop(1, '#064e3b');
    ctx.fillStyle = bladeGrad;
    ctx.fill();
    ctx.strokeStyle = '#6ee7b7';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(10, 60, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fde047';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-25, 280);
    ctx.lineTo(45, 280);
    ctx.lineTo(10, 310);
    ctx.closePath();
    ctx.fillStyle = '#fbbf24';
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-10, 280, 20, 70);
    ctx.restore();
  };

  const drawBaguette = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.roundRect(-20, 0, 40, 240, 20);
    const grad = ctx.createLinearGradient(-20, 0, 20, 0);
    grad.addColorStop(0, '#78350f');
    grad.addColorStop(0.5, '#f59e0b');
    grad.addColorStop(1, '#92400e');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 4;
    for (let i = 40; i < 220; i += 50) {
      ctx.beginPath();
      ctx.moveTo(-12, i);
      ctx.lineTo(12, i + 25);
      ctx.stroke();
    }
    ctx.restore();
  };

  const startGame = () => {
    // IMPORTANT: Set ref immediately so loop sees it
    gameStateRef.current = 'playing';
    setGameState('playing');
    setIsPaused(false);
    isTransitioningRef.current = false;
    
    setScore(0);
    setCurrentLevel(1);
    setTimeLeft(60);
    setSenseiComment("");
    
    // Reset Refs
    scoreRef.current = 0;
    levelRef.current = 1;
    fruitsRef.current = [];
    particlesRef.current = [];
    frameCountRef.current = 0;
    bladePathRef.current = [];
    timeScaleRef.current = 1.0;
    hasShieldRef.current = false;
    consecutiveSlicesRef.current = 0;
    cachedGradientRef.current = null;
    
    // Resize Canvas to Match Window
    if (canvasRef.current) {
      canvasRef.current.width = window.innerWidth;
      canvasRef.current.height = window.innerHeight;
    }

    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = requestAnimationFrame(loop);

    // Clear any existing timer
    if (timerRef.current) clearInterval(timerRef.current);

    // Start Timer
    timerRef.current = setInterval(() => {
      // Check ref, not state
      if (gameStateRef.current === 'gameover' || isTransitioningRef.current || isPausedRef.current) {
        return;
      }
      
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleGameOver();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const togglePause = () => {
    if (gameState !== 'playing') return;
    setIsPaused(prev => !prev);
  };

  const handleSignIn = async () => {
    try {
      setErrorMessage(null);
      await signInWithGoogle();
    } catch (error: any) {
      console.error("Sign in failed:", error);
      if (error.code === 'auth/popup-blocked') {
        setErrorMessage("Sign-in popup was blocked by your browser. Please allow popups for this site.");
      } else if (error.code === 'auth/unauthorized-domain') {
        setErrorMessage(`Authorization Error: The domain '${window.location.hostname}' is not authorized in your Firebase Project. Please add it to 'Authorized domains' in the Firebase Console.`);
      } else {
        setErrorMessage("Failed to sign in with Google: " + (error.message || "Unknown error"));
      }
    }
  };

  const handleSignOut = async () => {
    try {
      setErrorMessage(null);
      await signOut();
    } catch (error: any) {
      console.error("Sign out failed:", error);
      setErrorMessage("Failed to sign out: " + (error.message || "Unknown error"));
    }
  };

  const startLevelTransition = async () => {
    isTransitioningRef.current = true;
    isHandVisibleRef.current = false;

    // Check if new level is a region transition
    const nextLevelNum = levelRef.current + 1;
    const isNewRegion = nextLevelNum === 3 || nextLevelNum === 5 || nextLevelNum === 7;
    
    if (isNewRegion) {
        // Clear objects immediately so they don't show behind cutscene
        fruitsRef.current = [];
        particlesRef.current = [];
        bladePathRef.current = [];
        cachedGradientRef.current = null;
        
        const nextRegion = REGIONS[Math.floor((nextLevelNum - 1) / 2)];
        setTransitionRegion(nextRegion);
        setShowRegionCutscene(true);
        // Wait 2 seconds for cutscene
        await new Promise(resolve => setTimeout(resolve, 2000));
        setShowRegionCutscene(false);
    }

    setShowLevelUp(true);
    setCountdown(3);
    
    // Avatar Commentary
    triggerAvatarComment('success', 'LEVEL_UP');

    // Get AI sensei commentary
    getSenseiCommentary({ 
        score: scoreRef.current, 
        combo: comboRef.current, 
        level: levelRef.current, 
        state: 'level-up'
    }).then(setSenseiComment);

    // Increment level immediately so UI shows next level, but physics stops
    levelRef.current += 1;
    setCurrentLevel(levelRef.current);

    // Clear objects immediately for the transition screen
    fruitsRef.current = [];
    particlesRef.current = [];
    bladePathRef.current = [];
    
    const transitionInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(transitionInterval);
          isTransitioningRef.current = false;
          setShowLevelUp(false);
          beginNextLevel();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const beginNextLevel = () => {
    // Reset level specific state but Keep cumulative score
    fruitsRef.current = [];
    particlesRef.current = [];
    frameCountRef.current = 0;
    bladePathRef.current = []; // Clear old blade on level start
    
    // Hard reset timer to exactly 60 seconds
    setTimeLeft(60);
    
    gameStateRef.current = 'playing';
    setGameState('playing');
    
    // Ensure loop continues
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = requestAnimationFrame(loop);
  };

  const handleGameOver = async () => {
    // Immediate physics stop but keep drawing the explosion
    if (timerRef.current) clearInterval(timerRef.current);
    isTransitioningRef.current = true;
    
    // Trigger Full Screen Explosion Animation
    setShowBombExplosion(true);
    shakeRef.current = 50; // Mega shake
    
    // Physical Explosion on Canvas too
    const canvas = canvasRef.current;
    if (canvas) {
        createExplosion(canvas.width / 2, canvas.height / 2, '#ff0000', 50, true);
        createExplosion(canvas.width / 3, canvas.height / 3, '#ffaa00', 30, true);
        createExplosion(canvas.width * 0.7, canvas.height * 0.7, '#ffaa00', 30, true);
    }
    
    // Wait for the boom effect
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setShowBombExplosion(false);
    isHandVisibleRef.current = false;
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    if (requestRef.current) cancelAnimationFrame(requestRef.current);

    // Avatar Final Commentary
    triggerAvatarComment('failure', 'BOMB');

    // AI Commentary
    getSenseiCommentary({ 
        score: scoreRef.current, 
        combo: comboRef.current, 
        level: levelRef.current, 
        state: 'gameover'
    }).then(setSenseiComment);

    // Auto submit score if logged in
    if (user) {
        submitScore(scoreRef.current, levelRef.current);
    }
    
    // Refresh leaderboard
    getTopScores(5).then(setLeaderboard);
  };

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const renderHome = () => (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0a] text-white p-8 overflow-y-auto overflow-x-hidden">
      
      {/* --- DOJO ATMOSPHERE --- */}
      
      {/* Floor Depth */}
      <div className="absolute bottom-0 left-0 w-full h-[40%] bg-gradient-to-t from-[#1a110d] to-transparent z-0 opacity-60" />
      
      {/* Structural Slats (Shoji Style) */}
      <div className="absolute inset-0 z-0 opacity-10 flex justify-around pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="w-[1px] h-full bg-white/50 shadow-[0_0_20px_rgba(255,255,255,0.2)]" />
        ))}
      </div>

      {/* Radiant Glowing Points */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-green-500/5 blur-[120px] rounded-full pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none animate-pulse" style={{ animationDelay: '2s' }} />

      {/* Floating Zen Petals */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ 
              x: Math.random() * 100 + "%", 
              y: -50, 
              rotate: 0,
              opacity: Math.random() * 0.4 + 0.1
            }}
            animate={{ 
              y: "110vh", 
              x: (Math.random() * 100 - 50) + "%",
              rotate: 360 
            }}
            transition={{ 
              duration: 15 + Math.random() * 10, 
              repeat: Infinity, 
              ease: "linear",
              delay: Math.random() * 15
            }}
            className="absolute w-2 h-2 bg-pink-200/30 rounded-full blur-[1px]"
          />
        ))}
      </div>

      {/* --- DOJO CONTENT --- */}

      <button 
        onClick={() => navigate('/')}
        className="absolute top-6 left-6 p-4 flex items-center justify-center gap-2 bg-slate-900/80 hover:bg-slate-800 rounded-full transition-all hover:scale-110 font-bold text-slate-400 border border-white/5 shadow-2xl z-[60] pointer-events-auto"
      >
         <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="relative z-10 w-full max-w-4xl flex flex-col items-center pt-8 pb-12">
        <motion.h1 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-7xl font-black mb-12 text-green-400 drop-shadow-[0_0_15px_rgba(74,222,128,0.4)] tracking-tighter text-center"
        >
          NINJA HANDS
        </motion.h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full">
          {/* Left Column: Selection */}
          <div className="space-y-6">
            {/* Avatar Selection */}
            <section className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-[2rem] border border-white/5 shadow-2xl">
              <h3 className="text-center text-slate-500 font-black uppercase tracking-[0.4em] text-[10px] mb-6">Choose Your Sensei</h3>
              <div className="grid grid-cols-4 gap-3">
                {AVATARS.map((avatar) => (
                  <button
                    key={avatar.id}
                    onClick={() => setSelectedAvatar(avatar)}
                    className={`
                      flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all hover:scale-105
                      ${selectedAvatar.id === avatar.id 
                        ? `${avatar.color} border-current shadow-[0_0_20px_rgba(255,255,255,0.05)]` 
                        : 'bg-black/40 border-transparent text-slate-500'}
                    `}
                  >
                    <span className="text-3xl drop-shadow-xl">{avatar.emoji}</span>
                    <span className="text-[9px] font-black uppercase tracking-tighter">{avatar.name}</span>
                  </button>
                ))}
              </div>
              <p className="text-center text-[11px] text-slate-400 mt-5 italic font-medium opacity-80">
                &ldquo;{selectedAvatar.personality === 'mean' && "Shadow will not be impressed easily."}
                {selectedAvatar.personality === 'heroic' && "Spark will cheer you to greatness!"}
                {selectedAvatar.personality === 'calm' && "Zen brings focus to the chaos."}
                {selectedAvatar.personality === 'sarcastic' && "Rogue has seen better ninjas."}&rdquo;
              </p>
            </section>

            {/* Blade Selection */}
            <section className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-[2rem] border border-white/5 shadow-2xl">
              <h3 className="text-center text-slate-500 font-black uppercase tracking-[0.4em] text-[10px] mb-6">Steel Your Blade</h3>
              <div className="grid grid-cols-4 gap-3">
                {BLADES.map((blade) => (
                  <button
                    key={blade.id}
                    onClick={() => setSelectedBlade(blade)}
                    className={`
                      flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all hover:scale-105
                      ${selectedBlade.id === blade.id 
                        ? `${blade.color} border-current shadow-[0_0_20px_rgba(255,255,255,0.05)]` 
                        : 'bg-black/40 border-transparent text-slate-500'}
                    `}
                  >
                    <span className="text-3xl drop-shadow-xl group-hover:rotate-12 transition-transform">{blade.emoji}</span>
                    <span className="text-[9px] font-black uppercase tracking-tighter">{blade.name}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column: Community & Auth */}
          <div className="space-y-6">
            {/* Leaderboard */}
            <section className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-[2rem] border border-white/5 shadow-2xl min-h-[200px]">
              <h3 className="text-center text-green-500/80 font-black uppercase tracking-[0.4em] text-[10px] mb-6 flex items-center justify-center gap-2">
                <Trophy className="w-3 h-3" /> Hall of Fame
              </h3>
              <div className="space-y-3">
                {leaderboard.length > 0 ? (
                  leaderboard.map((entry, idx) => (
                    <div key={idx} className="flex justify-between items-center group">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black text-slate-600">0{idx + 1}</span>
                        <span className="font-bold text-sm text-slate-200 group-hover:text-white transition-colors">{entry.displayName}</span>
                      </div>
                      <span className="font-mono text-xs text-green-400/80 tabular-nums">{entry.score.toLocaleString()}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 opacity-20">
                    <Trophy className="w-8 h-8 mb-2" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Awaiting legends...</span>
                  </div>
                )}
              </div>
            </section>

            {/* Auth Panel */}
            <section className="bg-white/[0.03] backdrop-blur-xl p-6 rounded-[2rem] border border-white/5 shadow-2xl">
              {!user ? (
                <div className="space-y-4">
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="GUEST NAME" 
                      className="w-full bg-black/40 border border-white/5 p-4 rounded-xl text-center text-sm font-bold uppercase tracking-widest outline-none focus:border-green-500/30 focus:bg-black/60 transition-all" 
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                    />
                  </div>
                  <button 
                    onClick={handleSignIn} 
                    className="w-full h-14 bg-white text-black rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:bg-slate-200 transition-all hover:scale-[1.02] shadow-xl"
                  >
                    <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="G" />
                    Sign in for leaderboard
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-4 bg-black/40 p-4 rounded-2xl border border-white/5">
                  <div className="relative">
                    <img 
                      src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                      alt="User" 
                      className="w-12 h-12 rounded-full border-2 border-green-500/50 shadow-lg"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-[#0a0a0a]" />
                  </div>
                  <div className="flex flex-col flex-1 overflow-hidden">
                    <span className="font-black text-green-400 text-sm truncate uppercase tracking-tight">{user.displayName}</span>
                    <button 
                      onClick={handleSignOut}
                      className="text-slate-500 text-[10px] text-left hover:text-red-400 font-bold uppercase tracking-[0.2em] flex items-center gap-1 transition-colors mt-1"
                    >
                      <LogOut className="w-3 h-3" />
                      Leave Dojo
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Start Button */}
        <div className="mt-12 group">
          <button
            onClick={() => handleEnableCamera()}
            className="relative px-20 py-6 bg-green-500 rounded-full overflow-hidden transition-all duration-300 hover:scale-105 active:scale-95 shadow-[0_0_40px_rgba(34,197,94,0.3)] hover:shadow-[0_0_60px_rgba(34,197,94,0.5)]"
          >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <span className="relative z-10 text-black font-black text-3xl tracking-tighter uppercase italic">
              Enter Dojo
            </span>
          </button>
          <div className="mt-4 text-center">
            <span className="text-slate-600 text-[10px] font-black uppercase tracking-[0.4em] animate-pulse">
              Ready your hands...
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative w-full h-full font-sans bg-slate-900 overflow-hidden">
      {gameState === 'home' && renderHome()}

      {/* 
        Video MUST be rendered for MediaPipe to work. 
        We use opacity-0 and z-index -10 so it's technically "visible" to the DOM/JS 
        but invisible to the user, allowing correct detection. 
      */}
      <video 
        ref={videoRef} 
        className="absolute top-0 left-0 w-full h-full object-cover opacity-0 pointer-events-none -z-10"
        autoPlay 
        playsInline 
        muted
      />

      {/* Error Message Top Display */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[300] bg-red-600/90 text-white px-8 py-4 rounded-2xl shadow-2xl backdrop-blur-md border border-white/20 max-w-lg w-[90%] flex items-center gap-4"
          >
            <div className="bg-white/20 p-2 rounded-full">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h4 className="font-black text-sm uppercase tracking-wider mb-1">System Error</h4>
              <p className="text-sm font-medium leading-tight">{errorMessage}</p>
            </div>
            <button onClick={() => setErrorMessage(null)} className="hover:bg-white/20 p-2 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game Canvas */}
      <canvas 
        ref={canvasRef} 
        className="block absolute top-0 left-0 w-full h-full cursor-none"
      />

      {/* --- UI OVERLAYS --- */}

      {/* HUD (Heads Up Display) */}
      {(gameState === 'playing' || gameState === 'gameover') && (
        <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-30 pointer-events-none">
          <div className="flex gap-8 items-center">
            {/* Avatar Corner */}
            <div className="flex items-center gap-4 relative">
               <div className={`
                 w-20 h-20 rounded-2xl border-2 flex items-center justify-center text-4xl shadow-2xl relative
                 ${selectedAvatar.color}
               `}>
                 {selectedAvatar.emoji}
                 {/* Talking Bubble */}
                 <AnimatePresence>
                   {avatarComment && (
                     <motion.div 
                       initial={{ opacity: 0, x: -10, scale: 0.8 }}
                       animate={{ opacity: 1, x: 0, scale: 1 }}
                       exit={{ opacity: 0, scale: 0.8 }}
                       className="absolute left-full ml-4 top-0 bg-white text-slate-900 p-3 rounded-2xl rounded-tl-none font-bold text-sm w-48 shadow-xl z-[60]"
                     >
                        <div className="absolute -left-2 top-0 w-0 h-0 border-t-8 border-t-white border-l-8 border-l-transparent" />
                        {avatarComment}
                     </motion.div>
                   )}
                 </AnimatePresence>
               </div>
               <div className="flex flex-col">
                  <span className="text-white font-black italic text-xl tracking-tighter leading-none">{selectedAvatar.name}</span>
                  <span className="text-white/40 text-[10px] font-black uppercase tracking-widest">{selectedAvatar.personality} sensei</span>
               </div>
            </div>

            {/* Region HUD */}
            <div className="flex flex-col ml-8">
              <span className="text-white/30 text-[10px] font-black uppercase tracking-widest leading-none mb-1">Region</span>
              <span className={`font-black italic text-2xl tracking-tighter ${REGIONS[Math.min(Math.floor((currentLevel - 1) / 2), REGIONS.length - 1)].accent}`}>
                {REGIONS[Math.min(Math.floor((currentLevel - 1) / 2), REGIONS.length - 1)].name}
              </span>
            </div>

            <div className="flex flex-col ml-8">
              <span className="text-yellow-400 font-black text-4xl drop-shadow-md">
                {score}
              </span>
              <span className="text-slate-400 text-sm font-bold uppercase tracking-widest textShadow">Score</span>
            </div>

            <div className="flex flex-col">
              <span className="text-cyan-400 font-black text-4xl drop-shadow-md">
                {currentLevel}
              </span>
              <span className="text-slate-400 text-sm font-bold uppercase tracking-widest textShadow">Level</span>
            </div>
          </div>
          
          <div className="flex gap-6 items-center pointer-events-auto">
             <button 
                onClick={togglePause}
                className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full border border-white/20 text-white transition-all transform hover:scale-110"
                title={isPaused ? "Resume" : "Pause"}
             >
                {isPaused ? (
                  <Play className="w-6 h-6 fill-current" />
                ) : (
                  <div className="flex gap-0.5">
                    <div className="w-2 h-6 bg-white rounded-sm" />
                    <div className="w-2 h-6 bg-white rounded-sm" />
                  </div>
                )}
             </button>

             <div className="flex flex-col items-end pointer-events-none">
               <span className={`font-black text-4xl drop-shadow-md ${timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                {timeLeft}
              </span>
              <span className="text-slate-400 text-sm font-bold uppercase tracking-widest textShadow">Time</span>
            </div>
          </div>
        </div>
      )}

      {/* Pause Overlay */}
      {isPaused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 z-50 backdrop-blur-md animate-in fade-in duration-300">
          <h2 className="text-6xl font-black text-white mb-8 tracking-tighter drop-shadow-2xl italic">
            GAME PAUSED
          </h2>
          <button 
            onClick={togglePause}
            className="flex items-center gap-3 px-10 py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-full font-black text-2xl hover:brightness-110 active:scale-95 transition-all shadow-xl shadow-cyan-500/20"
          >
            <Play className="w-8 h-8 fill-current" />
            RESUME
          </button>
        </div>
      )}

      {/* Transition Overlay (Level Up) */}
      {/* Region Cutscene Overlay */}
      <AnimatePresence>
        {showBombExplosion && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: 1,
              x: [0, -10, 10, -10, 10, 0], // UI Rumble
              y: [0, 5, -5, 5, -5, 0]
            }}
            transition={{ duration: 0.2, repeat: 10 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[200] pointer-events-none flex flex-col items-center justify-end overflow-hidden"
          >
            {/* 1. Initial Blinding Plasma Flash */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 0.5, times: [0, 0.2, 1] }}
              className="absolute inset-0 bg-white"
            />

            {/* 2. Intense Heat distortion / Red Vignette */}
            <motion.div 
              animate={{ 
                opacity: [0, 0.8, 0],
                backgroundColor: ['rgba(127,29,29,0)', 'rgba(127,29,29,0.5)', 'rgba(127,29,29,0)']
              }}
              transition={{ duration: 0.2, repeat: 4 }}
              className="absolute inset-0 shadow-[inset_0_0_300px_rgba(220,38,38,1)]"
            />

            {/* 3. Plasma Expansion Ring */}
            <motion.div 
               initial={{ scale: 0, opacity: 1, borderWidth: 100 }}
               animate={{ scale: 5, opacity: 0, borderWidth: 0 }}
               transition={{ duration: 0.8, ease: "easeOut" }}
               className="absolute w-64 h-64 border-white border-solid rounded-full z-[210] blur-sm"
            />

            {/* 4. Rising Embers (UI Particles) */}
            <div className="absolute inset-x-0 bottom-0 top-0 overflow-hidden">
               {[...Array(20)].map((_, i) => (
                 <motion.div
                   key={i}
                   initial={{ 
                     x: `${Math.random() * 100}%`, 
                     y: "110%", 
                     scale: Math.random() * 2 + 1,
                     opacity: 0 
                   }}
                   animate={{ 
                     y: "-10%", 
                     x: `${(Math.random() * 100) + (Math.random() - 0.5) * 20}%`,
                     opacity: [0, 1, 0] 
                   }}
                   transition={{ 
                     duration: 1.5 + Math.random(), 
                     delay: Math.random() * 1,
                     repeat: Infinity
                   }}
                   className="absolute w-2 h-2 bg-yellow-500 rounded-full blur-[1px]"
                 />
               ))}
            </div>

            {/* THE VOLUMETRIC MUSHROOM CLOUD */}
            <div className="relative bottom-0 flex flex-col items-center w-full">
              
              {/* Stem (Central Column) */}
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "65vh", opacity: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="w-32 bg-gradient-to-t from-red-900 via-orange-500 to-yellow-200 blur-md rounded-full relative z-10"
              >
                {/* Plasma core in stem */}
                <motion.div 
                   animate={{ opacity: [0.3, 0.8, 0.3], scaleX: [0.8, 1, 0.8] }}
                   transition={{ duration: 0.15, repeat: Infinity }}
                   className="absolute inset-0 bg-white/40 blur-lg" 
                />
              </motion.div>

              {/* Billowing Cap Structure */}
              <div className="absolute top-0 -translate-y-1/2 flex items-center justify-center">
                 
                 {/* Core fireball */}
                 <motion.div 
                    initial={{ scale: 0.2, opacity: 0, y: 150 }}
                    animate={{ scale: [0.2, 4], opacity: [0, 1, 0.9], y: 0 }}
                    transition={{ duration: 0.5, ease: "circOut" }}
                    className="w-72 h-56 bg-gradient-to-b from-yellow-200 via-orange-500 to-red-950 rounded-[50%] blur-2xl relative z-20"
                 />

                 {/* Smoke Layers (Outer) */}
                 {[0, 60, 120, 180, 240, 300].map((angle, i) => (
                   <motion.div 
                    key={i}
                    initial={{ scale: 0.1, x: 0, y: 100, opacity: 0 }}
                    animate={{ 
                      scale: 3 + Math.random(), 
                      x: Math.cos(angle * Math.PI / 180) * 350, 
                      y: Math.sin(angle * Math.PI / 180) * 150,
                      opacity: [0, 0.9, 0.2] 
                    }}
                    transition={{ duration: 0.8, delay: 0.05 + i * 0.03, ease: "easeOut" }}
                    className="absolute w-56 h-48 bg-slate-900/90 rounded-full blur-3xl mix-blend-multiply"
                   />
                 ))}

                 {/* Ground Fire Reflection (Expanding) */}
                 <motion.div 
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 15, opacity: [0, 1, 0] }}
                    transition={{ duration: 1.0, ease: "easeOut" }}
                    className="absolute bottom-[-100px] w-40 h-10 bg-orange-500/30 rounded-full blur-[100px]"
                 />
              </div>

              {/* Dust Shockwave */}
              <motion.div 
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 18, opacity: [0, 1, 0] }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="absolute bottom-0 w-40 h-8 border-[15px] border-slate-400/20 rounded-[50%] blur-lg"
              />
            </div>

            {/* Impact Text */}
            <motion.div
               initial={{ scale: 0, y: 100 }}
               animate={{ scale: [0, 1.4, 1.2], y: 0 }}
               transition={{ duration: 0.5, delay: 0.1 }}
               className="absolute top-[20%] z-[300]"
            >
               <div className="relative">
                  <h2 className="text-9xl font-black text-red-600 italic tracking-tighter filter blur-[1px]">BOOM!</h2>
                  <h2 className="text-9xl font-black text-white italic tracking-tighter absolute inset-0 -translate-x-1 -translate-y-1">BOOM!</h2>
               </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRegionCutscene && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] flex flex-col items-center justify-center text-white p-6 text-center"
            style={{ 
              background: `radial-gradient(circle at center, ${transitionRegion.colors[0]}, ${transitionRegion.colors[1]})` 
            }}
          >
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', damping: 10, stiffness: 100 }}
              className="relative mb-12"
            >
              <div className="absolute inset-0 blur-3xl opacity-30 animate-pulse bg-white rounded-full scale-150" />
              {transitionRegion.name === "Zen Orchard" && <Trees className="w-56 h-56 text-emerald-400 relative z-10 drop-shadow-[0_0_20px_rgba(52,211,153,0.5)]" />}
              {transitionRegion.name === "Tropical Bay" && (
                <div className="relative z-10 flex flex-col items-center">
                  <Palmtree className="w-56 h-56 text-blue-400 drop-shadow-[0_0_30px_rgba(96,165,250,0.6)]" />
                  <span className="text-8xl absolute -bottom-4 -right-4">🏝️</span>
                </div>
              )}
              {transitionRegion.name === "Shadow Peaks" && <Mountain className="w-56 h-56 text-purple-400 relative z-10 drop-shadow-[0_0_30px_rgba(192,132,252,0.6)]" />}
              {transitionRegion.name === "Imperial Harvest" && (
                <div className="relative z-10 flex flex-col items-center">
                  <Sun className="w-56 h-56 text-orange-400 drop-shadow-[0_0_30px_rgba(251,146,60,0.6)]" />
                  <span className="text-8xl absolute -bottom-4 -left-4">⛩️</span>
                </div>
              )}
            </motion.div>

            <div className="relative">
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-white/40 text-xl font-black uppercase tracking-[1em] mb-4 drop-shadow-md"
              >
                Entering
              </motion.p>
              
              <motion.h2 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, type: 'spring' }}
                className="text-7xl md:text-9xl font-black italic tracking-tighter drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] mb-8"
              >
                {transitionRegion.name}
              </motion.h2>

              <div className="flex justify-center gap-4">
                 {[1,2,3].map(i => (
                   <motion.div 
                     key={i}
                     initial={{ scaleX: 0 }}
                     animate={{ scaleX: 1 }}
                     transition={{ delay: 0.6 + (i * 0.1), duration: 1.2 }}
                     className="h-1 w-24 bg-white/30 rounded-full origin-left"
                   />
                 ))}
              </div>
            </div>

            {/* Decorative Wind/Aura */}
            <motion.div
              animate={{ 
                x: [-50, 50, -50],
                y: [-20, 20, -20],
                opacity: [0.1, 0.3, 0.1]
              }}
              transition={{ duration: 4, repeat: Infinity }}
              className="absolute top-1/4 right-1/4 pointer-events-none"
            >
              <Wind className="w-32 h-32 text-white/10" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showLevelUp && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-40 backdrop-blur-md animate-in fade-in duration-500">
          <div className="text-center px-4 max-w-2xl">
            <h2 className="text-7xl font-black text-white mb-2 tracking-tighter drop-shadow-2xl">
              LEVEL UP!
            </h2>
            <div className="h-1 w-64 bg-cyan-500 mx-auto mb-6 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.8)]" />
            
            {/* Region Discover Notification */}
            {currentLevel % 2 === 1 && currentLevel > 1 && (
               <div className="mb-6 animate-in zoom-in duration-500">
                  <p className="text-white/40 text-xs font-bold uppercase tracking-[0.4em] mb-1">New Region Discovered</p>
                  <p className={`text-4xl font-black italic tracking-tighter drop-shadow-xl ${REGIONS[Math.min(Math.floor((currentLevel - 1) / 2), REGIONS.length - 1)].accent}`}>
                    {REGIONS[Math.min(Math.floor((currentLevel - 1) / 2), REGIONS.length - 1)].name}
                  </p>
               </div>
            )}

            {senseiComment && (
               <div className="mb-10 animate-in slide-in-from-bottom duration-700">
                  <p className="text-2xl text-cyan-300 font-serif italic mb-2">" {senseiComment} "</p>
                  <p className="text-sm border-t border-cyan-500/30 pt-2 inline-block text-cyan-500 uppercase tracking-[0.2em] font-bold">- Sensei -</p>
               </div>
            )}

            <p className="text-xl text-cyan-200/60 font-bold mb-4 uppercase tracking-widest">
              Starting Level {currentLevel} in...
            </p>
            <div className="text-9xl font-black text-white animate-pulse">
              {countdown}
            </div>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'gameover' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 z-50 animate-in fade-in zoom-in duration-500 overflow-y-auto p-4 py-12 md:p-8">
          <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">
            
            {/* Left: Stats & Sensei */}
            <div className="text-center lg:text-left pt-8">
              <h2 className="text-6xl md:text-7xl font-black text-white mb-2 italic tracking-tighter drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">GAME OVER</h2>
              <p className="text-3xl text-slate-400 mb-8 font-light tracking-wide">Final Score: <span className="text-yellow-400 font-black drop-shadow-md">{score}</span></p>
              
              {senseiComment && (
                <div className="mb-10 bg-slate-800/40 p-6 border-l-4 border-cyan-500 backdrop-blur-md rounded-r-2xl shadow-xl animate-in slide-in-from-left duration-700">
                  <p className="text-xl text-slate-100 font-serif italic mb-3 leading-relaxed">" {senseiComment} "</p>
                  <p className="text-sm text-cyan-400 uppercase tracking-[0.3em] font-black">- THE SENSEI -</p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mt-4">
                  <button 
                    onClick={startGame}
                    className="flex items-center justify-center gap-3 px-10 py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-full font-black text-xl hover:brightness-110 active:scale-95 transition-all shadow-2xl shadow-cyan-500/40"
                  >
                    <RotateCcw className="w-6 h-6" />
                    NEW JOURNEY
                  </button>

                  {!user && (
                    <button 
                      onClick={handleSignIn}
                      className="flex items-center justify-center gap-3 px-8 py-5 bg-white/5 hover:bg-white/10 text-white border border-white/20 rounded-full font-bold text-lg backdrop-blur-sm transition-all"
                    >
                      <LogIn className="w-6 h-6" />
                      SIGN IN FOR RANKING
                    </button>
                  )}
              </div>
              
              {user && (
                <div className="mt-8 flex items-center justify-center lg:justify-start gap-3 bg-white/5 p-4 rounded-2xl w-fit mx-auto lg:mx-0 border border-white/10 backdrop-blur-sm">
                   <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
                      <User className="text-cyan-400 w-5 h-5" />
                   </div>
                   <p className="text-slate-300 font-medium">Logged in as <span className="text-white font-bold">{user.displayName}</span></p>
                   <button 
                    onClick={handleSignOut}
                    className="ml-2 p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                    title="Sign Out"
                   >
                     <LogOut className="w-4 h-4" />
                   </button>
                </div>
              )}
            </div>

            {/* Right: Leaderboard */}
            <div className="bg-slate-900/60 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden animate-in slide-in-from-bottom duration-1000">
                <div className="absolute -top-12 -right-12 p-4 opacity-5 rotate-12">
                   <Trophy className="w-64 h-64 text-yellow-400" />
                </div>
                
                <div className="relative z-10">
                  <h3 className="flex items-center gap-3 text-2xl font-black text-white mb-8 uppercase tracking-widest border-b border-white/10 pb-4">
                    <Trophy className="w-8 h-8 text-yellow-500 drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]" />
                    Global Standings
                  </h3>

                  <div className="space-y-3">
                    {leaderboard.length > 0 ? (
                      leaderboard.map((entry, i) => (
                        <div key={i} className={`flex items-center justify-between p-5 rounded-3xl border transition-all ${i === 0 ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/10 border-yellow-500/40 shadow-lg shadow-yellow-500/10' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                          <div className="flex items-center gap-5">
                            <span className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-lg ${i === 0 ? 'bg-yellow-500 text-black shadow-xl shadow-yellow-500/30' : i === 1 ? 'bg-slate-300 text-slate-800' : i === 2 ? 'bg-orange-600 text-white' : 'text-slate-500 bg-white/5 font-bold'}`}>
                              {i + 1}
                            </span>
                            <div>
                              <p className="font-extrabold text-white text-lg tracking-tight mb-0.5">{entry.displayName}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-slate-400 uppercase font-black">Level {entry.level}</span>
                              </div>
                            </div>
                          </div>
                          <span className="text-3xl font-black text-white tabular-nums drop-shadow-md">{entry.score}</span>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-slate-500 italic">
                        <Loader2 className="w-10 h-10 animate-spin mb-4 opacity-30" />
                        <p className="font-bold uppercase tracking-[0.3em] text-xs">Consulting the Scrolls...</p>
                      </div>
                    )}
                  </div>
                </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default NinjaGame;