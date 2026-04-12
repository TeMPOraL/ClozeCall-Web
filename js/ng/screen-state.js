// Cloze Call V2 — full-screen image state with three-phase timeline.
// design-v2.md §12. Replaces v1's simple timer. Each instance has
// fade-in -> hold -> fade-out phases and responds to skip (space/enter/tap).

import { GameState } from './gsm.js';
import { loadImage, drawImage } from './pictures.js';
import {
  DEFAULT_GAME_SCREEN_TIME, SCREEN_WIDTH, SCREEN_HEIGHT,
  FADE_IN_DURATION, FADE_OUT_DURATION, SCREEN_MIN_DISPLAY_TIME,
} from './config.js';
import * as audio from './audio.js';
import { resetPointerState, consumePointerReleased } from './input.js';
import * as session from './session.js';

// Helper: convert canvas-pixel coords to 800×600 design coords using the
// same uniform-scaling transform that render applies.
const canvasToDesign = (cx, cy, canvas) => {
  const cw = canvas.width, ch = canvas.height;
  const s = Math.min(cw / 800, ch / 600);
  return [(cx - (cw - 800 * s) / 2) / s, (cy - (ch - 600 * s) / 2) / s];
};

const pointInRect = (px, py, r) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

export class ScreenGameState extends GameState {
  constructor({ pictureName, nextState, holdDuration = DEFAULT_GAME_SCREEN_TIME, sfx = null }) {
    super();
    if (!pictureName) throw new Error('Game screen needs to have a picture specified.');
    this.pictureName = pictureName;
    this.nextState = nextState;
    this.holdDuration = holdDuration;
    this.sfx = sfx;        // e.g. audio.sfxWin, audio.sfxLose
    this.bigPicture = null;
    this.phase = 'fade-in';
    this.phaseT = 0;
    this.totalT = 0;
  }

  initializeState(gsm) {
    this.bigPicture = loadImage(this.pictureName);
    this.phase = 'fade-in';
    this.phaseT = 0;
    this.totalT = 0;
    if (this.sfx) {
      try { this.sfx(); } catch {}
    }
    resetPointerState();
  }

  updateLogic(gsm, dt) {
    this.phaseT += dt;
    this.totalT += dt;
    // Poll for a pointer tap: after min-display-time, any release advances.
    if (this.phase !== 'fade-out' && this.totalT >= SCREEN_MIN_DISPLAY_TIME) {
      if (consumePointerReleased()) {
        this.phase = 'fade-out';
        this.phaseT = 0;
      }
    }
    if (this.phase === 'fade-in' && this.phaseT >= FADE_IN_DURATION) {
      this.phase = 'hold';
      this.phaseT = 0;
    } else if (this.phase === 'hold' && this.phaseT >= this.holdDuration) {
      this.phase = 'fade-out';
      this.phaseT = 0;
    } else if (this.phase === 'fade-out' && this.phaseT >= FADE_OUT_DURATION) {
      gsm.changeState(this.nextState);
    }
  }

  // Shared by input.js pointerup and keyboard Space/Enter.
  onSkip(_gsm) {
    if (this.phase === 'fade-out') return;
    if (this.totalT < SCREEN_MIN_DISPLAY_TIME) return;
    this.phase = 'fade-out';
    this.phaseT = 0;
  }

  render(ctx, gsm) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;

    // Black fill across the entire canvas.
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, cw, ch);

    // Uniform scaling: center 800×600 design content on the canvas.
    ctx.save();
    const s = Math.min(cw / 800, ch / 600);
    ctx.translate((cw - 800 * s) / 2, (ch - 600 * s) / 2);
    ctx.scale(s, s);

    drawImage(ctx, this.bigPicture);

    // Fade overlay (within design space — surrounding black stays black).
    let alpha = 0;
    if (this.phase === 'fade-in') {
      alpha = 1 - (this.phaseT / FADE_IN_DURATION);
    } else if (this.phase === 'fade-out') {
      alpha = this.phaseT / FADE_OUT_DURATION;
    }
    if (alpha > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    }

    // Skip hint after min-display-time.
    if (this.phase !== 'fade-out' && this.totalT >= SCREEN_MIN_DISPLAY_TIME) {
      ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.skipHint(), SCREEN_WIDTH / 2, SCREEN_HEIGHT - 14);
    }

    ctx.restore();
  }

  // Overridable hint text.
  skipHint() {
    return 'tap / space / enter to continue';
  }
}

// design-v2.md §9.4 + §19 answer #3: victory holds indefinitely and requires
// an explicit NEXT tap/key. holdDuration = Infinity disables the hold-timer
// auto-advance; the player's skip triggers fade-out just like any other screen.
export class VictoryState extends ScreenGameState {
  constructor({ nextState }) {
    super({
      pictureName: 'victorious.png',
      nextState,
      holdDuration: Infinity,
      sfx: audio.sfxWin,
    });
  }

