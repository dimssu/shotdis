import { COMBAT, SIM } from '../config';
import { newMoveState, type MoveState } from '../physics/movement';
import { PFlag, YOU, type PlayerInfo, type YouTuple, type InputTuple, weaponIndex } from '../protocol';
import { round2, round3 } from '../math';
import type { WeaponId } from '../weapons';
import { isReloading, newWeaponState, type WeaponState } from './weapon-state';

export interface HistorySample {
  t: number;
  x: number;
  y: number;
  z: number;
  crouch: boolean;
  alive: boolean;
}

export const PLAYER_COLORS = [0x4df2c9, 0xff4fa3, 0xffb347, 0x8ae9ff, 0xc3ff5a, 0xff6b6b, 0xb28bff, 0xfff28a];

const HISTORY_LEN = Math.ceil((SIM.HISTORY_MS / 1000) * SIM.SNAPSHOT_HZ) + 2;

export class SimPlayer {
  move: MoveState = newMoveState();
  yaw = 0;
  pitch = 0;
  hp: number = COMBAT.MAX_HP;
  armor: number = COMBAT.SPAWN_ARMOR;
  alive = false;
  respawnAt = 0;
  protectedUntil = 0;
  weapon: WeaponState;
  /** Primary weapon to use on the next spawn. */
  pendingPrimary: WeaponId;

  kills = 0;
  deaths = 0;
  score = 0;
  streak = 0;
  bestStreak = 0;
  shots = 0;
  hits = 0;
  headshots = 0;
  damageDealt = 0;

  lastSeq = -1;
  inputQueue: InputTuple[] = [];
  /** Seconds of simulation this client is currently allowed to run. */
  timeBudget = 0.1;
  lastInputWall = 0;
  renderTime = 0;
  ping = 0;
  connected = true;
  joinedAt = 0;
  /** Set when a fire input was processed this tick; used to attach yaw/pitch to hitscan. */
  history: HistorySample[] = [];
  private historyHead = 0;

  constructor(
    public readonly id: number,
    public name: string,
    public readonly bot: boolean,
    public readonly color: number,
    primary: WeaponId,
  ) {
    this.weapon = newWeaponState(primary);
    this.pendingPrimary = primary;
    for (let i = 0; i < HISTORY_LEN; i++) this.history.push({ t: -1, x: 0, y: 0, z: 0, crouch: false, alive: false });
  }

  get currentWeapon(): WeaponId {
    return this.weapon.ids[this.weapon.slot];
  }

  info(): PlayerInfo {
    return {
      id: this.id,
      name: this.name,
      bot: this.bot,
      color: this.color,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      weapon: this.weapon.ids[0],
      alive: this.alive,
      ping: this.ping,
    };
  }

  resetStats(): void {
    this.kills = 0;
    this.deaths = 0;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.shots = 0;
    this.hits = 0;
    this.headshots = 0;
    this.damageDealt = 0;
  }

  flags(now: number): number {
    let f = 0;
    if (this.move.onGround) f |= PFlag.ON_GROUND;
    if (this.move.crouch) f |= PFlag.CROUCH;
    if (this.move.sprint) f |= PFlag.SPRINT;
    if (this.alive) f |= PFlag.ALIVE;
    if (this.move.jumpHeld) f |= PFlag.JUMP_HELD;
    if (isReloading(this.weapon)) f |= PFlag.RELOADING;
    if (this.protectedUntil > now) f |= PFlag.PROTECTED;
    return f;
  }

  youTuple(now: number, adsHeld: boolean): YouTuple {
    const w = this.weapon;
    const t: number[] = new Array(YOU.LENGTH);
    t[YOU.X] = round3(this.move.pos.x);
    t[YOU.Y] = round3(this.move.pos.y);
    t[YOU.Z] = round3(this.move.pos.z);
    t[YOU.VX] = round3(this.move.vel.x);
    t[YOU.VY] = round3(this.move.vel.y);
    t[YOU.VZ] = round3(this.move.vel.z);
    t[YOU.FLAGS] = this.flags(now) | (adsHeld ? PFlag.ADS : 0);
    t[YOU.HP] = Math.round(this.hp);
    t[YOU.ARMOR] = Math.round(this.armor);
    t[YOU.SLOT] = w.slot;
    t[YOU.MAG0] = w.ammo[0].mag;
    t[YOU.RES0] = w.ammo[0].reserve;
    t[YOU.MAG1] = w.ammo[1].mag;
    t[YOU.RES1] = w.ammo[1].reserve;
    t[YOU.RELOAD_ENDS] = round3(w.reloadEndsAt);
    t[YOU.EQUIP_ENDS] = round3(w.equipEndsAt);
    t[YOU.NEXT_FIRE] = round3(w.nextFireAt);
    t[YOU.RESPAWN_AT] = this.alive ? 0 : Math.round(this.respawnAt);
    t[YOU.BLOOM] = round3(w.bloom);
    t[YOU.SIM_TIME] = round3(w.simTime);
    t[YOU.WEAPON0] = weaponIndex(w.ids[0]);
    return t;
  }

  remoteTuple(now: number, adsHeld: boolean): [number, number, number, number, number, number, number, number] {
    return [
      this.id,
      round2(this.move.pos.x),
      round2(this.move.pos.y),
      round2(this.move.pos.z),
      round3(this.yaw),
      round3(this.pitch),
      this.flags(now) | (adsHeld ? PFlag.ADS : 0),
      weaponIndex(this.currentWeapon),
    ];
  }

  pushHistory(t: number): void {
    const s = this.history[this.historyHead];
    s.t = t;
    s.x = this.move.pos.x;
    s.y = this.move.pos.y;
    s.z = this.move.pos.z;
    s.crouch = this.move.crouch;
    s.alive = this.alive;
    this.historyHead = (this.historyHead + 1) % this.history.length;
  }

  /**
   * Reconstruct where this player was at server time `t`, interpolating between
   * the stored snapshot samples (which is what remote clients render).
   */
  sampleHistory(t: number, out: HistorySample): boolean {
    const n = this.history.length;
    let newer: HistorySample | null = null;
    let older: HistorySample | null = null;
    for (let i = 1; i <= n; i++) {
      const s = this.history[(this.historyHead - i + n) % n];
      if (s.t < 0) break;
      if (s.t >= t) newer = s;
      else {
        older = s;
        break;
      }
    }
    if (!older && !newer) return false;
    if (!older) {
      Object.assign(out, newer);
      return true;
    }
    if (!newer) {
      Object.assign(out, older);
      return true;
    }
    const span = newer.t - older.t;
    const a = span > 0 ? (t - older.t) / span : 1;
    out.t = t;
    out.x = older.x + (newer.x - older.x) * a;
    out.y = older.y + (newer.y - older.y) * a;
    out.z = older.z + (newer.z - older.z) * a;
    out.crouch = a < 0.5 ? older.crouch : newer.crouch;
    out.alive = older.alive && newer.alive;
    return true;
  }
}
