export type MaterialId =
  | 'concrete'
  | 'concrete_dark'
  | 'floor'
  | 'floor_dark'
  | 'metal'
  | 'metal_dark'
  | 'crate'
  | 'crate_dark'
  | 'crate_green'
  | 'stripe'
  | 'panel'
  | 'panel_dark'
  | 'asphalt'
  | 'brick'
  | 'roof'
  | 'trim'
  | 'glass'
  | 'neon_cyan'
  | 'neon_magenta'
  | 'neon_amber'
  | 'neon_white'
  | 'lamp';

export interface MaterialDef {
  color: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
  /** Purely decorative materials never receive shadows (cheaper). */
  glow?: boolean;
}

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  concrete: { color: 0x8d9099, roughness: 0.95, metalness: 0.0 },
  concrete_dark: { color: 0x5a5d66, roughness: 0.95, metalness: 0.0 },
  floor: { color: 0x6a6d76, roughness: 0.9, metalness: 0.05 },
  floor_dark: { color: 0x3f424a, roughness: 0.9, metalness: 0.05 },
  metal: { color: 0x9aa3ad, roughness: 0.45, metalness: 0.7 },
  metal_dark: { color: 0x4b525b, roughness: 0.5, metalness: 0.7 },
  crate: { color: 0xa87c4f, roughness: 0.85, metalness: 0.0 },
  crate_dark: { color: 0x7a5a3a, roughness: 0.85, metalness: 0.0 },
  crate_green: { color: 0x5f7a4d, roughness: 0.85, metalness: 0.0 },
  stripe: { color: 0xe0b83a, roughness: 0.8, metalness: 0.1 },
  panel: { color: 0x2b3340, roughness: 0.6, metalness: 0.4 },
  panel_dark: { color: 0x1a1f28, roughness: 0.6, metalness: 0.4 },
  asphalt: { color: 0x2c2f36, roughness: 0.95, metalness: 0.0 },
  brick: { color: 0x6b4a44, roughness: 0.9, metalness: 0.0 },
  roof: { color: 0x3a3d45, roughness: 0.9, metalness: 0.1 },
  trim: { color: 0xc8ccd4, roughness: 0.7, metalness: 0.2 },
  glass: { color: 0x2f4a5a, roughness: 0.15, metalness: 0.6 },
  neon_cyan: { color: 0x4df2c9, roughness: 0.4, metalness: 0, emissive: 0x4df2c9, emissiveIntensity: 2.2, glow: true },
  neon_magenta: { color: 0xff4fa3, roughness: 0.4, metalness: 0, emissive: 0xff4fa3, emissiveIntensity: 2.0, glow: true },
  neon_amber: { color: 0xffb347, roughness: 0.4, metalness: 0, emissive: 0xffb347, emissiveIntensity: 1.8, glow: true },
  neon_white: { color: 0xf4f7ff, roughness: 0.4, metalness: 0, emissive: 0xf4f7ff, emissiveIntensity: 1.6, glow: true },
  lamp: { color: 0xfff1cc, roughness: 0.5, metalness: 0, emissive: 0xfff1cc, emissiveIntensity: 1.4, glow: true },
};

export interface BoxSolid {
  kind: 'box';
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  mat: MaterialId;
  /** Defaults to true. Decorative pieces (light strips, signs) set false. */
  collide?: boolean;
}

export interface RampSolid {
  kind: 'ramp';
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** Axis along which the ramp rises. */
  axis: 'x' | 'z';
  /** +1 rises toward +axis, -1 toward -axis. */
  dir: 1 | -1;
  mat: MaterialId;
}

export type Solid = BoxSolid | RampSolid;

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

export interface PointLightDef {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

export interface MapDef {
  id: string;
  name: string;
  tagline: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  sky: { top: number; bottom: number; fog: number; fogNear: number; fogFar: number };
  ambient: { sky: number; ground: number; intensity: number };
  sun: { dir: [number, number, number]; color: number; intensity: number };
  solids: Solid[];
  spawns: SpawnPoint[];
  nav: NavPoint[];
  navLinks: [number, number][];
  lights: PointLightDef[];
  particles: 'dust' | 'rain' | 'none';
}
