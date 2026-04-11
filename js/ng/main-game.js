// Cloze Call V2 — main game state.
// design-v2.md §1..§13 all converge here. Includes:
//   - 60 Hz fixed-timestep physics (via FIXED_DT_SECONDS),
//   - mass-weighted centroid for escape-velocity (§6),
//   - forward-integrated aim preview (§5),
//   - unified 400 px launch cap (§5.3),
//   - edge-arrow + circle-arc off-screen marker (§7),
//   - HUD integration (§8) with clickable mute button,
//   - synthesized sfx at key transitions (§13),
//   - ESC confirmation sub-state (§9.4 / §19 answer #4),
//   - streak-driven level generation (§11, delegated to levels.js).

import { GameState } from './gsm.js';
import {
  SCREEN_WIDTH, SCREEN_HEIGHT,
  G, LAUNCH_SPEED_CAP, FORCE_INDICATOR_1_OVER_MAX,
  OFFWORLD_MAX_DISTANCE_FROM_ORIGIN,
  MARKER_DISTANCE_TO_SCREEN_BORDER,
  MARKER_ROTATION_OFFSET,
} from './config.js';
import {
  makeVec, addVecs, subVecs, negativeVec, scaledVec, normalizedVec,
  distance, vecMag, clamp, square, lerp,
} from './math.js';
import { loadImage, drawImage } from './pictures.js';
import {
  loadLevel, levelGetBackgroundImageName, levelGetCelestialBodies,
  levelGetBall, levelGetHole,
} from './levels.js';
import {
  pointerPosition, pointerPressed, pointerHovering,
  consumePointerReleased, resetPointerState,
} from './input.js';
import * as session from './session.js';
import * as audio from './audio.js';
import * as rng from './rng.js';
import { computeAimPreview, drawAimPreview } from './aim-preview.js';
import { renderHud, hudMuteContains } from './hud.js';

// Color endpoints for the aim line lerp.
const GREEN = { r: 0,   g: 255, b: 0 };
const RED   = { r: 255, g: 0,   b: 0 };
const lerpColor = (a, b, t) => ({
  r: Math.round(lerp(a.r, b.r, t)),
  g: Math.round(lerp(a.g, b.g, t)),
  b: Math.round(lerp(a.b, b.b, t)),
});

// ---- Physics helpers ----

// Euler integrator: velocity += force * dt / mass, position += velocity * dt.
const applyForce = (ball, force, dt) => {
  const accel = scaledVec(force, dt / ball.mass);
  ball.velocity = addVecs(ball.velocity, accel);
  ball.position = addVecs(ball.position, scaledVec(ball.velocity, dt));
};

// Sum of (normalize(ball - body) * body.mass / dist^2) over all bodies.
// Multiplied by G (negative) later to flip into an attractive force.
const computeGravityField = (bodies, ball) => {
  let total = makeVec(0, 0);
  for (const body of bodies) {
    const d = distance(ball.position, body.position);
    if (d === 0) continue;
    const delta = subVecs(ball.position, body.position);
    const dir = normalizedVec(delta);
    total = addVecs(total, scaledVec(dir, body.mass / square(d)));
  }
  return total;
};

const collisionBetweenObjects = (a, b) =>
  distance(a.position, b.position) < a.radius + b.radius;

const anyCollision = (bodies, ball) =>
  bodies.some(b => collisionBetweenObjects(b, ball));

// design-v2.md §6: mass-weighted centroid, not the unweighted average v1 had.
// The total M_total in the escape-velocity numerator is unchanged.
const escapeVelocity = (bodies, ballPosition) => {
  if (bodies.length === 0) return 0;
  let sumX = 0, sumY = 0, totalMass = 0;
  for (const b of bodies) {
    sumX += b.position[0] * b.mass;
    sumY += b.position[1] * b.mass;
    totalMass += b.mass;
  }
  if (totalMass === 0) return 0;
  const com = [sumX / totalMass, sumY / totalMass];
  return Math.sqrt(Math.abs((2 * G * totalMass) / distance(com, ballPosition)));
};

