import type { BoxSolid, MapDef, MaterialId, NavPoint, RampSolid, Solid, SpawnPoint } from './types';

/** Box with `x,y,z` as the minimum corner. */
export function box(mat: MaterialId, x: number, y: number, z: number, w: number, h: number, d: number, collide = true): BoxSolid {
  return { kind: 'box', x, y, z, w, h, d, mat, collide };
}

/** Box centered on x/z (y is still the bottom). */
export function cbox(mat: MaterialId, cx: number, y: number, cz: number, w: number, h: number, d: number, collide = true): BoxSolid {
  return box(mat, cx - w / 2, y, cz - d / 2, w, h, d, collide);
}

export function ramp(mat: MaterialId, x: number, y: number, z: number, w: number, h: number, d: number, axis: 'x' | 'z', dir: 1 | -1): RampSolid {
  return { kind: 'ramp', x, y, z, w, h, d, axis, dir, mat };
}

/**
 * Staircase built from boxes. Starts at (x,y,z) and climbs along `axis` in `dir`.
 * `width` is the extent across the other axis.
 */
export function stairs(
  mat: MaterialId,
  x: number,
  y: number,
  z: number,
  axis: 'x' | 'z',
  dir: 1 | -1,
  steps: number,
  stepRun: number,
  stepRise: number,
  width: number,
): Solid[] {
  const out: Solid[] = [];
  for (let i = 0; i < steps; i++) {
    const h = stepRise * (i + 1);
    const along = i * stepRun;
    if (axis === 'x') {
      const sx = dir === 1 ? x + along : x - along - stepRun;
      out.push(box(mat, sx, y, z, stepRun, h, width));
    } else {
      const sz = dir === 1 ? z + along : z - along - stepRun;
      out.push(box(mat, x, y, sz, width, h, stepRun));
    }
  }
  return out;
}

export function crate(x: number, y: number, z: number, size = 1.2, mat: MaterialId = 'crate'): BoxSolid {
  return box(mat, x, y, z, size, size, size);
}

/** A thin glowing strip, non-colliding. */
export function strip(mat: MaterialId, x: number, y: number, z: number, w: number, h: number, d: number): BoxSolid {
  return box(mat, x, y, z, w, h, d, false);
}

export function spawn(x: number, y: number, z: number, yawDeg: number): SpawnPoint {
  return { x, y, z, yaw: (yawDeg * Math.PI) / 180 };
}

export function nav(x: number, y: number, z: number): NavPoint {
  return { x, y, z };
}

/** Connect nav points that are within `maxDist` of each other and share a similar height. */
export function autoLinks(points: NavPoint[], maxDist: number, maxRise = 1.6): [number, number][] {
  const links: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= maxDist && Math.abs(a.y - b.y) <= maxRise) links.push([i, j]);
    }
  }
  return links;
}

/** Four boundary walls around the map bounds. */
export function perimeter(mat: MaterialId, b: MapDef['bounds'], height: number, thickness = 1): Solid[] {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  return [
    box(mat, b.minX - thickness, 0, b.minZ - thickness, w + thickness * 2, height, thickness),
    box(mat, b.minX - thickness, 0, b.maxZ, w + thickness * 2, height, thickness),
    box(mat, b.minX - thickness, 0, b.minZ, thickness, height, d),
    box(mat, b.maxX, 0, b.minZ, thickness, height, d),
  ];
}

export function spawnTowards(x: number, y: number, z: number, tx: number, tz: number): SpawnPoint {
  return { x, y, z, yaw: Math.atan2(-(tx - x), -(tz - z)) };
}
