// Main game state. Mirrors main-game-state.lisp.
//
// Holds the internal sub-state machine (aiming / simulation / hole-collision /
// planet-collision / off-world) and all gameplay logic.

import { GameState } from './gsm.js';
import {
  SCREEN_WIDTH, SCREEN_HEIGHT,
  G, FORCE_INDICATOR_1_OVER_MAX,
  OFFWORLD_MAX_DISTANCE_FROM_ORIGIN,
  LAUNCH_SPEED_CAP_AT_INDICATOR_MAX,
  MARKER_DISTANCE_TO_SCREEN_BORDER,
} from './config.js';
import {
  makeVec, addVecs, negativeVec, scaledVec, normalizedVec,
  distance, vecMag, clamp, square,
} from './math.js';
import { loadImage, drawImage } from './pictures.js';
import {
  loadLevel, levelGetBackgroundImageName, levelGetCelestialBodies,
  levelGetBall, levelGetHole,
} from './levels.js';
import { mousePosition, mouseLeftPressed } from './input.js';

// Edge detectors over the LMB signal.
const risingEdge  = (prev, curr) => !prev &&  !!curr;
const fallingEdge = (prev, curr) => !!prev && !curr;

// Numeric / color lerps used by the aim line.
const lerp = (a, b, t) => (1 - t) * a + t * b;
const lerpColor = (a, b, t) => ({
  r: Math.round(lerp(a.r, b.r, t)),
  g: Math.round(lerp(a.g, b.g, t)),
  b: Math.round(lerp(a.b, b.b, t)),
});
const GREEN = { r: 0,   g: 255, b: 0 };
const RED   = { r: 255, g: 0,   b: 0 };

// Euler integrator: velocity += force * dt / mass, position += velocity * dt.
const applyForce = (ball, force, dt) => {
  const accel = scaledVec(force, dt / ball.mass);
  ball.velocity = addVecs(ball.velocity, accel);
  ball.position = addVecs(ball.position, scaledVec(ball.velocity, dt));
};

// Sum, over all bodies, of normalize(ball - body) * body.mass / dist^2.
// Multiplied by G (negative) later to flip into an attractive force.
const computeGravityField = (bodies, ball) => {
  let total = makeVec(0, 0);
  for (const body of bodies) {
    const d = distance(ball.position, body.position);
    if (d === 0) continue;
    const delta = addVecs(ball.position, negativeVec(body.position));
    const dir = normalizedVec(delta);
    total = addVecs(total, scaledVec(dir, body.mass / square(d)));
  }
  return total;
};

const collisionBetweenObjects = (a, b) =>
  distance(a.position, b.position) < a.radius + b.radius;

const anyCollision = (bodies, ball) =>
  bodies.some(b => collisionBetweenObjects(b, ball));

// Escape velocity of the whole system, using the (unweighted) centroid of
// planet positions. Faithful to the original; flagged in design.md §5 for a
// future correction to a mass-weighted centroid.
const escapeVelocity = (bodies, ballPosition) => {
  let sum = makeVec(0, 0);
  let mass = 0;
  for (const b of bodies) {
    sum = addVecs(sum, b.position);
    mass += b.mass;
  }
  const com = scaledVec(sum, 1 / bodies.length);
  return Math.sqrt(Math.abs((2 * G * mass) / distance(com, ballPosition)));
};

const offworldP = (bodies, ball) => {
  if (distance(ball.position, [0, 0]) <= OFFWORLD_MAX_DISTANCE_FROM_ORIGIN) return false;
  return vecMag(ball.velocity) > escapeVelocity(bodies, ball.position);
};

// Launch velocity: direction = (mouse - ball), magnitude = distance(mouse, ball).
// Port decision: optionally capped at the force-indicator saturation threshold
// (300 px by default). See design.md §2.4.
const computeVelocityFromPositionAndMouse = position => {
  const mp = mousePosition();
  const delta = [mp[0] - position[0], mp[1] - position[1]];
  const d = vecMag(delta);
  if (d === 0) return makeVec(0, 0);
  const cap = 1 / FORCE_INDICATOR_1_OVER_MAX; // 300 px
  const speed = LAUNCH_SPEED_CAP_AT_INDICATOR_MAX ? Math.min(d, cap) : d;
  return scaledVec(delta, speed / d);
};

const computeForceIndicator = position => {
  const mp = mousePosition();
  return clamp(distance(position, mp) * FORCE_INDICATOR_1_OVER_MAX, 0, 1);
};

const offscreenP = p =>
  p[0] > SCREEN_WIDTH || p[1] > SCREEN_HEIGHT || p[0] < 0 || p[1] < 0;

// Helper for the quirky off-screen circle radius. See design.md §2.7.
const computeOffscreenMarkerPosition = p => [
  Math.abs(clamp(p[0], 0, SCREEN_WIDTH)  - MARKER_DISTANCE_TO_SCREEN_BORDER),
  Math.abs(clamp(p[1], 0, SCREEN_HEIGHT) - MARKER_DISTANCE_TO_SCREEN_BORDER),
];

