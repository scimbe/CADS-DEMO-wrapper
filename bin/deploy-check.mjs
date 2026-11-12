#!/usr/bin/env node
// Deploy check of the wrapper (staging finding L4): ready means the page AND the login path answer, not only the page.
//
//   node bin/deploy-check.mjs <base url> [--deadline <s>] [--no-auth]
//   e.g. node bin/deploy-check.mjs http://127.0.0.1:8794 --deadline 30
//
// Checked until all pass or the deadline (default 30 s), every 250 ms:
//   * GET /duell                    200
//   * GET /api/status               200
//   * GET /auth/me with a made-up session cookie: 200 { authenticated: false }. This runs the whole login check of
//     lib/auth.mjs (DNS of the gate host, TLS, the gate's answer) without an account: a gate that is unreachable or a
//     DNS lookup that times out answers 503. --no-auth skips it (DEMO_AUTH_MODE=off, where /auth/me does not exist).
// Prints when each check passed first, ms after the start of the check; exit 0 when all passed, 1 otherwise.

const args = process.argv.slice(2);
const base = String(args.find((a) => !a.startsWith('--')) || '').replace(/\/+$/, '');
const di = args.indexOf('--deadline');
const deadlineMs = (di >= 0 ? Number(args[di + 1]) : 30) * 1000;
const auth = !args.includes('--no-auth');
if (!/^https?:\/\/[^/]+$/.test(base) || !Number.isFinite(deadlineMs) || deadlineMs <= 0) {
  console.error('usage: node bin/deploy-check.mjs <base url, e.g. http://127.0.0.1:8794> [--deadline <s>] [--no-auth]');
  process.exit(2);
}

const CHECKS = [
  { name: 'page /duell', path: '/duell', ok: (r) => r.status === 200 },
  { name: 'status /api/status', path: '/api/status', ok: (r) => r.status === 200 },
  ...(auth ? [{
    name: 'login path /auth/me', path: '/auth/me', headers: { cookie: 'ct_gate_session=deploy-check-not-a-session' },
    ok: async (r) => { if (r.status !== 200) return false; try { return (await r.json()).authenticated === false; } catch { return false; } },
  }] : []),
];

const t0 = Date.now();
const passed = new Map(), last = new Map();
while (passed.size < CHECKS.length && Date.now() - t0 < deadlineMs) {
  for (const c of CHECKS) {
    if (passed.has(c.name)) continue;
    try {
      const r = await fetch(base + c.path, { headers: c.headers || {}, redirect: 'manual', signal: AbortSignal.timeout(5000) });
      if (await c.ok(r)) passed.set(c.name, Date.now() - t0); else last.set(c.name, 'HTTP ' + r.status);
    } catch (e) { last.set(c.name, String(e && e.cause && e.cause.code || e && e.name || e)); }
  }
  if (passed.size < CHECKS.length) await new Promise((r) => setTimeout(r, 250));
}
for (const c of CHECKS) console.log(passed.has(c.name) ? `PASS ${c.name} after ${passed.get(c.name)} ms` : `FAIL ${c.name}: ${last.get(c.name) || 'no answer'} (deadline ${deadlineMs / 1000} s)`);
process.exit(passed.size === CHECKS.length ? 0 : 1);
