import { BufferGeometry, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { hexToRgb, MeshBuilder } from './mesh-builder.js';

/**
 * Procedural food truck at race scale (about 2.4 cm long, nose to +z).
 * Three swappable slots: kitchen, wheels, roof gadget. Each option nudges the handling.
 */

export interface PartDef {
  name: string;
  blurb: string;
  top: number; // straight-line speed multiplier
  grip: number; // corner limit multiplier
  accel: number; // acceleration multiplier
}

export const KITCHENS: PartDef[] = [
  { name: 'TACO', blurb: 'all-rounder', top: 1, grip: 1, accel: 1 },
  { name: 'PIZZA', blurb: 'heavy oven: fast, slow to start', top: 1.05, grip: 0.98, accel: 0.8 },
  { name: 'ICE CREAM', blurb: 'light and nimble', top: 0.97, grip: 1.02, accel: 1.25 },
];
export const WHEELS: PartDef[] = [
  { name: 'MONSTER', blurb: 'grips like glue', top: 0.96, grip: 1.05, accel: 0.95 },
  { name: 'SLICKS', blurb: 'built for straights', top: 1.08, grip: 0.98, accel: 1 },
  { name: 'TINY', blurb: 'zippy, twitchy', top: 0.95, grip: 1, accel: 1.35 },
];
export const ROOFS: PartDef[] = [
  { name: 'HOT DOG', blurb: 'crowd favourite', top: 1, grip: 1.02, accel: 1.05 },
  { name: 'ROCKET', blurb: 'top speed, scary corners', top: 1.1, grip: 0.97, accel: 1.05 },
  { name: 'SPOILER', blurb: 'downforce!', top: 0.97, grip: 1.05, accel: 1 },
];
export const SLOTS = [KITCHENS, WHEELS, ROOFS] as const;
export const SLOT_NAMES = ['KITCHEN', 'WHEELS', 'ROOF'] as const;

export type Build = [number, number, number]; // -1 = slot empty

export function buildStats(b: Build) {
  let top = 1;
  let grip = 1;
  let accel = 1;
  for (let s = 0; s < 3; s++) {
    if (b[s] < 0) continue;
    const p = SLOTS[s][b[s]];
    top *= p.top;
    grip *= p.grip;
    accel *= p.accel;
  }
  return { top, grip, accel };
}

const RIDE = [0.0042, 0.0016, 0.0006]; // chassis height per wheel type
const DARK: [number, number, number] = [0.03, 0.03, 0.035];
const TYRE: [number, number, number] = [0.015, 0.015, 0.018];
const GLASS: [number, number, number] = [0.05, 0.12, 0.2];
const rgb = (h: string) => hexToRgb(h);

function kitchenGeo(k: number, body: [number, number, number]): { geo: BufferGeometry; top: number } {
  const b = new MeshBuilder();
  // cab (the frame lives on the truck itself)
  b.color = body;
  b.box(0, 0.0014, 0.0085, 0.011, 0.0068, 0.0062);
  b.color = GLASS;
  b.box(0, 0.0046, 0.0117, 0.0094, 0.0028, 0.0004);
  b.color = rgb('#fff6c8'); // headlights
  b.box(0.0038, 0.0024, 0.0118, 0.0018, 0.0012, 0.0004);
  b.box(-0.0038, 0.0024, 0.0118, 0.0018, 0.0012, 0.0004);
  let top = 0.0115;
  if (k === 0) {
    // TACO: boxy kitchen, striped awning over a serving window, giant taco on the side
    b.color = body;
    b.box(0, 0.0014, -0.0035, 0.0118, 0.0098, 0.0165);
    b.color = DARK;
    b.box(0.006, 0.0052, -0.0035, 0.0004, 0.0036, 0.0105);
    for (let i = 0; i < 5; i++) {
      b.color = i % 2 ? rgb('#ffd23a') : rgb('#ff7a1a');
      b.box(0.0074, 0.0091, -0.0083 + i * 0.0024, 0.0034, 0.0007, 0.0024);
    }
    b.color = rgb('#f7c35a');
    b.box(-0.0063, 0.0048, -0.004, 0.0009, 0.0042, 0.0085);
    b.color = rgb('#4bd23c');
    b.box(-0.0068, 0.0082, -0.004, 0.0004, 0.0009, 0.0075);
    top = 0.0112;
  } else if (k === 1) {
    // PIZZA: taller, red/white checker band, brick oven chimney
    b.color = body;
    b.box(0, 0.0014, -0.0035, 0.0118, 0.0112, 0.0165);
    for (let i = 0; i < 7; i++) {
      for (const sx of [1, -1]) {
        b.color = (i + (sx > 0 ? 0 : 1)) % 2 ? rgb('#ffffff') : rgb('#e8202a');
        b.box(0.006 * sx, 0.0098, -0.0109 + i * 0.0024, 0.0004, 0.0018, 0.0024);
      }
    }
    b.color = DARK;
    b.box(0.006, 0.0042, -0.0035, 0.0004, 0.0042, 0.0095);
    b.color = rgb('#8a8f99');
    b.box(-0.003, 0.0126, -0.009, 0.0022, 0.005, 0.0022);
    top = 0.0126;
  } else {
    // ICE CREAM: rounded-ish pastel van with a giant cone on the side
    b.color = body;
    b.box(0, 0.0014, -0.0035, 0.0114, 0.0088, 0.0165);
    b.color = rgb('#ffd1e8');
    b.box(0, 0.0102, -0.0035, 0.0098, 0.0012, 0.015);
    b.color = rgb('#9ff3dd');
    b.box(0.0058, 0.006, -0.0035, 0.0004, 0.001, 0.016);
    b.box(-0.0058, 0.006, -0.0035, 0.0004, 0.001, 0.016);
    b.color = rgb('#d9913f');
    b.box(-0.0064, 0.003, -0.002, 0.0012, 0.004, 0.0024);
    b.color = rgb('#ff8fc6');
    b.box(-0.0066, 0.0068, -0.002, 0.0018, 0.0026, 0.0032);
    top = 0.0114;
  }
  return { geo: b.build(), top };
}

function wheelsGeo(w: number): BufferGeometry {
  const b = new MeshBuilder();
  const pos = [
    [1, 0.0072],
    [-1, 0.0072],
    [1, -0.0075],
    [-1, -0.0075],
  ];
  for (const [sx, z] of pos) {
    if (w === 0) {
      b.color = TYRE;
      b.box(sx * 0.0068, 0, z, 0.0034, 0.0076, 0.0072);
      b.color = rgb('#c9ced6');
      b.box(sx * 0.0086, 0.0026, z, 0.0004, 0.0024, 0.0024);
    } else if (w === 1) {
      b.color = TYRE;
      b.box(sx * 0.0062, 0, z, 0.0034, 0.0044, 0.005);
      b.color = rgb('#ff2a3d');
      b.box(sx * 0.0079, 0.0014, z, 0.0003, 0.0016, 0.0032);
    } else {
      b.color = rgb('#c9ced6');
      b.box(sx * 0.0045, 0.0008, z, 0.0008, 0.0012, 0.0008);
      b.color = TYRE;
      b.box(sx * 0.0045, 0, z, 0.0016, 0.0016, 0.0016);
    }
  }
  return b.build();
}

function roofGeo(r: number): BufferGeometry {
  const b = new MeshBuilder();
  if (r === 0) {
    // HOT DOG: bun, sausage, mustard zigzag
    b.color = rgb('#e9b25f');
    b.box(0.0016, 0, -0.003, 0.0032, 0.0026, 0.017);
    b.box(-0.0016, 0, -0.003, 0.0032, 0.0026, 0.017);
    b.color = rgb('#b4432a');
    b.box(0, 0.0012, -0.003, 0.0034, 0.003, 0.0205);
    b.color = rgb('#ffd400');
    for (let i = 0; i < 6; i++) b.box(0, 0.0042, -0.011 + i * 0.0032, 0.0034, 0.0005, 0.0009, i % 2 ? 0.7 : -0.7);
  } else if (r === 1) {
    // ROCKET: booster tube with fins and an orange flame
    b.color = rgb('#d5dae2');
    b.box(0, 0.0006, -0.004, 0.0042, 0.0042, 0.016);
    b.color = rgb('#e8202a');
    b.box(0, 0.0012, 0.0052, 0.003, 0.003, 0.0026);
    b.box(0, 0.0006, -0.0105, 0.009, 0.0008, 0.003);
    b.box(0, 0.0006, -0.0105, 0.0008, 0.006, 0.003);
    b.color = rgb('#ffb21a');
    b.box(0, 0.0014, -0.0134, 0.0026, 0.0026, 0.003);
    b.color = rgb('#ff4d10');
    b.box(0, 0.0019, -0.0152, 0.0014, 0.0016, 0.0014);
  } else {
    // SPOILER: a huge rear wing
    b.color = DARK;
    b.box(0.0035, 0, -0.0105, 0.0008, 0.0045, 0.0016);
    b.box(-0.0035, 0, -0.0105, 0.0008, 0.0045, 0.0016);
    b.color = rgb('#e8202a');
    b.box(0, 0.0045, -0.0105, 0.016, 0.0009, 0.0048);
    b.color = rgb('#ffffff');
    b.box(0.0082, 0.0028, -0.0105, 0.0004, 0.0036, 0.006);
    b.box(-0.0082, 0.0028, -0.0105, 0.0004, 0.0036, 0.006);
  }
  return b.build();
}

/** A truck whose three slots can be swapped live. */
export class TruckModel {
  readonly group = new Group();
  readonly body = new Group(); // rides at the wheel height
  readonly parts: (Mesh | null)[] = [null, null, null];
  readonly build: Build = [-1, -1, -1];
  private mat: MeshStandardMaterial;
  private top = 0.0095;

  constructor(private color: string) {
    this.mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
    this.group.add(this.body);
    this.group.name = 'food-truck';
    const f = new MeshBuilder();
    f.color = DARK;
    f.box(0, 0, 0, 0.0112, 0.0014, 0.0238);
    f.color = [0.6, 0.6, 0.62];
    f.box(0, 0.0004, 0.0124, 0.0116, 0.0012, 0.001);
    const frame = new Mesh(f.build(), this.mat);
    frame.name = 'frame';
    this.body.add(frame);
  }

  setPart(slot: number, option: number): Mesh {
    const old = this.parts[slot];
    if (old) {
      old.parent?.remove(old);
      old.geometry.dispose();
    }
    this.build[slot] = option;
    let geo: BufferGeometry;
    if (slot === 0) {
      const k = kitchenGeo(option, rgb(this.color));
      geo = k.geo;
      this.top = k.top;
    } else if (slot === 1) geo = wheelsGeo(option);
    else geo = roofGeo(option);
    const m = new Mesh(geo, this.mat);
    m.name = `part-${slot}`;
    this.parts[slot] = m;
    if (slot === 1) this.group.add(m);
    else this.body.add(m);
    this.layout();
    return m;
  }

  setBuild(b: Build) {
    for (let s = 0; s < 3; s++) if (b[s] >= 0) this.setPart(s, b[s]);
  }

  /** resting height of a slot's mesh inside its parent */
  baseY(slot: number): number {
    if (slot === 2) return this.build[0] >= 0 ? this.top : 0.0082;
    return 0;
  }

  private layout() {
    this.body.position.y = this.build[1] >= 0 ? RIDE[this.build[1]] : 0.0016;
    const roof = this.parts[2];
    if (roof) roof.position.y = this.build[0] >= 0 ? this.top : 0.0082;
  }
}
