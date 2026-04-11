# Cloze Call — Reverse-Engineered Design Document

## 1. What the game is

**Cloze Call** is a small 2D "gravity golf" / "gravity pong" game written by Jacek Zlydach in 7 days for the 2010 Lisp Game Design Challenge. The name is a pun on **Clozure Common Lisp** (the implementation it was built on) and "close call" (the ball threading narrowly between planets).

The player is presented with a starfield background containing 3–4 randomly placed planets and a single "hole" target. A ball sits at the top-left of the screen. The player aims with the mouse and flicks the ball by releasing the left mouse button. Once released, the ball is a passive projectile subject to gravity from every planet, and the player can only watch. If it reaches the hole, the player wins. If it hits a planet or flies too far off-world, the player loses a life. Three lives total.

The screen is **800 × 600 pixels**. Physics runs on a fixed time step of **1/30 s** (clamped so `dt` never exceeds 500 ms). Rendering uses SDL via `lispbuilder-sdl`.

Design constants of note (from `configure.lisp`):
- Gravity constant `+G+` = **−10000** (the negative sign gives attraction in the force formula used).
- `+force-indicator-1/max-length+` = 1/300 (force meter saturates when mouse is 300 px from the ball). In the port, this also doubles as the **hard cap** on launch speed (see §2.4, decision 3).
- `+default-ball-velocity+` = 150 existed in the original but was unused dead code. **Removed in the port** — the launch model is distance-based.
- `+default-planet-mass+` = 500; mass can get up to 1000 with random jitter.
- Small planet radius 47 (image 150×150); large planet radius 94 (image 300×300).
- `+default-planet-cnt+` = 3; `+additional-planet-cnt-max+` = 2 (so 3 or 4 planets per level).
- Grid jitter ±25 px on each axis.
- Ball start `#(50 50)`.
- `+offworld-max-distance-from-origin+` = 2048.
- Screen default display time `+default-game-screen-time+` = 2.0 s.
- Marker distance to screen border 10 px, marker size 20×20 (marker image is loaded but barely used — see §2.7).

### 1.1 Port target and constraints

The port is a **static, client-side web app** with these constraints:

- **No build step.** No bundler, transpiler, package manager, or Node toolchain. The code runs as-is in the browser.
- **No runtime dependencies.** No React / Vue / Phaser / physics library / etc. Plain HTML, CSS, vanilla JavaScript (ES modules).
- **Self-contained folder.** `CC-web/` carries its own copy of `data/gfx/` so the whole directory can be dropped into GitHub Pages, or served locally with a one-liner like `python -m http.server` from inside `CC-web/`, and played in any modern browser.
- **Multiple source files are fine**, and we follow the original Lisp source layout where it makes sense (`js/config.js` ↔ `configure.lisp`, `js/math.js` ↔ `math.lisp`, `js/main-game.js` ↔ `main-game-state.lisp`, and so on).
- **ES modules**, so a local HTTP server is required (loading `.js` modules from `file://` is blocked in browsers). This is acceptable because GitHub Pages / `python -m http.server` both satisfy it.
- **Logging goes to the browser `console`** with roughly the same strings the original printed to stdout: `Hello from configure!`, `Hello from Cloze-Call`, `GSM init`, `Loading level ojej ok!`, `quit event received`, etc. The console is the web equivalent of the original's stdout.

## 2. Features, rules, controls

### 2.1 Game flow (state machine)

Top-level flow is driven by a Game State Manager (GSM) that holds a keyed list of game states and switches between them:

1. **`:intro-screen`** — shows `intro1.png` for 2 seconds.
2. **`:intro-screen-2`** — shows `intro2.png` for 2 seconds.
3. **`:main-game`** — actual gameplay.
4. On hole hit → **`:victorious`** → shows `victorious.png` for 2 s → back to `:main-game`.
5. On losing the last life → **`:defeated`** → shows `defeated.png` for 2 s → back to `:main-game`.

Because returning to `:main-game` re-runs its `initialize-state`, a **new random level is generated every time** — the game has no level progression; each play is a fresh procedurally generated board. There is no main menu, no quit key, no pause.

### 2.2 Main-game sub-states

`main-game-state` has an internal sub-state machine (`:aiming`, `:simulation`, `:hole-collision`, `:planet-collision`, `:off-world`), each with its own update and render function.

