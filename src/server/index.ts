import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { MATCH, NET } from '../shared/config';
import { isCompatibleVersion, parseClientMessage, type ServerMsg } from '../shared/protocol';
import type { GameRoom } from '../shared/sim/room';
import { randomName, sanitizeName } from '../shared/util/sanitize';
import { RoomManager } from './room-manager';

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ROOM_SIZE = clampInt(process.env.ROOM_SIZE, MATCH.ROOM_SIZE, 2, 16);
const BOT_FILL = clampInt(process.env.BOT_FILL, MATCH.BOT_FILL, 0, 12);
const JOIN_TIMEOUT_MS = 8000;
const MAX_BUFFERED_BYTES = 512 * 1024;
const MAX_SESSIONS = clampInt(process.env.MAX_SESSIONS, 400, 8, 5000);
const MAX_ROOMS = clampInt(process.env.MAX_ROOMS, 48, 1, 500);
const MAX_PER_IP = clampInt(process.env.MAX_PER_IP, 6, 1, 100);
const MAX_PRIVATE_ROOMS = clampInt(process.env.MAX_PRIVATE_ROOMS, 32, 1, 500);
/** Private rooms one address may create per minute. */
const CREATES_PER_MIN = 4;
/** Wrong room codes one address may try per 10 minutes before lookups are refused. */
const MISSES_PER_10_MIN = 12;
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
/** How long a dropped player keeps their slot for a reconnect. */
const REJOIN_GRACE_MS = 20_000;

/** Entries may contain `*` wildcards, e.g. `https://shotdis-*.vercel.app`. Localhost is always allowed. */
const ORIGIN_PATTERNS = ALLOWED_ORIGINS.map((o) => new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9.-]*') + '$', 'i'));

function originAllowed(origin: string | undefined): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return ORIGIN_PATTERNS.some((re) => re.test(origin));
}

