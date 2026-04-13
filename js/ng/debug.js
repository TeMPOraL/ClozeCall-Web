// Cloze Call V2 — debug overlay module.
// design-v2.md §15. URL-gated (?debug), zero cost when inactive.

import {
  G, SCREEN_WIDTH, SCREEN_HEIGHT,
  DEBUG_TRAIL_SAMPLE_INTERVAL, DEBUG_TRAIL_MAX_POINTS, DEBUG_TRAIL_DOT_RADIUS_PX,
  DEBUG_CONTOUR_GRID_RES, DEBUG_CONTOUR_LEVELS,
} from './config.js';
import { distance } from './math.js';

// ---- Module state ----

let enabled = false;
let panelOpen = false;
let trailEnabled = false;
let logEnabled = false;

// Trail circular buffer (flat Float64Array: [x0, y0, x1, y1, ...])
let trailBuf = null;
let trailHead = 0;    // next write index (0..MAX-1)
let trailCount = 0;   // entries currently stored (0..MAX)
let tickCounter = 0;

// Energy tracking
let launchEnergy = null;

// Equipotential contour lines (computed once per level, static while planets don't move)
let fieldEnabled = false;
let contourSegments = null; // Float64Array: [x1,y1,x2,y2, ...] flat segment pairs

// Center of gravity (world coords, static per level)
let cogX = 0;
let cogY = 0;

// Trajectory log (accumulated during simulation when logEnabled)
let trajLog = [];       // array of {tick, x, y, vx, vy, ke, pe, e}
let trajLogTick = 0;    // physics tick counter for logging
let levelInfo = null;   // captured on level start for export header

// Hit-test bounds (updated each render frame)
let labelBounds = null;
let trailToggleBounds = null;
let fieldToggleBounds = null;
let logToggleBounds = null;
let exportBtnBounds = null;
let panelBounds = null;

// ---- Internal helpers ----

const scaleFactor = (cw, ch) => Math.min(cw / SCREEN_WIDTH, ch / SCREEN_HEIGHT);

function computeEnergy(ball, bodies) {
  const vx = ball.velocity[0], vy = ball.velocity[1];
  const ke = 0.5 * (vx * vx + vy * vy);
  let pe = 0;
  for (const b of bodies) {
    const d = distance(ball.position, b.position);
    if (d > 0) pe += G * b.mass / d;
  }
  return { ke, pe, total: ke + pe };
}

function fmtE(n) {
  return Math.round(n).toLocaleString();
}

function hitTest(px, py, r) {
  return r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// ---- Equipotential contour computation (marching squares) ----

const CONTOUR_PAD = 200; // world-pixel margin beyond screen bounds

function computeContours(bodies) {
  const res = DEBUG_CONTOUR_GRID_RES;
  const xMin = -CONTOUR_PAD, yMin = -CONTOUR_PAD;
  const xMax = SCREEN_WIDTH + CONTOUR_PAD;
  const yMax = SCREEN_HEIGHT + CONTOUR_PAD;
  const nx = Math.floor((xMax - xMin) / res) + 1;
  const ny = Math.floor((yMax - yMin) / res) + 1;

  // 1. Sample gravitational potential on grid.
  //    V(p) = G · Σ(m_i / max(d_i, r_i))  — clamped at planet surface.
  const grid = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const py = yMin + j * res;
    for (let i = 0; i < nx; i++) {
      const px = xMin + i * res;
      let v = 0;
      for (const b of bodies) {
        const dx = px - b.position[0], dy = py - b.position[1];
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), b.radius);
        v += b.mass / d;
      }
      grid[j * nx + i] = G * v;
    }
  }

  // 2. Choose contour levels (linear spacing, 10th–90th percentile of grid values).
  const sorted = Float64Array.from(grid).sort();
  const lo = sorted[Math.floor(sorted.length * 0.10)];
  const hi = sorted[Math.floor(sorted.length * 0.90)];
  const nLevels = DEBUG_CONTOUR_LEVELS;
  const levels = [];
  for (let k = 1; k <= nLevels; k++) {
    levels.push(lo + (hi - lo) * k / (nLevels + 1));
  }

  // 3. Marching-squares lookup table.
  //    Corners: TL=bit3, TR=bit2, BR=bit1, BL=bit0.
  //    Edges: 0=top(TL→TR), 1=right(TR→BR), 2=bottom(BL→BR), 3=left(TL→BL).
  //    null = saddle (resolved per-cell by center value).
  const LUT = [
    [],         [[2,3]],    [[1,2]],    [[1,3]],
    [[0,1]],    null,       [[0,2]],    [[0,3]],
    [[0,3]],    [[0,2]],    null,       [[0,1]],
    [[1,3]],    [[1,2]],    [[2,3]],    [],
  ];

  const interp = (va, vb, ax, ay, bx, by, iso) => {
    const t = (iso - va) / (vb - va);
    return [ax + t * (bx - ax), ay + t * (by - ay)];
  };

  // 4. Extract segments for all levels.
  const out = [];

  for (const iso of levels) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const tl = grid[j * nx + i];
        const tr = grid[j * nx + (i + 1)];
        const br = grid[(j + 1) * nx + (i + 1)];
        const bl = grid[(j + 1) * nx + i];

        const c = (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0)
                | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
        if (c === 0 || c === 15) continue;

        const x0 = xMin + i * res, y0 = yMin + j * res;
        const x1 = x0 + res, y1 = y0 + res;

        // Lazy edge crossing points.
        const ep = [null, null, null, null];
        const edge = (e) => {
          if (ep[e]) return ep[e];
          switch (e) {
            case 0: return (ep[0] = interp(tl, tr, x0, y0, x1, y0, iso));
            case 1: return (ep[1] = interp(tr, br, x1, y0, x1, y1, iso));
            case 2: return (ep[2] = interp(bl, br, x0, y1, x1, y1, iso));
            case 3: return (ep[3] = interp(tl, bl, x0, y0, x0, y1, iso));
          }
        };

        let pairs = LUT[c];
        if (pairs === null) {
          const center = (tl + tr + br + bl) * 0.25;
          if (c === 5) pairs = center >= iso ? [[0,3],[1,2]] : [[0,1],[2,3]];
          else         pairs = center >= iso ? [[0,1],[2,3]] : [[0,3],[1,2]];
        }

        for (const [ea, eb] of pairs) {
          const a = edge(ea), b = edge(eb);
          out.push(a[0], a[1], b[0], b[1]);
        }
      }
    }
  }

  return new Float64Array(out);
}

