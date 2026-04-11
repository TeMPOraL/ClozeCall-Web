// Mouse input tracking. The original polled `sdl:mouse-position` and
// `sdl:mouse-left-p` every frame; the web equivalent is event-driven, but we
// maintain the same "what is the current position / is LMB pressed" snapshot
// so the rest of the game can query it the same way.

const state = {
  mouseX: 0,
  mouseY: 0,
  lmb: false,
};

export const mousePosition = () => [state.mouseX, state.mouseY];
export const mouseLeftPressed = () => state.lmb;

export const attachInput = canvas => {
  const updatePos = e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    state.mouseX = (e.clientX - rect.left) * scaleX;
    state.mouseY = (e.clientY - rect.top) * scaleY;
  };

  // Mousemove on window so aim tracking continues while the cursor is outside
  // the canvas (matches SDL's unclamped window-relative mouse position).
  window.addEventListener('mousemove', updatePos);

  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) {
      updatePos(e);
      state.lmb = true;
    }
  });

  // Mouseup on window so releasing outside the canvas still fires the ball.
  window.addEventListener('mouseup', e => {
    if (e.button === 0) state.lmb = false;
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());
};
