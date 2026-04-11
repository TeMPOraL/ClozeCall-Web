// Image helpers. Mirrors pictures.lisp.

export { loadImage } from './assets.js';

// Draws an image so its center lands on `position`. Mirrors `draw-image` from
// pictures.lisp: subtracts half the dimensions and rounds. When called with
// default zero dimensions (as the original does for full-screen images), the
// image ends up with its top-left at `position` (which itself defaults to
// [0, 0]) — so backgrounds / intro / win / lose screens land at (0, 0).
export const drawImage = (ctx, img, position = [0, 0], dimensions = [0, 0]) => {
  const x = Math.round(position[0] - dimensions[0] / 2);
  const y = Math.round(position[1] - dimensions[1] / 2);
  ctx.drawImage(img, x, y);
};