- **`:aiming`** — Waits for the player to release LMB (falling edge). Draws an aim line from ball to mouse pointer, colored between green and red based on pull strength.
- **`:simulation`** — Every tick:
  1. Compute gravity force from all planets on the ball.
  2. Apply force, integrate velocity and position.
  3. Check for planet collision → `:planet-collision`.
  4. Check for off-world condition → `:off-world`.
  5. Check for hole collision → `:hole-collision`.
- **`:hole-collision`** — Immediately calls GSM → `:victorious`.
- **`:planet-collision`** — Decrement lives. If 0, GSM → `:defeated`. Otherwise reset ball to starting position and go back to `:aiming` (**planets and hole stay in the same places**; same level continues).
- **`:off-world`** — Same behavior as planet collision (decrement + reset or defeat).

### 2.3 Player controls

- **Mouse position** — aims the shot. The aim vector runs from the ball's current position to the mouse cursor.
- **Left mouse button press** — pulled back (charges the shot).
- **Left mouse button release** — fires the ball. The falling edge of LMB is what triggers launch, not the press.

No keyboard input at all. No way in-game to restart, exit, or pause. Closing the window (SDL `:quit-event`) ends the program.

### 2.4 Launch mechanic

On LMB release, the ball's velocity is set by `compute-velocity-from-position-and-mouse-pos`:

```
velocity = normalize(mouse - ball) * distance(mouse, ball)
```

which simplifies to `velocity = (mouse - ball)`. In other words, **the launch speed in pixels/sec equals the pixel distance between the ball and the cursor**, and the direction is toward the cursor. The longer the pull, the faster the shot. The original Lisp code had no cap (the `+default-ball-velocity+` constant was dead code and has been removed in the port).

**Port decision: launch power is capped at 300 px** (the same threshold the force indicator color saturates at), so "full red" aim line = maximum actual shot power. This makes the visual indicator honest. The cap is behind a config flag `LAUNCH_SPEED_CAP_AT_INDICATOR_MAX` (default `true`) — set it to `false` to restore the original uncapped, distance-equals-speed behavior. Marked for play-testing: the cap value (300) may need to be re-tuned, or replaced with a non-linear scale, once the port is playable.

The on-screen "force indicator" is the aim line itself:
- It runs from the ball to the cursor.
- Its color lerps from `sdl:*green*` (weak) to `sdl:*red*` (strong), with the lerp parameter `clamp(distance * 1/300, 0, 1)`. So at ≥300 px the line is fully red.
- It is anti-aliased and clipped to the screen.

### 2.5 Physics

Fixed-timestep (30 Hz). Each simulation tick:

**Gravity field** (`compute-gravity-field`), for each planet body:
```
dir  = normalize(ball.pos - body.pos)          ; points away from body
term = dir * (body.mass / dist(ball, body)^2)
field = sum(term over all bodies)
```

**Apply force** (`apply-force`):
```
force = field * G                              ; G = -10000, so force points toward body
velocity += force * dt / ball.mass             ; ball.mass = 1 in the port
position += velocity * dt
```

Because G is negative and the unit vector points **from body to ball**, multiplying by G flips it into an attractive force toward the body.

**Port decision (ball mass):** in the original Lisp, the `/mass` divisor in `apply-force` was commented out (leftover physics debugging from the hackathon), so the ball's declared mass of 100000 was dead data and the effective mass was 1. The **port keeps the same physical behavior** (mass = 1), but does so by actually storing `mass = 1` on the ball and keeping the `/mass` division live in the integrator. The observable motion is identical; the code is clean.

There is **no collision response between the ball and planets** — a collision is a game-over-the-life event, not a bounce. There is no damping or friction.

### 2.6 Collision / game-end checks