const offworldP = (bodies, ball) => {
  if (distance(ball.position, [0, 0]) <= OFFWORLD_MAX_DISTANCE_FROM_ORIGIN) return false;
  return vecMag(ball.velocity) > escapeVelocity(bodies, ball.position);
};

// Launch velocity: direction = (pointer - ball), magnitude = distance capped
// at LAUNCH_SPEED_CAP (unconditional; no flag in v2).
const computeVelocityFromPositionAndPointer = (position, pointer) => {
  const delta = [pointer[0] - position[0], pointer[1] - position[1]];
  const d = vecMag(delta);
  if (d === 0) return makeVec(0, 0);
  const speed = Math.min(d, LAUNCH_SPEED_CAP);
  return scaledVec(delta, speed / d);
};

const computeForceIndicator = (position, pointer) =>
  clamp(distance(position, pointer) * FORCE_INDICATOR_1_OVER_MAX, 0, 1);

const offscreenP = p =>
  p[0] > SCREEN_WIDTH || p[1] > SCREEN_HEIGHT || p[0] < 0 || p[1] < 0;

// Clamp p into a rectangle inset by MARKER_DISTANCE_TO_SCREEN_BORDER.
// Used as the anchor for the edge-arrow sprite.
const computeEdgeAnchor = p => [
  clamp(p[0], MARKER_DISTANCE_TO_SCREEN_BORDER, SCREEN_WIDTH  - MARKER_DISTANCE_TO_SCREEN_BORDER),
  clamp(p[1], MARKER_DISTANCE_TO_SCREEN_BORDER, SCREEN_HEIGHT - MARKER_DISTANCE_TO_SCREEN_BORDER),
];

// Same quirky "absolute difference from clamped position" used by v1 for
// the circle arc radius. design-v2.md §7 keeps the arc unchanged.
const computeOffscreenArcPoint = p => [
  Math.abs(clamp(p[0], 0, SCREEN_WIDTH)  - MARKER_DISTANCE_TO_SCREEN_BORDER),
  Math.abs(clamp(p[1], 0, SCREEN_HEIGHT) - MARKER_DISTANCE_TO_SCREEN_BORDER),
];

// ---- ESC confirm dialog geometry ----

const CONFIRM_BOX = {
  x: SCREEN_WIDTH / 2 - 180,
  y: SCREEN_HEIGHT / 2 - 80,
  w: 360,
  h: 160,
};
const CONFIRM_YES = { x: SCREEN_WIDTH / 2 - 140, y: SCREEN_HEIGHT / 2 + 10, w: 120, h: 40 };
const CONFIRM_NO  = { x: SCREEN_WIDTH / 2 +  20, y: SCREEN_HEIGHT / 2 + 10, w: 120, h: 40 };
const pointInRect = (px, py, r) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

// ============================================================================

export class MainGameState extends GameState {
  constructor() {
    super();
    this.celestialBodies = [];
    this.ball = null;
    this.hole = null;
    this.backgroundImage = null;
    this.markerImage = null;
    this.state = 'aiming'; // aiming | simulation | confirm-exit
    // `resumeSub` records what we were doing when the ESC dialog opened, so
    // a NO response returns exactly where we were.
    this.resumeSub = 'aiming';
  }

  initializeState(gsm) {
    // Record the seed at the start of this level for the future share button.
    session.startLevel(rng.currentState());

    loadLevel('ng', session.getStreak());
    this.celestialBodies = levelGetCelestialBodies(session.getStreak());
    this.backgroundImage = loadImage(levelGetBackgroundImageName());
    this.markerImage = loadImage('marker.png');
    this.state = 'aiming';
    this.resumeSub = 'aiming';
    this.ball = levelGetBall();
    this.hole = levelGetHole();
    // Drop any lingering press from the previous state.
    resetPointerState();
  }

