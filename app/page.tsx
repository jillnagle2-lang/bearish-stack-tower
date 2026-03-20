"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const BLOCK_HEIGHT = 40;
const DEPTH_OFFSET = 12; // 3D depth for top/side faces
const STARTING_WIDTH_RATIO = 0.4;
const BASE_SPEED = 2;
const MAX_SPEED = 8;
const PERFECT_THRESHOLD = 2; // px — overhang less than this = perfect
const GRAVITY = 0.6;
const FALL_GRAVITY = 0.4;
const SHAKE_FRAMES = 4;
const SHAKE_INTENSITY = 4;
const CAMERA_LERP = 0.08;
import { REWARDS } from "./rewards.config";

// Bearish brand color palette
const COLORS = [
  "#92C3E8", // sky blue
  "#74C480", // green
  "#B080FF", // purple
  "#FFC078", // peach/orange
  "#859DFF", // periwinkle blue
  "#E36F6F", // coral red
  "#FF82AD", // pink
  "#FEC091", // light peach
  "#CF8D6F", // tan/caramel
  "#A66959", // brown
  "#73473C", // dark brown
  "#40251E", // deep brown/near black
];

// Bright particle colors
const PARTICLE_COLORS = ["#FFC078", "#B080FF", "#FF82AD", "#74C480", "#E36F6F", "#92C3E8"];

