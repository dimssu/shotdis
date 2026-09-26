import { clamp } from './math';

export type WeaponId = 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'pistol';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  short: string;
  slot: 'primary' | 'secondary';
  auto: boolean;
  rpm: number;
  damage: number;
  pellets: number;
  headshotMult: number;
  magSize: number;
  reserve: number;
  reloadTime: number;
  equipTime: number;
  /** Spread in degrees (half-angle of the cone). */
  spread: { hip: number; ads: number; moveAdd: number; airAdd: number; crouchMult: number };
  bloom: { perShot: number; max: number; decay: number };
  recoil: { kick: number; horiz: number; recovery: number; viewKick: number };
  falloff: { start: number; end: number; min: number };
  range: number;
  adsFov: number;
  adsTime: number;
  moveSpeedMult: number;
  tracerColor: number;
  description: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: 'rifle',
    name: 'VK-7 RIFLE',
    short: 'VK-7',
    slot: 'primary',
    auto: true,
    rpm: 640,
    damage: 22,
    pellets: 1,
    headshotMult: 1.75,
    magSize: 30,
    reserve: 120,
    reloadTime: 2.1,
    equipTime: 0.55,
    spread: { hip: 0.7, ads: 0.22, moveAdd: 1.3, airAdd: 3.0, crouchMult: 0.7 },
    bloom: { perShot: 0.11, max: 1.1, decay: 4.5 },
    recoil: { kick: 0.5, horiz: 0.22, recovery: 9, viewKick: 0.35 },
    falloff: { start: 30, end: 60, min: 0.7 },
    range: 200,
    adsFov: 0.82,
    adsTime: 0.18,
    moveSpeedMult: 1.0,
    tracerColor: 0xffd27a,
    description: 'Balanced all-rounder. Reliable at every range.',
  },
  smg: {
    id: 'smg',
    name: 'HORNET SMG',
    short: 'HORNET',
    slot: 'primary',
    auto: true,
    rpm: 900,
    damage: 15,
    pellets: 1,
    headshotMult: 1.6,
    magSize: 35,
    reserve: 140,
    reloadTime: 1.8,
    equipTime: 0.4,
    spread: { hip: 1.0, ads: 0.5, moveAdd: 0.9, airAdd: 2.4, crouchMult: 0.75 },
    bloom: { perShot: 0.09, max: 1.4, decay: 5 },
    recoil: { kick: 0.32, horiz: 0.3, recovery: 10, viewKick: 0.22 },
    falloff: { start: 14, end: 40, min: 0.55 },
    range: 120,
    adsFov: 0.88,
    adsTime: 0.14,
    moveSpeedMult: 1.05,
    tracerColor: 0xffb060,
    description: 'Shreds up close. Falls off hard at range.',
  },
  shotgun: {
    id: 'shotgun',
    name: 'BREAKER 12',
    short: 'BREAKER',
    slot: 'primary',
    auto: false,
    rpm: 78,
    damage: 9,
    pellets: 10,
    headshotMult: 1.4,
    magSize: 6,
    reserve: 30,
    reloadTime: 2.4,
    equipTime: 0.65,
    spread: { hip: 4.6, ads: 3.4, moveAdd: 0.8, airAdd: 1.5, crouchMult: 0.85 },
    bloom: { perShot: 0.4, max: 1.2, decay: 3 },
    recoil: { kick: 2.6, horiz: 0.8, recovery: 6, viewKick: 1.4 },
    falloff: { start: 6, end: 22, min: 0.18 },
    range: 45,
    adsFov: 0.9,
    adsTime: 0.2,
    moveSpeedMult: 1.0,
    tracerColor: 0xffa040,
    description: 'Devastating inside six meters. Useless past twenty.',
  },
  sniper: {
    id: 'sniper',
    name: 'LONGSHOT MK2',
    short: 'LONGSHOT',
    slot: 'primary',
    auto: false,
    rpm: 42,
    damage: 90,
    pellets: 1,
    headshotMult: 2.0,
    magSize: 5,
    reserve: 25,
    reloadTime: 3.0,
    equipTime: 0.85,
    spread: { hip: 5.0, ads: 0.02, moveAdd: 3.0, airAdd: 4.0, crouchMult: 0.8 },
    bloom: { perShot: 1.5, max: 3, decay: 3 },
    recoil: { kick: 5.5, horiz: 1.0, recovery: 4, viewKick: 2.2 },
    falloff: { start: 1000, end: 1001, min: 1 },
    range: 400,
    adsFov: 0.3,
    adsTime: 0.28,
    moveSpeedMult: 0.92,
    tracerColor: 0x8ae9ff,
    description: 'One headshot. Two body shots. Scope in or miss.',
  },
  pistol: {
    id: 'pistol',
    name: 'P9 SIDEARM',
    short: 'P9',
    slot: 'secondary',
    auto: false,
    rpm: 420,
    damage: 28,
    pellets: 1,
    headshotMult: 2.0,
    magSize: 12,
    reserve: 60,
    reloadTime: 1.35,
    equipTime: 0.3,
    spread: { hip: 0.8, ads: 0.4, moveAdd: 0.9, airAdd: 2.0, crouchMult: 0.8 },
    bloom: { perShot: 0.28, max: 1.5, decay: 5 },
    recoil: { kick: 1.2, horiz: 0.4, recovery: 11, viewKick: 0.7 },
    falloff: { start: 20, end: 45, min: 0.65 },
    range: 120,
    adsFov: 0.9,
    adsTime: 0.12,
    moveSpeedMult: 1.08,
    tracerColor: 0xffe08a,
    description: 'Fast draw, punchy headshots. Never runs dry when it counts.',
  },
};

