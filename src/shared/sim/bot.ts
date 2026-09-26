import { MOVE, PLAYER } from '../config';
import type { NavPoint } from '../maps/types';
import { clamp, dirFromYawPitch, v3, wrapAngle, yawTowards, type Vec3 } from '../math';
import { Keys, eyeHeight } from '../physics/movement';
import type { CollisionWorld } from '../physics/world';
import type { Rng } from '../util/rng';
import { WEAPONS, type WeaponId } from '../weapons';
import type { SimPlayer } from './player';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

interface BotProfile {
  reaction: number;
  aimErrorStart: number;
  aimErrorMin: number;
  aimSettle: number;
  turnSpeed: number;
  fireCone: number;
  burstOn: [number, number];
  burstOff: [number, number];
  headshotBias: number;
}

const PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { reaction: 0.55, aimErrorStart: 9, aimErrorMin: 3.2, aimSettle: 1.6, turnSpeed: 4.5, fireCone: 6, burstOn: [0.2, 0.4], burstOff: [0.3, 0.6], headshotBias: 0.1 },
  normal: { reaction: 0.38, aimErrorStart: 6, aimErrorMin: 1.8, aimSettle: 1.2, turnSpeed: 6.5, fireCone: 4.5, burstOn: [0.3, 0.6], burstOff: [0.2, 0.4], headshotBias: 0.25 },
  hard: { reaction: 0.24, aimErrorStart: 4, aimErrorMin: 0.9, aimSettle: 0.9, turnSpeed: 9, fireCone: 3.2, burstOn: [0.4, 0.8], burstOff: [0.12, 0.25], headshotBias: 0.45 },
};

const PREFERRED_RANGE: Record<WeaponId, number> = { rifle: 13, smg: 8, shotgun: 4.5, sniper: 26, pistol: 9 };

export interface BotWorldView {
  world: CollisionWorld;
  nav: NavPoint[];
  navAdj: number[][];
  now: number;
  live: boolean;
  alivePlayers(): Iterable<SimPlayer>;
}

export interface BotInput {
  keys: number;
  yaw: number;
  pitch: number;
}

const eyeA = v3();
const eyeB = v3();
const aimDir = v3();

/** Breadth-first path over the nav graph. Returns node indices including `to`, excluding `from`. */
export function findPath(adj: number[][], from: number, to: number): number[] {
  if (from === to) return [to];
  const prev = new Int32Array(adj.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    for (const m of adj[n]) {
      if (prev[m] !== -1) continue;
      prev[m] = n;
      if (m === to) {
        const path: number[] = [];
        let c = to;
        while (c !== from) {
          path.push(c);
          c = prev[c];
        }
        return path.reverse();
      }
      queue.push(m);
    }
  }
  return [];
}

