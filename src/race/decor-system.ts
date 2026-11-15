import {
  AdditiveBlending,
  createSystem,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from '@iwsdk/core';
import { WATER_Y } from '../scene-assets/race-board.scene-asset.js';
import { MeshBuilder } from './mesh-builder.js';
import { RaceBoard } from './race-components.js';

interface Boat {
  obj: Group;
  rx: number;
  rz: number;
  cx: number;
  cz: number;
  speed: number;
  phase: number;
}

function boatGeometry(len: number) {
  const b = new MeshBuilder();
  const w = len * 0.32;
  // hull: tapered box (pointed bow at +z)
  b.color = [0.92, 0.93, 0.95];
  const y0 = 0;
  const y1 = len * 0.16;
  const P = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const s0 = [P(-w / 2, y0, -len / 2), P(w / 2, y0, -len / 2), P(w / 2, y1, -len / 2), P(-w / 2, y1, -len / 2)];
  const m0 = [P(-w / 2, y0, len * 0.2), P(w / 2, y0, len * 0.2), P(w / 2, y1, len * 0.2), P(-w / 2, y1, len * 0.2)];
  const bow0 = P(0, y0, len / 2);
  const bow1 = P(0, y1, len / 2);
  b.quad(s0[1], s0[0], s0[3], s0[2]); // stern
  b.quad(s0[0], m0[0], m0[3], s0[3]);
  b.quad(m0[1], s0[1], s0[2], m0[2]);
  b.quad(s0[3], m0[3], m0[2], s0[2]); // deck
  b.quad(m0[0], bow0, bow1, m0[3]);
  b.quad(bow0, m0[1], m0[2], bow1);
  b.tri(m0[3], bow1, m0[2]);
  // cabin
  b.color = [0.2, 0.25, 0.32];
  b.box(0, y1, -len * 0.08, w * 0.7, len * 0.14, len * 0.38);
  return b.build();
}

function heliGeometry() {
  const b = new MeshBuilder();
  b.color = [0.9, 0.9, 0.92];
  b.box(0, 0, 0, 0.014, 0.012, 0.03); // cabin (nose +z)
  b.color = [0.12, 0.16, 0.22];
  b.box(0, 0.004, 0.011, 0.012, 0.007, 0.009); // windscreen
  b.color = [0.9, 0.9, 0.92];
  b.box(0, 0.004, -0.032, 0.004, 0.004, 0.036); // tail boom
  b.box(0, 0.004, -0.05, 0.002, 0.012, 0.006); // fin
  b.color = [0.25, 0.27, 0.3];
  b.box(0.008, -0.005, 0, 0.0015, 0.0015, 0.03); // skids
  b.box(-0.008, -0.005, 0, 0.0015, 0.0015, 0.03);
  b.box(0, 0.012, 0, 0.003, 0.004, 0.003); // mast
  return b.build();
}

/** Ambient life around the circuit: boats cruising past the table edge and a TV helicopter. */
export class DecorSystem extends createSystem({
  boards: { required: [RaceBoard] },
}) {
  private board?: Entity;
  private boats: Boat[] = [];
  private heli?: Group;
  private rotor?: Mesh;
  private tailRotor?: Mesh;
  private beacon?: Mesh;
  private shadow?: Mesh;
  private t = 0;
  private tmp = new Vector3();

  init(): void {
    this.cleanupFuncs.push(this.queries.boards.subscribe('qualify', (e) => this.setup(e)));
    for (const e of this.queries.boards.entities) this.setup(e);
  }

  private setup(board: Entity) {
    if (this.board) return;
    this.board = board;
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    const wakeMat = new MeshBasicMaterial({ color: '#cfefff', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false });
    const wakeGeo = (() => {
      const b = new MeshBuilder();
      b.color = [1, 1, 1];
      b.tri(new Vector3(0.006, 0, 0), new Vector3(-0.006, 0, 0), new Vector3(0, 0, -0.07));
      b.tri(new Vector3(-0.006, 0, 0), new Vector3(0.006, 0, 0), new Vector3(0, 0, -0.07));
      return b.build();
    })();
    const routes: Array<[number, number, number, number, number, number]> = [
      // rx, rz, cx, cz, speed (rad/s, sign = direction), boat length
      [0.78, 0.46, 0, 0, 0.09, 0.05],
      [0.95, 0.6, 0.05, 0.02, -0.06, 0.07],
      [0.66, 0.4, -0.05, 0, -0.12, 0.035],
      [1.05, 0.68, 0, -0.05, 0.05, 0.09],
      [0.55, 0.36, 0.1, -0.02, 0.14, 0.03],
      [0.86, 0.52, -0.08, 0.04, -0.08, 0.045],
    ];
    const geoCache = new Map<number, ReturnType<typeof boatGeometry>>();
    routes.forEach(([rx, rz, cx, cz, speed, len], i) => {
      let geo = geoCache.get(len);
      if (!geo) {
        geo = boatGeometry(len);
        geoCache.set(len, geo);
      }
      const g = new Group();
      g.name = `boat-${i}`;
      g.add(new Mesh(geo, mat));
      const wake = new Mesh(wakeGeo, wakeMat);
      wake.position.set(0, 0.0005, -len / 2);
      wake.scale.set(len / 0.05, 1, len / 0.05);
      g.add(wake);
      this.world.createTransformEntity(g, board);
      this.boats.push({ obj: g, rx, rz, cx, cz, speed, phase: i * 1.7 });
    });

    // helicopter
    const heli = new Group();
    heli.name = 'helicopter';
    heli.add(new Mesh(heliGeometry(), mat));
    const rotorMat = new MeshBasicMaterial({ color: '#202428', transparent: true, opacity: 0.55, depthWrite: false });
    const rotor = new Mesh(new MeshBuilder().build(), rotorMat);
    {
      const b = new MeshBuilder();
      b.color = [1, 1, 1];
      b.box(0, 0, 0, 0.07, 0.0008, 0.003);
      b.box(0, 0, 0, 0.003, 0.0008, 0.07);
      rotor.geometry = b.build();
    }
    rotor.position.y = 0.014;
    heli.add(rotor);
    const tail = new Mesh(rotor.geometry, rotorMat);
    tail.scale.setScalar(0.22);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(0.003, 0.006, -0.05);
    heli.add(tail);
    const beacon = new Mesh(
      new MeshBuilder().build(),
      new MeshBasicMaterial({ color: '#ff3b3b', transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    {
      const b = new MeshBuilder();
      b.color = [1, 1, 1];
      b.box(0, 0, 0, 0.004, 0.004, 0.004);
      beacon.geometry = b.build();
    }
    beacon.position.set(0, -0.007, 0.004);
    heli.add(beacon);
    this.world.createTransformEntity(heli, board);
    this.heli = heli;
    this.rotor = rotor;
    this.tailRotor = tail;
    this.beacon = beacon;

    const shadow = new Mesh(
      (() => {
        const b = new MeshBuilder();
        b.color = [1, 1, 1];
        const c = new Vector3(0, 0, 0);
        const S = 12;
        for (let k = 0; k < S; k++) {
          const a0 = (k / S) * Math.PI * 2;
          const a1 = ((k + 1) / S) * Math.PI * 2;
          b.tri(c, new Vector3(Math.cos(a1) * 0.02, 0, Math.sin(a1) * 0.02), new Vector3(Math.cos(a0) * 0.02, 0, Math.sin(a0) * 0.02));
        }
        return b.build();
      })(),
      new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }),
    );
    shadow.name = 'heli-shadow';
    this.world.createTransformEntity(shadow, board);
    this.shadow = shadow;
  }

  update(delta: number): void {
    if (!this.board) return;
    this.t += delta;
    const t = this.t;
    for (const b of this.boats) {
      const a = b.phase + t * b.speed;
      const x = b.cx + Math.cos(a) * b.rx;
      const z = b.cz + Math.sin(a) * b.rz;
      // heading = derivative of the ellipse
      const dx = -Math.sin(a) * b.rx * Math.sign(b.speed);
      const dz = Math.cos(a) * b.rz * Math.sign(b.speed);
      b.obj.position.set(x, WATER_Y + 0.001 + Math.sin(t * 2 + b.phase) * 0.0006, z);
      b.obj.rotation.set(Math.sin(t * 1.7 + b.phase) * 0.04, Math.atan2(dx, dz), 0);
    }
    if (this.heli && this.rotor && this.tailRotor && this.beacon && this.shadow) {
      // lazy figure-eight over the circuit, like a TV chopper following the race
      const a = t * 0.16;
      const x = Math.sin(a) * 0.42;
      const z = Math.sin(a * 2) * 0.13;
      const y = 0.2 + Math.sin(a * 3) * 0.02;
      const dx = Math.cos(a) * 0.42;
      const dz = Math.cos(a * 2) * 0.26;
      this.heli.position.set(x, y, z);
      const yaw = Math.atan2(dx, dz);
      const ddx = -Math.sin(a) * 0.42;
      const ddz = -Math.sin(a * 2) * 0.52;
      const turn = (dx * ddz - dz * ddx) / Math.max(0.01, dx * dx + dz * dz);
      this.heli.rotation.set(0.12, yaw, Math.max(-0.4, Math.min(0.4, -turn * 0.25)), 'YXZ');
      this.rotor.rotation.y += delta * 40;
      this.tailRotor.rotation.x += delta * 60;
      this.beacon.visible = Math.sin(t * 6) > 0.6;
      this.shadow.position.set(x, 0.033, z);
    }
  }
}
