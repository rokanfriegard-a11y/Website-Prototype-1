/**
 * PIXEL SUMMIT — assets/game.js
 * Fully separated, secured game engine
 * - XSS-safe DOM manipulation (textContent / createElement only)
 * - Sanitized localStorage with schema validation
 * - Input rate-limiting & anti-cheat guards
 * - Mobile touch controls
 * - Responsive canvas sizing
 */

'use strict';

/* ============================================================
   SECTION 1: CONSTANTS & GAME DATA (read-only, frozen)
   ============================================================ */

const PHYSICS = Object.freeze({
  GRAVITY:    0.55,
  JUMP_FORCE: -12.5,
  MOVE_SPEED: 3.8,
  MAX_FALL:   18,
  FALL_DEATH: 300,
});

const CANVAS = Object.freeze({
  LOGICAL_W: 480,
  LOGICAL_H: 640,
});

/** Allowed save-data schema for validation */
const SAVE_SCHEMA = Object.freeze({
  unlocked: { type: 'number', min: 1, max: 8 },
  best:     { type: 'object' },
});

const SAVE_KEY = 'pixelSummit_v2';

const DEATH_QUOTES = Object.freeze([
  "The mountain does not care about your feelings.",
  "Gravity: 1 — You: 0",
  "Maybe this time?",
  "Pain is temporary. Shame is eternal.",
  "Every fall is a lesson. A painful, humiliating lesson.",
  "You were so close. You weren't.",
  "The summit mocks you.",
  "Try harder. Or don't. The mountain won't notice.",
  "A wise person once stopped here.",
  "The rocks are very patient.",
  "Bold strategy. Let's see if it pays off.",
]);

const LEVEL_DEFS = Object.freeze([
  { name: "FOOTHILLS",  icon: "🌿", color: "#44aa44", bg: "#0a1a0a", difficulty: 1 },
  { name: "STONE PATH", icon: "🪨", color: "#888888", bg: "#111111", difficulty: 2 },
  { name: "ICE RIDGE",  icon: "🧊", color: "#44ccff", bg: "#050a1a", difficulty: 3 },
  { name: "LAVA TRAIL", icon: "🌋", color: "#ff6600", bg: "#1a0500", difficulty: 4 },
  { name: "STORM PEAK", icon: "⚡", color: "#ffff44", bg: "#050508", difficulty: 5 },
  { name: "VOID CLIMB", icon: "🌑", color: "#9944ff", bg: "#080010", difficulty: 6 },
  { name: "SKY TOWER",  icon: "☁️", color: "#aaddff", bg: "#000a1a", difficulty: 7 },
  { name: "THE SUMMIT", icon: "🏔️", color: "#ffcc00", bg: "#000000", difficulty: 8 },
]);

const PALETTES = Object.freeze([
  { plat: '#4a8c3a', platTop: '#5fb348', accent: '#ffcc00', player: '#ff8844' },
  { plat: '#666060', platTop: '#887878', accent: '#cccccc', player: '#ffcc44' },
  { plat: '#2266aa', platTop: '#44aadd', accent: '#aaeeff', player: '#ffffff' },
  { plat: '#884400', platTop: '#cc6600', accent: '#ff4400', player: '#ffff44' },
  { plat: '#334455', platTop: '#556677', accent: '#ffff00', player: '#44ffff' },
  { plat: '#330066', platTop: '#6600cc', accent: '#cc44ff', player: '#ff44cc' },
  { plat: '#224466', platTop: '#4488cc', accent: '#88ccff', player: '#ffffff' },
  { plat: '#555500', platTop: '#aaaa00', accent: '#ffdd00', player: '#ff8844' },
]);

/* ============================================================
   SECTION 2: SECURE SAVE / LOAD
   ============================================================ */

function defaultProgress() {
  return { unlocked: 1, best: {} };
}