export const PRIMARY_WEAPONS: WeaponId[] = ['rifle', 'smg', 'shotgun', 'sniper'];
export const WEAPON_IDS: WeaponId[] = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol'];

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === 'string' && (WEAPON_IDS as string[]).includes(v);
}

export function fireInterval(def: WeaponDef): number {
  return 60 / def.rpm;
}

/** Damage multiplier by distance. */
export function falloffMultiplier(def: WeaponDef, dist: number): number {
  const { start, end, min } = def.falloff;
  if (dist <= start) return 1;
  if (dist >= end) return min;
  const t = (dist - start) / (end - start);
  return 1 - (1 - min) * t;
}

export function damageAt(def: WeaponDef, dist: number, headshot: boolean): number {
  const base = def.damage * (headshot ? def.headshotMult : 1);
  return base * falloffMultiplier(def, dist);
}

export interface SpreadContext {
  ads: boolean;
  /** Horizontal speed divided by walk speed (0..~1.4). */
  moveFrac: number;
  airborne: boolean;
  crouch: boolean;
  bloom: number;
}

/** Spread cone half-angle in degrees for the current stance. */
export function spreadDegrees(def: WeaponDef, c: SpreadContext): number {
  const m = clamp(c.moveFrac, 0, 1.4);
  let s = (c.ads ? def.spread.ads : def.spread.hip) + def.spread.moveAdd * m * (c.ads ? 0.5 : 1);
  if (c.airborne) s += def.spread.airAdd;
  if (c.crouch) s *= def.spread.crouchMult;
  s += c.bloom;
  return s;
}

export interface AmmoState {
  mag: number;
  reserve: number;
}

export function defaultAmmo(def: WeaponDef): AmmoState {
  return { mag: def.magSize, reserve: def.reserve };
}

/** Amount moved from reserve into the magazine on reload completion. */
export function reloadAmounts(def: WeaponDef, a: AmmoState): AmmoState {
  const need = def.magSize - a.mag;
  const take = Math.min(need, a.reserve);
  return { mag: a.mag + take, reserve: a.reserve - take };
}
