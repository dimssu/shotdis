import { describe, expect, it } from 'vitest';
import { MAPS } from '@shared/maps';
import { PLAYER } from '@shared/config';
import { CollisionWorld } from '@shared/physics/world';
import { findPath } from '@shared/sim/bot';

function standingBox(x: number, y: number, z: number) {
  const hw = PLAYER.HALF_WIDTH;
  return { minX: x - hw, maxX: x + hw, minY: y + 0.02, maxY: y + PLAYER.HEIGHT, minZ: z - hw, maxZ: z + hw };
}

function groundBox(x: number, y: number, z: number) {
  const hw = PLAYER.HALF_WIDTH * 0.5;
  return { minX: x - hw, maxX: x + hw, minY: y - 0.15, maxY: y - 0.01, minZ: z - hw, maxZ: z + hw };
}

describe.each(MAPS)('map $id', (map) => {
  const world = CollisionWorld.fromMap(map);

  it('has at least 8 spawns and 20 nav points', () => {
    expect(map.spawns.length).toBeGreaterThanOrEqual(8);
    expect(map.nav.length).toBeGreaterThanOrEqual(20);
  });

  it('spawn points are clear and have ground beneath', () => {
    const bad = map.spawns
      .map((s, i) => ({ i, inside: world.overlapsAny(standingBox(s.x, s.y, s.z)), floating: !world.overlapsAny(groundBox(s.x, s.y, s.z)) }))
      .filter((r) => r.inside || r.floating);
    expect(bad).toEqual([]);
  });

  it('nav points are clear and grounded', () => {
    const bad = map.nav
      .map((n, i) => ({ i, n, inside: world.overlapsAny(standingBox(n.x, n.y, n.z)), floating: !world.overlapsAny(groundBox(n.x, n.y, n.z)) }))
      .filter((r) => r.inside || r.floating);
    expect(bad).toEqual([]);
  });

  it('nav graph is connected', () => {
    const adj: number[][] = map.nav.map(() => []);
    for (const [a, b] of map.navLinks) {
      adj[a].push(b);
      adj[b].push(a);
    }
    const unreachable: number[] = [];
    for (let i = 1; i < map.nav.length; i++) if (findPath(adj, 0, i).length === 0) unreachable.push(i);
    expect(unreachable, `unreachable nav points: ${unreachable.map((i) => JSON.stringify(map.nav[i])).join(' ')}`).toEqual([]);
  });
});
