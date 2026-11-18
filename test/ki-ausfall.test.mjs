// lib/ki-ausfall.mjs and its users: when the model does not answer (limit, credit, rate limit, overload, outage, key), every
// KI endpoint says so (503 ki-nicht-verfuegbar with the class), charges nothing, strikes nobody, counts nothing toward a
// day, and the operator hears of it (mail, at most one per class and hour; WARN log without OPS_ALERT_MAIL; /api/status).
// Anlass: 17.11.2026 19:49 UTC, HTTP 400 "You have reached your specified API usage limits", unnoticed.
// No real API call: fetch, SMTP and the host script's API are doubles on 127.0.0.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KLASSEN, KI_FEHLER, klasseVon, kiFehler, httpFehler, netzFehler, createKiWaechter, smtpAusEnv } from '../lib/ki-ausfall.mjs';
import { sendMail, nachricht } from '../lib/smtp-mail.mjs';
import { createLlm } from '../lib/duell-llm.mjs';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { MOD_SYSTEM } from '../lib/duell-karte.mjs';
import { createBild, stubPng } from '../lib/duell-bild.mjs';
import { createCredit } from '../lib/duell-credit.mjs';

const quiet = () => {};
const SKRIPT = fileURLToPath(new URL('../bin/ki-pruefung.sh', import.meta.url));
const DEPLOY = fileURLToPath(new URL('../bin/deploy-check.mjs', import.meta.url));
const LIMIT_TEXT = 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.';
const err = (type, message) => JSON.stringify({ type: 'error', error: { type, message } });

// One table for the server (klasseVon) and the host script (bin/ki-pruefung.sh): the two must never disagree.
// script: what the host script says where the server has no class ('' -> the script mails it as ki-anfrage).
const FAELLE = [
  { name: 'Anlass 17.11.: 400 usage limits', status: 400, body: err('invalid_request_error', LIMIT_TEXT), klasse: 'ki-limit' },
  { name: '400 credit balance', status: 400, body: err('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), klasse: 'ki-limit' },
  { name: '402', status: 402, body: err('billing_error', 'Payment required'), klasse: 'ki-limit' },
  { name: '400 billing_error', status: 400, body: err('billing_error', 'Billing problem'), klasse: 'ki-limit' },
  { name: '429 quota via proxy', status: 429, body: JSON.stringify({ error: { message: 'You exceeded your current quota', type: 'insufficient_quota' } }), klasse: 'ki-limit' },
  { name: '429 rate limit', status: 429, body: err('rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit'), klasse: 'ki-ueberlastet' },
  { name: '529 overloaded', status: 529, body: err('overloaded_error', 'Overloaded'), klasse: 'ki-ueberlastet' },
  { name: '500 api_error', status: 500, body: err('api_error', 'Internal server error'), klasse: 'ki-ausfall' },
  { name: '503 ohne JSON', status: 503, body: '<html>bad gateway</html>', klasse: 'ki-ausfall' },
  { name: '401', status: 401, body: err('authentication_error', 'invalid x-api-key'), klasse: 'ki-key' },
  { name: '403', status: 403, body: err('permission_error', 'Your API key does not have permission'), klasse: 'ki-key' },
  { name: '400 falsche Anfrage (unser Fehler)', status: 400, body: err('invalid_request_error', 'max_tokens: Field required'), klasse: '', script: 'ki-anfrage' },
  { name: '404 Modell weg', status: 404, body: err('not_found_error', 'model: claude-haiku-5-5'), klasse: '', script: 'ki-anfrage' },
];
const antwort = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) });

