# AI Studio Agent Instructions

## Ninja Hands Core Architecture Rules

**CRITICAL:** This project relies on a very fragile and highly-tuned intersection of React `useRef`, `requestAnimationFrame`, and the `@mediapipe/tasks-vision` SDK. Do exactly as instructed below to avoid breaking the core game loop and camera detection.

### 1. Element Mounting
- **DO NOT** conditionally unmount the `<video>` or `<canvas>` elements.
- They must remain in the DOM at all times (e.g., behind the start screen) to ensure `videoRef.current` and `canvasRef.current` are never `null` when `handleEnableCamera` or the game loop starts.

### 2. Camera Initialization
- The `handleEnableCamera` flow must remain structurally intact. It relies on `navigator.mediaDevices.getUserMedia`, explicit `video.play()` calls, and `onloadedmetadata` event syncing. Do not restructure this into custom hooks or change its promise resolution pattern.

### 3. The Game Loop
- The `loop` function uses a strict structure for scheduling `requestAnimationFrame(loop)` right at the top of the function to prevent frame drops or thrown errors from permanently halting the loop. Do not move the scheduler.
- Leave `lastVideoTimeRef` and `performance.now()` checks intact. MediaPipe's `detectForVideo` will crash if it receives non-monotonic timestamps. The `try/catch` wrapping the detection is mandatory.

### 4. Interfaces
- The `Fruit`, `Notification`, `Particle`, and `Splat` interfaces in `NinjaGame.tsx` are foundational. Do not overwrite or delete their core properties (`id`, `x`, `y`, `life`, `vx`, `vy`) when adding new features.
