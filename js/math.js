// 2D vector math. Mirrors math.lisp.
// Vectors are plain 2-element arrays [x, y]. All operations are pure (return
// new vectors); the original had paired in-place variants but the port does
// not need them and dropping them avoids the `negate-vector`/`negative-vector`
// naming bug mentioned in the postmortem.

export const square = x => x * x;

export const makeVec = (a = 0, b = 0) => [a, b];

export const addVecs = (v1, v2) => [v1[0] + v2[0], v1[1] + v2[1]];

export const scaledVec = (v, s) => [v[0] * s, v[1] * s];

export const negativeVec = v => [-v[0], -v[1]];

export const distance = (v1, v2) => {
  const dx = v1[0] - v2[0];
  const dy = v1[1] - v2[1];
  return Math.sqrt(dx * dx + dy * dy);
};

export const vecMag = v => Math.sqrt(v[0] * v[0] + v[1] * v[1]);

export const normalizedVec = v => {
  const m = vecMag(v);
  return m === 0 ? [0, 0] : [v[0] / m, v[1] / m];
};

export const clamp = (what, lo, hi) => {
  if (what < lo) return lo;
  if (what > hi) return hi;
  return what;
};
