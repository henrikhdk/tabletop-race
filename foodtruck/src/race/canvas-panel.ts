import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

/** A flat floating panel whose content is drawn with the 2D canvas API. */
export class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;

  constructor(
    readonly pxW: number,
    readonly pxH: number,
    readonly width: number,
    name: string,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const height = (width * pxH) / pxW;
    const mat = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(width, height), mat);
    this.mesh.name = name;
    this.mesh.renderOrder = 10;
  }

  get height() {
    return (this.width * this.pxH) / this.pxW;
  }

  /** convert a pixel rectangle on the canvas to panel-local center/size in meters */
  rectToLocal(x: number, y: number, w: number, h: number) {
    const s = this.width / this.pxW;
    return {
      cx: (x + w / 2 - this.pxW / 2) * s,
      cy: (this.pxH / 2 - (y + h / 2)) * s,
      w: w * s,
      h: h * s,
    };
  }

  /** glassy rounded background used by every panel */
  background(alpha = 0.78) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.pxW, this.pxH);
    roundRect(ctx, 4, 4, this.pxW - 8, this.pxH - 8, 28);
    const g = ctx.createLinearGradient(0, 0, 0, this.pxH);
    g.addColorStop(0, `rgba(18,28,44,${alpha})`);
    g.addColorStop(1, `rgba(10,16,28,${alpha})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(56,245,255,0.55)';
    ctx.stroke();
  }

  commit() {
    this.texture.needsUpdate = true;
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
