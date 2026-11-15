import { Vector3, World } from '@iwsdk/core';

/**
 * Palm-up gesture: hold an open hand palm-up in front of your eyes and look at
 * it for a moment; `update()` returns true once. Used to open the pause menu
 * without controllers. Requiring the gaze keeps resting or cooking hands from
 * opening it by accident.
 */
export class PalmUpDetector {
  private held = 0;
  private cooldown = 0;
  private w = new Vector3();
  private a = new Vector3();
  private b = new Vector3();
  private n = new Vector3();
  private toHead = new Vector3();
  private head = new Vector3();
  private fwd = new Vector3();
  /** world position of the last palm that triggered (meters) */
  readonly palm = new Vector3();

  constructor(
    private world: World,
    private holdTime = 0.6,
  ) {}

  /** true on the frame the gesture completes; head position + forward are in world space */
  update(delta: number, head: Vector3, forward: Vector3): boolean {
    this.head.copy(head);
    this.fwd.copy(forward).normalize();
    this.cooldown = Math.max(0, this.cooldown - delta);
    const up = this.anyPalmUp();
    this.held = up ? this.held + delta : 0;
    if (this.held >= this.holdTime && this.cooldown <= 0) {
      this.held = 0;
      this.cooldown = 1.5;
      return true;
    }
    return false;
  }

  /** suppress triggering for a while (e.g. right after the menu closes) */
  suppress(seconds: number) {
    this.cooldown = Math.max(this.cooldown, seconds);
    this.held = 0;
  }

  private anyPalmUp(): boolean {
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const session = this.world.session;
    if (!frame || !ref || !session || !frame.getJointPose) return false;
    for (const src of session.inputSources) {
      const hand = src.hand;
      if (!hand) continue;
      const wrist = hand.get('wrist');
      const idx = hand.get('index-finger-metacarpal');
      const pinky = hand.get('pinky-finger-metacarpal');
      const thumbTip = hand.get('thumb-tip');
      const indexTip = hand.get('index-finger-tip');
      if (!wrist || !idx || !pinky || !thumbTip || !indexTip) continue;
      const pw = frame.getJointPose(wrist, ref);
      const pi = frame.getJointPose(idx, ref);
      const pp = frame.getJointPose(pinky, ref);
      const pt = frame.getJointPose(thumbTip, ref);
      const px = frame.getJointPose(indexTip, ref);
      if (!pw || !pi || !pp || !pt || !px) continue;
      const W = pw.transform.position;
      const I = pi.transform.position;
      const P = pp.transform.position;
      this.w.set(W.x, W.y, W.z);
      this.a.set(I.x - W.x, I.y - W.y, I.z - W.z);
      this.b.set(P.x - W.x, P.y - W.y, P.z - W.z);
      // right hand: (index - wrist) x (pinky - wrist) is the palm normal; mirrored for the left
      this.n.crossVectors(this.a, this.b).normalize();
      if (src.handedness === 'left') this.n.negate();
      if (this.n.y < 0.55) continue;
      // looking at it: the palm sits near the centre of view and faces the eyes
      this.toHead.set(this.head.x - W.x, this.head.y - W.y, this.head.z - W.z);
      const dist = this.toHead.length();
      if (dist < 0.15 || dist > 0.7) continue;
      this.toHead.multiplyScalar(1 / dist);
      if (-this.toHead.dot(this.fwd) < 0.85) continue; // within ~30 degrees of gaze
      if (this.n.dot(this.toHead) < 0.1) continue;
      // an open hand, not a pinch
      const T = pt.transform.position;
      const X = px.transform.position;
      const dx = T.x - X.x;
      const dy = T.y - X.y;
      const dz = T.z - X.z;
      if (dx * dx + dy * dy + dz * dz < 0.045 * 0.045) continue;
      this.palm.set((W.x + I.x + P.x) / 3, (W.y + I.y + P.y) / 3, (W.z + I.z + P.z) / 3);
      return true;
    }
    return false;
  }
}
