// Cloze Call V2 — main menu, how-to-play, about.
// design-v2.md §9 + §19 answers 1 (reuse intro1.png) and 2 (terse how-to).

import { GameState } from './gsm.js';
import { loadImage, drawImage } from './pictures.js';
import { SCREEN_WIDTH, SCREEN_HEIGHT, LS_SEEN_INTRO } from './config.js';
import { consumePointerReleased, pointerPosition, pointerHovering, pointerPressed, resetPointerState, setCoordinateTransform } from './input.js';
import * as session from './session.js';
import * as audio from './audio.js';

// Inverse of the uniform-scaling transform used to render 800×600 design
// content centered on an arbitrarily-sized canvas.
const makeDesignTransform = (canvas) => (canvasX, canvasY) => {
  const cw = canvas.width, ch = canvas.height;
  const s = Math.min(cw / 800, ch / 600);
  return [(canvasX - (cw - 800 * s) / 2) / s, (canvasY - (ch - 600 * s) / 2) / s];
};

const pointInRect = (px, py, r) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

// Draw a cover-scaled background across the full canvas with a translucent
// vignette. Called BEFORE the uniform-scaling ctx.save/translate/scale so it
// covers the entire viewport including non-4:3 margins.
const drawMenuBackground = (ctx, background) => {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, cw, ch);
  if (background && background.complete) {
    const iw = background.naturalWidth || background.width;
    const ih = background.naturalHeight || background.height;
    if (iw && ih) {
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(background, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, cw, ch);
};

const drawCenteredText = (ctx, text, x, y, { size = 24, weight = 'normal', color = 'white', align = 'center' } = {}) => {
  ctx.font = `${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
};

const drawButton = (ctx, rect, label, { hovered = false, size = 22 } = {}) => {
  const bg = hovered ? 'rgba(80, 120, 180, 0.95)' : 'rgba(40, 60, 100, 0.85)';
  ctx.fillStyle = bg;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  drawCenteredText(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, { size });
};

// ============================================================================
// MainMenuState
// ============================================================================

export class MainMenuState extends GameState {
  constructor() {
    super();
    this.background = null;
    this.buttons = null;
    this.hoverIdx = -1;
    this.prevHoverIdx = -1;
  }

  initializeState(gsm) {
    this.background = loadImage('intro1.png');
    this.buttons = this.computeButtons();
    setCoordinateTransform(makeDesignTransform(gsm.canvas));
    resetPointerState();
  }

  computeButtons() {
    const w = 320, h = 56, gap = 16;
    const total = h * 3 + gap * 2;
    const startY = SCREEN_HEIGHT / 2 - total / 2 + 40;
    const cx = SCREEN_WIDTH / 2;
    return [
      { id: 'play',  x: cx - w / 2, y: startY,                      w, h, label: 'PLAY' },
      { id: 'help',  x: cx - w / 2, y: startY + (h + gap),          w, h, label: 'HOW TO PLAY' },
      { id: 'about', x: cx - w / 2, y: startY + (h + gap) * 2,      w, h, label: 'ABOUT' },
    ];
  }

  updateLogic(gsm, _dt) {
    // Update hover highlight (mouse only — touch never "hovers").
    const p = pointerPosition();
    const newHover = pointerHovering()
      ? this.buttons.findIndex(b => pointInRect(p[0], p[1], b))
      : -1;
    if (newHover !== this.prevHoverIdx) {
      if (newHover !== -1) audio.sfxMenuHover();
      this.prevHoverIdx = newHover;
    }
    this.hoverIdx = newHover;

    const release = consumePointerReleased();
    if (release) {
      const btn = this.buttons.find(b => pointInRect(release.pos[0], release.pos[1], b));
      if (btn) {
        audio.sfxMenuClick();
        this.activateButton(gsm, btn.id);
      }
    }
  }

  onKey(gsm, key) {
    if (key === 'Space' || key === 'Enter' || key === 'NumpadEnter') {
      audio.sfxMenuClick();
      this.activateButton(gsm, 'play');
    }
  }

  onSkip(gsm) {
    // Space/Enter via the GSM's skip dispatch also start PLAY, same as onKey.
    // Slightly redundant but keeps the "skip intent" path uniform.
    audio.sfxMenuClick();
    this.activateButton(gsm, 'play');
  }

  activateButton(gsm, id) {
    if (id === 'play') {
      session.newRun();
      // Show intro pair on the first play of the browser-persistent lifetime,
      // skip directly into the game on subsequent plays.
      let seenIntro = false;
      try { seenIntro = localStorage.getItem(LS_SEEN_INTRO) === '1'; } catch {}
      if (seenIntro) {
        gsm.changeState('main-game');
      } else {
        try { localStorage.setItem(LS_SEEN_INTRO, '1'); } catch {}
        gsm.changeState('intro-screen');
      }
    } else if (id === 'help') {
      gsm.changeState('how-to-play');
    } else if (id === 'about') {
      gsm.changeState('about');
    }
  }

  render(ctx, _gsm) {
    // Full-canvas background (screen space, before scaling).
    drawMenuBackground(ctx, this.background);

    // Uniform scaling: center 800×600 design space on the canvas.
    ctx.save();
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const s = Math.min(cw / 800, ch / 600);
    ctx.translate((cw - 800 * s) / 2, (ch - 600 * s) / 2);
    ctx.scale(s, s);

    // Title.
    drawCenteredText(ctx, 'CLOZE CALL', SCREEN_WIDTH / 2, 120, { size: 54, color: 'rgba(255,255,255,0.95)' });
    drawCenteredText(ctx, 'v2 (ng)',     SCREEN_WIDTH / 2, 160, { size: 16, color: 'rgba(255,255,255,0.5)' });

    // Buttons.
    this.buttons.forEach((b, i) => {
      drawButton(ctx, b, b.label, { hovered: i === this.hoverIdx, size: 22 });
    });

    // Best streak footer.
    if (session.getBest() > 0) {
      drawCenteredText(ctx, `BEST STREAK: ${session.getBest()}`, SCREEN_WIDTH / 2, SCREEN_HEIGHT - 48,
        { size: 18, color: 'rgba(255,255,255,0.8)' });
    }
    drawCenteredText(ctx, 'mouse · touch · keyboard supported',
      SCREEN_WIDTH / 2, SCREEN_HEIGHT - 22, { size: 12, color: 'rgba(255,255,255,0.45)' });

    ctx.restore();
  }
}

// ============================================================================
// HowToPlayState — terse one-screen instructions. design-v2.md §19 answer #2.
// ============================================================================

const HOW_TO_LINES = [
  'AIM     · hover or drag from the ball',
  'FIRE    · click or release touch',
  'GOAL    · land the ball in the wormhole',
  'AVOID   · planets & empty space',
  'LIVES   · three per level',
  'STREAK  · consecutive wins; resets on defeat',
  '',
  'ESC back to menu · M mute · SPACE/ENTER advance',
];

export class HowToPlayState extends GameState {
  initializeState(gsm) {
    this.background = loadImage('intro1.png');
    setCoordinateTransform(makeDesignTransform(gsm.canvas));
    resetPointerState();
  }

  updateLogic(gsm, _dt) {
    if (consumePointerReleased()) {
      audio.sfxMenuClick();
      gsm.changeState('main-menu');
    }
  }

  onKey(gsm, key) {
    if (key === 'Escape' || key === 'Space' || key === 'Enter' || key === 'NumpadEnter') {
      audio.sfxMenuClick();
      gsm.changeState('main-menu');
    }
  }

  onSkip(gsm) {
    audio.sfxMenuClick();
    gsm.changeState('main-menu');
  }

  render(ctx, _gsm) {
    drawMenuBackground(ctx, this.background);

    ctx.save();
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const s = Math.min(cw / 800, ch / 600);
    ctx.translate((cw - 800 * s) / 2, (ch - 600 * s) / 2);
    ctx.scale(s, s);

    drawCenteredText(ctx, 'HOW TO PLAY', SCREEN_WIDTH / 2, 90, { size: 40 });

    ctx.font = '18px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const x = SCREEN_WIDTH / 2 - 230;
    let y = 170;
    for (const line of HOW_TO_LINES) {
      ctx.fillText(line, x, y);
      y += 28;
    }

    drawCenteredText(ctx, 'tap / space / esc — back', SCREEN_WIDTH / 2, SCREEN_HEIGHT - 30,
      { size: 14, color: 'rgba(255, 255, 255, 0.55)' });
    ctx.restore();
  }
}

// ============================================================================
// AboutState
// ============================================================================

const ABOUT_LINES = [
  'Cloze Call — gravity golf by the closed-box coffee cup',
  '',
  'Originally a 2010 Lisp + lispbuilder-sdl hackathon game.',
  'v1 web port — faithful reproduction of the original.',
  'v2 web port — mobile, 60 Hz, aim preview, HUD, audio.',
  '',
  'Source art from the original project.',
  'See design.md and design-v2.md for the full story.',
];

export class AboutState extends GameState {
  initializeState(gsm) {
    this.background = loadImage('intro1.png');
    setCoordinateTransform(makeDesignTransform(gsm.canvas));
    resetPointerState();
  }

  updateLogic(gsm, _dt) {
    if (consumePointerReleased()) {
      audio.sfxMenuClick();
      gsm.changeState('main-menu');
    }
  }

  onKey(gsm, key) {
    if (key === 'Escape' || key === 'Space' || key === 'Enter' || key === 'NumpadEnter') {
      audio.sfxMenuClick();
      gsm.changeState('main-menu');
    }
  }

  onSkip(gsm) {
    audio.sfxMenuClick();
    gsm.changeState('main-menu');
  }

  render(ctx, _gsm) {
    drawMenuBackground(ctx, this.background);

    ctx.save();
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const s = Math.min(cw / 800, ch / 600);
    ctx.translate((cw - 800 * s) / 2, (ch - 600 * s) / 2);
    ctx.scale(s, s);

    drawCenteredText(ctx, 'ABOUT', SCREEN_WIDTH / 2, 90, { size: 40 });

    ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let y = 170;
    for (const line of ABOUT_LINES) {
      ctx.fillText(line, SCREEN_WIDTH / 2, y);
      y += 26;
    }

    drawCenteredText(ctx, 'tap / space / esc — back', SCREEN_WIDTH / 2, SCREEN_HEIGHT - 30,
      { size: 14, color: 'rgba(255, 255, 255, 0.55)' });
    ctx.restore();
  }
}