- **Planet collision** (`collisions-p`, `collision-between-objects-p`): simple bounding-circle test — ball hits a planet if `dist(ball.pos, body.pos) < ball.radius + body.radius`.
- **Hole collision** (`collided-with-hole-p`): same bounding-circle test against the hole.
- **Off-world** (`offworld-p`): true if `dist(ball.pos, origin (0,0)) > 2048` **and** the ball's current speed exceeds the **escape velocity** of the whole system, computed as:
  ```
  center_of_mass = average of planet positions (unweighted!)
  M_total        = sum of planet masses
  v_esc          = sqrt(|2 * G * M_total / dist(CoM, ball)|)
  ```
  This is a simplification — a physically correct escape velocity would use the **mass-weighted** center of mass. Also note `+G+` is a negative number here, so the `abs` is needed for the square root to be defined. The rationale in-game: if the ball is far from origin **and** moving fast enough that it can't be pulled back, give up and deduct a life. **Port decision: replicate the original (unweighted) behavior faithfully.** Flagged in §5 for later correction to a mass-weighted centroid.

### 2.7 Off-screen indicator

When the ball goes off-screen during simulation, `render-simulation` draws a green anti-aliased circle to hint where the ball is:
- A `marker.png` asset is loaded at level init but **never drawn** — the actual rendering uses `sdl:draw-circle-*` instead.
- The circle is drawn **at the ball's off-screen position** (i.e. its center is off-screen), with a radius equal to the distance from the off-screen ball to the clamped edge-marker point. So in practice only a slim arc intrudes onto the visible screen near the edge closest to the ball — the larger the arc (and thus the further the ball), the wider the on-screen sliver.

**Port decision: reproduce the original behavior faithfully.** The author recalls this actually worked well — the growing arc gave intuitive feedback about distance and, indirectly, velocity. `marker.png` stays unused. Alternative presentations (actual edge marker sprite, arrow pointing toward the ball, etc.) are listed as a future improvement in §5.

### 2.8 Lives / HUD

- Player starts with **3 lives**. Reset to 3 every time `:main-game` is (re)initialized.
- The README explicitly says "you have three lives (but the counter is invisible)." There is a TODO comment in `render-common` ("draw UI") that was never implemented. **No HUD is drawn at all** — no life counter, no level name, no score.
- Lives decrement on either planet collision or off-world. Either way the ball respawns at `#(50 50)` with zero velocity and the sub-state returns to `:aiming`. Planets and the hole remain where they were.

**Port decision: keep the invisible HUD for the faithful port.** Adding a visible life counter is listed as a future improvement in §5.

### 2.9 Victory / loss

- **Win:** ball's bounding circle intersects the hole's bounding circle. Transition to `:victorious` → 2-second "victorious.png" screen → new random level.
- **Lose:** 3 collisions or off-world exits used up. Transition to `:defeated` → 2-second "defeated.png" screen → new random level.
- **There is no long-term progress or score** — win and lose screens both loop back into a freshly regenerated main game. In the original, the only way to end the game was closing the window (in the web port, closing the tab).

**Port decision: keep this behavior.** First get a faithful port working, then consider adding a main menu / level progression / score, listed in §5.

### 2.10 Level generation

Every time `main-game-state` is (re)initialized, `load-level`/`level-get-celestial-bodies`/`level-get-hole` produce a random board:

- A fixed **grid of 11 candidate positions** on a 4×3-ish layout:
  `(100,300) (100,500) (300,100) (300,300) (300,500) (500,100) (500,300) (500,500) (700,100) (700,300) (700,500)`
- Each picked position is removed from the pool (no overlap between planets/hole slots).
- Each selected position is jittered by `random(0..25)` on each axis.
- **Planets:** count = `3 + random(0..1)` → 3 or 4 planets. Each planet is independently small (50%) or large (50%), with:
  - small: radius 47, image 150×150, picks a random `planetN-small.png` (N∈[1..20]).
  - large: radius 94, image 300×300, picks a random `planetN.png` (N∈[1..20]).
  - mass: `500 + random(0..499)`.
  - color-key at pixel (0,0) — `planetN-small.png` variants are used for small planets.
- **Hole:** position from the grid, radius 15, image 48×48, uses `hole.png`.
- **Ball:** fixed position `(50, 50)`, radius 11, image 22×22, uses `ball.png`. Starts with zero velocity. (In the original, ball mass 100000 was set but unused due to the commented-out `/mass` in `apply-force`. The port sets mass = 1 and keeps the division — see §2.5.)
- **Background:** always `level-background.png`.

Note on ball start position: `(50, 50)` is outside the grid of planet/hole positions (which starts at x=100, y=100). This is **intentional**: it guarantees the ball has a safe pocket in the upper-left corner with no planet possibly spawning on top of it, even with grid jitter. The author confirms the game played correctly with this offset — it is not a bug and should be preserved verbatim in the port.

