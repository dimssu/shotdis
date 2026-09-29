import type { MapDef, Solid } from '@shared/maps/types';

export type MinimapMode = 'rotate' | 'fixed';

export interface Blip {
  x: number;
  z: number;
  yaw: number;
  color: number;
  /** 0..1; fades out after an enemy is last seen or heard. */
  alpha: number;
}

/** Map layer resolution (pixels per metre) and padding around the arena (metres). */
const PPM = 6;
const MARGIN = 2;
/** Metres from the centre to the rim in rotating mode. */
const VIEW_RADIUS = 24;

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function shade(t: number): string {
  // Low cover is dim, platforms mid, walls and buildings bright.
  const lo = [52, 60, 74];
  const hi = [176, 188, 206];
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(lo[0] + (hi[0] - lo[0]) * k)},${Math.round(lo[1] + (hi[1] - lo[1]) * k)},${Math.round(lo[2] + (hi[2] - lo[2]) * k)})`;
}

/** Pre-render the arena from above once per map. -Z is up in the image. */
function buildLayer(map: MapDef): HTMLCanvasElement {
  const b = map.bounds;
  const c = document.createElement('canvas');
  c.width = Math.ceil((b.maxX - b.minX + MARGIN * 2) * PPM);
  c.height = Math.ceil((b.maxZ - b.minZ + MARGIN * 2) * PPM);
  const ctx = c.getContext('2d')!;
  const u = (x: number) => (x - b.minX + MARGIN) * PPM;
  const v = (z: number) => (z - b.minZ + MARGIN) * PPM;
  ctx.fillStyle = '#1c222c';
  ctx.fillRect(u(b.minX), v(b.minZ), (b.maxX - b.minX) * PPM, (b.maxZ - b.minZ) * PPM);
  const solids = map.solids.filter((s: Solid) => (s.kind === 'ramp' || s.collide !== false) && s.y + s.h > 0.15);
  solids.sort((a, bb) => a.y + a.h - (bb.y + bb.h));
  for (const s of solids) {
    const top = s.y + s.h;
    const x = u(s.x);
    const y = v(s.z);
    const w = s.w * PPM;
    const h = s.d * PPM;
    if (s.kind === 'ramp') {
      // Gradient from the low end to the high end shows which way is up.
      const lowT = s.y / 6;
      const highT = top / 6;
      let g: CanvasGradient;
      if (s.axis === 'x') g = s.dir === 1 ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(x + w, 0, x, 0);
      else g = s.dir === 1 ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(0, y + h, 0, y);
      g.addColorStop(0, shade(lowT));
      g.addColorStop(1, shade(highT));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = shade(top / 6);
    }
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  }
  return c;
}

/**
 * Draws the minimap into a canvas owned by the HUD. The game calls `draw`
 * ~30 times a second; nothing here touches React.
 */
export class Minimap {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private layer: HTMLCanvasElement | null = null;
  private map: MapDef | null = null;

  get ready(): boolean {
    return this.ctx !== null && this.layer !== null;
  }

  setCanvas(c: HTMLCanvasElement | null): void {
    this.canvas = c;
    this.ctx = c ? c.getContext('2d') : null;
  }

  setMap(map: MapDef): void {
    if (this.map === map && this.layer) return;
    this.map = map;
    this.layer = buildLayer(map);
  }

  draw(mode: MinimapMode, sx: number, sz: number, syaw: number, alive: boolean, blips: Blip[], count: number): void {
    const c = this.canvas;
    const ctx = this.ctx;
    const layer = this.layer;
    const map = this.map;
    if (!c || !ctx || !layer || !map) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = Math.max(16, Math.round(c.clientWidth * dpr));
    if (c.width !== S) {
      c.width = S;
      c.height = S;
    }
    const half = S / 2;
    const b = map.bounds;
    let scale: number;
    let rot: number;
    let cx: number;
    let cz: number;
    if (mode === 'rotate') {
      scale = half / VIEW_RADIUS;
      rot = syaw;
      cx = sx;
      cz = sz;
    } else {
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + MARGIN * 2;
      scale = (S / span) * 0.98;
      rot = 0;
      cx = (b.minX + b.maxX) / 2;
      cz = (b.minZ + b.maxZ) / 2;
    }
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - dpr, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(7,9,14,0.82)';
    ctx.fillRect(0, 0, S, S);

    // Arena layer
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(rot);
    ctx.scale(scale / PPM, scale / PPM);
    ctx.translate(-(cx - b.minX + MARGIN) * PPM, -(cz - b.minZ + MARGIN) * PPM);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();

    const size = 5 * dpr;
    const rim = half - 7 * dpr;
    // Other players
    for (let i = 0; i < count; i++) {
      const p = blips[i];
      const dx = p.x - cx;
      const dz = p.z - cz;
      let px = (dx * cos - dz * sin) * scale;
      let py = (dx * sin + dz * cos) * scale;
      const d = Math.hypot(px, py);
      let edge = false;
      if (d > rim) {
        px = (px / d) * rim;
        py = (py / d) * rim;
        edge = true;
      }
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      marker(ctx, half + px, half + py, fx * cos - fz * sin, fx * sin + fz * cos, hex(p.color), p.alpha * (edge ? 0.7 : 1), edge ? size * 0.75 : size, !edge, dpr);
    }
    // You
    {
      const dx = sx - cx;
      const dz = sz - cz;
      const px = half + (dx * cos - dz * sin) * scale;
      const py = half + (dx * sin + dz * cos) * scale;
      const fx = -Math.sin(syaw);
      const fz = -Math.cos(syaw);
      if (alive) marker(ctx, px, py, fx * cos - fz * sin, fx * sin + fz * cos, '#ffffff', 1, size * 1.15, true, dpr);
      else {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // Rim and north marker
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(half, half, half - dpr, 0, Math.PI * 2);
    ctx.stroke();
    if (mode === 'rotate') {
      const nx = half + sin * (half - 10 * dpr);
      const ny = half - cos * (half - 10 * dpr);
      ctx.fillStyle = 'rgba(232,236,243,0.85)';
      ctx.font = `700 ${10 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', nx, ny);
    }
  }
}

/** Arrow pointing along (dx, dy) with an optional view cone behind it. */
function marker(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, color: string, alpha: number, size: number, cone: boolean, dpr: number): void {
  const ang = Math.atan2(dy, dx);
  if (cone) {
    ctx.globalAlpha = alpha * 0.2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, size * 4.2, ang - 0.55, ang + 0.55);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(size * 1.4, 0);
  ctx.lineTo(-size * 0.85, size * 0.9);
  ctx.lineTo(-size * 0.35, 0);
  ctx.lineTo(-size * 0.85, -size * 0.9);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = dpr;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

export const minimap = new Minimap();
