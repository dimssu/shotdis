import { MAPS } from '../shared/maps';
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
      if (room.humanCount() === 0 && room.idleMs() > this.opts.idleTimeoutMs) {
        this.rooms.delete(id);
        this.links.delete(id);
      }
    }
  }

  /** Pick the fullest room that still has space, or create one. */
  findRoom(): GameRoom {
    let best: GameRoom | null = null;
    for (const room of this.rooms.values()) {
      if (!room.hasRoomForHuman()) continue;
      if (!best || room.humanCount() > best.humanCount()) best = room;
    }
    if (best) return best;
    return this.createRoom();
  }

  createRoom(): GameRoom {
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
      botFill: this.opts.botFill,
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

  stats(): { rooms: number; players: number; bots: number } {
    let players = 0;
    let bots = 0;
    for (const r of this.rooms.values()) {
      players += r.humanCount();
      bots += r.botCount();
    }
    return { rooms: this.rooms.size, players, bots };
  }
}
