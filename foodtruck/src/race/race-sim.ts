import type { TrackSample } from './track.js';

/** Fictional league: "Lumen Grand Circuit". No real teams, drivers or brands. */
export interface TeamDef {
  name: string;
  color: string;
}
export interface DriverDef {
  code: string;
  name: string;
  team: number;
  skill: number;
}

export const TEAMS: TeamDef[] = [
  { name: 'Taco Torpedo', color: '#ff7a1a' },
  { name: 'Pizza Bolt', color: '#ff3b5c' },
  { name: 'Sushi Express', color: '#2ee6ff' },
  { name: 'Waffle Wagon', color: '#b06bff' },
  { name: 'Kale Kart', color: '#3dff8b' },
  { name: 'Your Truck', color: '#ffe14d' },
];

export const DRIVERS: DriverDef[] = [
  { code: 'TAC', name: 'Taco Tina', team: 0, skill: 1.0 },
  { code: 'NAC', name: 'Nacho Nate', team: 0, skill: 0.985 },
  { code: 'PEP', name: 'Pepperoni Pia', team: 1, skill: 0.995 },
  { code: 'MOZ', name: 'Mozz Marco', team: 1, skill: 0.98 },
  { code: 'MAK', name: 'Maki Mo', team: 2, skill: 0.99 },
  { code: 'WAS', name: 'Wasabi Wu', team: 2, skill: 0.975 },
  { code: 'YOU', name: 'You', team: 5, skill: 0.985 },
  { code: 'SYR', name: 'Syrup Sam', team: 3, skill: 0.97 },
  { code: 'KAL', name: 'Kale Kim', team: 4, skill: 0.978 },
  { code: 'SPR', name: 'Sprout Sol', team: 4, skill: 0.965 },
];

export const enum RacePhase {
  Grid = 0,
  Lights = 1,
  Racing = 2,
  Finished = 3,
}

export interface CarState {
  index: number;
  driver: DriverDef;
  /** total distance travelled in meters (laps * length + lap progress) */
  dist: number;
  speed: number;
  lateral: number;
  lap: number;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  finished: boolean;
  finishTime: number;
  position: number;
  form: number;
  /** tyre age in laps-equivalent (push mode ages tyres faster) */
  tyreAge: number;
  push: boolean;
  /** seconds left stationary in the pit box (0 = not pitting) */
  pitting: number;
  pits: number;
  /** lap on which the AI plans its stop */
  pitLap: number;
  /** seconds left in a crash (human car only) */
  crashT: number;
  overT: number;
}

export const CRASH_TIME = 2.2;

/** pace multiplier from tyre age: gentle drop, then a cliff after ~4 laps */
export function tyreGrip(age: number): number {
  const cliff = age > 4 ? 0.03 * Math.pow(age - 4, 1.3) : 0;
  return Math.max(0.72, 1 - 0.01 * age - cliff);
}
/** 0..100 % of tyre life left, for display */
export function tyreLife(age: number): number {
  return Math.max(0, Math.round(100 - (age / 7) * 100));
}

