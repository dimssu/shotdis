import type { MapDef } from '../maps/types';
import type { Vec3 } from '../math';

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface RampShape extends AABB {
  axis: 'x' | 'z';
  dir: 1 | -1;
}

export interface RayHit {
  hit: boolean;
  dist: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

export function newRayHit(): RayHit {
  return { hit: false, dist: Infinity, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

/** Surface height of a ramp at horizontal position (x, z), clamped to the footprint. */
export function rampHeightAt(r: RampShape, x: number, z: number): number {
  const h = r.maxY - r.minY;
  let t: number;
  if (r.axis === 'x') {
    const len = r.maxX - r.minX;
    t = r.dir === 1 ? (x - r.minX) / len : (r.maxX - x) / len;
  } else {
    const len = r.maxZ - r.minZ;
    t = r.dir === 1 ? (z - r.minZ) / len : (r.maxZ - z) / len;
  }
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return r.minY + h * t;
}

/**
 * Static collision world built from map solids. Kept deliberately simple: axis
 * aligned boxes plus wedge ramps. Maps are a few hundred solids at most, so a
 * brute force broadphase is faster than maintaining a spatial structure.
 */
export class CollisionWorld {
  boxes: AABB[] = [];
  ramps: RampShape[] = [];
  bounds: AABB = { minX: -1e9, minY: -1e9, minZ: -1e9, maxX: 1e9, maxY: 1e9, maxZ: 1e9 };

  static fromMap(map: MapDef): CollisionWorld {
    const w = new CollisionWorld();
    for (const s of map.solids) {
      if (s.kind === 'box') {
        if (s.collide === false) continue;
        w.boxes.push({ minX: s.x, minY: s.y, minZ: s.z, maxX: s.x + s.w, maxY: s.y + s.h, maxZ: s.z + s.d });
      } else {
        w.ramps.push({
          minX: s.x,
          minY: s.y,
          minZ: s.z,
          maxX: s.x + s.w,
          maxY: s.y + s.h,
          maxZ: s.z + s.d,
          axis: s.axis,
          dir: s.dir,
        });
      }
    }
    w.bounds = { minX: map.bounds.minX, maxX: map.bounds.maxX, minZ: map.bounds.minZ, maxZ: map.bounds.maxZ, minY: -50, maxY: 100 };
    return w;
  }

  /** True if the AABB intersects any solid (ramps use their surface height at the center). */
  overlapsAny(b: AABB): boolean {
    for (const s of this.boxes) if (aabbOverlap(b, s)) return true;
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    for (const r of this.ramps) {
      if (b.minX < r.maxX && b.maxX > r.minX && b.minZ < r.maxZ && b.maxZ > r.minZ) {
        const h = rampHeightAt(r, cx, cz);
        if (b.minY < h - 0.01 && b.maxY > r.minY) return true;
      }
    }
    return false;
  }

  /**
   * Ray cast against all static geometry. Fills `out` with the nearest hit.
   * Direction must be normalized.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RayHit): boolean {
    out.hit = false;
    out.dist = maxDist;
    const invX = 1 / dx;
    const invY = 1 / dy;
    const invZ = 1 / dz;
    for (const b of this.boxes) {
      let tmin = 0;
      let tmax = out.dist;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      // X slab
      let t1 = (b.minX - ox) * invX;
      let t2 = (b.maxX - ox) * invX;
      let n = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = n;
        ny = 0;
        nz = 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
      // Y slab
      t1 = (b.minY - oy) * invY;
      t2 = (b.maxY - oy) * invY;
      n = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = n;
        nz = 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
      // Z slab
      t1 = (b.minZ - oz) * invZ;
      t2 = (b.maxZ - oz) * invZ;
      n = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        n = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = 0;
        nz = n;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
      if (tmin < out.dist && tmin > 0) {
        out.hit = true;
        out.dist = tmin;
        out.nx = nx;
        out.ny = ny;
        out.nz = nz;
      }
    }
    for (const r of this.ramps) {
      const t = rayVsRamp(r, ox, oy, oz, dx, dy, dz, out.dist, tmpN);
      if (t >= 0 && t < out.dist) {
        out.hit = true;
        out.dist = t;
        out.nx = tmpN[0];
        out.ny = tmpN[1];
        out.nz = tmpN[2];
      }
    }
    if (out.hit) {
      out.x = ox + dx * out.dist;
      out.y = oy + dy * out.dist;
      out.z = oz + dz * out.dist;
    }
    return out.hit;
  }

  /** Straight line-of-sight test between two points. */
  lineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    return !this.raycast(a.x, a.y, a.z, dx / len, dy / len, dz / len, len, losHit);
  }
}

const losHit = newRayHit();
const tmpN: [number, number, number] = [0, 0, 0];

/** Ray vs convex ramp (AABB planes + slope plane). Returns t or -1. */
function rayVsRamp(
  r: RampShape,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  outN: [number, number, number],
): number {
  let tmin = 0;
  let tmax = maxDist;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const clip = (pnx: number, pny: number, pnz: number, pd: number): boolean => {
    const denom = pnx * dx + pny * dy + pnz * dz;
    const num = pd - (pnx * ox + pny * oy + pnz * oz);
    if (Math.abs(denom) < 1e-9) return num >= 0;
    const t = num / denom;
    if (denom > 0) {
      if (t < tmax) tmax = t;
    } else if (t > tmin) {
      tmin = t;
      nx = pnx;
      ny = pny;
      nz = pnz;
    }
    return tmin <= tmax;
  };
  if (!clip(-1, 0, 0, -r.minX)) return -1;
  if (!clip(1, 0, 0, r.maxX)) return -1;
  if (!clip(0, -1, 0, -r.minY)) return -1;
  if (!clip(0, 1, 0, r.maxY)) return -1;
  if (!clip(0, 0, -1, -r.minZ)) return -1;
  if (!clip(0, 0, 1, r.maxZ)) return -1;
  const h = r.maxY - r.minY;
  if (r.axis === 'x') {
    const k = h / (r.maxX - r.minX);
    if (r.dir === 1) {
      const l = Math.hypot(k, 1);
      if (!clip(-k / l, 1 / l, 0, (r.minY - k * r.minX) / l)) return -1;
    } else {
      const l = Math.hypot(k, 1);
      if (!clip(k / l, 1 / l, 0, (r.minY + k * r.maxX) / l)) return -1;
    }
  } else {
    const k = h / (r.maxZ - r.minZ);
    if (r.dir === 1) {
      const l = Math.hypot(k, 1);
      if (!clip(0, 1 / l, -k / l, (r.minY - k * r.minZ) / l)) return -1;
    } else {
      const l = Math.hypot(k, 1);
      if (!clip(0, 1 / l, k / l, (r.minY + k * r.maxZ) / l)) return -1;
    }
  }
  if (tmin <= 0) return -1;
  outN[0] = nx;
  outN[1] = ny;
  outN[2] = nz;
  return tmin;
}

/** Ray vs sphere. Returns t or -1. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, radius: number): number {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t0 = tca - thc;
  const t1 = tca + thc;
  if (t0 > 0) return t0;
  if (t1 > 0) return t1;
  return -1;
}

/** Ray vs AABB. Returns t or -1. */
export function rayAABB(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: AABB): number {
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mins = [b.minX, b.minY, b.minZ];
  const maxs = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d[i];
    let t1 = (mins[i] - o[i]) * inv;
    let t2 = (maxs[i] - o[i]) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin > 0 ? tmin : tmax > 0 ? 0 : -1;
}
