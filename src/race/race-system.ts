import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  createSystem,
  DoubleSide,
  Entity,
  Group,
  Hovered,
  Mesh,
  Object3D,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Pressed,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
  XRPlane,
  WebGLRenderTarget,
} from '@iwsdk/core';
import { CanvasPanel, roundRect } from './canvas-panel.js';
import { hexToRgb, MeshBuilder } from './mesh-builder.js';

const TRAIL_SEGMENTS = 24;
import { CarMarker, RaceBoard, UiButton } from './race-components.js';
import { CarState, formatTime, RacePhase, RaceSim, TEAMS } from './race-sim.js';
import { sampleTrack, TrackSample, TRACK_SURFACE_Y } from './track.js';
import { RaceAudio } from './race-audio.js';
import { easeInOut, easeOutBack, easeOutCubic, introState, win } from './intro-state.js';
import { loadProfile, Profile, saveProfile, scorePrediction } from './profile.js';

const BUTTONS = [
  { id: 'start', label: 'START', x: 24 },
  { id: 'restart', label: 'NEW RACE', x: 270 },
  { id: 'speed', label: 'SPEED 1x', x: 516 },
  { id: 'onboard', label: 'ONBOARD', x: 762 },
  { id: 'place', label: 'PLACE', x: 1008 },
] as const;
const BTN_Y = 92;
const BTN_W = 230;
const BTN_H = 96;

function buildCarGeometry() {
  const b = new MeshBuilder();
  b.color = [1, 1, 1];
  // chassis + nose (car points to +z)
  b.box(0, 0.0015, 0, 0.0055, 0.0032, 0.016);
  b.box(0, 0.0015, 0.011, 0.0028, 0.0024, 0.009);
  // front + rear wings
  b.box(0, 0.0012, 0.0155, 0.0105, 0.0011, 0.0028);
  b.box(0, 0.0042, -0.0085, 0.0095, 0.0012, 0.0032);
  // cockpit halo (dark)
  b.color = [0.12, 0.12, 0.14];
  b.box(0, 0.0047, 0.001, 0.003, 0.0016, 0.005);
  // wheels
  for (const [x, z] of [
    [0.0052, 0.0075],
    [-0.0052, 0.0075],
    [0.0054, -0.006],
    [-0.0054, -0.006],
  ]) {
    b.box(x, 0, z, 0.0028, 0.0042, 0.0046);
  }
  return b.build();
}

