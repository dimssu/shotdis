import { CollisionWorld } from '../physics/world';
import { v3 } from '../math';
import { autoLinks } from './builders';
import type { MapDef } from './types';

/**
 * Fill in nav links (if the map did not provide them) using proximity plus a
 * line-of-sight test through the collision world so bots do not try to walk
 * through walls.
 */
export function finalizeMap(map: MapDef, maxLink = 8): MapDef {
  if (map.navLinks.length === 0) {
    const world = CollisionWorld.fromMap(map);
    const a = v3();
    const b = v3();
    map.navLinks = autoLinks(map.nav, maxLink, 1.7).filter(([i, j]) => {
      const p = map.nav[i];
      const q = map.nav[j];
      a.x = p.x;
      a.y = p.y + 0.9;
      a.z = p.z;
      b.x = q.x;
      b.y = q.y + 0.9;
      b.z = q.z;
      return world.lineOfSight(a, b);
    });
  }
  return map;
}
