import {
  AdditiveBlending,
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  BufferAttribute,
  BufferGeometry,
  Group,
  Object3D,
  Points,
  PointsMaterial,
  Vector3,
  World,
} from '@iwsdk/core';
import { TRACK_SURFACE_Y } from './track.js';

/** A flat palm resting over the board, in board-local space. */
interface Palm {
  active: boolean;
  center: Vector3; // palm centre (top surface of the hand)
  along: Vector3; // unit, wrist -> fingertips (horizontal)
  across: Vector3; // unit, perpendicular (horizontal)
  halfLen: number;
  halfWid: number;
}

const SPARKS = 160;

/**
 * The "magic hand": rest your hand flat on the track and the cars drive up
 * onto it, launch off the far side and land in a shower of sparks.
 */
export class HandPlay {
  private palms: Palm[] = [0, 1].map(() => ({
    active: false,
    center: new Vector3(),
    along: new Vector3(1, 0, 0),
    across: new Vector3(0, 0, 1),
    halfLen: 0.085,
    halfWid: 0.045,
  }));
  private yOff: Float32Array;
  private vy: Float32Array;
  private onHand: Uint8Array;
  private pitch: Float32Array;
  private sparkPos: Float32Array;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;
  private sparkGeo: BufferGeometry;
  private sparkNext = 0;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private tmp3 = new Vector3();
  private fake: boolean;
  /** fired when a car lands hard; strength 0..1 */
  onLand?: (strength: number) => void;
  /** number of cars currently riding a hand (for hints/audio) */
  riding = 0;
  handSeen = false;

