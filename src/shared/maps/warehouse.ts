import { box, cbox, crate, nav, perimeter, ramp, spawnTowards, stairs, strip } from './builders';
import { finalizeMap } from './finalize';
import type { MapDef, Solid } from './types';

const bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
const C = 1.1; // crate size

function crateStack(x: number, z: number, n: number, mat: 'crate' | 'crate_dark' | 'crate_green' = 'crate'): Solid[] {
  const out: Solid[] = [];
  for (let i = 0; i < n; i++) out.push(crate(x, i * C, z, C, i % 2 === 0 ? mat : 'crate_dark'));
  return out;
}

const solids: Solid[] = [
  // Floor slabs
  box('floor', -20, -1, -20, 40, 1, 40),
  box('floor_dark', -20, -0.995, -20, 40, 1, 8),
  box('floor_dark', -20, -0.995, 12, 40, 1, 8),
  // Perimeter walls (7m tall) with a lighter trim band
  ...perimeter('concrete', bounds, 7, 1),
  ...perimeter('concrete_dark', { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, 0.6, 1.01),
  // Girder ring near the top (decor)
  strip('metal_dark', -20, 6.4, -20, 40, 0.3, 0.3),
  strip('metal_dark', -20, 6.4, 19.7, 40, 0.3, 0.3),
  strip('metal_dark', -20, 6.4, -20, 0.3, 0.3, 40),
  strip('metal_dark', 19.7, 6.4, -20, 0.3, 0.3, 40),
  // Light strips high on the walls
  strip('neon_white', -18, 5.2, -19.98, 8, 0.15, 0.05),
  strip('neon_white', 10, 5.2, -19.98, 8, 0.15, 0.05),
  strip('neon_white', -18, 5.2, 19.93, 8, 0.15, 0.05),
  strip('neon_white', 10, 5.2, 19.93, 8, 0.15, 0.05),
  strip('neon_amber', -19.98, 5.2, -6, 0.05, 0.15, 12),
  strip('neon_amber', 19.93, 5.2, -6, 0.05, 0.15, 12),

  // ---- North mezzanine (y = 3.8) with stairs at both ends ----
  box('metal_dark', -20, 3.5, -20, 40, 0.3, 4),
  box('metal', -18, 3.8, -16.1, 10, 1.0, 0.1), // railing west segment (gap at the stairs)
  box('metal', 8, 3.8, -16.1, 10, 1.0, 0.1), // railing east segment
  ...stairs('metal_dark', -12, 0, -16, 'x', -1, 8, 0.9, 0.475, 2),
  ...stairs('metal_dark', 12, 0, -16, 'x', 1, 8, 0.9, 0.475, 2),
  // Cover on the mezzanine
  ...crateStack(-3, -19, 1),
  ...crateStack(2, -19, 1),
  strip('neon_cyan', -8, 3.85, -16.2, 16, 0.08, 0.08),

  // ---- Central hub: raised platform with ramps north and south ----
  box('concrete_dark', -4, 0, -4, 8, 1.2, 8),
  ramp('concrete', -2, 0, 4, 4, 1.2, 4, 'z', -1),
  ramp('concrete', -2, 0, -8, 4, 1.2, 4, 'z', 1),
  cbox('metal_dark', 0, 1.2, 0, 2, 3.4, 2),
  strip('neon_cyan', -1.02, 2.2, -1.02, 2.04, 0.1, 2.04),
  ...crateStack(-3.9, -3.9, 1, 'crate_green'),
  ...crateStack(2.8, 2.8, 1, 'crate_green'),
  strip('stripe', -4.2, 0.001, -4.2, 8.4, 0.01, 0.3),
  strip('stripe', -4.2, 0.001, 3.9, 8.4, 0.01, 0.3),

  // ---- Pillars ----
  cbox('concrete_dark', -10, 0, -10, 0.8, 7, 0.8),
  cbox('concrete_dark', 10, 0, -10, 0.8, 7, 0.8),
  cbox('concrete_dark', -10, 0, 10, 0.8, 7, 0.8),
  cbox('concrete_dark', 10, 0, 10, 0.8, 7, 0.8),
  cbox('concrete_dark', 0, 0, 12, 0.8, 7, 0.8),
  cbox('concrete_dark', 0, 0, -12, 0.8, 7, 0.8),

  // ---- Containers ----
  box('panel', -16, 0, 2, 2.6, 2.6, 7),
  strip('neon_magenta', -16.02, 1.2, 3, 0.05, 0.12, 5),
  box('panel', 13.4, 0, -9, 7, 2.6, 2.6),
  strip('neon_amber', 14, 1.2, -9.02, 5, 0.12, 0.05),
  box('crate_green', 4, 0, 12, 7, 2.6, 2.6),
  ...crateStack(11.2, 12.7, 1),
  ...crateStack(11.2, 11.5, 2),

  // ---- East perch (y = 2.7) with ramp from the south ----
  box('metal_dark', 15, 2.4, -3, 5, 0.3, 8),
  box('metal', 14.95, 2.7, -3, 0.1, 1.0, 5),
  ramp('metal_dark', 16, 0, 5, 3, 2.7, 6, 'z', -1),
  strip('neon_cyan', 15, 2.72, -3.05, 5, 0.06, 0.06),

  // ---- West perch (y = 2.7) with ramp from the north ----
  box('metal_dark', -20, 2.4, -6, 5, 0.3, 8),
  box('metal', -15.05, 2.7, -4, 0.1, 1.0, 5),
  ramp('metal_dark', -19, 0, -12, 3, 2.7, 6, 'z', 1),
  strip('neon_magenta', -20, 2.72, 1.95, 5, 0.06, 0.06),

  // ---- South loading dock (y = 1.0) ----
  box('concrete', -20, 0, 16, 40, 1.0, 4),
  box('concrete', -6, 0, 15.2, 12, 0.5, 0.8),
  strip('stripe', -20, 1.001, 16, 40, 0.01, 0.35),
  ...crateStack(-14, 17.5, 1),
  ...crateStack(-12.9, 17.5, 1),
  ...crateStack(12, 17.5, 2),
  ...crateStack(6, 18, 1),

  // ---- Low cover walls ----
  box('concrete', -8, 0, -4, 0.4, 1.0, 6),
  box('concrete', 7.6, 0, -2, 0.4, 1.0, 6),
  box('concrete', -3, 0, 10.5, 6, 1.0, 0.4),
  box('concrete', -9, 0, -13, 6, 1.0, 0.4),
  box('concrete', 3, 0, -13, 6, 1.0, 0.4),

  // ---- Crate clusters ----
  ...crateStack(-13, -9, 1),
  ...crateStack(-11.9, -9, 2),
  ...crateStack(-9, -12, 1),
  ...crateStack(12, -14, 1),
  ...crateStack(13.1, -14, 1),
  ...crateStack(9, -11, 1),
  ...crateStack(-12, 10, 2),
  ...crateStack(-13.1, 10, 1),
  ...crateStack(-8, 14, 1),
  ...crateStack(10, 6, 1),
  ...crateStack(11.1, 6, 1),
  ...crateStack(14, 9, 1),
  ...crateStack(-6, -1, 1),
  ...crateStack(5.5, 2.5, 1),
  ...crateStack(-16, -16, 1),
  ...crateStack(16, 14, 1),

  // Floor markings
  strip('stripe', -1.5, 0.001, -20, 0.25, 0.01, 40),
  strip('stripe', 1.25, 0.001, -20, 0.25, 0.01, 40),
];

export const WAREHOUSE: MapDef = finalizeMap({
  id: 'warehouse',
  name: 'WAREHOUSE',
  tagline: 'Compact industrial arena. Crates, catwalks and tight corners.',
  bounds,
  sky: { top: 0x1b2230, bottom: 0x3a4250, fog: 0x2a3140, fogNear: 25, fogFar: 95 },
  ambient: { sky: 0x9fb2c8, ground: 0x3a2f28, intensity: 0.85 },
  sun: { dir: [-0.45, 1, 0.35], color: 0xffe6c4, intensity: 1.8 },
  solids,
  spawns: [
    spawnTowards(-17, 0, -12.5, 0, 0),
    spawnTowards(17, 0, -12.5, 0, 0),
    spawnTowards(-17, 0, 13, 0, 0),
    spawnTowards(17, 0, 13, 0, 0),
    spawnTowards(0, 3.8, -18, 0, 0),
    spawnTowards(0, 1.0, 18, 0, 0),
    spawnTowards(-17.5, 2.7, -2, 0, 0),
    spawnTowards(17.5, 2.7, 1, 0, 0),
  ],
  nav: [
    // Floor grid
    nav(-17, 0, -13), nav(-13, 0, -12.5), nav(-8, 0, -15), nav(-3, 0, -15), nav(3, 0, -15), nav(8, 0, -15), nav(13, 0, -12), nav(17, 0, -13),
    nav(-14.5, 0, -8), nav(-11, 0, -6), nav(-6, 0, -7), nav(0, 0, -10.5), nav(5, 0, -7), nav(10, 0, -6), nav(16, 0, -6),
    nav(-12, 0, 0), nav(-6, 0, 3), nav(0, 0, 9.2), nav(6, 0, -1), nav(11, 0, 1), nav(12, 0, -3), nav(13.5, 0, 7), nav(17.5, 0, 12.5),
    nav(-16, 0, 12), nav(-11, 0, 7), nav(-6, 0, 11), nav(-2, 0, 13), nav(3, 0, 10), nav(8, 0, 9), nav(13, 0, 13), nav(-18, 0, 15),
    nav(-3, 0, 14), nav(1, 0, 14),
    // Hub
    nav(0, 0.6, 6), nav(0, 1.2, 2.8), nav(-2.8, 1.2, 0), nav(2.8, 1.2, 0), nav(0, 1.2, -2.8), nav(0, 0.6, -6),
    // Dock
    nav(-8, 1.0, 18), nav(0, 1.0, 18), nav(8, 1.0, 18), nav(0, 0.5, 15.45),
    // Mezzanine and stairs
    nav(-12.45, 0.475, -15), nav(-15, 1.9, -15), nav(-17, 2.85, -15), nav(-18.75, 3.8, -15),
    nav(-18.5, 3.8, -18), nav(-12, 3.8, -18), nav(-6, 3.8, -18), nav(0, 3.8, -18), nav(6, 3.8, -18), nav(12, 3.8, -18), nav(18.5, 3.8, -18),
    nav(12.45, 0.475, -15), nav(15, 1.9, -15), nav(17, 2.85, -15), nav(18.75, 3.8, -15),
    // West perch
    nav(-17.5, 1.35, -9), nav(-17.5, 2.7, -4), nav(-17.5, 2.7, 0),
    // East perch
    nav(17.5, 1.35, 8), nav(17.5, 2.7, 4), nav(17.5, 2.7, -1),
  ],
  navLinks: [],
  lights: [
    { x: 0, y: 4.5, z: 0, color: 0x4df2c9, intensity: 6, distance: 14 },
    { x: -15, y: 3.5, z: 5, color: 0xff4fa3, intensity: 5, distance: 12 },
    { x: 16, y: 3.5, z: -8, color: 0xffb347, intensity: 5, distance: 12 },
  ],
  particles: 'dust',
});
