import * as THREE from 'three';

const tmpColor = new THREE.Color();

/* ------------------------------------------------------------------ */
/* Tracers: one LineSegments object, per-segment color used as fade    */
/* ------------------------------------------------------------------ */

export class TracerPool {
  object: THREE.LineSegments;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private base: Float32Array;
  private next = 0;
  private active = 0;

  constructor(max = 64) {
    this.max = max;
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    this.object = new THREE.LineSegments(g, m);
    this.object.frustumCulled = false;
  }

  spawn(from: THREE.Vector3, to: THREE.Vector3, color: number, life = 0.09): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    if (this.life[i] <= 0) this.active++;
    this.pos[i * 6] = from.x;
    this.pos[i * 6 + 1] = from.y;
    this.pos[i * 6 + 2] = from.z;
    this.pos[i * 6 + 3] = to.x;
    this.pos[i * 6 + 4] = to.y;
    this.pos[i * 6 + 5] = to.z;
    const c = tmpColor.setHex(color);
    this.base[i * 3] = c.r;
    this.base[i * 3 + 1] = c.g;
    this.base[i * 3 + 2] = c.b;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number): void {
    if (this.active === 0) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const a = Math.max(0, this.life[i] / this.maxLife[i]);
      const f = a * a * 1.6;
      // Fade the far end first so the tracer appears to travel.
      this.col[i * 6] = this.base[i * 3] * f * 0.6;
      this.col[i * 6 + 1] = this.base[i * 3 + 1] * f * 0.6;
      this.col[i * 6 + 2] = this.base[i * 3 + 2] * f * 0.6;
      this.col[i * 6 + 3] = this.base[i * 3] * f;
      this.col[i * 6 + 4] = this.base[i * 3 + 1] * f;
      this.col[i * 6 + 5] = this.base[i * 3 + 2] * f;
      if (this.life[i] <= 0) {
        this.active--;
        for (let k = 0; k < 6; k++) this.col[i * 6 + k] = 0;
      }
      any = true;
    }
    if (any) {
      (this.object.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.object.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Sparks: GPU points with per-particle size/alpha                     */
/* ------------------------------------------------------------------ */

export class SparkPool {
  object: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private col: Float32Array;
  private next = 0;
  private active = 0;
  private tmpColor = new THREE.Color();

  constructor(max = 512) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        varying float vAlpha; varying vec3 vColor; uniform float uScale;
        void main(){
          vAlpha = aAlpha; vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vAlpha; varying vec3 vColor;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
          if (d > 0.25) discard;
          float a = (1.0 - d * 4.0) * vAlpha;
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    this.object = new THREE.Points(g, m);
    this.object.frustumCulled = false;
  }

  setScale(heightPx: number): void {
    (this.object.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx * 0.35;
  }

  /** Emit `count` sparks at a point, biased along the normal. */
  burst(x: number, y: number, z: number, nx: number, ny: number, nz: number, count: number, color: number, speed = 4, life = 0.4, size = 0.05): void {
    this.tmpColor.setHex(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      if (this.life[i] <= 0) this.active++;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const rx = Math.random() * 2 - 1;
      const ry = Math.random() * 2 - 1;
      const rz = Math.random() * 2 - 1;
      const s = speed * (0.3 + Math.random());
      this.vel[i * 3] = (nx * 1.2 + rx) * s;
      this.vel[i * 3 + 1] = (ny * 1.2 + ry) * s;
      this.vel[i * 3 + 2] = (nz * 1.2 + rz) * s;
      const l = life * (0.5 + Math.random());
      this.life[i] = l;
      this.maxLife[i] = l;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.alpha[i] = 1;
      this.col[i * 3] = this.tmpColor.r;
      this.col[i * 3 + 1] = this.tmpColor.g;
      this.col[i * 3 + 2] = this.tmpColor.b;
    }
  }

  update(dt: number): void {
    if (this.active === 0) return;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.active--;
        continue;
      }
      this.vel[i * 3 + 1] -= 12 * dt;
      const drag = 1 - 2.5 * dt;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const a = this.life[i] / this.maxLife[i];
      this.alpha[i] = a;
    }
    const g = this.object.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Shell casings: instanced boxes with tiny physics                    */
/* ------------------------------------------------------------------ */

export class CasingPool {
  mesh: THREE.InstancedMesh;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private life: Float32Array;
  private floor: Float32Array;
  private next = 0;
  private dummy = new THREE.Object3D();
  private active = 0;

  constructor(max = 40) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.floor = new Float32Array(max);
    const g = new THREE.BoxGeometry(0.012, 0.012, 0.035);
    const m = new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.9, roughness: 0.35, emissive: 0x3a2a08 });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, floorY: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    if (this.life[i] <= 0) this.active++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx + (Math.random() - 0.5) * 0.8;
    this.vel[i * 3 + 1] = vy + Math.random() * 0.8;
    this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * 0.8;
    this.rot[i * 3] = Math.random() * 6;
    this.rot[i * 3 + 1] = Math.random() * 6;
    this.rot[i * 3 + 2] = Math.random() * 6;
    this.life[i] = 1.6;
    this.floor[i] = floorY;
    this.mesh.count = this.max;
  }

  update(dt: number): void {
    if (this.active === 0) {
      this.mesh.count = 0;
      return;
    }
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.dummy.position.set(0, -1000, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) this.active--;
      this.vel[i * 3 + 1] -= 12 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < this.floor[i] + 0.01 && this.vel[i * 3 + 1] < 0) {
        this.pos[i * 3 + 1] = this.floor[i] + 0.01;
        this.vel[i * 3 + 1] *= -0.35;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
      this.rot[i * 3] += dt * 9;
      this.rot[i * 3 + 2] += dt * 6;
      this.dummy.position.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.dummy.rotation.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Flash lights for remote shots: a single shared point light          */
/* ------------------------------------------------------------------ */

export class FlashLight {
  light: THREE.PointLight;
  private until = 0;
  constructor() {
    this.light = new THREE.PointLight(0xffc27a, 0, 8, 2);
  }
  flash(x: number, y: number, z: number, intensity = 14): void {
    this.light.position.set(x, y, z);
    this.light.intensity = intensity;
    this.until = performance.now() + 55;
  }
  update(): void {
    if (this.light.intensity > 0 && performance.now() > this.until) this.light.intensity = 0;
  }
}