export function nearestNav(nav: NavPoint[], p: Vec3): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < nav.length; i++) {
    const n = nav[i];
    const dx = n.x - p.x;
    const dz = n.z - p.z;
    const dy = (n.y - p.y) * 2;
    const d = dx * dx + dz * dz + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export class BotBrain {
  private profile: BotProfile;
  private targetId = -1;
  private targetSince = 0;
  private lastSeenAt = 0;
  private lastSeenPos = v3();
  private path: number[] = [];
  private pathIdx = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private lastPos = v3();
  private stuckTimer = 0;
  private perceiveTimer = 0;
  private burstTimer = 0;
  private burstOn = false;
  private noisePhase: number;
  private semiToggle = false;
  private yaw = 0;
  private pitch = 0;
  private wantsCrouch = false;
  private crouchTimer = 0;

  constructor(
    public readonly player: SimPlayer,
    difficulty: BotDifficulty,
    private rng: Rng,
  ) {
    this.profile = PROFILES[difficulty];
    this.noisePhase = rng.range(0, 100);
    this.yaw = player.yaw;
  }

  reset(): void {
    this.targetId = -1;
    this.path = [];
    this.pathIdx = 0;
    this.stuckTimer = 0;
    this.yaw = this.player.yaw;
    this.pitch = 0;
  }

  think(view: BotWorldView, dt: number, out: BotInput): void {
    const p = this.player;
    const pr = this.profile;
    let keys = 0;
    if (!p.alive || !view.live) {
      out.keys = 0;
      out.yaw = this.yaw;
      out.pitch = this.pitch;
      return;
    }
    const now = view.now;

    // ---- Perception (throttled) ----
    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      this.perceiveTimer = 0.12;
      eyeA.x = p.move.pos.x;
      eyeA.y = p.move.pos.y + eyeHeight(p.move.crouch);
      eyeA.z = p.move.pos.z;
      let best: SimPlayer | null = null;
      let bd = Infinity;
      for (const q of view.alivePlayers()) {
        if (q === p) continue;
        const dx = q.move.pos.x - p.move.pos.x;
        const dz = q.move.pos.z - p.move.pos.z;
        const d = dx * dx + dz * dz;
        if (d > 70 * 70 || d >= bd) continue;
        eyeB.x = q.move.pos.x;
        eyeB.y = q.move.pos.y + eyeHeight(q.move.crouch) * 0.7;
        eyeB.z = q.move.pos.z;
        if (!view.world.lineOfSight(eyeA, eyeB)) continue;
        best = q;
        bd = d;
      }
      if (best) {
        if (best.id !== this.targetId) {
          this.targetId = best.id;
          this.targetSince = now;
        }
        this.lastSeenAt = now;
        this.lastSeenPos.x = best.move.pos.x;
        this.lastSeenPos.y = best.move.pos.y;
        this.lastSeenPos.z = best.move.pos.z;
      } else if (this.targetId !== -1 && now - this.lastSeenAt > 1500) {
        this.targetId = -1;
        // Chase toward last seen position.
        const goal = nearestNav(view.nav, this.lastSeenPos);
        const from = nearestNav(view.nav, p.move.pos);
        if (goal >= 0 && from >= 0) {
          this.path = findPath(view.navAdj, from, goal);
          this.pathIdx = 0;
        }
      }
    }

    let target: SimPlayer | null = null;
    if (this.targetId !== -1) {
      for (const q of view.alivePlayers()) if (q.id === this.targetId) target = q;
      if (!target) this.targetId = -1;
    }

    const def = WEAPONS[p.currentWeapon];
    const ammo = p.weapon.ammo[p.weapon.slot];
    let desiredYaw = this.yaw;
    let desiredPitch = 0;
    let wantFire = false;
    let dist = 0;

    if (target && now - this.lastSeenAt < 1500) {
      const dx = target.move.pos.x - p.move.pos.x;
      const dz = target.move.pos.z - p.move.pos.z;
      dist = Math.hypot(dx, dz);
      const headY = target.move.pos.y + (target.move.crouch ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT) - PLAYER.HEAD_RADIUS;
      const chestY = target.move.pos.y + (target.move.crouch ? 0.8 : 1.25);
      const aimHead = this.rng.next() < pr.headshotBias || def.id === 'sniper';
      const ty = aimHead ? headY : chestY;
      const eyeY = p.move.pos.y + eyeHeight(p.move.crouch);
      desiredYaw = yawTowards(p.move.pos.x, p.move.pos.z, target.move.pos.x, target.move.pos.z);
      desiredPitch = Math.atan2(ty - eyeY, dist);
      // Aim error that settles the longer the target is tracked.
      const onTarget = clamp((now - this.targetSince) / 1000 / pr.aimSettle, 0, 1);
      const err = (pr.aimErrorStart + (pr.aimErrorMin - pr.aimErrorStart) * onTarget) * (Math.PI / 180);
      const ph = this.noisePhase + now * 0.004;
      desiredYaw += Math.sin(ph) * err * 0.8 + Math.sin(ph * 2.7) * err * 0.35;
      desiredPitch += Math.cos(ph * 1.3) * err * 0.5;

      // Positioning: hold preferred range and strafe.
      const pref = PREFERRED_RANGE[def.id];
      if (dist > pref * 1.25) keys |= Keys.FWD;
      else if (dist < pref * 0.55) keys |= Keys.BACK;
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = this.rng.range(0.5, 1.3);
        this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
        if (this.rng.next() < 0.18) this.strafeDir = 0;
      }
      if (this.strafeDir === 1) keys |= Keys.RIGHT;
      else if (this.strafeDir === -1) keys |= Keys.LEFT;
      if (def.id === 'sniper') keys |= Keys.ADS;
      this.crouchTimer -= dt;
      if (this.crouchTimer <= 0) {
        this.crouchTimer = this.rng.range(1, 3);
        this.wantsCrouch = this.rng.next() < 0.2 && def.id !== 'shotgun';
      }
      if (this.wantsCrouch && dist > 8) keys |= Keys.CROUCH;
      if (this.rng.next() < 0.004 && dist < 12) keys |= Keys.JUMP;

      // Fire when settled and inside the fire cone.
      const reacted = now - this.targetSince >= pr.reaction * 1000;
      dirFromYawPitch(this.yaw, this.pitch, aimDir);
      const tdx = target.move.pos.x - p.move.pos.x;
      const tdy = chestY - eyeY;
      const tdz = target.move.pos.z - p.move.pos.z;
      const tl = Math.hypot(tdx, tdy, tdz) || 1;
      const cosA = (aimDir.x * tdx + aimDir.y * tdy + aimDir.z * tdz) / tl;
      const angErr = Math.acos(clamp(cosA, -1, 1)) * (180 / Math.PI);
      const cone = pr.fireCone + (def.id === 'shotgun' ? 4 : 0);
      if (reacted && angErr < cone && dist < def.range * 0.85) wantFire = true;
    } else {
      // ---- Navigation ----
      if (this.path.length === 0 || this.pathIdx >= this.path.length) {
        const from = nearestNav(view.nav, p.move.pos);
        if (view.nav.length > 1 && from >= 0) {
          let goal = from;
          for (let i = 0; i < 6 && goal === from; i++) goal = this.rng.int(0, view.nav.length - 1);
          this.path = findPath(view.navAdj, from, goal);
          this.pathIdx = 0;
        }
      }
      const node = this.path[this.pathIdx];
      if (node !== undefined) {
        const n = view.nav[node];
        const dx = n.x - p.move.pos.x;
        const dz = n.z - p.move.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.9) this.pathIdx++;
        else {
          desiredYaw = yawTowards(p.move.pos.x, p.move.pos.z, n.x, n.z);
          keys |= Keys.FWD;
          if (n.y > p.move.pos.y + 0.6 && d < 2.5) keys |= Keys.JUMP;
          if (this.rng.next() < 0.7) keys |= Keys.SPRINT;
        }
      }
      desiredPitch = 0;
      if (ammo.mag < def.magSize * 0.5 && ammo.reserve > 0) keys |= Keys.RELOAD;
    }

    // ---- Turn toward desired aim with limited speed ----
    const maxTurn = pr.turnSpeed * dt;
    const dy = wrapAngle(desiredYaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + clamp(dy, -maxTurn, maxTurn));
    const dp = desiredPitch - this.pitch;
    this.pitch = clamp(this.pitch + clamp(dp, -maxTurn, maxTurn), -1.4, 1.4);

    // ---- Weapon management: fall back to the sidearm when the primary is dry, return when it is not ----
    const other = p.weapon.ammo[1 - p.weapon.slot];
    if (ammo.mag === 0 && ammo.reserve === 0 && other.mag + other.reserve > 0) {
      keys |= p.weapon.slot === 0 ? Keys.SLOT2 : Keys.SLOT1;
    } else if (p.weapon.slot === 1 && p.weapon.ammo[0].mag + p.weapon.ammo[0].reserve > 0 && !target) {
      keys |= Keys.SLOT1;
    }

    // ---- Trigger discipline ----
    if (wantFire) {
      if (ammo.mag === 0) keys |= Keys.RELOAD;
      else if (def.auto) {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          this.burstOn = !this.burstOn;
          const r = this.burstOn ? pr.burstOn : pr.burstOff;
          this.burstTimer = this.rng.range(r[0], r[1]);
        }
        if (this.burstOn) keys |= Keys.FIRE;
      } else {
        this.semiToggle = !this.semiToggle;
        if (this.semiToggle) keys |= Keys.FIRE;
      }
    } else {
      this.burstOn = false;
      this.burstTimer = 0;
    }

    // ---- Stuck detection ----
    const moved = Math.hypot(p.move.pos.x - this.lastPos.x, p.move.pos.z - this.lastPos.z);
    if ((keys & (Keys.FWD | Keys.BACK | Keys.LEFT | Keys.RIGHT)) !== 0 && moved < MOVE.WALK_SPEED * dt * 0.25) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.6) keys |= Keys.JUMP;
      if (this.stuckTimer > 1.6) {
        this.path = [];
        this.pathIdx = 0;
        this.stuckTimer = 0;
        this.strafeDir = -this.strafeDir;
      }
    } else this.stuckTimer = 0;
    this.lastPos.x = p.move.pos.x;
    this.lastPos.z = p.move.pos.z;

    out.keys = keys;
    out.yaw = this.yaw;
    out.pitch = this.pitch;
  }
}
