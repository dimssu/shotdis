import * as THREE from 'three';
import { PLAYER } from '@shared/config';
import type { WeaponId } from '@shared/weapons';
import { makeTextTexture } from '../world/textures';

/*
 * Procedural low-poly soldier. The model is built facing local +Z and the
 * group is turned by yaw + PI, because the game's yaw 0 looks toward -Z.
 * The front reads at a glance: a lit face with eyes and a nose, a chest plate,
 * and arms plus weapon that follow the player's aim. The back carries a pack.
 */

const SKIN_TONES = [0xf1c9a5, 0xd9a47a, 0xb07a52, 0x7d5236, 0xe8b894];

const bodyGeo = new THREE.BoxGeometry(0.52, 0.66, 0.3);
const chestGeo = new THREE.BoxGeometry(0.3, 0.22, 0.05);
const shoulderGeo = new THREE.BoxGeometry(0.62, 0.12, 0.34);
const packGeo = new THREE.BoxGeometry(0.36, 0.42, 0.14);
const headGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const bandGeo = new THREE.BoxGeometry(0.36, 0.06, 0.36);
const faceGeo = new THREE.BoxGeometry(0.28, 0.22, 0.02);
const eyeGeo = new THREE.BoxGeometry(0.075, 0.06, 0.012);
const pupilGeo = new THREE.BoxGeometry(0.034, 0.04, 0.01);
const browGeo = new THREE.BoxGeometry(0.085, 0.018, 0.012);
const noseGeo = new THREE.BoxGeometry(0.045, 0.06, 0.05);
const mouthGeo = new THREE.BoxGeometry(0.1, 0.018, 0.01);
const limbGeo = new THREE.BoxGeometry(0.16, 0.7, 0.16);
const armGeo = new THREE.BoxGeometry(0.12, 0.56, 0.12);
const gunGeo = new THREE.BoxGeometry(0.09, 0.12, 0.7);

const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2129, roughness: 0.7, metalness: 0.2 });
const limbMat = new THREE.MeshStandardMaterial({ color: 0x2b303b, roughness: 0.8, metalness: 0.1 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.5, metalness: 0.6 });
const featureMat = new THREE.MeshStandardMaterial({ color: 0x2a1c18, roughness: 0.9 });
// Unlit so eyes stay readable in the darkest corner of Neon District.
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0d1014 });
const skinMats = SKIN_TONES.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0 }));

