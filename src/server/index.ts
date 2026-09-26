import { createServer } from 'node:http';
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

function clampInt(v: string | undefined, def: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

const manager = new RoomManager({ roomSize: ROOM_SIZE, botFill: BOT_FILL, idleTimeoutMs: 30_000, now: () => performance.now() });
manager.start();

const http = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/health' || url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...manager.stats(), uptime: Math.round(process.uptime()) }));
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
    if (ALLOWED_ORIGINS.length === 0) return done(true);
    if (origin && ALLOWED_ORIGINS.includes(origin)) return done(true);
    // Allow same-host and localhost during development.
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return done(true);
    done(false, 403, 'Origin not allowed');
  },
});

interface Session {
  ws: WebSocket;
  room: GameRoom | null;
  playerId: number;
  alive: boolean;
  tokens: number;
  lastRefill: number;
  joinTimer: ReturnType<typeof setTimeout> | null;
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
  const session: Session = { ws, room: null, playerId: -1, alive: true, tokens: NET.MAX_MSG_PER_SEC, lastRefill: Date.now(), joinTimer: null };
  sessions.set(ws, session);
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.socket.remoteAddress;
  session.joinTimer = setTimeout(() => {
    if (!session.room) ws.close(1008, 'Join timeout');
  }, JOIN_TIMEOUT_MS);

  ws.on('pong', () => {
    session.alive = true;
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return ws.close(1003, 'Binary not supported');
    // Token bucket rate limit.
    const now = Date.now();
    session.tokens = Math.min(NET.MAX_MSG_PER_SEC, session.tokens + ((now - session.lastRefill) / 1000) * NET.MAX_MSG_PER_SEC);
    session.lastRefill = now;
    if (session.tokens < 1) return ws.close(1008, 'Rate limit');
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
        ws.close(1008, 'Version mismatch');
        return;
      }
      const name = sanitizeName(msg.name) || randomName();
      const room = manager.findRoom();
      const player = room.addHuman(name, msg.weapon);
      session.room = room;
      session.playerId = player.id;
      manager.attach(room, player.id, { send: (m) => send(session, m), close: (reason) => ws.close(1008, reason) });
      if (session.joinTimer) clearTimeout(session.joinTimer);
      console.log(`[join] ${name} (#${player.id}) -> ${room.id} from ${ip}`);
      return;
    }
    if (msg.t === 'join') return;
    session.room.handleMessage(session.playerId, msg);
  });

  ws.on('close', () => {
    sessions.delete(ws);
    if (session.joinTimer) clearTimeout(session.joinTimer);
    if (session.room) {
      console.log(`[leave] #${session.playerId} from ${session.room.id}`);
      manager.detach(session.room, session.playerId);
      session.room = null;
    }
  });

  ws.on('error', (err) => {
    console.warn('[ws error]', err.message);
  });
});

// Heartbeat: ping every 15s, drop sockets that did not answer the previous ping.
const pingTimer = setInterval(() => {
  for (const [ws, s] of sessions) {
    if (!s.alive) {
      ws.terminate();
      continue;
    }
    s.alive = false;
    if (ws.readyState === ws.OPEN) ws.ping();
  }
}, 15_000);

http.listen(PORT, () => {
  console.log(`SHOTDIS server listening on :${PORT} (room size ${ROOM_SIZE}, bot fill ${BOT_FILL}, origins: ${ALLOWED_ORIGINS.join(', ') || 'any'})`);
});

function shutdown(): void {
  console.log('Shutting down...');
  clearInterval(pingTimer);
  manager.stop();
  for (const ws of wss.clients) ws.close(1001, 'Server restarting');
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