function validateProgress(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.unlocked !== 'number') return false;
  if (data.unlocked < 1 || data.unlocked > 8 || !Number.isInteger(data.unlocked)) return false;
  if (typeof data.best !== 'object' || data.best === null || Array.isArray(data.best)) return false;
  // Validate each best entry
  for (const [k, v] of Object.entries(data.best)) {
    const ki = parseInt(k, 10);
    if (isNaN(ki) || ki < 0 || ki > 7) return false;
    if (typeof v !== 'number' || v < 0 || v > 99999) return false;
  }
  return true;
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultProgress();
    // Prevent oversized payloads
    if (raw.length > 2048) { localStorage.removeItem(SAVE_KEY); return defaultProgress(); }
    const parsed = JSON.parse(raw);
    if (!validateProgress(parsed)) { localStorage.removeItem(SAVE_KEY); return defaultProgress(); }
    return parsed;
  } catch {
    return defaultProgress();
  }
}

function saveProgress(prog) {
  if (!validateProgress(prog)) return; // Never write invalid data
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(prog));
  } catch {
    // Storage full or blocked — silently fail
  }
}

/* ============================================================
   SECTION 3: SAFE DOM HELPERS (no innerHTML with dynamic data)
   ============================================================ */

/** Set text safely — no XSS vector */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function setStyle(id, prop, value) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = value;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

/* ============================================================
   SECTION 4: INPUT MANAGER (keyboard + touch, rate-limited)
   ============================================================ */

const Input = (() => {
  const state = {
    left: false, right: false, jump: false,
    jumpConsumed: false,
  };

  // Rate-limit: ignore burst spam (> 60 events/sec per key)
  const lastKeyTime = {};
  const KEY_RATE_LIMIT = 16; // ms

  function onKeyDown(e) {
    const now = performance.now();
    const k = e.code;
    if (lastKeyTime[k] && now - lastKeyTime[k] < KEY_RATE_LIMIT) return;
    lastKeyTime[k] = now;

    if (k === 'ArrowLeft'  || k === 'KeyA') state.left  = true;
    if (k === 'ArrowRight' || k === 'KeyD') state.right = true;
    if (k === 'ArrowUp' || k === 'KeyW' || k === 'Space') state.jump = true;
    if (k === 'KeyR') Game.restart();

    if (['Space','ArrowUp','ArrowLeft','ArrowRight','KeyW','KeyA','KeyD'].includes(k)) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    const k = e.code;
    if (k === 'ArrowLeft'  || k === 'KeyA') state.left  = false;
    if (k === 'ArrowRight' || k === 'KeyD') state.right = false;
    if (k === 'ArrowUp' || k === 'KeyW' || k === 'Space') {
      state.jump = false;
      state.jumpConsumed = false;
    }
  }

  document.addEventListener('keydown', onKeyDown, { passive: false });
  document.addEventListener('keyup',   onKeyUp);

  // Touch buttons
  function bindTouch(id, flagName) {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => { e.preventDefault(); state[flagName] = true; el.classList.add('pressed'); };
    const up   = (e) => { e.preventDefault(); state[flagName] = false; if (flagName === 'jump') state.jumpConsumed = false; el.classList.remove('pressed'); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend',   up,   { passive: false });
    el.addEventListener('touchcancel',up,   { passive: false });
    el.addEventListener('mousedown',  down);
    el.addEventListener('mouseup',    up);
  }

  bindTouch('btn-left',  'left');
  bindTouch('btn-right', 'right');
  bindTouch('btn-jump',  'jump');

  document.getElementById('btn-restart-touch')?.addEventListener('touchstart', (e) => {
    e.preventDefault(); Game.restart();
  }, { passive: false });

  return {
    get left()  { return state.left; },
    get right() { return state.right; },
    get jump()  { return state.jump; },
    get jumpConsumed() { return state.jumpConsumed; },
    consumeJump() { state.jumpConsumed = true; },
    reset() {
      state.left = false; state.right = false;
      state.jump = false; state.jumpConsumed = false;
    },
  };
})();

/* ============================================================
   SECTION 5: TOUCH DEVICE DETECTION
   ============================================================ */

function isTouchDevice() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

function updateTouchControls() {
  const tc = document.getElementById('touch-controls');
  if (!tc) return;
  if (isTouchDevice()) {
    tc.classList.add('visible');
  } else {
    tc.classList.remove('visible');
  }
}

/* ============================================================
   SECTION 6: CANVAS RESIZE (responsive, letterbox)
   ============================================================ */

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
canvas.width  = CANVAS.LOGICAL_W;
canvas.height = CANVAS.LOGICAL_H;

let canvasScale = 1;

function resizeCanvas() {
  const HUD_H    = document.getElementById('hud')?.offsetHeight || 48;
  const TOUCH_H  = isTouchDevice() ? (window.innerHeight * 0.22) : 0;
  const availW   = window.innerWidth;
  const availH   = window.innerHeight - HUD_H - TOUCH_H;
  const scaleW   = availW / CANVAS.LOGICAL_W;
  const scaleH   = availH / CANVAS.LOGICAL_H;
  canvasScale    = Math.min(scaleW, scaleH, 1.5); // max 1.5× for readability

  canvas.style.width  = Math.floor(CANVAS.LOGICAL_W * canvasScale) + 'px';
  canvas.style.height = Math.floor(CANVAS.LOGICAL_H * canvasScale) + 'px';
  canvas.style.marginTop = HUD_H + 'px';
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 100));

