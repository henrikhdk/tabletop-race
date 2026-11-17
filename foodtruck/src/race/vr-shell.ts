import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';

/**
 * A full VR surround (night sky, stars, neon floor grid) that wraps the player
 * inside the AR session. The experience opens fully virtual; when the race
 * begins the sphere burns away with a noisy, glowing edge, starting where the
 * table is and spreading around and behind the player, revealing passthrough.
 *
 * It is one opaque inside-out sphere drawn first (no depth writes), so the
 * board, panels and hands always draw over it. Once fully dissolved it is
 * hidden and costs nothing.
 */
const VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform float uT;      // 0 = solid VR, 1 = fully dissolved
uniform vec3 uCenter;  // sphere centre (the head)
uniform vec3 uFocus;   // unit direction from the head to the table
uniform float uTime;
varying vec3 vW;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  vec3 d = normalize(vW - uCenter);

  // dissolve: opens at the table first, then sweeps around the player
  float ang = acos(clamp(dot(d, uFocus), -1.0, 1.0)) / 3.14159;
  float k = ang * 0.72 + (noise(d * 7.0) * 0.6 + noise(d * 23.0) * 0.4) * 0.28;
  float edge = uT * 1.12 - 0.06;
  if (k < edge) discard;
  float rim = (1.0 - smoothstep(0.0, 0.045, k - edge)) * step(0.001, uT);

  vec3 col;
  if (d.y < -0.015) {
    // floor at y = 0 with a neon grid that fades into the dark
    float t = uCenter.y / -d.y;
    vec2 h = uCenter.xz + d.xz * t;
    vec2 g = abs(fract(h * 2.0) - 0.5);
    float w = 0.012 + t * 0.006;
    float line = 1.0 - smoothstep(0.0, w, min(g.x, g.y));
    float fade = exp(-t * 0.22);
    float haze = 1.0 - exp(-t * 0.06);
    float pool = exp(-dot(h, h) * 0.08);
    col = vec3(0.006, 0.004, 0.014) + vec3(0.05, 0.015, 0.08) * pool;
    col += line * fade * 0.55 * mix(vec3(0.7, 0.25, 1.0), vec3(0.2, 0.95, 1.0), 0.5 + 0.5 * sin(h.x * 0.7 + uTime * 0.4));
    col = mix(col, vec3(0.05, 0.01, 0.045), haze * 0.8);
  } else {
    // night sky: purple horizon, near-black zenith, a neon band and stars
    float up = clamp(d.y, 0.0, 1.0);
    col = mix(vec3(0.06, 0.012, 0.09), vec3(0.002, 0.001, 0.006), pow(up, 0.4));
    col += vec3(1.0, 0.25, 0.65) * exp(-up * 38.0) * 0.4;
    vec3 sp = floor(d * 260.0);
    float s = hash(sp);
    if (s > 0.993) col += vec3(0.9, 0.9, 1.0) * (0.5 + 0.5 * sin(uTime * 2.0 + s * 60.0)) * smoothstep(0.02, 0.25, up);
  }
  // molten-cheese edge as it burns away
  col = mix(col, vec3(1.0, 0.72, 0.18) * 2.2, rim);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class VrShell {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  /** dissolve progress, 0 solid .. 1 gone */
  private t = 0;
  private target = 0;
  private speed = 1;
  private clock = 0;

  constructor(radius = 9) {
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uT: { value: 0 },
        uCenter: { value: new Vector3() },
        uFocus: { value: new Vector3(0, -0.3, -1).normalize() },
        uTime: { value: 0 },
      },
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 48, 24), this.mat);
    this.mesh.name = 'vr-shell';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** burn the VR away to passthrough */
  reveal(seconds = 2.8) {
    this.target = 1;
    this.speed = 1 / seconds;
  }

  /** close the VR back around the player */
  cover(seconds = 1.4) {
    this.target = 0;
    this.speed = 1 / seconds;
  }

  /** start already in passthrough (no VR opening) */
  skip() {
    this.t = this.target = 1;
  }

  get revealing(): boolean {
    return this.target === 1;
  }

  update(delta: number, immersive: boolean, head: Vector3, focus: Vector3) {
    if (this.t < this.target) this.t = Math.min(this.target, this.t + delta * this.speed);
    else if (this.t > this.target) this.t = Math.max(this.target, this.t - delta * this.speed);
    this.clock += delta;
    const show = immersive && this.t < 1;
    this.mesh.visible = show;
    if (!show) return;
    const u = this.mat.uniforms;
    // ease so the burn starts slow and finishes quickly
    u.uT.value = this.t * this.t * (3 - 2 * this.t);
    u.uTime.value = this.clock;
    this.mesh.position.copy(head);
    (u.uCenter.value as Vector3).copy(head);
    const f = u.uFocus.value as Vector3;
    f.copy(focus).sub(head);
    if (f.lengthSq() > 1e-6) f.normalize();
  }
}
