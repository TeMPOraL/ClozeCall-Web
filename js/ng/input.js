// Cloze Call V2 — pointer input.
// design-v2.md §4. Replaces v1's mouse-only listener with Pointer Events so
// the same code path handles mouse, touch, and stylus. Game code queries the
// module via the polled-snapshot API (`pointerPosition()`, `pointerPressed()`,
// `pointerHovering()`, `consumePointerReleased()`) just like v1 polled SDL.

// Optional coordinate transform: canvas-pixel coords → logical coords.
// Set by game states that need a custom mapping (e.g. camera inverse, menu scaling).
let coordinateTransform = null;

const state = {
  // Transformed (logical) coordinates — world-space during gameplay,
  // design-space during menus, canvas-pixel when no transform is set.
  x: 0,
  y: 0,
  // Raw canvas-pixel coordinates — always available, used for screen-space
  // hit-tests (HUD mute button, confirm dialog, etc.).
  rawX: 0,
  rawY: 0,
  pressed: false,      // a pointer is currently down on the canvas
  hovering: false,     // a mouse pointer is currently hovering the canvas
  activePointerId: null, // first pointer to go down; others are ignored
  pointerType: null,   // 'mouse' | 'touch' | 'pen'
  // A one-shot "was released this frame" flag that main-game.js can consume
  // for its launch detection, no matter how long ago the release happened
  // relative to the fixed-step tick. Set by pointerup, cleared by the consumer.
  releasedFlag: false,
  // Tracks most recent release position for launch velocity computation in
  // case the game reads position a tick after the pointerup.
  releaseX: 0,
  releaseY: 0,
  rawReleaseX: 0,
  rawReleaseY: 0,
};

// ---- Public query API -------------------------------------------------------

export const pointerPosition     = () => [state.x, state.y];
export const pointerPositionRaw  = () => [state.rawX, state.rawY];
export const pointerPressed      = () => state.pressed;
// Only mouse-type pointers ever set `hovering`. Touch pointers leave it false.
export const pointerHovering     = () => state.hovering;
export const pointerType         = () => state.pointerType;

// True for exactly one read after a pointerup. Returns { pos, raw } or null.
// `pos` is in logical coords (world/design), `raw` is in canvas pixels.
export const consumePointerReleased = () => {
  if (!state.releasedFlag) return null;
  state.releasedFlag = false;
  return {
    pos: [state.releaseX, state.releaseY],
    raw: [state.rawReleaseX, state.rawReleaseY],
  };
};

// Set or clear the coordinate transform. States call this in initializeState
// with a function (canvasX, canvasY) → [logicalX, logicalY], and the GSM
// clears it between state transitions.
export const setCoordinateTransform = (fn) => { coordinateTransform = fn; };

// Used by main-menu-state / confirmation dialogs to click buttons. Queried
// via a rising edge rather than the one-shot release flag: menus want "mouse
// is down over this button" hover feedback, and fire on pointerup.
// Subsequent "pressed" reads during the same press return true repeatedly.

// Reset internal state. Useful when transitioning between states that don't
// care about a carried-over press (e.g. skipping an intro screen shouldn't
// leave `pressed = true` bleeding into the main game's first tick).
export const resetPointerState = () => {
  state.pressed = false;
  state.releasedFlag = false;
  state.activePointerId = null;
};

// ---- Attach listeners -------------------------------------------------------

// Attach pointer listeners to the canvas. States poll the module-level
// snapshot (pointerPosition / pointerPressed / pointerHovering /
// consumePointerReleased) rather than subscribing to events. This matches
// v1's SDL-polling mental model and sidesteps ordering issues with the
// fixed-step loop.
export const attachInput = (canvas) => {
  const updatePosFromEvent = e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    state.rawX = canvasX;
    state.rawY = canvasY;
    if (coordinateTransform) {
      const [lx, ly] = coordinateTransform(canvasX, canvasY);
      state.x = lx;
      state.y = ly;
    } else {
      state.x = canvasX;
      state.y = canvasY;
    }
  };

  canvas.addEventListener('pointerdown', e => {
    // Ignore secondary pointers; game is explicitly single-pointer.
    if (state.activePointerId !== null) return;
    // Only primary button for mouse. Touch always counts.
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    state.activePointerId = e.pointerId;
    state.pointerType = e.pointerType;
    state.pressed = true;
    updatePosFromEvent(e);

    // Kill text-selection, iOS long-press-magnifier, and native double-tap
    // zoom. touch-action:none in CSS does most of this already but keeping
    // preventDefault is belt-and-suspenders.
    e.preventDefault();

    // Capture so moves/ups outside the canvas still fire here.
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') state.hovering = true;
    // Always track position of the active pointer. For hovering mice with
    // no active pointer, still update x/y so the aim line follows the cursor.
    if (state.activePointerId === null || e.pointerId === state.activePointerId) {
      updatePosFromEvent(e);
    }
  });

  const finish = (e, kind) => {
    if (state.activePointerId !== null && e.pointerId !== state.activePointerId) return;
    updatePosFromEvent(e);
    const wasPressed = state.pressed;
    state.pressed = false;
    state.activePointerId = null;
    if (kind === 'up' && wasPressed) {
      state.releasedFlag = true;
      state.releaseX = state.x;
      state.releaseY = state.y;
      state.rawReleaseX = state.rawX;
      state.rawReleaseY = state.rawY;
    }
    // Touch pointers never hover. A mouse pointer leaving stays hovering
    // until pointerleave; don't clear `hovering` here.
  };
  canvas.addEventListener('pointerup',     e => finish(e, 'up'));
  canvas.addEventListener('pointercancel', e => finish(e, 'cancel'));

  // Hover state lifecycle — mouse only. Touch leaves don't fire these, so
  // hovering stays false for touch throughout.
  canvas.addEventListener('pointerenter', e => {
    if (e.pointerType === 'mouse') state.hovering = true;
  });
  canvas.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') state.hovering = false;
  });

  // Suppress the context menu on right-click (matches v1). Also suppress it
  // on long-press touch just in case touch-action:none doesn't cover it.
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Kill page-level two-finger pan / pinch that might escape the canvas.
  document.addEventListener('gesturestart', e => e.preventDefault());
};