The `next-level` slot is initialized from `:run-level "ojej"` — `ojej.lisp` is empty (just a placeholder), and `load-level` ignores the name entirely. There is effectively **only one level type**, and the `"ojej"` string is vestigial.

The planet's image is picked **once** at init, and the draw uses that cached `image` surface. `random-planet-image` picks from 1..20, so the PNGs `planet1..planet20` (plus their `-small` variants) are the full sprite pool.

### 2.11 Rendering order (per frame in main game)

`render-common` runs first regardless of sub-state:
1. Clear to black.
2. Draw `level-background.png` at the origin (its draw calls `draw-image` with default zero dimensions, so the image's top-left ends up near the screen origin — the background PNG is authored to the screen size).
3. Draw all planets.
4. Draw the hole.
5. Draw the ball.

Then the sub-state's `render-*` overlays:
- `:aiming` — aim line.
- `:simulation` — possibly the off-screen circle hint.
- other sub-states draw nothing extra (they immediately transition).

All `draw-image` positions are **center-based**: the image is blitted so its center lands on the object's `position`. The helper (`pictures.lisp`) subtracts half the dimensions before blitting.

## 3. Source files

Below, each file and what it contributes. All files are in `CC/src/`.

### 3.1 `package.lisp`
Declares two packages:
- `:trc.math` — exports vector-math primitives (`square`, `make-vector-2d`, `add-vectors`, `add-to-vector`, `scaled-vector`, `scale-vector`, `negative-vector`, `negate-vector`, `distance-between-vectors`, `vector-value`, `normalized-vector`, `clamp`).
- `:trc.cloze-call` — uses `:common-lisp` and `:trc.math`; exports just `:run-game`. Everything else lives internal to this package.

### 3.2 `cloze-call.lisp`
Entry point. Loads all other source files in the right order (configure, math, pictures, GSM, test state, screen states, main game state). Defines `run-game`, which:
1. Initializes SDL video + audio.
2. Creates an 800×600 window titled `(Cloze Call)` with fixed timestep (`+fixed-dt+` = ~33ms, clamped at 500 ms max), double-buffered, DirectX video driver.
3. Creates the GSM, registers states: `:test-state`, `:intro-screen` (`intro1.png` → `:intro-screen-2`), `:intro-screen-2` (`intro2.png` → `:main-game`), `:main-game` (`main-game-state` with `:run-level "ojej"`), `:defeated` (`defeated.png` → `:main-game`), `:victorious` (`victorious.png` → `:main-game`).
4. Starts at `:intro-screen`.
5. Enters SDL event loop: on `:idle` it steps the fixed timestep (converts ms→s) and calls `update-gsm`, then `render-gsm` and flips the buffer. On `:quit-event`, prints a message and exits.

`:test-state` is registered but never activated.

### 3.3 `configure.lisp`
Pure configuration — defines all the `+...+` constants: screen size, window title, fixed/max dt, asset paths (`data/gfx/`, `data/sfx/`, `data/levels/`), default screen display time, gravity, default ball velocity (unused), force indicator factor, planet masses and sizes, small/large planet radius and image dimensions, default/additional planet counts, grid deviation, default ball starting position, off-world distance, marker distance and size.

### 3.4 `math.lisp`
Tiny 2D vector library in the `:trc.math` package: `square`, `make-vector-2d`, `add-vectors` (new vector), `add-to-vector` (in place), `scaled-vector` / `scale-vector`, `negative-vector` / `negate-vector`, `distance-between-vectors`, `vector-value` (magnitude), `normalized-vector`, `clamp`. Each "in-place" variant is paired with a "pure" variant. The postmortem mentions the author confused `negate-vector` with `negative-vector` and spent an hour debugging it — worth noting when porting.

### 3.5 `pictures.lisp`
Image helpers for the `:trc.cloze-call` package:
- `load-image` — loads an image from `+gfx-asset-path+` via `sdl:load-image`, with optional color-key (magic transparent color) taken from the pixel at a given coordinate; sets alpha 255.
- `draw-image` — blits a surface so that its center lands on a given position, given the dimensions. Subtracts `dim/2` from each axis and rounds.

### 3.6 `game-state-manager.lisp`
Generic **Game State Manager** abstraction (no gameplay knowledge):
- `game-state-manager` class: `states` (keyword-indexed list), `current-state`, `next-state` (queued transition).
- `register-game-state`, `change-state` (queue a transition), `update-gsm` (swaps to next state if pending, then runs the current state's `update-logic`), `render-gsm` (calls current state's `render`), `initialize-gsm` / `deinitialize-gsm` (log-only).
- `enforce-proper-gsm-state` — internal: if a transition is queued, deinitialize current, swap in new state, initialize it.
- `with-game-state-manager` macro — creates a GSM, calls `initialize-gsm`, runs body, calls `deinitialize-gsm`.
- Base `game-state` class with `initialize-state`, `deinitialize-state`, `update-logic`, `render` generics that concrete states override.

State transitions happen at the **top of the next update**, not inside the current one, which matters for ports: e.g., `update-hole-collision` calls `change-state gsm :victorious`, but the transition itself happens on the following tick.

### 3.7 `test-game-state.lisp`
A debug-only state that blue-clears and draws `lisp.bmp`. Registered by `run-game` but never entered. Not needed for the port.

### 3.8 `game-screen-state.lisp`
Reusable full-screen image state used for intro1, intro2, defeated, victorious:
- Slots: `big-picture-name`, `big-picture` (surface), `picture-position` (defaults `#(0 0)`), `time` (default 2 s), `accumulator`, `next-state`.
- `initialize-state` — resets the accumulator and loads the image with color-key `#(0 0)`.
- `update-logic` — adds `dt` to accumulator; when it exceeds `time`, queues `change-state gsm next-state`.
- `render` — clears display to black and draws the image via `draw-image` (centered — so the draw actually lands the image centered on (0,0), which is the upper-left corner; the assets are pre-authored with appropriate offsets. Worth verifying visually in the port: the image may be expected to be drawn at (0,0) top-left, and the centered blit may put its top-left at (−w/2, −h/2). In practice, with `make-vector-2d` defaulting to `#(0 0)` for both position and dimmensions in `draw-image`, the subtraction becomes `0 - 0/2 = 0`, so it actually draws at (0,0). Good.).
- Has a TODO comment for fade-ins/outs. Not implemented.

### 3.9 `main-game-state.lisp`
The heart of the game. Defines `main-game-state` and its sub-state machine.

Slots on `main-game-state`: `celestial-bodies`, `ball`, `hole`, `background-image`, `state` (default `:aiming`), `next-level` (initarg `:run-level`), `mouse-left-button-state`, `mouse-prev-left-button-state`, `lives` (default 3), `marker-image`.

Helpers:
- `rising-edge`, `falling-edge` — edge detection on the LMB signal (used to detect "release").
- `change-game-state` — changes the main-game sub-state.
- `lerp`, `lerp-sdl-colors` — linear interpolation for numbers and SDL colors (used for the aim line).
- `apply-force` — Euler integration (velocity += force*dt/1; position += velocity*dt). Ball mass divisor is present but commented out, effectively making ball mass = 1.
- `compute-gravity-field` — sums per-body contribution `normalize(ball - body) * (body.mass / dist²)`. Multiplied by negative G later to point toward the bodies.
- `collision-between-objects-p` — bounding-circle test using `position` and `radius` slots.
- `collisions-p` — true if ball collides with any body.
- `escape-velocity` — `sqrt(|2 * G * M_total / dist(ball, CoM)|)` where CoM is the **unweighted** mean of body positions.
- `offworld-p` — ball farther than 2048 px from origin AND moving faster than escape velocity.
- `collided-with-hole-p` — bounding-circle test against hole.
- `compute-velocity-from-position-and-mouse-pos` — launch velocity = `(mouse - ball)` (both magnitude and direction).
- `compute-force-indicator` — clamp `distance(ball, mouse) / 300` to `[0,1]` for the aim-line color lerp.
- `offscreen-p` — ball position outside 0..800 × 0..600.
- `compute-offscreen-marker-position` — clamps ball position to screen and offsets by the marker distance to the border; used to compute that odd circle-radius for the off-screen hint.

Lifecycle:
- `initialize-state` — loads the level, populates `celestial-bodies`, loads `level-background.png` and `marker.png`, sets `lives`=3, state `:aiming`, creates ball and hole.
- `reinitialize-game` — called after a failed shot: go back to `:aiming`, re-create the ball (`level-get-ball` resets its position to the default). **Does not rebuild celestial bodies or the hole.**
- `deinitialize-state` — no-op.

Sub-state update/render:
- **`:aiming`** — on LMB falling edge, set ball velocity from mouse, switch to `:simulation`. Renders the colored aim line.
- **`:simulation`** — integrates physics, checks planet collision, off-world, hole collision. Renders an anti-aliased green circle hint when ball is off-screen.
- **`:hole-collision`** — switch GSM to `:victorious`.
- **`:planet-collision`** — decrement lives; 0 → GSM `:defeated`; else reinit ball and back to `:aiming`.
- **`:off-world`** — same as planet collision.

Generic per-frame:
- `update-common` — shifts `mouse-left-button-state → mouse-prev-left-button-state`, reads the new LMB state from SDL.
- `render-common` — clears to black, draws background, all bodies, hole, ball. TODO comment notes UI is missing.

The `update-logic`/`render` dispatch a `case` on the sub-state.

### 3.10 `game-objects.lisp`
Loaded from within `main-game-state.lisp`. Defines the game-object hierarchy:
- `game-object` base — slots: `position`, `mass` (default 0), `radius` (default 0), `size` (image dimensions in pixels), `image`.
- Generics: `init`, `deinit`, `update`, `draw`, `collide-p`.
- Default `draw` on anything not a `game-object` errors (defensive).
- `draw (object game-object)` — delegates to `draw-image` (center-based blit).
- `deinit` — no-op.
- **`celestial-body`** subclass: extra slot `small` (bool). `init` sets its image by calling `load-image` on a random `planet1..planet20[-small].png` with color-key `#(0 0)`.
- `random-planet-image` — helper producing a random planet filename. `(+ 1 (random 20))` yields 1..20.
- **`ball`** subclass: slots `velocity` (default `#(0 0)`) and `forces` (unused except for initialization). `init` loads `ball.png` with color-key `#(0 0)`.
- **`hole`** subclass: `init` loads `hole.png` with color-key `#(0 0)`.

### 3.11 `levels.lisp`
Loaded from within `main-game-state.lisp`. Procedural level generation:
- `*level-grid*` — global list of 11 fixed candidate points (see §2.10).
- `reinitialize-level-grid` — restores the full list. The comment acknowledges it's hardcoded.
- `level-get-grid-coord` — picks a random coordinate from the pool, removes it so it won't be reused, and adds a random `(0..24, 0..24)` jitter.
- `load-level` — logs and resets the grid. Ignores the level name (yes — the `"ojej"` name is meaningless).
- `with-game-objects-init` — macro that `init`s a list of objects and returns the list.
- `random-small` — 50/50 boolean.
- `make-celestial-body` — creates a planet at a fresh grid coord, with random size, mass `500 + random(500)`, appropriate radius and image dims. Then calls `init` to load a random planet image.
- `level-get-celestial-bodies` — loop `3 + random(0..1)` times, making and collecting planets.
- `level-get-ball` — creates a ball at `+default-ball-starting-position+` (`#(50 50)`), mass 100000 (unused), radius 11, image 22×22, zero velocity. The `car` is because `with-game-objects-init` returns a list.
- `level-get-hole` — creates a hole at a fresh grid coord, radius 15, image 48×48. Same `car` trick.
- `level-get-background-image-name` — hardcoded `"level-background.png"`.

### 3.12 `deployment.lisp`
Not relevant to gameplay. Sets up the foreign-library bindings (`SDL`, `SDL_gfx`, `SDL_image`) for building a standalone Windows binary and calls `run-game`. Safe to ignore when porting.

### 3.13 `ojej.lisp`
Empty file (1 line, blank). Despite being passed as the level name to `main-game-state`, it is never `load`-ed and has no content.

---

## 4. Port decisions (resolved)

Summary of how each quirk / open question was resolved for the web port. Details are in the sections referenced.

| # | Topic | Decision | Reference |
|---|---|---|---|
| 1 | Ball mass | Logic unchanged: the original had dead `/mass` code making effective mass 1. Port sets `ball.mass = 1` and keeps the `/mass` division live — same motion, cleaner code. | §2.5 |
| 2 | `+default-ball-velocity+` | **Removed** — dead code in the original. Distance-based launch is the canonical model. | §1, §2.4 |
| 3 | Launch power cap | **Capped at 300 px** to match where the force-indicator color saturates. Behind a config flag `LAUNCH_SPEED_CAP_AT_INDICATOR_MAX` (default `true`); setting to `false` restores original uncapped behavior. Value may be retuned after playtesting. | §2.4 |
| 4 | New random level on win/loss | **Kept** — faithful port first. Main menu / level progression listed in §5. | §2.9 |
| 5 | No HUD | **Kept invisible** — faithful port. Visible life counter listed in §5. | §2.8 |
| 6 | Off-screen circle "marker" | **Kept as-is** — `marker.png` stays unused; the growing arc is good tactile feedback. Alternatives listed in §5. | §2.7 |
| 7 | Unweighted centroid in escape velocity | **Replicated verbatim.** Physically-correct mass-weighted centroid listed in §5 as a correction. | §2.6 |
| 8 | PNG alpha vs color-keying | **Mostly free upgrade.** Most assets render cleanly with native PNG alpha (planets, intro, victory, defeat). However `ball.png` and `hole.png` were actually authored for color-keying — they ship with a solid background, no real alpha — so the port reproduces SDL's `:color-key-at #(0 0)` step at preload time: bake a transparent alpha into any pixel matching the `(0,0)` reference pixel. See `js/assets.js` (`applyColorKey`). | §2.11, §3.5 |
| 9 | Ball at (50, 50), outside grid | **Confirmed intentional, preserved verbatim.** Ensures a safe upper-left pocket where no planet can spawn. | §2.10 |
| 10 | Intro / victory / defeat screens, 2 s, not skippable | **Kept non-skippable.** Space-to-skip listed in §5. | §2.1, §3.8 |

## 5. Future changes and extensions (post faithful port)

Things we are explicitly **not** doing in the first pass, but which should be revisited once the base port is playable:

1. **Visible HUD with life counter.** The original joked about the "invisible counter." The port should eventually display the 3 lives (and possibly current streak / total wins) on screen. See §2.8.
2. **Main menu, retry button, and "New Game" flow.** Currently closing the tab is the only way to end the game. At minimum, a main menu on first load and a "Retry" button (or key) after defeat. See §2.9.
3. **Level progression / score / persistence.** Right now every win and every loss just generates a new random level with no memory. Consider: streak counter, time-to-complete, number of shots used, optional difficulty progression (more planets, bigger planets, tighter hole). See §2.9.
4. **Skip intro / win / lose screens with spacebar** (or any key, or click). Currently they block for a hard 2 seconds. See §2.1 and §3.8.
5. **Launch-power cap retuning.** The port ships with the cap at 300 px (flag-controlled); playtest whether that feels right, or whether the model should use a non-linear scale (e.g. square-root, logistic) to preserve fine control near low power while still capping high end. See §2.4.
6. **Physically correct escape velocity.** Replace the unweighted centroid with a mass-weighted center of mass: `CoM = Σ(mᵢ·pᵢ) / Σmᵢ`. Behavior change will be minor in practice but it's free correctness. See §2.6.
7. **Better off-screen indicator.** Alternatives to consider: use `marker.png` as an on-edge arrow pointing toward the ball; draw a small sprite that grows / changes color with distance; combine with the existing arc. The current arc is fine but can be improved. See §2.7.
8. **Audio.** The original had `data/sfx/` in `configure.lisp` but no sounds were actually loaded or played. Add launch / collision / victory / defeat sounds later.
9. **Fade-ins / fade-outs between screens.** The original had a TODO for this in `game-screen-state.lisp`. Simple CSS/canvas fade would be a nice polish. See §3.8.
10. **Mobile / touch input.** Port is mouse-only in the first pass. Tap-and-drag aiming would be a natural touch fit.
11. **Responsive scaling.** The canvas is currently a fixed 800×600. Should scale to the viewport while preserving aspect ratio.
12. **Level seeding / shareable levels.** With a deterministic RNG, a seed in the URL would let people share interesting boards.
