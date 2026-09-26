import { NET, PROTOCOL_VERSION, SIM } from './config';
import { isWeaponId, WEAPONS, type WeaponId } from './weapons';

/* ------------------------------------------------------------------ */
/* Shared data shapes                                                  */
/* ------------------------------------------------------------------ */

export type MatchPhase = 'waiting' | 'countdown' | 'live' | 'ended';

export interface PlayerInfo {
  id: number;
  name: string;
  bot: boolean;
  color: number;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  bestStreak: number;
  shots: number;
  hits: number;
  weapon: WeaponId;
  alive: boolean;
  ping: number;
}

export interface MatchInfo {
  phase: MatchPhase;
  /** Server time (ms) at which the current phase ends. */
  phaseEndsAt: number;
  map: string;
  round: number;
}

/** [seq, dt, keys, yaw, pitch, renderTime] — renderTime is the server time (ms) the client was rendering remote players at. */
export type InputTuple = [number, number, number, number, number, number];

/** Flags in snapshot tuples. */
export const PFlag = {
  ON_GROUND: 1,
  CROUCH: 2,
  SPRINT: 4,
  ALIVE: 8,
  ADS: 16,
  JUMP_HELD: 32,
  RELOADING: 64,
  PROTECTED: 128,
} as const;

/**
 * Authoritative state of the local player as a flat number array. Indices are
 * defined in `YOU` below. Times in the weapon fields are in the player's own
 * simulation clock (seconds); `respawnAt` is server time (ms).
 */
export type YouTuple = number[];
export const YOU = {
  X: 0, Y: 1, Z: 2, VX: 3, VY: 4, VZ: 5, FLAGS: 6, HP: 7, ARMOR: 8, SLOT: 9,
  MAG0: 10, RES0: 11, MAG1: 12, RES1: 13, RELOAD_ENDS: 14, EQUIP_ENDS: 15, NEXT_FIRE: 16,
  RESPAWN_AT: 17, BLOOM: 18, SIM_TIME: 19, WEAPON0: 20, PREV_KEYS: 21, LENGTH: 22,
} as const;

/** [id, x, y, z, yaw, pitch, flags, weaponIndex] */
export type RemoteTuple = [number, number, number, number, number, number, number, number];

export const WEAPON_INDEX: WeaponId[] = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol'];
export function weaponIndex(w: WeaponId): number {
  return WEAPON_INDEX.indexOf(w);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type GameEvent =
  | { e: 'shot'; id: number; w: WeaponId; o: [number, number, number]; ends: [number, number, number][]; hit: number }
  | { e: 'hit'; v: number; d: number; hs: boolean; k: boolean }
  | { e: 'dmg'; a: number; d: number; hp: number; ar: number; ax: number; ay: number; az: number }
  | { e: 'kill'; k: number; v: number; w: WeaponId | 'fall' | 'void'; hs: boolean; streak: number; milestone: number }
  | { e: 'spawn'; id: number; x: number; y: number; z: number; yaw: number }
  | { e: 'join'; p: PlayerInfo }
  | { e: 'leave'; id: number }
  | { e: 'reload'; id: number }
  | { e: 'switch'; id: number; w: WeaponId }
  | { e: 'match'; m: MatchInfo; results?: PlayerInfo[] }
  | { e: 'streak'; id: number; n: number };

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export type ClientMsg =
  | { t: 'join'; name: string; weapon: WeaponId; v: number; token?: string }
  | { t: 'in'; f: InputTuple[] }
  | { t: 'ping'; c: number; rtt: number }
  | { t: 'loadout'; weapon: WeaponId };

export type ServerMsg =
  | { t: 'welcome'; id: number; st: number; match: MatchInfo; players: PlayerInfo[]; you: YouTuple; room: string; token: string }
  | { t: 'snap'; st: number; ack: number; you: YouTuple | null; p: RemoteTuple[] }
  | { t: 'ev'; e: GameEvent[] }
  | { t: 'pong'; c: number; st: number }
  | { t: 'scores'; p: PlayerInfo[] }
  | { t: 'err'; code: string; msg: string };

/* ------------------------------------------------------------------ */
/* Validation (server side; never trust the wire)                      */
/* ------------------------------------------------------------------ */

function isFinite_(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validInput(t: unknown): t is InputTuple {
  if (!Array.isArray(t) || t.length !== 6) return false;
  const [seq, dt, keys, yaw, pitch, rt] = t;
  if (!isFinite_(rt) || rt < 0 || rt > 1e12) return false;
  if (!isFinite_(seq) || seq < 0 || seq > 1e9 || Math.floor(seq) !== seq) return false;
  if (!isFinite_(dt) || dt < SIM.MIN_INPUT_DT || dt > SIM.MAX_INPUT_DT) return false;
  if (!isFinite_(keys) || keys < 0 || keys > 0xffff || Math.floor(keys) !== keys) return false;
  if (!isFinite_(yaw) || Math.abs(yaw) > Math.PI * 2 + 1e-6) return false;
  if (!isFinite_(pitch) || Math.abs(pitch) > Math.PI / 2 + 1e-6) return false;
  return true;
}

/**
 * Parse and validate a raw client message. Returns null for anything that is
 * not exactly the shape we expect.
 */
export function parseClientMessage(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'string' || raw.length > NET.MAX_MESSAGE_BYTES) return null;
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'join': {
      if (typeof m.name !== 'string' || m.name.length > 64) return null;
      const weapon: unknown = m.weapon;
      if (!isWeaponId(weapon) || WEAPONS[weapon].slot !== 'primary') return null;
      if (!isFinite_(m.v)) return null;
      if (m.token !== undefined && (typeof m.token !== 'string' || m.token.length > 64)) return null;
      return { t: 'join', name: m.name, weapon, v: m.v, token: typeof m.token === 'string' ? m.token : undefined };
    }
    case 'in': {
      if (!Array.isArray(m.f) || m.f.length === 0 || m.f.length > NET.MAX_INPUTS_PER_MSG) return null;
      for (const f of m.f) if (!validInput(f)) return null;
      return { t: 'in', f: m.f };
    }
    case 'ping': {
      if (!isFinite_(m.c)) return null;
      const rtt = isFinite_(m.rtt) ? Math.max(0, Math.min(5000, m.rtt)) : 0;
      return { t: 'ping', c: m.c, rtt };
    }
    case 'loadout': {
      if (!isWeaponId(m.weapon)) return null;
      return { t: 'loadout', weapon: m.weapon };
    }
    default:
      return null;
  }
}

export function isCompatibleVersion(v: number): boolean {
  return v === PROTOCOL_VERSION;
}

/** Lightweight shape check for server messages on the client (defensive only). */
export function parseServerMessage(raw: unknown): ServerMsg | null {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw);
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
    return m as ServerMsg;
  } catch {
    return null;
  }
}
