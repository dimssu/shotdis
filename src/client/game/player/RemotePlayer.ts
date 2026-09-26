import * as THREE from 'three';
import { SIM } from '@shared/config';
import { PFlag, WEAPON_INDEX, type PlayerInfo, type RemoteTuple } from '@shared/protocol';
import { lerpAngle } from '@shared/math';
import type { WeaponId } from '@shared/weapons';
import { PlayerModel } from './PlayerModel';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  weapon: number;
}

/**
 * A remote player rendered with snapshot interpolation. We render a fixed delay
 * behind the newest server time, interpolating between the two surrounding
 * samples and extrapolating briefly if a snapshot is late.
 */
export class RemotePlayer {
  info: PlayerInfo;
  model: PlayerModel;
  private samples: Sample[] = [];
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouch = false;
  alive = false;
  speed = 0;
  weapon: WeaponId = 'rifle';
  private lastWeapon = -1;
  private everSampled = false;

  constructor(info: PlayerInfo, shadows: boolean) {
    this.info = info;
    this.model = new PlayerModel(info.color, info.name + (info.bot ? '' : ''), shadows);
    this.model.setWeapon(info.weapon);
    this.model.setVisible(false);
  }

  push(t: number, r: RemoteTuple): void {
    const s: Sample = { t, x: r[1], y: r[2], z: r[3], yaw: r[4], pitch: r[5], flags: r[6], weapon: r[7] };
    const n = this.samples.length;
    if (n > 0 && this.samples[n - 1].t >= t) return; // out of order / duplicate
    this.samples.push(s);
    if (n > 30) this.samples.splice(0, n - 30);
    if (!this.everSampled) {
      this.everSampled = true;
      this.pos.set(s.x, s.y, s.z);
      this.yaw = s.yaw;
      this.alive = (s.flags & PFlag.ALIVE) !== 0;
    }
  }

  /** Teleport (spawn event): drop stale samples so we do not slide across the map. */
  teleport(x: number, y: number, z: number, yaw: number): void {
    this.samples = [];
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.speed = 0;
  }

  update(renderTime: number, dt: number, now: number, camera: THREE.Camera): void {
    const s = this.samples;
    const n = s.length;
    if (n === 0) {
      this.model.update(this.pos.x, this.pos.y, this.pos.z, this.yaw, this.pitch, this.crouch, 0, this.alive, dt, now, this.pos.distanceToSquared(camera.position));
      return;
    }
    let a: Sample | null = null;
    let b: Sample | null = null;
    for (let i = n - 1; i >= 0; i--) {
      if (s[i].t <= renderTime) {
        a = s[i];
        b = s[i + 1] ?? null;
        break;
      }
    }
    let x: number;
    let y: number;
    let z: number;
    let yaw: number;
    let pitch: number;
    let flags: number;
    let weapon: number;
    if (a && b) {
      const span = b.t - a.t;
      const t = span > 0 ? Math.min(1, (renderTime - a.t) / span) : 1;
      x = a.x + (b.x - a.x) * t;
      y = a.y + (b.y - a.y) * t;
      z = a.z + (b.z - a.z) * t;
      yaw = lerpAngle(a.yaw, b.yaw, t);
      pitch = a.pitch + (b.pitch - a.pitch) * t;
      flags = t < 0.5 ? a.flags : b.flags;
      weapon = b.weapon;
    } else if (a) {
      // Newest sample is older than render time: extrapolate a little using the last two samples.
      const prev = s[n - 2];
      const ahead = Math.min(SIM.MAX_EXTRAPOLATE_MS, renderTime - a.t);
      if (prev && a.t > prev.t && (a.flags & PFlag.ALIVE)) {
        const span = a.t - prev.t;
        const vx = (a.x - prev.x) / span;
        const vy = (a.y - prev.y) / span;
        const vz = (a.z - prev.z) / span;
        x = a.x + vx * ahead;
        y = a.y + vy * ahead;
        z = a.z + vz * ahead;
      } else {
        x = a.x;
        y = a.y;
        z = a.z;
      }
      yaw = a.yaw;
      pitch = a.pitch;
      flags = a.flags;
      weapon = a.weapon;
    } else {
      // Render time is before our oldest sample (just joined): hold the oldest.
      const f = s[0];
      x = f.x;
      y = f.y;
      z = f.z;
      yaw = f.yaw;
      pitch = f.pitch;
      flags = f.flags;
      weapon = f.weapon;
    }
    if (dt > 0) {
      const dx = x - this.pos.x;
      const dz = z - this.pos.z;
      const inst = Math.sqrt(dx * dx + dz * dz) / dt;
      this.speed += (Math.min(inst, 12) - this.speed) * Math.min(1, dt * 10);
    }
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.crouch = (flags & PFlag.CROUCH) !== 0;
    const alive = (flags & PFlag.ALIVE) !== 0;
    if (alive !== this.alive) this.alive = alive;
    if (weapon !== this.lastWeapon) {
      this.lastWeapon = weapon;
      this.weapon = WEAPON_INDEX[weapon] ?? 'rifle';
      this.model.setWeapon(this.weapon);
    }
    if (!this.model.group.visible && this.everSampled) this.model.setVisible(true);
    this.model.update(x, y, z, yaw, pitch, this.crouch, this.speed, alive, dt, now, this.pos.distanceToSquared(camera.position));
  }

  dispose(): void {
    this.model.dispose();
  }
}