// ---- Export text builder ----

function buildExportText() {
  let out = '=== CLOZE CALL DEBUG EXPORT ===\n\n';

  // Level info header
  if (levelInfo) {
    out += '--- LEVEL INFO ---\n';
    out += `Launch point: [${levelInfo.ballStart[0]}, ${levelInfo.ballStart[1]}]\n`;
    out += `Hole: [${levelInfo.hole[0].toFixed(1)}, ${levelInfo.hole[1].toFixed(1)}] r=${levelInfo.holeRadius}\n`;
    out += `G = ${G}\n`;
    out += `dt = 1/60\n`;
    out += `Planets (${levelInfo.planets.length}):\n`;
    for (const p of levelInfo.planets) {
      out += `  pos=[${p.x.toFixed(1)}, ${p.y.toFixed(1)}] mass=${p.mass} radius=${p.radius}\n`;
    }
    out += '\n';
  }

  // Launch energy
  if (launchEnergy !== null) {
    out += `--- LAUNCH ---\n`;
    out += `E_launch = ${launchEnergy.toFixed(4)}\n\n`;
  }

  // Trajectory data
  out += '--- TRAJECTORY (tick, x, y, vx, vy, KE, PE, E) ---\n';
  for (const r of trajLog) {
    out += `${r.tick}\t${r.x.toFixed(2)}\t${r.y.toFixed(2)}\t${r.vx.toFixed(4)}\t${r.vy.toFixed(4)}\t${r.ke.toFixed(2)}\t${r.pe.toFixed(2)}\t${r.e.toFixed(2)}\n`;
  }

  if (trajLog.length === 0) {
    out += '(no data — enable logging before firing a shot)\n';
  }

  return out;
}

// ---- Public API ----

/** Check URL for ?debug parameter. Call once at boot. */
export function debugInit() {
  enabled = new URLSearchParams(window.location.search).has('debug');
  if (enabled) {
    trailBuf = new Float64Array(DEBUG_TRAIL_MAX_POINTS * 2);
    console.log('Debug overlay enabled (?debug)');
  }
}

/** True if ?debug was present in the URL. */
export function debugIsEnabled() {
  return enabled;
}

/** Called when a new level is loaded or ball resets within a level. */
export function debugOnLevelStart(bodies, ball, hole) {
  if (!enabled) return;
  trailHead = 0;
  trailCount = 0;
  tickCounter = 0;
  trajLogTick = 0;
  launchEnergy = null;
  trajLog = [];

  // Mass-weighted centroid of all planets (design-v2.md §15.5).
  let totalMass = 0, sx = 0, sy = 0;
  for (const b of bodies) {
    totalMass += b.mass;
    sx += b.mass * b.position[0];
    sy += b.mass * b.position[1];
  }
  cogX = totalMass > 0 ? sx / totalMass : SCREEN_WIDTH / 2;
  cogY = totalMass > 0 ? sy / totalMass : SCREEN_HEIGHT / 2;

  // Capture level info for export header.
  levelInfo = {
    ballStart: [ball.position[0], ball.position[1]],
    hole: [hole.position[0], hole.position[1]],
    holeRadius: hole.radius,
    planets: bodies.map(b => ({
      x: b.position[0],
      y: b.position[1],
      mass: b.mass,
      radius: b.radius,
    })),
  };

  // Precompute equipotential contour lines (planets are static per level).
  contourSegments = computeContours(bodies);
}