/* ============================================================
   SECTION 7: STARS BACKGROUND
   ============================================================ */

(function initStars() {
  const sc  = document.getElementById('stars-canvas');
  const sCtx = sc.getContext('2d');
  const stars = Array.from({ length: 120 }, () => ({
    x: Math.random(), y: Math.random(),
    s: Math.random() * 2 + 1,
    b: Math.random() * Math.PI * 2,
    sp: Math.random() * 0.01 + 0.003,
  }));

  function resize() { sc.width = window.innerWidth; sc.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    sCtx.clearRect(0, 0, sc.width, sc.height);
    stars.forEach(s => {
      s.b += s.sp;
      const alpha = (Math.sin(s.b) * 0.5 + 0.5) * 0.7 + 0.1;
      sCtx.fillStyle = `rgba(200,200,255,${alpha.toFixed(2)})`;
      sCtx.fillRect(Math.round(s.x * sc.width), Math.round(s.y * sc.height),
                    Math.floor(s.s), Math.floor(s.s));
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ============================================================
   SECTION 8: LEVEL GENERATION
   ============================================================ */

function generateLevel(levelIndex) {
  // Clamp index to prevent out-of-bounds
  const idx  = Math.max(0, Math.min(levelIndex, LEVEL_DEFS.length - 1));
  const def  = LEVEL_DEFS[idx];
  const d    = def.difficulty;
  const W    = CANVAS.LOGICAL_W;
  const H    = CANVAS.LOGICAL_H;
  const TOTAL_H = H * (3 + d * 0.8);

  const platforms = [];

  // Ground
  platforms.push({ x: 0, y: TOTAL_H - 40, w: W, h: 40, type: 'ground' });
  // Spawn pad
  platforms.push({ x: W / 2 - 60, y: TOTAL_H - 120, w: 120, h: 16, type: 'normal' });

  let y = TOTAL_H - 200;
  let lastX = W / 2;

  const gapMax  = 80 + d * 15;
  const wMin    = Math.max(28, 80 - d * 8);
  const wMax    = Math.max(wMin + 10, 110 - d * 5);
  const stepMin = 50 + d * 5;
  const stepMax = 90 + d * 8;

  while (y > 80) {
    const w  = Math.random() * (wMax - wMin) + wMin;
    let   x  = lastX + (Math.random() - 0.5) * gapMax * 2;
    x = Math.max(4, Math.min(W - w - 4, x));

    let type = 'normal';
    const r  = Math.random();
    if (d >= 3 && r < 0.12 * (d - 2))              type = 'crumble';
    else if (d >= 5 && r < 0.09)                    type = 'bounce';
    else if (d >= 4 && r < 0.13)                    type = 'moving';

    platforms.push({
      x, y, w, h: 12, type,
      ox: x, oy: y,
      moveDir:   Math.random() > 0.5 ? 1 : -1,
      moveRange: 40 + Math.random() * 40,
      moveSpeed: 0.8 + Math.random() * 0.8,
      moveT:     Math.random() * Math.PI * 2,
    });

    lastX = x + w / 2;
    y -= Math.random() * (stepMax - stepMin) + stepMin;
  }

  // Goal
  platforms.push({ x: W / 2 - 40, y: 40, w: 80, h: 16, type: 'goal' });

  return { platforms, totalHeight: TOTAL_H, def, levelIndex: idx };
}

/* ============================================================
   SECTION 9: DRAW HELPERS
   ============================================================ */

function hexDarken(hex, amount) {
  if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length < 7) return hex;
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) - amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) - amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) - amount));
  return `rgb(${r},${g},${b})`;
}

