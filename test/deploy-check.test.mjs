// bin/deploy-check.mjs (staging finding L4): ready means the page and the login path answer; a 503 of /auth/me after a start
// is "not ready", not "fine because /duell answers".
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../bin/deploy-check.mjs', import.meta.url));
/** A stand-in for the wrapper: /duell and /api/status at once, /auth/me 503 for `authAfterMs`, then { authenticated: false }. */
async function fake(t, authAfterMs, { authBody = { authenticated: false } } = {}) {
  const t0 = Date.now(), seen = [];
  const srv = http.createServer((req, res) => {
    seen.push([req.url, req.headers.cookie || '']);
    if (req.url === '/duell' || req.url === '/api/status') return res.writeHead(200).end('ok');
    if (req.url === '/auth/me') {
      if (Date.now() - t0 < authAfterMs) return res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"auth-unavailable"}');
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(authBody));
    }
    res.writeHead(404).end();
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  t.after(() => { srv.close(); srv.closeAllConnections(); });
  return { base: `http://127.0.0.1:${srv.address().port}`, seen };
}
const run = (...args) => new Promise((ok) => execFile(process.execPath, [SCRIPT, ...args], (err, stdout) => ok({ code: err ? err.code : 0, out: stdout })));

test('deploy-check: waits until the login path answers, reports when each check passed', async (t) => {
  const f = await fake(t, 800);
  const r = await run(f.base, '--deadline', '10');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS page \/duell after \d+ ms/); assert.match(r.out, /PASS status \/api\/status after \d+ ms/);
  const ms = Number(/PASS login path \/auth\/me after (\d+) ms/.exec(r.out)[1]);
  assert.ok(ms >= 700, `the 503 phase was not taken for ready (${ms} ms)`);
  assert.ok(f.seen.some(([u, c]) => u === '/auth/me' && /^ct_gate_session=deploy-check-/.test(c)), 'sends a made-up session cookie, never a real one');
});

test('deploy-check: a login path that stays 503 (or answers as logged in) fails the deploy', async (t) => {
  const down = await fake(t, 60000);
  const r = await run(down.base, '--deadline', '1');
  assert.equal(r.code, 1); assert.match(r.out, /FAIL login path \/auth\/me: HTTP 503/); assert.match(r.out, /PASS page \/duell/);
  const odd = await fake(t, 0, { authBody: { authenticated: true } });
  assert.equal((await run(odd.base, '--deadline', '1')).code, 1, 'a made-up cookie must never count as logged in');
  assert.equal((await run(down.base, '--deadline', '1', '--no-auth')).code, 0, '--no-auth: page and status only');
  assert.equal((await run('not-a-url')).code, 2);
});
