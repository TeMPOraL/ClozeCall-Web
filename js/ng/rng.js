// Cloze Call V2 — seedable PRNG (Mulberry32).
// design-v2.md §14. Replaces all in-game uses of Math.random() so levels are
// fully reproducible from a seed.
//
// Mulberry32 is a tiny 32-bit integer-state generator. Good enough for game
// RNG; not cryptographically random. Reference: https://stackoverflow.com/a/47593316

let state = 0;

// Convert any 32-bit seed (signed or unsigned) into the generator's internal
// state. Seeding with 0 is fine for Mulberry32; it does not lock up.
export const seed = (n) => {
  state = (n >>> 0);
};

// Uniform [0, 1) (53-bit resolution is overkill for this; 32 is plenty here).
export const random = () => {
  state = (state + 0x6D2B79F5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Integer in [0, maxExclusive). Uses `random()` internally.
export const randomInt = (maxExclusive) =>
  Math.floor(random() * maxExclusive);

// Integer in [a, b] inclusive.
export const randomRange = (a, b) =>
  a + Math.floor(random() * (b - a + 1));

// Pick one element from an array. Returns undefined on empty.
export const randomPick = (arr) =>
  arr.length === 0 ? undefined : arr[Math.floor(random() * arr.length)];

// Non-deterministic initial seed. Used when no URL hash seed is supplied.
// Mixes time + a best-effort crypto source so runs differ across reloads.
export const nondeterministicSeed = () => {
  const now = Date.now() >>> 0;
  let extra = 0;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    extra = buf[0];
  } else {
    extra = Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  return (now ^ extra) >>> 0;
};

// Read the current seed back out for sharing. Note: this is the *current*
// state after consuming random values, not the original seed. main-game.js
// records the seed at level-start and shares that value, not this one.
export const currentState = () => state;

// Seed once at module init with something non-deterministic so any access
// before main() finishes parsing #seed=... still returns reasonable values.
seed(nondeterministicSeed());
