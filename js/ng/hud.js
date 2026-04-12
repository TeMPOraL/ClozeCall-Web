// Cloze Call V2 — heads-up display.
// design-v2.md §8. Lives, streak, best, mute button. All canvas-drawn.
// The mute button lives next to BEST (§19 answer #5) so this module owns
// both the render AND the hit-test for its icon.

import * as audio from './audio.js';

const HUD_FONT = '18px ui-monospace, Menlo, Consolas, monospace';
const HUD_PAD = 12;
const MUTE_W = 28;
const MUTE_H = 24;

// Compute the mute button rect from the current canvas width.
const muteRect = (canvasW) => ({
  x: canvasW - HUD_PAD - MUTE_W,
  y: HUD_PAD - 4,
  w: MUTE_W,
  h: MUTE_H,
});

// Draw a single HUD text entry with monospace font + drop shadow.
const drawHudText = (ctx, text, x, y, align) => {
  ctx.font = HUD_FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  // Drop shadow: nudged +1,+1 black behind white.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillText(text, x, y);
};

// Render a simple speaker-icon glyph. Crude but recognizable: a box with
// two tiny triangular sound waves (or a slash through it when muted).
const drawMuteIcon = (ctx, muted, canvasW) => {
  const { x, y, w, h } = muteRect(canvasW);
  ctx.save();
  ctx.translate(x, y);

  // Hit-area hint so players can see where to tap. Very subtle.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(0, 0, w, h);

  // Speaker body: a small rectangle + a triangle to the right.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 1.5;

  const cx = w / 2;
  const cy = h / 2;

  // Simple speaker cone: small rect + angled triangle
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - 3);
  ctx.lineTo(cx - 3, cy - 3);
  ctx.lineTo(cx + 2, cy - 7);
  ctx.lineTo(cx + 2, cy + 7);
  ctx.lineTo(cx - 3, cy + 3);
  ctx.lineTo(cx - 8, cy + 3);
  ctx.closePath();
  ctx.fill();

  if (muted) {
    // Draw a diagonal slash through the speaker.
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(1, 1);
    ctx.lineTo(w - 1, h - 1);
    ctx.stroke();
  } else {
    // Draw two small "sound wave" arcs to the right of the speaker.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + 4, cy, 3, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 4, cy, 6, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
  }

  ctx.restore();
};

/**
 * Draw the HUD for a main-game frame.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} info
 * @param {number} info.lives
 * @param {number} info.streak
 * @param {number} info.best
 */
export const renderHud = (ctx, { lives, streak, best }) => {
  const canvasW = ctx.canvas.width;
  // Lives, top-left.
  const hearts = [];
  for (let i = 0; i < 3; i++) hearts.push(i < lives ? '\u2665' : '\u2661');
  drawHudText(ctx, `LIVES ${hearts.join(' ')}`, HUD_PAD, HUD_PAD, 'left');

  // Streak, top-center.
  drawHudText(ctx, `STREAK ${streak}`, canvasW / 2, HUD_PAD, 'center');

  // Best, top-right. Leave room for the mute icon to the right.
  drawHudText(ctx, `BEST ${best}`, canvasW - HUD_PAD - MUTE_W - 8, HUD_PAD, 'right');

  drawMuteIcon(ctx, audio.isMuted(), canvasW);
};

/**
 * Hit-test for the mute icon. (px, py) must be in canvas-pixel coords.
 * main-game.js consults this on pointerup so it can swallow the tap before
 * launching the ball.
 */
export const hudMuteContains = (px, py, canvasW) => {
  const { x, y, w, h } = muteRect(canvasW);
  return px >= x && px <= x + w && py >= y && py <= y + h;
};
