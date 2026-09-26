import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '@shared/weapons';
import { clamp, damp } from '@shared/math';

export interface ViewModelInput {
  mouseDx: number;
  mouseDy: number;
  speed: number;
  onGround: boolean;
  sprint: boolean;
  adsAmount: number;
  crouch: boolean;
  reloading: boolean;
  reloadProgress: number;
  equipProgress: number;
  alive: boolean;
  reducedMotion: boolean;
}

const metal = new THREE.MeshStandardMaterial({ color: 0x343a45, roughness: 0.5, metalness: 0.35 });
const metalLight = new THREE.MeshStandardMaterial({ color: 0x6b7382, roughness: 0.45, metalness: 0.3 });
const grip = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.9, metalness: 0.05 });

function part(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material = metal): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

interface Built {
  group: THREE.Group;
  muzzle: THREE.Vector3;
  rest: THREE.Vector3;
  ads: THREE.Vector3;
  restRot: THREE.Euler;
}

/** Build a stylized weapon out of boxes. Coordinates are in camera space (z toward the viewer is +). */
function buildWeapon(id: WeaponId): Built {
  const g = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({ color: WEAPONS[id].tracerColor, emissive: WEAPONS[id].tracerColor, emissiveIntensity: 0.45, roughness: 0.4 });
  let muzzle: THREE.Vector3;
  let rest: THREE.Vector3;
  let ads: THREE.Vector3;
  switch (id) {
    case 'pistol': {
      g.add(part(0.05, 0.07, 0.24, 0, 0.02, -0.02)); // slide
      g.add(part(0.045, 0.05, 0.22, 0, -0.03, -0.01, metalLight)); // frame
      g.add(part(0.04, 0.11, 0.05, 0, -0.1, 0.06, grip)); // grip
      g.add(part(0.02, 0.02, 0.06, 0, -0.045, -0.04, grip)); // trigger guard
      g.add(part(0.012, 0.02, 0.012, 0, 0.065, -0.11, accent)); // front sight
      g.add(part(0.03, 0.015, 0.012, 0, 0.065, 0.08, metalLight)); // rear sight
      muzzle = new THREE.Vector3(0, 0.02, -0.15);
      rest = new THREE.Vector3(0.2, -0.2, -0.38);
      ads = new THREE.Vector3(0, -0.145, -0.3);
      break;
    }
    case 'smg': {
      g.add(part(0.06, 0.08, 0.36, 0, 0, 0)); // receiver
      g.add(part(0.03, 0.03, 0.18, 0, 0.005, -0.26, metalLight)); // barrel
      g.add(part(0.05, 0.06, 0.1, 0, 0.01, -0.13, metal)); // handguard
      g.add(part(0.04, 0.16, 0.05, 0, -0.11, 0.05, grip)); // grip
      g.add(part(0.03, 0.14, 0.04, 0, -0.1, -0.06, metal)); // magazine
      g.add(part(0.035, 0.03, 0.14, 0, 0.005, 0.24, metal)); // stock
      g.add(part(0.012, 0.025, 0.012, 0, 0.055, -0.3, accent)); // front sight
      g.add(part(0.04, 0.02, 0.012, 0, 0.055, 0.1, metalLight)); // rear
      g.add(part(0.062, 0.006, 0.12, 0, 0.041, -0.05, accent)); // accent stripe
      muzzle = new THREE.Vector3(0, 0.005, -0.36);
      rest = new THREE.Vector3(0.22, -0.2, -0.42);
      ads = new THREE.Vector3(0, -0.135, -0.3);
      break;
    }
    case 'shotgun': {
      g.add(part(0.06, 0.08, 0.3, 0, 0, 0.05)); // receiver
      g.add(part(0.035, 0.035, 0.5, 0, 0.02, -0.34, metalLight)); // barrel
      g.add(part(0.035, 0.035, 0.42, 0, -0.025, -0.3, metal)); // tube
      g.add(part(0.05, 0.05, 0.14, 0, -0.01, -0.2, grip)); // pump
      g.add(part(0.045, 0.14, 0.06, 0, -0.1, 0.1, grip)); // grip
      g.add(part(0.045, 0.06, 0.22, 0, -0.01, 0.3, grip)); // stock
      g.add(part(0.012, 0.02, 0.012, 0, 0.05, -0.58, accent)); // bead
      g.add(part(0.062, 0.006, 0.08, 0, 0.041, 0.0, accent));
      muzzle = new THREE.Vector3(0, 0.02, -0.6);
      rest = new THREE.Vector3(0.2, -0.21, -0.4);
      ads = new THREE.Vector3(0, -0.13, -0.28);
      break;
    }
    case 'sniper': {
      g.add(part(0.055, 0.075, 0.42, 0, 0, 0.05)); // receiver
      g.add(part(0.028, 0.028, 0.62, 0, 0.005, -0.5, metalLight)); // barrel
      g.add(part(0.045, 0.045, 0.1, 0, 0.005, -0.79, metal)); // muzzle brake
      g.add(part(0.04, 0.05, 0.22, 0, 0.09, -0.02, metal)); // scope body
      g.add(part(0.05, 0.05, 0.03, 0, 0.09, -0.14, metalLight)); // scope front
      g.add(part(0.045, 0.045, 0.03, 0, 0.09, 0.1, metalLight)); // scope rear
      g.add(part(0.02, 0.03, 0.03, 0, 0.055, -0.02, metal)); // scope mount
      g.add(part(0.045, 0.14, 0.06, 0, -0.1, 0.12, grip)); // grip
      g.add(part(0.045, 0.06, 0.26, 0, -0.01, 0.34, grip)); // stock
      g.add(part(0.03, 0.12, 0.04, 0, -0.09, -0.08, metal)); // magazine
      g.add(part(0.02, 0.01, 0.18, 0, 0.11, -0.02, accent)); // accent line
      muzzle = new THREE.Vector3(0, 0.005, -0.84);
      rest = new THREE.Vector3(0.2, -0.22, -0.42);
      ads = new THREE.Vector3(0, -0.2, -0.3);
      break;
    }
    default: {
      g.add(part(0.06, 0.085, 0.4, 0, 0, 0.02)); // receiver
      g.add(part(0.03, 0.03, 0.3, 0, 0.005, -0.34, metalLight)); // barrel
      g.add(part(0.05, 0.055, 0.2, 0, 0.0, -0.24, metal)); // handguard
      g.add(part(0.04, 0.15, 0.055, 0, -0.11, 0.08, grip)); // grip
      g.add(part(0.03, 0.16, 0.05, 0, -0.11, -0.06, metal)); // magazine
      g.add(part(0.04, 0.05, 0.2, 0, 0.0, 0.32, grip)); // stock
      g.add(part(0.012, 0.028, 0.012, 0, 0.06, -0.42, accent)); // front sight
      g.add(part(0.04, 0.022, 0.012, 0, 0.06, 0.1, metalLight)); // rear
      g.add(part(0.062, 0.006, 0.16, 0, 0.044, -0.14, accent)); // accent stripe
      muzzle = new THREE.Vector3(0, 0.005, -0.5);
      rest = new THREE.Vector3(0.24, -0.23, -0.42);
      ads = new THREE.Vector3(0, -0.145, -0.32);
      break;
    }
  }
  return { group: g, muzzle, rest, ads, restRot: new THREE.Euler(0.02, 0.06, 0.03) };
}

