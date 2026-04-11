// Procedural level generation. Mirrors levels.lisp.

import {
  DEFAULT_PLANET_MASS, MAX_ADDITIONAL_PLANET_MASS,
  SMALL_PLANET_RADIUS, LARGE_PLANET_RADIUS,
  SMALL_PLANET_DIMENSIONS, LARGE_PLANET_DIMENSIONS,
  DEFAULT_PLANET_CNT, ADDITIONAL_PLANET_CNT_MAX,
  MAX_X_GRID_DEVIATION, MAX_Y_GRID_DEVIATION,
  DEFAULT_BALL_STARTING_POSITION,
} from './config.js';
import { addVecs, makeVec } from './math.js';
import { CelestialBody, Ball, Hole } from './game-objects.js';

// Hard-coded grid of candidate positions (levels.lisp, reinitialize-level-grid).
const FULL_GRID = [
  [100, 300], [100, 500],
  [300, 100], [300, 300], [300, 500],
  [500, 100], [500, 300], [500, 500],
  [700, 100], [700, 300], [700, 500],
];

let levelGrid = [];

const reinitializeLevelGrid = () => {
  levelGrid = FULL_GRID.map(p => [p[0], p[1]]);
};

// Pop a random coord off the grid and jitter it. Ensures no two objects in the
// same level share a grid cell.
const levelGetGridCoord = () => {
  const i = Math.floor(Math.random() * levelGrid.length);
  const [coord] = levelGrid.splice(i, 1);
  return addVecs(coord, makeVec(
    Math.floor(Math.random() * MAX_X_GRID_DEVIATION),
    Math.floor(Math.random() * MAX_Y_GRID_DEVIATION),
  ));
};

export const loadLevel = name => {
  console.log(`Loading level ${name} ok!`);
  reinitializeLevelGrid();
};

export const levelGetBackgroundImageName = () => 'level-background.png';

const randomSmall = () => Math.floor(Math.random() * 2) === 0;

const makeCelestialBody = () => {
  const isSmall = randomSmall();
  const body = new CelestialBody({
    position: levelGetGridCoord(),
    mass: DEFAULT_PLANET_MASS + Math.floor(Math.random() * MAX_ADDITIONAL_PLANET_MASS),
    radius: isSmall ? SMALL_PLANET_RADIUS : LARGE_PLANET_RADIUS,
    small: isSmall,
    dimensions: isSmall ? SMALL_PLANET_DIMENSIONS : LARGE_PLANET_DIMENSIONS,
  });
  body.init();
  return body;
};

// (dotimes (i (+ (random 2) 3))) -> 3 or 4 planets.
export const levelGetCelestialBodies = () => {
  const n = DEFAULT_PLANET_CNT + Math.floor(Math.random() * ADDITIONAL_PLANET_CNT_MAX);
  const bodies = [];
  for (let i = 0; i < n; i++) bodies.push(makeCelestialBody());
  return bodies;
};

export const levelGetBall = () => {
  // Port decision (design.md §2.5): mass = 1 to preserve the original's
  // effective motion (the /mass divisor was commented out, making ball mass
  // effectively 1). The original's cosmetic 100000 is dropped.
  const ball = new Ball({
    position: [...DEFAULT_BALL_STARTING_POSITION],
    mass: 1,
    radius: 11,
    dimensions: [22, 22],
    velocity: makeVec(),
  });
  ball.init();
  return ball;
};

export const levelGetHole = () => {
  const hole = new Hole({
    position: levelGetGridCoord(),
    mass: 50,
    radius: 15,
    dimensions: [48, 48],
  });
  hole.init();
  return hole;
};
