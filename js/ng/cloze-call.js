// Cloze Call V2 — entry point.
// design-v2.md §2 (main loop), §14 (seed-URL parsing), plus state registration.
//
// Responsibilities:
//   1. Parse #seed=... & streak=... from the URL if present.
//   2. Seed the rng deterministically or non-deterministically.
//   3. Preload assets.
//   4. Wire up input + keyboard.
//   5. Register all game states (main-menu, intro1, intro2, main-game,
//      victorious, defeated, how-to-play, about).
//   6. Start the fixed-timestep RAF main loop.

import {
  FIXED_DT_MS, FIXED_DT_SECONDS, MAX_DT_MS,
} from './config.js';
import { preloadAssets } from './assets.js';
import { attachInput } from './input.js';
import { attachKeyboard } from './keyboard.js';
import * as rng from './rng.js';
import * as audio from './audio.js';
import * as session from './session.js';
import { GameStateManager } from './gsm.js';
import { ScreenGameState, VictoryState, DefeatedState } from './screen-state.js';
import { MainGameState } from './main-game.js';
import { MainMenuState, HowToPlayState, AboutState } from './main-menu-state.js';

console.log('Hello from Cloze-Call (ng)');

// ---- URL hash parsing ------------------------------------------------------

// #seed=12345&streak=7 — both optional. Numbers parsed as decimal per
// design-v2.md §19 answer #8.
const parseHash = () => {
  const h = (location.hash || '').replace(/^#/, '');
  if (!h) return {};
  const out = {};
  for (const kv of h.split('&')) {
    const [k, v] = kv.split('=');
    if (!k) continue;
    out[decodeURIComponent(k)] = v === undefined ? '' : decodeURIComponent(v);
  }
  return out;
};

const applyHashConfig = () => {
  const h = parseHash();
  let seedValue;
  if (h.seed !== undefined && h.seed !== '') {
    const n = parseInt(h.seed, 10);
    if (Number.isFinite(n) && n >= 0) {
      seedValue = n >>> 0;
      rng.seed(seedValue);
      console.log(`Seeded PRNG from URL: ${seedValue}`);
    } else {
      seedValue = rng.nondeterministicSeed();
      rng.seed(seedValue);
      console.warn(`Bad #seed=${h.seed}; using nondeterministic seed ${seedValue}`);
    }
  } else {
    seedValue = rng.nondeterministicSeed();
    rng.seed(seedValue);
  }

  // #streak=N — if present, bump session.streak to N so the difficulty ramp
  // starts at the shared level. We cannot set session.streak directly from
  // outside, so we call session.winLevel() N times. Cheap; N is small.
  if (h.streak !== undefined && h.streak !== '') {
    const n = parseInt(h.streak, 10);
    if (Number.isFinite(n) && n > 0) {
      for (let i = 0; i < n; i++) session.winLevel();
      console.log(`Fast-forwarded streak to ${n}`);
    }
  }

  return { startDirect: h.seed !== undefined || h.streak !== undefined };
};

// ---- Boot ------------------------------------------------------------------

const boot = async () => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('status');

  const { startDirect } = applyHashConfig();

  await preloadAssets();
  if (status) status.remove();

  attachInput(canvas);

  // Lazy-init AudioContext on the first user gesture anywhere on the canvas.
  // Browsers require this for autoplay; the listener deregisters itself after
  // firing once.
  const firstGesture = () => {
    audio.ensureAudio();
    canvas.removeEventListener('pointerdown', firstGesture);
  };
  canvas.addEventListener('pointerdown', firstGesture);

  const gsm = new GameStateManager();
  gsm.init();

  attachKeyboard(gsm);

  // Register states.
  gsm.registerState('main-menu', new MainMenuState());
  gsm.registerState('how-to-play', new HowToPlayState());
  gsm.registerState('about', new AboutState());
  gsm.registerState('intro-screen', new ScreenGameState({
    pictureName: 'intro1.png',
    nextState: 'intro-screen-2',
  }));
  gsm.registerState('intro-screen-2', new ScreenGameState({
    pictureName: 'intro2.png',
    nextState: 'main-game',
  }));
  gsm.registerState('main-game', new MainGameState());
  gsm.registerState('victorious', new VictoryState({ nextState: 'main-game' }));
  gsm.registerState('defeated',   new DefeatedState({ nextState: 'main-menu' }));

  // Start in the main menu unless a shared seed/streak is provided, in which
  // case jump straight into gameplay so the share link lands where the sender
  // intended.
  gsm.changeState(startDirect ? 'main-game' : 'main-menu');
  gsm.enforceProperState();

  // Debug hook: expose the GSM under window.__cc for smoke tests and
  // ad-hoc console inspection. Safe in production; harmless if unused.
  window.__cc = { gsm, session, rng, audio };

  // ---- Fixed-timestep main loop (design-v2.md §2) ----
  //
  // Rendering at requestAnimationFrame (usually 60 Hz on standard displays).
  // Physics advanced in discrete FIXED_DT_MS chunks via an accumulator, so
  // the simulation stays deterministic regardless of render cadence.
  //
  // Background tab behavior: RAF pauses; the game pauses with it. That's the
  // right behavior for a real game — v1's setInterval kept running invisibly
  // to work around a preview-environment quirk; v2 doesn't need that.
  let lastTime = performance.now();
  let accumulator = 0;

  const frame = (now) => {
    let frameDt = now - lastTime;
    lastTime = now;
    if (frameDt > MAX_DT_MS) frameDt = MAX_DT_MS;
    accumulator += frameDt;
    while (accumulator >= FIXED_DT_MS) {
      gsm.update(FIXED_DT_SECONDS);
      accumulator -= FIXED_DT_MS;
    }
    gsm.render(ctx);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Fallback poll: if RAF is throttled to near-zero (background tabs, some
  // preview iframes), keep physics and input queues alive. Rendering is
  // still RAF-driven; this only catches update ticks. Hidden tabs wake up
  // at ~1 Hz which is fine for an idle menu.
  const HEARTBEAT_MS = 500;
  setInterval(() => {
    if (document.hidden) {
      // Don't simulate while hidden. Just reset lastTime so the first visible
      // frame's accumulator starts clean.
      lastTime = performance.now();
      accumulator = 0;
    }
  }, HEARTBEAT_MS);

  window.addEventListener('beforeunload', () => {
    console.log('quit event received (ng)');
    gsm.deinit();
  });
};

boot().catch(err => {
  console.error('Boot failed:', err);
  const status = document.getElementById('status');
  if (status) status.textContent = 'Failed to load. Check console.';
});
