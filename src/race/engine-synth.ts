/**
 * Procedural race-engine voice (no samples). Models a high-revving flat-six:
 * - one oscillator whose PeriodicWave is built on the 720-degree engine cycle,
 *   strong firing orders (3rd crank order and multiples) plus half-orders that
 *   give the uneven boxer "burble";
 * - a second, slightly detuned bank for exhaust beating;
 * - soft-clip distortion, a throttle-driven low-pass, intake/exhaust noise;
 * - 7-speed gearbox: rpm comes from speed, upshifts cut the sound briefly,
 *   lifting off closes the filter and fires random exhaust crackles.
 */
export class EngineSynth {
  private osc1: OscillatorNode;
  private osc2: OscillatorNode;
  private filter: BiquadFilterNode;
  private shaper: WaveShaperNode;
  private noiseGain: GainNode;
  private noiseFilter: BiquadFilterNode;
  private cut: GainNode;
  readonly output: GainNode;
  private gear = 1;
  private lastSpeed = 0;
  private throttle = 0;
  private crackleTimer = 0;
  rpm = 1000;

  static readonly REDLINE = 9000;
  static readonly IDLE = 1100;
  static readonly GEARS = 7;

  constructor(private ctx: AudioContext) {
    const wave = EngineSynth.buildWave(ctx);
    this.osc1 = ctx.createOscillator();
    this.osc1.setPeriodicWave(wave);
    this.osc2 = ctx.createOscillator();
    this.osc2.setPeriodicWave(wave);
    this.osc2.detune.value = 9;
    const g2 = ctx.createGain();
    g2.gain.value = 0.55;

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = EngineSynth.softClip(2.6);
    this.shaper.oversample = '2x';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.4;
    this.filter.frequency.value = 1200;

    // broadband noise for intake roar / exhaust rasp
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.Q.value = 0.9;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;

    this.cut = ctx.createGain(); // gear-shift cut
    this.output = ctx.createGain();
    this.output.gain.value = 0;

    this.osc1.connect(this.shaper);
    this.osc2.connect(g2).connect(this.shaper);
    this.shaper.connect(this.filter).connect(this.cut);
    noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.cut);
    this.cut.connect(this.output);
    this.osc1.start();
    this.osc2.start();
    noise.start();
  }

  private static buildWave(ctx: AudioContext): PeriodicWave {
    // harmonic n of the 720-degree cycle = crank order n/2
    const N = 48;
    const real = new Float32Array(N + 1);
    const imag = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) {
      let a = 0.02 / n;
      if (n % 6 === 0) a = 1.0 / Math.pow(n / 6, 0.85); // firing frequency + overtones
      else if (n % 3 === 0) a = 0.32 / Math.pow(n / 3, 0.9); // boxer half-orders
      else if (n % 2 === 0) a = 0.06 / Math.sqrt(n);
      // fixed pseudo-random phases keep the pulse train "lumpy"
      const ph = (n * 2.39996) % (Math.PI * 2);
      real[n] = a * Math.cos(ph);
      imag[n] = a * Math.sin(ph);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  private static softClip(k: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const c = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return c;
  }

  /**
   * @param speedNorm car speed 0..1 of its top speed
   * @param volume 0..1 master level
   * @param dt seconds since last call
   */
  update(speedNorm: number, volume: number, dt: number) {
    const t = this.ctx.currentTime;
    const v = Math.max(0, Math.min(1, speedNorm));
    const accel = (v - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = v;
    const target = accel > -0.05 ? 1 : 0;
    this.throttle += (target - this.throttle) * Math.min(1, dt * 8);

    // gearbox: each gear covers a slice of the speed range with overlap
    const G = EngineSynth.GEARS;
    const bandLo = (g: number) => Math.pow((g - 1) / G, 1.15);
    const bandHi = (g: number) => Math.pow(g / G, 1.15) * 1.02;
    const prevGear = this.gear;
    while (this.gear < G && v > bandHi(this.gear) * 0.97) this.gear++;
    while (this.gear > 1 && v < bandLo(this.gear) * 0.95) this.gear--;
    const lo = bandLo(this.gear);
    const hi = bandHi(this.gear);
    const frac = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-3, hi - lo)));
    const rpm = v < 0.02 ? EngineSynth.IDLE : 5200 + frac * (EngineSynth.REDLINE - 5200);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * (this.gear !== prevGear ? 30 : 10));

    if (this.gear > prevGear) {
      // upshift: short torque cut
      this.cut.gain.cancelScheduledValues(t);
      this.cut.gain.setValueAtTime(0.25, t);
      this.cut.gain.linearRampToValueAtTime(1, t + 0.09);
    }

    const cycleHz = this.rpm / 120; // 720-degree cycle
    this.osc1.frequency.setTargetAtTime(cycleHz, t, 0.015);
    this.osc2.frequency.setTargetAtTime(cycleHz, t, 0.015);
    const load = 0.35 + 0.65 * this.throttle;
    this.filter.frequency.setTargetAtTime(500 + load * (1200 + (this.rpm / EngineSynth.REDLINE) * 3800), t, 0.03);
    this.noiseFilter.frequency.setTargetAtTime(400 + this.rpm * 0.35, t, 0.03);
    this.noiseGain.gain.setTargetAtTime(0.05 + 0.12 * this.throttle * (this.rpm / EngineSynth.REDLINE), t, 0.05);
    this.output.gain.setTargetAtTime(volume * (0.55 + 0.45 * load), t, 0.12);

    // lift-off crackles
    this.crackleTimer -= dt;
    if (volume > 0 && this.throttle < 0.4 && this.rpm > 5500 && this.crackleTimer <= 0) {
      this.crackleTimer = 0.05 + Math.random() * 0.18;
      this.pop(volume);
    }
  }

  private pop(volume: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800 + Math.random() * 1500;
    const g = ctx.createGain();
    g.gain.value = 0.5 * volume * (0.5 + Math.random() * 0.5);
    src.connect(f).connect(g).connect(this.output);
    src.start(t);
  }
}
