import * as THREE from 'three';
import { PLAYER } from '@shared/config';
import { clamp, damp } from '@shared/math';

export interface RigInput {
  x: number;
  y: number;
  z: number;
  crouch: boolean;
  speed: number;
  onGround: boolean;
  landedSpeed: number;
  sprint: boolean;
  adsAmount: number;
  adsFov: number;
  alive: boolean;
  reducedMotion: boolean;
}

const MAX_PITCH = Math.PI / 2 - 0.01;

/**
 * First-person camera: owns the aim angles, applies recoil (with partial
 * automatic recovery), view kick, head bob, landing dip and shake.
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  /** Horizontal FOV setting in degrees. */
  hFov = 95;
  private recoilPending = 0;
  private recoilRecovery = 8;
  private kickPitch = 0;
  private kickYaw = 0;
  private kickRoll = 0;
  private bobT = 0;
  private bobX = 0;
  private bobY = 0;
  private dip = 0;
  private dipVel = 0;
  private shakeAmt = 0;
  private eyeY: number = PLAYER.EYE_HEIGHT;
  private fovMult = 1;
  private deadT = 0;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private lastLandedSpeed = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.05, 400);
  }

  setAim(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
  }

  /** Apply mouse motion. `sens` is radians per pixel. */
  look(dx: number, dy: number, sens: number): void {
    this.yaw -= dx * sens;
    const dp = -dy * sens;
    // Pulling down while recoil is pending counts as compensation.
    if (dp < 0 && this.recoilPending > 0) this.recoilPending = Math.max(0, this.recoilPending + dp * 0.9);
    this.pitch = clamp(this.pitch + dp, -MAX_PITCH, MAX_PITCH);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** Weapon recoil: kicks the actual aim up and randomly sideways; part of it recovers on its own. */
  recoil(kickDeg: number, horizDeg: number, recovery: number, viewKickDeg: number, reducedMotion: boolean): void {
    const kick = (kickDeg * Math.PI) / 180;
    const horiz = ((Math.random() * 2 - 1) * horizDeg * Math.PI) / 180;
    this.pitch = clamp(this.pitch + kick, -MAX_PITCH, MAX_PITCH);
    this.yaw += horiz;
    this.recoilPending += kick * 0.65;
    this.recoilRecovery = recovery;
    if (!reducedMotion) {
      const vk = (viewKickDeg * Math.PI) / 180;
      this.kickPitch += vk;
      this.kickYaw += horiz * 0.6;
      this.kickRoll += (Math.random() - 0.5) * vk * 0.8;
    }
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1, this.shakeAmt + amount);
  }

  update(dt: number, inp: RigInput, aspect: number): void {
    // Recoil auto-recovery
    if (this.recoilPending > 0) {
      const rec = this.recoilPending * (1 - Math.exp(-this.recoilRecovery * dt));
      this.pitch -= rec;
      this.recoilPending -= rec;
      if (this.recoilPending < 1e-4) this.recoilPending = 0;
    }
    // View kick spring
    const kd = Math.exp(-13 * dt);
    this.kickPitch *= kd;
    this.kickYaw *= kd;
    this.kickRoll *= kd;
    // Head bob
    const bobAmp = inp.reducedMotion || !inp.onGround || !inp.alive ? 0 : 0.011 * clamp(inp.speed / 5.4, 0, 1.4);
    if (bobAmp > 0) this.bobT += dt * inp.speed * 1.55;
    this.bobY = damp(this.bobY, Math.sin(this.bobT * 2) * bobAmp, 14, dt);
    this.bobX = damp(this.bobX, Math.cos(this.bobT) * bobAmp * 0.7, 14, dt);
    // Landing dip (spring)
    if (inp.landedSpeed > 2.5 && inp.landedSpeed !== this.lastLandedSpeed && !inp.reducedMotion) {
      this.dipVel -= clamp(inp.landedSpeed * 0.09, 0.2, 1.1);
    }
    this.lastLandedSpeed = inp.landedSpeed;
    const k = 90;
    const c = 14;
    this.dipVel += (-k * this.dip - c * this.dipVel) * dt;
    this.dip += this.dipVel * dt;
    // Shake
    this.shakeAmt *= Math.exp(-9 * dt);
    const sh = inp.reducedMotion ? 0 : this.shakeAmt;
    // Eye height (smooth crouch)
    const targetEye = inp.crouch ? PLAYER.CROUCH_EYE_HEIGHT : PLAYER.EYE_HEIGHT;
    this.eyeY = damp(this.eyeY, targetEye, 16, dt);
    // FOV
    const sprintMult = inp.sprint && !inp.reducedMotion ? 1.07 : 1;
    const target = (1 + (inp.adsFov - 1) * inp.adsAmount) * sprintMult;
    this.fovMult = damp(this.fovMult, target, 18, dt);
    const hRad = (this.hFov * Math.PI) / 180;
    const vFov = 2 * Math.atan(Math.tan(hRad / 2) / aspect) * this.fovMult;
    const cam = this.camera;
    const vDeg = (vFov * 180) / Math.PI;
    if (Math.abs(cam.fov - vDeg) > 0.01 || cam.aspect !== aspect) {
      cam.fov = vDeg;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    // Death view: sink and roll.
    if (!inp.alive) this.deadT = Math.min(1, this.deadT + dt * 2.5);
    else this.deadT = Math.max(0, this.deadT - dt * 6);
    const dead = this.deadT * this.deadT;
    const eye = this.eyeY * (1 - dead) + 0.45 * dead;

    cam.position.set(inp.x + this.bobX * Math.cos(this.yaw), inp.y + eye + this.bobY + this.dip, inp.z - this.bobX * Math.sin(this.yaw));
    const shakeP = (Math.random() - 0.5) * 0.04 * sh;
    const shakeY = (Math.random() - 0.5) * 0.04 * sh;
    this.euler.set(this.pitch + this.kickPitch + shakeP - dead * 0.35, this.yaw + this.kickYaw + shakeY, this.kickRoll + dead * 0.45 + this.bobX * 0.6);
    cam.quaternion.setFromEuler(this.euler);
  }
}
