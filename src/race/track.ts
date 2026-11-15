import { CatmullRomCurve3, Vector3 } from '@iwsdk/core';

/**
 * The circuit "Porto Lumen" — an original fictional street circuit.
 * Board-local coordinates in meters: X right, Z towards the viewer, Y up.
 * The board is ~1.10 m wide and ~0.66 m deep and sits on a real table.
 */
const CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-0.38, 0.2], // start/finish straight (front)
  [-0.05, 0.22],
  [0.28, 0.22],
  [0.43, 0.16], // T1 sweeping right
  [0.47, 0.02],
  [0.4, -0.08],
  [0.28, -0.06], // T3 hairpin entry
  [0.2, -0.12],
  [0.27, -0.21],
  [0.4, -0.24], // back section
  [0.42, -0.27],
  [0.25, -0.28],
  [0.02, -0.26],
  [-0.12, -0.18], // chicane
  [-0.2, -0.24],
  [-0.34, -0.25],
  [-0.46, -0.18], // final hairpin
  [-0.49, -0.04],
  [-0.46, 0.1],
];

export const TRACK_HALF_WIDTH = 0.022;
export const TRACK_SURFACE_Y = 0.032;

export function createTrackCurve(): CatmullRomCurve3 {
  const pts = CONTROL_POINTS.map(([x, z]) => new Vector3(x, TRACK_SURFACE_Y, z));
  return new CatmullRomCurve3(pts, true, 'centripetal', 0.5);
}

export interface TrackSample {
  /** positions along the centreline, length SAMPLES+1 (closed, last = first) */
  points: Vector3[];
  tangents: Vector3[];
  /** curvature (1/m) per sample, smoothed */
  curvature: Float32Array;
  /** cumulative distance per sample */
  distance: Float32Array;
  length: number;
}

export const TRACK_SAMPLES = 600;

export function sampleTrack(curve = createTrackCurve()): TrackSample {
  const points = curve.getSpacedPoints(TRACK_SAMPLES);
  const tangents: Vector3[] = [];
  const distance = new Float32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const a = points[(i - 1 + TRACK_SAMPLES) % TRACK_SAMPLES];
    const b = points[(i + 1) % TRACK_SAMPLES];
    tangents.push(new Vector3().subVectors(b, a).normalize());
    if (i > 0) distance[i] = distance[i - 1] + points[i].distanceTo(points[i - 1]);
  }
  const raw = new Float32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const t0 = tangents[(i - 2 + TRACK_SAMPLES) % TRACK_SAMPLES];
    const t1 = tangents[(i + 2) % TRACK_SAMPLES];
    const ds = 4 * (curve.getLength() / TRACK_SAMPLES);
    raw[i] = t0.angleTo(t1) / ds;
  }
  // Smooth curvature over a window so cars brake before corners.
  const curvature = new Float32Array(points.length);
  const W = 14;
  for (let i = 0; i < points.length; i++) {
    let m = 0;
    for (let k = -W; k <= W; k++) {
      m = Math.max(m, raw[(i + k + TRACK_SAMPLES * 2) % TRACK_SAMPLES] * (1 - Math.abs(k) / (W + 1)));
    }
    curvature[i] = m;
  }
  return { points, tangents, curvature, distance, length: distance[points.length - 1] };
}