test('klasseVon: every case of the table; layer refusals and program errors are no KI fault; network and timeout are ki-ausfall', async () => {
  for (const f of FAELLE) assert.equal(klasseVon(await httpFehler(antwort(f.status, f.body))), f.klasse, f.name);
  assert.equal(klasseVon(netzFehler(new TypeError('fetch failed'))), 'ki-ausfall');
  assert.equal(klasseVon(netzFehler(Object.assign(new Error('aborted'), { name: 'AbortError' }))), 'ki-ausfall');
  for (const code of ['busy', 'budget', 'budget-month', 'not-configured', 'bad-image']) assert.equal(klasseVon(Object.assign(new Error(code), { code })), '', code);
  assert.equal(klasseVon(new TypeError('x is undefined')), '', 'a bug in our code is no outage of the KI');
  const e = kiFehler('ki-limit', await httpFehler(antwort(400, FAELLE[0].body)));
  assert.equal(e.code, KI_FEHLER); assert.equal(e.grund, 'ki-limit'); assert.equal(e.status, 400); assert.match(e.apiText, /regain access/);
  assert.deepEqual(KLASSEN, ['ki-limit', 'ki-ueberlastet', 'ki-ausfall', 'ki-key']);
});

// ---- the model layer -----------------------------------------------------------------------------------------------
function fakeWaechter() {
  const gemeldet = []; let oks = 0;
  return { gemeldet, oks: () => oks, melde: async (k, info) => { gemeldet.push({ k, info }); return { mail: 'test' }; }, ok: () => { oks++; } };
}

test('createLlm: each class is thrown as ki-nicht-verfuegbar with its grund, the watcher hears of it, nothing is retried or replaced', async () => {
  for (const f of FAELLE.filter((x) => x.klasse)) {
    let calls = 0;
    const ki = fakeWaechter();
    const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'sk-ant-TEST-123456' }, fetchImpl: async () => { calls++; return antwort(f.status, f.body); }, log: quiet, ki });
    await assert.rejects(llm.generate({ system: 'S', user: 'u' }), (e) => e.code === KI_FEHLER && e.grund === f.klasse, f.name);
    assert.equal(calls, 1, f.name + ': one call, no retry, no other provider');
    assert.deepEqual(ki.gemeldet.map((g) => [g.k, g.info.status, g.info.provider]), [[f.klasse, f.status, 'anthropic']], f.name);
    assert.equal(llm.budget().usd, 0, f.name + ': an HTTP error is not billed');
    assert.equal(llm.stats().ki[f.klasse], 1);
  }
  // a request that is wrong on our side stays what it was (llm-http-400), no class, no operator mail
  const ki = fakeWaechter();
  const bad = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: async () => antwort(400, FAELLE[11].body), log: quiet, ki });
  await assert.rejects(bad.generate({ system: 'S', user: 'u' }), /llm-http-400/);
  assert.equal(ki.gemeldet.length, 0);
});

test('createLlm: our own deadline is a timeout, not a model outage (Delta-Review 5); a broken connection is ki-ausfall; count_tokens too; LiteLLM 429 too', async () => {
  const ki = fakeWaechter();
  const hang = (url, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))));
  const lines = [];
  const llm = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: hang, log: (o) => lines.push(o), ki });
  await assert.rejects(llm.generate({ system: 'S', user: 'u', timeoutMs: 20 }), (e) => e.code === 'timeout' && !e.grund);
  assert.ok(llm.budget().usd > 0, 'an answer we never read may be billed: booked');
  assert.equal(ki.gemeldet.length, 0, 'no operator warning when only our deadline was too short');
  assert.equal(llm.stats().timeouts, 1);
  assert.ok(lines.some((l) => l.event === 'duell-llm' && l.why === 'timeout'));
  const net = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: async () => { throw new TypeError('fetch failed'); }, log: quiet, ki });
  await assert.rejects(net.generate({ system: 'S', user: 'u' }), (e) => e.grund === 'ki-ausfall');
  await assert.rejects(net.countTokens({ system: 'S', user: 'u' }), (e) => e.grund === 'ki-ausfall');
  const lite = createLlm({ env: { DUELL_CARD_PROVIDER: 'litellm', DUELL_CARD_MODEL: 'anthropic/claude-haiku-5-5' }, llmEnv: { LITELLM_BASE_URL: 'http://l' }, fetchImpl: async () => antwort(429, FAELLE[5].body), log: quiet, ki });
  await assert.rejects(lite.generate({ system: 'S', user: 'u' }), (e) => e.grund === 'ki-ueberlastet');
  assert.deepEqual(ki.gemeldet.map((g) => g.k), ['ki-ausfall', 'ki-ausfall', 'ki-ueberlastet']);
  // an answer that came: the watcher hears that too (status back to ok)
  const fine = createLlm({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: async () => antwort(200, JSON.stringify({ content: [{ type: 'text', text: '{"x":1}' }], stop_reason: 'end_turn', usage: {} })), log: quiet, ki });
  await fine.generate({ system: 'S', user: 'u' });
  assert.equal(ki.oks(), 1);
});