function clampInt(v: string | undefined, def: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

const manager = new RoomManager({
  roomSize: ROOM_SIZE,
  botFill: BOT_FILL,
  idleTimeoutMs: 30_000,
  maxRooms: MAX_ROOMS,
  maxPrivateRooms: MAX_PRIVATE_ROOMS,
  now: () => performance.now(),
});

/** Sliding-window counter per address (room creation and failed code lookups). */
class RateWindow {
  private hits = new Map<string, number[]>();
  constructor(
    private windowMs: number,
    private limit: number,
  ) {}
  /** Record a hit; returns false when the address is over its limit. */
  allow(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
  blocked(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    return list.length >= this.limit;
  }
  prune(now = Date.now()): void {
    for (const [k, list] of this.hits) if (list.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}
const createLimiter = new RateWindow(60_000, CREATES_PER_MIN);
const missLimiter = new RateWindow(600_000, MISSES_PER_10_MIN);
manager.start();

/** Rejoin tokens handed out in welcome messages, so a client that drops can reclaim its player. */
interface TokenEntry {
  room: GameRoom;
  playerId: number;
  session: Session | null;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}
const tokens = new Map<string, TokenEntry>();
const ipCounts = new Map<string, number>();

const http = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/health' || url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    const st = manager.stats();
    // Private room counts stay internal: they would help someone guess codes.
    res.end(JSON.stringify({ ok: true, rooms: st.rooms - st.privateRooms, players: st.players, bots: st.bots, uptime: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('SHOTDIS game server. Connect with a WebSocket client.\n');
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: NET.MAX_MESSAGE_BYTES,
  perMessageDeflate: false,
  verifyClient: ({ origin }, done) => {
    if (originAllowed(origin)) return done(true);
    done(false, 403, 'Origin not allowed');
  },
});

interface Session {
  ws: WebSocket;
  room: GameRoom | null;
  playerId: number;
  token: string;
  ip: string;
  alive: boolean;
  closed: boolean;
  tokens: number;
  lastRefill: number;
  joinTimer: ReturnType<typeof setTimeout> | null;
}

function clientIp(req: import('node:http').IncomingMessage): string {
  if (TRUST_PROXY) {
    // The trusted proxy appends the address it saw; anything before that came from the client and can be forged.
    const fwd = req.headers['x-forwarded-for'];
    const parts = (Array.isArray(fwd) ? fwd.join(',') : fwd ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Punitive disconnect: drop the socket immediately so no further messages are processed. */
function terminate(session: Session, reason: string): void {
  session.closed = true;
  try {
    session.ws.close(1008, reason);
  } catch {}
  setTimeout(() => session.ws.terminate(), 250).unref();
}

/** Refuse a join with a reason the client can show, then drop the socket. */
function reject(session: Session, code: string, msg: string): void {
  send(session, { t: 'err', code, msg });
  terminate(session, code);
}

/** Player left for good: free their slot and token. */
function dropPlayer(entry: TokenEntry, token: string): void {
  if (entry.timer) clearTimeout(entry.timer);
  tokens.delete(token);
  manager.detach(entry.room, entry.playerId);
}

const sessions = new Map<WebSocket, Session>();

function send(session: Session, msg: ServerMsg): void {
  const ws = session.ws;
  if (ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
    // The client cannot keep up; drop it rather than let memory grow.
    ws.close(1008, 'Connection too slow');
    return;
  }
  ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const session: Session = { ws, room: null, playerId: -1, token: '', ip, alive: true, closed: false, tokens: NET.MAX_MSG_PER_SEC, lastRefill: Date.now(), joinTimer: null };
  if (sessions.size >= MAX_SESSIONS || (ipCounts.get(ip) ?? 0) >= MAX_PER_IP) {
    try {
      ws.close(1013, 'Server full');
    } catch {}
    return;
  }
  sessions.set(ws, session);
  ipCounts.set(ip, (ipCounts.get(ip) ?? 0) + 1);
  session.joinTimer = setTimeout(() => {
    if (!session.room) terminate(session, 'Join timeout');
  }, JOIN_TIMEOUT_MS);

  ws.on('pong', () => {
    session.alive = true;
  });

  ws.on('message', (data, isBinary) => {
    if (session.closed) return;
    if (isBinary) return terminate(session, 'Binary not supported');
    // Token bucket rate limit.
    const now = Date.now();
    session.tokens = Math.min(NET.MAX_MSG_PER_SEC, session.tokens + ((now - session.lastRefill) / 1000) * NET.MAX_MSG_PER_SEC);
    session.lastRefill = now;
    if (session.tokens < 1) return terminate(session, 'Rate limit');
    session.tokens -= 1;

    const msg = parseClientMessage(data.toString());
    if (!msg) {
      send(session, { t: 'err', code: 'bad_message', msg: 'Malformed message' });
      return;
    }
    if (!session.room) {
      if (msg.t !== 'join') return;
      if (!isCompatibleVersion(msg.v)) {
        send(session, { t: 'err', code: 'version', msg: 'Your game client is out of date. Refresh the page.' });
        terminate(session, 'Version mismatch');
        return;
      }
      if (session.joinTimer) clearTimeout(session.joinTimer);
      const link = { send: (m: ServerMsg) => send(session, m), close: (reason: string) => terminate(session, reason) };

      // Reconnect with a valid token: reclaim the existing player instead of creating a ghost.
      const entry = msg.token ? tokens.get(msg.token) : undefined;
      if (entry && msg.token && entry.room.players.has(entry.playerId) && manager.rooms.has(entry.room.id)) {
        if (entry.session && entry.session !== session) {
          entry.session.room = null; // the old socket must not detach the player when it finally closes
          terminate(entry.session, 'Replaced by reconnect');
        }
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = null;
        entry.session = session;
        session.room = entry.room;
        session.playerId = entry.playerId;
        session.token = msg.token;
        entry.room.rejoin(entry.playerId);
        manager.attach(entry.room, entry.playerId, link);
        entry.room.welcome(entry.playerId, msg.token);
        console.log(`[rejoin] #${entry.playerId} -> ${entry.room.id} from ${ip}`);
        return;
      }

      const name = sanitizeName(msg.name) || randomName();
      let room: GameRoom | null | undefined;
      if (msg.room && 'create' in msg.room) {
        if (!createLimiter.allow(ip)) {
          reject(session, 'rate_limited', 'You created several rooms in a row. Wait a minute and try again.');
          return;
        }
        room = manager.createPrivateRoom(msg.room.bots);
      } else if (msg.room && 'code' in msg.room) {
        if (missLimiter.blocked(ip)) {
          reject(session, 'rate_limited', 'Too many wrong room codes. Wait a few minutes and try again.');
          return;
        }
        room = manager.getPrivateRoom(msg.room.code);
        if (!room) {
          missLimiter.allow(ip);
          reject(session, 'room_not_found', `Room ${msg.room.code} doesn't exist or has already closed. Check the code with your friend.`);
          return;
        }
        if (!room.hasRoomForHuman()) {
          reject(session, 'room_full', `Room ${msg.room.code} is full.`);
          return;
        }
      } else {
        room = manager.findRoom();
      }
      if (!room) {
        reject(session, 'full', 'All rooms are full right now. Try again in a moment.');
        return;
      }
      const player = room.addHuman(name, msg.weapon);
      const token = randomBytes(18).toString('base64url');
      session.room = room;
      session.playerId = player.id;
      session.token = token;
      tokens.set(token, { room, playerId: player.id, session, expiresAt: 0, timer: null });
      manager.attach(room, player.id, link);
      room.welcome(player.id, token);
      console.log(`[join] ${name} (#${player.id}) -> ${room.id}${room.isPrivate ? ` (private ${room.code})` : ''} from ${ip}`);
      return;
    }
    if (msg.t === 'join') return;
    session.room.handleMessage(session.playerId, msg);
  });

  ws.on('close', (code) => {
    sessions.delete(ws);
    const n = (ipCounts.get(ip) ?? 1) - 1;
    if (n <= 0) ipCounts.delete(ip);
    else ipCounts.set(ip, n);
    if (session.joinTimer) clearTimeout(session.joinTimer);
    const room = session.room;
    if (!room) return;
    session.room = null;
    const entry = tokens.get(session.token);
    if (!entry || entry.session !== session) return;
    // 1000 = the player left on purpose, 1001 = tab closed or page navigated away: remove them now.
    if (code === 1000 || code === 1001) {
      console.log(`[leave] #${session.playerId} from ${room.id}`);
      dropPlayer(entry, session.token);
      return;
    }
    // Anything else is a dropped connection: keep the slot briefly so a quick reconnect can reclaim it.
    entry.session = null;
    room.markDisconnected(session.playerId);
    console.log(`[drop] #${session.playerId} from ${room.id} (rejoin window ${REJOIN_GRACE_MS / 1000}s)`);
    entry.timer = setTimeout(() => {
      if (entry.session === null) {
        console.log(`[leave] #${session.playerId} from ${room.id}`);
        dropPlayer(entry, session.token);
      }
    }, REJOIN_GRACE_MS);
  });

  ws.on('error', (err) => {
    console.warn('[ws error]', err.message);
  });
});

// Heartbeat: ping every 5s, drop sockets that did not answer the previous ping.
const pingTimer = setInterval(() => {
  createLimiter.prune();
  missLimiter.prune();
  for (const [ws, s] of sessions) {
    if (!s.alive) {
      ws.terminate();
      continue;
    }
    s.alive = false;
    if (ws.readyState === ws.OPEN) ws.ping();
  }
}, 5_000);

http.listen(PORT, () => {
  console.log(`SHOTDIS server listening on :${PORT} (room size ${ROOM_SIZE}, bot fill ${BOT_FILL}, origins: ${ALLOWED_ORIGINS.join(', ') || 'any'}, trust proxy: ${TRUST_PROXY})`);
});

function shutdown(): void {
  console.log('Shutting down...');
  clearInterval(pingTimer);
  manager.stop();
  for (const t of tokens.values()) if (t.timer) clearTimeout(t.timer);
  for (const ws of wss.clients) ws.close(1001, 'Server restarting');
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
