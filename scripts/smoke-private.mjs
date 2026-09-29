// Smoke test for private rooms against a running server.
// Usage: node scripts/smoke-private.mjs [wss://server] [origin]
import WebSocket from 'ws';

const url = process.argv[2] ?? 'wss://shotdis-server-36022121864.asia-south1.run.app';
const origin = process.argv[3] ?? 'https://shotdis.vercel.app';
const V = 4;

function client(name) {
  const ws = new WebSocket(url, { headers: { origin } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const closed = new Promise((res) => ws.on('close', (code, reason) => res({ code, reason: reason.toString() })));
  const waitFor = (test, ms = 8000) =>
    new Promise((resolve, reject) => {
      const found = inbox.find(test);
      if (found) return resolve(found);
      const w = { test, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error(`${name}: timed out`)), ms);
    });
  const events = () => inbox.flatMap((m) => (m.t === 'ev' ? m.e : []));
  return { ws, open, closed, waitFor, events, send: (m) => ws.send(JSON.stringify(m)), name };
}

const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
};

const host = client('host');
await host.open;
host.send({ t: 'join', name: 'SmokeHost', weapon: 'rifle', v: V, room: { create: true, bots: 1 } });
const hw = await host.waitFor((m) => m.t === 'welcome');
const code = hw.match.code;
ok(/^[A-Z2-9]{5}$/.test(code), `host created private room ${code}`);
ok(hw.match.phase === 'warmup' && hw.match.host === hw.id, 'room opens in warmup with the creator as host');

const friend = client('friend');
await friend.open;
friend.send({ t: 'join', name: 'SmokeFriend', weapon: 'smg', v: V, room: { code: code.toLowerCase() } });
const fw = await friend.waitFor((m) => m.t === 'welcome');
ok(fw.match.code === code && fw.room === hw.room, 'friend joined the same room by code');
const scores = await friend.waitFor((m) => m.t === 'scores');
ok(scores.p.filter((p) => p.bot).length === 1 && scores.p.filter((p) => !p.bot).length === 2, 'two humans and exactly one bot');

friend.send({ t: 'start', map: 'neon' });
await new Promise((r) => setTimeout(r, 700));
ok(!friend.events().some((e) => e.e === 'match' && e.m.phase === 'countdown'), 'non-host start is ignored');
host.send({ t: 'start', map: 'neon' });
const cd = await friend.waitFor((m) => m.t === 'ev' && m.e.some((e) => e.e === 'match' && e.m.phase === 'countdown'));
const ev = cd.e.find((e) => e.e === 'match');
ok(ev.m.map === 'neon', 'host start moves everyone to the chosen arena');

host.ws.close(1000, 'bye');
const hostEv = await friend.waitFor((m) => m.t === 'ev' && m.e.some((e) => e.e === 'host'), 4000).catch(() => null);
ok(!!hostEv && hostEv.e.find((e) => e.e === 'host').id === fw.id, 'host leaving hands the role to the friend immediately');

const stranger = client('stranger');
await stranger.open;
stranger.send({ t: 'join', name: 'Nope', weapon: 'rifle', v: V, room: { code: 'ZZZZZ' } });
const err = await stranger.waitFor((m) => m.t === 'err');
ok(err.code === 'room_not_found', `wrong code refused: "${err.msg}"`);

const health = await fetch(url.replace(/^ws/, 'http') + '/health').then((r) => r.json());
ok(!('privateRooms' in health), 'health endpoint does not reveal private room counts');

friend.ws.close(1000, 'bye');
stranger.ws.close();
await new Promise((r) => setTimeout(r, 300));
process.exit();
