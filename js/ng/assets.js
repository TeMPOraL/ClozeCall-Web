// Cloze Call V2 — asset preloader.
// Same contract as v1: preload every image the game might reference before
// the main loop starts, so game states can call loadImage() synchronously.
//
// Difference from v1: `lisp.png` is NOT in the asset list (design-v2.md §19
// answer #9: strip the dead asset). `marker.png` IS in the list and now
// actually gets drawn as the edge arrow (design-v2.md §7).

import { GFX_ASSET_PATH } from './config.js';

const cache = new Map();

const ASSETS = [
  'ball.png',
  'hole.png',
  'marker.png',
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

// ball.png and hole.png were authored for SDL color-keying. Bake transparency
// from the (0,0) pixel so they read correctly in Canvas. See design.md §4
// row 8 and assets.js in v1 for the full story.
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
  console.log(`Loaded ${entries.length} assets. (ng)`);
};

export const loadImage = name => {
  const img = cache.get(name);
  if (!img) throw new Error(`Image not preloaded: ${name}`);
  return img;
};
