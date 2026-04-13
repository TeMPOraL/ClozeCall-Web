// Cloze Call V2 — main game state.
// design-v2.md §1..§13 all converge here. Includes:
//   - 60 Hz fixed-timestep physics (via FIXED_DT_SECONDS),
//   - dynamic camera (§3.3) with viewport-filling canvas,
//   - mass-weighted centroid for escape-velocity (§6),
//   - forward-integrated aim preview (§5),
//   - unified 400 px launch cap (§5.3),
//   - edge-arrow + circle-arc off-screen marker (§7),
//   - HUD integration (§8) with clickable mute button,
//   - synthesized sfx at key transitions (§13),
//   - ESC confirmation sub-state (§9.4 / §19 answer #4),
//   - streak-driven level generation (§11, delegated to levels.js),
//   - shot forfeit (§9.5),
//   - level retry on defeat (§9.4, §10.3).

import { GameState } from './gsm.js';
import {
  G, LAUNCH_SPEED_CAP, FORCE_INDICATOR_1_OVER_MAX,
  OFFWORLD_MAX_DISTANCE_FROM_ORIGIN,
  MARKER_DISTANCE_TO_SCREEN_BORDER,
  MARKER_ROTATION_OFFSET,
  FORFEIT_GRACE_SECONDS, FORFEIT_HINT_DELAY_SECONDS,
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
  consumePointerReleased, resetPointerState, setCoordinateTransform,
} from './input.js';
import * as session from './session.js';
import * as audio from './audio.js';
import * as rng from './rng.js';
import { computeAimPreview, drawAimPreview } from './aim-preview.js';
import { renderHud, hudMuteContains } from './hud.js';
import {
  createCamera, cameraResetToAiming, cameraUpdateTarget,
  cameraUpdate, cameraApplyTransform, cameraInverseTransform,
  cameraVisibleRect,
} from './camera.js';
import {
  debugIsEnabled, debugOnLevelStart, debugOnSimulationStart,
  debugOnPhysicsTick, debugRenderWorld, debugRenderHud, debugHandleClick,
} from './debug.js';

// Color endpoints for the aim line lerp.
const GREEN = { r: 0,   g: 255, b: 0 };
const RED   = { r: 255, g: 0,   b: 0 };
const lerpColor = (a, b, t) => ({
  r: Math.round(lerp(a.r, b.r, t)),
  g: Math.round(lerp(a.g, b.g, t)),
  b: Math.round(lerp(a.b, b.b, t)),
});

// ---- Physics helpers ----

/** Gravitational field at `position`: Σ (m_i / d_i²) · dir_i (points away from planets). */
const computeGravityField = (bodies, position) => {
  let total = makeVec(0, 0);
  for (const body of bodies) {
    const d = distance(position, body.position);
    if (d === 0) continue;
    const delta = subVecs(position, body.position);
    const dir = normalizedVec(delta);
    total = addVecs(total, scaledVec(dir, body.mass / square(d)));
  }
  return total;
};

/**
 * Velocity Verlet integration step (design-v2.md §2.4).
 *
 * Second-order symplectic integrator. Energy error is O(dt²) vs O(dt) for the
 * first-order symplectic Euler this replaces. Two gravity evaluations per step
 * (current + new position) keeps close planetary flybys accurate.
 *
 *   a₀ = G · field(x_n) / m
 *   x_{n+1} = x_n + v_n·dt + ½·a₀·dt²
 *   a₁ = G · field(x_{n+1}) / m
 *   v_{n+1} = v_n + ½·(a₀ + a₁)·dt
 */
const integrateVerlet = (ball, bodies, dt) => {
  const field0 = computeGravityField(bodies, ball.position);
  const a0 = scaledVec(field0, G / ball.mass);

  ball.position = addVecs(
    addVecs(ball.position, scaledVec(ball.velocity, dt)),
    scaledVec(a0, 0.5 * dt * dt),
  );

  const field1 = computeGravityField(bodies, ball.position);
  const a1 = scaledVec(field1, G / ball.mass);

  ball.velocity = addVecs(
    ball.velocity,
    scaledVec(addVecs(a0, a1), 0.5 * dt),
  );
};

