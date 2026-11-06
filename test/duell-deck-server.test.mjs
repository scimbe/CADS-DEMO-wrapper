// Integration: the real server wires the card statistics into the "Statistik" tab of /duell/pruefen
// (DECK.useStat(STATS) in server.mjs). With the token the admin route returns exact counters; without it 401.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

const TOKEN = 'test-admin-token-0123456789';
let proc, base;
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DUELL_ADMIN_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 8000);
    proc.stdout.on('data', (b) => { if (String(b).includes('wrapper on')) { clearTimeout(to); resolve(); } });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
after(() => { if (proc) proc.kill(); });

test('Statistik-Reiter am echten Server: STATS angebunden, mit Token exakte Werte unter k, ohne Token 401', async () => {
  for (const e of ['open', 'share']) {
    const r = await fetch(base + '/api/duell/stat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i: 'srv-test', e, ...(e === 'share' ? { w: ['farbe'] } : {}) }) });
    assert.equal(r.status, 204);
  }
  const no = await fetch(base + '/api/duell/admin/stat?days=7');
  assert.equal(no.status, 401);
  const r = await fetch(base + '/api/duell/admin/stat?days=7', { headers: { Authorization: 'Bearer ' + TOKEN } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.stat, 'stat ist angebunden (nicht null)');
  assert.equal(j.stat.masked, false);
  const row = j.stat.cards.find((c) => c.i === 'srv-test');
  assert.ok(row, 'Karte steht in der Admin-Statistik');
  assert.equal(row.open, 1); assert.equal(row.share, 1); assert.equal(row.remix, 1);
  // the public route keeps the k mask: 1 < 5 is null there
  const pub = await (await fetch(base + '/api/duell/stat?days=7')).json();
  const prow = (pub.cards || []).find((c) => c.i === 'srv-test');
  assert.ok(!prow || prow.open === null);
});