export class MainGameState extends GameState {
  constructor({ runLevel }) {
    super();
    if (!runLevel) throw new Error('A default level must be specified!');
    this.nextLevel = runLevel;
    this.celestialBodies = [];
    this.ball = null;
    this.hole = null;
    this.backgroundImage = null;
    this.markerImage = null;
    this.state = 'aiming';
    this.lives = 3;
    this.mouseLmbState = false;
    this.mousePrevLmbState = false;
  }

  initializeState(gsm) {
    loadLevel(this.nextLevel);
    this.celestialBodies = levelGetCelestialBodies();
    this.backgroundImage = loadImage(levelGetBackgroundImageName());
    this.markerImage = loadImage('marker.png'); // loaded but unused; see §2.7
    this.lives = 3;
    this.state = 'aiming';
    this.ball = levelGetBall();
    this.hole = levelGetHole();
    // Reset LMB edge tracking so a lingering press from the intro screens
    // doesn't accidentally launch the first shot.
    this.mouseLmbState = mouseLeftPressed();
    this.mousePrevLmbState = this.mouseLmbState;
  }

  reinitializeGame() {
    this.state = 'aiming';
    this.ball = levelGetBall();
  }

  updateLogic(gsm, dt) {
    // update-common: shift LMB state (prev <- curr; curr <- input).
    this.mousePrevLmbState = this.mouseLmbState;
    this.mouseLmbState = mouseLeftPressed();

    switch (this.state) {
      case 'aiming':           this.updateAiming(dt); break;
      case 'simulation':       this.updateSimulation(dt); break;
      case 'hole-collision':   this.updateHoleCollision(gsm); break;
      case 'planet-collision': this.updatePlanetCollision(gsm); break;
      case 'off-world':        this.updateOffWorld(gsm); break;
    }
  }

  render(ctx, gsm) {
    // render-common: black, background, bodies, hole, ball.
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    drawImage(ctx, this.backgroundImage);
    for (const b of this.celestialBodies) b.draw(ctx);
    this.hole.draw(ctx);
    this.ball.draw(ctx);

    switch (this.state) {
      case 'aiming':     this.renderAiming(ctx); break;
      case 'simulation': this.renderSimulation(ctx); break;
      // hole-collision / planet-collision / off-world draw no overlay
    }
  }

  // ---- sub-state: aiming ----
  updateAiming(dt) {
    if (fallingEdge(this.mousePrevLmbState, this.mouseLmbState)) {
      this.ball.velocity = computeVelocityFromPositionAndMouse(this.ball.position);
      this.state = 'simulation';
    }
  }

  renderAiming(ctx) {
    const mp = mousePosition();
    const t = computeForceIndicator(this.ball.position);
    const col = lerpColor(GREEN, RED, t);
    ctx.strokeStyle = `rgb(${col.r}, ${col.g}, ${col.b})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.ball.position[0], this.ball.position[1]);
    ctx.lineTo(mp[0], mp[1]);
    ctx.stroke();
  }

  // ---- sub-state: simulation ----
  updateSimulation(dt) {
    const field = computeGravityField(this.celestialBodies, this.ball);
    applyForce(this.ball, scaledVec(field, G), dt);
    // Sequential `if`s, not `else if`, to match the original's priority order
    // (last-set wins: hole > off-world > planet). Difference only matters in
    // the rare case where multiple conditions fire in the same tick.
    if (anyCollision(this.celestialBodies, this.ball)) this.state = 'planet-collision';
    if (offworldP(this.celestialBodies, this.ball))    this.state = 'off-world';
    if (collisionBetweenObjects(this.hole, this.ball)) this.state = 'hole-collision';
  }

  renderSimulation(ctx) {
    const p = this.ball.position;
    if (!offscreenP(p)) return;
    // Quirky original: anti-aliased green circle centered on the off-screen
    // ball, with radius = distance from ball to the clamped edge-marker point.
    // Only a thin arc peeks onto the visible screen near the closest edge.
    // See design.md §2.7.
    const markerPos = computeOffscreenMarkerPosition(p);
    const delta = addVecs(negativeVec(p), markerPos);
    const r = Math.round(vecMag(delta));
    ctx.strokeStyle = 'rgb(0, 255, 0)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Math.round(p[0]), Math.round(p[1]), r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---- sub-state: hole collision ----
  updateHoleCollision(gsm) {
    gsm.changeState('victorious');
  }

  // ---- sub-state: planet collision ----
  updatePlanetCollision(gsm) {
    this.lives -= 1;
    if (this.lives === 0) {
      gsm.changeState('defeated');
    } else {
      this.reinitializeGame();
    }
  }

  // ---- sub-state: off-world ----
  updateOffWorld(gsm) {
    this.lives -= 1;
    if (this.lives === 0) {
      gsm.changeState('defeated');
    } else {
      this.reinitializeGame();
    }
  }
}
