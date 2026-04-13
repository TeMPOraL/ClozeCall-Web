// Cloze Call V2 — configuration constants.
// See design-v2.md for context. This is the v2 equivalent of the v1 config.js
// mirroring configure.lisp, retuned for 60 Hz and the new launch cap.

console.log('Hello from configure! (ng)');

// ---- Display ----
export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 600;
export const WINDOW_TITLE = '(Cloze Call) NG';

// ---- Simulation ----
// design-v2.md §2: 60 Hz fixed-timestep physics, RAF-driven render.
export const FIXED_DT_MS = 1000 / 60;
export const FIXED_DT_SECONDS = FIXED_DT_MS / 1000;
// Clamp a single frame's delta so a tab-switch pause doesn't produce a flood
// of physics steps on resume. design-v2.md §2.2.
export const MAX_DT_MS = 500;

// ---- Resources ----
export const GFX_ASSET_PATH = 'data/gfx/';

// ---- Game ----
export const DEFAULT_GAME_SCREEN_TIME = 2.0; // seconds
export const G = -10000;                     // gravity constant

// Launch cap. design-v2.md §5.3: unconditional 400 px clamp, indicator and
// clamp share the same threshold. v1's LAUNCH_SPEED_CAP_AT_INDICATOR_MAX flag
// is gone.
export const LAUNCH_SPEED_CAP = 400;
// Kept for compatibility with the aim-line code that lerps green->red by
// distance. 1 / LAUNCH_SPEED_CAP, inlined here so we don't divide every frame.
export const FORCE_INDICATOR_1_OVER_MAX = 1 / LAUNCH_SPEED_CAP;

// ---- Aim preview (design-v2.md §5) ----
// Total arc length cap in design pixels. Stops even if step cap not reached.
export const PREVIEW_MAX_ARC_LENGTH = 300;
// Step cap (belt-and-suspenders for zero-velocity shadow simulations).
// 60 steps @ 16.67 ms = ~1 s of simulated time.
export const PREVIEW_MAX_STEPS = 60;

// ---- Screen transitions (design-v2.md §12) ----
export const FADE_IN_DURATION = 0.25;         // seconds
export const FADE_OUT_DURATION = 0.25;        // seconds
// A screen can be skipped only after this minimum display time, so a rapid
// tap-through can't skip past something the player hasn't seen.
export const SCREEN_MIN_DISPLAY_TIME = 0.3;   // seconds

// ---- Planets / masses (base values; difficulty ramp scales these) ----
export const DEFAULT_PLANET_MASS = 500;
export const MAX_ADDITIONAL_PLANET_MASS = 500;
export const SMALL_PLANET_RADIUS = 47;
export const LARGE_PLANET_RADIUS = 94;
export const SMALL_PLANET_DIMENSIONS = [150, 150];
export const LARGE_PLANET_DIMENSIONS = [300, 300];
export const MAX_X_GRID_DEVIATION = 25;
export const MAX_Y_GRID_DEVIATION = 25;

// ---- Difficulty ramp (design-v2.md §11) ----
// Per-level parameters derive from `streak`. All thresholds live here so
// play-testing can tune them without touching gameplay code.
export const DIFFICULTY = {
  BASE_PLANET_COUNT:   3,
  PLANET_STREAK_DIV:   3,   // +1 planet every 3 streak levels
  EXTRA_PLANET_MAX:    2,   // random(0..EXTRA_PLANET_MAX-1) extras, i.e. 0 or 1
  PLANET_COUNT_MAX:    6,   // hard cap
  BASE_PLANET_MASS:    500, // = DEFAULT_PLANET_MASS at streak 0
  MASS_STREAK_DIV:     2,   // +MASS_STREAK_STEP every 2 streak levels
  MASS_STREAK_STEP:    50,
  MASS_JITTER_MAX:     500, // = MAX_ADDITIONAL_PLANET_MASS
  MASS_CEILING:        1500,
};

// ---- Ball ----
export const DEFAULT_BALL_STARTING_POSITION = [50, 50];
export const OFFWORLD_MAX_DISTANCE_FROM_ORIGIN = 2048;

// ---- Off-screen marker (design-v2.md §7) ----
export const MARKER_DISTANCE_TO_SCREEN_BORDER = 10;
export const MARKER_SIZE = [20, 20];
// Rotation offset applied to marker.png when drawing the edge arrow. Unused
// until we inspect the sprite and decide if its "tip" faces right (0 rad) or
// some other direction. Adjust during wiring-up.
export const MARKER_ROTATION_OFFSET = 0;

// ---- Camera (design-v2.md §3.3) ----
export const CAMERA_LERP_SPEED = 0.05;
export const CAMERA_PADDING = 100;       // world-units of margin around bounding box
export const CAMERA_ZOOM_FLOOR = 0.15;   // minimum zoom (max zoom-out)

// ---- Shot forfeit (design-v2.md §9.5) ----
export const FORFEIT_GRACE_SECONDS = 0.5;
export const FORFEIT_HINT_DELAY_SECONDS = 2.0;

// ---- Lives ----
export const LIVES_PER_LEVEL = 3;

// ---- Persistence ----
export const LS_BEST_STREAK = 'cloze-call:v2:best-streak';
export const LS_MUTED       = 'cloze-call:v2:muted';
export const LS_SEEN_INTRO  = 'cloze-call:v2:seen-intro';

// ---- Debug overlay (design-v2.md §15) ----
export const DEBUG_TRAIL_SAMPLE_INTERVAL = 6;   // physics ticks between samples (60/6 = 10 Hz)
export const DEBUG_TRAIL_MAX_POINTS = 3000;     // circular buffer capacity (~5 min at 10 Hz)
export const DEBUG_TRAIL_DOT_RADIUS_PX = 3;     // screen-pixel radius of trail dots
export const DEBUG_CONTOUR_GRID_RES = 10;       // world-pixel cell size for potential grid
export const DEBUG_CONTOUR_LEVELS = 16;         // number of equipotential contour lines
