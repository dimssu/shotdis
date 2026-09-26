import * as THREE from 'three';
import type { MapDef } from '@shared/maps/types';

/** Ambient dust motes or rain, as a single Points object. */
export class AmbientParticles {
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private count: number;
  private bounds: MapDef['bounds'];
  private kind: 'dust' | 'rain';
  private height: number;

  constructor(map: MapDef, kind: 'dust' | 'rain', count: number) {
    this.kind = kind;
    this.count = count;
    this.bounds = map.bounds;
    this.height = kind === 'rain' ? 16 : 7;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.respawn(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const m = new THREE.PointsMaterial({
      color: kind === 'rain' ? 0x8fa8ff : 0xffe9c4,
      size: kind === 'rain' ? 0.06 : 0.05,
      transparent: true,
      opacity: kind === 'rain' ? 0.45 : 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }

  private respawn(i: number, anywhere: boolean): void {
    const b = this.bounds;
    this.pos[i * 3] = b.minX + Math.random() * (b.maxX - b.minX);
    this.pos[i * 3 + 1] = anywhere ? Math.random() * this.height : this.height;
    this.pos[i * 3 + 2] = b.minZ + Math.random() * (b.maxZ - b.minZ);
    if (this.kind === 'rain') {
      this.vel[i * 3] = 0.3;
      this.vel[i * 3 + 1] = -(9 + Math.random() * 4);
      this.vel[i * 3 + 2] = 0.1;
    } else {
      this.vel[i * 3] = (Math.random() - 0.5) * 0.25;
      this.vel[i * 3 + 1] = (Math.random() - 0.5) * 0.12;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
    }
  }

  update(dt: number): void {
    const p = this.pos;
    const v = this.vel;
    const b = this.bounds;
    for (let i = 0; i < this.count; i++) {
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < 0 || p[i * 3 + 1] > this.height || p[i * 3] < b.minX || p[i * 3] > b.maxX || p[i * 3 + 2] < b.minZ || p[i * 3 + 2] > b.maxZ) {
        this.respawn(i, this.kind === 'dust');
      }
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
