// Asset preloader. The original Lisp code loads images synchronously inside
// each game state's initialize-state; in the browser `Image()` is async, so
// instead we preload every image the game might reference before the main
// loop starts. Game state code can then call loadImage() synchronously.

import { GFX_ASSET_PATH } from './config.js';

const cache = new Map();

const ASSETS = [
  'ball.png',
  'hole.png',
  'marker.png',             // loaded but unused; see design.md §2.7
  'level-background.png',
  'intro1.png',
  'intro2.png',
  'victorious.png',
  'defeated.png',
];
for (let i = 1; i <= 20; i++) {
  ASSETS.push(`planet${i}.png`);
  ASSETS.push(`planet${i}-small.png`);
}

// Some PNGs (ball.png, hole.png) were authored for SDL color-keying instead
// of true alpha: they have a solid background that the original made
// transparent via `:color-key-at #(0 0)` (meaning "use the pixel at (0,0) as
// the transparent color"). The planets ship with real alpha so they don't
// need this. Mirrors the per-image color-key calls in game-objects.lisp.
const COLOR_KEY_IMAGES = new Set([
  'ball.png',
  'hole.png',
]);

const loadOne = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`Failed to load ${src}`));
  img.src = src;
});

// Bake an SDL-style color key into a PNG: any pixel matching the (0,0) pixel
// is forced fully transparent. Returns a canvas that drawImage accepts the
// same way as an HTMLImageElement.
const applyColorKey = img => {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cnv = document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const kr = px[0], kg = px[1], kb = px[2];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] === kr && px[i + 1] === kg && px[i + 2] === kb) {
      px[i + 3] = 0;
    }
  }
  ctx.putImageData(data, 0, 0);
  return cnv;
};

export const preloadAssets = async () => {
  const entries = await Promise.all(
    ASSETS.map(name => loadOne(GFX_ASSET_PATH + name).then(img => {
      const final = COLOR_KEY_IMAGES.has(name) ? applyColorKey(img) : img;
      return [name, final];
    })),
  );
  for (const [name, img] of entries) cache.set(name, img);
  console.log(`Loaded ${entries.length} assets.`);
};

export const loadImage = name => {
  const img = cache.get(name);
  if (!img) throw new Error(`Image not preloaded: ${name}`);
  return img;
};
