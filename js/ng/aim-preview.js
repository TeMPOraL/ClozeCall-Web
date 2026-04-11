// Cloze Call V2 — aim preview / forward trajectory integration.
// design-v2.md §5. Given the ball's current position, the launch velocity it
// would get from the pointer right now, and the list of planets, simulates
// forward at the same fixed timestep the physics uses and records a short
// polyline of predicted positions.
//
// Stop conditions (whichever fires first):
//   - total arc length >= PREVIEW_MAX_ARC_LENGTH (300 px)
//   - step count >= PREVIEW_MAX_STEPS (60 steps, ~1 s of sim time)
//   - shadow ball collides with a planet (the hole is NOT a stop condition)
//   - shadow ball goes OFFWORLD_MAX_DISTANCE_FROM_ORIGIN off-screen
//
// The preview runs in a shadow copy — it must not mutate the real ball.

import {
  FIXED_DT_SECONDS, G,
  PREVIEW_MAX_ARC_LENGTH, PREVIEW_MAX_STEPS,
  OFFWORLD_MAX_DISTANCE_FROM_ORIGIN,
} from './config.js';
import {
  makeVec, addVecs, subVecs, scaledVec, normalizedVec,
  distance, vecMag, square,
} from './math.js';

// Duplicated here from main-game.js to keep aim-preview standalone and avoid
// circular imports. Identical math.
const computeGravityField = (bodies, position) => {
  let tx = 0, ty = 0;
  for (const body of bodies) {
    const dx = position[0] - body.position[0];
    const dy = position[1] - body.position[1];
    const d2 = dx * dx + dy * dy;
    if (d2 === 0) continue;
    const d = Math.sqrt(d2);
    const s = body.mass / d2 / d; // (mass / d^2) * (1/d) for normalize
    tx += dx * s;
    ty += dy * s;
  }
  return [tx, ty];
};

const collidesWith = (bodies, position, ballRadius) => {
  for (const body of bodies) {
    const dx = position[0] - body.position[0];
    const dy = position[1] - body.position[1];
    if (dx * dx + dy * dy < (body.radius + ballRadius) * (body.radius + ballRadius)) {
      return true;
    }
  }
  return false;
};

/**
 * Forward-integrate a shadow ball from `startPosition` with `startVelocity`
 * against `bodies`. Returns an array of points [[x,y], ...] including the
 * starting position.
 *
 * @param {Object} opts
 * @param {[number,number]} opts.startPosition
 * @param {[number,number]} opts.startVelocity
 * @param {Array} opts.bodies
 * @param {number} opts.ballRadius
 * @param {number} opts.ballMass - matches the real ball's mass (1)
 */
export const computeAimPreview = ({ startPosition, startVelocity, bodies, ballRadius, ballMass }) => {
  const points = [startPosition.slice()];
  let px = startPosition[0], py = startPosition[1];
  let vx = startVelocity[0], vy = startVelocity[1];
  let arcLength = 0;

  // Degenerate: no launch velocity -> no preview beyond the starting point.
  if (vx === 0 && vy === 0) return points;

  for (let step = 0; step < PREVIEW_MAX_STEPS; step++) {
    // Gravity: same formula as the real physics step.
    const field = computeGravityField(bodies, [px, py]);
    // applyForce: v += field * G * dt / mass; then x += v * dt.
    const invM = 1 / ballMass;
    vx += field[0] * G * FIXED_DT_SECONDS * invM;
    vy += field[1] * G * FIXED_DT_SECONDS * invM;
    const nx = px + vx * FIXED_DT_SECONDS;
    const ny = py + vy * FIXED_DT_SECONDS;

    // Arc length bookkeeping.
    const dx = nx - px;
    const dy = ny - py;
    const seg = Math.sqrt(dx * dx + dy * dy);
    arcLength += seg;

    px = nx; py = ny;
    points.push([px, py]);

    if (arcLength >= PREVIEW_MAX_ARC_LENGTH) break;

    // Stop if we hit a planet; the player's line ends at the collision.
    if (collidesWith(bodies, [px, py], ballRadius)) break;

    // Stop if we fly wildly off-world (2x safety margin matches main-game).
    const dFromOrigin = Math.sqrt(px * px + py * py);
    if (dFromOrigin > OFFWORLD_MAX_DISTANCE_FROM_ORIGIN) break;
  }

  return points;
};

/**
 * Render an aim preview polyline onto the canvas. Dashed white with uniform
 * alpha per design-v2.md §19 answer #6.
 */
export const drawAimPreview = (ctx, points) => {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
  ctx.restore();
};
