import { describe, expect, it } from 'vitest';
import { COMBAT, MATCH, PROTOCOL_VERSION } from '@shared/config';
import { Keys } from '@shared/physics/movement';
import { parseClientMessage, type GameEvent, type InputTuple, type ServerMsg } from '@shared/protocol';
import type { GameRoom } from '@shared/sim/room';
import { generateRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET } from '@shared/util/roomCode';
import { RoomManager } from '../server/room-manager';

const DT = 1 / 60;

class Clock {
  t = 1000;
  now = () => this.t;
}

function setup(roomSize = 8) {
  const clock = new Clock();
  const manager = new RoomManager({ roomSize, botFill: 4, idleTimeoutMs: 30_000, privateIdleTimeoutMs: 60_000, now: clock.now });
  const inbox = new Map<number, ServerMsg[]>();
  const connect = (room: GameRoom, name: string) => {
    const p = room.addHuman(name, 'rifle');
    const box: ServerMsg[] = [];
    inbox.set(p.id, box);
    manager.attach(room, p.id, { send: (m) => box.push(m), close: () => {} });
    room.welcome(p.id);
    return p;
  };
  const events = (id: number): GameEvent[] => (inbox.get(id) ?? []).flatMap((m) => (m.t === 'ev' ? m.e : []));
  const tick = (seconds: number) => {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      clock.t += DT * 1000;
      manager.tick();
    }
  };
  return { clock, manager, connect, events, tick, inbox };
}

describe('room codes', () => {
  it('generates codes from the unambiguous alphabet', () => {
    let i = 0;
    const code = generateRoomCode((max) => i++ % max);
    expect(code).toHaveLength(5);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
  });

  it('normalizes case, spaces and dashes, and rejects bad codes', () => {
    expect(normalizeRoomCode(' k7q-xp ')).toBe('K7QXP');
    expect(normalizeRoomCode('K7QX')).toBe('');
    expect(normalizeRoomCode('K7QX0')).toBe(''); // zero is not in the alphabet
    expect(normalizeRoomCode('<b>12')).toBe('');
    expect(normalizeRoomCode(12345)).toBe('');
  });

  it('validates private-room join and start messages', () => {
    const base = { t: 'join', name: 'A', weapon: 'rifle', v: PROTOCOL_VERSION };
    expect(parseClientMessage(JSON.stringify({ ...base, room: { create: true, bots: 2 } }))).toMatchObject({ room: { create: true, bots: 2 } });
    expect(parseClientMessage(JSON.stringify({ ...base, room: { code: 'k7qxp' } }))).toMatchObject({ room: { code: 'K7QXP' } });
    expect(parseClientMessage(JSON.stringify({ ...base, room: { create: true, bots: 99 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...base, room: { create: true, bots: 1.5 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...base, room: { code: 'nope!' } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...base, room: 'K7QXP' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'start', map: 'neon' }))).toEqual({ t: 'start', map: 'neon' });
    expect(parseClientMessage(JSON.stringify({ t: 'start', map: 5 }))).toBeNull();
  });
});

describe('private rooms', () => {
  it('are created with a code, found by code, and never used for matchmaking', () => {
    const { manager } = setup();
    const room = manager.createPrivateRoom(0)!;
    expect(room.isPrivate).toBe(true);
    expect(room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(manager.getPrivateRoom(room.code.toLowerCase())).toBe(room);
    expect(manager.getPrivateRoom('ZZZZZ')).toBeUndefined();
    const pub = manager.findRoom()!;
    expect(pub).not.toBe(room);
    expect(pub.isPrivate).toBe(false);
    expect(manager.stats().privateRooms).toBe(1);
  });

  it('start in warmup: players spawn, move and fight, but nothing is scored', () => {
    const { manager, connect, tick } = setup();
    const room = manager.createPrivateRoom(0)!;
    const a = connect(room, 'Host');
    const b = connect(room, 'Friend');
    expect(room.phase).toBe('warmup');
    expect(room.hostId).toBe(a.id);
    expect(a.alive && b.alive).toBe(true);
    expect(room.botCount()).toBe(0);
    tick(COMBAT.SPAWN_PROTECTION + 0.5);
    const z0 = a.move.pos.z;
    const x0 = a.move.pos.x;
    for (let i = 1; i <= 40; i++) {
      const f: InputTuple = [i, DT, Keys.FWD, a.yaw, 0, room.now];
      room.handleMessage(a.id, { t: 'in', f: [f] });
      tick(DT);
    }
    expect(Math.hypot(a.move.pos.x - x0, a.move.pos.z - z0)).toBeGreaterThan(1);
    // A warmup kill does not change the scoreboard.
    b.hp = 1;
    b.armor = 0;
    (room as unknown as { kill: (v: unknown, k: unknown, w: string, hs: boolean) => void }).kill(b, a, 'rifle', false);
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(0);
    expect(a.score).toBe(0);
    expect(b.deaths).toBe(0);
    // Players respawn during warmup.
    tick(COMBAT.RESPAWN_DELAY + 0.2);
    expect(b.alive).toBe(true);
  });

  it('only the host can start, can pick the map, and the room returns to warmup after the match', () => {
    const { manager, connect, tick, events } = setup();
    const room = manager.createPrivateRoom(2)!;
    const host = connect(room, 'Host');
    const friend = connect(room, 'Friend');
    expect(room.botCount()).toBe(2); // fixed count, not "fill"
    const otherMap = room.map.id === 'warehouse' ? 'neon' : 'warehouse';
    room.handleMessage(friend.id, { t: 'start', map: otherMap });
    tick(0.1);
    expect(room.phase).toBe('warmup');
    room.handleMessage(host.id, { t: 'start', map: otherMap });
    tick(0.1);
    expect(room.phase).toBe('countdown');
    expect(room.map.id).toBe(otherMap);
    expect(events(friend.id).some((e) => e.e === 'match' && e.m.phase === 'countdown' && e.m.map === otherMap && e.m.code === room.code)).toBe(true);
    tick(MATCH.COUNTDOWN_S + 0.1);
    expect(room.phase).toBe('live');
    // A second start during the match is ignored.
    room.handleMessage(host.id, { t: 'start' });
    tick(0.1);
    expect(room.phase).toBe('live');
    const r = room as unknown as { phaseEndsAt: number };
    r.phaseEndsAt = room.now; // end the match now
    tick(0.1);
    expect(room.phase).toBe('ended');
    tick(MATCH.RESULTS_S + 0.2);
    expect(room.phase).toBe('warmup');
    expect(host.alive && friend.alive).toBe(true);
  });

  it('passes the host role on when the host leaves', () => {
    const { manager, connect, events, tick } = setup();
    const room = manager.createPrivateRoom(0)!;
    const host = connect(room, 'Host');
    const friend = connect(room, 'Friend');
    manager.detach(room, host.id);
    tick(0.05);
    expect(room.hostId).toBe(friend.id);
    expect(events(friend.id).some((e) => e.e === 'host' && e.id === friend.id)).toBe(true);
  });

  it('refuse humans beyond the room size and are cleaned up once empty', () => {
    const { manager, connect, tick } = setup(2);
    const room = manager.createPrivateRoom(0)!;
    const a = connect(room, 'A');
    connect(room, 'B');
    expect(room.hasRoomForHuman()).toBe(false);
    manager.detach(room, a.id);
    expect(room.hasRoomForHuman()).toBe(true);
    for (const p of [...room.players.values()]) manager.detach(room, p.id);
    tick(61);
    expect(manager.getPrivateRoom(room.code)).toBeUndefined();
    expect(manager.rooms.has(room.id)).toBe(false);
  });
});
