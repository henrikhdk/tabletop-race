import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from '@iwsdk/core';
import { hexToRgb, MeshBuilder } from '../race/mesh-builder.js';
import { sampleTrack, TRACK_HALF_WIDTH, TRACK_SAMPLES, TRACK_SURFACE_Y } from '../race/track.js';

/**
 * The tabletop diorama of the fictional "Porto Lumen" street circuit.
 * Origin = centre of the board's underside, so it sits on a table top.
 */
export const BOARD_W = 1.1;
export const BOARD_D = 0.66;
const BASE_H = 0.026;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function createRaceBoard(): Group {
  const root = new Group();
  root.name = 'race-board';
  const track = sampleTrack();
  const up = new Vector3(0, 1, 0);
  const side = (i: number, off: number, y = TRACK_SURFACE_Y) => {
    const p = track.points[i];
    const t = track.tangents[i];
    const n = new Vector3().crossVectors(up, t).normalize(); // left of travel
    return new Vector3(p.x + n.x * off, y, p.z + n.z * off);
  };

  // ---- solid, lit parts (vertex coloured) -------------------------------
  const solid = new MeshBuilder();
  const rnd = seeded(42);

  // base slab with a bevelled teal rim
  solid.color = hexToRgb('#1d2633');
  solid.box(0, 0, 0, BOARD_W, BASE_H, BOARD_D);
  solid.color = hexToRgb('#2bd9a8');
  solid.box(0, BASE_H, BOARD_D / 2 - 0.006, BOARD_W, 0.006, 0.012);
  solid.box(0, BASE_H, -BOARD_D / 2 + 0.006, BOARD_W, 0.006, 0.012);
  solid.box(BOARD_W / 2 - 0.006, BASE_H, 0, 0.012, 0.006, BOARD_D);
  solid.box(-BOARD_W / 2 + 0.006, BASE_H, 0, 0.012, 0.006, BOARD_D);

  // ground plate (city blocks colour)
  solid.color = hexToRgb('#2a3442');
  solid.box(0, BASE_H, 0, BOARD_W - 0.024, 0.002, BOARD_D - 0.024);

  // harbour water inside the loop (darker blue)
  solid.color = hexToRgb('#123a5c');
  solid.box(0.05, BASE_H + 0.002, 0.0, 0.42, 0.001, 0.22);

  // track asphalt ribbon
  solid.color = hexToRgb('#3a3f48');
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const a0 = side(i, TRACK_HALF_WIDTH);
    const a1 = side(i, -TRACK_HALF_WIDTH);
    const b0 = side(i + 1, TRACK_HALF_WIDTH);
    const b1 = side(i + 1, -TRACK_HALF_WIDTH);
    solid.quad(a1, b1, b0, a0);
  }
  // kerbs on the corners: alternating red/white on both edges
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    if (track.curvature[i] < 9) continue;
    solid.color = Math.floor(i / 3) % 2 === 0 ? hexToRgb('#e8333b') : hexToRgb('#f2f2f2');
    for (const sgn of [1, -1]) {
      const y = TRACK_SURFACE_Y + 0.0006;
      const a0 = side(i, sgn * TRACK_HALF_WIDTH, y);
      const a1 = side(i, sgn * (TRACK_HALF_WIDTH + 0.006), y);
      const b0 = side(i + 1, sgn * TRACK_HALF_WIDTH, y);
      const b1 = side(i + 1, sgn * (TRACK_HALF_WIDTH + 0.006), y);
      if (sgn > 0) solid.quad(a0, b0, b1, a1);
      else solid.quad(a1, b1, b0, a0);
    }
  }
  // start/finish chequer
  {
    const i0 = 0;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 8; c++) {
        solid.color = (r + c) % 2 === 0 ? [1, 1, 1] : [0.05, 0.05, 0.05];
        const o0 = -TRACK_HALF_WIDTH + (c / 8) * TRACK_HALF_WIDTH * 2;
        const o1 = -TRACK_HALF_WIDTH + ((c + 1) / 8) * TRACK_HALF_WIDTH * 2;
        const y = TRACK_SURFACE_Y + 0.0008;
        const a0 = side(i0 + r, o0, y);
        const a1 = side(i0 + r, o1, y);
        const b0 = side(i0 + r + 1, o0, y);
        const b1 = side(i0 + r + 1, o1, y);
        solid.quad(a0, b0, b1, a1);
      }
    }
  }

  // pit building + grandstands along the main straight (front)
  solid.color = hexToRgb('#7d8a9c');
  solid.box(-0.08, BASE_H, 0.27, 0.34, 0.03, 0.03);
  solid.color = hexToRgb('#4c5869');
  for (let k = 0; k < 5; k++) {
    solid.box(-0.35 + k * 0.13, BASE_H, -0.3, 0.11, 0.022 + (k % 2) * 0.008, 0.03);
  }
  // city blocks: deterministic random towers away from the track
  for (let n = 0; n < 140; n++) {
    const x = (rnd() - 0.5) * (BOARD_W - 0.08);
    const z = (rnd() - 0.5) * (BOARD_D - 0.08);
    let near = false;
    for (let i = 0; i < TRACK_SAMPLES; i += 6) {
      const p = track.points[i];
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < 0.045 ** 2) {
        near = true;
        break;
      }
    }
    if (near) continue;
    if (x > -0.17 && x < 0.27 && z > -0.11 && z < 0.11) continue; // water
    const h = 0.01 + rnd() * rnd() * 0.07;
    const g = 0.05 + rnd() * 0.07;
    solid.color = [g * 0.8, g * 0.9, g * 1.25];
    solid.box(x, BASE_H, z, 0.018 + rnd() * 0.02, h, 0.018 + rnd() * 0.02, rnd() * 0.5);
  }
  // little yachts in the harbour
  solid.color = [0.85, 0.87, 0.9];
  for (let n = 0; n < 14; n++) {
    const x = -0.13 + (n % 7) * 0.055;
    const z = -0.06 + Math.floor(n / 7) * 0.11 + (rnd() - 0.5) * 0.02;
    solid.box(x, BASE_H + 0.002, z, 0.03, 0.006, 0.01, (rnd() - 0.5) * 0.3);
  }

  const solidMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
  const solidMesh = new Mesh(solid.build(), solidMat);
  solidMesh.name = 'board-solid';
  solidMesh.receiveShadow = true;
  root.add(solidMesh);

  // ---- glowing track edges (unlit, additive) ----------------------------
  const glow = new MeshBuilder();
  glow.color = hexToRgb('#38f5ff');
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const y = TRACK_SURFACE_Y + 0.0012;
    for (const sgn of [1, -1]) {
      const o0 = sgn * (TRACK_HALF_WIDTH + 0.0005);
      const o1 = sgn * (TRACK_HALF_WIDTH + 0.0025);
      const a0 = side(i, o0, y);
      const a1 = side(i, o1, y);
      const b0 = side(i + 1, o0, y);
      const b1 = side(i + 1, o1, y);
      if (sgn > 0) glow.quad(a0, b0, b1, a1);
      else glow.quad(a1, b1, b0, a0);
    }
  }
  const glowMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glowMesh = new Mesh(glow.build(), glowMat);
  glowMesh.name = 'board-glow';
  root.add(glowMesh);

  return root;
}
