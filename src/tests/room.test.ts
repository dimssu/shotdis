import { beforeEach, describe, expect, it } from 'vitest';
import { COMBAT, MATCH, SCORE } from '@shared/config';
import { MAPS } from '@shared/maps';
import { Keys } from '@shared/physics/movement';
import { PFlag, YOU, type GameEvent, type InputTuple, type ServerMsg } from '@shared/protocol';
import { GameRoom } from '@shared/sim/room';
import { WEAPONS } from '@shared/weapons';

class Sink {
  msgs = new Map<number, ServerMsg[]>();
  send(id: number, m: ServerMsg) {
    let l = this.msgs.get(id);
    if (!l) this.msgs.set(id, (l = []));
    l.push(m);
  }
  kick() {}
  events(id: number): GameEvent[] {
    return (this.msgs.get(id) ?? []).flatMap((m) => (m.t === 'ev' ? m.e : []));
  }
  lastSnap(id: number) {
    const s = (this.msgs.get(id) ?? []).filter((m) => m.t === 'snap');
    return s[s.length - 1] as Extract<ServerMsg, { t: 'snap' }> | undefined;
  }
  clear() {
    this.msgs.clear();
  }
}

const DT = 1 / 60;

function makeRoom(botFill = 0) {
  const sink = new Sink();
  const room = new GameRoom({ id: 'r', maps: MAPS, transport: sink, botFill, roomSize: 8, seed: 7 });
  return { room, sink };
}

/** Advance the room in 1/60 s ticks, feeding inputs for a player. */
function advance(room: GameRoom, seconds: number, playerId?: number, keys = 0, yaw = 0, pitch = 0, seqRef = { seq: 0 }) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    if (playerId !== undefined) {
      const f: InputTuple = [++seqRef.seq, DT, keys, yaw, pitch];
      room.handleMessage(playerId, { t: 'in', rt: room.now, f: [f] });
    }
    room.update(room.now + DT * 1000);
  }
}

