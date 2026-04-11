// Cloze Call V2 — run session state.
// Tracks lives, streak, best-streak for the current run. Persists best-streak
// to localStorage. Used by MainGameState, ScreenGameState subclasses, and the
// main menu.
//
// design-v2.md §10.

import { LS_BEST_STREAK, LIVES_PER_LEVEL } from './config.js';

// In-memory run session.
const session = {
  lives: LIVES_PER_LEVEL,
  streak: 0,
  best: 0,
  // Seed captured at the start of the current level — used by the future
  // share-this-level button. Stored as a raw uint32.
  currentLevelSeed: 0,
};

// ---- Best-streak persistence ----

const loadBest = () => {
  try {
    const v = localStorage.getItem(LS_BEST_STREAK);
    if (v !== null) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0) session.best = n;
    }
  } catch { /* swallow */ }
};

const saveBest = () => {
  try { localStorage.setItem(LS_BEST_STREAK, String(session.best)); } catch {}
};

loadBest();

// ---- Queries ----

export const getLives  = () => session.lives;
export const getStreak = () => session.streak;
export const getBest   = () => session.best;
export const getCurrentLevelSeed = () => session.currentLevelSeed;

// ---- Mutations ----

// Called when entering a new level (fresh level, not a retry).
export const startLevel = (seed) => {
  session.lives = LIVES_PER_LEVEL;
  session.currentLevelSeed = seed >>> 0;
};

// Called on planet-collision / off-world. Returns true if the run is over.
export const loseLife = () => {
  session.lives -= 1;
  if (session.lives <= 0) {
    // Run-ending: commit best streak, reset run, keep streak for display
    // until the defeat screen's NEXT finalizes.
    if (session.streak > session.best) {
      session.best = session.streak;
      saveBest();
    }
    return true;
  }
  return false;
};

// Called after victory acknowledgement (NEXT on the victory screen).
export const winLevel = () => {
  session.streak += 1;
};

// Called after defeat screen dismissed, or when player ESCapes from main game.
export const endRun = () => {
  // Make sure best is persisted even if loseLife wasn't the exit path.
  if (session.streak > session.best) {
    session.best = session.streak;
    saveBest();
  }
  session.streak = 0;
  session.lives = LIVES_PER_LEVEL;
};

// Called on main-menu PLAY: fresh run.
export const newRun = () => {
  session.streak = 0;
  session.lives = LIVES_PER_LEVEL;
};