const collisionBetweenObjects = (a, b) =>
  distance(a.position, b.position) < a.radius + b.radius;

const anyCollision = (bodies, ball) =>
  bodies.some(b => collisionBetweenObjects(b, ball));

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

const computeVelocityFromPositionAndPointer = (position, pointer) => {
  const delta = [pointer[0] - position[0], pointer[1] - position[1]];
  const d = vecMag(delta);
  if (d === 0) return makeVec(0, 0);
  const speed = Math.min(d, LAUNCH_SPEED_CAP);
  return scaledVec(delta, speed / d);
};

const computeForceIndicator = (position, pointer) =>
  clamp(distance(position, pointer) * FORCE_INDICATOR_1_OVER_MAX, 0, 1);

// ---- Confirm-exit dialog geometry (canvas-pixel space) ----

const confirmLayout = (canvasW, canvasH) => {
  const bw = 360, bh = 160;
  const bx = canvasW / 2 - bw / 2;
  const by = canvasH / 2 - bh / 2;
  return {
    box: { x: bx, y: by, w: bw, h: bh },
    yes: { x: bx + 20,  y: by + 100, w: 120, h: 40 },
    no:  { x: bx + 220, y: by + 100, w: 120, h: 40 },
  };
};

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
    this.resumeSub = 'aiming';
    this.cam = createCamera();
    this.simTime = 0;  // seconds elapsed since launch (for forfeit grace)
  }

  initializeState(gsm) {
    // Check for a retry request first (design-v2.md §9.4, §10.3).
    const retry = session.consumeRetry();
    if (retry) {
      rng.seed(retry.seed);
      loadLevel('ng', retry.streak);
      this.celestialBodies = levelGetCelestialBodies(retry.streak);
    } else {
      session.startLevel(rng.currentState());
      loadLevel('ng', session.getStreak());
      this.celestialBodies = levelGetCelestialBodies(session.getStreak());
    }

    this.backgroundImage = loadImage(levelGetBackgroundImageName());
    this.markerImage = loadImage('marker.png');
    this.state = 'aiming';
    this.resumeSub = 'aiming';
    this.ball = levelGetBall();
    this.hole = levelGetHole();
    this.simTime = 0;

    // Reset camera to aiming default.
    cameraResetToAiming(this.cam);

    // Set coordinate transform so pointer positions arrive in world coords.
    const cam = this.cam;
    const canvas = gsm.canvas;
    setCoordinateTransform((cx, cy) =>
      cameraInverseTransform(cam, canvas.width, canvas.height, cx, cy)
    );

    resetPointerState();

    if (debugIsEnabled()) debugOnLevelStart(this.celestialBodies, this.ball, this.hole);
  }

  reinitializeGame() {
    this.state = 'aiming';
    this.ball = levelGetBall();
    this.simTime = 0;
    cameraResetToAiming(this.cam);
    resetPointerState();

    if (debugIsEnabled()) debugOnLevelStart(this.celestialBodies, this.ball, this.hole);
  }

  updateLogic(gsm, dt) {
    switch (this.state) {
      case 'aiming':       this.updateAiming(gsm, dt); break;
      case 'simulation':   this.updateSimulation(gsm, dt); break;
      case 'confirm-exit': this.updateConfirmExit(gsm); break;
    }
  }

  render(ctx, gsm) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    // 1. Clear entire canvas.
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, cw, ch);

    // 2. Background (screen space, before camera transform).
    // "Cover" mode: scale to fill the canvas, crop overflow. No tiling seams.
    const bg = this.backgroundImage;
    if (bg && bg.complete) {
      const iw = bg.naturalWidth || bg.width;
      const ih = bg.naturalHeight || bg.height;
      if (iw && ih) {
        const scale = Math.max(cw / iw, ch / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.drawImage(bg, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      }
    }

    // 3. Apply camera transform.
    ctx.save();
    cameraApplyTransform(ctx, this.cam, cw, ch);

    // 4-6. World objects.
    for (const b of this.celestialBodies) b.draw(ctx);
    this.hole.draw(ctx);
    this.ball.draw(ctx);

    // 7. Aim overlay (aiming only).
    if (this.state === 'aiming') this.renderAiming(ctx);

    // 8. Off-screen indicators (simulation only).
    if (this.state === 'simulation') this.renderSimulation(ctx, cw, ch);

    // 9. Debug world overlays (trail, CoG marker — design-v2.md §15).
    debugRenderWorld(ctx, this.cam, cw, ch);

    // 10. End camera transform.
    ctx.restore();

    // 11. HUD (screen space).
    renderHud(ctx, {
      lives:  session.getLives(),
      streak: session.getStreak(),
      best:   session.getBest(),
    });

    // 12. Debug HUD (energy readout, panel — design-v2.md §15).
    debugRenderHud(ctx, this.ball, this.celestialBodies, cw, ch);

    // Forfeit hint (screen space, design-v2.md §9.5).
    if (this.state === 'simulation' && this.simTime >= FORFEIT_HINT_DELAY_SECONDS) {
      ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('tap to forfeit shot', cw / 2, ch - 14);
    }

    // 13. Confirm overlay (screen space).
    if (this.state === 'confirm-exit') this.renderConfirmExit(ctx);
  }

  // ---- sub-state: aiming ----
  updateAiming(gsm, _dt) {
    const release = consumePointerReleased();
    if (!release) return;

    // Debug overlay click (highest priority after pointer release).
    if (debugIsEnabled() && debugHandleClick(release.raw[0], release.raw[1])) return;

    // HUD mute button: hit-test in canvas-pixel coords.
    if (hudMuteContains(release.raw[0], release.raw[1], gsm.canvas.width)) {
      audio.toggleMute();
      audio.sfxMenuClick();
      return;
    }

    this.ball.velocity = computeVelocityFromPositionAndPointer(this.ball.position, release.pos);
    audio.sfxLaunch();
    this.state = 'simulation';
    this.resumeSub = 'simulation';
    this.simTime = 0;

    if (debugIsEnabled()) debugOnSimulationStart(this.ball, this.celestialBodies);
  }

  renderAiming(ctx) {
    if (!(pointerHovering() || pointerPressed())) return;
    const p = pointerPosition();

    const previewVelocity = computeVelocityFromPositionAndPointer(this.ball.position, p);
    const preview = computeAimPreview({
      startPosition: this.ball.position,
      startVelocity: previewVelocity,
      bodies: this.celestialBodies,
      ballRadius: this.ball.radius,
      ballMass: this.ball.mass,
    });
    drawAimPreview(ctx, preview);

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
    this.simTime += dt;

    integrateVerlet(this.ball, this.celestialBodies, dt);

    if (debugIsEnabled()) debugOnPhysicsTick(this.ball, this.celestialBodies);

    // Camera: track all objects during simulation.
    cameraUpdateTarget(this.cam, this.ball, this.celestialBodies, this.hole,
      gsm.canvas.width, gsm.canvas.height);
    cameraUpdate(this.cam);

    // Pointer tap: debug overlay, mute button, or forfeit (after grace period).
    const release = consumePointerReleased();
    if (release) {
      if (debugIsEnabled() && debugHandleClick(release.raw[0], release.raw[1])) {
        // consumed by debug panel
      } else if (hudMuteContains(release.raw[0], release.raw[1], gsm.canvas.width)) {
        audio.toggleMute();
        audio.sfxMenuClick();
      } else if (this.simTime >= FORFEIT_GRACE_SECONDS) {
        audio.sfxForfeit();
        this.handleLifeLoss(gsm);
        return;
      }
    }

    // Outcome detection: hole > off-world > planet priority.
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

  renderSimulation(ctx, canvasW, canvasH) {
    const p = this.ball.position;

    // Off-screen detection uses the camera's visible world rect, not the
    // fixed 800×600 design viewport (design-v2.md §7.2).
    const vis = cameraVisibleRect(this.cam, canvasW, canvasH);
    const offscreen = p[0] < vis.x || p[0] > vis.x + vis.w ||
                      p[1] < vis.y || p[1] > vis.y + vis.h;
    if (!offscreen) return;

    // Circle arc (world space — drawn inside camera transform).
    const edgeX = clamp(p[0], vis.x + MARKER_DISTANCE_TO_SCREEN_BORDER,
                               vis.x + vis.w - MARKER_DISTANCE_TO_SCREEN_BORDER);
    const edgeY = clamp(p[1], vis.y + MARKER_DISTANCE_TO_SCREEN_BORDER,
                               vis.y + vis.h - MARKER_DISTANCE_TO_SCREEN_BORDER);
    const arcPt = [
      Math.abs(clamp(p[0], vis.x, vis.x + vis.w) - (vis.x + MARKER_DISTANCE_TO_SCREEN_BORDER)),
      Math.abs(clamp(p[1], vis.y, vis.y + vis.h) - (vis.y + MARKER_DISTANCE_TO_SCREEN_BORDER)),
    ];
    const delta = addVecs(negativeVec(p), arcPt);
    const r = Math.round(vecMag(delta));
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(Math.round(p[0]), Math.round(p[1]), r, 0, Math.PI * 2);
    ctx.stroke();

    // Edge arrow: marker.png rotated to point toward the ball.
    const anchor = [edgeX, edgeY];
    const angle = Math.atan2(p[1] - anchor[1], p[0] - anchor[0]) + MARKER_ROTATION_OFFSET;
    ctx.save();
    ctx.translate(anchor[0], anchor[1]);
    ctx.rotate(angle);
    const mw = this.markerImage.naturalWidth  || this.markerImage.width  || 20;
    const mh = this.markerImage.naturalHeight || this.markerImage.height || 20;
    ctx.drawImage(this.markerImage, -mw / 2, -mh / 2);
    ctx.restore();
  }

  // ---- life-loss path shared by planet-collision, off-world, and forfeit ----
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
    const release = consumePointerReleased();
    if (!release) return;
    const layout = confirmLayout(gsm.canvas.width, gsm.canvas.height);
    if (pointInRect(release.raw[0], release.raw[1], layout.yes)) {
      this.exitToMenu(gsm);
    } else if (pointInRect(release.raw[0], release.raw[1], layout.no)) {
      this.resumeFromConfirm();
    }
  }

  renderConfirmExit(ctx) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    // Dim the gameplay layer.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, cw, ch);

    const layout = confirmLayout(cw, ch);
    const { box } = layout;

    // Dialog box.
    ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);

    // Title.
    ctx.font = '20px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillText('Return to main menu?', cw / 2, box.y + 40);
    ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText('Your current streak will be lost.', cw / 2, box.y + 64);

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
    drawButton(layout.yes, 'YES (Y)', true);
    drawButton(layout.no,  'NO  (N)', false);
  }

  // ---- state-manager key hook (ESC / Y / N / M / R) ----
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
    } else if (key === 'KeyR' && this.state === 'simulation') {
      // Shot forfeit via keyboard (design-v2.md §9.5).
      if (this.simTime >= FORFEIT_GRACE_SECONDS) {
        audio.sfxForfeit();
        this.handleLifeLoss(gsm);
      }
    }
  }

  // Space/Enter during simulation acts as forfeit after grace period.
  onSkip(gsm) {
    if (this.state === 'simulation' && this.simTime >= FORFEIT_GRACE_SECONDS) {
      audio.sfxForfeit();
      this.handleLifeLoss(gsm);
    }
  }

  enterConfirmExit() {
    this.resumeSub = this.state;
    this.state = 'confirm-exit';
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