  // Reset just the ball after a crash. Same planets/hole. Mirrors v1.
  reinitializeGame() {
    this.state = 'aiming';
    this.ball = levelGetBall();
    resetPointerState();
  }

  updateLogic(gsm, dt) {
    switch (this.state) {
      case 'aiming':       this.updateAiming(gsm, dt); break;
      case 'simulation':   this.updateSimulation(gsm, dt); break;
      case 'confirm-exit': this.updateConfirmExit(gsm); break;
    }
  }

  render(ctx, _gsm) {
    // render-common
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    drawImage(ctx, this.backgroundImage);
    for (const b of this.celestialBodies) b.draw(ctx);
    this.hole.draw(ctx);
    this.ball.draw(ctx);

    // Aim overlay (only in aiming).
    if (this.state === 'aiming') this.renderAiming(ctx);
    // Off-screen marker (only while the ball is in flight).
    if (this.state === 'simulation') this.renderSimulation(ctx);

    // HUD on top of gameplay.
    renderHud(ctx, {
      lives:  session.getLives(),
      streak: session.getStreak(),
      best:   session.getBest(),
    });

    // Confirm overlay goes on top of HUD (it's the modal).
    if (this.state === 'confirm-exit') this.renderConfirmExit(ctx);
  }

  // ---- sub-state: aiming ----
  updateAiming(gsm, _dt) {
    const releasePt = consumePointerReleased();
    if (!releasePt) return;

    // HUD mute button: swallow the tap and toggle audio.
    if (hudMuteContains(releasePt[0], releasePt[1])) {
      audio.toggleMute();
      audio.sfxMenuClick();
      return;
    }

    this.ball.velocity = computeVelocityFromPositionAndPointer(this.ball.position, releasePt);
    audio.sfxLaunch();
    this.state = 'simulation';
    this.resumeSub = 'simulation';
  }

