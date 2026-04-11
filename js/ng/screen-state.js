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
    // Trigger any per-screen sfx on entry. Deliberately not gated on "audio
    // initialized yet" — audio.ensureAudio() called from cloze-call.js's
    // first-pointerdown handler makes this a no-op if the user hasn't touched
    // the game yet.
    if (this.sfx) {
      try { this.sfx(); } catch {}
    }
    // Clear any leftover pointer press from the previous state so the screen
    // isn't insta-skipped by a still-held touch.
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
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    drawImage(ctx, this.bigPicture);

    // Overlay alpha: 1 at fade-in start -> 0 at fade-in end; 0 throughout
    // hold; 0 -> 1 during fade-out.
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

    // Little hint text after min-display-time has passed so players know
    // they can skip (mouse/touch users especially).
    if (this.phase !== 'fade-out' && this.totalT >= SCREEN_MIN_DISPLAY_TIME) {
      ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.skipHint(), SCREEN_WIDTH / 2, SCREEN_HEIGHT - 14);
    }
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
    // A simple "NEXT ▶" button graphic drawn after the hint so it's visible.
    if (this.phase === 'fade-out' || this.totalT < SCREEN_MIN_DISPLAY_TIME) return;
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
  }
}

// Defeat auto-advances back to the main menu after its hold timer. End-of-run
// bookkeeping (commit best, reset streak) runs as the state exits.
export class DefeatedState extends ScreenGameState {
  constructor({ nextState }) {
    super({
      pictureName: 'defeated.png',
      nextState,
      sfx: audio.sfxLose,
    });
  }

  deinitializeState(_gsm) {
    session.endRun();
  }
}