/**
 * The first-person weapon. Rendered in its own scene with a fixed-FOV camera so
 * it never clips into walls and looks the same at every field of view.
 */
export class ViewModel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.01, 5);
  private root = new THREE.Group();
  private built = new Map<WeaponId, Built>();
  private current: Built | null = null;
  private currentId: WeaponId | null = null;
  private swayX = 0;
  private swayY = 0;
  private bobT = 0;
  private bobX = 0;
  private bobY = 0;
  private recoilZ = 0;
  private recoilRot = 0;
  private flash: THREE.Sprite;
  private flashUntil = 0;
  private sprintAmt = 0;
  private reloadAmt = 0;
  private lowerAmt = 0;
  private flashLight: THREE.PointLight;
  private tmp = new THREE.Vector3();

  private hemi = new THREE.HemisphereLight(0xdfe7ff, 0x3a2f28, 1.1);
  private dirLight = new THREE.DirectionalLight(0xffffff, 1.4);

  constructor() {
    this.scene.add(this.root);
    this.scene.add(this.hemi);
    this.dirLight.position.set(0.6, 1, 0.4);
    this.scene.add(this.dirLight);
    this.flashLight = new THREE.PointLight(0xffc27a, 0, 2.5, 2);
    this.scene.add(this.flashLight);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,230,1)');
    grad.addColorStop(0.3, 'rgba(255,200,110,0.9)');
    grad.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.flash.renderOrder = 5;
    this.scene.add(this.flash);
  }

  /** Match the weapon lighting to the arena so it does not look pasted on. */
  setLighting(skyColor: number, groundColor: number, sunColor: number, intensity: number): void {
    this.hemi.color.setHex(skyColor);
    this.hemi.groundColor.setHex(groundColor);
    this.hemi.intensity = 0.8 * intensity;
    this.dirLight.color.setHex(sunColor);
    this.dirLight.intensity = 1.0 * intensity;
  }

  setWeapon(id: WeaponId): void {
    if (this.currentId === id) return;
    if (this.current) this.root.remove(this.current.group);
    let b = this.built.get(id);
    if (!b) {
      b = buildWeapon(id);
      this.built.set(id, b);
    }
    this.current = b;
    this.currentId = id;
    this.root.add(b.group);
  }

  /** Recoil impulse when firing. Strength ~ 0.3..1.5. */
  fire(strength: number, reducedMotion: boolean): void {
    if (!reducedMotion) {
      this.recoilZ += 0.035 * strength;
      this.recoilRot += 0.09 * strength;
    }
    this.flashUntil = performance.now() + 45;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const s = 0.12 + Math.random() * 0.08 + strength * 0.05;
    this.flash.scale.set(s, s, 1);
    this.flash.visible = true;
    this.flashLight.intensity = 6;
  }

  /** World-space muzzle position for tracers (using the main camera). */
  muzzleWorld(mainCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    if (!this.current) return out.copy(mainCamera.position);
    this.tmp.copy(this.current.muzzle).applyMatrix4(this.current.group.matrixWorld);
    // The weapon camera sits at the origin, so its space == main camera space.
    return out.copy(this.tmp).applyMatrix4(mainCamera.matrixWorld);
  }

  update(dt: number, inp: ViewModelInput): void {
    const b = this.current;
    if (!b) return;
    const rm = inp.reducedMotion;
    // Sway from mouse, lagged.
    const swayTX = rm ? 0 : clamp(-inp.mouseDx * 0.0009, -0.03, 0.03);
    const swayTY = rm ? 0 : clamp(inp.mouseDy * 0.0009, -0.03, 0.03);
    this.swayX = damp(this.swayX, swayTX, 10, dt);
    this.swayY = damp(this.swayY, swayTY, 10, dt);
    // Bob
    const amp = rm || !inp.onGround || !inp.alive ? 0 : 0.006 * clamp(inp.speed / 5.4, 0, 1.4) * (1 - inp.adsAmount * 0.85);
    if (amp > 0) this.bobT += dt * inp.speed * 1.55;
    this.bobX = damp(this.bobX, Math.cos(this.bobT) * amp, 12, dt);
    this.bobY = damp(this.bobY, Math.abs(Math.sin(this.bobT)) * amp * 1.4, 12, dt);
    // Recoil spring
    const k = Math.exp(-16 * dt);
    this.recoilZ *= k;
    this.recoilRot *= k;
    // Sprint lower / reload / equip
    this.sprintAmt = damp(this.sprintAmt, inp.sprint && !inp.reloading ? 1 : 0, 10, dt);
    this.reloadAmt = damp(this.reloadAmt, inp.reloading ? 1 : 0, 14, dt);
    const equip = clamp(inp.equipProgress, 0, 1);
    const lower = inp.alive ? (1 - equip) : 1;
    this.lowerAmt = damp(this.lowerAmt, lower, 16, dt);

    const ads = inp.adsAmount;
    const g = b.group;
    const px = b.rest.x + (b.ads.x - b.rest.x) * ads + this.swayX * (1 - ads * 0.7) + this.bobX;
    const py = b.rest.y + (b.ads.y - b.rest.y) * ads + this.swayY * (1 - ads * 0.7) + this.bobY - this.lowerAmt * 0.35 - this.reloadAmt * 0.08 - this.sprintAmt * 0.05 + (inp.crouch ? 0.01 : 0);
    const pz = b.rest.z + (b.ads.z - b.rest.z) * ads + this.recoilZ + this.sprintAmt * 0.06;
    g.position.set(px, py, pz);
    // Reload wiggle: tilt down and roll slightly, with a bump when the mag goes in.
    const rp = inp.reloadProgress;
    const magBump = inp.reloading ? Math.sin(clamp((rp - 0.55) * 6, 0, Math.PI)) * 0.04 : 0;
    g.rotation.set(
      b.restRot.x - this.recoilRot + this.reloadAmt * 0.55 - this.swayY * 0.8 + this.lowerAmt * 0.6 - magBump,
      b.restRot.y * (1 - ads) + this.swayX * 1.2 - this.sprintAmt * 0.5,
      this.reloadAmt * 0.35 + this.sprintAmt * 0.3 - this.swayX * 0.5,
    );
    g.updateMatrixWorld();
    // Muzzle flash follows the muzzle.
    if (this.flash.visible) {
      if (performance.now() > this.flashUntil) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      } else {
        this.tmp.copy(b.muzzle).applyMatrix4(g.matrixWorld);
        this.flash.position.copy(this.tmp);
        this.flashLight.position.copy(this.tmp);
      }
    }
    g.visible = inp.alive && !(ads > 0.98 && this.currentId === 'sniper');
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const b of this.built.values()) {
      b.group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.built.clear();
  }
}