const PIT_STOP = 2.4;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RaceSim {
  readonly cars: CarState[];
  readonly order: CarState[];
  phase = RacePhase.Grid;
  time = 0;
  lightsTime = 0;
  totalLaps: number;
  fastestLap = Infinity;
  fastestLapCar = -1;
  /** small event log: newest first */
  events: string[] = [];
  /** the car the viewer manages (-1 = none): the AI never pits it */
  playerCar = -1;
  /** human throttle 0..1 (pinch held = 1) */
  throttle = 0;
  /** true when the human drives playerCar (slot-car style) */
  humanDrives = false;
  /** demo/bot driver for the player's car (?autodrive): lifts just before corners */
  autoDrive = false;
  /** handling multipliers from the truck the player built */
  playerTop = 1;
  playerGrip = 1;
  playerAccel = 1;
  crashes = 0;
  onCrash?: (car: CarState) => void;
  private rand: () => number;
  private readonly vmax = 0.24;
  private readonly cornerK = 0.045;

  constructor(
    private readonly track: TrackSample,
    seed = 1,
    laps = 8,
  ) {
    this.totalLaps = laps;
    this.rand = mulberry32(seed);
    this.cars = DRIVERS.map((driver, index) => ({
      index,
      driver,
      dist: 0,
      speed: 0,
      lateral: 0,
      lap: 0,
      lapStart: 0,
      lastLap: 0,
      bestLap: Infinity,
      finished: false,
      finishTime: 0,
      position: index + 1,
      form: 1,
      tyreAge: 0,
      push: false,
      pitting: 0,
      pits: 0,
      pitLap: 3,
      crashT: 0,
      overT: 0,
    }));
    this.order = this.cars.slice();
    this.reset(seed);
  }

  reset(seed = Math.floor(Math.random() * 1e9)) {
    this.rand = mulberry32(seed);
    this.phase = RacePhase.Grid;
    this.time = 0;
    this.lightsTime = 0;
    this.fastestLap = Infinity;
    this.fastestLapCar = -1;
    this.events = [];
    // Shuffle the grid a little: qualifying is skill + luck.
    const grid = this.cars
      .map((c) => ({ c, q: c.driver.skill + (this.rand() - 0.5) * 0.03 }))
      .sort((a, b) => b.q - a.q);
    grid.forEach(({ c }, slot) => {
      c.dist = -0.06 - slot * 0.075;
      c.lateral = slot % 2 === 0 ? -0.009 : 0.009;
      c.speed = 0;
      c.lap = 0;
      c.lapStart = 0;
      c.lastLap = 0;
      c.bestLap = Infinity;
      c.finished = false;
      c.finishTime = 0;
      c.form = 1 + (this.rand() - 0.5) * 0.02;
      c.tyreAge = 0;
      c.push = false;
      c.pitting = 0;
      c.pits = 0;
      c.crashT = 0;
      c.overT = 0;
      c.pitLap = Math.max(2, Math.round(this.totalLaps * (0.38 + this.rand() * 0.22)));
    });
    this.playerCar = -1;
    this.humanDrives = false;
    this.throttle = 0;
    this.crashes = 0;
    this.sortOrder();
  }

  startLights() {
    if (this.phase === RacePhase.Grid) {
      this.phase = RacePhase.Lights;
      this.lightsTime = 0;
    }
  }

  /** number of red lights lit (0..5) during the start sequence */
  get lightsOn(): number {
    if (this.phase !== RacePhase.Lights) return 0;
    return Math.min(5, Math.floor(this.lightsTime / 0.8) + 1);
  }

  get leaderLap(): number {
    return Math.min(this.totalLaps, Math.max(1, this.order[0].lap + 1));
  }

  sampleIndex(dist: number): number {
    const L = this.track.length;
    const d = ((dist % L) + L) % L;
    return Math.min(this.track.points.length - 1, Math.floor((d / L) * (this.track.points.length - 1)));
  }

  /** simple lookahead bot: keep the gas on unless a corner ahead needs braking now */
  private botThrottle(car: CarState, grip: number): boolean {
    const n = this.track.points.length - 1;
    const ds = this.track.length / n;
    const v = car.speed;
    for (let j = 0; j < 80; j++) {
      const k = this.track.curvature[this.sampleIndex(car.dist + j * ds)];
      const lim = ((this.vmax * car.driver.skill * grip * this.playerGrip) / (1 + this.cornerK * k)) * 1.17;
      if (v > lim && (v * v - lim * lim) / (2 * 0.95) >= j * ds - 0.004) return false;
    }
    return true;
  }

  step(dt: number) {
    if (this.phase === RacePhase.Grid || this.phase === RacePhase.Finished) return;
    if (this.phase === RacePhase.Lights) {
      this.lightsTime += dt;
      if (this.lightsTime > 4 + 0.4 + this.rand() * 0.02) {
        this.phase = RacePhase.Racing;
        this.pushEvent('LIGHTS OUT!');
      }
      return;
    }
    this.time += dt;
    const L = this.track.length;
    let allDone = true;
    for (const car of this.order) {
      if (car.finished) {
        // cool-down lap, slow
        car.dist += 0.06 * dt;
        continue;
      }
      allDone = false;
      const i = this.sampleIndex(car.dist);
      const k = this.track.curvature[i];
      // tyres + strategy
      car.tyreAge += ((car.speed * dt) / L) * (car.push ? 1.9 : 1);
      if (car.index !== this.playerCar && car.pits === 0 && car.pitting <= 0 && car.lap >= car.pitLap && car.lap < this.totalLaps - 1) {
        this.requestPit(car.index);
      }
      const grip = tyreGrip(car.tyreAge) * (car.push ? 1.03 : 1);
      let target =
        (this.vmax * car.driver.skill * car.form * grip) / (1 + this.cornerK * k);
      // Traffic: dirty air in corners, slipstream on straights.
      const ahead = this.carAhead(car);
      let wantLateral = car.lateral * 0.98;
      if (ahead) {
        const gap = ahead.dist - car.dist;
        if (gap < 0.05) {
          if (k > 6) target = Math.min(target, ahead.speed * 1.0);
          else target *= 1.04; // slipstream
          if (gap < 0.03) wantLateral = ahead.lateral > 0 ? -0.011 : 0.011;
        }
      }
      if (this.humanDrives && car.index === this.playerCar) {
        // slot-car: the player only controls speed; too fast in a corner = off you go
        if (car.crashT > 0) {
          car.crashT -= dt;
          car.speed = 0;
          if (car.crashT <= 0) car.crashT = 0;
          continue;
        }
        const limit = (this.vmax * car.driver.skill * grip * this.playerGrip) / (1 + this.cornerK * k);
        if (this.autoDrive) this.throttle = this.botThrottle(car, grip) ? 1 : 0;
        target = this.throttle > 0.5 ? this.vmax * 1.04 * grip * this.playerTop : 0;
        if (car.speed > limit * 1.25) car.overT += dt;
        else car.overT = Math.max(0, car.overT - dt * 2);
        if (car.overT > 0.1) {
          car.overT = 0;
          car.crashT = CRASH_TIME;
          this.crashes++;
          this.pushEvent('YOU CRASHED! Lift earlier...');
          this.onCrash?.(car);
          car.speed = 0;
          continue;
        }
        const acc = target > car.speed ? 0.24 * this.playerAccel : 0.95;
        car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), acc * dt);
        car.lateral += (wantLateral - car.lateral) * Math.min(1, dt * 3);
        const b0 = car.dist;
        car.dist += car.speed * dt;
        this.lapCheck(car, b0);
        continue;
      }
      if (car.pitting > 0) {
        // in the pit box: crawl along the pit lane edge, then fresh tyres
        target = 0.035;
        wantLateral = 0.034;
        car.pitting -= dt;
        if (car.pitting <= 0) {
          car.pitting = 0;
          car.tyreAge = 0;
          car.pits += 1;
          this.pushEvent(`${car.driver.code} OUT OF THE PITS`);
        }
      }
      // accelerate / brake smoothly
      const accel = target > car.speed ? 0.18 : 0.6;
      car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), accel * dt);
      car.lateral += (wantLateral - car.lateral) * Math.min(1, dt * 3);
      const before = car.dist;
      car.dist += car.speed * dt;
      this.lapCheck(car, before);
    }
    const prev = this.order.map((c) => c.index);
    this.sortOrder();
    for (let p = 0; p < this.order.length; p++) {
      const c = this.order[p];
      const was = prev.indexOf(c.index);
      if (was > p && !c.finished && this.phase === RacePhase.Racing) {
        const passed = this.cars[prev[p]];
        if (passed && was === p + 1) this.pushEvent(`${c.driver.code} PASSES ${passed.driver.code} FOR P${p + 1}`);
      }
    }
    // a struggling human never holds the race hostage: once every AI car is home, it's over
    if (!allDone && this.humanDrives && this.playerCar >= 0)
      allDone = this.cars.every((c) => c.finished || c.index === this.playerCar);
    if (allDone) this.phase = RacePhase.Finished;
  }

  private lapCheck(car: CarState, before: number) {
    const L = this.track.length;
    // lap completion
    if (Math.floor(car.dist / L) > Math.floor(before / L) && car.dist > 0) {
      const lapTime = this.time - car.lapStart;
      if (car.lap > 0 || before >= 0) {
        car.lastLap = lapTime;
        if (lapTime < car.bestLap) car.bestLap = lapTime;
        if (car.lap > 0 && lapTime < this.fastestLap) {
          this.fastestLap = lapTime;
          this.fastestLapCar = car.index;
          this.pushEvent(`FASTEST LAP  ${car.driver.code}  ${formatTime(lapTime)}`);
        }
      }
      car.lap += 1;
      car.lapStart = this.time;
      car.form = 1 + (this.rand() - 0.5) * 0.025;
      if (car.lap >= this.totalLaps) {
        car.finished = true;
        car.finishTime = this.time;
        if (this.order[0] === car) this.pushEvent(`${car.driver.code} WINS!`);
      }
    }

  }

  /** send a car to the pits (ignored if already pitting or not racing) */
  requestPit(index: number): boolean {
    const car = this.cars[index];
    if (this.phase !== RacePhase.Racing || car.finished || car.pitting > 0) return false;
    car.pitting = PIT_STOP;
    car.push = false;
    this.pushEvent(`${car.driver.code} PITS`);
    return true;
  }

  /** gap to leader in seconds (approximate, using average speed) */
  gapToLeader(car: CarState): number {
    const leader = this.order[0];
    return (leader.dist - car.dist) / (this.vmax * 0.75);
  }

  private carAhead(car: CarState): CarState | undefined {
    let best: CarState | undefined;
    let bestGap = Infinity;
    for (const o of this.cars) {
      if (o === car || o.pitting > 0) continue;
      const g = o.dist - car.dist;
      if (g > 0 && g < bestGap) {
        bestGap = g;
        best = o;
      }
    }
    return best;
  }

  private sortOrder() {
    this.order.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
    this.order.forEach((c, i) => (c.position = i + 1));
  }

  private pushEvent(text: string) {
    this.events.unshift(text);
    if (this.events.length > 4) this.events.length = 4;
  }
}

export function formatTime(t: number): string {
  if (!isFinite(t)) return '--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}
