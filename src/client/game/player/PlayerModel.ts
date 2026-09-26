import * as THREE from 'three';
import { PLAYER } from '@shared/config';
import type { WeaponId } from '@shared/weapons';
import { makeTextTexture } from '../world/textures';

const bodyGeo = new THREE.BoxGeometry(0.52, 0.66, 0.3);
const headGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const visorGeo = new THREE.BoxGeometry(0.3, 0.09, 0.06);
const limbGeo = new THREE.BoxGeometry(0.16, 0.7, 0.16);
const armGeo = new THREE.BoxGeometry(0.13, 0.6, 0.13);
const gunGeo = new THREE.BoxGeometry(0.09, 0.12, 0.7);
const shoulderGeo = new THREE.BoxGeometry(0.62, 0.12, 0.34);
const chestGeo = new THREE.BoxGeometry(0.3, 0.22, 0.05);
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2129, roughness: 0.7, metalness: 0.2 });
const limbMat = new THREE.MeshStandardMaterial({ color: 0x2b303b, roughness: 0.8, metalness: 0.1 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.5, metalness: 0.6 });

/**
 * Procedural low-poly soldier: dark body with a per-player accent color. Cheap
 * enough to have eight on screen with shadows.
 */
export class PlayerModel {
  group = new THREE.Group();
  private head: THREE.Mesh;
  private torso: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private gun: THREE.Mesh;
  private accentMat: THREE.MeshStandardMaterial;
  private nameSprite: THREE.Sprite | null = null;
  private nameAspect = 1;
  private walkPhase = 0;
  private flashUntil = 0;
  private deadT = -1;
  private crouchAmount = 0;
  private visibleTarget = true;
  readonly color: number;

  constructor(color: number, name: string, shadows: boolean) {
    this.color = color;
    this.accentMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3, emissive: color, emissiveIntensity: 0.25 });
    const g = this.group;
    this.torso = new THREE.Mesh(bodyGeo, darkMat);
    this.torso.position.y = 1.08;
    const chest = new THREE.Mesh(chestGeo, this.accentMat);
    chest.position.set(0, 0.1, 0.17);
    this.torso.add(chest);
    const shoulders = new THREE.Mesh(shoulderGeo, this.accentMat);
    shoulders.position.y = 0.36;
    this.torso.add(shoulders);
    this.head = new THREE.Mesh(headGeo, darkMat);
    this.head.position.y = PLAYER.HEIGHT - PLAYER.HEAD_RADIUS - 0.02;
    const visor = new THREE.Mesh(visorGeo, this.accentMat);
    visor.position.set(0, 0.02, 0.17);
    this.head.add(visor);
    this.legL = new THREE.Mesh(limbGeo, limbMat);
    this.legR = new THREE.Mesh(limbGeo, limbMat);
    this.legL.position.set(-0.14, 0.38, 0);
    this.legR.position.set(0.14, 0.38, 0);
    this.armL = new THREE.Mesh(armGeo, limbMat);
    this.armR = new THREE.Mesh(armGeo, limbMat);
    this.armL.position.set(-0.36, 1.1, 0.1);
    this.armR.position.set(0.36, 1.1, 0.1);
    this.armL.rotation.x = -1.2;
    this.armR.rotation.x = -1.2;
    this.gun = new THREE.Mesh(gunGeo, gunMat);
    this.gun.position.set(0.18, 1.25, 0.45);
    this.parts = [this.torso, this.head, this.legL, this.legR, this.armL, this.armR, this.gun, chest, shoulders];
    this.setShadows(shadows);
    g.add(this.torso, this.head, this.legL, this.legR, this.armL, this.armR, this.gun);
    this.setName(name);
  }

  private parts: THREE.Mesh[] = [];

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

  setWeapon(_w: WeaponId): void {
    // Weapon silhouette by scale: shotgun/sniper longer, pistol shorter.
    const len = _w === 'sniper' ? 1.1 : _w === 'shotgun' ? 0.95 : _w === 'pistol' ? 0.35 : _w === 'smg' ? 0.55 : 0.75;
    this.gun.scale.z = len / 0.7;
    this.gun.position.z = 0.25 + len * 0.35;
  }

  hitFlash(now: number): void {
    this.flashUntil = now + 90;
  }

  /** Update pose; `speed` is horizontal m/s. */
  update(x: number, y: number, z: number, yaw: number, pitch: number, crouch: boolean, speed: number, alive: boolean, dt: number, now: number, camDistSq: number): void {
    const g = this.group;
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.crouchAmount += ((crouch ? 1 : 0) - this.crouchAmount) * Math.min(1, dt * 14);
    const c = this.crouchAmount;
    // Crouch: compress the body toward the ground.
    const scaleY = 1 - 0.3 * c;
    this.torso.position.y = 1.08 * scaleY;
    this.torso.scale.y = scaleY;
    this.head.position.y = (PLAYER.HEIGHT - PLAYER.HEAD_RADIUS - 0.02) - (PLAYER.HEIGHT - PLAYER.CROUCH_HEIGHT) * c;
    this.head.rotation.x = -pitch * 0.8;
    this.legL.scale.y = 1 - 0.45 * c;
    this.legR.scale.y = 1 - 0.45 * c;
    this.legL.position.y = 0.38 * (1 - 0.45 * c);
    this.legR.position.y = 0.38 * (1 - 0.45 * c);
    this.armL.position.y = 1.1 * scaleY;
    this.armR.position.y = 1.1 * scaleY;
    this.gun.position.y = 1.25 * scaleY;
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
    // Death: tip over and sink.
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
