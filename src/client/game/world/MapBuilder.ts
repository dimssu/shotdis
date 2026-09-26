import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIALS, type MapDef, type MaterialId, type RampSolid, type Solid } from '@shared/maps/types';
import type { Quality } from '@client/app/settings';
import { makeNoiseTexture } from './textures';

export interface BuiltMap {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  pointLights: THREE.PointLight[];
  dispose(): void;
}

const TEXEL_SCALE = 0.5; // texture repeats every 2 m

/** Rewrite box UVs so textures repeat in world units regardless of box size. */
function worldUvs(geom: THREE.BufferGeometry): void {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const nor = geom.attributes.normal as THREE.BufferAttribute;
  const uv = geom.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    if (nx > 0.5) uv.setXY(i, z * TEXEL_SCALE, y * TEXEL_SCALE);
    else if (ny > 0.5) uv.setXY(i, x * TEXEL_SCALE, z * TEXEL_SCALE);
    else uv.setXY(i, x * TEXEL_SCALE, y * TEXEL_SCALE);
  }
  uv.needsUpdate = true;
}

function boxGeometry(x: number, y: number, z: number, w: number, h: number, d: number): THREE.BufferGeometry {
  const indexed = new THREE.BoxGeometry(w, h, d);
  // Non-indexed so boxes and ramps can be merged into one buffer.
  const g = indexed.toNonIndexed();
  indexed.dispose();
  g.translate(x + w / 2, y + h / 2, z + d / 2);
  worldUvs(g);
  return g;
}

/** Wedge geometry for a ramp solid. */
function rampGeometry(r: RampSolid): THREE.BufferGeometry {
  const x0 = r.x;
  const x1 = r.x + r.w;
  const y0 = r.y;
  const y1 = r.y + r.h;
  const z0 = r.z;
  const z1 = r.z + r.d;
  // Height at each of the four footprint corners.
  const hAt = (x: number, z: number): number => {
    let t: number;
    if (r.axis === 'x') t = r.dir === 1 ? (x - x0) / r.w : (x1 - x) / r.w;
    else t = r.dir === 1 ? (z - z0) / r.d : (z1 - z) / r.d;
    return y0 + r.h * t;
  };
  const c = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const top = c.map(([x, z]) => new THREE.Vector3(x, hAt(x, z), z));
  const bot = c.map(([x, z]) => new THREE.Vector3(x, y0, z));
  const verts: number[] = [];
  const norms: number[] = [];
  const uvs: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3): void => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const tri = (p: THREE.Vector3): void => {
      verts.push(p.x, p.y, p.z);
      norms.push(n.x, n.y, n.z);
      if (Math.abs(n.x) > 0.5) uvs.push(p.z * TEXEL_SCALE, p.y * TEXEL_SCALE);
      else if (Math.abs(n.y) > 0.5) uvs.push(p.x * TEXEL_SCALE, p.z * TEXEL_SCALE);
      else uvs.push(p.x * TEXEL_SCALE, p.y * TEXEL_SCALE);
    };
    tri(a);
    tri(b);
    tri(cc);
    tri(a);
    tri(cc);
    tri(d);
  };
  // Top (sloped) face, counter-clockwise viewed from above.
  quad(top[0], top[3], top[2], top[1]);
  // Bottom
  quad(bot[0], bot[1], bot[2], bot[3]);
  // Sides
  quad(bot[0], top[0], top[1], bot[1]); // z0 side (facing -z)
  quad(bot[1], top[1], top[2], bot[2]); // x1 side
  quad(bot[2], top[2], top[3], bot[3]); // z1 side
  quad(bot[3], top[3], top[0], bot[0]); // x0 side
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  void y1;
  return g;
}

export function solidGeometry(s: Solid, index = 0): THREE.BufferGeometry {
  const g = s.kind === 'box' ? boxGeometry(s.x, s.y, s.z, s.w, s.h, s.d) : rampGeometry(s);
  // Slight per-solid brightness variation breaks up flat walls of identical material.
  const n = (g.attributes.position as THREE.BufferAttribute).count;
  const jitter = 0.9 + (((index * 7919) % 97) / 97) * 0.2;
  const colors = new Float32Array(n * 3);
  colors.fill(jitter);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

let noiseTex: THREE.CanvasTexture | null = null;

export function materialFor(id: MaterialId, quality: Quality): THREE.Material {
  const def = MATERIALS[id];
  if (!noiseTex) noiseTex = makeNoiseTexture(256, 7);
  if (def.glow) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(def.emissive ?? def.color).multiplyScalar(def.emissiveIntensity ?? 1.5), toneMapped: false });
  }
  if (quality === 'low') {
    return new THREE.MeshLambertMaterial({ color: def.color, map: noiseTex, vertexColors: true });
  }
  return new THREE.MeshStandardMaterial({
    color: def.color,
    roughness: def.roughness,
    metalness: def.metalness,
    map: noiseTex,
    vertexColors: true,
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 0,
  });
}

/**
 * Build the whole arena as a handful of merged meshes (one per material), so a
 * map with 300 solids costs ~20 draw calls.
 */
export function buildMap(map: MapDef, quality: Quality, shadows: boolean): BuiltMap {
  const group = new THREE.Group();
  group.name = `map:${map.id}`;
  const byMat = new Map<MaterialId, THREE.BufferGeometry[]>();
  map.solids.forEach((s, i) => {
    let list = byMat.get(s.mat);
    if (!list) byMat.set(s.mat, (list = []));
    list.push(solidGeometry(s, i));
  });
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  for (const [mat, geoms] of byMat) {
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const material = materialFor(mat, quality);
    const mesh = new THREE.Mesh(merged, material);
    const glow = MATERIALS[mat].glow === true;
    mesh.castShadow = shadows && !glow;
    mesh.receiveShadow = shadows && !glow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    meshes.push(mesh);
    materials.push(material);
  }

  // Lighting
  const hemi = new THREE.HemisphereLight(map.ambient.sky, map.ambient.ground, map.ambient.intensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(map.sun.color, map.sun.intensity);
  const d = new THREE.Vector3(...map.sun.dir).normalize();
  sun.position.copy(d.clone().multiplyScalar(60));
  sun.target.position.set(0, 0, 0);
  group.add(sun);
  group.add(sun.target);
  if (shadows) {
    sun.castShadow = true;
    const size = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(size, size);
    const b = map.bounds;
    const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.62;
    sun.shadow.camera.left = -ext;
    sun.shadow.camera.right = ext;
    sun.shadow.camera.top = ext;
    sun.shadow.camera.bottom = -ext;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.05;
  }
  // Soft fill from the opposite side so shadowed faces stay readable.
  const fill = new THREE.DirectionalLight(map.ambient.sky, map.sun.intensity * 0.3);
  fill.position.set(-d.x * 40, 25, -d.z * 40);
  group.add(fill);
  const pointLights: THREE.PointLight[] = [];
  if (quality !== 'low') {
    const max = quality === 'high' ? map.lights.length : Math.min(2, map.lights.length);
    for (let i = 0; i < max; i++) {
      const l = map.lights[i];
      const pl = new THREE.PointLight(l.color, l.intensity, l.distance, 1.6);
      pl.position.set(l.x, l.y, l.z);
      group.add(pl);
      pointLights.push(pl);
    }
  }

  return {
    group,
    sun,
    hemi,
    pointLights,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const m of materials) m.dispose();
      sun.dispose(); // frees the shadow map render target
      fill.dispose();
      for (const pl of pointLights) pl.dispose();
      group.clear();
    },
  };
}
