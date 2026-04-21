import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HandLandmarker } from '@mediapipe/tasks-vision';
import { createHandLandmarker } from '../utils/handDetection';
import { Loader2, Camera, Play, RotateCcw, AlertCircle, Trophy, User, LogIn, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, signInWithGoogle, submitScore, getTopScores, LeaderboardEntry } from '../lib/firebase';
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

const GRAVITY = 0.25;
const FRUIT_SPAWN_RATE = 60; // Frames between spawns
const BLADE_LENGTH = 10; // Number of points in the trail
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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [senseiComment, setSenseiComment] = useState<string>("");
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar>(AVATARS[0]);
  const [avatarComment, setAvatarComment] = useState<string>("Ready, Ninja?");
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
  const lastVideoTimeRef = useRef(-1);
  
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

    // Increase bomb chance with level
    const currentBombChance = Math.min(0.15 + (levelRef.current - 1) * 0.05, 0.4);
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
      type
    });
  };

  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      particlesRef.current.push({
        id: Math.random(),
        x, y,
        vx: (Math.random() - 0.5) * 15,
        vy: (Math.random() - 0.5) * 15,
        life: 1.0,
        color,
        size: Math.random() * 5 + 2
      });
    }
  };

  const addNotification = (x: number, y: number, text: string, color: string = '#fff') => {
    const newNotif = {
      id: Math.random(),
      x, y, text, color,
      life: 1.0
    };
    notificationsRef.current.push(newNotif);
    setNotifications([...notificationsRef.current]);

    // Avatar Commentary Logic
    triggerAvatarComment('success', text);
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
      // If it's a big event like a combo, use a specific one or the first one
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
              // Get Index Finger Tip (Landmark 8)
              const hand = results.landmarks[0];
              const indexTip = hand[8];
              
              // Convert normalized coordinates (0-1) to canvas coordinates using cover scale
              // Ensure we mirror it if the video feed is mirrored
              handX = drawX + (1 - indexTip.x) * drawW;
              handY = drawY + indexTip.y * drawH;

              // Update Blade Path
              bladePathRef.current.push({ x: handX, y: handY });
              if (bladePathRef.current.length > BLADE_LENGTH) {
                bladePathRef.current.shift();
              }
            } else {
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

    // Dynamic Background Gradient (shifts with region)
    const regionIdx = Math.min(Math.floor((levelRef.current - 1) / 2), REGIONS.length - 1);
    const region = REGIONS[regionIdx];
    
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
    ctx.fillStyle = grad;
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
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#22d3ee';
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

        // Draw Fruit
        ctx.font = `${fruit.radius * 2}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(fruit.emoji, fruit.x, fruit.y);

        // Remove if off screen
        if (fruit.y > canvas.height + 100) {
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
              
              consecutiveSlicesRef.current++;
              if (consecutiveSlicesRef.current % 5 === 0) {
                triggerAvatarComment('success', 'SLICE');
              }
              
              // Combo Logic
              comboRef.current++;
              if (comboResetTimerRef.current) clearTimeout(comboResetTimerRef.current);
              comboResetTimerRef.current = window.setTimeout(() => {
                if (comboRef.current > 1) {
                  const bonus = comboRef.current * 5;
                  scoreRef.current += bonus;
                  setScore(scoreRef.current);
                }
                comboRef.current = 0;
              }, 300); // 300ms window for combo

              if (comboRef.current >= 3) {
                addNotification(fruit.x, fruit.y - 40, `COMBO x${comboRef.current}!`, '#ffff00');
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
      frameCountRef.current++;
      // Decrease spawn interval as level increases
      const spawnRate = Math.max(60 - (levelRef.current - 1) * 5, 20);
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
        p.vy += (GRAVITY * 0.5) * timeScaleRef.current;
        p.life -= 0.02 * timeScaleRef.current;

        if (p.life <= 0) {
          particlesRef.current.splice(i, 1);
        } else {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.life;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
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
          ctx.font = `bold ${24 + n.life * 10}px Inter`;
          ctx.fillStyle = n.color;
          ctx.globalAlpha = n.life;
          ctx.textAlign = 'center';
          ctx.shadowBlur = 10;
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.fillText(n.text, n.x, n.y);
          ctx.restore();
        }
      }
      setNotifications([...notificationsRef.current]);

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

    // G. Draw Blade Trail
    const path = bladePathRef.current;
    if (path.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'cyan';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 15;
      ctx.shadowColor = 'cyan';
      
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  };

  // 4. Game Control Functions
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

  const startLevelTransition = async () => {
    isTransitioningRef.current = true;
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

  const handleGameOver = () => {
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

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
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-white p-8 overflow-y-auto">
      
      {/* Back to Hub Button */}
      <button 
        onClick={() => navigate('/')}
        className="absolute top-6 left-6 p-4 flex items-center justify-center gap-2 bg-slate-800/80 hover:bg-slate-700 rounded-full transition-colors font-bold text-slate-300 pointer-events-auto"
      >
         <ArrowLeft className="w-6 h-6" />
      </button>

      <h1 className="text-6xl font-bold mb-8 text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.8)] animate-pulse mt-8">NINJA HANDS</h1>
      
      {/* Avatar Selection */}
      <div className="w-full max-w-lg mb-8">
        <h3 className="text-center text-slate-400 font-black uppercase tracking-[0.3em] text-xs mb-4">Choose Your Sensei</h3>
        <div className="grid grid-cols-4 gap-4">
          {AVATARS.map((avatar) => (
            <button
              key={avatar.id}
              onClick={() => setSelectedAvatar(avatar)}
              className={`
                flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all group
                ${selectedAvatar.id === avatar.id 
                  ? `${avatar.color} border-current scale-105 shadow-lg` 
                  : 'bg-slate-900 border-transparent hover:bg-slate-800'}
              `}
            >
              <span className="text-4xl group-hover:scale-110 transition-transform">{avatar.emoji}</span>
              <span className={`text-[10px] font-black uppercase tracking-tighter ${selectedAvatar.id === avatar.id ? 'text-white' : 'text-slate-500'}`}>
                {avatar.name}
              </span>
            </button>
          ))}
        </div>
        <p className="text-center text-[10px] text-slate-600 mt-4 italic">
          {selectedAvatar.personality === 'mean' && "Shadow will not be impressed easily."}
          {selectedAvatar.personality === 'heroic' && "Spark will cheer you to greatness!"}
          {selectedAvatar.personality === 'calm' && "Zen brings focus to the chaos."}
          {selectedAvatar.personality === 'sarcastic' && "Rogue has seen better ninjas."}
        </p>
      </div>

      <div className="bg-slate-900 border border-green-500/50 p-6 rounded-2xl mb-8 w-full max-w-sm drop-shadow-[0_0_5px_rgba(74,222,128,0.5)]">
        <h3 className="text-xl font-black mb-4 text-center uppercase tracking-widest text-green-500">Leaderboard</h3>
        <div className="space-y-2 text-sm">
          {leaderboard.length > 0 ? (
            leaderboard.map((entry, idx) => (
              <div key={idx} className="flex justify-between border-b border-green-500/20 pb-1">
                <span>{entry.displayName}</span>
                <span className="font-mono text-green-400">{entry.score}</span>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 italic">No scores yet...</div>
          )}
        </div>
      </div>

      {!user ? (
        <div className="flex flex-col items-center gap-4 mb-8">
          <input 
            type="text" 
            placeholder="Enter guest name" 
            className="bg-slate-900 border border-green-500/50 p-3 rounded text-center outline-none focus:border-green-400 w-full max-w-xs" 
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
          <button 
            onClick={() => signInWithGoogle()} 
            className="flex items-center gap-2 bg-white text-black px-6 py-2 rounded font-bold hover:bg-slate-200 transition-colors"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4 bg-slate-900/80 p-4 rounded-xl border border-green-500/30 mb-8 max-w-xs w-full">
          <img 
            src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
            alt="User" 
            className="w-12 h-12 rounded-full border-2 border-green-500"
            referrerPolicy="no-referrer"
          />
          <div className="flex flex-col flex-1 overflow-hidden">
            <span className="font-bold text-green-400 truncate">{user.displayName}</span>
            <button 
              onClick={() => auth.signOut()}
              className="text-slate-500 text-xs text-left hover:text-red-400 font-bold uppercase tracking-widest"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}

      <button 
        onClick={() => handleEnableCamera()} 
        className="text-3xl font-black bg-green-500 text-black px-12 py-4 rounded-full hover:bg-green-400 hover:scale-110 transition-all shadow-[0_0_20px_rgba(34,197,94,0.6)]"
      >
        PLAY NOW
      </button>
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
                      onClick={signInWithGoogle}
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