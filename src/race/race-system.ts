import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  createSystem,
  Entity,
  Group,
  Hovered,
  Mesh,
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
  WebGLRenderTarget,
} from '@iwsdk/core';
import { CanvasPanel, roundRect } from './canvas-panel.js';
import { MeshBuilder } from './mesh-builder.js';
import { CarMarker, RaceBoard, UiButton } from './race-components.js';
import { CarState, formatTime, RacePhase, RaceSim, TEAMS } from './race-sim.js';
import { sampleTrack, TrackSample, TRACK_SURFACE_Y } from './track.js';
import { loadProfile, Profile, saveProfile, scorePrediction } from './profile.js';

const BUTTONS = [
  { id: 'start', label: 'START', x: 24 },
  { id: 'restart', label: 'NEW RACE', x: 270 },
  { id: 'speed', label: 'SPEED 1x', x: 516 },
  { id: 'onboard', label: 'ONBOARD', x: 762 },
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
}) {
  private track!: TrackSample;
  private sim!: RaceSim;
  private board?: Entity;
  private carRoots: Group[] = [];
  private carRings: Mesh[] = [];
  private pickMarker!: Mesh;
  private timeScale = 1;
  private profile!: Profile;
  private prediction = -1;
  private followed = -1;
  private lastScore: { points: number; text: string } | null = null;
  private onboardOn = true;

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

    // ---- leaderboard (right of the board, angled to the viewer) -------
    this.leaderboard = new CanvasPanel(512, 860, 0.25, 'leaderboard');
    this.leaderboard.mesh.position.set(0.71, 0.03 + this.leaderboard.height / 2 + 0.01, -0.06);
    this.leaderboard.mesh.rotation.y = -0.45;
    this.world.createTransformEntity(this.leaderboard.mesh, boardEntity);

    // ---- control strip (front edge, tilted up to the viewer) ----------
    this.controls = new CanvasPanel(1016, 210, 0.46, 'controls');
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
    this.placeCars();
    this.drawControls();
    this.drawLeaderboard();
    this.drawPip();
  }

  // ---------------------------------------------------------------------
  private onCarPinched(index: number) {
    if (!this.sim) return;
    if (this.sim.phase === RacePhase.Grid) {
      this.prediction = index;
    }
    this.followed = index;
    this.onboardOn = true;
    this.drawAll();
  }

  private onButton(action: string) {
    if (!this.sim) return;
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
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, 0.05);
    const prevPhase = this.sim.phase;
    // sub-step so fast-forward stays stable
    const steps = Math.max(1, Math.ceil(this.timeScale));
    for (let i = 0; i < steps; i++) this.sim.step((dt * this.timeScale) / steps);

    if (prevPhase !== RacePhase.Finished && this.sim.phase === RacePhase.Finished) this.onRaceFinished();
    if (prevPhase !== this.sim.phase) this.drawControls();

    this.placeCars();
    const lit = this.sim.lightsOn;
    for (let i = 0; i < 5; i++) this.lights[i].material = i < lit ? this.lightOn : this.lightOff;

    this.uiTimer += delta;
    if (this.uiTimer > 0.25) {
      this.uiTimer = 0;
      this.drawLeaderboard();
      this.drawPip();
    }
    this.frame++;
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
    if (this.prediction >= 0) {
      const r = this.carRoots[this.prediction];
      this.pickMarker.visible = true;
      this.pickMarker.position.set(r.position.x, r.position.y + 0.03 + Math.sin(performance.now() / 250) * 0.003, r.position.z);
    } else {
      this.pickMarker.visible = false;
    }
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

