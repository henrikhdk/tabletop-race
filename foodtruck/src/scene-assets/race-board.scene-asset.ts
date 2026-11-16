import {
  AdditiveBlending,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
} from '@iwsdk/core';
import { hexToRgb, MeshBuilder } from '../race/mesh-builder.js';
import { CircuitDef, CircuitPalette, CIRCUITS } from '../race/circuits.js';
import { createTrackCurve, sampleTrack, TRACK_HALF_WIDTH, TRACK_SAMPLES, TRACK_SURFACE_Y } from '../race/track.js';

/**
 * Tabletop diorama of one World Food Grand Prix circuit (see circuits.ts);
 * the registered asset is the first circuit, others are built at runtime.
 * The core play area is ~1.1 m x 0.66 m; the water (with cruising boats added
 * at runtime) spreads well past it and fades out, so the scene grows beyond
 * the real table. Origin = table contact point at the centre.
 */
export const BOARD_W = 1.1;
export const BOARD_D = 0.66;
export const WATER_Y = 0.012;
const ISLAND_Y = TRACK_SURFACE_Y - 0.0015;
const ISLAND_MARGIN = 0.052;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pointInPoly(x: number, z: number, pts: Vector3[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function createWater(pal: CircuitPalette): Mesh {
  // big fading water sheet: alpha falls off towards a rounded-rect edge
  const W = 2.4;
  const D = 1.7;
  const geo = new PlaneGeometry(W, D, 48, 34);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 4);
  const deep = hexToRgb(pal.waterDeep);
  const shallow = hexToRgb(pal.waterShallow);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // distance from the core board rectangle
    const dx = Math.max(0, Math.abs(x) - BOARD_W / 2);
    const dz = Math.max(0, Math.abs(z) - BOARD_D / 2);
    const d = Math.hypot(dx, dz);
    const fade = 1 - Math.min(1, d / 0.55);
    const a = fade * fade * (3 - 2 * fade);
    const n = 0.5 + 0.5 * Math.sin(x * 23 + z * 17) * Math.cos(z * 29 - x * 7);
    const t = Math.min(1, Math.max(0, 1 - Math.hypot(x / 0.6, z / 0.35)) + n * 0.15);
    colors[i * 4] = deep[0] + (shallow[0] - deep[0]) * t;
    colors[i * 4 + 1] = deep[1] + (shallow[1] - deep[1]) * t;
    colors[i * 4 + 2] = deep[2] + (shallow[2] - deep[2]) * t;
    colors[i * 4 + 3] = 0.92 * a;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 4));
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    roughness: 0.18,
    metalness: 0.2,
    depthWrite: false,
  });
  const water = new Mesh(geo, mat);
  water.name = 'water';
  water.position.y = WATER_Y;
  water.renderOrder = -1;
  return water;
}

