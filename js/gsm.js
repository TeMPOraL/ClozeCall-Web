// Game State Manager. Mirrors game-state-manager.lisp.
//
// Holds a map of registered states keyed by string (originally keywords),
// forwards update/render to the current state, and performs queued state
// transitions at the TOP of the next update tick - matching the original's
// `enforce-proper-gsm-state` semantics.

export class GameStateManager {
  constructor() {
    this.states = new Map();
    this.currentState = null;
    this.nextStateKw = null;
  }

  init() {
    console.log('GSM init');
  }

  deinit() {
    console.log('GSM deinit');
  }

  registerState(kw, state) {
    if (this.states.has(kw)) throw new Error('Game state already registered!');
    this.states.set(kw, state);
  }

  changeState(kw) {
    this.nextStateKw = kw;
  }

  enforceProperState() {
    if (this.nextStateKw === null) return;
    const next = this.states.get(this.nextStateKw);
    if (!next) throw new Error(`Nonexisting game state selected: ${this.nextStateKw}`);
    if (this.currentState) this.currentState.deinitializeState(this);
    this.currentState = next;
    this.nextStateKw = null;
    this.currentState.initializeState(this);
  }

  update(dt) {
    this.enforceProperState();
    if (this.currentState) this.currentState.updateLogic(this, dt);
  }

  render(ctx) {
    if (this.currentState) this.currentState.render(ctx, this);
  }
}

// Base game state. Subclasses override the lifecycle methods as needed.
export class GameState {
  initializeState(gsm) {}
  deinitializeState(gsm) {}
  updateLogic(gsm, dt) {}
  render(ctx, gsm) {}
}
