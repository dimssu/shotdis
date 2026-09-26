import * as THREE from 'three';
import type { MapDef } from '@shared/maps/types';

/** Cheap gradient sky dome with optional stars. */
export function buildSky(map: MapDef, stars: boolean): { mesh: THREE.Mesh; points: THREE.Points | null; dispose(): void } {
  const geom = new THREE.SphereGeometry(300, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(map.sky.top) },
      bottom: { value: new THREE.Color(map.sky.bottom) },
      horizon: { value: new THREE.Color(map.sky.fog) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.8));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  let points: THREE.Points | null = null;
  if (stars) {
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.85 + 0.15);
      const r = 280;
      pos[i * 3] = Math.cos(th) * Math.sin(ph) * r;
      pos[i * 3 + 1] = Math.cos(ph) * r;
      pos[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xaab4ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 });
    points = new THREE.Points(g, m);
    points.frustumCulled = false;
  }
  return {
    mesh,
    points,
    dispose() {
      geom.dispose();
      mat.dispose();
      if (points) {
        points.geometry.dispose();
        (points.material as THREE.Material).dispose();
      }
    },
  };
}