export function createRaceBoard(circuit: CircuitDef = CIRCUITS[0]): Group {
  const root = new Group();
  root.name = 'race-board';
  const pal = circuit.palette;
  const track = sampleTrack(createTrackCurve(circuit));
  const up = new Vector3(0, 1, 0);
  const pts = track.points.slice(0, TRACK_SAMPLES);
  const normalAt = (i: number) => new Vector3().crossVectors(up, track.tangents[i]).normalize();
  const side = (i: number, off: number, y = TRACK_SURFACE_Y) => {
    const p = track.points[i];
    const n = normalAt(i);
    return new Vector3(p.x + n.x * off, y, p.z + n.z * off);
  };
  // which normal sign points out of the loop
  const outward = (() => {
    const p = side(0, 0.01);
    return pointInPoly(p.x, p.z, pts) ? -1 : 1;
  })();

  root.add(createWater(pal));

  const solid = new MeshBuilder();
  const rnd = seeded(circuit.seed);
  const land = hexToRgb(pal.land);
  const landEdge = hexToRgb(pal.landEdge);

  // --- main island: fill inside the loop + a margin band + a shore skirt ---
  const shape = new Shape();
  pts.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)));
  const fill = new ShapeGeometry(shape, 1);
  fill.rotateX(-Math.PI / 2);
  fill.translate(0, ISLAND_Y, 0);
  const fillMesh = new Mesh(fill, new MeshStandardMaterial({ color: pal.land, roughness: 0.95, side: DoubleSide }));
  fillMesh.name = 'island-fill';
  root.add(fillMesh);

  solid.color = land;
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const a0 = side(i, ISLAND_MARGIN, ISLAND_Y);
    const a1 = side(i, -ISLAND_MARGIN, ISLAND_Y);
    const b0 = side(i + 1, ISLAND_MARGIN, ISLAND_Y);
    const b1 = side(i + 1, -ISLAND_MARGIN, ISLAND_Y);
    solid.quad(a1, b1, b0, a0);
  }
  solid.color = landEdge;
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const o = outward * ISLAND_MARGIN;
    const t0 = side(i, o, ISLAND_Y);
    const t1 = side(i + 1, o, ISLAND_Y);
    const b0 = side(i, o * 1.08, WATER_Y - 0.004);
    const b1 = side(i + 1, o * 1.08, WATER_Y - 0.004);
    if (outward > 0) solid.quad(b0, b1, t1, t0);
    else solid.quad(b1, b0, t0, t1);
  }

  // --- asphalt, kerbs, chequer ---
  solid.color = hexToRgb(pal.asphalt);
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    solid.quad(
      side(i, -TRACK_HALF_WIDTH),
      side(i + 1, -TRACK_HALF_WIDTH),
      side(i + 1, TRACK_HALF_WIDTH),
      side(i, TRACK_HALF_WIDTH),
    );
  }
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    if (track.curvature[i] < 9) continue;
    solid.color = Math.floor(i / 3) % 2 === 0 ? hexToRgb(pal.kerbA) : hexToRgb(pal.kerbB);
    const y = TRACK_SURFACE_Y + 0.0006;
    for (const sgn of [1, -1]) {
      const a0 = side(i, sgn * TRACK_HALF_WIDTH, y);
      const a1 = side(i, sgn * (TRACK_HALF_WIDTH + 0.006), y);
      const b0 = side(i + 1, sgn * TRACK_HALF_WIDTH, y);
      const b1 = side(i + 1, sgn * (TRACK_HALF_WIDTH + 0.006), y);
      if (sgn > 0) solid.quad(a0, b0, b1, a1);
      else solid.quad(a1, b1, b0, a0);
    }
  }
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 8; c++) {
      solid.color = (r + c) % 2 === 0 ? [1, 1, 1] : [0.03, 0.03, 0.03];
      const o0 = -TRACK_HALF_WIDTH + (c / 8) * TRACK_HALF_WIDTH * 2;
      const o1 = -TRACK_HALF_WIDTH + ((c + 1) / 8) * TRACK_HALF_WIDTH * 2;
      const y = TRACK_SURFACE_Y + 0.0008;
      solid.quad(side(r, o0, y), side(r + 1, o0, y), side(r + 1, o1, y), side(r, o1, y));
    }
  }

  // --- trackside: pits, grandstands (white with team-neutral roofs) ---
  const nearTrack = (x: number, z: number, r: number) => {
    for (let i = 0; i < TRACK_SAMPLES; i += 4) {
      const p = track.points[i];
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true;
    }
    return false;
  };
  // pit building: inside the loop, alongside the run up to the start line
  const pitI = TRACK_SAMPLES - 22;
  const pitT = track.tangents[pitI];
  const pitRot = Math.atan2(-pitT.z, pitT.x);
  const pitPos = side(pitI, -outward * 0.045, ISLAND_Y);
  solid.color = hexToRgb('#8794a6');
  solid.box(pitPos.x, ISLAND_Y, pitPos.z, 0.12, 0.016, 0.022, pitRot); // pit building
  solid.color = hexToRgb(pal.glow);
  solid.box(pitPos.x, ISLAND_Y + 0.016, pitPos.z, 0.12, 0.002, 0.022, pitRot);
  // grandstands around the outside, wherever the layout leaves room
  const standSpots: Array<[number, number, number, number]> = [
    [0.08, -0.205, 0.2, 0.0],
    [-0.22, -0.205, 0.14, 0.0],
    [0.555, 0.02, 0.1, Math.PI / 2],
    [-0.545, 0.0, 0.1, Math.PI / 2],
    [-0.3, 0.228, 0.12, 0],
    [0.1, 0.228, 0.14, 0],
  ];
  const stands = standSpots.filter(([x, z, len, rot]) => {
    const dx = Math.cos(rot) * len * 0.5;
    const dz = -Math.sin(rot) * len * 0.5;
    return !nearTrack(x, z, 0.04) && !nearTrack(x + dx, z + dz, 0.035) && !nearTrack(x - dx, z - dz, 0.035);
  });
  for (const [x, z, len, rot] of stands) {
    for (let k = 0; k < 3; k++) {
      solid.color = k === 2 ? hexToRgb('#d8dee8') : hexToRgb('#5a6677');
      const off = (k - 1) * 0.006;
      solid.box(x + Math.sin(rot) * off, ISLAND_Y, z + Math.cos(rot) * off, len, 0.006 + k * 0.004, 0.006, rot);
    }
  }
  // land under the outer grandstands
  solid.color = land;
  for (const [x, z, len, rot] of stands) solid.box(x, WATER_Y - 0.004, z, len + 0.02, ISLAND_Y - WATER_Y + 0.004, 0.03, rot, true);

  // --- trees inside the island ---
  const trees = new MeshBuilder();
  for (let n = 0; n < 300; n++) {
    const x = -0.52 + rnd() * 1.06;
    const z = -0.17 + rnd() * 0.37;
    if (!pointInPoly(x, z, pts) || nearTrack(x, z, 0.034)) continue;
    if (Math.hypot(x - pitPos.x, z - pitPos.z) < 0.07) continue; // pits
    const h = 0.012 + rnd() * 0.012;
    const g = 0.6 + rnd() * 0.4;
    trees.color = [pal.tree[0] * g, pal.tree[1] * g, pal.tree[2] * g];
    const r = 0.004 + rnd() * 0.003;
    // simple 4-sided cone
    const top = new Vector3(x, ISLAND_Y + h, z);
    const base = [0, 1, 2, 3].map((k) => new Vector3(x + Math.cos(k * 1.5708 + 0.4) * r, ISLAND_Y + 0.002, z + Math.sin(k * 1.5708 + 0.4) * r));
    for (let k = 0; k < 4; k++) trees.tri(base[(k + 1) % 4], base[k], top);
  }

  // --- north island: city blocks, a geodesic-style dome and a bridge ---
  solid.color = land;
  const nx = 0.02;
  const nz = -0.265;
  for (let k = 0; k < 9; k++) {
    const w = 0.12 - Math.abs(k - 4) * 0.008;
    solid.box(nx - 0.32 + k * 0.08, WATER_Y - 0.004, nz + Math.sin(k) * 0.008, 0.085, ISLAND_Y - WATER_Y, w * 0.6, 0);
  }
  for (let n = 0; n < 90; n++) {
    const x = nx - 0.33 + rnd() * 0.66;
    const z = nz - 0.025 + rnd() * 0.05;
    if (Math.hypot(x - 0.22, z - nz) < 0.05) continue;
    const h = 0.01 + rnd() * rnd() * 0.08;
    const g = 0.06 + rnd() * 0.07;
    solid.color = [g * 0.8, g * 0.9, g * 1.3];
    solid.box(x, ISLAND_Y, z, 0.014 + rnd() * 0.016, h, 0.014 + rnd() * 0.016, rnd() * 0.5);
  }
  // bridge to the main island (only where it doesn't land on the track)
  if (!nearTrack(-0.2, -0.165, 0.045)) {
    solid.color = hexToRgb('#9aa6b6');
    solid.box(-0.2, ISLAND_Y, -0.2, 0.014, 0.003, 0.11);
    solid.box(-0.207, ISLAND_Y, -0.2, 0.002, 0.008, 0.11);
    solid.box(-0.193, ISLAND_Y, -0.2, 0.002, 0.008, 0.11);
  }

  // moored yachts in a marina east of the hairpin
  solid.color = [0.85, 0.87, 0.9];
  for (let n = 0; n < 10; n++) {
    solid.box(0.6 + (n % 5) * 0.03, WATER_Y, -0.12 + Math.floor(n / 5) * 0.05, 0.01, 0.005, 0.028, 0.05);
  }

  const solidMesh = new Mesh(solid.build(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }));
  solidMesh.name = 'board-solid';
  root.add(solidMesh);
  const treeMesh = new Mesh(trees.build(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  treeMesh.name = 'trees';
  root.add(treeMesh);

  // geodesic-style dome (wireframe glow) on the north island
  const dome = new MeshBuilder();
  dome.color = hexToRgb(pal.glow);
  const R = 0.04;
  const rings = 5;
  const segs = 14;
  const P = (ri: number, si: number) => {
    const phi = (ri / rings) * (Math.PI / 2);
    const th = (si / segs) * Math.PI * 2;
    return new Vector3(0.22 + Math.cos(th) * Math.cos(phi) * R, ISLAND_Y + Math.sin(phi) * R, nz + Math.sin(th) * Math.cos(phi) * R);
  };
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segs; si++) {
      // thin struts as skinny quads
      const a = P(ri, si);
      const b = P(ri, si + 1);
      const c = P(ri + 1, si);
      const w = new Vector3(0, 0.0007, 0);
      dome.quad(a, b, b.clone().add(w), a.clone().add(w));
      dome.quad(a, c, c.clone().add(w), a.clone().add(w));
    }
  }
  const domeMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, side: DoubleSide, blending: AdditiveBlending, depthWrite: false });
  const domeMesh = new Mesh(dome.build(), domeMat);
  domeMesh.name = 'dome';
  root.add(domeMesh);

  // --- glowing track edges ---
  const glow = new MeshBuilder();
  glow.color = hexToRgb(pal.glow);
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const y = TRACK_SURFACE_Y + 0.0012;
    for (const sgn of [1, -1]) {
      const o0 = sgn * (TRACK_HALF_WIDTH + 0.0005);
      const o1 = sgn * (TRACK_HALF_WIDTH + 0.0025);
      if (sgn > 0) glow.quad(side(i, o0, y), side(i + 1, o0, y), side(i + 1, o1, y), side(i, o1, y));
      else glow.quad(side(i, o1, y), side(i + 1, o1, y), side(i + 1, o0, y), side(i, o0, y));
    }
  }
  const glowMesh = new Mesh(
    glow.build(),
    new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
  );
  glowMesh.name = 'board-glow';
  root.add(glowMesh);

  return root;
}