describe('game room', () => {
  let room: GameRoom;
  let sink: Sink;
  beforeEach(() => {
    ({ room, sink } = makeRoom());
    room.update(1000);
  });

  it('welcomes a joining player and runs the match state machine', () => {
    const p = room.addHuman('Ace', 'rifle');
    room.welcome(p.id);
    const welcome = sink.msgs.get(p.id)?.find((m) => m.t === 'welcome');
    expect(welcome?.t).toBe('welcome');
    expect(room.phase).toBe('countdown');
    expect(p.alive).toBe(true);
    advance(room, MATCH.COUNTDOWN_S + 0.1);
    expect(room.phase).toBe('live');
    expect(sink.events(p.id).some((e) => e.e === 'match' && e.m.phase === 'live')).toBe(true);
  });

  it('acknowledges inputs and moves the player', () => {
    const p = room.addHuman('Ace', 'rifle');
    advance(room, MATCH.COUNTDOWN_S + 0.1);
    const z0 = p.move.pos.z;
    const x0 = p.move.pos.x;
    const seq = { seq: 0 };
    advance(room, 1, p.id, Keys.FWD, p.yaw, 0, seq);
    const snap = sink.lastSnap(p.id);
    expect(snap?.ack).toBe(seq.seq);
    expect(Math.hypot(p.move.pos.x - x0, p.move.pos.z - z0)).toBeGreaterThan(2);
  });

  it('drops inputs that run ahead of real time (speed hack)', () => {
    const p = room.addHuman('Ace', 'rifle');
    advance(room, MATCH.COUNTDOWN_S + 0.1);
    const z0 = p.move.pos.z;
    // Send 10 seconds of inputs in a single tick.
    const f: InputTuple[] = [];
    for (let i = 1; i <= 12; i++) f.push([i, 1 / 30, Keys.FWD, 0, 0]);
    for (let k = 0; k < 25; k++) {
      room.handleMessage(p.id, { t: 'in', rt: room.now, f: f.map((t) => [t[0] + k * 12, t[1], t[2], t[3], t[4]] as InputTuple) });
    }
    room.update(room.now + 16);
    const moved = Math.abs(p.move.pos.z - z0);
    // Legit budget is ~0.25 s of movement at most.
    expect(moved).toBeLessThan(2.5);
    expect(p.lastSeq).toBe(300);
  });

  it('registers hits, applies armor, kills, scores and respawns', () => {
    const a = room.addHuman('Shooter', 'rifle');
    const v = room.addHuman('Victim', 'smg');
    advance(room, MATCH.COUNTDOWN_S + 0.1);
    // Place both on the open mezzanine, the victim 6 m along +X; yaw -PI/2 looks toward +X.
    const yaw = -Math.PI / 2;
    a.move.pos.x = 0;
    a.move.pos.y = 3.8;
    a.move.pos.z = -18;
    v.move.pos.x = 6;
    v.move.pos.y = 3.8;
    v.move.pos.z = -18;
    a.protectedUntil = 0;
    v.protectedUntil = 0;
    // Let the spawn protection expire and history fill.
    advance(room, COMBAT.SPAWN_PROTECTION + 0.2, a.id, Keys.CROUCH | Keys.ADS, yaw);
    sink.clear();
    const seq = { seq: 1000 };
    // Fire one shot while aiming down sights and crouched (minimal spread).
    advance(room, 0.05, a.id, Keys.ADS | Keys.CROUCH | Keys.FIRE, yaw, 0, seq);
    const hits = sink.events(a.id).filter((e) => e.e === 'hit');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(v.hp + v.armor).toBeLessThan(COMBAT.MAX_HP + COMBAT.SPAWN_ARMOR);
    expect(v.armor).toBeLessThan(COMBAT.SPAWN_ARMOR);
    const dmgEv = sink.events(v.id).find((e) => e.e === 'dmg');
    expect(dmgEv).toBeTruthy();

    // Hold fire until the victim dies.
    v.hp = 5;
    v.armor = 0;
    sink.clear();
    advance(room, 0.5, a.id, Keys.ADS | Keys.CROUCH | Keys.FIRE, yaw, 0, seq);
    const kill = sink.events(a.id).find((e) => e.e === 'kill');
    expect(kill && kill.e === 'kill' && kill.k === a.id && kill.v === v.id).toBeTruthy();
    expect(v.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(v.deaths).toBe(1);
    expect(a.score).toBeGreaterThanOrEqual(SCORE.KILL);
    expect(a.streak).toBe(1);

    // Dead players do not move and respawn after the delay.
    const deadPos = { ...v.move.pos };
    advance(room, 1, v.id, Keys.FWD);
    expect(v.move.pos).toEqual(deadPos);
    advance(room, COMBAT.RESPAWN_DELAY + 0.2);
    expect(v.alive).toBe(true);
    expect(v.hp).toBe(COMBAT.MAX_HP);
    const snap = sink.lastSnap(v.id);
    expect((snap?.you?.[YOU.FLAGS] ?? 0) & PFlag.ALIVE).toBeTruthy();
  });

  it('enforces fire rate server-side even if the client spams fire inputs', () => {
    const a = room.addHuman('Shooter', 'sniper');
    advance(room, MATCH.COUNTDOWN_S + 0.1);
    advance(room, 1, a.id, 0);
    sink.clear();
    const seq = { seq: 500 };
    // Toggle fire every frame for one second: a sniper at 42 rpm can fire at most once.
    for (let i = 0; i < 60; i++) advance(room, DT, a.id, i % 2 ? Keys.FIRE : 0, 0, 0, seq);
    const shots = sink.events(a.id).filter((e) => e.e === 'shot' && e.id === a.id);
    expect(shots.length).toBe(1);
    expect(a.weapon.ammo[0].mag).toBe(WEAPONS.sniper.magSize - 1);
  });

  it('fills with bots and removes them as humans join', () => {
    const { room: r } = makeRoom(3);
    r.update(1000);
    r.addHuman('A', 'rifle');
    expect(r.botCount()).toBe(3);
    r.addHuman('B', 'rifle');
    expect(r.botCount()).toBe(2);
    expect(r.players.size).toBe(4);
  });

  it('ends the match after the duration and rotates the map', () => {
    const { room: r, sink: s } = makeRoom(2);
    r.update(1000);
    const p = r.addHuman('A', 'rifle');
    const map0 = r.map.id;
    r.update(r.now + (MATCH.COUNTDOWN_S + 0.1) * 1000);
    expect(r.phase).toBe('live');
    r.update(r.now + (MATCH.DURATION_S + 0.1) * 1000);
    expect(r.phase).toBe('ended');
    const ended = s.events(p.id).find((e) => e.e === 'match' && e.m.phase === 'ended');
    expect(ended && ended.e === 'match' && ended.results?.length).toBe(3);
    r.update(r.now + (MATCH.RESULTS_S + 0.1) * 1000);
    expect(r.phase).toBe('countdown');
    expect(r.map.id).not.toBe(map0);
  });
});
