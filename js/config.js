// Configuration constants. Mirrors configure.lisp.

console.log('Hello from configure!');

// Display
export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 600;
export const WINDOW_TITLE = '(Cloze Call)';

// Simulation
export const FIXED_DT_MS = 1000 / 30;              // 30 steps/second
export const FIXED_DT_SECONDS = FIXED_DT_MS / 1000;
export const MAX_DT_MS = 500;

// Resources
export const GFX_ASSET_PATH = 'data/gfx/';

// Game
export const DEFAULT_GAME_SCREEN_TIME = 2.0;       // seconds
export const G = -10000;                           // gravity constant
export const FORCE_INDICATOR_1_OVER_MAX = 1 / 300;

// Port-specific: when true, caps launch speed at the same threshold where the
// force indicator color saturates (300 px). See design.md §2.4 and §5.
// Flip to false to restore the original uncapped distance-equals-speed model.
export const LAUNCH_SPEED_CAP_AT_INDICATOR_MAX = true;

export const DEFAULT_PLANET_MASS = 500;
export const MAX_ADDITIONAL_PLANET_MASS = 500;
export const SMALL_PLANET_RADIUS = 47;
export const LARGE_PLANET_RADIUS = 94;
export const SMALL_PLANET_DIMENSIONS = [150, 150];
export const LARGE_PLANET_DIMENSIONS = [300, 300];
export const DEFAULT_PLANET_CNT = 3;
export const ADDITIONAL_PLANET_CNT_MAX = 2;
export const MAX_X_GRID_DEVIATION = 25;
export const MAX_Y_GRID_DEVIATION = 25;

export const DEFAULT_BALL_STARTING_POSITION = [50, 50];
export const OFFWORLD_MAX_DISTANCE_FROM_ORIGIN = 2048;

export const MARKER_DISTANCE_TO_SCREEN_BORDER = 10;
export const MARKER_SIZE = [20, 20];