// ---- the watcher: throttle, mail, WARN without a recipient, status ------------------------------------------------------
const ENV_MAIL = (dir) => { const f = join(dir, 'smtp.pass'); writeFileSync(f, 'GEHEIM-pass-123\n'); return { OPS_ALERT_MAIL: 'ops@example.org', SMTP_PASS_FILE: f }; };

test('watcher: first fault of a class mails at once, the same class at most once an hour, another class at once; status only class and time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ki-w-')), clock = { t: Date.UTC(2026, 10, 17, 19, 49) }, mails = [], lines = [];
  const w = createKiWaechter({ env: ENV_MAIL(dir), now: () => clock.t, log: (o) => lines.push(o), send: async (cfg, m) => { mails.push({ cfg, m }); } });
  assert.deepEqual(w.status(), { ok: true, klasse: null, at: null });
  assert.equal((await w.melde('ki-limit', { provider: 'anthropic', model: 'claude-haiku-5-5', status: 400, apiTyp: 'invalid_request_error', apiText: LIMIT_TEXT + ' sk-ant-api03-ABCDEFGHIJKLMNOP' })).mail, 'gesendet');
  assert.deepEqual(w.status(), { ok: false, klasse: 'ki-limit', at: '2026-11-17T19:49:00.000Z' });
  for (const min of [1, 30, 59]) { clock.t += (min === 1 ? 1 : min === 30 ? 29 : 29) * 60000; assert.equal((await w.melde('ki-limit', { status: 400 })).mail, 'gedrosselt', 'minute ' + min); }
  assert.equal((await w.melde('ki-ausfall', { status: 500 })).mail, 'gesendet', 'another class is not throttled by the first');
  clock.t = Date.UTC(2026, 10, 17, 20, 49);
  assert.equal((await w.melde('ki-limit', { status: 400 })).mail, 'gesendet', 'after an hour the class mails again');
  assert.equal(mails.length, 3);
  const [first] = mails;
  assert.deepEqual(first.cfg.to, ['ops@example.org']);
  assert.equal(first.cfg.host, 'smtp.strato.de'); assert.equal(first.cfg.port, 465); assert.equal(first.cfg.from, 'no-reply@bunsenbrenner.org');
  assert.match(first.m.subject, /KI nicht verfügbar: ki-limit/);
  assert.match(first.m.text, /regain access on 2026-12-01/);
  assert.ok(!first.m.text.includes('sk-ant-api03'), 'nothing that looks like a key in the mail');
  const log = JSON.stringify(lines);
  assert.ok(!log.includes('GEHEIM') && !log.includes('regain access'), 'neither the password nor the API text in the log');
  assert.ok(lines.some((l) => l.event === 'ki-ausfall' && l.mail === 'gedrosselt' && l.level === 'WARN'), 'a throttled fault is still logged');
  w.ok();
  assert.deepEqual(w.status(), { ok: true, klasse: 'ki-limit', at: '2026-11-17T20:49:00.000Z' });
  assert.deepEqual(Object.keys(w.status()).sort(), ['at', 'klasse', 'ok']);
});

