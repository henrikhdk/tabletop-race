import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PokeInteractable,
  RayInteractable,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  World,
} from '@iwsdk/core';
import { CanvasPanel, roundRect } from './canvas-panel.js';
import { KitchenItem, UiButton } from './race-components.js';
import { RaceAudio } from './race-audio.js';

/**
 * The cooking bench along the front edge of the board, within reach of a
 * seated player. Recipe: grab the dough, drop it on the plate, hold an
 * ingredient over it to add doses, then drop the dish in the serving hatch.
 * A served dish charges the big ability button; tapping it fires the effect.
 *
 * Ingredients: pepper = turbo, cheese = grip, filling = block (hold position).
 */
export type Ingredient = 'pepper' | 'cheese' | 'filling';
export const INGREDIENTS: Ingredient[] = ['pepper', 'cheese', 'filling'];
export interface Dish {
  pepper: number;
  cheese: number;
  filling: number;
}

const INFO: Record<Ingredient, { color: string; label: string; effect: string }> = {
  pepper: { color: '#ff3b2f', label: 'PEPPER', effect: 'TURBO' },
  cheese: { color: '#ffd23a', label: 'CHEESE', effect: 'GRIP' },
  filling: { color: '#9a5a2a', label: 'FILLING', effect: 'BLOCK' },
};

// board-local layout (meters); the board's front edge is z = 0.33
const BENCH_Y = 0.0;
const TOP = 0.014; // bench top height
const PLATE = new Vector3(-0.41, TOP, 0.42);
const BASKET = new Vector3(-0.53, TOP, 0.38);
const SHAKER_HOME: Record<Ingredient, Vector3> = {
  pepper: new Vector3(-0.31, TOP, 0.37),
  cheese: new Vector3(-0.31, TOP, 0.46),
  filling: new Vector3(-0.53, TOP, 0.47),
};
const HATCH = new Vector3(0.43, TOP, 0.4);
const BUTTON = new Vector3(0.33, TOP, 0.45);
const MAX_DOSES = 3;
const DOSE_TIME = 0.55; // seconds held over the dish per dose
const SNAP_PLATE = 0.09;
const SNAP_HATCH = 0.1;

interface Item {
  kind: 'base' | Ingredient;
  obj: Group;
  entity: Entity;
  home: Vector3;
  held: boolean;
  /** returning home animation 0..1 (1 = home) */
  back: number;
  from: Vector3;
}

export class Kitchen {
  readonly root = new Group();
  private items: Item[] = [];
  private base!: Item;
  private dishOnPlate = false;
  private dish: Dish = { pepper: 0, cheese: 0, filling: 0 };
  private doseT = 0;
  /** the served dish waiting on the ability button (null = nothing loaded) */
  loaded: Dish | null = null;
  /** stats for debugging / telemetry */
  served = 0;
  doses = 0;
  private toppings!: Group;
  private toppingMeshes: Mesh[] = [];
  private buttonMat!: MeshStandardMaterial;
  private buttonGlow!: Mesh;
  private hatchGlow!: Mesh;
  private radio: CanvasPanel;
  private radioText = '';
  private radioSub = '';
  private radioFlash = 0;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private clock = 0;
  // our own pinch-grab, read straight from the hand joints (hands-only, tolerant radius)
  private pinch = [
    { down: false, item: null as Item | null, at: new Vector3(), off: new Vector3() },
    { down: false, item: null as Item | null, at: new Vector3(), off: new Vector3() },
  ];
  private pinchSeen = [false, false];
  /** dish served into the hatch */
  onServe?: (d: Dish) => void;
  /** ability button tapped with a dish loaded */
  onActivate?: (d: Dish) => void;
  /** a dose landed on the dish (for audio / particles) */
  onDose?: (k: Ingredient, worldPos: Vector3) => void;
  /** may the player serve right now? */
  canServe: () => boolean = () => true;

