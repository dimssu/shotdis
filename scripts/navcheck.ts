import { MAPS } from '../src/shared/maps';
import { PLAYER } from '../src/shared/config';
import { CollisionWorld } from '../src/shared/physics/world';
import { findPath } from '../src/shared/sim/bot';
import { v3 } from '../src/shared/math';

for (const map of MAPS) {
  const world = CollisionWorld.fromMap(map);
  console.log(`\n=== ${map.id} ===`);
  const hw = PLAYER.HALF_WIDTH;
  const check = (label: string, x: number, y: number, z: number) => {
    const standing = { minX: x - hw, maxX: x + hw, minY: y + 0.02, maxY: y + PLAYER.HEIGHT, minZ: z - hw, maxZ: z + hw };
    const gh = hw * 0.5;
    const ground = { minX: x - gh, maxX: x + gh, minY: y - 0.15, maxY: y - 0.01, minZ: z - gh, maxZ: z + gh };
    const inside = world.overlapsAny(standing);
    const grounded = world.overlapsAny(ground);
    if (inside || !grounded) console.log(`${label} (${x},${y},${z}) ${inside ? 'INSIDE' : ''} ${!grounded ? 'FLOATING' : ''}`);
  };
  map.spawns.forEach((s, i) => check(`spawn ${i}`, s.x, s.y, s.z));
  map.nav.forEach((n, i) => check(`nav ${i}`, n.x, n.y, n.z));
  const adj: number[][] = map.nav.map(() => []);
  for (const [a, b] of map.navLinks) { adj[a].push(b); adj[b].push(a); }
  const unreachable: number[] = [];
  for (let i = 1; i < map.nav.length; i++) if (findPath(adj, 0, i).length === 0) unreachable.push(i);
  for (const i of unreachable) {
    const n = map.nav[i];
    // find near candidates and explain why not linked
    const reasons: string[] = [];
    map.nav.forEach((m, j) => {
      if (j === i) return;
      const d = Math.hypot(n.x - m.x, n.z - m.z);
      if (d > 8) return;
      const rise = Math.abs(n.y - m.y);
      const a = v3(n.x, n.y + 0.9, n.z); const b = v3(m.x, m.y + 0.9, m.z);
      const los = world.lineOfSight(a, b);
      const linked = adj[i].includes(j);
      reasons.push(`->${j}(${m.x},${m.y},${m.z}) d=${d.toFixed(1)} rise=${rise.toFixed(2)} los=${los} linked=${linked} reach=${findPath(adj,0,j).length>0||j===0}`);
    });
    console.log(`UNREACHABLE nav ${i} (${n.x},${n.y},${n.z}) deg=${adj[i].length}\n   ${reasons.join('\n   ')}`);
  }
}