test('watcher: without OPS_ALERT_MAIL a WARN at start and at every fault, never silent; a failed mail tries again after 10 minutes', async () => {
  const lines = [], sent = [];
  const w = createKiWaechter({ env: {}, log: (o) => lines.push(o), send: async () => { sent.push(1); } });
  assert.equal(w.mailAn, false);
  assert.ok(lines.some((l) => l.level === 'WARN' && l.event === 'ki-alarm-config' && /OPS_ALERT_MAIL/.test(l.note)));
  for (let i = 0; i < 3; i++) assert.equal((await w.melde('ki-key', { status: 401 })).mail, 'aus');
  assert.equal(lines.filter((l) => l.level === 'WARN' && l.event === 'ki-ausfall' && /OPS_ALERT_MAIL/.test(l.note)).length, 3, 'one WARN per fault');
  assert.equal(sent.length, 0);
  for (const [env, fehlt] of [[{ OPS_ALERT_MAIL: 'ops@example.org' }, 'SMTP_PASS_FILE'], [{ OPS_ALERT_MAIL: 'kein mail' }, 'keine gueltige'], [{ OPS_ALERT_MAIL: 'a@b.de', SMTP_PASS_FILE: '/nicht/da' }, 'nicht lesbar']]) assert.match(smtpAusEnv(env).fehlt, new RegExp(fehlt));
  const dir = mkdtempSync(join(tmpdir(), 'ki-w-')), clock = { t: 0 }, log2 = [];
  let fail = true;
  const w2 = createKiWaechter({ env: ENV_MAIL(dir), now: () => clock.t, log: (o) => log2.push(o), send: async () => { if (fail) throw new Error('smtp: AUTH abgelehnt (535)'); } });
  assert.equal((await w2.melde('ki-ausfall')).mail, 'fehler');
  assert.ok(log2.some((l) => l.level === 'WARN' && l.event === 'ki-alarm-mail' && l.ok === false));
  clock.t = 9 * 60000; assert.equal((await w2.melde('ki-ausfall')).mail, 'gedrosselt');
  clock.t = 10 * 60000; fail = false; assert.equal((await w2.melde('ki-ausfall')).mail, 'gesendet');
  assert.ok(!JSON.stringify(log2).includes('GEHEIM'));
});

// ---- SMTP: a fake server on 127.0.0.1 (plain TCP; production uses TLS from the first byte) --------------------------------
function fakeSmtp({ authOk = true } = {}) {
  const mails = [];
  const srv = net.createServer((s) => {
    s.setEncoding('utf8');
    let buf = '', inData = false, wantAuth = false, cur = { auth: '', from: '', to: [], data: '' };
    s.write('220 fake ESMTP\r\n');
    s.on('data', (d) => {
      buf += d;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          cur.data = buf.slice(0, end); buf = buf.slice(end + 5); inData = false; mails.push(cur); cur = { auth: cur.auth, from: '', to: [], data: '' };
          s.write('250 queued\r\n'); continue;
        }
        const i = buf.indexOf('\r\n'); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const auth = (b) => { cur.auth = Buffer.from(b, 'base64').toString('utf8'); s.write(authOk ? '235 ok\r\n' : '535 no\r\n'); };
        if (wantAuth) { wantAuth = false; auth(line); }
        else if (/^(EHLO|HELO)/i.test(line)) s.write('250-fake\r\n250-AUTH PLAIN\r\n250 OK\r\n');
        else if (/^AUTH PLAIN$/i.test(line)) { wantAuth = true; s.write('334 \r\n'); }
        else if (/^AUTH PLAIN /i.test(line)) auth(line.slice(11));
        else if (/^MAIL FROM:/i.test(line)) { cur.from = /<([^>]*)>/.exec(line)[1]; s.write('250 ok\r\n'); }
        else if (/^RCPT TO:/i.test(line)) { cur.to.push(/<([^>]*)>/.exec(line)[1]); s.write('250 ok\r\n'); }
        else if (/^DATA$/i.test(line)) { inData = true; s.write('354 go\r\n'); }
        else if (/^QUIT$/i.test(line)) { s.write('221 bye\r\n'); s.end(); }
        else s.write('250 ok\r\n');
      }
    });
    s.on('error', () => {});
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ mails, port: srv.address().port, close: () => new Promise((r) => srv.close(r)) })));
}
const plain = (o, cb) => net.connect({ host: o.host, port: o.port }, cb);

