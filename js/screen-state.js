// Full-screen image state. Mirrors game-screen-state.lisp.
// Used for intro1, intro2, victorious and defeated screens.

import { GameState } from './gsm.js';
import { loadImage, drawImage } from './pictures.js';
import { DEFAULT_GAME_SCREEN_TIME, SCREEN_WIDTH, SCREEN_HEIGHT } from './config.js';

export class ScreenGameState extends GameState {
  constructor({ pictureName, nextState, screenTime = DEFAULT_GAME_SCREEN_TIME }) {
    super();
    if (!pictureName) throw new Error('Game screen needs to have a picture specified.');
    this.pictureName = pictureName;
    this.nextState = nextState;
    this.time = screenTime;
    this.accumulator = 0;
    this.bigPicture = null;
  }

  initializeState(gsm) {
    this.accumulator = 0;
    this.bigPicture = loadImage(this.pictureName);
  }

  updateLogic(gsm, dt) {
    this.accumulator += dt;
    if (this.accumulator > this.time) gsm.changeState(this.nextState);
  }

  render(ctx, gsm) {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    drawImage(ctx, this.bigPicture);
  }
}
