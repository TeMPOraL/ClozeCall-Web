// Cloze Call V2 — image helpers. Unchanged from v1.

export { loadImage } from './assets.js';

// Draws an image so its center lands on `position`. When called with default
// zero dimensions (e.g. for full-screen images), the top-left ends up at
// `position` (default [0,0]) — so backgrounds / intro / win / lose screens
// land at (0, 0). Same contract as pictures.lisp's draw-image.
export const drawImage = (ctx, img, position = [0, 0], dimensions = [0, 0]) => {
  const x = Math.round(position[0] - dimensions[0] / 2);
  const y = Math.round(position[1] - dimensions[1] / 2);
  ctx.drawImage(img, x, y);
};
