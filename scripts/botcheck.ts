import { MAPS } from '../src/shared/maps';
import { GameRoom } from '../src/shared/sim/room';
for (let k = 0; k < 4; k++) {
  const room = new GameRoom({ id: 'r', maps: MAPS, transport: { send() {}, kick() {} }, botFill: 4, roomSize: 5, seed: (Math.random() * 1e9) >>> 0, botDifficulty: 'mixed' });
  room.update(1000);
  room.addHuman('me', 'rifle');
  console.log([...room.players.values()].map((p) => `${p.name}:${p.weapon.ids[0]}/${p.pendingPrimary}`).join(' '));
}
