import { EngineSynth } from './engine-synth.js';

/** Tiny procedural sound: start-light beeps, a crowd/engine bed that follows race pace, UI clicks. */
export class RaceAudio {
  private ctx?: AudioContext;
  private engineSynth?: EngineSynth;
  private panner?: PannerNode;

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const g = ctx.createGain();
      g.gain.value = 0.32;
      this.engineSynth = new EngineSynth(ctx);
      // HRTF panner: the engine note comes from the followed car's real position
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 0.25;
      panner.rolloffFactor = 1.2;
      this.engineSynth.output.connect(panner).connect(g).connect(ctx.destination);
      this.panner = panner;

    } catch {
      /* no audio */
    }
    return this.ctx;
  }

  /** must be called from a user gesture at least once (pinch counts) */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  beep(freq: number, dur = 0.18, vol = 0.18) {
    const ctx = this.ctx; // only after unlock() from a user gesture
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  /** deep rising swell for the reveal */
  swell(dur = 2.6) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o2.type = 'sawtooth';
    o.frequency.setValueAtTime(42, t);
    o.frequency.exponentialRampToValueAtTime(110, t + dur);
    o2.frequency.setValueAtTime(42.7, t);
    o2.frequency.exponentialRampToValueAtTime(111.5, t + dur);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(120, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(ctx.destination);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.7);
    o2.stop(t + dur + 0.7);
  }

  /** bright three-note sting for the title card */
  chime() {
    const ctx = this.ctx;
    if (!ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.11;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 1.3);
    });
  }

  /** short soft "thud" when a car lands on the grid */
  thud() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.17);
  }

  click() {
    this.beep(1400, 0.05, 0.08);
  }

  /** place listener (head) and source (car) in world space, metres */
  place(
    lx: number, ly: number, lz: number,
    fx: number, fy: number, fz: number,
    ux: number, uy: number, uz: number,
    sx: number, sy: number, sz: number,
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.panner) return;
    const L = ctx.listener;
    const t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(lx, t, 0.02);
      L.positionY.setTargetAtTime(ly, t, 0.02);
      L.positionZ.setTargetAtTime(lz, t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02);
      L.forwardY.setTargetAtTime(fy, t, 0.02);
      L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(ux, t, 0.02);
      L.upY.setTargetAtTime(uy, t, 0.02);
      L.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      L.setPosition(lx, ly, lz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    this.panner.positionX.setTargetAtTime(sx, t, 0.02);
    this.panner.positionY.setTargetAtTime(sy, t, 0.02);
    this.panner.positionZ.setTargetAtTime(sz, t, 0.02);
  }

  /** pace 0..1 (follow-car speed / max), volume 0..1 */
  engine(pace: number, volume: number, dt = 1 / 72) {
    this.engineSynth?.update(pace, volume, dt);
  }

}
