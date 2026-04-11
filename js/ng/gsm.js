// Cloze Call V2 — Game State Manager. Mirrors game-state-manager.lisp.
// Unchanged from v1 except for a tiny addition: `onSkip(gsm)` dispatch helper
// used by keyboard.js and input.js to forward skip intents to the current
// state regardless of which kind of state it is.

export class GameStateManager {
  constructor() {
    this.states = new Map();
    this.currentState = null;
    this.nextStateKw = null;
  }

  init() {
    console.log('GSM init (ng)');
  }

  deinit() {
    console.log('GSM deinit (ng)');
  }

  registerState(kw, state) {
    if (this.states.has(kw)) throw new Error('Game state already registered!');
    this.states.set(kw, state);
  }

  getState(kw) {
    return this.states.get(kw);
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

  // Forward a skip intent (Space / Enter / click / tap) to the current state
  // if it supports it. Intents on states that don't override onSkip are no-ops.
  onSkip() {
    if (this.currentState && typeof this.currentState.onSkip === 'function') {
      this.currentState.onSkip(this);
    }
  }

  // Forward a keydown intent so states can implement custom handling
  // (e.g. ESC on MainGameState popping the confirmation dialog).
  onKey(key) {
    if (this.currentState && typeof this.currentState.onKey === 'function') {
      this.currentState.onKey(this, key);
    }
  }
}

// Base game state. Subclasses override the lifecycle methods as needed.
export class GameState {
  initializeState(gsm) {}
  deinitializeState(gsm) {}
  updateLogic(gsm, dt) {}
  render(ctx, gsm) {}
  // Optional hooks — implemented by states that want to react to skip / keys.
  // onSkip(gsm) {}
  // onKey(gsm, key) {}
}
