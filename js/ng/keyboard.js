// Cloze Call V2 — keyboard dispatch.
// design-v2.md §4.2 (keyboard): Space/Enter = skip/advance, Esc = ESC.
// All key events route through the GSM via gsm.onSkip() / gsm.onKey(key).

const SKIP_KEYS = new Set(['Space', 'Enter', 'NumpadEnter']);
const TRACKED_KEYS = new Set([
  'Space', 'Enter', 'NumpadEnter', 'Escape',
  'KeyY', 'KeyN',          // confirm dialog
  'KeyS',                  // share (future)
  'KeyM',                  // mute toggle
  'ArrowUp', 'ArrowDown',  // menu nav (optional)
]);

export const attachKeyboard = (gsm) => {
  window.addEventListener('keydown', e => {
    if (!TRACKED_KEYS.has(e.code)) return;

    // Stop Space from scrolling the page; Enter / arrows have no side effects
    // we care about, but preventDefault doesn't hurt.
    e.preventDefault();

    if (SKIP_KEYS.has(e.code)) {
      gsm.onSkip();
    }
    gsm.onKey(e.code);
  }, { passive: false });
};
