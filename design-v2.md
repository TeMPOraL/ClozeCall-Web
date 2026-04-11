# Cloze Call — Web Port V2 Design

This document describes the second iteration of the Cloze Call web port. It builds on the faithful v1 port documented in `design.md`. Where v1 aimed to reproduce the 2010 Lisp game verbatim, v2 turns it into something actually pleasant to play on a modern device — mobile included — while keeping the same core loop (aim, fire, dodge planets, hit the hole).

V2 is still a **static, client-side web app with zero build steps**, served over a plain HTTP origin. All v1 constraints (no bundler, no runtime dependencies, ES modules, self-contained `CC-web/` folder, GitHub-Pages-ready) continue to apply.

**V2 lives alongside v1, not on top of it.** The v1 port at `index.html` + `css/style.css` + `js/*.js` stays untouched and fully playable. V2 gets its own parallel entry point and source tree:

- `CC-web/index-ng.html` — V2 entry point.
- `CC-web/css/ng/style.css` — V2 stylesheet.
- `CC-web/js/ng/*.js` — V2 source tree (complete copy of the v1 modules plus the new ones, modified as described below).
- `CC-web/data/gfx/*` — **shared with v1**; both ports reference the same sprite folder. No duplication.

"ng" stands for "next-generation / V2". Pick whichever HTML file you want to load; each is a self-contained game.

---

## 1. Scope of V2

V2 addresses every item in v1 `design.md §5` plus the four explicit upgrades the user called out:

