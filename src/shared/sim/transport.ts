import type { ServerMsg } from '../protocol';

/** How a room talks to its players. Implemented by the WebSocket server and by the in-browser loopback. */
export interface RoomTransport {
  send(playerId: number, msg: ServerMsg): void;
  kick(playerId: number, reason: string): void;
}
