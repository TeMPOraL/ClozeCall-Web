// Cloze Call V2 — dynamic camera.
// design-v2.md §3.3. Pure functions + state object.
// Maps between 800×600 world coordinates and the viewport-filling canvas.

import { CAMERA_LERP_SPEED, CAMERA_PADDING, CAMERA_ZOOM_FLOOR } from './config.js';
import { lerp } from './math.js';

// scaleFactor: at zoom=1 the full 800×600 world fits the canvas.
const sf = (canvasW, canvasH) => Math.min(canvasW / 800, canvasH / 600);

export const createCamera = () => ({
  cx: 400, cy: 300, zoom: 1,
  targetCx: 400, targetCy: 300, targetZoom: 1,
});

// Snap camera to aiming default: centered on the world midpoint, zoom=1.
export const cameraResetToAiming = (cam) => {
  cam.cx = cam.targetCx = 400;
  cam.cy = cam.targetCy = 300;
  cam.zoom = cam.targetZoom = 1;
};

// Compute target center+zoom to fit a bounding box of all game objects.
export const cameraUpdateTarget = (cam, ball, bodies, hole, canvasW, canvasH) => {
  let minX = ball.position[0], maxX = ball.position[0];
  let minY = ball.position[1], maxY = ball.position[1];

  for (const b of bodies) {
    const r = b.radius || 0;
    minX = Math.min(minX, b.position[0] - r);
    maxX = Math.max(maxX, b.position[0] + r);
    minY = Math.min(minY, b.position[1] - r);
    maxY = Math.max(maxY, b.position[1] + r);
  }

  const hr = hole.radius || 0;
  minX = Math.min(minX, hole.position[0] - hr);
  maxX = Math.max(maxX, hole.position[0] + hr);
  minY = Math.min(minY, hole.position[1] - hr);
  maxY = Math.max(maxY, hole.position[1] + hr);

  minX -= CAMERA_PADDING;
  maxX += CAMERA_PADDING;
  minY -= CAMERA_PADDING;
  maxY += CAMERA_PADDING;

  const bbW = maxX - minX;
  const bbH = maxY - minY;

  cam.targetCx = (minX + maxX) / 2;
  cam.targetCy = (minY + maxY) / 2;

  const s = sf(canvasW, canvasH);
  const zoomX = canvasW / (bbW * s);
  const zoomY = canvasH / (bbH * s);
  cam.targetZoom = Math.max(Math.min(zoomX, zoomY), CAMERA_ZOOM_FLOOR);
};

// Smooth-lerp camera state toward targets. Called once per physics tick.
export const cameraUpdate = (cam) => {
  cam.cx   = lerp(cam.cx,   cam.targetCx,   CAMERA_LERP_SPEED);
  cam.cy   = lerp(cam.cy,   cam.targetCy,   CAMERA_LERP_SPEED);
  cam.zoom = lerp(cam.zoom, cam.targetZoom,  CAMERA_LERP_SPEED);
};

// Apply camera transform to a canvas 2D context. Call between ctx.save/restore.
export const cameraApplyTransform = (ctx, cam, canvasW, canvasH) => {
  const s = sf(canvasW, canvasH);
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.scale(cam.zoom * s, cam.zoom * s);
  ctx.translate(-cam.cx, -cam.cy);
};

// Convert canvas-pixel coords to world coords (inverse camera transform).
export const cameraInverseTransform = (cam, canvasW, canvasH, screenX, screenY) => {
  const s = sf(canvasW, canvasH);
  const worldX = (screenX - canvasW / 2) / (cam.zoom * s) + cam.cx;
  const worldY = (screenY - canvasH / 2) / (cam.zoom * s) + cam.cy;
  return [worldX, worldY];
};

// The world-space rectangle currently visible on screen.
export const cameraVisibleRect = (cam, canvasW, canvasH) => {
  const s = sf(canvasW, canvasH);
  const halfW = canvasW / (2 * cam.zoom * s);
  const halfH = canvasH / (2 * cam.zoom * s);
  return {
    x: cam.cx - halfW,
    y: cam.cy - halfH,
    w: halfW * 2,
    h: halfH * 2,
  };
};
