import { SIM } from '@shared/config';
import { copyMoveState, newMoveState, stepPlayer, type MoveState } from '@shared/physics/movement';
import type { CollisionWorld } from '@shared/physics/world';
import { PFlag, WEAPON_INDEX, YOU, type InputTuple, type YouTuple } from '@shared/protocol';
import { copyWeaponState, newWeaponState, stepWeapon, type WeaponState, type WeaponStepResult } from '@shared/sim/weapon-state';
import { v3, type Vec3 } from '@shared/math';
import { WEAPONS, type WeaponId } from '@shared/weapons';

const tmpOut: WeaponStepResult = { fired: false, dryFire: false, reloadStarted: false, reloadDone: false, switched: false };

/**
 * Client-side prediction for the local player. Every input is applied
 * immediately with the shared simulation and kept until the server acknowledges
 * it; on each snapshot the authoritative state is restored and unacknowledged
 * inputs are replayed on top.
 */
export class LocalPlayer {
  id = -1;
  move: MoveState = newMoveState();
  weapon: WeaponState = newWeaponState('rifle');
  alive = false;
  hp = 100;
  armor = 50;
  respawnAt = 0;
  protected = false;
  live = false;
  seq = 0;
  pending: InputTuple[] = [];
  /** Position at the previous fixed step, for render interpolation. */
  prevPos: Vec3 = v3();
  /** Smoothed-out reconciliation error applied to the camera only. */
  visualOffset: Vec3 = v3();
  lastAck = -1;
  /** Total squared correction applied recently (for a debug readout). */
  correction = 0;
  private world: CollisionWorld;
  private replayState: MoveState = newMoveState();
  private replayWeapon: WeaponState = newWeaponState('rifle');

  constructor(world: CollisionWorld) {
    this.world = world;
  }

  setWorld(world: CollisionWorld): void {
    this.world = world;
  }

  get canAct(): boolean {
    return this.alive && this.live;
  }

  get currentWeapon(): WeaponId {
    return this.weapon.ids[this.weapon.slot];
  }

  /** Advance one fixed step with the given input. Returns the weapon step result (fired etc.). */
  step(keys: number, yaw: number, pitch: number, dt: number, renderTime: number, out: WeaponStepResult): InputTuple {
    const seq = ++this.seq;
    const input: InputTuple = [seq, dt, keys, yaw, pitch, Math.max(0, Math.round(renderTime * 10) / 10)];
    this.pending.push(input);
    if (this.pending.length > 180) this.pending.shift();
    this.prevPos.x = this.move.pos.x;
    this.prevPos.y = this.move.pos.y;
    this.prevPos.z = this.move.pos.z;
    this.apply(this.move, this.weapon, input, out);
    return input;
  }

  private apply(move: MoveState, weapon: WeaponState, input: InputTuple, out: WeaponStepResult): void {
    const [, dt, rawKeys, yaw] = input;
    const canAct = this.canAct;
    const keys = canAct ? rawKeys : 0;
    const def = WEAPONS[weapon.ids[weapon.slot]];
    if (this.alive) stepPlayer(move, keys, yaw, dt, this.world, def.moveSpeedMult);
    stepWeapon(weapon, keys, dt, canAct, out);
  }

