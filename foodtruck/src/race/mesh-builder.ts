import { BufferGeometry, Float32BufferAttribute, Vector3 } from '@iwsdk/core';

/** Accumulates flat-shaded triangles into one geometry (one draw call per material). */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private a = new Vector3();
  private b = new Vector3();
  private n = new Vector3();
  color: [number, number, number] = [1, 1, 1];

  tri(p0: Vector3, p1: Vector3, p2: Vector3) {
    this.a.subVectors(p1, p0);
    this.b.subVectors(p2, p0);
    this.n.crossVectors(this.a, this.b).normalize();
    for (const p of [p0, p1, p2]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(this.n.x, this.n.y, this.n.z);
      this.col.push(...this.color);
    }
  }

  /** quad p0,p1,p2,p3 counter-clockwise when seen from the front */
  quad(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3) {
    this.tri(p0, p1, p2);
    this.tri(p0, p2, p3);
  }

  /** axis-aligned box (rotated by angle around Y) with min-y base at y0 */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, rotY = 0, top = true) {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const P = (x: number, y: number, z: number) =>
      new Vector3(cx + x * c + z * s, y0 + y, cz - x * s + z * c);
    const hx = sx / 2;
    const hz = sz / 2;
    const v = [
      P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz),
      P(-hx, sy, -hz), P(hx, sy, -hz), P(hx, sy, hz), P(-hx, sy, hz),
    ];
    if (top) this.quad(v[7], v[6], v[5], v[4]);
    this.quad(v[3], v[2], v[6], v[7]); // front +z
    this.quad(v[1], v[0], v[4], v[5]); // back -z
    this.quad(v[2], v[1], v[5], v[6]); // right +x
    this.quad(v[0], v[3], v[7], v[4]); // left -x
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  // vertex colours are linear: convert from sRGB hex
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
}
