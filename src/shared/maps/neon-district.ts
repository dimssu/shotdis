import { box, cbox, crate, nav, perimeter, ramp, spawnTowards, stairs, strip } from './builders';
import { finalizeMap } from './finalize';
import type { MapDef, Solid } from './types';

const bounds = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
const C = 1.1;

function lamp(x: number, z: number): Solid[] {
  return [cbox('metal_dark', x, 0, z, 0.22, 5, 0.22), strip('lamp', x - 0.35, 4.9, z - 0.35, 0.7, 0.2, 0.7)];
}

function windows(x: number, y: number, z: number, w: number, d: number, rows: number, mat: 'neon_cyan' | 'neon_magenta' | 'neon_amber' | 'neon_white'): Solid[] {
  const out: Solid[] = [];
  for (let r = 0; r < rows; r++) out.push(strip(mat, x, y + r * 2.2, z, w, 0.5, d));
  return out;
}

const solids: Solid[] = [
  // Street
  box('asphalt', -24, -1, -24, 48, 1, 48),
  box('concrete_dark', -24, -0.995, -24, 48, 1, 2),
  ...perimeter('panel_dark', bounds, 12, 1),

  // ---- Corner buildings ----
  box('panel', -24, 0, -24, 14, 10, 12), // B1 NW
  box('brick', 10, 0, -24, 14, 12, 10), // B2 NE
  box('panel_dark', -24, 0, 12, 12, 9, 12), // B3 SW
  box('brick', 12, 0, 12, 12, 11, 12), // B4 SE
  // Facade details
  ...windows(-23, 4.5, -11.98, 12, 0.05, 2, 'neon_cyan'),
  ...windows(10.02, 3.5, -22, 0.05, 6, 3, 'neon_amber'),
  ...windows(-11.98, 3, 14, 0.05, 8, 2, 'neon_magenta'),
  ...windows(13, 4, 11.98, 10, 0.05, 2, 'neon_white'),
  strip('neon_magenta', -9.98, 6, -22, 0.06, 3, 0.4), // vertical sign B1 east face
  strip('neon_cyan', 11.98, 6, 14, 0.06, 3, 0.4),
  strip('trim', -24, 9.98, -24, 14, 0.3, 12),
  strip('trim', 10, 11.98, -24, 14, 0.3, 10),
  strip('trim', -24, 8.98, 12, 12, 0.3, 12),
  strip('trim', 12, 10.98, 12, 12, 0.3, 12),

  // ---- NW balcony (y = 3.3) along B1 south face, stairs at the west end ----
  box('metal_dark', -24, 3.0, -12, 14, 0.3, 3),
  box('metal', -22, 3.3, -9.1, 12, 0.9, 0.1),
  ...stairs('metal_dark', -24, 0, -3, 'z', -1, 7, 0.86, 0.47, 2),
  strip('neon_cyan', -24, 3.32, -9.15, 14, 0.06, 0.06),

  // ---- SE balcony (y = 3.3) along B4 north face, stairs at the east end ----
  box('metal_dark', 12, 3.0, 9, 12, 0.3, 3),
  box('metal', 12, 3.3, 9.0, 10, 0.9, 0.1),
  ...stairs('metal_dark', 22, 0, 3, 'z', 1, 7, 0.86, 0.47, 2),
  strip('neon_magenta', 12, 3.32, 9.1, 12, 0.06, 0.06),

  // ---- Central kiosk (roof at 3.2): stairs west, ramp east ----
  cbox('panel', 0, 0, 0, 8, 3.2, 8),
  ...stairs('metal_dark', -10.3, 0, -1, 'x', 1, 7, 0.9, 0.457, 2),
  ramp('concrete', 4, 0, -1.5, 6, 3.2, 3, 'x', -1),
  box('metal', -4, 3.2, -4, 8, 0.5, 0.25),
  box('metal', -4, 3.2, 3.75, 8, 0.5, 0.25),
  strip('neon_cyan', -4.02, 2.4, -4.02, 8.04, 0.15, 8.04),
  strip('neon_white', -3, 1.6, -4.03, 2.5, 0.8, 0.05),
  strip('neon_magenta', 0.5, 1.6, 4.0, 2.5, 0.8, 0.05),
  cbox('metal_dark', 0, 3.2, 0, 1.2, 1.4, 1.2), // roof vent for cover

  // ---- North street: storefront + island ----
  box('panel_dark', -6, 0, -24, 12, 5, 4),
  strip('neon_amber', -5, 3.6, -19.97, 10, 0.6, 0.05),
  strip('glass', -5.5, 0.8, -19.98, 11, 2.2, 0.03),
  cbox('concrete_dark', 0, 0, -15.5, 4, 1.1, 2),
  crate(-8.5, 0, -18, C), crate(-7.4, 0, -18, C), crate(-8.5, C, -18, C, 'crate_dark'),
  crate(7, 0, -17, C),
  ...lamp(-8, -13.5),
  ...lamp(8, -13.5),

  // ---- South street: subway entrance + planters ----
  box('panel', -3, 0, 20, 6, 2.5, 3),
  strip('neon_cyan', -2.5, 2.55, 20, 5, 0.3, 0.05),
  box('concrete_dark', -10, 0, 16, 5, 0.9, 1),
  box('concrete_dark', 5, 0, 16, 5, 0.9, 1),
  crate(9, 0, 20, C), crate(9, C, 20, C, 'crate_dark'), crate(10.1, 0, 20, C),
  crate(-9, 0, 21, C),
  ...lamp(-8, 13.5),
  ...lamp(8, 13.5),

  // ---- West street: truck, dumpsters, planter ----
  box('panel', -22.5, 0, 2, 2.6, 3.0, 7),
  strip('neon_white', -19.92, 1.0, 3, 0.05, 0.8, 2.6),
  cbox('metal_dark', -15, 0, 6, 2.2, 1.3, 1.3),
  cbox('metal_dark', -17.5, 0, 6, 2.2, 1.3, 1.3),
  box('concrete_dark', -19, 0, 0, 5, 0.9, 1),
  crate(-13, 0, -5, C), crate(-13, C, -5, C, 'crate_dark'), crate(-14.1, 0, -5, C),
  ...lamp(-13.5, 10),

  // ---- East street: shelter, sign column, benches ----
  cbox('metal_dark', 15.5, 0, -6, 0.2, 2.6, 0.2),
  cbox('metal_dark', 20.5, 0, -6, 0.2, 2.6, 0.2),
  cbox('metal_dark', 15.5, 0, -3.6, 0.2, 2.6, 0.2),
  cbox('metal_dark', 20.5, 0, -3.6, 0.2, 2.6, 0.2),
  box('glass', 15.2, 2.5, -6.4, 5.6, 0.15, 3.2),
  box('metal', 15.5, 0, -6.2, 5, 0.5, 0.5),
  cbox('panel_dark', 20, 0, 4, 1.5, 6, 1.5),
  strip('neon_magenta', 19.2, 1, 3.22, 1.6, 4, 0.06),
  strip('neon_magenta', 19.2, 1, 4.72, 1.6, 4, 0.06),
  box('concrete_dark', 14, 0, 1, 1, 0.9, 5),
  crate(16, 0, 6, C), crate(17.1, 0, 6, C),
  ...lamp(13.5, -10),

  // ---- Alley clutter ----
  crate(-9.5, 0, -22.5, C),
  crate(8.5, 0, -22.5, C),
  cbox('metal_dark', -10.5, 0, 18, 1.4, 1.3, 1.4),

  // Road markings
  strip('stripe', -0.15, 0.001, -20, 0.3, 0.01, 40),
  strip('stripe', -24, 0.001, -0.15, 48, 0.01, 0.3),
];