  constructor(
    private world: World,
    private board: Entity,
    private audio: RaceAudio,
    btnMat: MeshBasicMaterial,
  ) {
    this.root.name = 'kitchen';
    const rootEntity = world.createTransformEntity(this.root, board);
    this.buildBench();

    // dough base + its toppings
    this.base = this.makeItem('base', rootEntity, BASKET.clone().setY(TOP + 0.03), () => {
      const g = new Group();
      const dough = new Mesh(new SphereGeometry(0.026, 20, 14), new MeshStandardMaterial({ color: '#f2c879', roughness: 0.7 }));
      dough.scale.set(1, 0.8, 1);
      g.add(dough);
      return g;
    });
    this.toppings = new Group();
    this.base.obj.add(this.toppings);
    const dropGeo = new SphereGeometry(0.006, 8, 6);
    for (let i = 0; i < MAX_DOSES * 3; i++) {
      const m = new Mesh(dropGeo, new MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }));
      m.visible = false;
      this.toppings.add(m);
      this.toppingMeshes.push(m);
    }
    for (const k of INGREDIENTS) {
      this.makeItem(k, rootEntity, SHAKER_HOME[k].clone().setY(TOP), () => this.shakerModel(k));
    }

    // ability button (a big round push button) + hatch glow
    const btn = new Group();
    btn.position.copy(BUTTON);
    const baseRing = new Mesh(new CylinderGeometry(0.05, 0.055, 0.012, 32), new MeshStandardMaterial({ color: '#1b2230', metalness: 0.5, roughness: 0.4 }));
    baseRing.position.y = 0.006;
    btn.add(baseRing);
    this.buttonMat = new MeshStandardMaterial({ color: '#3a3f4a', emissive: '#000000', roughness: 0.35 });
    const cap = new Mesh(new CylinderGeometry(0.042, 0.042, 0.02, 32), this.buttonMat);
    cap.position.y = 0.02;
    btn.add(cap);
    this.buttonGlow = new Mesh(
      new TorusGeometry(0.05, 0.004, 8, 40),
      new MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    this.buttonGlow.rotation.x = -Math.PI / 2;
    this.buttonGlow.position.y = 0.031;
    btn.add(this.buttonGlow);
    const hit = new Mesh(new BoxGeometry(0.11, 0.06, 0.11), btnMat);
    hit.name = 'btn-ability';
    hit.position.y = 0.025;
    this.world.createTransformEntity(btn, rootEntity);
    const hitEntity = this.world.createTransformEntity(hit, rootEntity);
    hit.position.copy(BUTTON).setY(BUTTON.y + 0.025);
    hitEntity.addComponent(UiButton, { action: 'ability' });
    hitEntity.addComponent(RayInteractable);
    // a real push button: tap it with a fingertip, or point and pinch
    hitEntity.addComponent(PokeInteractable);

    // radio: subtitles from the team engineer, above the hatch
    this.radio = new CanvasPanel(900, 260, 0.3, 'radio');
    this.radio.mesh.position.set(0.42, 0.13, 0.36);
    this.radio.mesh.rotation.x = -0.35;
    this.world.createTransformEntity(this.radio.mesh, rootEntity);
    this.say('Welcome to the bench, chef.', 'Dough → plate → ingredient → hatch');
  }

  private buildBench() {
    const steel = new MeshStandardMaterial({ color: '#2a3140', metalness: 0.6, roughness: 0.35 });
    const edge = new MeshBasicMaterial({ color: '#38f5ff', transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false });
    for (const [cx, w] of [
      [-0.43, 0.3],
      [0.41, 0.26],
    ] as const) {
      const slab = new Mesh(new BoxGeometry(w, TOP, 0.18), steel);
      slab.position.set(cx, BENCH_Y + TOP / 2, 0.42);
      this.root.add(slab);
      const lip = new Mesh(new BoxGeometry(w, 0.002, 0.004), edge);
      lip.position.set(cx, TOP + 0.001, 0.512);
      this.root.add(lip);
    }
    // plate
    const plate = new Mesh(new CylinderGeometry(0.05, 0.045, 0.006, 32), new MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.3 }));
    plate.position.copy(PLATE).setY(TOP + 0.003);
    this.root.add(plate);
    // basket for the dough
    const basket = new Mesh(new CylinderGeometry(0.04, 0.034, 0.025, 20, 1, true), new MeshStandardMaterial({ color: '#a8743a', roughness: 0.9, side: 2 }));
    basket.position.copy(BASKET).setY(TOP + 0.0125);
    this.root.add(basket);
    // serving hatch: a little framed window with a glowing slot
    const frame = new MeshStandardMaterial({ color: '#c9d2de', metalness: 0.7, roughness: 0.25 });
    const hatch = new Group();
    hatch.position.copy(HATCH);
    const back = new Mesh(new BoxGeometry(0.13, 0.09, 0.012), frame);
    back.position.set(0, 0.045, -0.04);
    hatch.add(back);
    const sill = new Mesh(new BoxGeometry(0.13, 0.008, 0.09), frame);
    sill.position.set(0, 0.004, 0);
    hatch.add(sill);
    this.hatchGlow = new Mesh(
      new BoxGeometry(0.11, 0.003, 0.07),
      new MeshBasicMaterial({ color: '#3dff8b', transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }),
    );
    this.hatchGlow.position.set(0, 0.0095, 0);
    hatch.add(this.hatchGlow);
    this.root.add(hatch);
  }

  private shakerModel(k: Ingredient) {
    const g = new Group();
    const col = INFO[k].color;
    if (k === 'filling') {
      // a pot of filling with a fat handle
      const pot = new Mesh(new CylinderGeometry(0.03, 0.026, 0.045, 20), new MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.6 }));
      pot.position.y = 0.0225;
      g.add(pot);
      const top = new Mesh(new CylinderGeometry(0.028, 0.028, 0.004, 20), new MeshStandardMaterial({ color: col, roughness: 0.8 }));
      top.position.y = 0.045;
      g.add(top);
    } else {
      const body = new Mesh(new CylinderGeometry(0.017, 0.019, 0.075, 16), new MeshStandardMaterial({ color: col, roughness: 0.45 }));
      body.position.y = 0.0375;
      g.add(body);
      const capM = new Mesh(new SphereGeometry(0.017, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: k === 'pepper' ? '#2a8a2a' : '#f5f5f5', roughness: 0.5 }));
      capM.position.y = 0.075;
      g.add(capM);
    }
    return g;
  }

  private makeItem(kind: Item['kind'], parent: Entity, home: Vector3, model: () => Group): Item {
    const obj = model();
    obj.name = `kitchen-${kind}`;
    obj.position.copy(home);
    // generous invisible grab volume: big, tolerant targets
    const grabVol = new Mesh(new SphereGeometry(0.05, 8, 6), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    grabVol.position.y = 0.03;
    obj.add(grabVol);
    const entity = this.world.createTransformEntity(obj, parent);
    entity.addComponent(KitchenItem, { kind });
    const it: Item = { kind, obj, entity, home: home.clone(), held: false, back: 1, from: new Vector3() };
    this.items.push(it);
    return it;
  }

  private onGrabItem(it: Item) {
    this.audio.unlock();
    this.audio.click();
    it.held = true;
    it.back = 1;
    if (it === this.base && this.dishOnPlate) this.dishOnPlate = false;
    if (it.kind !== 'base') this.doseT = 0;
  }

  private onReleaseItem(it: Item) {
    it.held = false;
    const p = this.tmp.copy(it.obj.position);
    if (it === this.base) {
      const dHatch = Math.hypot(p.x - HATCH.x, p.z - HATCH.z);
      const dPlate = Math.hypot(p.x - PLATE.x, p.z - PLATE.z);
      if (dHatch < SNAP_HATCH && p.y < 0.2) {
        this.serve();
        return;
      }
      if (dPlate < SNAP_PLATE && p.y < 0.2) {
        this.dishOnPlate = true;
        it.obj.position.copy(PLATE).setY(TOP + 0.024);
        it.obj.rotation.set(0, 0, 0);
        this.audio.thud(0.4);
        if (this.total(this.dish) === 0) this.say('Dough on the plate!', 'Now hold an ingredient over it');
        return;
      }
    }
    this.sendHome(it);
  }

  private sendHome(it: Item) {
    it.from.copy(it.obj.position);
    it.back = 0;
  }

  private serve() {
    const d = this.dish;
    if (!this.canServe()) {
      this.say("Not now, chef!", 'Wait for the next stop');
      this.sendHome(this.base);
      return;
    }
    if (this.loaded) {
      this.say('One dish at a time!', 'Use the one on the button first');
      this.sendHome(this.base);
      return;
    }
    this.loaded = { ...d };
    this.served++;
    this.audio.chime();
    this.onServe?.(this.loaded);
    const names = INGREDIENTS.filter((k) => d[k] > 0).map((k) => INFO[k].effect);
    this.say(names.length ? `${names.join(' + ')} loaded!` : 'Plain dough… loaded?', 'Hit the big button when it counts');
    // a fresh dough appears in the basket
    this.dish = { pepper: 0, cheese: 0, filling: 0 };
    this.dishOnPlate = false;
    this.refreshToppings();
    this.base.obj.position.copy(BASKET).setY(TOP + 0.03);
    this.base.obj.rotation.set(0, 0, 0);
    this.base.obj.scale.setScalar(0.001);
    this.base.back = 1;
    this.radioFlash = 1;
  }

  /** ability button pressed */
  press(): boolean {
    if (!this.loaded) {
      this.say('Nothing loaded yet', 'Cook something and serve it in the hatch');
      return false;
    }
    const d = this.loaded;
    this.loaded = null;
    this.onActivate?.(d);
    return true;
  }

  /** clear everything between races */
  reset() {
    this.loaded = null;
    this.dish = { pepper: 0, cheese: 0, filling: 0 };
    this.dishOnPlate = false;
    this.refreshToppings();
    for (const P of this.pinch) {
      P.down = false;
      P.item = null;
    }
    for (const it of this.items) {
      it.held = false;
      it.back = 1;
      it.obj.position.copy(it.home);
      it.obj.rotation.set(0, 0, 0);
    }
  }

  setVisible(v: boolean) {
    this.root.visible = v;
  }

  say(text: string, sub = '') {
    if (text === this.radioText && sub === this.radioSub) return;
    this.radioText = text;
    this.radioSub = sub;
    this.radioFlash = 1;
    this.drawRadio();
  }

  private total(d: Dish) {
    return d.pepper + d.cheese + d.filling;
  }

  private refreshToppings() {
    let n = 0;
    for (const k of INGREDIENTS) {
      for (let i = 0; i < this.dish[k]; i++) {
        const m = this.toppingMeshes[n++];
        (m.material as MeshStandardMaterial).color.set(INFO[k].color);
        const a = n * 2.4;
        m.position.set(Math.cos(a) * 0.014, 0.018 + (n % 3) * 0.003, Math.sin(a) * 0.014);
        m.visible = true;
      }
    }
    for (; n < this.toppingMeshes.length; n++) this.toppingMeshes[n].visible = false;
  }

  /** pinch near an item = pick it up; open the pinch = let it go */
  private updatePinch() {
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const session = this.world.session;
    this.pinchSeen[0] = this.pinchSeen[1] = false;
    if (frame && ref && session && frame.getJointPose && this.root.visible) {
      for (const src of session.inputSources) {
        const hand = src.hand;
        if (!hand) continue;
        const h = src.handedness === 'left' ? 0 : 1;
        const tj = hand.get('thumb-tip');
        const ij = hand.get('index-finger-tip');
        if (!tj || !ij) continue;
        const a = frame.getJointPose(tj, ref);
        const b = frame.getJointPose(ij, ref);
        if (!a || !b) continue;
        const A = a.transform.position;
        const B = b.transform.position;
        const gap = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
        const P = this.pinch[h];
        this.pinchSeen[h] = true;
        P.at.set((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
        this.root.worldToLocal(P.at);
        const closed = P.down ? gap < 0.035 : gap < 0.02;
        if (closed && !P.down) {
          P.down = true;
          P.item = this.pickAt(P.at);
          if (P.item) {
            P.off.copy(P.item.obj.position).sub(P.at);
            P.off.multiplyScalar(0.5); // pull the item towards the fingers
            this.onGrabItem(P.item);
          }
        } else if (!closed && P.down) {
          P.down = false;
          if (P.item) this.onReleaseItem(P.item);
          P.item = null;
        }
        if (P.down && P.item) P.item.obj.position.copy(P.at).add(P.off);
      }
    }
    // a hand that vanished (tracking lost) drops what it held
    for (let h = 0; h < 2; h++) {
      const P = this.pinch[h];
      if (!this.pinchSeen[h] && P.down) {
        P.down = false;
        if (P.item) this.onReleaseItem(P.item);
        P.item = null;
      }
    }
  }

  /** nearest free item within reach of a pinch point (kitchen-local) */
  private pickAt(p: Vector3): Item | null {
    let best: Item | null = null;
    let bestD = 0.085;
    for (const it of this.items) {
      if (it.held) continue;
      // aim at the item's middle, not its base
      const d = Math.hypot(p.x - it.obj.position.x, p.y - (it.obj.position.y + 0.03), p.z - it.obj.position.z);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  update(dt: number) {
    this.clock += dt;
    this.updatePinch();
    // pouring: an ingredient held over the dish adds doses
    let pouring: Item | null = null;
    if (this.dishOnPlate && !this.base.held) {
      for (const it of this.items) {
        if (it.kind === 'base' || !it.held) continue;
        const p = it.obj.position;
        const dx = Math.hypot(p.x - PLATE.x, p.z - PLATE.z);
        const dy = p.y - PLATE.y;
        if (dx < 0.08 && dy > 0.015 && dy < 0.22) pouring = it;
      }
    }
    if (pouring) {
      const k = pouring.kind as Ingredient;
      this.doseT += dt;
      // a little wobble while pouring
      pouring.obj.children[0].rotation.z = Math.sin(this.clock * 28) * 0.25;
      if (this.doseT >= DOSE_TIME) {
        this.doseT = 0;
        if (this.dish[k] < MAX_DOSES) {
          this.dish[k] += 1;
          this.doses++;
          this.refreshToppings();
          this.audio.pop();
          this.base.obj.getWorldPosition(this.tmp2);
          this.onDose?.(k, this.tmp2);
          const d = this.dish;
          const over = d[k] >= MAX_DOSES;
          this.say(
            over ? `That's a LOT of ${INFO[k].label.toLowerCase()}…` : `+1 ${INFO[k].label} (${INFO[k].effect})`,
            'Drop the dish in the hatch to serve',
          );
        }
      }
    } else {
      this.doseT = 0;
      for (const it of this.items) if (it.kind !== 'base') it.obj.children[0].rotation.z *= 0.8;
    }
    // items fly back home when let go somewhere else
    for (const it of this.items) {
      if (it.back < 1 && !it.held) {
        it.back = Math.min(1, it.back + dt * 2.5);
        const e = 1 - Math.pow(1 - it.back, 3);
        it.obj.position.lerpVectors(it.from, it.home, e);
        it.obj.position.y += Math.sin(it.back * Math.PI) * 0.06;
        it.obj.rotation.set(0, 0, 0);
      }
      if (it === this.base && it.obj.scale.x < 1 && !it.held) it.obj.scale.setScalar(Math.min(1, it.obj.scale.x + dt * 3));
    }
    // ability button + hatch feedback
    const glow = this.buttonGlow.material as MeshBasicMaterial;
    if (this.loaded) {
      const k = this.mainIngredient(this.loaded);
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * 6);
      glow.opacity = pulse;
      glow.color.set(k ? INFO[k].color : '#ffffff');
      this.buttonMat.color.set(k ? INFO[k].color : '#d8d8d8');
      this.buttonMat.emissive.set(k ? INFO[k].color : '#444444');
      this.buttonMat.emissiveIntensity = 0.4 + pulse * 0.4;
    } else {
      glow.opacity = 0;
      this.buttonMat.color.set('#3a3f4a');
      this.buttonMat.emissive.set('#000000');
    }
    (this.hatchGlow.material as MeshBasicMaterial).opacity =
      this.base.held && !this.loaded ? 0.5 + 0.4 * Math.sin(this.clock * 8) : 0.25;
    if (this.radioFlash > 0) {
      this.radioFlash = Math.max(0, this.radioFlash - dt * 1.5);
      this.radio.mesh.scale.setScalar(1 + this.radioFlash * 0.06);
    }
  }

  mainIngredient(d: Dish): Ingredient | null {
    let best: Ingredient | null = null;
    for (const k of INGREDIENTS) if (d[k] > 0 && (!best || d[k] > d[best])) best = k;
    return best;
  }

  private drawRadio() {
    const p = this.radio;
    const ctx = p.ctx;
    p.background(0.9);
    roundRect(ctx, 24, 24, 150, 44, 22);
    ctx.fillStyle = '#e8333b';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('RADIO', 99, 47);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    let size = 52;
    ctx.font = `900 ${size}px system-ui, sans-serif`;
    while (ctx.measureText(this.radioText).width > 850 && size > 26) {
      size -= 2;
      ctx.font = `900 ${size}px system-ui, sans-serif`;
    }
    ctx.fillText(this.radioText, 28, 128);
    ctx.fillStyle = '#9fdcff';
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.fillText(this.radioSub, 28, 200);
    p.commit();
  }

  /** for reuse by callers that want the hit volume list */
  get objects(): Object3D[] {
    return this.items.map((i) => i.obj);
  }
}

export function dishLabel(d: Dish) {
  const parts = INGREDIENTS.filter((k) => d[k] > 0).map((k) => `${INFO[k].effect}${d[k] > 1 ? ` x${d[k]}` : ''}`);
  return parts.length ? parts.join(' + ') : 'PLAIN';
}