- **mobile/touch support** with tap-and-drag aiming,
- **a short aim preview line** that integrates gravity forward and shows where the ball will actually go,
- **viewport-responsive scaling** of the canvas,
- **60 Hz fixed-timestep physics** and 60 Hz rendering (replacing v1's 30 Hz cap),
- **mass-weighted centroid** in the escape-velocity computation (correcting the original's physics bug).

Additionally, v2 introduces:

- visible HUD (lives, current streak, best streak),
- main menu and retry/new-game flow,
- level progression with a difficulty ramp,
- skippable intro / victory / defeat screens (space, enter, click, or tap),
- fade-in/fade-out transitions between screens,
- synthesized audio via Web Audio API,
- deterministic PRNG with shareable seed URLs,
- combined edge-arrow + circle-arc off-screen indicator using `marker.png`.

### 1.1 What is explicitly unchanged

To keep scope focused, v2 does **not** touch the following (and any change there is a bug):

- The core gravity formula (`F ∝ m / r²` per body, summed, multiplied by `G = −10000`).
- The bounding-circle collision model (ball-radius + other-radius).
- The Euler integrator (`v += F·dt/m`, `x += v·dt`) — only `dt` changes (and that's automatic from the new timestep).
- The 11-cell candidate grid and ±25 px jitter used for planet/hole placement (though the *count* scales with difficulty — see §11).
- The ball's fixed starting position at `(50, 50)` and its effective mass of 1.
- The `800 × 600` design resolution. Only the on-screen presentation scales; the physics world stays 800 × 600.
- The `ball.png` / `hole.png` color-keying workaround documented in v1 `design.md §4 row 8` (ship-as-is).

### 1.2 Target platforms

- **Desktop**: mouse + keyboard, any modern browser (Chrome, Firefox, Safari, Edge), any viewport ≥ 640×480 ideal; smaller viewports letterbox.
- **Mobile**: iOS Safari, Android Chrome, in portrait and landscape. Primary interaction is touch. Minimum comfortable width around 360 CSS px.
- **Input assumptions**: Pointer Events API (`pointerdown`/`move`/`up`/`cancel`) unifies mouse, touch, and stylus. Available in all target browsers.

---

## 2. Main loop: 60 Hz fixed-timestep physics, RAF rendering

### 2.1 What v1 does

V1 drives the whole game from a `setInterval(tick, 1000/30)` loop. Each tick both advances the physics one fixed `1/30 s` step and renders. This was chosen as a workaround because `requestAnimationFrame` is throttled in background/preview tabs.

### 2.2 V2 design

- **Physics: fixed timestep at 60 Hz** (`FIXED_DT_SECONDS = 1/60`). Fixed timestep is preserved because the user explicitly values deterministic, reproducible physics.
- **Rendering: `requestAnimationFrame`-driven**, ideally matching display refresh (usually 60 Hz; 120 Hz on higher-end devices will just call render more often, which is cheap).
- **Accumulator pattern** to decouple them:

  ```
  on frame(now):
      frameDt = clamp(now - lastTime, 0, MAX_DT_MS)
      lastTime = now
      accumulator += frameDt
      while accumulator >= FIXED_DT_MS:
          gsm.update(FIXED_DT_SECONDS)
          accumulator -= FIXED_DT_MS
      gsm.render(ctx)
      requestAnimationFrame(frame)
  ```

- **`MAX_DT_MS` stays at 500 ms**, so a long tab-switch pause doesn't produce 600 physics steps on resume.
- **Background-tab behavior**: RAF pauses; the game pauses with it. That's the desired behavior for a real game — no need to simulate while the tab is hidden. (This differs from v1's `setInterval`, which kept running invisibly.)
- **Decoupled reads**: the render code never reads `performance.now()` directly for animation; it uses the current physics state. With 60 Hz physics and 60 Hz render, interpolation is unnecessary and skipped. (If we later want 120 Hz rendering with 60 Hz physics, an interpolation factor can be added.)

### 2.3 Notes on the dt change

Halving `dt` (33.3 ms → 16.7 ms) reduces Euler integration error, particularly near planets where the field is steep. Expect close-orbit trajectories to feel slightly more predictable. Launch power and overall feel should be indistinguishable to the player.

**Tunable**: `FIXED_DT_MS` in `js/config.js`. Changing it re-tunes the whole simulation, so shouldn't be touched casually.

---

## 3. Viewport scaling & responsive canvas

### 3.1 What v1 does

V1 sets the canvas to intrinsic `800 × 600` and does not scale it. On a 4K display it renders as a small rectangle in the center; on a phone it overflows and scrolls.

### 3.2 V2 design

- **The canvas keeps an intrinsic resolution of `800 × 600`** — the game's world coordinates are unchanged. Planets, the ball, the hole, and all collision math stay in design pixels.
- **CSS scales the canvas to fit the viewport**, preserving the 4:3 aspect ratio with letterboxing:

  ```css
  html, body { height: 100%; margin: 0; background: #000; overflow: hidden; }
  #wrap {
    position: fixed; inset: 0;
    display: grid; place-items: center;
  }
  #game {
    width: min(100vw, calc(100vh * 4 / 3));
    height: min(100vh, calc(100vw * 3 / 4));
    image-rendering: auto;
    touch-action: none;   /* critical for mobile */
  }
  ```

- **Aspect ratio preserved** via the `min(...)` trick — no CSS JavaScript sizing needed.
- **Input coordinates converted to design pixels** in `input.js` using the bounding-rect scale factor (v1 already does this; no change).
- **Orientation**: works in both portrait and landscape. In portrait on a phone the canvas becomes quite small; acceptable for a simple aim-and-fire game. No rotation prompt.
- **HiDPI / devicePixelRatio**: skipped for v2 — the pixel art style (intro backgrounds, planet sprites) reads fine at 1x. If we later want crisp scaling, we'd set `canvas.width = 800 * dpr` and scale the 2D context, but that complicates the fixed-800×600 world-coordinate contract. Deferred to v3.

### 3.3 Tunables

- `--cc-max-width` / `--cc-max-height` CSS vars could limit the canvas on ultra-wide monitors; not included initially.

---

## 4. Input: pointer events for mouse + touch + keyboard

### 4.1 What v1 does

V1 listens to `mousedown`/`mouseup`/`mousemove` separately on the canvas (down) and window (move/up). It does not support touch at all — on mobile, a tap is interpreted as a click; dragging scrolls the page and no launch happens.

### 4.2 V2 design

- **Pointer Events API** replaces all mouse events. `pointerdown`, `pointermove`, `pointerup`, `pointercancel`. This unifies mouse, touch, and stylus into one code path.
- **`touch-action: none`** on the canvas (set in CSS, §3) disables native scroll/zoom/pinch gestures that would otherwise eat the drag.
- **Aim direction semantics unchanged from v1**: the player taps/clicks and drags, and the ball will fire **toward the release point** (the aim line runs from ball to pointer). This is "point-and-shoot", not "slingshot-pullback".
- **Pointer state**:
  - `pressed` — a pointer is currently down on the canvas.
  - `hovering` — a mouse pointer is currently over the canvas (touch never sets this).
  - `x`, `y` — current pointer position in design-pixel (`800×600`) coordinates.
- **Visibility rule** for the aim line + guide preview: visible when `hovering || pressed`. This means:
  - **Mouse users** see the aim line constantly while the cursor is on the canvas (matches v1 feel).
  - **Touch users** see the aim line only while dragging. After release, the aim line vanishes. There's no "hover" on touch.
- **Distinguishing input types**: `event.pointerType === 'mouse'` enables/disables the hover behavior.
- **Launch trigger**: `pointerup` with `pressed === true` fires the shot (same falling-edge detection as v1). `pointercancel` (e.g., system interruption) cancels the pending shot without firing, restoring the `aiming` state cleanly.
- **Multi-touch**: the game ignores secondary pointers — only the first active pointer's events are tracked. Two-finger gestures do nothing (and `touch-action: none` prevents pinch-zoom from eating them).
- **Keyboard**:
  - `Space` or `Enter` — skip the currently displayed intro/victory/defeat screen once its minimum display time has passed (see §12.2).
  - `Space` or `Enter` on the main menu — PLAY.
  - `Esc` — from a game, return to the main menu (after confirmation? Probably just no confirmation for v2 simplicity).
  - All key handling goes through a small `keyboard.js` module to keep it out of `input.js`.
- **Preventing unwanted browser behaviors**: call `e.preventDefault()` on `pointerdown` to kill text-selection and iOS long-press. Call `e.preventDefault()` on the relevant keydowns to stop Space from scrolling.

### 4.3 Design-pixel conversion

The coordinate conversion logic from v1 (`input.js`) stays, but is generalized: any pointer event's `clientX`/`clientY` becomes a `[x, y]` in design pixels by using the canvas's `getBoundingClientRect()` and the `canvas.width / rect.width` scale. This already handles the CSS-scaled canvas from §3 automatically.

---

## 5. Aim preview (short guide line with gravity)

### 5.1 Rationale

Gravity from multiple bodies is hard to intuit, especially on a first playthrough. v1 shows only a straight line from ball to cursor, which is useless once the ball enters the first gravity well. V2 adds a **forward-integrated trajectory preview** so the player can see, for the next half-second or so, roughly what the ball will do if fired now.

### 5.2 Design

- **Computed in the `aiming` sub-state every render**, not every physics tick — the preview is a rendering overlay, not a simulation state.
- **Forward integration**:
  1. Take a shadow copy of the ball (position, velocity computed as if firing now).
  2. Apply `applyForce` with the current `computeGravityField` on the live planets.
  3. Step forward at the same `FIXED_DT_SECONDS` used by physics — this guarantees the preview matches what will actually happen.
  4. Record `[x, y]` after each step.
- **Stop conditions** (whichever fires first):
  - `PREVIEW_MAX_ARC_LENGTH` total arc length reached. Default **300 design pixels** (the same scale the user specified).
  - `PREVIEW_MAX_STEPS` physics steps simulated. Default **60 steps** (~1 second of real time at 60 Hz) as a belt-and-suspenders cap so a near-zero launch speed doesn't create an infinite loop inside one frame.
  - The shadow ball collides with a planet (bounding-circle test). Preview stops at the collision point — visually telling the player "you'll hit here". The hole is *not* a stop condition (we don't want to spoil the win).
  - The shadow ball goes more than, say, 2× the design size off-screen (same `+offworld-max-distance-from-origin+` sentinel — truncate early to save work).
- **Rendering**:
  - Polyline through the recorded points.
  - Faint white (`rgba(255, 255, 255, 0.6)`) with 2-pixel width.
  - **Dashed pattern** via `ctx.setLineDash([6, 4])` so it reads clearly against the stellar background.
  - **Uniform alpha along the length** (no fade) — answered in §19, chosen for simplicity and consistent legibility.
- **Does not** include the aim line itself — the existing straight line-to-cursor stays as-is (its green→red gradient is the force indicator, now aligned with the new cap — see §5.3). The preview is drawn in addition, from the ball forward along the predicted trajectory.
- **Visual layering**: aim line → preview → mouse/touch cursor marker (if any). Drawn after the main render-common pass, above planets/ball/hole.

### 5.3 Interaction with the launch-power cap

V1 capped launch speed at 300 design pixels (§2.4 in `design.md`). V2 retunes this to **400 design pixels** with the same simple clamp:

- Below 400 px of drag distance: launch speed = drag distance (linear).
- At or above 400 px: launch speed = 400.

The aim line's green→red color lerp saturation threshold moves to 400 px too, so the visual indicator and the actual cap stay in sync. Replace `+force-indicator-1/max-length+` (1/300 in v1) with `1/400` and introduce a single `LAUNCH_SPEED_CAP` constant that both the color lerp and the speed clamp read.

Rationale: 300 was *tight* in v1 playtesting (most shots look full-red before they feel powerful enough to reach the hole). 400 gives a bit more dynamic range. This is still tunable via `js/config.js`. The `LAUNCH_SPEED_CAP_AT_INDICATOR_MAX` flag from v1 is dropped — v2's cap is unconditional because the preview trajectory already makes "is this enough power?" legible.

### 5.4 Performance

60 preview steps × a handful of bodies × a few arithmetic ops per step = trivial. No allocation-heavy math; reuse plain arrays. No reason to optimize beyond "don't allocate arrays inside the inner loop if it matters."

---

## 6. Physics correction: mass-weighted centroid for escape velocity

### 6.1 The bug

`escape-velocity` in v1 (and the original) computes:

```
CoM         = (sum of planet positions) / planet count
v_escape    = sqrt(|2 * G * M_total / dist(CoM, ball)|)
```

The centroid is **unweighted**, treating all planets as equal. A small 500-mass planet has the same pull on the centroid as a 1000-mass giant, which is wrong.

### 6.2 The fix

Use the mass-weighted centroid:

```
CoM = (sum of mass_i * position_i) / sum(mass_i)
```

Everything else about the escape-velocity computation stays the same. The total mass `M_total` in the numerator is unchanged (it's already `sum(mass_i)`), and `G` stays negative so the `abs` wrapper is still needed.

This is still not a textbook-correct escape velocity for a system of point masses — real physics would integrate the potential along the ball's trajectory — but the formula remains a useful heuristic for "is the ball far enough and fast enough to never come back?", now with a centroid that reflects actual mass distribution.

### 6.3 Behavioral impact

Small: off-world detection triggers marginally sooner for balls fleeing in the direction of a dense cluster of large planets, and marginally later when fleeing past a tiny planet. No change in the vast majority of plays. No tuning knobs added.

---

## 7. Off-screen marker: edge arrow + circle arc

### 7.1 What v1 does

V1 draws a large anti-aliased green circle centered on the off-screen ball, with radius equal to the distance from the ball to its clamped edge-marker point. Only a slim arc intrudes onto the visible screen near the edge closest to the ball. Growing arc = farther ball = more dramatic sweep = nice feedback, per postmortem recall. `marker.png` is loaded but never drawn.

### 7.2 V2 design

- **Keep the circle arc** as-is. It's good feedback.
- **Also draw `marker.png`** as an edge arrow:
  - Positioned on the screen edge closest to the ball (clamped to `(0..SCREEN_WIDTH, 0..SCREEN_HEIGHT)` with a `MARKER_DISTANCE_TO_SCREEN_BORDER` offset — v1 already computes this position for the arc).
  - Rotated so the arrow points toward the ball's real (off-screen) position. Rotation angle = `atan2(ball.y - edge.y, ball.x - edge.x)`.
  - The sprite is authored as pointing right (positive X). If it isn't, we apply a constant rotation offset determined by inspection when wiring it up.
  - Drawn with `ctx.save(); ctx.translate(edge.x, edge.y); ctx.rotate(angle); ctx.drawImage(marker, -w/2, -h/2); ctx.restore();` (centered).
- **Distance-based fade** (optional nicety, cheap): the arc alpha can scale with the ball's speed (faster ball = more opaque arc). Not required for v2 but trivial if we want it.
- **No change** to the offscreen detection predicate.

### 7.3 Result

On-screen at a glance the player sees:
- A sharp arrow at the edge pointing toward the ball (direction).
- A sweeping green arc fragment on the same edge (distance + velocity).
- Both disappear the moment the ball re-enters the viewport.

`marker.png` finally earns its keep.

---

## 8. Heads-up display (HUD)

### 8.1 Elements

Three pieces of text, monospace, drawn on top of the game canvas (after the render-common layer, before overlays like aim line/preview):

- **LIVES** — top-left. Rendered as `♥ ♥ ♥` (or fallback `* * *`) with lost lives dimmed. Alternative: plain text `Lives: 3`.
- **STREAK** — top-center. `STREAK 7` means the player has won 7 consecutive levels in the current run.
- **BEST** — top-right. `BEST 12` is the all-time best streak for this browser (persisted — see §10.3).

### 8.2 Visual design

- White text with a thin black drop-shadow (offset `(1, 1)`) to stay legible against both the stellar background and the light planet sprites.
- Font: system monospace (`ui-monospace, Menlo, Consolas, monospace`), 18-20 px design pixels.
- Padding: 12 design pixels from the canvas edge.
- Rendered via `ctx.fillText` and `ctx.strokeText`. No HTML overlays.
- Drawn by a new `renderHud(ctx, state)` function called from `MainGameState.render` after the common layer and before any sub-state overlays.

### 8.3 Visibility

- HUD shown only in `MainGameState`, never on intro/victory/defeat/menu screens.
- HUD updates live as lives/streak change; no animation required (but a brief flash on life loss would be nice — optional polish).

---

## 9. Main menu, retry flow, navigation

### 9.1 Flow overview

```
                   ┌────────────┐
  first load ───▶  │ MAIN MENU  │
                   └─────┬──────┘
                         │ PLAY tapped
                         ▼
                   ┌────────────┐
                   │  INTRO 1   │ (skippable)
                   └─────┬──────┘
                         ▼
                   ┌────────────┐
                   │  INTRO 2   │ (skippable)
                   └─────┬──────┘
                         ▼
                   ┌────────────┐
           ┌──────▶│ MAIN GAME  │◀──────┐
           │       └─────┬──────┘       │
      next │             │              │
     level │         win │              │ player retries
           │             ▼              │ or Esc to menu
           │       ┌────────────┐       │
           │       │ VICTORIOUS │       │
           │       └─────┬──────┘       │
           └─────────────┘              │
                                        │
                         ┌──────────────┘
                         │
                     lose│
                         ▼
                   ┌────────────┐
                   │  DEFEATED  │
                   └─────┬──────┘
                         │
                         ▼
                   ┌────────────┐
                   │ MAIN MENU  │ (BEST updated)
                   └────────────┘
```

### 9.2 Main menu

- New `MainMenuState` (subclass of `GameState`).
- Renders the `intro1.png` background or a dedicated title image if we author one (for v2 scope: reuse `intro1.png` + overlay text — no new assets).
- Overlays three centered, stacked buttons drawn on the canvas:
  - `PLAY` (large)
  - `HOW TO PLAY` (medium)
  - `ABOUT` (medium)
- Shows `BEST STREAK: N` below the buttons if N > 0.
- Button hit-testing: each button has a bounding rect; on `pointerup`, if `pressed && pointer inside rect && button.active`, trigger the button.
- Hover highlight (mouse only): if `hovering && pointer inside rect`, draw button in a brighter color.
- Tapping `PLAY` → change state to `intro-screen` (if intro hasn't been seen this session) or `main-game` (subsequent plays during the same session).
- Tapping `HOW TO PLAY` → change state to a new `HowToPlayState`, a static screen with instructions (text only, drawn on canvas); tap/space returns to menu.
- Tapping `ABOUT` → change state to `AboutState`: credits (from `CREDITS.TXT`), link to the original project, link to `design.md`/`design-v2.md`; tap/space returns to menu.

### 9.3 First-run vs repeat flow

- On first load in a session, `MAIN MENU → PLAY → INTRO1 → INTRO2 → MAIN GAME`.
- After returning to the menu later in the same session, `PLAY` skips directly to `MAIN GAME` (no intros) because the player has already seen them. Implemented as a `seenIntro` boolean on a session-wide state object, or checked via the intro screens' own session flag.
- Tapping the browser reload button resets the session flag (not persisted to localStorage).

### 9.4 Retry / game-over flow

- **Defeat path**: `MAIN GAME (lives = 0)` → `DEFEATED` (2-second base + 0.25 s fade each side, skippable after 0.3 s) → `MAIN MENU`. Streak resets to 0. Best streak updated in localStorage if the just-ended streak beat it.
- **Victory path**: `MAIN GAME (hole hit)` → `VICTORIOUS` (fade-in + hold; no auto-advance) with an explicit **NEXT** button overlaid on the picture. Tapping NEXT / Space / Enter triggers the fade-out, advances streak + 1, bumps difficulty per §11, and re-enters `MAIN GAME`. Lives reset to 3 between levels (three lives per level, not three per run).
- **Esc from main game**: pops a lightweight `ConfirmExitState` ("Return to menu? YES / NO"). YES → `MAIN MENU`, streak counts as 0 (player bailed). NO → resume main game exactly where it was. The underlying main-game scene is frozen while the confirm overlay is up (physics not ticked, previous render snapshot shown dimmed).

---

## 10. Score, streak, persistence

### 10.1 Definition

- **Streak** — consecutive wins in the current run. Resets on defeat or menu exit.
- **Best streak** — all-time best streak on this browser. Persisted.
- **No per-level score.** Levels are pass/fail; how you got there doesn't matter. (Shot counts, time, fewest collisions — interesting extensions but deferred.)

### 10.2 Why streak, not score?

- Needs no tuning (pass/fail is already defined).
- Simple mental model.
- Interacts cleanly with the difficulty ramp (§11): streak is also the difficulty level.
- Persists meaningfully even across sessions as a single number.

### 10.3 Persistence

- `localStorage` under a namespaced key, e.g. `cloze-call:v2:best-streak`.
- Read on main-menu state init.
- Written whenever a defeat finalizes a streak that beat the previous best.
- Errors from `localStorage` (Safari private mode, etc.) are swallowed — best streak simply doesn't persist. Game still works.

### 10.4 Shareable levels

See §14 for the seed-sharing URL scheme, which ties into "my current level was cool, share this exact layout."

---

## 11. Level progression and difficulty ramp

### 11.1 Rationale

V1 regenerates a brand-new random level every win and every loss with identical parameters. For v2 we want the game to feel like it's going somewhere.

### 11.2 Design

**Per-level parameters derived from `streak`** (0 = first level of a run, grows with each win):

```
level_index       = streak                                  // 0-based
base_planet_count = 3 + floor(level_index / 3)              // +1 every 3 levels
extra_planet      = random(0..1)                            // 0 or 1 extra (same as v1)
planet_count_max  = 6                                       // hard cap to keep grid usable
planet_count      = min(base_planet_count + extra_planet, planet_count_max)

base_planet_mass  = 500 + 50 * floor(level_index / 2)       // +50 every 2 levels
mass_jitter_max   = 500                                     // unchanged
planet_mass       = base_planet_mass + random(0..mass_jitter_max)

mass_ceiling      = 1500                                    // hard cap
planet_mass       = min(planet_mass, mass_ceiling)
```

**What the player experiences**:
- Level 1 (streak 0): identical to v1.
- Level 3-4 (streak 2-3): an extra planet starts appearing.
- Level 6 (streak 5): 4-5 planets, masses 700-1200.
- Level 10 (streak 9): 6 planets, masses near 1000-1500.
- Level 13+ (streak 12+): 6 planets saturated, masses at the ceiling.

**What does NOT change across levels**:
- The 11-cell grid. Planets never overlap; the grid starts to feel crowded around 6 planets + hole = 7 occupied cells (fine).
- The ball starting position `(50, 50)`.
- Small-vs-large planet coin flip (each planet still randomly small or large).
- Jitter magnitude.

### 11.3 Tunables

All thresholds (`/3`, `/2`, `50`, `6`, `1500`) live in `js/config.js` under a `DIFFICULTY` config block, ready for play-testing.

### 11.4 Interaction with seed URLs

A seed completely determines the random stream. If a seed-URL is provided, the level generation still respects the streak-derived parameters — i.e. a seed determines *which random numbers come out*, but the difficulty parameters are fixed by the current streak. Sharing a seed means "here is the layout I saw at this difficulty," which is meaningful only when combined with the streak it was generated at. We include both in the share URL (see §14).

---

## 12. Screen transitions: fades and skipping

### 12.1 Fade-ins / fade-outs

- Each `ScreenGameState` (intro1, intro2, victorious, defeated) gains an explicit **three-phase timeline**:
  1. `fade-in` (0.25 s) — opaque black overlay alpha lerping from 1.0 → 0.0.
  2. `hold` (screen's configured visible time, default 2.0 s) — picture shown normally.
  3. `fade-out` (0.25 s) — alpha lerping 0.0 → 1.0.
- Total screen lifetime = `0.25 + hold + 0.25` = 2.5 s default.
- After fade-out completes, the state transitions to `next-state`.
- Overlay is drawn on top of the picture, in the same render pass. Pure canvas; no DOM changes.

### 12.2 Skippable screens

- During `hold` or `fade-in`, any of the following inputs advances to the `fade-out` phase:
  - Space
  - Enter
  - Click (mouse `pointerup`)
  - Tap (touch `pointerup`)
- **Minimum display time**: 0.3 s from state entry. Inputs received before this are ignored, so a rapid tap-through doesn't get the player into the main game before they've seen the screen change.
- Skipping fast-forwards through `hold` by jumping directly to the fade-out phase. It does *not* skip the fade-out itself — this keeps the visual rhythm consistent and avoids hard cuts.
- Main menu does not have a hold timer (menus persist until a button is pressed), but its entry animation is the same 0.25 s fade-in.

### 12.3 Implementation sketch

```js
class ScreenGameState extends GameState {
  initializeState() {
    this.phase = 'fade-in';
    this.phaseT = 0;
  }
  updateLogic(gsm, dt) {
    this.phaseT += dt;
    if (this.phase === 'fade-in' && this.phaseT >= FADE_IN_DURATION) {
      this.phase = 'hold'; this.phaseT = 0;
    } else if (this.phase === 'hold' && this.phaseT >= this.holdDuration) {
      this.phase = 'fade-out'; this.phaseT = 0;
    } else if (this.phase === 'fade-out' && this.phaseT >= FADE_OUT_DURATION) {
      gsm.changeState(this.nextState);
    }
  }
  onSkip() {
    if (this.phase !== 'fade-out' && this.totalTime >= 0.3) {
      this.phase = 'fade-out'; this.phaseT = 0;
    }
  }
  render(ctx) {
    clear();
    drawImage(this.picture);
    const alpha = this.phase === 'fade-in'  ? 1 - this.phaseT / FADE_IN_DURATION
                 : this.phase === 'fade-out' ?     this.phaseT / FADE_OUT_DURATION
                 : 0;
    if (alpha > 0) { ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.fillRect(0, 0, W, H); }
  }
}
```

---

## 13. Audio via Web Audio API

### 13.1 Why synthesize?

- The original shipped an empty `data/sfx/` directory. There are no canonical sounds to port.
- Bundling free CC0 sound effects would add assets to license-check.
- Synthesizing keeps the port asset-footprint-identical to v1 and dependency-free.
- Web Audio API is available in every target browser.

### 13.2 Sounds to implement

| Event                  | Trigger                             | Description                                        |
|------------------------|-------------------------------------|----------------------------------------------------|
| Launch                 | `aiming → simulation` transition    | ~80 ms filtered white-noise burst (a "whoosh")    |
| Planet collision       | ball hits a planet                  | ~150 ms low sine ~80 Hz with exponential decay     |
| Hole collision         | ball enters hole                    | ~400 ms rising sine arpeggio (C5-E5-G5, 100 ms each) |
| Victory screen enter   | `victorious` state init             | Same arpeggio + octave up, slightly longer         |
| Defeat screen enter    | `defeated` state init               | Descending minor thirds (A4, F4, D4) over 800 ms   |
| Menu button hover      | pointer enters button rect (mouse)  | Short 20 ms sine blip ~800 Hz                      |
| Menu button click      | button activated                    | Short 30 ms sine at 1200 Hz                        |

### 13.3 Architecture

- New module `js/audio.js`.
- Single `AudioContext` instantiated lazily on first user gesture (required by autoplay policies — wait for the first `pointerdown` to construct the context).
- Small helper `playBeep({ freq, duration, type, gain })` that builds an oscillator + gain envelope + destination chain.
- `playNoise({ duration, filterFreq, gain })` for noise-based effects (a buffer-source with pink/white noise into a biquad filter).
- Each named sound is a function wrapping the above: `audio.launch()`, `audio.collide()`, `audio.win()`, `audio.lose()`, `audio.menuClick()`.
- **Master mute**: a simple `muted` boolean in `audio.js` plus a mute toggle on the HUD, rendered **next to `BEST`** in the top-right corner (speaker / speaker-muted glyph drawn on the canvas; click hit-testing done in `hud.js`). Muted state persists in `localStorage`.
- **Safari / iOS**: the first `AudioContext.resume()` must happen inside a user gesture. The lazy-init pattern covers this — context is created during the first `pointerdown` handler.

### 13.4 Volume

- Master gain ~0.3 (leave headroom).
- Per-sound gains tuned by ear during implementation; not exposed to the player beyond the mute toggle for v2.

---

## 14. Level seeding and shareable URLs

### 14.1 PRNG

- Replace all `Math.random()` calls with a seedable generator. Use **Mulberry32** — tiny (~8 lines), deterministic, good enough for game RNG.
- A single module-level generator instance lives in `js/rng.js` and exposes:
  - `seed(n: number)` — reset state.
  - `random(): number` — uniform `[0, 1)`.
  - `randomInt(maxExclusive)`, `randomRange(a, b)`, `randomPick(arr)` — convenience.
- All game code calls `rng.random()` (not `Math.random()`).

### 14.2 URL hash format

- On page load, parse `location.hash` for:
  - `#seed=XYZ` — initial seed (number or short string hashed to number).
  - `#seed=XYZ&streak=N` — start directly at streak N with seed XYZ; useful for sharing an exact level configuration.
- If no hash: seed with `Date.now() ^ Math.floor(Math.random() * 2^32)` so default runs are non-deterministic.
- Changing the URL hash after boot does not re-seed (avoid surprise resets).

### 14.3 Sharing flow

- On the victorious screen, a small "Share this level" button (or keypress `S`) copies the current level's URL to the clipboard:
  - The URL encodes `seed` (the PRNG state used at the start of this level) + `streak` (the difficulty level the friend should play at).
  - Clipboard API is available in all target browsers over a secure origin (GitHub Pages is `https`).
- The shared URL opens the game, seeds the PRNG, and drops the player directly into that specific level configuration (skipping the intros).
- Out of scope for v2: daily challenges, leaderboards, QR codes.

### 14.4 Determinism boundary

- The PRNG is used for: level generation (planet count, sizes, positions, masses, hole position, ball start offset even though it's unused).
- The PRNG is **not** used for: physics (entirely deterministic already), rendering jitter, audio envelopes.
- Because the physics is fully deterministic and the PRNG controls the level, two players with the same seed+streak see identical levels and, given identical inputs, identical outcomes. (Identical input matching is hard for humans; that's fine — we're not building a replay system.)

---

## 15. Files touched or added

**Parallel tree**, not in-place edits. V1 at `index.html` / `css/style.css` / `js/*.js` is frozen. V2 lives under `index-ng.html` / `css/ng/` / `js/ng/` and references the shared `data/gfx/` folder.

### 15.1 New files (copied from v1 and then modified as noted)

- `index-ng.html` — V2 entry point. Minimal HTML with a responsive wrapper, canvas, mute button, and `<script type="module" src="js/ng/cloze-call.js">`.
- `css/ng/style.css` — responsive canvas (`min(100vw, calc(100vh*4/3))`), `touch-action: none`, mute button styling.
- `js/ng/config.js` — updated constants. `FIXED_DT_MS = 1000/60`, `LAUNCH_SPEED_CAP = 400`, new `PREVIEW_MAX_ARC_LENGTH`, `PREVIEW_MAX_STEPS`, `FADE_IN_DURATION`, `FADE_OUT_DURATION`, `SCREEN_MIN_DISPLAY_TIME`, `DIFFICULTY` block. `LAUNCH_SPEED_CAP_AT_INDICATOR_MAX` flag is gone (answered: drop).
- `js/ng/math.js` — unchanged from v1.
- `js/ng/gsm.js` — unchanged from v1.
- `js/ng/pictures.js` — unchanged from v1.
- `js/ng/assets.js` — same as v1 (color-key stays); `lisp.png` is *not* in the asset list (answered: strip).
- `js/ng/input.js` — rewritten around Pointer Events. Exposes `pointerPosition()`, `pointerPressed()`, `pointerHovering()`, plus a falling-edge query for launch detection.
- `js/ng/keyboard.js` — new. Keydown listener + key-to-action mapping for Space/Enter/Esc.
- `js/ng/audio.js` — new. Lazy `AudioContext`, synthesized sfx, persisted mute state.
- `js/ng/rng.js` — new. Mulberry32 PRNG + convenience helpers. All game code calls this instead of `Math.random()`.
- `js/ng/screen-state.js` — three-phase timeline (`fade-in` / `hold` / `fade-out`), skip handler, min-display-time guard.
- `js/ng/game-objects.js` — uses `rng` for `randomPlanetImage`.
- `js/ng/levels.js` — parameterized by streak (§11), uses `rng`.
- `js/ng/aim-preview.js` — new. Forward-integration helper used by `main-game.js`.
- `js/ng/hud.js` — new. HUD rendering (lives / streak / best + mute icon click-target).
- `js/ng/main-menu-state.js` — new. `MainMenuState`, `HowToPlayState`, `AboutState`, `ConfirmExitState` co-located.
- `js/ng/main-game.js` — 60 Hz tuned, mass-weighted centroid fix, aim-preview, edge-arrow + arc, HUD integration, audio hooks, ESC → confirm dialog, victory → explicit NEXT button, no `LAUNCH_SPEED_CAP_AT_INDICATOR_MAX` flag (always capped).
- `js/ng/cloze-call.js` — main loop = `requestAnimationFrame` + accumulator (60 Hz physics). Registers `main-menu` as the initial state. Parses `#seed=...&streak=...` on boot. Wires `AudioContext` to the first `pointerdown`. `test-state` is *not* registered (answered: strip).

### 15.2 Shared / unchanged

- `data/gfx/*` — shared with v1. `marker.png` finally gets drawn (§7). `lisp.png` is not referenced by the v2 port at all.
- All of `index.html`, `css/style.css`, `js/*.js` — the v1 port remains untouched and playable.
- `design.md` — v1 design doc stays as a frozen reference.
- `design-v2.md` — this document.

---

## 16. Port decisions (V2)

This table summarizes all v2 decisions, mirroring the one in v1 `design.md §4`.

| Area                    | V2 decision                                                                                          | Reference |
|-------------------------|------------------------------------------------------------------------------------------------------|-----------|
| Physics timestep        | Fixed 60 Hz (was 30 Hz in v1)                                                                         | §2        |
| Render loop             | `requestAnimationFrame` with accumulator; pauses with tab                                             | §2        |
| Viewport                | CSS-scaled canvas, 4:3 letterboxed, `touch-action: none`                                              | §3        |
| Input                   | Pointer Events (mouse + touch + pen), keyboard for screen-skip and ESC                                 | §4        |
| Aim line                | Straight ball→cursor, green→red lerp saturating at 400 px                                             | §5.3      |
| Aim preview             | Forward-integrated dashed polyline, 300 px arc length cap, stops on planet collision                 | §5        |
| Launch cap              | Hard 400 px cap; indicator saturation matches it                                                      | §5.3      |
| Escape velocity         | **Mass-weighted** centroid; formula otherwise unchanged                                               | §6        |
| Off-screen marker       | Circle arc (kept) + `marker.png` edge arrow rotated toward ball                                       | §7        |
| HUD                     | Lives / Streak / Best, monospace, canvas-drawn                                                        | §8        |
| Main menu               | New state: PLAY / HOW TO PLAY / ABOUT; shows BEST STREAK                                              | §9        |
| Retry flow              | Defeat → menu (streak resets). Victory → auto-advance (streak++).                                     | §9.4      |
| Level progression       | Streak-driven difficulty: +1 planet every 3 levels (cap 6), +50 base mass every 2 levels (cap 1500) | §11       |
| Persistence             | `localStorage` for best streak and mute state                                                         | §10.3, §13.3 |
| Screen fades            | 0.25 s fade in / hold / 0.25 s fade out                                                               | §12.1     |
| Screen skipping         | Space / Enter / click / tap after 0.3 s minimum                                                       | §12.2     |
| Audio                   | Web Audio synthesized sfx; mute toggle; lazy init on first gesture                                    | §13       |
| PRNG                    | Mulberry32, seedable from URL hash                                                                    | §14.1     |
| Sharing                 | Victory-screen "share URL" with seed + streak                                                         | §14.3     |
| Out of scope for v2     | Leaderboards, daily challenges, shot/time per-level scoring, HiDPI canvas scaling, achievements       | §17       |

---

## 17. Non-goals / deferred to V3

Things deliberately NOT in v2, to keep scope bounded:

- **HiDPI rendering** — the canvas's internal resolution stays at 800×600 design pixels even on retina screens. Sprites use `image-rendering: auto` (browser-default bilinear). If artifacts become noticeable, address in v3.
- **Per-level scoring** (shots taken, time-to-complete). Streak is the only metric.
- **Leaderboards / daily challenges / cloud sync.** All state is local.
- **Asset-based sfx / music.** Everything is synthesized.
- **Level editor.** Deterministic seeds are as close as v2 gets.
- **Portrait-optimized UI.** Scaling via letterbox is enough; portrait just shows a smaller game.
- **Achievements.**
- **Accessibility features** (high-contrast mode, reduced-motion respect, ARIA labels on menu buttons) — should be v3. Worth flagging: the fade-in/out and audio choices would benefit from respecting `prefers-reduced-motion` and adding a volume slider.
- **Replays / shareable runs.** Seed + streak share one level, not a whole playthrough.
- **Custom key bindings.**

---

## 18. Implementation order (suggested)

A build order that keeps the game playable after each step, so we can stop at any point with a working build:

1. **Main loop swap** (30 Hz setInterval → 60 Hz RAF accumulator). Pure mechanical, no visual change.
2. **Viewport scaling CSS** + pointer-events input module. Game works on phones from this point on.
3. **Mass-weighted centroid fix** — tiny; just drop it in.
4. **Launch cap retune** to 400 px with unified constant.
5. **Aim preview line** — the most interesting single feature; most satisfying to land early.
6. **Off-screen arrow + arc** (quick).
7. **HUD** (lives / streak placeholder / best placeholder).
8. **Fade-ins/outs + skippable screens** — screens are independent; doesn't break main game.
9. **Main menu + retry flow + streak logic + localStorage**.
10. **Level progression / difficulty ramp** — wires into streak from step 9.
11. **PRNG + seed URLs + share button**.
12. **Audio module + sfx + mute toggle**.
13. **Polish pass**: play 10 runs, tune `DIFFICULTY` constants, verify mobile feel, adjust fades if too slow, etc.

Each step is independently shippable. The user can decide to stop after any of them and we'll have a strictly-better build than v1.

---

## 19. Resolved answers (pre-implementation)

All ten open questions have been answered. Captured here for traceability; wherever a decision changes earlier sections of this document, the relevant section has been updated in place as well.

| # | Question                                                            | Decision                                                        |
|---|---------------------------------------------------------------------|-----------------------------------------------------------------|
| 1 | Main menu visual                                                    | **Reuse** `intro1.png` with overlay text/buttons                |
| 2 | HOW TO PLAY tone                                                    | **Terse** — one short paragraph, no hand-holding                |
| 3 | Victory → next level flow                                           | **Explicit NEXT button** (no auto-advance)                      |
| 4 | ESC during main game                                                | **Confirmation dialog** (Yes/No) before bailing                 |
| 5 | Mute toggle placement                                               | **Next to BEST** in the top-right HUD                           |
| 6 | Aim preview style                                                   | **Dashed, uniform alpha** (no along-length fade)                |
| 7 | Difficulty ceiling (6 planets / 1500 mass)                          | **Fine for now**, will tweak after playtesting                  |
| 8 | PRNG seed encoding in URL                                           | **Decimal**                                                     |
| 9 | `lisp.png` + empty `test-state`                                     | **Strip** both from v2                                          |
| 10| Keep `LAUNCH_SPEED_CAP_AT_INDICATOR_MAX` flag                       | **Drop** — v2 cap is unconditional                              |

Implementation can proceed per §18.

Answer these and I'll start on step 1 from §18.