function drawBackground(def, camY, totalH) {
  const scrollPct = camY / totalH;
  ctx.fillStyle = def.color + '10';
  for (let i = 0; i < 5; i++) {
    const mx = (i * 130 + 20) % CANVAS.LOGICAL_W;
    const mh = 80 + i * 30;
    const my = (CANVAS.LOGICAL_H - mh) - scrollPct * 40 * i;
    ctx.beginPath();
    ctx.moveTo(mx, my + mh);
    ctx.lineTo(mx + 50, my);
    ctx.lineTo(mx + 100, my + mh);
    ctx.fill();
  }
  ctx.fillStyle = def.color + '20';
  for (let h = 0; h <= totalH; h += 200) {
    const markerY = h - camY;
    if (markerY >= 0 && markerY <= CANVAS.LOGICAL_H) {
      ctx.fillRect(0, markerY, 14, 1);
      ctx.fillRect(CANVAS.LOGICAL_W - 14, markerY, 14, 1);
    }
  }
}

function drawPlatform(pl, idx, pal, camY, crumbled) {
  if (crumbled.has(idx)) return;
  const drawY = pl.y - camY;
  if (drawY > CANVAS.LOGICAL_H + 24 || drawY < -24) return;

  let color    = pal.plat;
  let topColor = pal.platTop;
  let shine    = pal.accent;

  if (pl.type === 'goal') {
    color = '#aa8800'; topColor = '#ffcc00'; shine = '#ffffff';
  } else if (pl.type === 'crumble') {
    const t = performance.now() / 200;
    color    = `hsl(${20 + Math.sin(t) * 10},60%,25%)`;
    topColor = `hsl(${30 + Math.sin(t) * 10},70%,35%)`;
  } else if (pl.type === 'bounce') {
    color = '#006644'; topColor = '#00cc88'; shine = '#44ffcc';
  } else if (pl.type === 'moving') {
    color    = hexDarken(pal.plat, -20);
    topColor = hexDarken(pal.platTop, -20);
  }

  const x = Math.round(pl.x);
  const y = Math.round(drawY);
  const w = Math.round(pl.w);
  const h = Math.round(pl.h);

  ctx.fillStyle = color;
  ctx.fillRect(x, y + 3, w, h - 3);
  ctx.fillStyle = topColor;
  ctx.fillRect(x, y, w, 4);
  ctx.fillStyle = shine + '55';
  ctx.fillRect(x + 2, y + 1, Math.min(w - 4, 20), 1);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x, y + h - 2, w, 2);
  if (w > 32) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let bx = x + 8; bx < x + w - 8; bx += 12) ctx.fillRect(bx, y + 5, 2, 4);
  }

  // Goal flag
  if (pl.type === 'goal') {
    const ft = performance.now() / 300;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + w / 2 - 1, y - 28, 2, 28);
    ctx.fillStyle = Math.sin(ft) > 0 ? '#ff4444' : '#ff8800';
    ctx.fillRect(x + w / 2 + 1, y - 28, 14, 10);
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(x + w / 2 + 6, y - 24, 3, 3);
    ctx.fillStyle = 'rgba(255,204,0,0.12)';
    ctx.fillRect(x - 10, y - 40, w + 20, 50);
  }

  // Bounce pulse
  if (pl.type === 'bounce') {
    const pulse = Math.sin(performance.now() / 280) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(0,255,204,${(pulse * 0.35).toFixed(2)})`;
    ctx.fillRect(x, y - Math.floor(pulse * 4), w, 3);
  }
}

function drawPlayer(p, pal, camY) {
  const px  = Math.round(p.x);
  const py  = Math.round(p.y - camY);
  const bobY = p.onGround ? Math.round(Math.sin(p.animT * 0.3)) : 0;

  // Trail
  p.trail.forEach((t, i) => {
    const a = ((i / p.trail.length) * 0.35).toFixed(2);
    ctx.fillStyle = `rgba(${parseInt(pal.player.slice(1,3),16)},${parseInt(pal.player.slice(3,5),16)},${parseInt(pal.player.slice(5,7),16)},${a})`;
    ctx.fillRect(t.x, t.y - camY, 4, 4);
  });

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(px + 2, py + p.h, 12, 3);

  const c = pal.player;

  // Head
  ctx.fillStyle = c;
  ctx.fillRect(px + 2, py + bobY, 12, 10);
  // Outline pixels
  ctx.fillStyle = '#000000';
  ctx.fillRect(px + 2, py + bobY, 1, 1);
  ctx.fillRect(px + 13, py + bobY, 1, 1);
  // Eye
  ctx.fillStyle = '#000000';
  if (p.facing > 0) ctx.fillRect(px + 9, py + 3 + bobY, 2, 2);
  else              ctx.fillRect(px + 5, py + 3 + bobY, 2, 2);

  // Body
  ctx.fillStyle = hexDarken(c, 30);
  ctx.fillRect(px + 3, py + 10 + bobY, 10, 10);

  // Legs
  const legAnim = p.onGround ? Math.round(Math.sin(p.animT * 0.5) * 3) : 0;
  ctx.fillStyle = c;
  ctx.fillRect(px + 3, py + 20 + bobY + legAnim, 4, 5);
  ctx.fillRect(px + 9, py + 20 + bobY - legAnim, 4, 5);
}

/* ============================================================
   SECTION 10: LEVEL SELECT BUILDER (XSS-safe)
   ============================================================ */

function buildLevelGrid(progress) {
  const grid = document.getElementById('level-grid');
  if (!grid) return;
  grid.innerHTML = ''; // safe — no user data injected below

  LEVEL_DEFS.forEach((lv, i) => {
    const btn       = document.createElement('button');
    const unlocked  = i < progress.unlocked;
    const completed = progress.best[i] !== undefined;

    btn.className = 'level-btn' +
      (unlocked  ? ' unlocked'  : ' locked') +
      (completed ? ' completed' : '');
    btn.setAttribute('role', 'listitem');
    btn.setAttribute('aria-label', `Level ${i + 1}: ${lv.name}${!unlocked ? ' (locked)' : ''}`);
    btn.setAttribute('aria-disabled', String(!unlocked));

    // Icon span
    const iconSpan = document.createElement('span');
    iconSpan.className = 'level-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = lv.icon; // emoji only — safe

    // Number span
    const numSpan = document.createElement('span');
    numSpan.textContent = String(i + 1);

    btn.appendChild(iconSpan);
    btn.appendChild(numSpan);

    if (unlocked) btn.addEventListener('click', () => Game.start(i));
    grid.appendChild(btn);
  });
}

/* ============================================================
   SECTION 11: CORE GAME OBJECT
   ============================================================ */

const Game = (() => {
  let state        = null;
  let animId       = null;
  let levelIndex   = 0;
  let sessionFalls = 0;
  let bestHeight   = 0;
  let progress     = loadProgress();

  // ---- Navigation ----
  function showTitle() {
    Input.reset();
    showScreen('title-screen');
  }

  function showLevelSelect() {
    Input.reset();
    buildLevelGrid(progress);
    showScreen('level-select');
  }

  function showHowToPlay() { showScreen('howto-screen'); }

  // ---- Level entry ----
  function start(idx) {
    // Validate index — never trust caller
    idx = Math.max(0, Math.min(idx, LEVEL_DEFS.length - 1));
    // Prevent skipping locked levels
    if (idx >= progress.unlocked) idx = progress.unlocked - 1;

    levelIndex   = idx;
    sessionFalls = 0;
    bestHeight   = 0;

    showScreen('game-screen');
    resizeCanvas();
    updateTouchControls();

    const gameScreen = document.getElementById('game-screen');
    if (gameScreen) gameScreen.style.background = LEVEL_DEFS[idx].bg;

    _load(idx);
  }

  function _load(idx) {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    Input.reset();

    const level        = generateLevel(idx);
    const spawnPad     = level.platforms[1];

    state = {
      level,
      cameraY: 0,
      crumbled: new Set(),
      timer: 0,
      player: {
        x: spawnPad.x + spawnPad.w / 2 - 8,
        y: spawnPad.y - 32,
        w: 16, h: 24,
        vx: 0, vy: 0,
        onGround: false,
        jumpsLeft: 2,
        facing: 1,
        animT: 0,
        trail: [],
        _jumpHeld: false,
      },
    };

    setText('hud-level', idx + 1);
    setText('hud-falls', sessionFalls);
    _loop();
  }

  function restart() {
    if (!document.getElementById('game-screen').classList.contains('active') &&
        !document.getElementById('death-screen').classList.contains('active')) return;
    _load(levelIndex);
    showScreen('game-screen');
  }

  function exit() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    Input.reset();
    showTitle();
  }

  function nextLevel() {
    const next = levelIndex + 1;
    if (next < LEVEL_DEFS.length) start(next);
    else showTitle();
  }

  // ---- Game loop ----
  function _loop() {
    animId = requestAnimationFrame(_loop);
    if (!state) return;

    const p     = state.player;
    const level = state.level;
    const pal   = PALETTES[levelIndex] || PALETTES[0];
    const def   = level.def;

    state.timer++;
    p.animT++;

    // Input
    if (Input.left)  { p.vx = -PHYSICS.MOVE_SPEED; p.facing = -1; }
    else if (Input.right) { p.vx = PHYSICS.MOVE_SPEED; p.facing = 1; }
    else { p.vx *= 0.7; }

    if (Input.jump && !Input.jumpConsumed && p.jumpsLeft > 0) {
      p.vy = PHYSICS.JUMP_FORCE * (p.jumpsLeft === 2 ? 1 : 0.85);
      p.jumpsLeft--;
      Input.consumeJump();
    }
    if (!Input.jump) {
      // Allow re-jump on next press
    }

    p.vy += PHYSICS.GRAVITY;
    if (p.vy > PHYSICS.MAX_FALL) p.vy = PHYSICS.MAX_FALL;

    p.x += p.vx;
    p.y += p.vy;

    // Wall bounds
    if (p.x < 0)                        { p.x = 0;                            p.vx = 0; }
    if (p.x + p.w > CANVAS.LOGICAL_W)   { p.x = CANVAS.LOGICAL_W - p.w;      p.vx = 0; }

    // Collision
    p.onGround = false;
    let hitGoal = false;

    level.platforms.forEach((pl, idx) => {
      if (state.crumbled.has(idx)) return;

      // Move platform
      if (pl.type === 'moving') {
        pl.moveT += 0.02;
        pl.x = pl.ox + Math.sin(pl.moveT) * pl.moveRange;
      }

      if (p.x + p.w > pl.x && p.x < pl.x + pl.w &&
          p.y + p.h > pl.y && p.y + p.h < pl.y + pl.h + 8 &&
          p.vy >= 0) {
        p.y = pl.y - p.h;
        p.vy = 0;
        p.onGround = true;
        p.jumpsLeft = 2;

        if (pl.type === 'crumble') {
          const capIdx = idx;
          setTimeout(() => { if (state) state.crumbled.add(capIdx); }, 280);
        }
        if (pl.type === 'bounce') {
          p.vy = PHYSICS.JUMP_FORCE * 1.4;
          p.jumpsLeft = 2;
        }
        if (pl.type === 'goal') hitGoal = true;
      }
    });

    if (hitGoal) { _win(); return; }

    // Trail
    p.trail.push({ x: Math.round(p.x + p.w / 2 - 2), y: Math.round(p.y + p.h / 2) });
    if (p.trail.length > 8) p.trail.shift();

    // Camera
    const targetCamY = p.y - CANVAS.LOGICAL_H * 0.6;
    state.cameraY += (targetCamY - state.cameraY) * 0.1;

    // HUD
    const currentHeight = Math.max(0, Math.round((level.totalHeight - p.y) / 10));
    if (currentHeight > bestHeight) bestHeight = currentHeight;
    setText('hud-height', currentHeight + 'm');
    setText('hud-best',   (progress.best[levelIndex] || 0) + 'm');
    const pct = Math.min(100, Math.max(0, (1 - p.y / level.totalHeight) * 100));
    setStyle('hud-progress', 'width', pct + '%');

    // Death
    if (p.y > level.totalHeight + PHYSICS.FALL_DEATH) { _die(); return; }

    // ---- DRAW ----
    ctx.clearRect(0, 0, CANVAS.LOGICAL_W, CANVAS.LOGICAL_H);
    ctx.fillStyle = def.bg;
    ctx.fillRect(0, 0, CANVAS.LOGICAL_W, CANVAS.LOGICAL_H);
    drawBackground(def, state.cameraY, level.totalHeight);
    level.platforms.forEach((pl, idx) => drawPlatform(pl, idx, pal, state.cameraY, state.crumbled));
    drawPlayer(p, pal, state.cameraY);

    // Height indicator bar
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(CANVAS.LOGICAL_W - 6, 0, 4, CANVAS.LOGICAL_H);
    ctx.fillStyle = def.color + 'aa';
    const barH = (1 - p.y / level.totalHeight) * CANVAS.LOGICAL_H;
    ctx.fillRect(CANVAS.LOGICAL_W - 6, CANVAS.LOGICAL_H - Math.max(0, barH), 4, Math.max(0, barH));
  }

  function _die() {
    cancelAnimationFrame(animId); animId = null;
    sessionFalls++;
    if (bestHeight > (progress.best[levelIndex] || 0)) {
      progress.best[levelIndex] = bestHeight;
      saveProgress(progress);
    }
    setText('hud-falls', sessionFalls);
    setText('death-quote', DEATH_QUOTES[Math.floor(Math.random() * DEATH_QUOTES.length)]);
    setText('death-stats',
      `BEST: ${progress.best[levelIndex] || 0}m\nFALLS: ${sessionFalls}`);
    showScreen('death-screen');
  }

  function _win() {
    cancelAnimationFrame(animId); animId = null;
    const finalH = Math.max(0, Math.round((state.level.totalHeight - state.player.y) / 10));
    if (finalH > (progress.best[levelIndex] || 0)) progress.best[levelIndex] = finalH;
    if (levelIndex + 1 >= progress.unlocked && levelIndex + 1 < LEVEL_DEFS.length) {
      progress.unlocked = levelIndex + 1;
    }
    saveProgress(progress);

    const stars = sessionFalls === 0 ? 3 : sessionFalls <= 3 ? 2 : 1;
    setText('win-msg',   levelIndex === 7 ? '🏔 SUMMIT CONQUERED! 🏔' : 'LEVEL CLEAR!');
    setText('win-stats', `FALLS: ${sessionFalls}  •  HEIGHT: ${finalH}m`);
    setText('win-stars', '★'.repeat(stars) + '☆'.repeat(3 - stars));
    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.style.display = levelIndex < LEVEL_DEFS.length - 1 ? '' : 'none';
    showScreen('win-screen');
  }

  return { start, restart, exit, nextLevel, showTitle, showLevelSelect, showHowToPlay };
})();

/* ============================================================
   SECTION 12: BUTTON EVENT BINDINGS
   ============================================================ */

function bindBtn(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', fn);
  // Touch fast-tap (avoid 300ms delay)
  el.addEventListener('touchend', (e) => { e.preventDefault(); fn(); });
}

bindBtn('btn-start',       () => Game.showLevelSelect());
bindBtn('btn-howto',       () => Game.showHowToPlay());
bindBtn('btn-howto-back',  () => showScreen('title-screen'));
bindBtn('btn-lvl-back',    () => showScreen('title-screen'));
bindBtn('btn-hud-quit',    () => Game.exit());
bindBtn('btn-retry',       () => Game.restart());
bindBtn('btn-death-levels',() => Game.showLevelSelect());
bindBtn('btn-next',        () => Game.nextLevel());
bindBtn('btn-win-levels',  () => Game.showLevelSelect());

/* ============================================================
   SECTION 13: INIT
   ============================================================ */

resizeCanvas();
updateTouchControls();
showScreen('title-screen');