  constructor(
    private world: World,
    private board: Object3D,
    private carCount: number,
    sparkParent: Object3D,
  ) {
    this.yOff = new Float32Array(carCount);
    this.vy = new Float32Array(carCount);
    this.onHand = new Uint8Array(carCount);
    this.pitch = new Float32Array(carCount);
    this.sparkPos = new Float32Array(SPARKS * 3);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    this.sparkGeo = new BufferGeometry();
    this.sparkGeo.setAttribute('position', new BufferAttribute(this.sparkPos, 3));
    const pts = new Points(
      this.sparkGeo,
      new PointsMaterial({ color: '#ffb347', size: 0.0035, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    pts.frustumCulled = false;
    pts.name = 'sparks';
    const g = new Group();
    g.add(pts);
    sparkParent.add(g);
    for (let i = 0; i < SPARKS; i++) this.sparkPos[i * 3 + 1] = -10;
    this.fake = new URLSearchParams(location.search).has('fakehand');
    if (this.fake) {
      // stand-in "hand" so the effect is visible on a flat screen
      this.fakeMesh = new Mesh(
        new BoxGeometry(0.17, 0.02, 0.08),
        new MeshStandardMaterial({ color: '#e0b48f', roughness: 0.6, transparent: true, opacity: 0.85 }),
      );
      this.fakeMesh.name = 'fake-hand';
      g.add(this.fakeMesh);
    }
  }
  private fakeMesh?: Mesh;

  /** read hand joints from the XR frame and fill the palms (board-local) */
  private readHands(time: number) {
    for (const p of this.palms) p.active = false;
    if (this.fake) {
      // desktop demo: a virtual palm rests across the south straight, breathing up and down
      const p = this.palms[0];
      p.active = true;
      p.center.set(-0.06, TRACK_SURFACE_Y + 0.028 + Math.sin(time * 0.8) * 0.006, 0.12);
      p.along.set(0.3, 0, 1).normalize();
      p.across.set(1, 0, -0.3).normalize();
      if (this.fakeMesh) {
        this.fakeMesh.position.set(p.center.x, p.center.y - 0.01, p.center.z);
        this.fakeMesh.rotation.y = Math.atan2(p.along.x, p.along.z) + Math.PI / 2;
      }
      return;
    }
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const session = this.world.session;
    if (!frame || !ref || !session || !frame.getJointPose) return;
    let k = 0;
    for (const src of session.inputSources) {
      const hand = src.hand;
      if (!hand || k > 1) continue;
      const wrist = hand.get('wrist');
      const mid = hand.get('middle-finger-metacarpal');
      const tip = hand.get('middle-finger-tip');
      const idx = hand.get('index-finger-metacarpal');
      const pinky = hand.get('pinky-finger-metacarpal');
      if (!wrist || !mid || !tip || !idx || !pinky) continue;
      const pw = frame.getJointPose(wrist, ref);
      const pm = frame.getJointPose(mid, ref);
      const pt = frame.getJointPose(tip, ref);
      const pi = frame.getJointPose(idx, ref);
      const pp = frame.getJointPose(pinky, ref);
      if (!pw || !pm || !pt || !pi || !pp) continue;
      this.handSeen = true;
      const W = this.tmp.set(pw.transform.position.x, pw.transform.position.y, pw.transform.position.z);
      const T = this.tmp2.set(pt.transform.position.x, pt.transform.position.y, pt.transform.position.z);
      // flat hand: fingers extended and roughly level
      const len = W.distanceTo(T);
      const tilt = Math.abs(T.y - W.y) / Math.max(len, 1e-3);
      if (len < 0.13 || tilt > 0.45) continue;
      // palm normal (index x pinky across wrist->mid) must point down
      const M = this.tmp3.set(pm.transform.position.x, pm.transform.position.y, pm.transform.position.z);
      const ax = pi.transform.position.x - pp.transform.position.x;
      const ay = pi.transform.position.y - pp.transform.position.y;
      const az = pi.transform.position.z - pp.transform.position.z;
      const fx = M.x - W.x;
      const fy = M.y - W.y;
      const fz = M.z - W.z;
      const ny = az * fx - ax * fz; // y of across x forward
      const nlen = Math.hypot(ay * fz - az * fy, ny, ax * fy - ay * fx) || 1;
      if (Math.abs(ny / nlen) < 0.6) continue;
      const p = this.palms[k++];
      // into board space
      this.board.worldToLocal(W);
      this.board.worldToLocal(T);
      this.board.worldToLocal(M);
      p.center.copy(W).lerp(T, 0.45);
      p.center.y = M.y + 0.012; // top of the hand
      p.along.set(T.x - W.x, 0, T.z - W.z).normalize();
      p.across.set(-p.along.z, 0, p.along.x);
      const s = 1 / Math.max(0.3, this.board.scale.x);
      p.halfLen = Math.max(0.07, (len * s) / 2 + 0.01);
      p.halfWid = 0.045 * s;
      p.active = p.center.y > TRACK_SURFACE_Y - 0.01 && p.center.y < TRACK_SURFACE_Y + 0.12;
    }
  }

  /** height of the hand surface under board-local (x,z), or -1 */
  private handHeightAt(x: number, z: number): number {
    let h = -1;
    for (const p of this.palms) {
      if (!p.active) continue;
      const dx = x - p.center.x;
      const dz = z - p.center.z;
      const a = dx * p.along.x + dz * p.along.z;
      const c = dx * p.across.x + dz * p.across.z;
      if (Math.abs(a) > p.halfLen || Math.abs(c) > p.halfWid) continue;
      // rounded edges: the hand is lower at its rim, so cars ramp up
      const edge = Math.min(1, (p.halfWid - Math.abs(c)) / 0.02, (p.halfLen - Math.abs(a)) / 0.025);
      const top = TRACK_SURFACE_Y + (p.center.y - TRACK_SURFACE_Y) * (0.55 + 0.45 * edge);
      h = Math.max(h, top - TRACK_SURFACE_Y);
    }
    return h;
  }

  /** apply after the cars were placed on the track this frame */
  update(cars: Object3D[], speeds: number[], dt: number, time: number) {
    this.readHands(time);
    this.riding = 0;
    const G = 2.2; // tabletop gravity, m/s^2 (slower reads better at this scale)
    for (let i = 0; i < this.carCount; i++) {
      const car = cars[i];
      if (!car.visible) continue;
      const target = Math.max(0, this.handHeightAt(car.position.x, car.position.z));
      const was = this.onHand[i];
      if (target > 0.004 && this.yOff[i] <= target + 0.004) {
        // climbing / riding the hand
        const climb = Math.max(0.08, speeds[i] * 1.4);
        const prev = this.yOff[i];
        this.yOff[i] = Math.min(target, this.yOff[i] + climb * dt);
        if (this.yOff[i] < target - 0.001) this.yOff[i] = Math.max(this.yOff[i], prev);
        else this.yOff[i] = target;
        this.vy[i] = (this.yOff[i] - prev) / Math.max(dt, 1e-3);
        this.onHand[i] = 1;
        this.riding++;
      } else {
        if (was && this.vy[i] < 0.05) this.vy[i] = 0.06 + speeds[i] * 0.4; // launch off the fingertips
        this.onHand[i] = 0;
        if (this.yOff[i] > target || this.vy[i] > 0) {
          this.vy[i] -= G * dt;
          this.yOff[i] += this.vy[i] * dt;
          if (this.yOff[i] <= target) {
            const impact = -this.vy[i];
            this.yOff[i] = target;
            if (impact > 0.12) {
              this.burst(car.position.x, car.position.y + target, car.position.z, Math.min(1, impact / 0.5));
              this.onLand?.(Math.min(1, impact / 0.5));
              this.vy[i] = impact * 0.28; // small bounce
            } else this.vy[i] = 0;
          }
        } else {
          this.yOff[i] = target;
          this.vy[i] = 0;
        }
      }
      car.position.y += this.yOff[i];
      // nose follows the flight path
      const wantPitch = -Math.atan2(this.vy[i], Math.max(0.05, speeds[i])) * 0.8;
      this.pitch[i] += (wantPitch - this.pitch[i]) * Math.min(1, dt * 12);
      car.rotateX(this.pitch[i]);
    }
    this.updateSparks(dt);
  }

  private burst(x: number, y: number, z: number, strength: number) {
    const n = Math.floor(14 + strength * 26);
    for (let k = 0; k < n; k++) {
      const i = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % SPARKS;
      this.sparkPos[i * 3] = x;
      this.sparkPos[i * 3 + 1] = y + 0.002;
      this.sparkPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.08 + Math.random() * 0.25 * (0.5 + strength);
      this.sparkVel[i * 3] = Math.cos(a) * sp;
      this.sparkVel[i * 3 + 1] = 0.15 + Math.random() * 0.35 * strength;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * sp;
      this.sparkLife[i] = 0.25 + Math.random() * 0.35;
    }
  }

  private updateSparks(dt: number) {
    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      any = true;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 2.5 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (this.sparkLife[i] <= 0) this.sparkPos[i * 3 + 1] = -10;
    }
    if (any) (this.sparkGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}