test('smtp: EHLO, AUTH PLAIN, MAIL FROM, RCPT TO for each recipient, DATA as UTF-8; a refused AUTH never shows the password', async () => {
  const f = await fakeSmtp();
  try {
    const cfg = { host: '127.0.0.1', port: f.port, user: 'no-reply@bunsenbrenner.org', pass: 'GEHEIM-pass-123', from: 'no-reply@bunsenbrenner.org', to: ['ops@example.org', 'zwei@example.org'] };
    await sendMail(cfg, { subject: 'KI nicht verfügbar: ki-limit', text: 'Zeile 1\n.Punkt am Anfang\nÄrger' }, { connect: plain });
    assert.equal(f.mails.length, 1);
    const m = f.mails[0];
    assert.equal(m.auth, '\0no-reply@bunsenbrenner.org\0GEHEIM-pass-123');
    assert.equal(m.from, 'no-reply@bunsenbrenner.org'); assert.deepEqual(m.to, ['ops@example.org', 'zwei@example.org']);
    assert.match(m.data, /^Subject: =\?UTF-8\?B\?/m);
    const body = Buffer.from(m.data.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.equal(body, 'Zeile 1\n.Punkt am Anfang\nÄrger');
  } finally { await f.close(); }
  const no = await fakeSmtp({ authOk: false });
  try {
    await assert.rejects(sendMail({ host: '127.0.0.1', port: no.port, user: 'u@x.de', pass: 'GEHEIM-pass-123', from: 'u@x.de', to: ['o@x.de'] }, { subject: 's', text: 't' }, { connect: plain }),
      (e) => /AUTH abgelehnt \(535\)/.test(e.message) && !e.message.includes('GEHEIM') && !e.message.includes(Buffer.from('GEHEIM').toString('base64').slice(0, 6)));
  } finally { await no.close(); }
  assert.match(nachricht({ from: 'a@b.de', to: ['c@d.de'], subject: 'x', text: 'y' }), /^Content-Transfer-Encoding: base64$/m);
});

// ---- the endpoint: POST /api/duell/ai kind karte through the real model layer ---------------------------------------------
const DEV = 'c'.repeat(32);
const MOD_OK = { risk: 0, cats: [] };
const CARD = { ok: true, title: 'Sonnenblumen-Tag', x: 'Alles Gute! Du bringst Sonne in jeden Tag.', st: 'herz', palette: 0, stickers: ['🌻', '🎂', '✨'] };
/** fetch double of the Anthropic API: `fault` = [status, body] answers every call, null answers like the model */
function api() {
  const s = { fault: null, calls: 0 };
  s.fetch = async (url, init) => {
    s.calls++;
    if (s.fault) return antwort(s.fault[0], s.fault[1]);
    const b = JSON.parse(init.body), mod = b.system[0].text === MOD_SYSTEM[0].text;
    return antwort(200, JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(mod ? MOD_OK : CARD) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }));
  };
  return s;
}
// createDuellAi makes its own model layer (createLlm with the global fetch, read when it is made): the double is put in place
// for exactly that moment, so this runs the real wiring server.mjs uses (ki passed through to createLlm)
function mkAi({ env = {}, dailyMax = '200' } = {}) {
  const a = api(), mails = [], lines = [], real = globalThis.fetch;
  const ki = createKiWaechter({ env: { OPS_ALERT_MAIL: 'ops@example.org', SMTP_PASS_FILE: '/x' }, lesen: () => 'GEHEIM', log: (o) => lines.push(o), send: async (cfg, m) => { mails.push(m); } });
  const d = createDuell({ env: { DUELL_DAILY_MAX: dailyMax, DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: quiet, llm: async () => '{}' });
  d.shared.age16 = () => true; d.shared.age18 = () => false;
  globalThis.fetch = a.fetch;
  let ai;
  try { ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0', ANTHROPIC_API_KEY: 'sk-ant-TEST-123456', ...env }, llm: async () => '{}', shared: d.shared, auth: { mode: 'gate', identify: async () => ({ email: 'lea@example.org' }) }, ki, log: quiet }); }
  finally { globalThis.fetch = real; }
  return { a, ai, ki, mails, lines };
}
const body = (text) => ({ kind: 'karte', input: { text, art: 'card', age: 'u18' }, device: DEV, lang: 'de' });
const run = async (ai, b) => ai.act(b, await ai.who({}, b), null);

test('karte: each class answers 503 ki-nicht-verfuegbar with its grund; no charge, no strike, no daily cap, no day of the line; one mail per class', async () => {
  for (const f of FAELLE.filter((x) => x.klasse)) {
    // DUELL_CREATE_CALLS_PER_DAY 6: two requests' worth; DUELL_DAILY_MAX 3 for the line; DUELL_CREATE_BLOCKS_PER_DAY 3 strikes
    const { a, ai, ki, mails } = mkAi({ env: { DUELL_CREATE_CALLS_PER_DAY: '6', DUELL_CREATE_BLOCKS_PER_DAY: '3' }, dailyMax: '3' });
    a.fault = [f.status, f.body];
    for (let i = 0; i < 8; i++) {
      const r = await run(ai, body('Geburtstagskarte mit Sonnenblumen ' + i));
      assert.equal(r.status, 503, f.name + ' ' + JSON.stringify(r.body));
      assert.equal(r.body.error, 'ki-nicht-verfuegbar'); assert.equal(r.body.grund, f.klasse);
      assert.equal(r.body.create.remaining, 5, f.name + ': nothing charged');
      assert.ok(!('options' in r.body), 'no card from anywhere else');
    }
    assert.equal(a.calls, 8, f.name + ': one call per request (S2 failed), nothing retried');
    assert.equal(mails.length, 1, f.name + ': one operator mail for 8 faults');
    assert.equal(ki.status().ok, false); assert.equal(ki.status().klasse, f.klasse);
    // the model answers again: the next request makes a card, so no strike, no daily cap and no day of the line were used
    a.fault = null;
    const ok = await run(ai, body('Geburtstagskarte mit Sonnenblumen'));
    assert.equal(ok.status, 200, f.name + ' ' + JSON.stringify(ok.body));
    assert.equal(ok.body.create.remaining, 4);
    assert.equal(ki.status().ok, true);
  }
});

// ---- the picture (lib/duell-bild.mjs): sentence check and picture check --------------------------------------------------
test('bild: KI fault in the sentence check is 503 ki-nicht-verfuegbar before any charge; in the picture check the job fails as such, refunded, not counted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ki-bild-'));
  const step = { mod: null, pic: null };
  const llm = { async generate(req) { const x = req.name === 'bild_check' ? step.pic : step.mod; if (x) throw kiFehler(x); return req.name === 'bild_check' ? { json: { ok: true, cats: [] }, usage: {} } : { json: { risk: 0, cats: [], drink: 'none' }, usage: {} }; } };
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: quiet, llm: async () => '{}' });
  const credit = createCredit({ env: {}, log: quiet, file: join(dir, 'credit.json') });
  Object.assign(d.shared, { credit, mod: { canCreate: () => ({ ok: true }), strike: () => { throw new Error('no strike for a KI fault'); } }, age16: () => true });
  const backend = { kind: 'stub', async generate(q) { return { buf: stubPng(8, 8, q.seed), mime: 'image/png', ms: 5, flagged: false }; } };
  const b = createBild({ env: { DUELL_BILD_DIR: join(dir, 'bild'), DUELL_BILD_EST_CARD_MS: '50', DUELL_BILD_CHECK_MS: '400', DUELL_BILD_PROMPT_MS: '200' }, shared: d.shared, who: async () => ({}), llm, backend, log: quiet });
  t_after(b);
  const p = { account: true, acct: 'a' + 'b'.repeat(24), mail: 'lea@example.org' };
  const P = { use: 'card', text: 'ein Drache, der auf dem Mond Pfannkuchen backt', style: 'comic', lang: 'de' };
  const before = b.status(p).body;
  step.mod = 'ki-limit';
  const r = await b.ask(p, P);
  assert.equal(r.status, 503); assert.deepEqual(r.body, { error: 'ki-nicht-verfuegbar', grund: 'ki-limit' });
  assert.deepEqual(b.status(p).body.free, before.free); assert.deepEqual(b.status(p).body.perDay, before.perDay);
  step.mod = null; step.pic = 'ki-ueberlastet';
  const q = await b.ask(p, P);
  assert.equal(q.status, 202);
  let v;
  for (let i = 0; i < 200; i++) { v = b.poll(p, { job: q.body.job }).body; if (v.state === 'failed' || v.state === 'done') break; await new Promise((ok) => setTimeout(ok, 10)); }
  assert.deepEqual(v, { state: 'failed', error: 'ki-nicht-verfuegbar', grund: 'ki-ueberlastet', refunded: true });
  assert.deepEqual(b.status(p).body.free, before.free, 'the free picture is back'); assert.deepEqual(b.status(p).body.perDay, before.perDay, 'the day is not used');
});
function t_after(b) { if (b && b.stop) setTimeout(() => b.stop(), 0).unref(); }

