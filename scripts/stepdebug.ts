import { box } from '../src/shared/maps/builders';
import type { MapDef } from '../src/shared/maps/types';
import { CollisionWorld } from '../src/shared/physics/world';
import { Keys, newMoveState, stepPlayer } from '../src/shared/physics/movement';
const map: MapDef = { id: 't', name: 't', tagline: '', bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, sky: { top: 0, bottom: 0, fog: 0, fogNear: 1, fogFar: 2 }, ambient: { sky: 0, ground: 0, intensity: 1 }, sun: { dir: [0, 1, 0], color: 0, intensity: 1 }, solids: [box('floor', -50, -1, -50, 100, 1, 100), box('concrete', -5, 0, -8, 10, 0.5, 5)], spawns: [], nav: [], navLinks: [], lights: [], particles: 'none' };
const w = CollisionWorld.fromMap(map);
const s = newMoveState(0, 0.5, 0);
for (let i = 0; i < 60; i++) {
  stepPlayer(s, Keys.FWD, 0, 1 / 60, w);
  if (i > 25 && i < 40) console.log(i, s.pos.z.toFixed(3), s.pos.y.toFixed(3), s.vel.z.toFixed(2), s.onGround);
}