/** Shoulder height of the aim pivot, standing. */
const SHOULDER_Y = 1.32;

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function box(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export class PlayerModel {
  group = new THREE.Group();
  private head: THREE.Group;
  private torso: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  /** Arms and weapon hang off this pivot so they tilt with the player's aim. */
  private aim = new THREE.Group();
  private gun: THREE.Mesh;
  private accentMat: THREE.MeshStandardMaterial;
  private nameSprite: THREE.Sprite | null = null;
  private nameAspect = 1;
  private walkPhase = 0;
  private flashUntil = 0;
  private deadT = -1;
  private crouchAmount = 0;
  private visibleTarget = true;
  private parts: THREE.Mesh[] = [];
  readonly color: number;

  constructor(color: number, name: string, shadows: boolean) {
    this.color = color;
    this.accentMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3, emissive: color, emissiveIntensity: 0.25 });
    const g = this.group;
    g.rotation.order = 'YXZ'; // tip over in the body's own frame when killed

    // Torso: chest plate on the front, pack on the back.
    this.torso = new THREE.Mesh(bodyGeo, darkMat);
    this.torso.position.y = 1.08;
    const chest = box(chestGeo, this.accentMat, 0, 0.1, 0.17);
    const shoulders = box(shoulderGeo, this.accentMat, 0, 0.36, 0);
    const pack = box(packGeo, limbMat, 0, 0.02, -0.21);
    this.torso.add(chest, shoulders, pack);

    // Head with a face on the +Z side.
    this.head = new THREE.Group();
    this.head.position.y = PLAYER.HEIGHT - PLAYER.HEAD_RADIUS - 0.02;
    const skin = skinMats[hashName(name) % skinMats.length];
    const skull = new THREE.Mesh(headGeo, darkMat);
    const band = box(bandGeo, this.accentMat, 0, 0.13, 0);
    const face = box(faceGeo, skin, 0, -0.02, 0.171);
    const eyeL = box(eyeGeo, eyeMat, -0.066, 0.025, 0.184);
    const eyeR = box(eyeGeo, eyeMat, 0.066, 0.025, 0.184);
    const pupilL = box(pupilGeo, pupilMat, -0.062, 0.02, 0.192);
    const pupilR = box(pupilGeo, pupilMat, 0.062, 0.02, 0.192);
    const browL = box(browGeo, featureMat, -0.066, 0.075, 0.184);
    const browR = box(browGeo, featureMat, 0.066, 0.075, 0.184);
    const nose = box(noseGeo, skin, 0, -0.035, 0.195);
    const mouth = box(mouthGeo, featureMat, 0, -0.092, 0.184);
    this.head.add(skull, band, face, eyeL, eyeR, pupilL, pupilR, browL, browR, nose, mouth);

    this.legL = box(limbGeo, limbMat, -0.14, 0.38, 0);
    this.legR = box(limbGeo, limbMat, 0.14, 0.38, 0);

    // Arms reach forward to the weapon; the whole rig pitches with the aim.
    this.aim.position.set(0, SHOULDER_Y, 0.02);
    const armL = box(armGeo, limbMat, -0.2, -0.07, 0.25);
    armL.rotation.set(-1.35, 0.45, 0);
    const armR = box(armGeo, limbMat, 0.24, -0.07, 0.22);
    armR.rotation.set(-1.3, -0.12, 0);
    this.gun = box(gunGeo, gunMat, 0.1, -0.1, 0.5);
    const muzzleTip = box(browGeo, this.accentMat, 0, 0.066, 0.3);
    this.gun.add(muzzleTip);
    this.aim.add(armL, armR, this.gun);

    this.parts = [this.torso, skull, this.legL, this.legR, armL, armR, this.gun, chest, shoulders, pack, band, face];
    this.setShadows(shadows);
    g.add(this.torso, this.head, this.legL, this.legR, this.aim);
    this.setName(name);
  }

  setShadows(shadows: boolean): void {
    for (const m of this.parts) {
      m.castShadow = shadows;
      m.receiveShadow = false;
    }
  }

  setName(name: string): void {
    if (this.nameSprite) {
      this.group.remove(this.nameSprite);
      (this.nameSprite.material as THREE.SpriteMaterial).map?.dispose();
      (this.nameSprite.material as THREE.SpriteMaterial).dispose();
    }
    const { texture, aspect } = makeTextTexture(name, '#' + this.color.toString(16).padStart(6, '0'));
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    this.nameAspect = aspect;
    sprite.position.y = PLAYER.HEIGHT + 0.32;
    sprite.scale.set(0.42 * aspect, 0.42, 1);
    sprite.renderOrder = 20;
    this.nameSprite = sprite;
    this.group.add(sprite);
  }

  setWeapon(w: WeaponId): void {
    // Weapon silhouette by length: shotgun/sniper longer, pistol shorter.
    const len = w === 'sniper' ? 1.1 : w === 'shotgun' ? 0.95 : w === 'pistol' ? 0.35 : w === 'smg' ? 0.55 : 0.75;
    this.gun.scale.z = len / 0.7;
    this.gun.position.z = 0.15 + len / 2;
  }

  hitFlash(now: number): void {
    this.flashUntil = now + 90;
  }

  /** Update pose; `speed` is horizontal m/s. */
  update(x: number, y: number, z: number, yaw: number, pitch: number, crouch: boolean, speed: number, alive: boolean, dt: number, now: number, camDistSq: number): void {
    const g = this.group;
    g.position.set(x, y, z);
    g.rotation.y = yaw + Math.PI;
    this.crouchAmount += ((crouch ? 1 : 0) - this.crouchAmount) * Math.min(1, dt * 14);
    const c = this.crouchAmount;
    const scaleY = 1 - 0.3 * c;
    this.torso.position.y = 1.08 * scaleY;
    this.torso.scale.y = scaleY;
    this.head.position.y = PLAYER.HEIGHT - PLAYER.HEAD_RADIUS - 0.02 - (PLAYER.HEIGHT - PLAYER.CROUCH_HEIGHT) * c;
    // Look up/down: the head follows part of the way, the weapon all the way.
    this.head.rotation.x = -pitch * 0.6;
    this.aim.position.y = SHOULDER_Y * scaleY - 0.05 * c;
    this.aim.rotation.x = -pitch * 0.95;
    this.legL.scale.y = 1 - 0.45 * c;
    this.legR.scale.y = 1 - 0.45 * c;
    this.legL.position.y = 0.38 * (1 - 0.45 * c);
    this.legR.position.y = 0.38 * (1 - 0.45 * c);
    // Walk cycle
    if (speed > 0.3) {
      this.walkPhase += dt * speed * 2.2;
      const s = Math.sin(this.walkPhase) * Math.min(1, speed / 5) * 0.7;
      this.legL.rotation.x = s;
      this.legR.rotation.x = -s;
    } else {
      this.legL.rotation.x *= 0.8;
      this.legR.rotation.x *= 0.8;
    }
    // Hit flash
    const flashing = now < this.flashUntil;
    this.accentMat.emissiveIntensity = flashing ? 3 : 0.25;
    this.accentMat.emissive.setHex(flashing ? 0xffffff : this.color);
    // Death: tip over backwards and sink.
    if (!alive) {
      if (this.deadT < 0) this.deadT = 0;
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.35);
      g.rotation.x = -1.45 * t;
      g.position.y = y + 0.3 * t - Math.max(0, this.deadT - 1.2) * 1.2;
      const gone = this.deadT > 2.2;
      g.visible = !gone && this.visibleTarget;
      if (this.nameSprite) this.nameSprite.visible = false;
    } else {
      this.deadT = -1;
      g.rotation.x = 0;
      g.visible = this.visibleTarget;
      if (this.nameSprite) {
        this.nameSprite.visible = camDistSq < 45 * 45;
        const scale = 0.32 + Math.sqrt(camDistSq) * 0.012;
        this.nameSprite.scale.set(scale * this.nameAspect, scale, 1);
      }
    }
  }

  setVisible(v: boolean): void {
    this.visibleTarget = v;
    this.group.visible = v;
  }

  dispose(): void {
    this.accentMat.dispose();
    if (this.nameSprite) {
      (this.nameSprite.material as THREE.SpriteMaterial).map?.dispose();
      (this.nameSprite.material as THREE.SpriteMaterial).dispose();
    }
    this.group.clear();
  }
}
