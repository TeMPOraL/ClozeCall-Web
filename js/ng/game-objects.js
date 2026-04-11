// Cloze Call V2 — game object classes.
// Same shape as v1, but planet picks go through the seedable RNG.

import { loadImage, drawImage } from './pictures.js';
import { makeVec } from './math.js';
import * as rng from './rng.js';

// Base class for any drawable entity with a position, mass, radius and image.
export class GameObject {
  constructor({ position = makeVec(), mass = 0, radius = 0, dimensions = makeVec(), image = null } = {}) {
    this.position = position;
    this.mass = mass;
    this.radius = radius;
    this.size = dimensions;
    this.image = image;
  }

  init() {}

  draw(ctx) {
    drawImage(ctx, this.image, this.position, this.size);
  }
}

// Random planet image picker. (+ 1 (random 20)) yields 1..20. Uses the seeded
// rng module so level layouts are reproducible.
const randomPlanetImage = (small = '') => {
  const n = 1 + rng.randomInt(20);
  return `planet${n}${small}.png`;
};

// Celestial body: exerts gravity, lose-a-life on collision with ball.
export class CelestialBody extends GameObject {
  constructor(opts) {
    super(opts);
    this.small = opts.small ?? false;
  }

  init() {
    this.image = loadImage(randomPlanetImage(this.small ? '-small' : ''));
  }
}

// The ball: the player-launched projectile.
export class Ball extends GameObject {
  constructor(opts) {
    super(opts);
    this.velocity = opts.velocity ?? makeVec();
  }

  init() {
    this.image = loadImage('ball.png');
  }
}

// The hole: the target.
export class Hole extends GameObject {
  init() {
    this.image = loadImage('hole.png');
  }
}
