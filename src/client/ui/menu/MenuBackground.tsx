import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { MAPS } from '@shared/maps';
import { useStore } from '@client/app/store';
import { buildMap } from '@client/game/world/MapBuilder';
import { AmbientParticles } from '@client/game/world/Particles';
import { buildSky } from '@client/game/world/Sky';

/** Slow orbit around one of the arenas, rendered behind the menu. */
export function MenuBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  const quality = useStore((s) => s.settings.quality);
  const reducedMotion = useStore((s) => s.settings.reducedMotion);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    } catch {
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const shadows = quality === 'high';
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const map = MAPS[Math.floor(Math.random() * MAPS.length)];
    const built = buildMap(map, quality, shadows);
    scene.add(built.group);
    const sky = buildSky(map, map.id === 'neon');
    scene.add(sky.mesh);
    if (sky.points) scene.add(sky.points);
    scene.fog = new THREE.Fog(map.sky.fog, map.sky.fogNear, map.sky.fogFar);
    scene.background = new THREE.Color(map.sky.fog);
    const particles = quality !== 'low' && map.particles !== 'none' ? new AmbientParticles(map, map.particles, 300) : null;
    if (particles) scene.add(particles.points);
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);
    let raf = 0;
    let last = performance.now();
    let t = Math.random() * 100;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reducedMotion) t += dt * 0.06;
      const r = 17;
      camera.position.set(Math.cos(t) * r, 7 + Math.sin(t * 0.7) * 1.5, Math.sin(t) * r);
      camera.lookAt(0, 1.5, 0);
      sky.mesh.position.copy(camera.position);
      particles?.update(dt);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      built.dispose();
      sky.dispose();
      particles?.dispose();
      renderer.dispose();
    };
  }, [quality, reducedMotion]);

  return <canvas ref={ref} className="game-canvas" aria-hidden="true" />;
}
