/** Tiny procedural sound: start-light beeps, a crowd/engine bed that follows race pace, UI clicks. */
export class RaceAudio {
  private ctx?: AudioContext;
  private engineGain?: GainNode;
  private engineOsc?: OscillatorNode;
  private engineOsc2?: OscillatorNode;

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const g = ctx.createGain();
      g.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 110;
      const o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.value = 165;
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      o1.connect(filter);
      o2.connect(g2).connect(filter);
      filter.connect(g).connect(ctx.destination);
      o1.start();
      o2.start();
      this.engineGain = g;
      this.engineOsc = o1;
      this.engineOsc2 = o2;
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

  /** pace 0..1 (follow-car speed / max), volume 0..1 */
  engine(pace: number, volume: number) {
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineOsc2) return;
    const t = this.ctx.currentTime;
    const f = 70 + pace * 190;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(f * 1.5, t, 0.08);
    this.engineGain.gain.setTargetAtTime(volume * 0.05, t, 0.2);
  }
}