/** Called when the ball is launched (aiming -> simulation). Captures E_launch. */
export function debugOnSimulationStart(ball, bodies) {
  if (!enabled) return;
  trailHead = 0;
  trailCount = 0;
  tickCounter = 0;
  trajLogTick = 0;
  trajLog = [];
  launchEnergy = computeEnergy(ball, bodies).total;
}

/** Called each physics tick during simulation. Samples trail + trajectory log. */
export function debugOnPhysicsTick(ball, bodies) {
  if (!enabled) return;

  trajLogTick++;

  // Trail sampling
  if (trailEnabled && trajLogTick % DEBUG_TRAIL_SAMPLE_INTERVAL === 0) {
    const i = trailHead * 2;
    trailBuf[i]     = ball.position[0];
    trailBuf[i + 1] = ball.position[1];
    trailHead = (trailHead + 1) % DEBUG_TRAIL_MAX_POINTS;
    if (trailCount < DEBUG_TRAIL_MAX_POINTS) trailCount++;
  }

  // Trajectory logging (every sample interval, same rate as trail)
  if (logEnabled && trajLogTick % DEBUG_TRAIL_SAMPLE_INTERVAL === 0) {
    const e = computeEnergy(ball, bodies);
    trajLog.push({
      tick: trajLogTick,
      x: ball.position[0],
      y: ball.position[1],
      vx: ball.velocity[0],
      vy: ball.velocity[1],
      ke: e.ke,
      pe: e.pe,
      e: e.total,
    });
  }
}

/**
 * Draw trail dots + CoG marker in world space.
 * Call inside the camera transform (between steps 8 and 10 of §3.5).
 */