// Background panel paths (bottom to top: meadow → space)
const BG_PANELS = [
  "/assets/bg-1-meadow.jpg",
  "/assets/bg-2-mountains.jpg",
  "/assets/bg-3-rainbow.jpg",
  "/assets/bg-4-sky.jpg",
  "/assets/bg-5-night.jpg",
  "/assets/bg-6-galaxy.jpg",
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Block {
  x: number;
  y: number;
  width: number;
  colorIndex: number;
}

interface FallingPiece {
  x: number;
  y: number;
  width: number;
  colorIndex: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

type GamePhase = "idle" | "sliding" | "dropping" | "landed";

// ─── Helper: color shading ──────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function StackTower() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // UI state (React-managed for overlay rendering)
  const [uiState, setUiState] = useState<"start" | "playing" | "gameover" | "reward">("start");
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentReward, setCurrentReward] = useState<{ score: number; code: string } | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  // Preloaded background panel images
  const bgImagesRef = useRef<HTMLImageElement[]>([]);

  // All game state lives in refs for performance
  const gameRef = useRef({
    phase: "idle" as GamePhase,
    score: 0,
    stack: [] as Block[],
    currentBlock: null as Block | null,
    direction: 1,
    speed: BASE_SPEED,
    dropVelocity: 0,
    fallingPieces: [] as FallingPiece[],
    particles: [] as Particle[],
    cameraY: 0,
    targetCameraY: 0,
    shakeFrames: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    animFrameId: 0,
    bestScore: 0,
    rewardsShown: new Set<number>(),
    perfectCombo: 0,
  });

  // ─── Load best score ────────────────────────────────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem("stackTowerBest");
    if (saved) {
      const val = parseInt(saved, 10);
      gameRef.current.bestScore = val;
      setBestScore(val);
    }
  }, []);

  // ─── Draw a 3D block ───────────────────────────────────────────────────────

  const drawBlock = useCallback(
    (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, colorIndex: number) => {
      const baseColor = COLORS[colorIndex % COLORS.length];
      const topColor = lighten(baseColor, 0.18); // 15-20% lighter
      const sideColor = darken(baseColor, 0.25); // 20-30% darker

      // Front face
      ctx.fillStyle = baseColor;
      ctx.fillRect(x, y, w, BLOCK_HEIGHT);

      // Top face (parallelogram)
      ctx.fillStyle = topColor;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + DEPTH_OFFSET, y - DEPTH_OFFSET);
      ctx.lineTo(x + w + DEPTH_OFFSET, y - DEPTH_OFFSET);
      ctx.lineTo(x + w, y);
      ctx.closePath();
      ctx.fill();

      // Right side face
      ctx.fillStyle = sideColor;
      ctx.beginPath();
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + w + DEPTH_OFFSET, y - DEPTH_OFFSET);
      ctx.lineTo(x + w + DEPTH_OFFSET, y + BLOCK_HEIGHT - DEPTH_OFFSET);
      ctx.lineTo(x + w, y + BLOCK_HEIGHT);
      ctx.closePath();
      ctx.fill();

      // Subtle edge lines
      ctx.strokeStyle = darken(baseColor, 0.4);
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, w, BLOCK_HEIGHT);
    },
    []
  );

  // ─── Draw base platform (tree stump style) ─────────────────────────────────

  const drawBasePlatform = useCallback(
    (ctx: CanvasRenderingContext2D, x: number, y: number, w: number) => {
      // Front face - dark brown
      ctx.fillStyle = "#73473C";
      ctx.fillRect(x, y, w, BLOCK_HEIGHT);

      // Top face
      ctx.fillStyle = lighten("#73473C", 0.18);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + DEPTH_OFFSET, y - DEPTH_OFFSET);
      ctx.lineTo(x + w + DEPTH_OFFSET, y - DEPTH_OFFSET);
      ctx.lineTo(x + w, y);
      ctx.closePath();
      ctx.fill();

      // Right side face
      ctx.fillStyle = darken("#73473C", 0.25);
      ctx.beginPath();
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + w + DEPTH_OFFSET, y - DEPTH_OFFSET);
      ctx.lineTo(x + w + DEPTH_OFFSET, y + BLOCK_HEIGHT - DEPTH_OFFSET);
      ctx.lineTo(x + w, y + BLOCK_HEIGHT);
      ctx.closePath();
      ctx.fill();

      // Border in deep brown
      ctx.strokeStyle = "#40251E";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, BLOCK_HEIGHT);
    },
    []
  );

  // ─── Draw background (illustrated panels, scrolling) ───────────────────────

  const drawBackground = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number, cameraY: number) => {
      const images = bgImagesRef.current;
      if (images.length === 0) {
        // Fallback: solid dark fill while loading
        ctx.fillStyle = "#08030F";
        ctx.fillRect(0, 0, width, height);
        return;
      }

      // Each panel is drawn at canvas width, maintaining 9:16 aspect ratio
      const panelHeight = (width * 16) / 9;
      const totalBgHeight = BG_PANELS.length * panelHeight;

      // Parallax: background scrolls at 70% of camera speed
      const parallaxFactor = 0.7;
      const bgScrollY = cameraY * parallaxFactor;

      // The bottom of panel 0 (meadow) aligns with the bottom of the viewport at cameraY=0
      // Panel positions (in background-space, bottom-up):
      //   panel 0 bottom = 0, top = panelHeight
      //   panel 1 bottom = panelHeight, top = 2*panelHeight
      //   ...
      // In screen coords: screenY = height - (bgY - bgScrollY)
      // where bgY is measured from bottom upward

      for (let i = 0; i < BG_PANELS.length; i++) {
        const img = images[i];
        if (!img) continue;

        // Bottom of this panel in bg-space (measured from world bottom)
        const panelBottomBg = i * panelHeight;
        const panelTopBg = panelBottomBg + panelHeight;

        // Convert to screen coordinates
        // screenY of panel bottom = height - (panelBottomBg - bgScrollY)
        // screenY of panel top = height - (panelTopBg - bgScrollY)
        const screenBottom = height - (panelBottomBg - bgScrollY);
        const screenTop = height - (panelTopBg - bgScrollY);

        // Check if this panel is visible on screen
        if (screenBottom < 0 || screenTop > height) continue;

        // drawImage: destination is (0, screenTop, width, panelHeight)
        ctx.drawImage(img, 0, screenTop, width, panelHeight);
      }

      // Galaxy zone: infinite tiling of the last panel above all panels
      const spaceImg = images[BG_PANELS.length - 1];
      if (spaceImg) {
        // First space-tile starts at the top of the last defined panel
        let tileBottomBg = totalBgHeight;
        // Keep drawing tiles as long as they could be visible
        for (let t = 0; t < 20; t++) {
          const tileTopBg = tileBottomBg + panelHeight;
          const screenBottom = height - (tileBottomBg - bgScrollY);
          const screenTop = height - (tileTopBg - bgScrollY);

          if (screenTop > height) break; // below viewport — no more tiles needed
          if (screenBottom >= 0) {
            ctx.drawImage(spaceImg, 0, screenTop, width, panelHeight);
          }
          tileBottomBg = tileTopBg;
        }
      }
    },
    []
  );

  // ─── Spawn particles ───────────────────────────────────────────────────────

  const spawnPerfectParticles = useCallback((x: number, y: number, width: number) => {
    const game = gameRef.current;
    const count = 20 + game.perfectCombo * 5;
    for (let i = 0; i < Math.min(count, 40); i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 2;
      game.particles.push({
        x: x + Math.random() * width,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1,
        maxLife: 0.6 + Math.random() * 0.4,
        size: Math.random() * 4 + 2,
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      });
    }
  }, []);

  // ─── Start game ─────────────────────────────────────────────────────────────

  const startGame = useCallback(() => {
    const game = gameRef.current;
    const w = game.canvasWidth;

    const baseWidth = w * 0.6;
    const baseX = (w - baseWidth) / 2;
    const baseY = game.canvasHeight - BLOCK_HEIGHT - 160;

    // Base platform
    game.stack = [
      {
        x: baseX,
        y: baseY,
        width: baseWidth,
        colorIndex: 0,
      },
    ];

    const startingWidth = w * STARTING_WIDTH_RATIO;
    game.currentBlock = {
      x: 0,
      y: baseY - BLOCK_HEIGHT,
      width: startingWidth,
      colorIndex: 1,
    };

    game.phase = "sliding";
    game.direction = 1;
    game.speed = BASE_SPEED;
    game.score = 0;
    game.dropVelocity = 0;
    game.fallingPieces = [];
    game.particles = [];
    game.cameraY = 0;
    game.targetCameraY = 0;
    game.shakeFrames = 0;
    game.rewardsShown = new Set<number>();
    game.perfectCombo = 0;

    setScore(0);
    setIsNewBest(false);
    setUiState("playing");
  }, []);

  // ─── Drop block ─────────────────────────────────────────────────────────────

  const dropBlock = useCallback(() => {
    const game = gameRef.current;
    if (game.phase !== "sliding" || !game.currentBlock) return;
    game.phase = "dropping";
    game.dropVelocity = 0;
  }, []);

  // ─── Handle input ──────────────────────────────────────────────────────────

  const handleInput = useCallback(() => {
    const game = gameRef.current;
    if (game.phase === "sliding") {
      dropBlock();
    }
  }, [dropBlock]);

  // ─── Game loop ──────────────────────────────────────────────────────────────

  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const game = gameRef.current;
    const { canvasWidth: W, canvasHeight: H } = game;

    // ── Update ──────────────────────────────────────────────────────────────

    // Slide current block
    if (game.phase === "sliding" && game.currentBlock) {
      game.currentBlock.x += game.speed * game.direction;
      if (game.currentBlock.x + game.currentBlock.width > W) {
        game.direction = -1;
      } else if (game.currentBlock.x < 0) {
        game.direction = 1;
      }
    }

    // Drop animation
    if (game.phase === "dropping" && game.currentBlock) {
      game.dropVelocity += GRAVITY;
      game.currentBlock.y += game.dropVelocity;

      const topBlock = game.stack[game.stack.length - 1];
      const landY = topBlock.y - BLOCK_HEIGHT;

      if (game.currentBlock.y >= landY) {
        game.currentBlock.y = landY;

        // Calculate overlap
        const cur = game.currentBlock;
        const prev = topBlock;
        const overlapLeft = Math.max(cur.x, prev.x);
        const overlapRight = Math.min(cur.x + cur.width, prev.x + prev.width);
        const overlapWidth = overlapRight - overlapLeft;

        if (overlapWidth <= 0) {
          // Completely missed — game over
          game.fallingPieces.push({
            x: cur.x,
            y: cur.y,
            width: cur.width,
            colorIndex: cur.colorIndex,
            vx: game.direction * 2,
            vy: -3,
            rotation: 0,
            rotationSpeed: (Math.random() - 0.5) * 0.1,
          });
          game.currentBlock = null;
          game.phase = "idle";

          // Save best score
          if (game.score > game.bestScore) {
            game.bestScore = game.score;
            localStorage.setItem("stackTowerBest", String(game.score));
            setBestScore(game.score);
            setIsNewBest(true);
          }
          setUiState("gameover");
        } else {
          // Perfect check
          const overhang = Math.abs(cur.width - overlapWidth);
          const isPerfect = overhang < PERFECT_THRESHOLD;

          if (isPerfect) {
            game.perfectCombo++;
            // Keep full width of previous block on perfect
            const landedBlock: Block = {
              x: prev.x,
              y: landY,
              width: prev.width,
              colorIndex: cur.colorIndex,
            };
            game.stack.push(landedBlock);
            spawnPerfectParticles(prev.x, landY, prev.width);
          } else {
            game.perfectCombo = 0;
            // Trim overhang
            const landedBlock: Block = {
              x: overlapLeft,
              y: landY,
              width: overlapWidth,
              colorIndex: cur.colorIndex,
            };
            game.stack.push(landedBlock);

            // Create falling trimmed piece
            if (cur.x < prev.x) {
              // Overhang on left
              game.fallingPieces.push({
                x: cur.x,
                y: landY,
                width: prev.x - cur.x,
                colorIndex: cur.colorIndex,
                vx: -2,
                vy: -1,
                rotation: 0,
                rotationSpeed: -0.05,
              });
            } else if (cur.x + cur.width > prev.x + prev.width) {
              // Overhang on right
              const trimX = prev.x + prev.width;
              game.fallingPieces.push({
                x: trimX,
                y: landY,
                width: cur.x + cur.width - trimX,
                colorIndex: cur.colorIndex,
                vx: 2,
                vy: -1,
                rotation: 0,
                rotationSpeed: 0.05,
              });
            }
          }

          // Screen shake
          game.shakeFrames = SHAKE_FRAMES;

          // Update score
          game.score++;
          setScore(game.score);

          // Check reward tiers
          const reward = REWARDS.find(
            (r) => game.score === r.score && !game.rewardsShown.has(r.score)
          );
          if (reward) {
            game.rewardsShown.add(reward.score);
            game.phase = "idle"; // pause
            setCurrentReward(reward);
            setUiState("reward");
            return; // don't set up next block yet
          }

          // Save best score
          if (game.score > game.bestScore) {
            game.bestScore = game.score;
            localStorage.setItem("stackTowerBest", String(game.score));
            setBestScore(game.score);
          }

          // Move camera up
          const stackTop = landY;
          const targetView = H * 0.3; // keep action in top third
          game.targetCameraY = Math.max(0, H - stackTop - targetView);

          // Set up next block
          const newWidth = isPerfect
            ? game.stack[game.stack.length - 1].width
            : overlapWidth;
          const nextColorIndex = cur.colorIndex + 1;
          const nextY = landY - BLOCK_HEIGHT;

          game.speed = Math.min(BASE_SPEED + game.score * 0.08, MAX_SPEED);

          game.currentBlock = {
            x: game.direction === 1 ? -newWidth : W,
            y: nextY,
            width: newWidth,
            colorIndex: nextColorIndex,
          };
          game.phase = "sliding";
        }
      }
    }

    // Smooth camera
    game.cameraY += (game.targetCameraY - game.cameraY) * CAMERA_LERP;

    // Update falling pieces
    game.fallingPieces = game.fallingPieces.filter((p) => {
      p.vy += FALL_GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      return p.y < H + game.cameraY + 200;
    });

    // Update particles
    game.particles = game.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life -= 1 / 60 / p.maxLife;
      return p.life > 0;
    });

    // Shake
    let shakeX = 0,
      shakeY = 0;
    if (game.shakeFrames > 0) {
      shakeX = (Math.random() - 0.5) * SHAKE_INTENSITY * 2;
      shakeY = (Math.random() - 0.5) * SHAKE_INTENSITY * 2;
      game.shakeFrames--;
    }

    // ── Render ─────────────────────────────────────────────────────────────

    ctx.clearRect(0, 0, W, H);

    // Background (no camera transform)
    drawBackground(ctx, W, H, game.cameraY);

    // Apply camera + shake
    ctx.save();
    ctx.translate(shakeX, shakeY + game.cameraY);

    // Draw base platform (first block) with tree stump style
    if (game.stack.length > 0) {
      const base = game.stack[0];
      drawBasePlatform(ctx, base.x, base.y, base.width);
    }

    // Draw stacked blocks (skip base — drawn separately)
    for (let i = 1; i < game.stack.length; i++) {
      const block = game.stack[i];
      drawBlock(ctx, block.x, block.y, block.width, block.colorIndex);
    }

    // Draw current block
    if (game.currentBlock) {
      drawBlock(
        ctx,
        game.currentBlock.x,
        game.currentBlock.y,
        game.currentBlock.width,
        game.currentBlock.colorIndex
      );
    }

    // Draw falling pieces with rotation
    for (const piece of game.fallingPieces) {
      ctx.save();
      ctx.translate(piece.x + piece.width / 2, piece.y + BLOCK_HEIGHT / 2);
      ctx.rotate(piece.rotation);
      drawBlock(ctx, -piece.width / 2, -BLOCK_HEIGHT / 2, piece.width, piece.colorIndex);
      ctx.restore();
    }

    // Draw particles
    for (const p of game.particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    ctx.restore();

    // ── Loop ───────────────────────────────────────────────────────────────

    game.animFrameId = requestAnimationFrame(gameLoop);
  }, [drawBackground, drawBlock, drawBasePlatform, spawnPerfectParticles]);

  // ─── Resume after reward ────────────────────────────────────────────────────

  const resumeFromReward = useCallback(() => {
    const game = gameRef.current;
    game.phase = "sliding";
    setUiState("playing");
  }, []);

  // ─── Canvas resize ─────────────────────────────────────────────────────────

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    gameRef.current.canvasWidth = rect.width;
    gameRef.current.canvasHeight = rect.height;
  }, []);

  // ─── Setup ──────────────────────────────────────────────────────────────────

  // ─── Preload background images ───────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      const loaded: HTMLImageElement[] = [];
      await Promise.all(
        BG_PANELS.map(
          (src, i) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                loaded[i] = img;
                resolve();
              };
              img.onerror = () => resolve(); // gracefully skip broken images
              img.src = src;
            })
        )
      );
      if (!cancelled) {
        bgImagesRef.current = loaded;
        setImagesLoaded(true);
      }
    };
    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    resizeCanvas();

    const handleResize = () => resizeCanvas();
    window.addEventListener("resize", handleResize);

    // Start render loop
    const game = gameRef.current;
    game.animFrameId = requestAnimationFrame(gameLoop);

    // Input handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (uiState === "start") startGame();
        else if (uiState === "playing") handleInput();
      }
    };

    const handleClick = () => {
      if (uiState === "playing") handleInput();
    };

    const handleTouch = (e: TouchEvent) => {
      e.preventDefault();
      if (uiState === "playing") handleInput();
    };

    window.addEventListener("keydown", handleKeyDown);
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener("click", handleClick);
      canvas.addEventListener("touchstart", handleTouch, { passive: false });
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      if (canvas) {
        canvas.removeEventListener("click", handleClick);
        canvas.removeEventListener("touchstart", handleTouch);
      }
      cancelAnimationFrame(game.animFrameId);
    };
  }, [uiState, resizeCanvas, gameLoop, startGame, handleInput]);

  // ─── Copy reward code ───────────────────────────────────────────────────────

  const copyRewardCode = useCallback(async () => {
    const code = currentReward?.code ?? "";
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const el = document.createElement("textarea");
      el.value = code;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [currentReward]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen overflow-hidden bg-black"
      style={{ maxWidth: "500px", margin: "0 auto" }}
    >
      {/* Canvas */}
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Score display */}
      {uiState === "playing" && (
        <div
          className="absolute top-6 left-0 right-0 text-center pointer-events-none select-none"
          style={{
            fontSize: "3rem",
            fontWeight: 800,
            color: "white",
            textShadow: "0 2px 10px #40251E, 0 0 30px rgba(64,37,30,0.5)",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {score}
        </div>
      )}

      {/* Start screen */}
      {uiState === "start" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          onClick={imagesLoaded ? startGame : undefined}
          onTouchStart={
            imagesLoaded
              ? (e) => {
                  e.preventDefault();
                  startGame();
                }
              : undefined
          }
          style={{
            background: "rgba(64,37,30,0.75)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            cursor: "pointer",
          }}
        >
          {/* Bearish Logo */}
          <img
            src="/assets/bearish-logo.jpg"
            alt="Bearish Logo"
            style={{
              width: "120px",
              height: "120px",
              borderRadius: "20px",
              marginBottom: "1rem",
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            }}
          />

          <h1
            style={{
              fontSize: "3rem",
              fontWeight: 900,
              color: "#40251E",
              textShadow: "0 0 20px #FFC078, 0 0 40px rgba(255,192,120,0.4), 0 4px 8px rgba(255,192,120,0.3)",
              marginBottom: "1rem",
              fontFamily: "'Inter', system-ui, sans-serif",
              letterSpacing: "-0.02em",
            }}
          >
            BEARISH STACK
          </h1>

          <p
            style={{
              fontSize: "0.95rem",
              color: "#FEC091",
              marginBottom: "0.75rem",
              maxWidth: "280px",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Tap to place the moving blocks. Stack as high as you can and earn Discord codes at 25, 50, and 100 points!
          </p>

          {imagesLoaded ? (
            <p
              style={{
                fontSize: "1.2rem",
                color: "#FFC078",
                animation: "pulse 2s ease-in-out infinite",
                marginBottom: "2rem",
                fontWeight: 700,
              }}
            >
              Tap to Start
            </p>
          ) : (
            <p
              style={{
                fontSize: "1rem",
                color: "#CF8D6F",
                marginBottom: "2rem",
              }}
            >
              Loading…
            </p>
          )}

          {bestScore > 0 && (
            <p
              style={{
                fontSize: "1rem",
                color: "#CF8D6F",
              }}
            >
              Best: {bestScore}
            </p>
          )}
        </div>
      )}

      {/* Game Over screen */}
      {uiState === "gameover" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            background: "rgba(64,37,30,0.8)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <h2
            style={{
              fontSize: "2.5rem",
              fontWeight: 800,
              color: "#E36F6F",
              textShadow: "0 2px 10px rgba(227,111,111,0.4)",
              marginBottom: "1rem",
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            Game Over
          </h2>

          <p
            style={{
              fontSize: "4rem",
              fontWeight: 900,
              color: "white",
              textShadow: "0 2px 10px rgba(64,37,30,0.5)",
              lineHeight: 1,
              marginBottom: "0.5rem",
            }}
          >
            {score}
          </p>

          <p style={{ color: "rgba(255,255,255,0.6)", marginBottom: "0.5rem" }}>
            Best: {bestScore}
          </p>

          {isNewBest && (
            <p
              style={{
                color: "#FFC078",
                fontWeight: 700,
                fontSize: "1.2rem",
                marginBottom: "1rem",
                textShadow: "0 0 15px rgba(255,192,120,0.5)",
                animation: "pulse 1s ease-in-out infinite",
              }}
            >
              🎉 New Best!
            </p>
          )}

          <button
            onClick={startGame}
            onTouchStart={(e) => {
              e.preventDefault();
              startGame();
            }}
            style={{
              marginTop: "1rem",
              padding: "14px 40px",
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "white",
              background: "#B080FF",
              border: "none",
              borderRadius: "50px",
              cursor: "pointer",
              boxShadow: "0 4px 20px rgba(176,128,255,0.4)",
              transition: "transform 0.15s",
            }}
            onMouseDown={(e) => ((e.target as HTMLElement).style.transform = "scale(0.95)")}
            onMouseUp={(e) => ((e.target as HTMLElement).style.transform = "scale(1)")}
          >
            Play Again
          </button>
        </div>
      )}

      {/* Reward modal */}
      {uiState === "reward" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            background: "rgba(64,37,30,0.9)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #40251E, #73473C)",
              borderRadius: "20px",
              padding: "2rem",
              maxWidth: "360px",
              width: "90%",
              textAlign: "center",
              border: "2px solid rgba(176,128,255,0.3)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(176,128,255,0.15)",
            }}
          >
            {/* Bearish Logo in reward modal */}
            <img
              src="/assets/bearish-logo.jpg"
              alt="Bearish Logo"
              style={{
                width: "80px",
                height: "80px",
                borderRadius: "16px",
                margin: "0 auto 0.75rem auto",
                display: "block",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            />

            <h2
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "#FFC078",
                marginBottom: "0.5rem",
              }}
            >
              🐻 BEARISH REWARD UNLOCKED
            </h2>
            <p style={{ color: "rgba(255,255,255,0.7)", marginBottom: "1rem" }}>
              You stacked {currentReward?.score} — here&apos;s your code:
            </p>

            <div
              style={{
                background: "#40251E",
                border: "1px solid rgba(255,192,120,0.4)",
                borderRadius: "12px",
                padding: "12px 16px",
                marginBottom: "1rem",
                fontFamily: "monospace",
                fontSize: "1.2rem",
                fontWeight: 700,
                color: "#FFC078",
                letterSpacing: "0.05em",
              }}
            >
              {currentReward?.code}
            </div>

            <button
              onClick={copyRewardCode}
              style={{
                padding: "8px 24px",
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "white",
                background: copied ? "#74C480" : "#B080FF",
                border: "none",
                borderRadius: "50px",
                cursor: "pointer",
                marginBottom: "1rem",
                transition: "all 0.2s",
              }}
            >
              {copied ? "✓ Copied!" : "📋 Copy Code"}
            </button>

            <br />

            <button
              onClick={resumeFromReward}
              onTouchStart={(e) => {
                e.preventDefault();
                resumeFromReward();
              }}
              style={{
                marginTop: "0.5rem",
                padding: "14px 40px",
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "white",
                background: "#74C480",
                border: "none",
                borderRadius: "50px",
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(116,196,128,0.4)",
              }}
            >
              Continue Playing
            </button>
          </div>
        </div>
      )}

      {/* Pulse animation */}
      <style jsx global>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }
      `}</style>
    </div>
  );
}