  renderAiming(ctx) {
    // design-v2.md §4.2 visibility rule: draw aim overlay when hovering or pressed.
    if (!(pointerHovering() || pointerPressed())) return;
    const p = pointerPosition();

    // Aim preview polyline (forward-integrated trajectory).
    const previewVelocity = computeVelocityFromPositionAndPointer(this.ball.position, p);
    const preview = computeAimPreview({
      startPosition: this.ball.position,
      startVelocity: previewVelocity,
      bodies: this.celestialBodies,
      ballRadius: this.ball.radius,
      ballMass: this.ball.mass,
    });
    drawAimPreview(ctx, preview);

    // Straight aim line, green->red lerp by launch-power.
    const t = computeForceIndicator(this.ball.position, p);
    const col = lerpColor(GREEN, RED, t);
    ctx.strokeStyle = `rgb(${col.r}, ${col.g}, ${col.b})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(this.ball.position[0], this.ball.position[1]);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }

  // ---- sub-state: simulation ----
  updateSimulation(gsm, dt) {
    const field = computeGravityField(this.celestialBodies, this.ball);
    applyForce(this.ball, scaledVec(field, G), dt);

    // Allow a HUD mute-button tap even while the ball is in flight.
    const releasePt = consumePointerReleased();
    if (releasePt && hudMuteContains(releasePt[0], releasePt[1])) {
      audio.toggleMute();
      audio.sfxMenuClick();
    }

    // Outcome detection. Sequential checks — hole > off-world > planet priority.
    let outcome = null;
    if (anyCollision(this.celestialBodies, this.ball)) outcome = 'planet';
    if (offworldP(this.celestialBodies, this.ball))    outcome = 'offworld';
    if (collisionBetweenObjects(this.hole, this.ball)) outcome = 'hole';

    if (outcome === 'planet') {
      audio.sfxPlanetCollide();
      this.handleLifeLoss(gsm);
    } else if (outcome === 'offworld') {
      audio.sfxOffworld();
      this.handleLifeLoss(gsm);
    } else if (outcome === 'hole') {
      audio.sfxWin();
      gsm.changeState('victorious');
    }
  }

  renderSimulation(ctx) {
    const p = this.ball.position;
    if (!offscreenP(p)) return;

    // Circle arc (v1 behavior kept).
    const arcAnchor = computeOffscreenArcPoint(p);
    const delta = addVecs(negativeVec(p), arcAnchor);
    const r = Math.round(vecMag(delta));
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(Math.round(p[0]), Math.round(p[1]), r, 0, Math.PI * 2);
    ctx.stroke();

    // Edge arrow (new in v2, §7): marker.png rotated to point toward the
    // off-screen ball.
    const anchor = computeEdgeAnchor(p);
    const angle = Math.atan2(p[1] - anchor[1], p[0] - anchor[0]) + MARKER_ROTATION_OFFSET;
    ctx.save();
    ctx.translate(anchor[0], anchor[1]);
    ctx.rotate(angle);
    const mw = this.markerImage.naturalWidth  || this.markerImage.width  || 20;
    const mh = this.markerImage.naturalHeight || this.markerImage.height || 20;
    ctx.drawImage(this.markerImage, -mw / 2, -mh / 2);
    ctx.restore();
  }

  // ---- life-loss path shared by planet-collision and off-world ----
  handleLifeLoss(gsm) {
    const runOver = session.loseLife();
    if (runOver) {
      gsm.changeState('defeated');
    } else {
      this.reinitializeGame();
    }
  }

  // ---- sub-state: confirm-exit ----
  updateConfirmExit(gsm) {
    const releasePt = consumePointerReleased();
    if (!releasePt) return;
    if (pointInRect(releasePt[0], releasePt[1], CONFIRM_YES)) {
      this.exitToMenu(gsm);
    } else if (pointInRect(releasePt[0], releasePt[1], CONFIRM_NO)) {
      this.resumeFromConfirm();
    }
  }

  renderConfirmExit(ctx) {
    // Dim the gameplay layer.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // Dialog box
    ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
    ctx.fillRect(CONFIRM_BOX.x, CONFIRM_BOX.y, CONFIRM_BOX.w, CONFIRM_BOX.h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(CONFIRM_BOX.x, CONFIRM_BOX.y, CONFIRM_BOX.w, CONFIRM_BOX.h);

    // Title
    ctx.font = '20px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillText('Return to main menu?', SCREEN_WIDTH / 2, CONFIRM_BOX.y + 40);
    ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText('Your current streak will be lost.', SCREEN_WIDTH / 2, CONFIRM_BOX.y + 64);

    const drawButton = (rect, label, accent) => {
      ctx.fillStyle = accent ? 'rgba(200, 40, 40, 0.9)' : 'rgba(60, 80, 120, 0.9)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = 'white';
      ctx.font = '18px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
    };
    drawButton(CONFIRM_YES, 'YES (Y)', true);
    drawButton(CONFIRM_NO,  'NO  (N)', false);
  }

  // ---- state-manager key hook (ESC / Y / N / M) ----
  onKey(gsm, key) {
    if (this.state === 'confirm-exit') {
      if (key === 'KeyY') {
        this.exitToMenu(gsm);
      } else if (key === 'KeyN' || key === 'Escape') {
        this.resumeFromConfirm();
      }
      return;
    }
    if (key === 'Escape') {
      this.enterConfirmExit();
    } else if (key === 'KeyM') {
      audio.toggleMute();
      audio.sfxMenuClick();
    }
  }

  // Space/Enter during aiming/simulation is deliberately a no-op.
  onSkip(_gsm) { /* intentionally empty */ }

  enterConfirmExit() {
    this.resumeSub = this.state; // 'aiming' or 'simulation'
    this.state = 'confirm-exit';
    // Clear any in-flight pointer so the same gesture that opened this dialog
    // (e.g. the Esc-key release) doesn't auto-click YES or NO.
    consumePointerReleased();
    resetPointerState();
  }

  resumeFromConfirm() {
    this.state = this.resumeSub;
    resetPointerState();
  }

  exitToMenu(gsm) {
    session.endRun();
    gsm.changeState('main-menu');
  }
}
