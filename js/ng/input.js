// Cloze Call V2 — pointer input.
// design-v2.md §4. Replaces v1's mouse-only listener with Pointer Events so
// the same code path handles mouse, touch, and stylus. Game code queries the
// module via the polled-snapshot API (`pointerPosition()`, `pointerPressed()`,
// `pointerHovering()`, `consumePointerReleased()`) just like v1 polled SDL.

const state = {
  x: 0,
  y: 0,
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
};

// ---- Public query API -------------------------------------------------------

export const pointerPosition   = () => [state.x, state.y];
export const pointerPressed    = () => state.pressed;
// Only mouse-type pointers ever set `hovering`. Touch pointers leave it false.
export const pointerHovering   = () => state.hovering;
export const pointerType       = () => state.pointerType;

// True for exactly one read after a pointerup. main-game.js calls this in
// updateAiming(); after consumption the flag clears so it won't fire twice.
export const consumePointerReleased = () => {
  if (!state.releasedFlag) return null;
  state.releasedFlag = false;
  return [state.releaseX, state.releaseY];
};

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
    state.x = (e.clientX - rect.left) * scaleX;
    state.y = (e.clientY - rect.top) * scaleY;
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