// ---- the host script (bin/ki-pruefung.sh): same classes, key never shown, mail throttled ------------------------------
function fakeApi() {
  const s = { status: 200, body: '{}', seen: [] };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { s.seen.push({ url: req.url, key: req.headers['x-api-key'], version: req.headers['anthropic-version'], body: JSON.parse(b || '{}') }); res.writeHead(s.status, { 'content-type': 'application/json' }).end(s.body); });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(Object.assign(s, { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) }))));
}
const sh = (env) => new Promise((ok) => execFile('sh', [SKRIPT], { env: { PATH: process.env.PATH, HOME: env.HOME, ...env } }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, out: stdout, err: stderr })));

test('host script: the same classes as the server for every case, 1 token of Haiku, the key only in the header; mail once per class and hour', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ki-host-')), keyFile = join(home, 'anthropic.key'), pass = join(home, 'smtp.pass');
  writeFileSync(keyFile, 'sk-ant-HOSTTEST-0123456789\n'); writeFileSync(pass, 'GEHEIM"pass\\123\n');
  const a = await fakeApi(), s = await fakeSmtp();
  try {
    const base = { HOME: home, KI_KEY_FILE: keyFile, KI_API: a.base, KI_PRUEFUNG_STAND: join(home, 'stand') };
    const mail = { ...base, OPS_ALERT_MAIL: 'ops@example.org', SMTP_PASS_FILE: pass, SMTP_URL: `smtp://127.0.0.1:${s.port}` };
    a.status = 200; a.body = JSON.stringify({ content: [{ type: 'text', text: 'o' }] });
    const ok = await sh(mail);
    assert.equal(ok.code, 0, ok.out + ok.err); assert.match(ok.out, /OK ki antwortet/);
    assert.equal(a.seen[0].url, '/v1/messages'); assert.equal(a.seen[0].key, 'sk-ant-HOSTTEST-0123456789');
    assert.equal(a.seen[0].body.max_tokens, 1); assert.equal(a.seen[0].body.model, 'claude-haiku-5-5'); assert.ok(a.seen[0].version);
    for (const f of FAELLE) {
      a.status = f.status; a.body = f.body;
      const r = await sh(base);   // without OPS_ALERT_MAIL: only the class and a WARN
      const k = f.klasse || f.script;
      assert.equal(r.code, 1, f.name);
      assert.match(r.err, new RegExp(`FEHLER ${k} HTTP ${f.status}.*WARN: OPS_ALERT_MAIL fehlt`), f.name + ': ' + r.err);
      assert.ok(!(r.out + r.err).includes('HOSTTEST'), 'the key is never shown');
    }
    // mail: the first ki-limit mails, the second within the hour does not, a ki-ausfall mails at once
    a.status = 400; a.body = FAELLE[0].body;
    const m1 = await sh(mail); assert.match(m1.out, /FEHLER ki-limit HTTP 400 invalid_request_error; Mail an den Betreiber gesendet/, m1.out + m1.err);
    const m2 = await sh(mail); assert.match(m2.out, /Mail gedrosselt/);
    a.status = 529; a.body = FAELLE[6].body;
    const m3 = await sh(mail); assert.match(m3.out, /ki-ueberlastet .*gesendet/);
    assert.equal(s.mails.length, 2);
    assert.equal(s.mails[0].auth, '\0no-reply@bunsenbrenner.org\0GEHEIM"pass\\123', 'password with quote and backslash arrives as it is');
    assert.deepEqual(s.mails[0].to, ['ops@example.org']);
    assert.match(s.mails[0].data, /Subject: \[My Daily Idea\] KI nicht verfuegbar: ki-limit/);
    assert.match(s.mails[0].data, /regain access on 2026-12-01/);
    assert.ok(!s.mails.some((m) => m.data.includes('HOSTTEST')));
    for (const r of [m1, m2, m3]) assert.ok(!(r.out + r.err).includes('GEHEIM'), 'the SMTP password is never shown');
    // no network at all: ki-ausfall
    const down = await sh({ ...base, KI_API: 'http://127.0.0.1:9' });
    assert.match(down.err, /FEHLER ki-ausfall HTTP 000/);
    // switched off: no call; smtp:// to another host is refused (the password never goes unencrypted)
    const n = a.seen.length;
    writeFileSync(join(home, 'aus'), '');
    const off = await sh({ ...mail, KI_PRUEFUNG_AUS: join(home, 'aus') });
    assert.equal(off.code, 0); assert.match(off.out, /abgeschaltet/); assert.equal(a.seen.length, n);
    const clear = await sh({ ...mail, KI_PRUEFUNG_STAND: join(home, 'stand2'), SMTP_URL: 'smtp://smtp.strato.de:25' });
    assert.match(clear.err, /SMTP_URL muss smtps:\/\/ sein/);
    const nokey = await sh({ ...base, KI_KEY_FILE: join(home, 'fehlt.key') });
    assert.equal(nokey.code, 2);
    assert.ok(existsSync(join(home, 'stand', 'ki-limit')) && /^\d+\n$/.test(readFileSync(join(home, 'stand', 'ki-limit'), 'utf8')));
  } finally { await a.close(); await s.close(); }
});

// ---- deploy-check shows the state of /api/status ----------------------------------------------------------------------
test('deploy-check: WARN ki <class> while the model does not answer, OK ki otherwise; the exit code stays that of the checks', async (t) => {
  const state = { ki: { ok: false, klasse: 'ki-limit', at: '2026-11-17T19:49:00.000Z' } };
  const srv = http.createServer((req, res) => {
    if (req.url === '/duell') return res.writeHead(200).end('ok');
    if (req.url === '/api/status') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, svc: {}, ki: state.ki }));
    res.writeHead(404).end();
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const run = () => new Promise((ok) => execFile(process.execPath, [DEPLOY, base, '--deadline', '5', '--no-auth'], (e, stdout) => ok({ code: e ? e.code : 0, out: stdout })));
  const w = await run();
  assert.equal(w.code, 0); assert.match(w.out, /WARN ki ki-limit since 2026-11-17T19:49:00.000Z/);
  state.ki = { ok: true, klasse: 'ki-limit', at: '2026-11-17T19:49:00.000Z' };
  assert.match((await run()).out, /OK ki \(last fault ki-limit at /);
});