  /**
   * Apply an authoritative snapshot of ourselves and replay unacknowledged inputs.
   * Returns the size of the position correction that was needed.
   */
  reconcile(you: YouTuple, ack: number): number {
    this.lastAck = ack;
    // Drop acknowledged inputs.
    let i = 0;
    while (i < this.pending.length && this.pending[i][0] <= ack) i++;
    if (i > 0) this.pending.splice(0, i);

    const flags = you[YOU.FLAGS];
    const wasAlive = this.alive;
    this.alive = (flags & PFlag.ALIVE) !== 0;
    this.hp = you[YOU.HP];
    this.armor = you[YOU.ARMOR];
    this.respawnAt = you[YOU.RESPAWN_AT];
    this.protected = (flags & PFlag.PROTECTED) !== 0;

    // Predicted position before applying the server state (for smoothing).
    const px = this.move.pos.x;
    const py = this.move.pos.y;
    const pz = this.move.pos.z;

    const m = this.replayState;
    m.pos.x = you[YOU.X];
    m.pos.y = you[YOU.Y];
    m.pos.z = you[YOU.Z];
    m.vel.x = you[YOU.VX];
    m.vel.y = you[YOU.VY];
    m.vel.z = you[YOU.VZ];
    m.onGround = (flags & PFlag.ON_GROUND) !== 0;
    m.crouch = (flags & PFlag.CROUCH) !== 0;
    m.sprint = (flags & PFlag.SPRINT) !== 0;
    m.jumpHeld = (flags & PFlag.JUMP_HELD) !== 0;
    m.jumped = false;
    m.landedSpeed = 0;

    const w = this.replayWeapon;
    w.slot = you[YOU.SLOT];
    const primary = WEAPON_INDEX[you[YOU.WEAPON0]] ?? this.weapon.ids[0];
    w.ids[0] = primary;
    w.ids[1] = 'pistol';
    w.ammo[0].mag = you[YOU.MAG0];
    w.ammo[0].reserve = you[YOU.RES0];
    w.ammo[1].mag = you[YOU.MAG1];
    w.ammo[1].reserve = you[YOU.RES1];
    w.reloadEndsAt = you[YOU.RELOAD_ENDS];
    w.equipEndsAt = you[YOU.EQUIP_ENDS];
    w.nextFireAt = you[YOU.NEXT_FIRE];
    w.bloom = you[YOU.BLOOM];
    w.simTime = you[YOU.SIM_TIME];
    // The server's key mask after the acknowledged input, so replayed edges match exactly.
    w.prevKeys = you[YOU.PREV_KEYS] ?? this.weapon.prevKeys;

    // Replay pending inputs on top of the authoritative state.
    for (const input of this.pending) this.apply(m, w, input, tmpOut);

    const ex = px - m.pos.x;
    const ey = py - m.pos.y;
    const ez = pz - m.pos.z;
    const err = Math.sqrt(ex * ex + ey * ey + ez * ez);
    copyMoveState(this.move, m);
    copyWeaponState(this.weapon, w);
    if (!wasAlive && this.alive) {
      // Fresh spawn: no smoothing, snap the camera.
      this.visualOffset.x = 0;
      this.visualOffset.y = 0;
      this.visualOffset.z = 0;
      this.prevPos.x = m.pos.x;
      this.prevPos.y = m.pos.y;
      this.prevPos.z = m.pos.z;
    } else if (err > 0.0005 && err < 2.5) {
      this.visualOffset.x += ex;
      this.visualOffset.y += ey;
      this.visualOffset.z += ez;
      this.correction += err;
    } else if (err >= 2.5) {
      this.visualOffset.x = 0;
      this.visualOffset.y = 0;
      this.visualOffset.z = 0;
      this.prevPos.x = m.pos.x;
      this.prevPos.y = m.pos.y;
      this.prevPos.z = m.pos.z;
    }
    return err;
  }

  /** Decay the visual smoothing offset. */
  updateSmoothing(dt: number): void {
    const k = Math.exp(-14 * dt);
    this.visualOffset.x *= k;
    this.visualOffset.y *= k;
    this.visualOffset.z *= k;
    this.correction *= Math.exp(-2 * dt);
  }

  /** Reset the seq / pending state when (re)joining a room. */
  resetForJoin(): void {
    this.seq = 0;
    this.pending = [];
    this.lastAck = -1;
    this.visualOffset.x = this.visualOffset.y = this.visualOffset.z = 0;
    this.correction = 0;
  }

  static readonly SNAPSHOT_HZ = SIM.SNAPSHOT_HZ;
}
