// Entry point. Mirrors cloze-call.lisp's `run-game`.
//
// 1. Preload all assets.
// 2. Wire up the Game State Manager with the same set of states the original
//    registered (intro1 -> intro2 -> main-game, with defeated / victorious
//    looping back into main-game).
// 3. Kick off a fixed-timestep main loop driven by requestAnimationFrame.

import {
  SCREEN_WIDTH, SCREEN_HEIGHT,
  FIXED_DT_MS, FIXED_DT_SECONDS, MAX_DT_MS,
} from './config.js';
import { preloadAssets } from './assets.js';
import { attachInput } from './input.js';
import { GameStateManager, GameState } from './gsm.js';
import { ScreenGameState } from './screen-state.js';
import { MainGameState } from './main-game.js';

console.log('Hello from Cloze-Call');

const boot = async () => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('status');

  await preloadAssets();
  if (status) status.remove();

  attachInput(canvas);

  const gsm = new GameStateManager();
  gsm.init();

  // Registered for parity with the original; never entered, so no init runs.
  gsm.registerState('test-state', new GameState());

  gsm.registerState('intro-screen', new ScreenGameState({
    pictureName: 'intro1.png',
    nextState: 'intro-screen-2',
  }));
  gsm.registerState('intro-screen-2', new ScreenGameState({
    pictureName: 'intro2.png',
    nextState: 'main-game',
  }));
  gsm.registerState('main-game', new MainGameState({ runLevel: 'ojej' }));
  gsm.registerState('defeated', new ScreenGameState({
    pictureName: 'defeated.png',
    nextState: 'main-game',
  }));
  gsm.registerState('victorious', new ScreenGameState({
    pictureName: 'victorious.png',
    nextState: 'main-game',
  }));

  gsm.changeState('intro-screen');
  gsm.enforceProperState();

  // Fixed-timestep main loop with accumulator. Mirrors sdl:with-timestep.
  // setInterval (rather than requestAnimationFrame) keeps the game running
  // when the tab is in the background and avoids RAF throttling under iframe
  // preview environments. The game is 30 Hz fixed-step, so RAF's vsync would
  // gain nothing.
  let lastTime = performance.now();
  let accumulator = 0;

  const tick = () => {
    const now = performance.now();
    let frameDt = now - lastTime;
    lastTime = now;
    if (frameDt > MAX_DT_MS) frameDt = MAX_DT_MS;
    accumulator += frameDt;
    while (accumulator >= FIXED_DT_MS) {
      gsm.update(FIXED_DT_SECONDS);
      accumulator -= FIXED_DT_MS;
    }
    gsm.render(ctx);
  };
  setInterval(tick, FIXED_DT_MS);
  tick();

  // Web equivalent of the original's `:quit-event` log.
  window.addEventListener('beforeunload', () => {
    console.log('quit event received');
  });
};

boot().catch(err => {
  console.error('Boot failed:', err);
  const status = document.getElementById('status');
  if (status) status.textContent = 'Failed to load. Check console.';
});
