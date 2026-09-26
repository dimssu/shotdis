import WebSocket from 'ws';
const url = process.argv[2] ?? 'wss://shotdis-server-36022121864.asia-south1.run.app';
function test(origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { origin } });
    const t = setTimeout(() => { ws.terminate(); resolve(`${origin}: timeout`); }, 10000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'join', name: 'Probe', weapon: 'rifle', v: 3 }));
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'welcome') { clearTimeout(t); ws.close(); resolve(`${origin}: welcome id=${m.id} map=${m.match.map} phase=${m.match.phase} players=${m.players.length}`); }
    });
    ws.on('error', (e) => { clearTimeout(t); resolve(`${origin}: error ${e.message}`); });
    ws.on('unexpected-response', (req, res) => { clearTimeout(t); resolve(`${origin}: rejected ${res.statusCode}`); });
  });
}
for (const o of ['https://shotdis.vercel.app', 'https://shotdis-abc-aryan-singhs-projects.vercel.app', 'https://evil.example']) console.log(await test(o));