export const NEON_DISTRICT: MapDef = finalizeMap({
  id: 'neon',
  name: 'NEON DISTRICT',
  tagline: 'Rain-slick streets, glowing alleys and rooftop sightlines.',
  bounds,
  sky: { top: 0x070a16, bottom: 0x1a1332, fog: 0x0f0c22, fogNear: 22, fogFar: 85 },
  ambient: { sky: 0x5a63c8, ground: 0x2a1a3a, intensity: 0.9 },
  sun: { dir: [0.3, 1, -0.5], color: 0x9fb4ff, intensity: 0.9 },
  solids,
  spawns: [
    spawnTowards(-18, 0, -10.5, 0, 0),
    spawnTowards(-17, 0, 10, 0, 0),
    spawnTowards(20, 0, -10, 0, 0),
    spawnTowards(20, 0, 9, 0, 0),
    spawnTowards(0, 0, -19, 0, 0),
    spawnTowards(6, 0, 19, 0, 0),
    spawnTowards(-17, 3.3, -10.5, 0, 0),
    spawnTowards(18, 3.3, 10.5, 0, 0),
  ],
  nav: [
    // North street
    nav(-8, 0, -20.5), nav(-3, 0, -18), nav(3, 0, -18), nav(8, 0, -20.5), nav(-5, 0, -14), nav(5, 0, -14), nav(0, 0, -12),
    // West street
    nav(-19, 0, -10), nav(-17, 0, -9), nav(-19, 0, -3), nav(-15, 0, -1), nav(-17, 0, 3), nav(-16, 0, 9), nav(-21, 0, 10.5), nav(-13, 0, 4), nav(-12.5, 0, 8),
    // East street
    nav(18, 0, -11), nav(14, 0, -8), nav(18, 0, -1), nav(16.5, 0, 3), nav(21, 0, 0), nav(18, 0, 8), nav(13, 0, 8), nav(22, 0, -8),
    // South street
    nav(-7, 0, 14), nav(7, 0, 14), nav(0, 0, 13), nav(-6, 0, 19), nav(6, 0, 19), nav(0, 0, 17.5), nav(-10, 0, 21),
    // Around kiosk
    nav(-7, 0, -6), nav(7, 0, -6), nav(-7, 0, 6), nav(7, 0, 6), nav(0, 0, -7), nav(0, 0, 7), nav(-7, 0, 2), nav(10.5, 0, 0),
    // Kiosk stairs / ramp / roof
    nav(-8.5, 1.4, 0), nav(-5.5, 2.75, 0), nav(-2.5, 3.2, 0), nav(2.5, 3.2, 0), nav(0, 3.2, -2.5), nav(0, 3.2, 2.5), nav(7, 1.6, 0),
    // NW balcony
    nav(-23, 0.94, -4.3), nav(-23, 1.88, -6.05), nav(-23, 2.82, -7.7), nav(-22, 3.3, -10.5), nav(-17, 3.3, -10.5), nav(-12, 3.3, -10.5),
    // SE balcony
    nav(23, 0.94, 4.3), nav(23, 1.88, 6.05), nav(23, 2.82, 7.7), nav(22, 3.3, 10.5), nav(17, 3.3, 10.5), nav(13, 3.3, 10.5),
  ],
  navLinks: [],
  lights: [
    { x: 0, y: 5, z: -20, color: 0xffb347, intensity: 7, distance: 16 },
    { x: -12, y: 4, z: -20, color: 0xff4fa3, intensity: 6, distance: 14 },
    { x: 20, y: 4, z: 4, color: 0xff4fa3, intensity: 6, distance: 14 },
    { x: 0, y: 4, z: 0, color: 0x4df2c9, intensity: 6, distance: 16 },
    { x: -16, y: 5, z: -10, color: 0x4df2c9, intensity: 4, distance: 12 },
    { x: 0, y: 3.5, z: 21, color: 0x4df2c9, intensity: 4, distance: 12 },
  ],
  particles: 'rain',
});
