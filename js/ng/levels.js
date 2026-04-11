// Cloze Call V2 — procedural level generation.
// design-v2.md §11. Streak-driven difficulty: as the player's streak grows,
// more and heavier planets appear, up to configurable caps.
//
// All random picks go through js/ng/rng.js rather than Math.random() so any
// given {seed, streak} pair produces the exact same level.

import {
  SMALL_PLANET_RADIUS, LARGE_PLANET_RADIUS,
  SMALL_PLANET_DIMENSIONS, LARGE_PLANET_DIMENSIONS,
  MAX_X_GRID_DEVIATION, MAX_Y_GRID_DEVIATION,
  DEFAULT_BALL_STARTING_POSITION,
  DIFFICULTY,
} from './config.js';
import { addVecs, makeVec } from './math.js';
import { CelestialBody, Ball, Hole } from './game-objects.js';
import * as rng from './rng.js';

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

// Pop a random coord off the grid and jitter it. Ensures no two objects in
// the same level share a grid cell.
const levelGetGridCoord = () => {
  const i = rng.randomInt(levelGrid.length);
  const [coord] = levelGrid.splice(i, 1);
  return addVecs(coord, makeVec(
    rng.randomInt(MAX_X_GRID_DEVIATION),
    rng.randomInt(MAX_Y_GRID_DEVIATION),
  ));
};

export const loadLevel = (name, streak = 0) => {
  console.log(`Loading level ${name} @ streak ${streak} ok! (ng)`);
  reinitializeLevelGrid();
};

export const levelGetBackgroundImageName = () => 'level-background.png';

// Per-level parameters derived from streak. Centralized here so main-game
// and the aim preview (which needs to know what the next level will look
// like only for debugging) query the same source.
export const levelParameters = (streak) => {
  const planetCountBase = DIFFICULTY.BASE_PLANET_COUNT + Math.floor(streak / DIFFICULTY.PLANET_STREAK_DIV);
  const extraPlanet = rng.randomInt(DIFFICULTY.EXTRA_PLANET_MAX); // 0 or 1
  const planetCount = Math.min(planetCountBase + extraPlanet, DIFFICULTY.PLANET_COUNT_MAX);

  const basePlanetMass = DIFFICULTY.BASE_PLANET_MASS +
    DIFFICULTY.MASS_STREAK_STEP * Math.floor(streak / DIFFICULTY.MASS_STREAK_DIV);

  return { planetCount, basePlanetMass };
};

const randomSmall = () => rng.randomInt(2) === 0;

const makeCelestialBody = (basePlanetMass) => {
  const isSmall = randomSmall();
  const mass = Math.min(
    basePlanetMass + rng.randomInt(DIFFICULTY.MASS_JITTER_MAX),
    DIFFICULTY.MASS_CEILING,
  );
  const body = new CelestialBody({
    position: levelGetGridCoord(),
    mass,
    radius: isSmall ? SMALL_PLANET_RADIUS : LARGE_PLANET_RADIUS,
    small: isSmall,
    dimensions: isSmall ? SMALL_PLANET_DIMENSIONS : LARGE_PLANET_DIMENSIONS,
  });
  body.init();
  return body;
};

export const levelGetCelestialBodies = (streak) => {
  const { planetCount, basePlanetMass } = levelParameters(streak);
  // Critical ordering: planetCount and basePlanetMass both consume rng calls
  // via levelParameters, so bodies created after this point all draw from a
  // shared deterministic state.
  const bodies = [];
  for (let i = 0; i < planetCount; i++) {
    bodies.push(makeCelestialBody(basePlanetMass));
  }
  return bodies;
};

export const levelGetBall = () => {
  // Port decision (design.md §2.5 / v1 port): mass = 1 to match the
  // original's effective motion. Starting position is the same [50, 50] as
  // v1; unchanged by v2.
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