export function debugRenderWorld(ctx, cam, canvasW, canvasH) {
  if (!enabled || !panelOpen) return;

  const invScale = 1 / (cam.zoom * scaleFactor(canvasW, canvasH));

  // --- Equipotential contour lines ---
  if (fieldEnabled && contourSegments && contourSegments.length > 0) {
    ctx.strokeStyle = 'rgba(0, 200, 200, 0.3)';
    ctx.lineWidth = 1 * invScale;
    ctx.beginPath();
    for (let k = 0; k < contourSegments.length; k += 4) {
      ctx.moveTo(contourSegments[k], contourSegments[k + 1]);
      ctx.lineTo(contourSegments[k + 2], contourSegments[k + 3]);
    }
    ctx.stroke();
  }

  // --- Center-of-gravity crosshair (design-v2.md §15.5) ---
  const arm = 4 * invScale;
  ctx.strokeStyle = 'rgba(0, 200, 200, 0.5)';
  ctx.lineWidth = 1.5 * invScale;
  ctx.beginPath();
  ctx.moveTo(cogX - arm, cogY);
  ctx.lineTo(cogX + arm, cogY);
  ctx.moveTo(cogX, cogY - arm);
  ctx.lineTo(cogX, cogY + arm);
  ctx.stroke();

  // --- Trail dots (design-v2.md §15.6) ---
  if (!trailEnabled || trailCount === 0) return;
  const r = DEBUG_TRAIL_DOT_RADIUS_PX * invScale;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.beginPath();
  const start = trailCount < DEBUG_TRAIL_MAX_POINTS ? 0 : trailHead;
  for (let j = 0; j < trailCount; j++) {
    const idx = ((start + j) % DEBUG_TRAIL_MAX_POINTS) * 2;
    const x = trailBuf[idx], y = trailBuf[idx + 1];
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * Draw "DEBUG" label + panel overlay in screen space.
 * Call after the HUD (step 12 of §3.5).
 */
export function debugRenderHud(ctx, ball, bodies, canvasW, canvasH) {
  if (!enabled) return;

  const pad = 12;
  const font = '12px ui-monospace, Menlo, Consolas, monospace';
  const lineH = 16;
  const panelPad = 6;

  // --- "DEBUG" label (always visible when ?debug) ---
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  const lx = pad, ly = canvasH - pad;

  // Drop shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillText('DEBUG', lx + 1, ly + 1);
  // Foreground — green when panel is open, dim white when closed.
  ctx.fillStyle = panelOpen ? 'rgba(0, 255, 100, 0.8)' : 'rgba(255, 255, 255, 0.6)';
  ctx.fillText('DEBUG', lx, ly);

  const lm = ctx.measureText('DEBUG');
  labelBounds = { x: lx - 2, y: ly - 14, w: lm.width + 4, h: 18 };

  if (!panelOpen) {
    fieldToggleBounds = null;
    trailToggleBounds = null;
    logToggleBounds = null;
    exportBtnBounds = null;
    panelBounds = null;
    return;
  }

  // --- Build panel lines (top to bottom) ---
  const lines = [];

  if (launchEnergy !== null && ball && bodies) {
    const e = computeEnergy(ball, bodies);
    lines.push(`E\u2080:  ${fmtE(launchEnergy)}`);
    lines.push(`KE:  ${fmtE(e.ke)}`);
    lines.push(`PE:  ${fmtE(e.pe)}`);
    lines.push(`E:   ${fmtE(e.total)}`);
    if (Math.abs(launchEnergy) > 1e-6) {
      const pct = ((e.total - launchEnergy) / Math.abs(launchEnergy)) * 100;
      lines.push(`\u0394E:  ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
    } else {
      lines.push('\u0394E:  N/A');
    }
  } else {
    lines.push('E: (aiming)');
  }

  lines.push('');  // visual separator

  // Toggles and buttons
  const fieldLineIdx = lines.length;
  lines.push(`[${fieldEnabled ? 'x' : ' '}] Field`);

  const trailLineIdx = lines.length;
  lines.push(`[${trailEnabled ? 'x' : ' '}] Trail`);

  const logLineIdx = lines.length;
  lines.push(`[${logEnabled ? 'x' : ' '}] Log`);

  let exportLineIdx = -1;
  if (logEnabled) {
    exportLineIdx = lines.length;
    lines.push(`> Export (${trajLog.length} pts)`);
  }

  // --- Panel background ---
  const panelW = 180;
  const textH = lines.length * lineH;
  const panelH = textH + panelPad * 2;
  const panelBottom = ly - 22;             // gap above label
  const panelTop = panelBottom - panelH;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(pad - 4, panelTop, panelW, panelH);

  // --- Panel text ---
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue;
    // Highlight the export button
    if (i === exportLineIdx) {
      ctx.fillStyle = 'rgba(100, 200, 255, 0.9)';
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    }
    ctx.fillText(lines[i], pad + panelPad - 2, panelTop + panelPad + i * lineH);
  }

  // --- Hit-test bounds ---
  fieldToggleBounds = {
    x: pad - 4,
    y: panelTop + panelPad + fieldLineIdx * lineH,
    w: panelW,
    h: lineH,
  };

  trailToggleBounds = {
    x: pad - 4,
    y: panelTop + panelPad + trailLineIdx * lineH,
    w: panelW,
    h: lineH,
  };

  logToggleBounds = {
    x: pad - 4,
    y: panelTop + panelPad + logLineIdx * lineH,
    w: panelW,
    h: lineH,
  };

  if (exportLineIdx >= 0) {
    exportBtnBounds = {
      x: pad - 4,
      y: panelTop + panelPad + exportLineIdx * lineH,
      w: panelW,
      h: lineH,
    };
  } else {
    exportBtnBounds = null;
  }

  // Panel bounds (entire panel + label area).
  panelBounds = {
    x: pad - 4,
    y: panelTop,
    w: panelW,
    h: (panelBottom - panelTop) + 22 + 18,
  };
}

/**
 * Hit-test the debug label and panel. Returns true if the click was consumed.
 * @param {number} screenX — canvas-pixel X (from release.raw).
 * @param {number} screenY — canvas-pixel Y (from release.raw).
 */
export function debugHandleClick(screenX, screenY) {
  if (!enabled) return false;

  // Toggle panel on label click.
  if (hitTest(screenX, screenY, labelBounds)) {
    panelOpen = !panelOpen;
    return true;
  }

  // Panel controls.
  if (panelOpen) {
    if (hitTest(screenX, screenY, fieldToggleBounds)) {
      fieldEnabled = !fieldEnabled;
      return true;
    }
    if (hitTest(screenX, screenY, trailToggleBounds)) {
      trailEnabled = !trailEnabled;
      return true;
    }
    if (hitTest(screenX, screenY, logToggleBounds)) {
      logEnabled = !logEnabled;
      return true;
    }
    if (hitTest(screenX, screenY, exportBtnBounds)) {
      const text = buildExportText();
      navigator.clipboard.writeText(text).then(
        () => console.log(`Debug export: ${trajLog.length} points copied to clipboard.`),
        (err) => {
          console.warn('Clipboard write failed, logging to console instead:', err);
          console.log(text);
        }
      );
      return true;
    }
    // Consume any click inside the panel area to avoid accidental forfeits.
    if (hitTest(screenX, screenY, panelBounds)) {
      return true;
    }
  }

  return false;
}
