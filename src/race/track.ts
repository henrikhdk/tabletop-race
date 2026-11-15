import { CatmullRomCurve3, Vector3 } from '@iwsdk/core';

/**
 * "Ile Lumiere" — a fictional island street circuit whose flow is inspired by
 * classic island-park circuits: a short pit straight into a left/right S,
 * flowing esses along the south shore, a tight hairpin at the far end, a long
 * back straight and a quick final chicane before the line.
 * Board-local coordinates in meters: X right, Z towards the viewer, Y up.
 */
const CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-0.3, -0.1], // start / finish
  [-0.4, -0.095],
  [-0.47, -0.055], // T1 left
  [-0.445, 0.0], // T2 right
  [-0.48, 0.055],
  [-0.42, 0.105], // T3/T4
  [-0.3, 0.115],
  [-0.18, 0.085], // kink
  [-0.06, 0.12], // T6/T7
  [0.05, 0.085],
  [0.16, 0.115], // T8/T9
  [0.23, 0.075],
  [0.34, 0.095],
  [0.44, 0.075],
  [0.495, 0.02], // hairpin
  [0.465, -0.035],
  [0.38, -0.055],
  [0.15, -0.09], // back straight
  [-0.1, -0.125],
  [-0.165, -0.125], // final chicane
  [-0.195, -0.095],
  [-0.235, -0.115],
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