export class RaceSystem extends createSystem({
  boards: { required: [RaceBoard] },
  cars: { required: [CarMarker] },
  carPressed: { required: [CarMarker, Pressed] },
  buttons: { required: [UiButton] },
  buttonPressed: { required: [UiButton, Pressed] },
  buttonHovered: { required: [UiButton, Hovered] },
  planes: { required: [XRPlane] },
}) {
  // --- table anchoring (mixed reality) ---
  private placement: 'authored' | 'table' | 'front' = 'authored';
  private xrTime = 0;
  private autoPlaced = false;
  private boxMin = new Vector3();
  private boxMax = new Vector3();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpTry = new Vector3();

  private track!: TrackSample;
  private sim!: RaceSim;
  private board?: Entity;
  private carRoots: Group[] = [];
  private carRings: Mesh[] = [];
  private trails: { pos: Float32Array; col: Float32Array; geo: BufferGeometry; rgb: [number, number, number] }[] = [];
  private trailPos = new Vector3();
  private trailTan = new Vector3();
  private trailNor = new Vector3();
  private pickMarker!: Mesh;
  private timeScale = 1;
  private profile!: Profile;
  private prediction = -1;
  private followed = -1;
  private lastScore: { points: number; text: string } | null = null;
  private onboardOn = true;
  private audio = new RaceAudio();
  private lastLit = 0;

  private leaderboard!: CanvasPanel;
  private controls!: CanvasPanel;
  private pip!: CanvasPanel;
  private pipFrame!: Mesh;
  private pipTarget!: WebGLRenderTarget;
  private pipCamera!: PerspectiveCamera;
  private pipBg = new Color('#0b1220');
  private flatBg = new Color('#0d1420');
  private lights: Mesh[] = [];
  private lightOn!: MeshBasicMaterial;
  private lightOff!: MeshBasicMaterial;

  private uiTimer = 0;
  private frame = 0;
  // --- opening sequence ---
  private gantry?: Group;
  private introActive = false;
  private introT = 0;
  private introLanded = 0;
  private introCued = { swell: false, chime: false };
  private autostartPending = 0;
  private intro!: {
    water?: Object3D;
    land: Object3D[];
    trees?: Object3D;
    dome?: Mesh;
    glow?: Mesh;
    glowCount: number;
    ring: Mesh;
    title: CanvasPanel;
  };
  private fpsPanel?: CanvasPanel;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fpsWorst = 0;
  private hoveredAction = '';
  private tmpPos = new Vector3();
  private tmpLook = new Vector3();
  private tmpSide = new Vector3();
  private up = new Vector3(0, 1, 0);

  init(): void {
    this.track = sampleTrack();
    this.profile = loadProfile();
    this.queries.boards.subscribe('qualify', (e) => this.setupBoard(e));
    for (const e of this.queries.boards.entities) this.setupBoard(e);

    this.cleanupFuncs.push(
      this.queries.carPressed.subscribe('qualify', (e) => {
        this.onCarPinched(e.getValue(CarMarker, 'index') ?? 0);
      }),
      this.queries.buttonPressed.subscribe('qualify', (e) => {
        this.onButton(e.getValue(UiButton, 'action') ?? '');
      }),
      this.queries.buttonHovered.subscribe('qualify', (e) => {
        this.hoveredAction = e.getValue(UiButton, 'action') ?? '';
        this.drawControls();
      }),
      this.queries.buttonHovered.subscribe('disqualify', () => {
        this.hoveredAction = '';
        this.drawControls();
      }),
    );
  }

  private setupBoard(boardEntity: Entity) {
    if (this.board) return;
    this.board = boardEntity;
    const laps = boardEntity.getValue(RaceBoard, 'laps') ?? 8;
    this.sim = new RaceSim(this.track, Date.now() % 100000, laps);

    // ---- cars --------------------------------------------------------
    const carGeo = buildCarGeometry();
    const ringGeo = new RingGeometry(0.009, 0.0125, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const haloGeo = new SphereGeometry(0.0035, 10, 8);
    const hitGeo = new SphereGeometry(0.02, 8, 6);
    const hitMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

    for (const car of this.sim.cars) {
      const team = TEAMS[car.driver.team];
      const root = new Group();
      root.name = `car-${car.driver.code}`;
      const bodyMat = new MeshStandardMaterial({ color: team.color, roughness: 0.4, metalness: 0.3, vertexColors: true });
      const body = new Mesh(carGeo, bodyMat);
      body.name = 'body';
      root.add(body);
      const glowMat = new MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
      const halo = new Mesh(haloGeo, glowMat);
      halo.position.set(0, 0.016, 0);
      root.add(halo);
      const ring = new Mesh(ringGeo, glowMat.clone());
      ring.position.y = 0.0008;
      ring.visible = false;
      root.add(ring);
      this.carRings.push(ring);
      const hit = new Mesh(hitGeo, hitMat);
      hit.position.y = 0.008;
      root.add(hit);
      const entity = this.world.createTransformEntity(root, boardEntity);
      entity.addComponent(CarMarker, { index: car.index });
      entity.addComponent(RayInteractable);
      this.carRoots.push(root);
    }

    // light trails behind every car (one small dynamic strip each)
    const N = TRAIL_SEGMENTS;
    const index: number[] = [];
    for (let k = 0; k < N; k++) {
      const a = k * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const trailMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    for (const car of this.sim.cars) {
      const geo = new BufferGeometry();
      const pos = new Float32Array((N + 1) * 2 * 3);
      const col = new Float32Array((N + 1) * 2 * 3);
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      geo.setIndex(index);
      const mesh = new Mesh(geo, trailMat);
      mesh.name = `trail-${car.driver.code}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.world.createTransformEntity(mesh, boardEntity);
      this.trails.push({ pos, col, geo, rgb: hexToRgb(TEAMS[car.driver.team].color) });
    }

    // marker floating over the car you predicted
    const pick = new Mesh(
      new SphereGeometry(0.005, 12, 8),
      new MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }),
    );
    pick.scale.set(1, 1.8, 1);
    pick.visible = false;
    this.pickMarker = pick;
    this.world.createTransformEntity(pick, boardEntity);

    // ---- start lights gantry over the grid ----------------------------
    const start = this.track.points[0];
    const tan = this.track.tangents[0];
    const side = new Vector3().crossVectors(this.up, tan).normalize();
    const gantry = new Group();
    gantry.position.set(start.x + tan.x * 0.01, TRACK_SURFACE_Y + 0.05, start.z + tan.z * 0.01);
    const beam = new Mesh(new BoxGeometry(0.006, 0.008, 0.075), new MeshStandardMaterial({ color: '#20262f' }));
    beam.lookAt(this.tmpLook.copy(side).add(beam.position));
    gantry.add(beam);
    this.lightOff = new MeshBasicMaterial({ color: '#3a0d10' });
    this.lightOn = new MeshBasicMaterial({ color: '#ff2433' });
    const lg = new SphereGeometry(0.0035, 10, 8);
    for (let i = 0; i < 5; i++) {
      const l = new Mesh(lg, this.lightOff);
      const o = (i - 2) * 0.013;
      l.position.set(side.x * o, 0, side.z * o);
      gantry.add(l);
      this.lights.push(l);
    }
    for (const s of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.003, 0.05, 0.003), beam.material);
      post.position.set(side.x * 0.038 * s, -0.025, side.z * 0.038 * s);
      gantry.add(post);
    }
    this.world.createTransformEntity(gantry, boardEntity);
    this.gantry = gantry;

    // ---- leaderboard (right of the board, angled to the viewer) -------
    this.leaderboard = new CanvasPanel(512, 860, 0.25, 'leaderboard');
    this.leaderboard.mesh.position.set(0.71, 0.03 + this.leaderboard.height / 2 + 0.01, -0.06);
    this.leaderboard.mesh.rotation.y = -0.45;
    this.world.createTransformEntity(this.leaderboard.mesh, boardEntity);

    // ---- control strip (front edge, tilted up to the viewer) ----------
    this.controls = new CanvasPanel(1262, 210, 0.56, 'controls');
    this.controls.mesh.position.set(0, 0.045, 0.39);
    this.controls.mesh.rotation.x = -0.9;
    const controlsEntity = this.world.createTransformEntity(this.controls.mesh, boardEntity);
    const btnMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    for (const b of BUTTONS) {
      const r = this.controls.rectToLocal(b.x, BTN_Y, BTN_W, BTN_H);
      const hit = new Mesh(new BoxGeometry(r.w, r.h, 0.01), btnMat);
      hit.name = `btn-${b.id}`;
      hit.position.set(r.cx, r.cy, 0.004);
      const e = this.world.createTransformEntity(hit, controlsEntity);
      e.addComponent(UiButton, { action: b.id });
      e.addComponent(RayInteractable);
    }

    // ---- onboard picture-in-picture (behind the board) ----------------
    this.pipTarget = new WebGLRenderTarget(384, 216);
    this.pipTarget.texture.colorSpace = SRGBColorSpace;
    this.pipCamera = new PerspectiveCamera(75, 384 / 216, 0.002, 5);
    this.pip = new CanvasPanel(768, 520, 0.3, 'onboard-frame');
    this.pip.mesh.position.set(-0.05, 0.03 + 0.2, -0.4);
    this.pip.mesh.rotation.x = 0.12;
    const pipEntity = this.world.createTransformEntity(this.pip.mesh, boardEntity);
    const screenW = 0.3 * (720 / 768);
    this.pipFrame = new Mesh(
      new PlaneGeometry(screenW, (screenW * 216) / 384),
      new MeshBasicMaterial({ map: this.pipTarget.texture, depthWrite: false }),
    );
    this.pipFrame.name = 'onboard-screen';
    this.pipFrame.position.set(0, -0.013, 0.001);
    this.pipFrame.renderOrder = 11;
    this.world.createTransformEntity(this.pipFrame, pipEntity);

    this.followed = this.sim.order[0].index;
    // ?fps : small performance HUD next to the timing tower
    if (new URLSearchParams(location.search).has('fps')) {
      this.fpsPanel = new CanvasPanel(400, 150, 0.12, 'fps-hud');
      this.fpsPanel.mesh.position.set(-0.36, 0.05, 0.38);
      this.fpsPanel.mesh.rotation.set(-0.9, 0.25, 0, 'YXZ');
      this.world.createTransformEntity(this.fpsPanel.mesh, boardEntity);
    }
    // ?autostart&speed=4 : start immediately (handy for demo capture on desktop)
    const q = new URLSearchParams(location.search);
    if (q.has('autostart')) this.autostartPending = Math.max(1, Math.min(8, Number(q.get('speed')) || 1));
    this.setupIntro(boardEntity);
    this.startIntro();
    this.placeCars();
    this.drawControls();
    this.drawLeaderboard();
    this.drawPip();
  }

  // ---------------------------------------------------------------------
  private onCarPinched(index: number) {
    if (!this.sim) return;
    this.audio.unlock();
    this.audio.beep(this.sim.phase === RacePhase.Grid ? 880 : 660, 0.12, 0.12);
    if (this.sim.phase === RacePhase.Grid) {
      this.prediction = index;
    }
    this.followed = index;
    this.onboardOn = true;
    this.drawAll();
  }

  private onButton(action: string) {
    if (!this.sim) return;
    this.audio.unlock();
    this.audio.click();
    switch (action) {
      case 'start':
        if (this.sim.phase === RacePhase.Grid) this.sim.startLights();
        else if (this.timeScale === 0) this.timeScale = 1;
        else if (this.sim.phase === RacePhase.Racing) this.timeScale = 0;
        break;
      case 'restart':
        this.sim.reset();
        this.prediction = -1;
        this.lastScore = null;
        this.timeScale = 1;
        this.followed = this.sim.order[0].index;
        break;
      case 'speed':
        this.timeScale = this.timeScale >= 4 ? 1 : this.timeScale * 2;
        break;
      case 'onboard':
        this.onboardOn = !this.onboardOn;
        break;
      case 'place':
        if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
          if (this.placement === 'table' || !this.placeOnTable()) this.placeInFront();
        }
        this.startIntro();
        break;
    }
    this.drawAll();
  }

  private drawAll() {
    this.drawControls();
    this.drawLeaderboard();
    this.drawPip();
  }

  // ---------------------------------------------------------------------
  update(delta: number): void {
    if (!this.sim || !this.board) return;
    // dark studio backdrop on flat screens; passthrough (no background) in XR
    const vis = this.world.visibilityState.peek();
    this.world.scene.background = vis === VisibilityState.NonImmersive ? this.flatBg : null;
    if (vis === VisibilityState.NonImmersive) {
      this.xrTime = 0;
      this.autoPlaced = false;
    } else if (!this.autoPlaced) {
      // give plane detection a moment, then snap to the real table (or float in front)
      this.xrTime += delta;
      if (this.xrTime > 1.2 && this.placeOnTable()) {
        this.autoPlaced = true;
        this.startIntro();
      } else if (this.xrTime > 4) {
        this.placeInFront();
        this.autoPlaced = true;
        this.startIntro();
      }
    }
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, 0.05);
    const prevPhase = this.sim.phase;
    // sub-step so fast-forward stays stable
    const steps = Math.max(1, Math.ceil(this.timeScale));
    for (let i = 0; i < steps; i++) this.sim.step((dt * this.timeScale) / steps);

    if (prevPhase !== RacePhase.Finished && this.sim.phase === RacePhase.Finished) this.onRaceFinished();
    if (prevPhase !== this.sim.phase) this.drawControls();

    if (this.introActive) this.introT += delta;
    this.placeCars();
    const lit = this.sim.lightsOn;
    for (let i = 0; i < 5; i++) this.lights[i].material = i < lit ? this.lightOn : this.lightOff;
    if (lit !== this.lastLit) {
      if (lit > this.lastLit) this.audio.beep(440, 0.25, 0.2);
      this.lastLit = lit;
    }
    if (prevPhase === RacePhase.Lights && this.sim.phase === RacePhase.Racing) this.audio.beep(880, 0.5, 0.25);
    const fc = this.followed >= 0 ? this.sim.cars[this.followed] : undefined;
    const racing = this.sim.phase === RacePhase.Racing && this.timeScale > 0;
    this.audio.engine(fc ? Math.min(1, fc.speed / 0.24) : 0, racing ? 1 : 0);

    this.uiTimer += delta;
    if (this.uiTimer > 0.25) {
      this.uiTimer = 0;
      this.drawLeaderboard();
      this.drawPip();
    }
    this.frame++;
    if (this.fpsPanel) this.updateFps(delta);
    if (this.onboardOn && this.followed >= 0 && (this.frame & 1) === 0) this.renderOnboard();
  }

  private placeCars() {
    const n = this.track.points.length - 1;
    for (const car of this.sim.cars) {
      const root = this.carRoots[car.index];
      const L = this.track.length;
      const d = ((car.dist % L) + L) % L;
      const f = (d / L) * n;
      const i0 = Math.floor(f) % n;
      const i1 = (i0 + 1) % n;
      const t = f - Math.floor(f);
      const p0 = this.track.points[i0];
      const p1 = this.track.points[i1];
      this.tmpPos.lerpVectors(p0, p1, t);
      const tan = this.track.tangents[i0];
      this.tmpSide.crossVectors(this.up, tan).normalize();
      this.tmpPos.addScaledVector(this.tmpSide, car.lateral);
      root.position.copy(this.tmpPos);
      // orientation in board space (the board itself may be moved/rotated)
      root.rotation.set(0, Math.atan2(tan.x + this.track.tangents[i1].x, tan.z + this.track.tangents[i1].z), 0);
      this.carRings[car.index].visible = car.index === this.followed;
    }
    this.updateTrails();
    if (this.introActive) this.applyIntro();
    if (this.prediction >= 0) {
      const r = this.carRoots[this.prediction];
      this.pickMarker.visible = true;
      this.pickMarker.position.set(r.position.x, r.position.y + 0.03 + Math.sin(performance.now() / 250) * 0.003, r.position.z);
    } else {
      this.pickMarker.visible = false;
    }
  }

  private setupIntro(boardEntity: Entity) {
    const obj = boardEntity.object3D!;
    const glow = obj.getObjectByName('board-glow') as Mesh | undefined;
    const ringGeo = new RingGeometry(0.48, 0.5, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new Mesh(
      ringGeo,
      new MeshBasicMaterial({ color: '#38f5ff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    ring.name = 'intro-ring';
    ring.position.y = 0.014;
    ring.visible = false;
    this.world.createTransformEntity(ring, boardEntity);
    const title = new CanvasPanel(1024, 300, 0.62, 'intro-title');
    title.mesh.position.set(0, 0.12, 0.12);
    (title.mesh.material as MeshBasicMaterial).opacity = 0;
    title.mesh.visible = false;
    this.world.createTransformEntity(title.mesh, boardEntity);
    {
      const ctx = title.ctx;
      ctx.clearRect(0, 0, 1024, 300);
      const g = ctx.createLinearGradient(0, 0, 1024, 0);
      g.addColorStop(0, 'rgba(10,16,28,0)');
      g.addColorStop(0.2, 'rgba(10,16,28,0.75)');
      g.addColorStop(0.8, 'rgba(10,16,28,0.75)');
      g.addColorStop(1, 'rgba(10,16,28,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 40, 1024, 220);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#38f5ff';
      ctx.font = '700 34px system-ui, sans-serif';
      ctx.fillText('LUMEN GRAND CIRCUIT  ·  ROUND 1', 512, 88);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 96px system-ui, sans-serif';
      ctx.fillText('ÎLE LUMIÈRE', 512, 160);
      ctx.fillStyle = '#ffe14d';
      ctx.font = '600 32px system-ui, sans-serif';
      ctx.fillText('Pinch a car to call the winner', 512, 228);
      title.commit();
    }
    this.intro = {
      water: obj.getObjectByName('water'),
      land: ['board-solid', 'island-fill'].map((n) => obj.getObjectByName(n)).filter((o): o is Object3D => !!o),
      trees: obj.getObjectByName('trees'),
      dome: obj.getObjectByName('dome') as Mesh | undefined,
      glow,
      glowCount: glow ? glow.geometry.getAttribute('position').count : 0,
      ring,
      title,
    };
  }

  private startIntro() {
    if (!this.intro) return;
    this.introActive = true;
    this.introT = -0.4;
    this.introLanded = 0;
    this.introCued.swell = false;
    this.introCued.chime = false;
    this.audio.unlock();
    this.applyIntro();
  }

  /** The opening: water spreads, island rises, light runs the lap, life arrives, cars land, title. */
  private applyIntro() {
    const t = this.introT;
    const I = this.intro;
    const done = t > 7.8;
    const T = done ? 99 : t;
    if (!this.introCued.swell && T >= 0) {
      this.introCued.swell = true;
      this.audio.swell(2.8);
    }
    const sw = easeOutCubic(win(T, 0, 1.4));
    I.water?.scale.set(Math.max(0.001, sw), 1, Math.max(0.001, sw));
    const rp = win(T, 0, 1.7);
    I.ring.visible = rp > 0 && rp < 1;
    I.ring.scale.setScalar(0.05 + rp * 1.5);
    (I.ring.material as MeshBasicMaterial).opacity = (1 - rp) * 0.9;

    const rise = Math.max(0.001, easeOutBack(win(T, 0.7, 2.0)));
    for (const o of I.land) o.scale.y = rise;
    if (I.trees) I.trees.scale.y = Math.max(0.001, easeOutBack(win(T, 1.4, 2.4)));
    if (I.dome) (I.dome.material as MeshBasicMaterial).opacity = 0.8 * win(T, 1.8, 2.6);
    if (I.glow) {
      const g = easeInOut(win(T, 2.0, 3.4));
      I.glow.geometry.setDrawRange(0, Math.floor((I.glowCount * g) / 6) * 6);
    }
    const ps = Math.max(0.001, easeOutBack(win(T, 6.9, 7.6)));
    this.leaderboard.mesh.scale.setScalar(ps);
    this.controls.mesh.scale.setScalar(ps);
    this.pip.mesh.scale.setScalar(ps);
    introState.boats = easeOutCubic(win(T, 2.6, 4.2));
    introState.heli = easeInOut(win(T, 2.8, 5.0));

    // cars drop onto the grid one by one
    const order = this.sim.order;
    for (let i = 0; i < order.length; i++) {
      const root = this.carRoots[order[i].index];
      const a = 3.6 + i * 0.12;
      const p = win(T, a, a + 0.3);
      root.visible = p > 0;
      root.position.y += (1 - p) * (1 - p) * 0.12;
      if (p >= 1 && this.introLanded <= i && !done) {
        this.introLanded = i + 1;
        this.audio.thud();
      }
    }
    if (this.gantry) this.gantry.visible = T > 3.3;
    for (const tr of this.trails) tr.geo.setDrawRange(0, T > 5.2 ? Infinity : 0);

    // title card
    const tin = win(T, 4.4, 5.0);
    const tout = win(T, 6.4, 7.0);
    const ta = tin * (1 - tout);
    I.title.mesh.visible = ta > 0.001;
    (I.title.mesh.material as MeshBasicMaterial).opacity = ta;
    I.title.mesh.position.y = 0.17 + 0.03 * easeOutCubic(tin) + 0.03 * tout;
    if (!this.introCued.chime && T >= 4.4) {
      this.introCued.chime = true;
      this.audio.chime();
    }

    if (done) {
      this.introActive = false;
      I.title.mesh.visible = false;
      if (I.glow) I.glow.geometry.setDrawRange(0, Infinity);
      if (this.autostartPending) {
        this.sim.startLights();
        this.sim.lightsTime = 5;
        this.timeScale = this.autostartPending;
        this.autostartPending = 0;
        this.drawControls();
      }
    }
  }

  /** Find the best horizontal plane at table height (prefers ones labelled "table"). */
  private placeOnTable(): boolean {
    if (!this.board) return false;
    const head = this.player.head;
    head.getWorldPosition(this.tmpA);
    head.getWorldDirection(this.tmpTry);
    const fwdSign = (head as { isCamera?: boolean }).isCamera ? 1 : -1;
    const fx = this.tmpTry.x * fwdSign;
    const fz = this.tmpTry.z * fwdSign;
    let best: { score: number; cx: number; cy: number; cz: number; w: number; d: number } | null = null;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as unknown as {
        orientation?: string;
        semanticLabel?: string;
        polygon: DOMPointReadOnly[];
      };
      const obj = e.object3D;
      if (!plane || !obj || plane.orientation !== 'horizontal') continue;
      obj.updateWorldMatrix(true, false);
      this.boxMin.set(Infinity, 0, Infinity);
      this.boxMax.set(-Infinity, 0, -Infinity);
      for (const pt of plane.polygon) {
        this.boxMin.x = Math.min(this.boxMin.x, pt.x);
        this.boxMin.z = Math.min(this.boxMin.z, pt.z);
        this.boxMax.x = Math.max(this.boxMax.x, pt.x);
        this.boxMax.z = Math.max(this.boxMax.z, pt.z);
      }
      const w = this.boxMax.x - this.boxMin.x;
      const d = this.boxMax.z - this.boxMin.z;
      this.tmpB.set((this.boxMin.x + this.boxMax.x) / 2, 0, (this.boxMin.z + this.boxMax.z) / 2);
      obj.localToWorld(this.tmpB);
      const label = (plane.semanticLabel ?? '').toLowerCase();
      if (label === 'floor' || label === 'ceiling') continue;
      if (this.tmpB.y < 0.35 || this.tmpB.y > 1.25 || Math.max(w, d) < 0.35) continue;
      const dist = Math.hypot(this.tmpB.x - this.tmpA.x, this.tmpB.z - this.tmpA.z);
      if (dist > 3) continue;
      const facing = (this.tmpB.x - this.tmpA.x) * fx + (this.tmpB.z - this.tmpA.z) * fz;
      const score = dist + (label === 'table' || label === 'desk' ? 0 : 1) + (facing < 0 ? 2.5 : 0);
      if (!best || score < best.score) best = { score, cx: this.tmpB.x, cy: this.tmpB.y, cz: this.tmpB.z, w, d };
    }
    if (!best) return false;
    const s = Math.min(1, Math.max(0.5, Math.min(Math.max(best.w, best.d) / 1.1, Math.min(best.w, best.d) / 0.66)));
    this.placement = 'table';
    this.setBoardPose(best.cx, best.cy + 0.002, best.cz, s);
    console.info('[race] table plane', JSON.stringify(best));
    this.sim.events.unshift('BOARD PLACED ON YOUR TABLE');
    return true;
  }

  /** No table found: float the board in front of the seated viewer. */
  private placeInFront() {
    const head = this.player.head;
    head.getWorldPosition(this.tmpA);
    head.getWorldDirection(this.tmpB);
    // three's getWorldDirection on a camera-like object points to -z; flatten
    this.tmpB.y = 0;
    if (this.tmpB.lengthSq() < 1e-4) this.tmpB.set(0, 0, -1);
    this.tmpB.normalize();
    // Object3D.getWorldDirection returns +z; cameras look down -z
    const sign = (head as { isCamera?: boolean }).isCamera ? 1 : -1;
    this.placement = 'front';
    this.setBoardPose(
      this.tmpA.x + this.tmpB.x * 0.6 * sign,
      this.tmpA.y - 0.42,
      this.tmpA.z + this.tmpB.z * 0.6 * sign,
      0.85,
    );
    this.placement = 'front';
  }

  private setBoardPose(x: number, y: number, z: number, scale: number) {
    const obj = this.board!.object3D!;
    this.player.head.getWorldPosition(this.tmpA);
    obj.position.set(x, y, z);
    obj.rotation.set(0, Math.atan2(this.tmpA.x - x, this.tmpA.z - z), 0);
    obj.scale.setScalar(scale);
    console.info(`[race] board placed (${this.placement}) at`, x.toFixed(2), y.toFixed(2), z.toFixed(2), 'scale', scale.toFixed(2));
  }

  /** position + tangent on the centreline at a race distance, offset sideways */
  private trackAt(dist: number, lateral: number, out: Vector3, tan: Vector3) {
    const n = this.track.points.length - 1;
    const L = this.track.length;
    const d = ((dist % L) + L) % L;
    const f = (d / L) * n;
    const i0 = Math.floor(f) % n;
    const t = f - Math.floor(f);
    out.lerpVectors(this.track.points[i0], this.track.points[(i0 + 1) % n], t);
    tan.copy(this.track.tangents[i0]);
    this.trailNor.crossVectors(this.up, tan).normalize();
    out.addScaledVector(this.trailNor, lateral);
  }

  private updateTrails() {
    const N = TRAIL_SEGMENTS;
    const racing = this.sim.phase === RacePhase.Racing || this.sim.phase === RacePhase.Finished;
    for (const car of this.sim.cars) {
      const tr = this.trails[car.index];
      const len = racing ? Math.min(0.16, car.speed * 0.55) : 0;
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        this.trackAt(car.dist - 0.006 - len * u, car.lateral, this.trailPos, this.trailTan);
        // normal is left in trailNor by trackAt
        const w = 0.0032 * (1 - u * 0.85);
        const y = TRACK_SURFACE_Y + 0.0022;
        const o = k * 6;
        tr.pos[o] = this.trailPos.x + this.trailNor.x * w;
        tr.pos[o + 1] = y;
        tr.pos[o + 2] = this.trailPos.z + this.trailNor.z * w;
        tr.pos[o + 3] = this.trailPos.x - this.trailNor.x * w;
        tr.pos[o + 4] = y;
        tr.pos[o + 5] = this.trailPos.z - this.trailNor.z * w;
        const fade = Math.pow(1 - u, 1.6) * (car.index === this.followed ? 1.6 : 1);
        for (let v = 0; v < 2; v++) {
          tr.col[o + v * 3] = Math.min(1, tr.rgb[0] * fade + 0.15 * fade);
          tr.col[o + v * 3 + 1] = Math.min(1, tr.rgb[1] * fade + 0.15 * fade);
          tr.col[o + v * 3 + 2] = Math.min(1, tr.rgb[2] * fade + 0.15 * fade);
        }
      }
      (tr.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (tr.geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
    }
  }

  private updateFps(delta: number) {
    this.fpsFrames++;
    this.fpsTime += delta;
    this.fpsWorst = Math.max(this.fpsWorst, delta);
    if (this.fpsTime < 0.5 || !this.fpsPanel) return;
    const fps = this.fpsFrames / this.fpsTime;
    const p = this.fpsPanel;
    const ctx = p.ctx;
    const info = this.world.renderer.info.render;
    p.background(0.85);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '800 56px system-ui, sans-serif';
    ctx.fillStyle = fps >= 70 ? '#3dff8b' : fps >= 60 ? '#ffe14d' : '#ff3b5c';
    ctx.fillText(`${fps.toFixed(0)} FPS`, 24, 52);
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillStyle = '#cfe0f0';
    ctx.fillText(`avg ${((this.fpsTime / this.fpsFrames) * 1000).toFixed(1)} ms  worst ${(this.fpsWorst * 1000).toFixed(1)} ms`, 24, 100);
    ctx.fillText(`draws ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k`, 24, 128);
    p.commit();
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fpsWorst = 0;
  }

  private renderOnboard() {
    const r = this.world.renderer;
    const root = this.carRoots[this.followed];
    const cam = this.pipCamera;
    // camera mounted just behind and above the car, looking forward
    root.updateWorldMatrix(true, false);
    cam.position.set(0, 0.011, -0.02).applyMatrix4(root.matrixWorld);
    this.tmpLook.set(0, 0.004, 0.06).applyMatrix4(root.matrixWorld);
    cam.lookAt(this.tmpLook);
    cam.updateMatrixWorld();

    const xrEnabled = r.xr.enabled;
    const prevTarget = r.getRenderTarget();
    const prevBg = this.world.scene.background;
    r.xr.enabled = false;
    this.pip.mesh.visible = false;
    this.world.scene.background = this.pipBg;
    r.setRenderTarget(this.pipTarget);
    r.clear();
    r.render(this.world.scene, cam);
    r.setRenderTarget(prevTarget);
    this.world.scene.background = prevBg;
    this.pip.mesh.visible = true;
    r.xr.enabled = xrEnabled;
  }

  private onRaceFinished() {
    if (this.prediction < 0) {
      this.lastScore = { points: 0, text: 'No prediction this race' };
      return;
    }
    const winner = this.sim.order[0];
    const predicted = this.sim.cars[this.prediction];
    const result = scorePrediction(predicted.position, winner.index === predicted.index);
    this.lastScore = result;
    this.profile.points += result.points;
    this.profile.races += 1;
    if (result.points > 0) {
      this.profile.streak += 1;
      this.profile.bestStreak = Math.max(this.profile.bestStreak, this.profile.streak);
    } else this.profile.streak = 0;
    if (predicted.position === 1) this.profile.wins += 1;
    saveProfile(this.profile);
  }

  // ---------------------------------------------------------------------
  private drawControls() {
    const p = this.controls;
    if (!p) return;
    const ctx = p.ctx;
    p.background(0.82);
    ctx.textBaseline = 'middle';
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.fillStyle = '#cfe9ff';
    ctx.textAlign = 'left';
    let hint = '';
    if (this.sim.phase === RacePhase.Grid)
      hint =
        this.prediction < 0
          ? 'Pinch a car to predict the WINNER, then START'
          : `Your pick: ${this.sim.cars[this.prediction].driver.code}  ·  press START`;
    else if (this.sim.phase === RacePhase.Lights) hint = 'Lights...';
    else if (this.sim.phase === RacePhase.Racing)
      hint = this.timeScale === 0 ? 'Paused' : 'Pinch any car to ride onboard';
    else hint = this.lastScore ? `${this.lastScore.text}  (+${this.lastScore.points} pts)` : 'Race over';
    ctx.fillText(hint, 30, 48);

    for (const b of BUTTONS) {
      let label: string = b.label;
      if (b.id === 'start')
        label = this.sim.phase === RacePhase.Grid ? 'START' : this.timeScale === 0 ? 'RESUME' : 'PAUSE';
      if (b.id === 'speed') label = `SPEED ${Math.max(1, this.timeScale)}x`;
      if (b.id === 'onboard') label = this.onboardOn ? 'ONBOARD ON' : 'ONBOARD OFF';
      const hover = this.hoveredAction === b.id;
      roundRect(ctx, b.x, BTN_Y, BTN_W, BTN_H, 22);
      ctx.fillStyle = hover ? 'rgba(56,245,255,0.45)' : b.id === 'start' ? 'rgba(46,217,168,0.35)' : 'rgba(255,255,255,0.10)';
      ctx.fill();
      ctx.lineWidth = hover ? 5 : 2;
      ctx.strokeStyle = hover ? '#38f5ff' : 'rgba(255,255,255,0.35)';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '700 34px system-ui, sans-serif';
      ctx.fillText(label, b.x + BTN_W / 2, BTN_Y + BTN_H / 2 + 2);
    }
    p.commit();
  }

  private drawLeaderboard() {
    const p = this.leaderboard;
    if (!p) return;
    const ctx = p.ctx;
    const sim = this.sim;
    p.background();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#38f5ff';
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText('LUMEN GRAND CIRCUIT', 28, 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 40px system-ui, sans-serif';
    const lapText =
      sim.phase === RacePhase.Finished ? 'FINISHED' : sim.phase === RacePhase.Racing ? `LAP ${sim.leaderLap}/${sim.totalLaps}` : 'GRID';
    ctx.fillText(lapText, 28, 96);
    ctx.textAlign = 'right';
    ctx.font = '500 26px system-ui, sans-serif';
    ctx.fillStyle = '#9fb3c8';
    ctx.fillText(formatTime(sim.time), p.pxW - 28, 98);

    const top = 140;
    const rowH = 54;
    sim.order.forEach((car: CarState, i: number) => {
      const y = top + i * rowH;
      const team = TEAMS[car.driver.team];
      if (car.index === this.followed) {
        ctx.fillStyle = 'rgba(56,245,255,0.16)';
        ctx.fillRect(16, y, p.pxW - 32, rowH - 4);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#9fb3c8';
      ctx.font = '600 28px system-ui, sans-serif';
      ctx.fillText(String(i + 1).padStart(2, ' '), 28, y + rowH / 2);
      ctx.fillStyle = team.color;
      ctx.fillRect(76, y + 10, 8, rowH - 24);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 30px system-ui, sans-serif';
      ctx.fillText(car.driver.code, 98, y + rowH / 2);
      if (car.index === this.prediction) {
        ctx.fillStyle = '#ffe14d';
        ctx.fillText('★', 178, y + rowH / 2);
      }
      if (sim.fastestLapCar === car.index) {
        ctx.fillStyle = '#b06bff';
        ctx.font = '700 20px system-ui, sans-serif';
        ctx.fillText('FL', 210, y + rowH / 2);
      }
      ctx.textAlign = 'right';
      ctx.font = '500 26px system-ui, sans-serif';
      ctx.fillStyle = '#cfe0f0';
      let gap = '';
      if (sim.phase === RacePhase.Racing || sim.phase === RacePhase.Finished) {
        if (i === 0) gap = car.finished ? formatTime(car.finishTime) : 'LEADER';
        else if (car.finished && sim.order[0].finished) gap = `+${(car.finishTime - sim.order[0].finishTime).toFixed(3)}`;
        else {
          const lapsDown = Math.floor((sim.order[0].dist - car.dist) / this.track.length);
          gap = lapsDown >= 1 ? `+${lapsDown} LAP` : `+${sim.gapToLeader(car).toFixed(3)}`;
        }
      } else gap = team.name;
      ctx.fillText(gap, p.pxW - 28, y + rowH / 2);
    });

    // event ticker
    const ey = top + 10 * rowH + 10;
    ctx.strokeStyle = 'rgba(56,245,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(24, ey);
    ctx.lineTo(p.pxW - 24, ey);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = '600 22px system-ui, sans-serif';
    sim.events.slice(0, 2).forEach((ev, k) => {
      ctx.fillStyle = k === 0 ? '#ffe14d' : '#8296ab';
      ctx.fillText(ev, 28, ey + 26 + k * 30);
    });
    // profile
    ctx.fillStyle = '#9fb3c8';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(
      `PTS ${this.profile.points}   STREAK ${this.profile.streak}   RACES ${this.profile.races}`,
      28,
      p.pxH - 34,
    );
    p.commit();
  }

  private drawPip() {
    const p = this.pip;
    if (!p) return;
    const ctx = p.ctx;
    p.background(0.85);
    ctx.textBaseline = 'middle';
    const car = this.followed >= 0 ? this.sim.cars[this.followed] : undefined;
    ctx.textAlign = 'left';
    ctx.font = '700 30px system-ui, sans-serif';
    if (car) {
      const team = TEAMS[car.driver.team];
      ctx.fillStyle = team.color;
      ctx.fillRect(28, 486, 10, 26);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`P${car.position}  ${car.driver.name.toUpperCase()}`, 50, 498);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#9fb3c8';
      ctx.font = '500 24px system-ui, sans-serif';
      const kmh = Math.round(car.speed * 1400);
      ctx.fillText(`${kmh} km/h   last ${formatTime(car.lastLap || Infinity)}`, p.pxW - 28, 498);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#38f5ff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(this.onboardOn ? '● ONBOARD' : 'ONBOARD OFF', 30, 26);
    p.commit();
    if (this.pipFrame) this.pipFrame.visible = this.onboardOn;
  }
}

