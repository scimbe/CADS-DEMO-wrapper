// My Daily Idea ads and Pro: switches off by default, context-only ads, signed webhook, § 312k cancel page, AdSense CSP.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createDuellPro, loadAds, verifyStripe, adsensePage } from '../lib/duell-pro.mjs';

const NOW = Date.UTC(2026, 10, 3, 12), WHSEC = 'whsec_test', SK = 'sk_test_x';
const SELL = { DUELL_PRO_ENABLED: '1', DUELL_PRO_PAYMENT_LINK: 'https://buy.stripe.com/test_abc123', DUELL_STRIPE_WEBHOOK_SECRET: WHSEC, DUELL_STRIPE_SECRET_KEY: SK, DUELL_AI_SALT: 'salt' };
const gate = (email) => ({ mode: 'gate', identify: async () => (email ? { email } : {}) });
const sign = (raw, t = Math.floor(NOW / 1000)) => `t=${t},v1=${createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex')}`;
const paid = (pro, email, sub = 'sub_ABC123') => pro._event({ type: 'checkout.session.completed', data: { object: { client_reference_id: pro.mac(email), subscription: sub } } });
function adsDir() {
  const d = mkdtempSync(join(tmpdir(), 'duell-ads-'));
  writeFileSync(join(d, 'eis.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(join(d, 'ads.json'), JSON.stringify([
    { id: 'eis', by: 'Eisdiele Nord', kinds: ['card'], de: { t: 'Kugel gratis', s: 'mit Karte' }, en: { t: 'Free scoop' }, img: 'eis.png', url: 'https://example.org/eis' },
    { id: 'buch', by: 'Buchladen', kinds: ['game'], de: { t: 'Neue Comics' }, url: 'javascript:alert(1)' },
    { id: 'BAD ID', by: 'x', de: { t: 'y' } }, { id: 'leer', by: '', de: { t: 'y' } }, { id: 'pfad', by: 'P', de: { t: 'Q' }, img: '../../etc/passwd.png' },
  ]));
  return join(d, 'ads.json');
}
async function serve(handler, fn) {
  const s = http.createServer(async (req, res) => { if (!(await handler.route(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end(); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

test('Schalter: ohne Env ist alles aus; keine Anzeige, kein Verkauf, Seite unveraendert, Kaufweg 404', async () => {
  const pro = createDuellPro({ env: {}, log: () => {} });
  assert.deepEqual(pro.ad({ kind: 'card' }, false), { ad: null });
  assert.equal(pro.shop(30), undefined); assert.equal(pro.selling, false); assert.equal(pro.has('a@b.de'), false);
  assert.equal(pro.page('<html>x</html>'), '<html>x</html>');
  await serve(pro, async (u) => {
    assert.equal((await fetch(u + '/api/duell/pro/buy?adult=1', { redirect: 'manual' })).status, 404);
    assert.match(await (await fetch(u + '/duell/kuendigen')).text(), /Es gibt gerade kein Pro-Abo zu kaufen/);
    assert.equal((await fetch(u + '/api/duell/pro/stripe', { method: 'POST', body: '{}' })).status, 400);
  });
  assert.equal(createDuellPro({ env: { DUELL_PRO_ENABLED: '1' }, log: () => {} }).selling, false, 'ohne Zahlungslink und Schluessel wird nichts verkauft');
});

test('Anzeigen: nur gepruefte Eintraege, Bild als data:-URL, kein Pfad nach draussen, nur https-Links', () => {
  const ads = loadAds(adsDir());
  assert.deepEqual(ads.map((a) => a.id), ['eis', 'buch', 'pfad']);
  assert.match(ads[0].img, /^data:image\/png;base64,/); assert.equal(ads[0].en.t, 'Free scoop');
  assert.equal(ads[1].url, ''); assert.equal(ads[1].en.t, 'Neue Comics', 'ohne Englisch der deutsche Text');
  assert.equal(ads[2].img, '');
});

test('Anzeigen: nach Tag und Art, gleich fuer alle; Pro sieht keine', () => {
  const pro = createDuellPro({ env: { DUELL_ADS_ENABLED: '1', DUELL_ADS_FILE: adsDir() }, now: () => NOW, log: () => {} });
  const a = pro.ad({ kind: 'card', lang: 'en' }, false).ad;
  assert.deepEqual(Object.keys(a), ['id', 'by', 't', 's', 'img', 'url']); assert.equal(a.id, 'eis'); assert.equal(a.t, 'Free scoop');
  assert.equal(pro.ad({ kind: 'game' }, false).ad.id, 'buch');
  assert.deepEqual(pro.ad({ kind: 'card' }, true), { ad: null });
});

test('Route /ad: keine Geraete-Kennung noetig, Konto mit Pro bekommt keine Anzeige und meter.abo', async () => {
  const file = adsDir();
  const mk = (email) => {
    const pro = createDuellPro({ env: { DUELL_ADS_ENABLED: '1', DUELL_ADS_FILE: file, ...SELL }, now: () => NOW, log: () => {} });
    const d = createDuell({ env: { DUELL_CORS_ORIGINS: '' }, salt: 's', log: () => {}, llm: async () => '{}' });
    const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', shared: d.shared, auth: gate(email), pro, log: () => {} });
    return { pro, ai };
  };
  const call = (ai) => serve(ai, async (u) => { const r = await fetch(u + '/api/duell/ai/ad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: 'de', kind: 'card' }) }); return { status: r.status, json: await r.json() }; });
  const anon = await call(mk(null).ai);
  assert.equal(anon.status, 200); assert.equal(anon.json.ad.id, 'eis'); assert.equal(anon.json.meter, undefined);
  const paying = mk('kim@example.org'); paid(paying.pro, 'kim@example.org');
  const pr = await call(paying.ai);
  assert.equal(pr.json.ad, null); assert.equal(pr.json.meter.abo, true);
  const m = paying.ai.meter(await paying.ai.who({}, null));
  assert.equal(m.pro, true); assert.equal(m.abo, true); assert.deepEqual(m.shop, { buy: true, price: '2,99 €', perDay: 30 });
});

test('Kauf: nur mit Volljaehrigkeit und Konto; Weiterleitung traegt nur den Hash, nie die Adresse', async () => {
  const pro = createDuellPro({ env: SELL, auth: gate('Kim@Example.org'), log: () => {} });
  await serve(pro, async (u) => {
    assert.equal((await fetch(u + '/api/duell/pro/buy', { redirect: 'manual' })).status, 400);
    const r = await fetch(u + '/api/duell/pro/buy?adult=1', { redirect: 'manual' }), to = new URL(r.headers.get('location'));
    assert.equal(r.status, 302); assert.equal(to.origin + to.pathname, 'https://buy.stripe.com/test_abc123');
    assert.equal(to.searchParams.get('client_reference_id'), pro.mac('kim@example.org'));
    assert.ok(!/kim|example/i.test(to.href), 'keine Adresse in der URL');
  });
  await serve(createDuellPro({ env: SELL, auth: gate(null), log: () => {} }), async (u) => {
    const r = await fetch(u + '/api/duell/pro/buy?adult=1', { redirect: 'manual' });
    assert.equal(r.status, 302); assert.match(r.headers.get('location'), /^\/auth\/login\?return=/);
  });
});

test('Webhook: nur mit gueltiger, frischer Signatur; an, aus und Speicher ohne Klartext', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'duell-pro-')), 'pro.json');
  const pro = createDuellPro({ env: { ...SELL, DUELL_PRO_STATE_FILE: f }, now: () => NOW, log: () => {} });
  const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: pro.mac('kim@example.org'), subscription: 'sub_ABC123', customer_details: { email: 'eltern@example.org' } } } });
  await serve(pro, async (u) => {
    const post = (raw, sig) => fetch(u + '/api/duell/pro/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: raw });
    assert.equal((await post(ev, 't=1,v1=' + 'a'.repeat(64))).status, 400);
    assert.equal((await post(ev, sign(ev, Math.floor(NOW / 1000) - 3600))).status, 400, 'alte Signatur');
    assert.equal((await post(ev + ' ', sign(ev))).status, 400, 'veraenderter Text');
    assert.equal((await post(ev, sign(ev))).status, 200);
    assert.equal(pro.has('kim@example.org'), true); assert.equal(pro.has('eltern@example.org'), true);
    const raw = readFileSync(f, 'utf8'); assert.ok(!/@|kim|eltern/.test(raw)); assert.match(raw, /"s":"sub_ABC123","t":"2026-11-03"/);
    const end = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_ABC123' } } });
    assert.equal((await post(end, sign(end))).status, 200);
    assert.equal(pro.has('kim@example.org'), false); assert.equal(pro.has('eltern@example.org'), false);
  });
  assert.equal(createDuellPro({ env: { ...SELL, DUELL_PRO_STATE_FILE: f }, log: () => {} }).has('kim@example.org'), false, 'nach Neustart weiter aus');
  assert.equal(verifyStripe('x', sign('x'), '', Math.floor(NOW / 1000)), false, 'ohne Geheimnis nie gueltig');
});

test('Kuendigen (§ 312k BGB): ohne Login, Knopf "jetzt kündigen", Stripe zum Monatsende, gleiche Antwort fuer fremde Adressen', async () => {
  const calls = [];
  const pro = createDuellPro({ env: SELL, fetchFn: async (url, o) => { calls.push({ url, o }); return { ok: true, status: 200 }; }, now: () => NOW, log: () => {} });
  paid(pro, 'kim@example.org');
  await serve(pro, async (u) => {
    const page = await (await fetch(u + '/duell/kuendigen')).text();
    assert.match(page, /<h1>Verträge hier kündigen<\/h1>/); assert.match(page, /<button type="submit">jetzt kündigen<\/button>/);
    assert.ok(!/type="password"/.test(page), 'kein Passwort');
    const post = (email) => fetch(u + '/duell/kuendigen', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=' + encodeURIComponent(email) });
    const a = await post('KIM@example.org'), b = await post('fremd@example.org');
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(await a.text(), await b.text(), 'niemand kann pruefen, wer zahlt');
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.stripe.com/v1/subscriptions/sub_ABC123');
    assert.equal(calls[0].o.body, 'cancel_at_period_end=true'); assert.equal(calls[0].o.headers.Authorization, 'Bearer ' + SK);
    assert.equal((await post('kein-mail')).status, 400);
  });
  const down = createDuellPro({ env: SELL, fetchFn: async () => ({ ok: false, status: 500 }), log: () => {} });
  paid(down, 'kim@example.org');
  await serve(down, async (u) => {
    const r = await fetch(u + '/duell/kuendigen', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=kim%40example.org' });
    assert.equal(r.status, 503); assert.match(await r.text(), /nicht geklappt/);
  });
});

test('AdSense: nur mit Schalter und gueltiger Kennung; jedes Skript mit Nonce, Konfiguration zuerst, neue Nonce je Abruf', () => {
  const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><script>a()</script><script>b()</script>';
  const out = adsensePage(html, { client: 'ca-pub-1234567890123456', slot: '1234567890' }, 'N0nce');
  assert.match(out, /script-src 'nonce-N0nce' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https:;/); assert.match(out, /object-src 'none'; base-uri 'none'/);
  assert.equal((out.match(/<script nonce="N0nce">/g) || []).length, 3); assert.ok(!/<script>/.test(out));
  assert.ok(out.indexOf('window.DUELL_ADSENSE={"client":"ca-pub-1234567890123456","slot":"1234567890"}') < out.indexOf('a()'));
  assert.equal(createDuellPro({ env: { DUELL_ADSENSE_ENABLED: '1', DUELL_ADSENSE_CLIENT: 'pub-1', DUELL_ADSENSE_SLOT: '1' }, log: () => {} }).cfg.adsense, false);
  const on = createDuellPro({ env: { DUELL_ADSENSE_ENABLED: '1', DUELL_ADSENSE_CLIENT: 'ca-pub-1234567890123456', DUELL_ADSENSE_SLOT: '1234567890' }, log: () => {} });
  assert.notEqual(on.page(html).match(/nonce-([^']+)/)[1], on.page(html).match(/nonce-([^']+)/)[1]);
});
