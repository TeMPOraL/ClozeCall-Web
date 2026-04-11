// Cloze Call V2 — Web Audio sfx.
// design-v2.md §13. Synthesizes all sounds on demand, no asset files.
// AudioContext is lazy-initialized on the first user gesture (required by
// autoplay policies on Safari/Chrome). Mute state persists in localStorage.

import { LS_MUTED } from './config.js';

let ctx = null;
let masterGain = null;
let muted = false;

// ---- Persistence -----------------------------------------------------------

const loadMuted = () => {
  try {
    const v = localStorage.getItem(LS_MUTED);
    if (v === '1' || v === 'true') muted = true;
  } catch { /* swallow: private mode, etc. */ }
};

const saveMuted = () => {
  try { localStorage.setItem(LS_MUTED, muted ? '1' : '0'); } catch {}
};

loadMuted();

export const isMuted = () => muted;

export const setMuted = (next) => {
  muted = !!next;
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.01);
  }
  saveMuted();
};

export const toggleMute = () => setMuted(!muted);

// ---- Lazy context init -----------------------------------------------------

// Call this from the first user-gesture handler (e.g. pointerdown listener
// in cloze-call.js). Safe to call multiple times — does nothing after the
// first successful init.
export const ensureAudio = () => {
  if (ctx) {
    // Some browsers put the context in 'suspended' state after a hidden tab;
    // resume if needed.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 0.3; // leave headroom
    masterGain.connect(ctx.destination);
  } catch (err) {
    console.warn('Audio init failed; continuing silently.', err);
    ctx = null;
  }
};

// ---- Primitive synth helpers -----------------------------------------------

const beep = ({ freq, duration, type = 'sine', gain = 1, attack = 0.005, release = 0.05 }) => {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);
  g.gain.linearRampToValueAtTime(0, now + duration - release);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(now);
  osc.stop(now + duration + 0.02);
};

const sweep = ({ fromFreq, toFreq, duration, type = 'sine', gain = 1 }) => {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(toFreq, 0.01), now + duration);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(now);
  osc.stop(now + duration + 0.02);
};

// Short filtered-noise burst used for launches and collisions.
const noiseBurst = ({ duration, filterFreq, gain = 1 }) => {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const bufLen = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(masterGain);
  src.start(now);
  src.stop(now + duration + 0.02);
};

// Schedule a sequence of beeps at offsets. Used for arpeggios.
const sequence = (notes, noteDuration, type, gainMul = 1) => {
  if (!ctx || !masterGain) return;
  const base = ctx.currentTime;
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(notes[i], base + i * noteDuration);
    const startT = base + i * noteDuration;
    const endT = startT + noteDuration;
    g.gain.setValueAtTime(0, startT);
    g.gain.linearRampToValueAtTime(0.8 * gainMul, startT + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, endT);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(startT);
    osc.stop(endT + 0.01);
  }
};

// ---- Named sounds ----------------------------------------------------------

export const sfxLaunch = () => {
  noiseBurst({ duration: 0.08, filterFreq: 2500, gain: 0.9 });
};

export const sfxPlanetCollide = () => {
  // Low sine thump, short.
  sweep({ fromFreq: 180, toFreq: 60, duration: 0.18, type: 'sine', gain: 0.8 });
};

export const sfxWin = () => {
  // Rising C5-E5-G5 arpeggio.
  sequence([523.25, 659.25, 783.99], 0.10, 'triangle', 0.8);
};

export const sfxLose = () => {
  // Descending A4-F4-D4 in minor thirds.
  sequence([440.00, 349.23, 293.66], 0.18, 'sawtooth', 0.6);
};

export const sfxMenuHover = () => {
  beep({ freq: 820, duration: 0.04, type: 'sine', gain: 0.35 });
};

export const sfxMenuClick = () => {
  beep({ freq: 1200, duration: 0.05, type: 'square', gain: 0.4 });
};

export const sfxOffworld = () => {
  sweep({ fromFreq: 600, toFreq: 120, duration: 0.30, type: 'sawtooth', gain: 0.5 });
};