  // Called by the GSM after fade-out completes, right before main-game inits.
  // Bumping the streak here means main-game.initializeState reads the new
  // value when it regenerates the level.
  deinitializeState(_gsm) {
    session.winLevel();
  }

  skipHint() {
    return 'NEXT LEVEL — tap / space / enter';
  }

  render(ctx, gsm) {
    super.render(ctx, gsm);
    // "NEXT ▶" button drawn after the parent's render so it's on top.
    if (this.phase === 'fade-out' || this.totalT < SCREEN_MIN_DISPLAY_TIME) return;

    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.save();
    const s = Math.min(cw / 800, ch / 600);
    ctx.translate((cw - 800 * s) / 2, (ch - 600 * s) / 2);
    ctx.scale(s, s);

    const bw = 240, bh = 56;
    const bx = SCREEN_WIDTH / 2 - bw / 2;
    const by = SCREEN_HEIGHT - 120;
    ctx.fillStyle = 'rgba(30, 90, 50, 0.85)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = 'white';
    ctx.font = '22px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`NEXT \u25B6  (streak \u2192 ${session.getStreak() + 1})`, SCREEN_WIDTH / 2, by + bh / 2);

    ctx.restore();
  }
}

// design-v2.md §9.4: Defeat holds indefinitely with RETRY / MENU buttons.
// RETRY replays the same level layout. MENU returns to main menu.
const RETRY_BTN = { x: 400 - 240 / 2, y: 450, w: 240, h: 48 };
const MENU_BTN  = { x: 400 - 240 / 2, y: 510, w: 240, h: 48 };

export class DefeatedState extends ScreenGameState {
  constructor({ nextState }) {
    super({
      pictureName: 'defeated.png',
      nextState,                 // 'main-menu' (default for MENU button)
      holdDuration: Infinity,    // require explicit choice
      sfx: audio.sfxLose,
    });
  }

  // Override: don't auto-skip on any tap — check specific buttons instead.
  updateLogic(gsm, dt) {
    this.phaseT += dt;
    this.totalT += dt;

    if (this.phase === 'fade-in' && this.phaseT >= FADE_IN_DURATION) {
      this.phase = 'hold';
      this.phaseT = 0;
    } else if (this.phase === 'fade-out' && this.phaseT >= FADE_OUT_DURATION) {
      gsm.changeState(this.nextState);
    }

    if (this.phase === 'fade-out' || this.totalT < SCREEN_MIN_DISPLAY_TIME) return;

    const release = consumePointerReleased();
    if (!release) return;

    // Convert raw canvas-pixel coords to 800×600 design space for hit-test.
    const [dx, dy] = canvasToDesign(release.raw[0], release.raw[1], gsm.canvas);
    if (pointInRect(dx, dy, RETRY_BTN)) {
      this.doRetry(gsm);
    } else if (pointInRect(dx, dy, MENU_BTN)) {
      this.doMenu(gsm);
    }
  }

  // Override: no generic skip — map to specific actions.
  onSkip(_gsm) { /* disabled — use RETRY/MENU buttons or keyboard */ }

  onKey(gsm, key) {
    if (this.phase === 'fade-out' || this.totalT < SCREEN_MIN_DISPLAY_TIME) return;
    if (key === 'KeyR' || key === 'Space' || key === 'Enter' || key === 'NumpadEnter') {
      this.doRetry(gsm);
    } else if (key === 'Escape') {
      this.doMenu(gsm);
    }
  }

  doRetry(gsm) {
    session.requestRetry();
    this.nextState = 'main-game';
    this.phase = 'fade-out';
    this.phaseT = 0;
  }

  doMenu(gsm) {
    this.nextState = 'main-menu';
    this.phase = 'fade-out';
    this.phaseT = 0;
  }

  deinitializeState(_gsm) {
    session.endRun();
  }

  skipHint() {
    return 'R / SPACE = retry · ESC = menu';
  }

  render(ctx, gsm) {
    super.render(ctx, gsm);
    if (this.phase === 'fade-out' || this.totalT < SCREEN_MIN_DISPLAY_TIME) return;

    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.save();
    const s = Math.min(cw / 800, ch / 600);
    ctx.translate((cw - 800 * s) / 2, (ch - 600 * s) / 2);
    ctx.scale(s, s);

    const drawBtn = (rect, label, accent) => {
      ctx.fillStyle = accent ? 'rgba(30, 90, 50, 0.85)' : 'rgba(60, 80, 120, 0.85)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = 'white';
      ctx.font = '22px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
    };

    drawBtn(RETRY_BTN, 'RETRY (R)', true);
    drawBtn(MENU_BTN, 'MENU (Esc)', false);

    // Show streak info.
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`streak: ${session.getStreak()}  ·  best: ${session.getBest()}`, SCREEN_WIDTH / 2, 430);

    ctx.restore();
  }
}
