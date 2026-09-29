import { randomInt } from 'node:crypto';
import { MAPS } from '../shared/maps';
import { generateRoomCode, normalizeRoomCode } from '../shared/util/roomCode';
import type { ServerMsg } from '../shared/protocol';
import { GameRoom } from '../shared/sim/room';
import type { RoomTransport } from '../shared/sim/transport';

export interface ClientLink {
  send(msg: ServerMsg): void;
  close(reason: string): void;
}

export interface RoomManagerOptions {
  roomSize: number;
  botFill: number;
  idleTimeoutMs: number;
  /** Private rooms survive a little longer without players, so a group can regroup. */
  privateIdleTimeoutMs?: number;
  maxRooms?: number;
  now: () => number;
}

/**
 * Owns every live room, ticks them on a shared timer and hands out rooms to
 * connecting players. Rooms are destroyed once they have been without humans
 * for a while.
 */
export class RoomManager {
  readonly rooms = new Map<string, GameRoom>();
  private links = new Map<string, Map<number, ClientLink>>();
  private codes = new Map<string, GameRoom>();
  private nextRoom = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: RoomManagerOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / 60);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(): void {
    const now = this.opts.now();
    for (const [id, room] of this.rooms) {
      room.update(now);
      const limit = room.isPrivate ? (this.opts.privateIdleTimeoutMs ?? 120_000) : this.opts.idleTimeoutMs;
      if (room.humanCount() === 0 && room.idleMs() > limit) {
        this.rooms.delete(id);
        this.links.delete(id);
        if (room.isPrivate) this.codes.delete(room.code);
      }
    }
  }

  /** Pick the fullest room that still has space, or create one. Returns null when the room cap is reached. */
  findRoom(): GameRoom | null {
    let best: GameRoom | null = null;
    for (const room of this.rooms.values()) {
      if (room.isPrivate || !room.hasRoomForHuman()) continue;
      if (!best || room.humanCount() > best.humanCount()) best = room;
    }
    if (best) return best;
    if (this.rooms.size >= (this.opts.maxRooms ?? 48)) return null;
    return this.createRoom();
  }

  /** Create a private room with its own join code. Returns null when the room cap is reached. */
  createPrivateRoom(bots: number): GameRoom | null {
    if (this.rooms.size >= (this.opts.maxRooms ?? 48)) return null;
    let code = '';
    for (let i = 0; i < 20 && !code; i++) {
      const c = generateRoomCode(randomInt);
      if (!this.codes.has(c)) code = c;
    }
    if (!code) return null;
    const room = this.createRoom({ isPrivate: true, code, bots });
    this.codes.set(code, room);
    return room;
  }

  /** Look up a private room by its code (case and spacing do not matter). */
  getPrivateRoom(code: string): GameRoom | undefined {
    const c = normalizeRoomCode(code);
    return c ? this.codes.get(c) : undefined;
  }

  createRoom(priv?: { isPrivate: true; code: string; bots: number }): GameRoom {
    const id = `room-${this.nextRoom++}`;
    const links = new Map<number, ClientLink>();
    this.links.set(id, links);
    const transport: RoomTransport = {
      send: (pid, msg) => links.get(pid)?.send(msg),
      kick: (pid, reason) => links.get(pid)?.close(reason),
    };
    const room = new GameRoom({
      id,
      maps: MAPS,
      transport,
      roomSize: this.opts.roomSize,
      botFill: priv ? Math.max(0, Math.min(priv.bots, this.opts.roomSize - 1)) : this.opts.botFill,
      botMode: priv ? 'fixed' : 'fill',
      isPrivate: priv?.isPrivate ?? false,
      code: priv?.code ?? '',
      seed: (Math.random() * 1e9) >>> 0,
      startMapIndex: (this.nextRoom - 2) % MAPS.length,
    });
    room.update(this.opts.now());
    this.rooms.set(id, room);
    return room;
  }

  attach(room: GameRoom, playerId: number, link: ClientLink): void {
    this.links.get(room.id)?.set(playerId, link);
  }

  detach(room: GameRoom, playerId: number): void {
    this.links.get(room.id)?.delete(playerId);
    room.removePlayer(playerId);
  }

  stats(): { rooms: number; privateRooms: number; players: number; bots: number } {
    let players = 0;
    let bots = 0;
    for (const r of this.rooms.values()) {
      players += r.humanCount();
      bots += r.botCount();
    }
    return { rooms: this.rooms.size, privateRooms: this.codes.size, players, bots };
  }
}
