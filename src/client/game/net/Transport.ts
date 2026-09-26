import type { ClientMsg, ServerMsg } from '@shared/protocol';
import { parseClientMessage, parseServerMessage } from '@shared/protocol';
import { MAPS } from '@shared/maps';
import { GameRoom } from '@shared/sim/room';
import type { BotDifficulty } from '@shared/sim/bot';
import type { WeaponId } from '@shared/weapons';

export interface Transport {
  readonly kind: 'online' | 'practice';
  onMessage: ((msg: ServerMsg) => void) | null;
  onClose: ((reason: string) => void) | null;
  send(msg: ClientMsg): void;
  /** Called once per frame by the game loop. */
  tick(now: number): void;
  close(): void;
}

/** Real WebSocket connection to the authoritative server. */
export class WsTransport implements Transport {
  readonly kind = 'online' as const;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private closed = false;

  connect(url: string, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Invalid server URL'));
        return;
      }
      this.ws = ws;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error('Connection timed out'));
      }, timeoutMs);
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Could not reach the game server'));
      };
      ws.onmessage = (ev) => {
        const msg = parseServerMessage(ev.data);
        if (msg) this.onMessage?.(msg);
      };
      ws.onclose = (ev) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Connection closed'));
          return;
        }
        if (this.closed) return;
        this.closed = true;
        this.onClose?.(ev.reason || (ev.code === 1006 ? 'Connection lost' : `Disconnected (${ev.code})`));
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  tick(): void {}

  close(): void {
    this.closed = true;
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }
}

export interface PracticeOptions {
  name: string;
  weapon: WeaponId;
  bots: number;
  difficulty: BotDifficulty | 'mixed';
  mapIndex: number;
}

/**
 * Runs the authoritative room inside the browser. The exact same GameRoom code
 * that powers the server drives practice mode, so behaviour is identical.
 */
export class LoopbackTransport implements Transport {
  readonly kind = 'practice' as const;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private room: GameRoom;
  private queue: ServerMsg[] = [];
  private playerId = -1;
  private opts: PracticeOptions;
  private joined = false;

  constructor(opts: PracticeOptions) {
    this.opts = opts;
    this.room = new GameRoom({
      id: 'practice',
      maps: MAPS,
      transport: {
        send: (pid, msg) => {
          if (pid !== this.playerId) return;
          this.queue.push(JSON.parse(JSON.stringify(msg)) as ServerMsg);
          this.scheduleFlush();
        },
        kick: () => {},
      },
      roomSize: opts.bots + 1,
      botFill: opts.bots,
      seed: (Math.random() * 1e9) >>> 0,
      startMapIndex: opts.mapIndex,
      botDifficulty: opts.difficulty,
    });
    this.room.update(performance.now());
  }

  send(msg: ClientMsg): void {
    // Round-trip through the validator, exactly like the server would.
    const parsed = parseClientMessage(JSON.stringify(msg));
    if (!parsed) return;
    if (parsed.t === 'join') {
      if (this.joined) return;
      this.joined = true;
      const p = this.room.addHuman(parsed.name || this.opts.name, parsed.weapon);
      this.playerId = p.id;
      this.room.welcome(p.id);
      return;
    }
    this.room.handleMessage(this.playerId, parsed);
  }

  private flushScheduled = false;

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.onMessage?.(m);
  }

  tick(now: number): void {
    this.room.update(now);
    this.flush();
  }

  close(): void {
    this.queue = [];
  }
}
