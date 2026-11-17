// Links of the new app (apps/mdi, #v2.<type>.<b64>): envelope check, short links (create, open, picture, free card gate),
// abuse (too long, foreign host, broken envelope, tampered storage) and the wall field of the profile with its migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeV2, encodeV2, V2_MAX } from '../lib/link-v2.mjs';
import { createShortLinks, freeChecksOf, freeIdsOf, fragmentOk } from '../lib/shortlink.mjs';
import { CARDS } from '../lib/vendor/mdi/index.js';
import { gateHash } from '../lib/duell-deck.mjs';
import { createDuell } from '../lib/duell.mjs';
import { createDuellProfile, cleanProfile, wallLinkFormat } from '../lib/duell-profile.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = (p) => mkdtempSync(join(tmpdir(), p));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const CARD = { c: 'zug-abfragen', v: '1.0.0', p: { titel: 'Hauptstädte', runden: 3 } };
const CHALLENGE = { c: 'flug', v: '1.2.0', p: { seed: 7 }, s: 'a'.repeat(32), k: [null, 'b'.repeat(64)], m: [{ t: 'tap', seat: 0, at: 12 }, { t: 'ans', seat: 1, a: ['Rom', 'Paris'], o: { ok: true } }], g: 'c'.repeat(16), h: 'd'.repeat(16) };
const FC = encodeV2('card', CARD), FG = encodeV2('challenge', CHALLENGE);

// Fixed vectors of the app (apps/mdi test/fixtures/wrapper-frei.json karte-ok-card/-meme, freiParams of the sanitised doc),
// with the gate hash this server stored for the same card (lib/duell-deck.mjs gateHash of the server doc).
const FREI_CARD = { kind: 'card', title: 'Sonnenblumen-Tag', text: 'Alles Gute! Du bringst Sonne in jeden Tag.', top: '', bottom: '', style: 'herz', palette: 'gelb', stickers: ['🌻', '🎂', '✨'], seal: 's2.karte.mwbw1pc0.XcjB3oJ9mEDMdWVoEi9Zi5to5iNRAUL1', hash: '6v-iwp49U8t5g-4w8DvGrXbw43BI8NPS_-X_dBRl5hc', owner: '4J2kZ7tMNA9cHUKBOyIiCH', root: '' };
const FREI_MEME = { kind: 'meme', title: 'Kein Leckerli', text: '', top: 'Wenn du sagst', bottom: 'Heute kein Leckerli', style: 'meme', palette: 'gelb', stickers: [], seal: 's2.karte.mwbw1pc0.EkjLrwkMU12Lwh8WxHRpkgPA7LjqJSX0', hash: 'MWy0AHydhtXc9gpBACJUZL6D6xq_XEdhM7XEFmqHpAQ', owner: '6mtrwxf4b2I1ppYJqGB0ay', root: '' };
const GH = { card: 'qWCCWKwM4uDjfi6dd2XxVOGSfnB1cCOmbQODRO2urHo', meme: 'ouLFoTqLQTmVig2Uf7PFW6ny9zdSYOkMiA2j9f82YBU' };
const frei = (p) => encodeV2('card', { c: 'frei', v: '1.0.0', p });

/** The deck as the short links see it (lib/duell-deck.mjs linkState): known ids with their gate hash, blocked ids. */
function fakeDeck() {
  const d = { cards: new Map(), blocked: new Set(), down: false, asked: [], shared: [] };
  d.linkState = (cid, dh) => {
    d.asked.push([cid, dh]);
    if (d.down) return 'unavailable';
    if (d.blocked.has(cid)) return 'blocked';
    if (!d.cards.has(cid)) return 'unknown';
    if (dh !== undefined && dh !== d.cards.get(cid)) return 'changed';
    return 'ok';
  };
  d.sharedAs = (cid, id) => d.shared.push([cid, id]);
  return d;
}
const mk = (env = {}, over = {}) => createShortLinks({ env: { SHORT_DATA_DIR: dir('short-v2-'), ...env }, log: () => {}, root, ...over });
function serve(s) {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => s.route(req, res, new URL(req.url, 'http://x')).then((mine) => { if (!mine) res.writeHead(599).end(); }));
    srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.close(); srv.closeAllConnections(); } }));
  });
}
const post = (base, body) => fetch(base + '/api/s', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const hrefOf = (html) => html.match(/<a id="go" href="([^"]*)"/)[1].replace(/&amp;/g, '&');

// ---- envelope ---------------------------------------------------------------------------------------------------------
test('v2 envelope: card and challenge as link.schema.json says, everything else refused with its reason', () => {
  assert.deepEqual(decodeV2(FC), { ok: true, type: 'card', data: CARD });
  assert.deepEqual(decodeV2(FG), { ok: true, type: 'challenge', data: CHALLENGE });
  const { h, ...noH } = CHALLENGE;
  assert.equal(decodeV2(encodeV2('challenge', noH)).ok, true, 'h is optional');
  const reason = (f) => decodeV2(f).reason;
  const raw = (type, o) => `v2.${type}.` + b64(typeof o === 'string' ? o : JSON.stringify(o));
  assert.equal(reason(''), 'leer'); assert.equal(reason(5), 'leer');
  assert.equal(reason('v2.card.' + 'A'.repeat(V2_MAX)), 'zu-lang');
  for (const f of [FC + '.x', '#' + FC, 'V2.card.' + FC.slice(8), 'v3.card.x', 'c=abc', 'v2card.x', ' ' + FC, 'https://evil.example/#' + FC]) assert.equal(reason(f), 'praefix', f.slice(0, 30));
  assert.equal(reason(raw('live', { t: 'A'.repeat(22) })), 'typ', 'a live invitation holds a one-time token: never stored');
  assert.equal(reason(raw('ghost', {})), 'typ');
  assert.equal(reason(raw('foo', CARD)), 'typ');
  for (const f of [FC + '=', FC.replace(/.$/, '+'), FC + '/', 'v2.card.', 'v2.card.A', FC + '\n', FC + '#x']) assert.equal(reason(f), 'base64', JSON.stringify(f.slice(-4)));
  // one link, one spelling: a valid link whose last character carries a stray bit decodes to the same bytes; the app takes it,
  // the server keeps only the canonical spelling
  let odd = FC; for (let i = 0; odd.length % 4 === 0 || (odd.length - 8) % 4 === 0; i++) odd = encodeV2('card', { ...CARD, p: { ...CARD.p, x: 'y'.repeat(i) } });
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const stray = odd.slice(0, -1) + ALPHA[ALPHA.indexOf(odd.at(-1)) + 1];
  assert.deepEqual(Buffer.from(stray.slice(8), 'base64url'), Buffer.from(odd.slice(8), 'base64url'), 'same bytes');
  assert.equal(decodeV2(odd).ok, true); assert.equal(reason(stray), 'base64');
  assert.equal(reason('v2.card.' + Buffer.from([0xff, 0xfe, 0x7b]).toString('base64url')), 'utf8');
  assert.equal(reason(raw('card', '{"c":')), 'json');
  const schema = (type, o) => assert.equal(reason(raw(type, o)), 'schema', JSON.stringify(o).slice(0, 80));
  for (const o of [null, [], '"x"', 5, { ...CARD, x: 1 }, { c: 'frei', v: '1.0.0' }, { ...CARD, c: 'Frei' }, { ...CARD, c: 'f' }, { ...CARD, c: 'a'.repeat(33) },
    { ...CARD, v: '1.0' }, { ...CARD, v: 1 }, { ...CARD, p: [] }, { ...CARD, p: null }, { ...CARD, p: Object.fromEntries(Array.from({ length: 49 }, (_, i) => ['k' + i, i])) }]) schema('card', o);
  for (const o of [{ ...CHALLENGE, s: 'A'.repeat(32) }, { ...CHALLENGE, k: Array(11).fill(null) }, { ...CHALLENGE, k: ['x'] }, { ...CHALLENGE, g: 'c'.repeat(15) }, { ...CHALLENGE, h: 5 },
    { ...CHALLENGE, m: [{ t: 'tap' }] }, { ...CHALLENGE, m: [{ t: 'tap', seat: 10 }] }, { ...CHALLENGE, m: [{ t: 'Tap', seat: 0 }] }, { ...CHALLENGE, m: [{ t: 'tap', seat: 0, 'a b': 1 }] },
    { ...CHALLENGE, m: [{ t: 'tap', seat: 0, a: '<script>' }] }, { ...CHALLENGE, m: [{ t: 'tap', seat: 0, a: 'x\u0000' }] }, { ...CHALLENGE, m: [{ t: 'tap', seat: 0, a: 1.5 }] },
    { ...CHALLENGE, m: [{ t: 'tap', seat: 0, a: 2 ** 32 }] }, { ...CHALLENGE, m: [{ t: 'tap', seat: 0, a: 'x'.repeat(2001) }] }, { ...CHALLENGE, m: [{ t: 'tap', seat: 0, a: Array(257).fill(0) }] },
    { ...CHALLENGE, m: 'x' }, { ...CHALLENGE, extra: 1 }, noH && { ...noH, s: undefined }]) schema('challenge', o);
  assert.equal(decodeV2(raw('challenge', { ...CHALLENGE, m: [{ t: 'tap', seat: 0, a: 'Zeile\neins\tzwei' }] })).ok, true, 'tab and line feed are text');
  // nesting depth at most 8 (the app's decode since feat/mdi-paritaet 12ac19f, contract/equal.js depthOk): same answer here
  const nest = (n) => (n === 0 ? 1 : [nest(n - 1)]);
  assert.equal(reason(raw('card', { ...CARD, p: { x: nest(6) } })), undefined, 'depth 8 passes');
  assert.equal(reason(raw('card', { ...CARD, p: { x: nest(7) } })), 'schema', 'depth 9 is refused');
  assert.throws(() => encodeV2('live', {})); assert.throws(() => encodeV2('card', { ...CARD, x: 1 }));
});

// The app's own vectors, meant for client and server (apps/mdi test/fixtures/link-vectors.json @ feat/mdi-paritaet 0ca46a8).
// Envelope reasons (leer .. schema) must be the same here; what the app refuses later (unknown card, version, params, moves,
// cheating) is the card's business: the envelope passes on this server. live never: "typ".
test('v2 envelope: the shared vectors of the app give the same answer here', () => {
  const V = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'mdi-link-vectors.json'), 'utf8'));
  const ENVELOPE = ['leer', 'zu-lang', 'praefix', 'base64', 'utf8', 'json', 'schema'];   // typ: only for a foreign link type (above)
  let n = 0;
  for (const v of [...V.accept, ...V.reject]) {
    const f = v.hash.replace(/^#/, ''), r = decodeV2(f), type = (/^v2\.([a-z]+)\./.exec(f) || [])[1];
    const want = type && !['card', 'challenge'].includes(type) && v.hash.length <= 4000 ? 'typ' : !v.reason || !ENVELOPE.includes(v.reason) ? 'ok' : v.reason;
    assert.equal(r.ok ? 'ok' : r.reason, want, v.name); n++;
  }
  assert.ok(n >= 24);
});

// ---- short links ------------------------------------------------------------------------------------------------------
test('short link v2: create, read back, the page opens the app on this host with exactly that fragment', async () => {
  const s = mk(); const h = await serve(s);
  for (const [f, k] of [[FC, 'card'], [FG, 'game']]) {
    const r = await post(h.base, { f, k, l: 'de' });
    assert.equal(r.status, 201);
    const { id, url, token, exp } = await r.json();
    assert.equal(url, `https://bunsenbrenner.org/s/${id}`); assert.ok(token && exp);
    assert.deepEqual(await (await fetch(`${h.base}/api/s/${id}`)).json(), { f, exp }, 'the fragment comes back byte for byte');
    const page = await fetch(`${h.base}/s/${id}`);
    assert.equal(page.status, 200);
    assert.equal(hrefOf(await page.text()), '/duell#' + f);
  }
  h.close();
  // the new app may live under its own path, still on this host
  const s2 = mk({ SHORT_V2_PATH: '/mdi' }); const h2 = await serve(s2);
  const a = s2.create({ f: FC, k: 'card' }), b = s2.create({ f: 'i=quiz-chaos' });
  assert.equal(hrefOf(await (await fetch(`${h2.base}/s/${a.body.id}`)).text()), '/mdi#' + FC);
  assert.equal(hrefOf(await (await fetch(`${h2.base}/s/${b.body.id}`)).text()), '/duell#i=quiz-chaos', 'old links keep their target');
  h2.close();
});

test('short link v2: SHORT_V2_PATH is a path on this host or the service does not start', () => {
  for (const bad of ['https://evil.example', '//evil.example', '/a//b', 'duell', '/', '/../x', '/Duell', '/duell?x=1', '/duell#x', '/du ell', '\\\\evil.example']) {
    assert.throws(() => mk({ SHORT_V2_PATH: bad }), /SHORT_V2_PATH/, bad);
  }
  assert.equal(mk({ SHORT_V2_PATH: '/apps/mdi' }).cfg.v2Path, '/apps/mdi');
});

test('short link v2 abuse: too long, foreign host, broken envelope, live and ghost: nothing is stored', async () => {
  const s = mk(); const h = await serve(s);
  // size: the app's limit (4000 with "#"), counted before anything is parsed; legacy c= keeps its 2 KB
  const near = encodeV2('card', { ...CARD, p: { x: 'y'.repeat(2900) } });
  assert.ok(near.length > 2048 && near.length <= V2_MAX); assert.equal(s.create({ f: near }).status, 201);
  assert.deepEqual(s.create({ f: 'v2.card.' + 'A'.repeat(V2_MAX - 7) }).body, { error: 'too-large', max: V2_MAX });
  assert.equal((await post(h.base, { f: 'v2.card.' + 'A'.repeat(8000) })).status, 413, 'body over the limit');
  assert.equal(s.create({ f: 'c=' + 'A'.repeat(3000) }).status, 413, 'the old form keeps its own limit');
  const n = s._state.links.size;
  // foreign host and every other way out of this host
  for (const f of ['https://evil.example/#' + FC, '//evil.example#' + FC, 'v2.card.' + FC.slice(8) + '#@evil.example', 'v2.card.' + FC.slice(8) + '/../../x', 'javascript:alert(1)', '#' + FC, ' ' + FC, FC + '\r\nLocation: https://evil.example']) {
    const r = await post(h.base, { f, k: 'card' });
    assert.equal(r.status, 400, f.slice(0, 40)); assert.equal((await r.json()).error, 'bad-fragment');
  }
  // broken envelope: reason told, nothing stored
  const cases = { schema: 'v2.card.' + b64(JSON.stringify({ ...CARD, x: 1 })), json: 'v2.card.' + b64('{"c":"frei"'), utf8: 'v2.card.' + Buffer.from([0xc3, 0x28]).toString('base64url'), base64: FC + '=', typ: 'v2.live.' + b64(JSON.stringify({ t: 'A'.repeat(22) })) };
  for (const [why, f] of Object.entries(cases)) {
    const r = await post(h.base, { f });
    assert.equal(r.status, 400, why); assert.deepEqual(await r.json(), { error: 'bad-fragment', reason: why });
  }
  assert.equal(s._state.links.size, n, 'none of these was stored');
  h.close();
});

test('short link v2 abuse: a tampered line in the store is never handed out or redirected to', async () => {
  const d = dir('short-v2-');
  const a = mk({ SHORT_DATA_DIR: d });
  const ok = a.create({ f: FC, k: 'card' }).body.id;
  const evil = 'Qe3kWm7x';
  writeFileSync(a._file(), readFileSync(a._file(), 'utf8') + JSON.stringify({ id: evil, f: 'v2.card.' + b64('{"c":"x"}') + '"><script>', k: 'card', n: null, l: 'de', h: '00', exp: Date.now() + 86400000 }) + '\n'
    + JSON.stringify({ id: 'Rf4kWm7x', f: 'https://evil.example/', k: 'card', n: null, l: 'de', h: '00', exp: Date.now() + 86400000 }) + '\n');
  const b = mk({ SHORT_DATA_DIR: d }); const h = await serve(b);
  for (const id of [evil, 'Rf4kWm7x']) {
    assert.equal((await fetch(`${h.base}/api/s/${id}`)).status, 410, id);
    const p = await fetch(`${h.base}/s/${id}`); const html = await p.text();
    assert.equal(p.status, 410); assert.equal(hrefOf(html), '/duell'); assert.ok(!html.includes('evil') && !html.includes('<script>'));
    assert.equal((await fetch(`${h.base}/s/img/${id}.jpg`)).status, 404);
  }
  assert.equal((await fetch(`${h.base}/s/${ok}`)).status, 200, 'the good link next to them still opens');
  h.close();
});

// Header-only JPEG of the given size (as in test/shortlink.test.mjs)
function jpeg(w, h) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
test('short link v2: the chat preview picture works as for the old links (creator only, once, 1200x630)', async () => {
  const s = mk(); const h = await serve(s);
  const { id, token } = await (await post(h.base, { f: FG, k: 'game', n: 12 })).json();
  const put = (tok) => fetch(`${h.base}/api/s/${id}/img`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + tok }, body: jpeg(1200, 630) });
  assert.equal((await put('falsch')).status, 403);
  assert.equal((await put(token)).status, 204);
  assert.equal((await put(token)).status, 409);
  const html = await (await fetch(`${h.base}/s/${id}`)).text();
  assert.match(html, new RegExp(`og:image" content="[^"]*/s/img/${id}\\.jpg"`));
  assert.match(html, /Schlag meine 12 Punkte!/);
  assert.equal((await fetch(`${h.base}/s/img/${id}.jpg`)).status, 200);
  h.close();
});

// ---- free cards in v2 links: bound to the deck status, with the content's gate hash ------------------------------------
// The server docs of the free card as this server answered them (test/fixtures/mdi-frei-docs.json); the link carries them as
// the parameters of the target card (the app's fromFree), the server reads them back with the app's toFree (lib/vendor/mdi).
const DOCS = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'mdi-frei-docs.json'), 'utf8')).docs;
const serverDoc = (n) => ({ ...DOCS[n].doc, ki: DOCS[n].ki });
const linkOf = (id, doc, type = 'card') => {
  const p = CARDS[id].fromFree(doc);
  assert.ok(p, `${id}: fromFree takes the server doc`);
  const env = { c: id, v: CARDS[id].manifest.version, p };
  return type === 'card' ? encodeV2('card', env) : encodeV2('challenge', { ...env, s: 'a'.repeat(32), k: [], m: [], g: 'c'.repeat(16) });
};
const cidOf = (n) => DOCS[n].ki.h.slice(0, 22);

test('free card v2 (frei, flug, lauf): with the app\'s own adapters the link gives the gate hash stored with the card', () => {
  for (const [n, id] of [['karte-ok-card', 'frei'], ['karte-ok-meme', 'frei'], ['karte-ok-game', 'flug'], ['karte-ok-lauf', 'lauf']]) {
    const doc = serverDoc(n), want = [[cidOf(n), gateHash(doc)]];
    assert.deepEqual(freeChecksOf(linkOf(id, doc)), want, `${n} -> ${id}`);
    assert.deepEqual(freeChecksOf(linkOf(id, doc, 'challenge')), want, `${n} as a challenge`);
    // other visible content under the same seal: another hash, so the deck answers "changed"
    const forged = { ...doc, t: 'Gefälscht', ...(doc.x !== undefined ? { x: 'Fremder Text' } : {}), ...(doc.g ? { g: { ...doc.g, title: 'Gefälscht' } } : {}), ...(doc.l ? { l: { ...doc.l, e: '💀' } } : {}) };
    const [[cid, gh]] = freeChecksOf(linkOf(id, forged));
    assert.equal(cid, cidOf(n)); assert.notEqual(gh, want[0][1], `${n}: forged content`);
  }
  assert.deepEqual(freeChecksOf(frei(FREI_CARD)), [[FREI_CARD.hash.slice(0, 22), GH.card]], 'the fixed vector of the app');
  assert.equal(GH.card, gateHash(serverDoc('karte-ok-card')));
  // a remix: by the root's id alone (frei: root, lauf: fr)
  const remix = { ...FREI_CARD, seal: '', hash: '', owner: '', root: 'R'.repeat(22), title: 'Mein Remix' };
  assert.deepEqual(freeChecksOf(frei(remix)), [['R'.repeat(22), undefined]]);
  const { ki, ...plain } = serverDoc('karte-ok-lauf');
  assert.deepEqual(freeChecksOf(linkOf('lauf', { ...plain, fr: 'R'.repeat(22) })), [['R'.repeat(22), undefined]]);
  assert.deepEqual(freeIdsOf(frei({ ...FREI_CARD, root: 'R'.repeat(22) })), [FREI_CARD.hash.slice(0, 22), 'R'.repeat(22)]);
  // what the app does not treat as a free card, the server does not either: an AI world, no adapter, an adapter that throws
  const welt = { ...serverDoc('karte-ok-game'), ki: { k: 'welt', s: 's2.welt.mw2y455c.AnlRQb9jJYrLILMRBtJj7yR1qlhJF0ER' } };
  assert.deepEqual(freeChecksOf(linkOf('flug', welt)), [], 'an AI world is no free card');
  assert.deepEqual(freeChecksOf(encodeV2('card', { c: 'bluff', v: '1.0.0', p: { ki: { k: 'karte', s: FREI_CARD.seal, h: FREI_CARD.hash } } })), [], 'a card without toFree holds no free card');
  assert.deepEqual(freeChecksOf(frei({ ...FREI_CARD, stickers: 'x' })), [], 'toFree throws: no doc, as in the app (freeDocOf)');
  assert.deepEqual(freeChecksOf(FC), []); assert.deepEqual(freeChecksOf(FG), []);
  assert.deepEqual(freeChecksOf('v2.card.kaputt'), [], 'a link that does not pass is no free card (and is refused anyway)');
});

// Since apps/mdi #255 (feat/mdi-paritaet 12ac19f) the seal of a free card travels as the parameters ki/fr of every card whose
// manifest has them (engines/frei/seal.js); the gate hash of a quiz or an ability holds only what a zug-* card shows (#131
// d027d45). Fixed vectors of the integrator: quiz 3UJyWF0h..., ability cghkxuz6...
const GH_ZUG = { 'karte-ok-quiz': '3UJyWF0hRI82BazIFMzXZlDdYjM8RC2VOEZU-WpOctI', 'karte-ok-faehigkeit': 'cghkxuz6YziV-IkK1q8TRgfl9bUF3qptFDlWDlbsZuA' };
const SEAL = { k: 'karte', s: FREI_CARD.seal, h: FREI_CARD.hash };
const defaultsOf = (id) => { const o = {}; for (const [k, v] of Object.entries(CARDS[id].manifest.params.properties)) o[k] = structuredClone(v.default); return o; };

test('free card v2 (zug-*): quiz and ability of the free card arrive with their seal and the gate hash stored with the card', () => {
  for (const [n, id] of [['karte-ok-quiz', 'zug-abfragen'], ['karte-ok-faehigkeit', serverDoc('karte-ok-faehigkeit').i]]) {
    const doc = serverDoc(n);
    assert.equal(gateHash(doc), GH_ZUG[n], `${n}: the server's stored hash is the integrator's vector`);
    assert.deepEqual(freeChecksOf(linkOf(id, doc)), [[cidOf(n), GH_ZUG[n]]], `${n} -> ${id}`);
    assert.deepEqual(freeChecksOf(linkOf(id, doc, 'challenge')), [[cidOf(n), GH_ZUG[n]]], `${n} as a challenge`);
  }
  // other visible content under the same seal: another question, another title -> another hash
  const quiz = serverDoc('karte-ok-quiz');
  const forged = { ...quiz, pk: { ...quiz.pk, q: [['Wer zahlt?', 'Du', 'Ich', 'Niemand'], ...quiz.pk.q.slice(1)] } };
  assert.notEqual(freeChecksOf(linkOf('zug-abfragen', forged))[0][1], GH_ZUG['karte-ok-quiz']);
  const fae = serverDoc('karte-ok-faehigkeit');
  assert.notEqual(freeChecksOf(linkOf(fae.i, { ...fae, t: 'Fremder Titel' }))[0][1], GH_ZUG['karte-ok-faehigkeit']);
  // colours and the sub line show on no zug-* card: they do not change the hash (d027d45, the same in app and server)
  assert.equal(gateHash({ ...fae, col: ['#000000', '#ffffff'], s: 'anders' }), GH_ZUG['karte-ok-faehigkeit']);
});

test('free card v2 (every card with a seal in its manifest, zug-* included): gated with the hash of what toFree shows; the others never', () => {
  const sealed = Object.keys(CARDS).filter((id) => CARDS[id].manifest.params.properties.ki);
  for (const id of ['flug', 'lauf', 'zug-abfragen', 'zug-termin', 'zug-einkauf', 'zug-wichteln', 'geschenk-finder', 'karte-danke', 'raum-sorry']) assert.ok(sealed.includes(id), id);
  const cid = SEAL.h.slice(0, 22);
  for (const id of sealed) {
    const p = { ...defaultsOf(id), ki: SEAL, fr: 'R'.repeat(22) };
    const f = encodeV2('card', { c: id, v: CARDS[id].manifest.version, p });
    // the server's gateHash of the doc the app's toFree builds: the projection agrees on both sides for every kind
    assert.deepEqual(freeChecksOf(f), [[cid, gateHash(CARDS[id].toFree(p))], ['R'.repeat(22), undefined]], id);
    assert.deepEqual(freeChecksOf(encodeV2('card', { c: id, v: CARDS[id].manifest.version, p: defaultsOf(id) })), [], id + ' without a seal');
  }
  // a card whose manifest has no seal fields: the app's fromFree does not carry one, so a link from the app never holds one
  for (const id of Object.keys(CARDS).filter((x) => !sealed.includes(x) && x !== 'frei')) {
    assert.deepEqual(freeChecksOf(encodeV2('card', { c: id, v: CARDS[id].manifest.version, p: defaultsOf(id) })), [], id);
  }
});

test('free card v2 (zug-*): a short link only while the deck says ok for that content', async () => {
  const deck = fakeDeck(), s = mk({}, { free: () => deck }); const h = await serve(s);
  const fae = serverDoc('karte-ok-faehigkeit'), quiz = serverDoc('karte-ok-quiz');
  const lf = linkOf(fae.i, fae), lq = linkOf('zug-abfragen', quiz, 'challenge');
  assert.deepEqual(s.create({ f: lf, k: 'game' }).body, { error: 'card-unknown' }, 'never registered');
  deck.cards.set(cidOf('karte-ok-faehigkeit'), GH_ZUG['karte-ok-faehigkeit']);
  deck.cards.set(cidOf('karte-ok-quiz'), GH_ZUG['karte-ok-quiz']);
  const a = await (await post(h.base, { f: lf, k: 'game' })).json(), b = s.create({ f: lq, k: 'game' });
  assert.ok(a.id); assert.equal(b.status, 201);
  assert.deepEqual(deck.asked.slice(-1), [[cidOf('karte-ok-quiz'), GH_ZUG['karte-ok-quiz']]]);
  assert.deepEqual(s.create({ f: linkOf(fae.i, { ...fae, t: 'Fremder Titel' }), k: 'game' }).body, { error: 'card-blocked' }, 'forged content');
  // a zug-* card without the seal is an ordinary catalog card: no gate at all
  const n = deck.asked.length;
  assert.equal(s.create({ f: encodeV2('card', { c: fae.i, v: CARDS[fae.i].manifest.version, p: defaultsOf(fae.i) }), k: 'game' }).status, 201);
  assert.equal(deck.asked.length, n, 'the deck is not asked');
  deck.blocked.add(cidOf('karte-ok-faehigkeit'));
  assert.equal((await fetch(`${h.base}/api/s/${a.id}`)).status, 410);
  assert.equal((await fetch(`${h.base}/s/${a.id}`)).status, 410);
  h.close();
});

test('free card v2: a short link only while the deck says ok for that content; later blocks close link, page and picture', async () => {
  const deck = fakeDeck(), cid = FREI_CARD.hash.slice(0, 22);
  const s = mk({}, { free: () => deck }); const h = await serve(s);
  const f = frei(FREI_CARD);
  assert.deepEqual(s.create({ f, k: 'card' }).body, { error: 'card-unknown' }, 'never registered: no short link');
  assert.equal(s.create({ f, k: 'card' }).status, 409);
  deck.cards.set(cid, GH.card);
  const r = await post(h.base, { f, k: 'card' });
  assert.equal(r.status, 201);
  const { id, token } = await r.json();
  assert.deepEqual(deck.asked.at(-1), [cid, GH.card], 'asked with the hash of the content the link shows');
  assert.deepEqual(deck.shared, [[cid, id]], 'the deck learns the short link (removal lists it)');
  // forged content with the id of the released card
  assert.deepEqual(s.create({ f: frei({ ...FREI_CARD, text: 'Ganz anderer Text' }), k: 'card' }).body, { error: 'card-blocked' });
  // a sealed free card on flug and lauf: the same gate, with the hash of the shown game
  const fl = linkOf('flug', serverDoc('karte-ok-game')), la = linkOf('lauf', serverDoc('karte-ok-lauf'));
  assert.deepEqual(s.create({ f: la, k: 'game' }).body, { error: 'card-unknown' });
  deck.cards.set(cidOf('karte-ok-game'), gateHash(serverDoc('karte-ok-game')));
  assert.equal(s.create({ f: fl, k: 'game' }).status, 201);
  assert.deepEqual(s.create({ f: linkOf('flug', { ...serverDoc('karte-ok-game'), g: { ...serverDoc('karte-ok-game').g, title: 'Fremd' } }), k: 'game' }).body, { error: 'card-blocked' });
  // a remix: by the root's id alone; one blocked id blocks the whole link
  const rm = frei({ ...FREI_CARD, seal: '', hash: '', owner: '', root: cid, title: 'Remix' });
  assert.equal(s.create({ f: rm, k: 'card' }).status, 201);
  assert.deepEqual(deck.asked.at(-1), [cid, undefined]);
  deck.down = true;
  assert.deepEqual(s.create({ f, k: 'card' }), { status: 503, body: { error: 'card-unavailable' } }, 'deck not readable: fail closed');
  assert.equal((await fetch(`${h.base}/api/s/${id}`)).status, 503);
  deck.down = false;
  assert.equal((await fetch(`${h.base}/api/s/${id}`)).status, 200);
  assert.equal((await fetch(`${h.base}/api/s/${id}/img`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + token }, body: jpeg(1200, 630) })).status, 204);
  assert.equal((await fetch(`${h.base}/s/img/${id}.jpg`)).status, 200);
  deck.blocked.add(cid);
  assert.deepEqual(await (await fetch(`${h.base}/api/s/${id}`)).json(), { error: 'card-blocked' });
  const page = await fetch(`${h.base}/s/${id}`);
  assert.equal(page.status, 410); assert.match(await page.text(), /nicht mehr verfügbar/);
  assert.equal((await fetch(`${h.base}/s/img/${id}.jpg`)).status, 404, 'the picture closes with the card');
  h.close();
});

// Security review H1 (strang-k, poc_srv.mjs): a forged seal without its hash on the card "frei". Before apps/mdi #269 the app
// treated it as no free card, so the server gave it a short link without asking the deck. Now gateChecksOf reports
// {cid: null}; the server answers "unknown" for it and never 201, whatever the deck says.
test('H1: a seal without its hash never gets a short link, not even from a deck that says ok to everything', async () => {
  const p = { kind: 'card', title: 'Gewinn', text: 'fremder Text', top: '', bottom: '', style: 'druck', palette: 'gelb', stickers: [], seal: 'AAAAAAAAAAAA', hash: '', owner: '', root: '' };
  const f = frei(p);
  const asked = [];
  const yes = { linkState: (cid, d) => { asked.push(cid); return 'ok'; }, sharedAs() {} };
  const s = mk({}, { free: () => yes });
  assert.deepEqual(freeChecksOf(f).map(([cid]) => cid), [null], 'the app reports a free card it cannot check');
  assert.deepEqual(s.create({ f, k: 'card', l: 'de' }).body, { error: 'card-unknown' });
  assert.deepEqual(asked, [], 'decided here, the deck is not even asked');
  const h = await serve(s);
  const r = await post(h.base, { f, k: 'card', l: 'de' });
  assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: 'card-unknown' });
  h.close();
  // the script's second case: a hash that is not the card's own, with a deck that blocks everything -> blocked, no 201
  const no = mk({}, { free: () => ({ linkState: () => 'blocked', sharedAs() {} }) });
  assert.deepEqual(no.create({ f: frei({ ...p, hash: 'A'.repeat(43) }), k: 'card', l: 'de' }).body, { error: 'card-blocked' });
  // the same holds for c= links of the old app (#131 H1: '' as id)
  const old = 'c=' + Buffer.from(JSON.stringify({ v: 1, d: { k: 'card', x: 'fremd', ki: { k: 'karte', s: 'AAAAAAAAAAAA' } } })).toString('base64url');
  assert.deepEqual(s.create({ f: old, k: 'card' }).body, { error: 'card-unknown' });
});

test('fragmentOk: the forms this server keeps, nothing else', () => {
  for (const f of [FC, FG, 'c=eyJ2IjoxfQ', 'i=quiz-chaos']) assert.equal(fragmentOk(f), true, f.slice(0, 20));
  for (const f of ['p=c2VjcmV0', 'v2.live.' + b64('{"t":"' + 'A'.repeat(22) + '"}'), 'v2.card.x', '#' + FC, null, 5, 'c=' + 'A'.repeat(2047)]) assert.equal(fragmentOk(f), false, String(f).slice(0, 20));
});

// ---- profile: wall entries of "Meins" -----------------------------------------------------------------------------------
const TH = 'data:image/jpeg;base64,' + 'A'.repeat(200);
const OLD_F = 'c=eyJ2IjoxLCJkIjp7ImsiOiJjYXJkIiwieCI6IkhhbGxvIn19';
const gate = (email) => ({ mode: 'gate', identify: async () => ({ email }), loginUrl: (r) => 'https://bunsenbrenner.org/gate/start?return=' + encodeURIComponent(r) });
const mkProfile = (d = dir('duell-profile-v2-')) => {
  const du = createDuell({ env: {}, salt: 's', log: () => {} });
  return { d, p: createDuellProfile({ env: { DUELL_PROFILE_DIR: d, DUELL_PROFILE_SALT: 'test-salt-0123456789' }, auth: gate('lea@example.org'), shared: du.shared, log: () => {} }) };
};

test('profile wall: f takes v2 card and challenge links (checked envelope), the old c= form stays as it is', () => {
  const w = (f) => cleanProfile({ wall: [{ id: 'own', ts: 5, k: 'card', th: TH, f }] }).wall[0];
  assert.equal(w(FC).f, FC); assert.equal(w(FG).f, FG); assert.equal(w(OLD_F).f, OLD_F);
  const long = encodeV2('card', { ...CARD, p: { x: 'y'.repeat(2900) } });
  assert.equal(w(long).f, long, 'a v2 link up to the app limit (the old 1200 is for c= only)');
  for (const bad of ['#' + FC, 'v2.card.' + 'A'.repeat(V2_MAX), FC + '=', 'v2.live.' + b64('{"t":"' + 'A'.repeat(22) + '"}'), 'v2.card.' + b64(JSON.stringify({ ...CARD, x: 1 })), 'https://evil.example/#' + FC, 'c=' + 'A'.repeat(1199)]) {
    const e = w(bad);
    assert.ok(e, 'the entry stays'); assert.equal(e.f, undefined, bad.slice(0, 30));
  }
  assert.equal(wallLinkFormat(FC), 'v2'); assert.equal(wallLinkFormat(OLD_F), 'v1'); assert.equal(wallLinkFormat('i=quiz'), null); assert.equal(wallLinkFormat(undefined), null);
});

test('profile wall migration: old entries are read and kept, never rewritten; new v2 entries sit next to them', async () => {
  const { d, p } = mkProfile();
  // a profile as the server stored it before v2 (only c= links)
  const old = { me: { nick: 'Lea' }, wall: [{ id: 'quiz-chaos', ts: 1762164000000, k: 'card', th: TH, f: OLD_F }, { id: 'own', ts: 1762164000001, k: 'game', th: TH }], saved: [] };
  assert.equal((await p.handle('put', { via: 'account', rev: 0, profile: old, age16: true }, {})).status, 200);
  const file = join(d, readdirSync(d).find((x) => x.endsWith('.json')));
  const before = readFileSync(file, 'utf8');
  const got = await p.handle('get', { via: 'account' }, {});
  assert.deepEqual(got.body.profile.wall, old.wall, 'read back exactly');
  assert.equal(readFileSync(file, 'utf8'), before, 'reading does not rewrite the stored profile');
  // the new app adds a v2 entry and sends the old ones back unchanged
  const next = { ...got.body.profile, wall: [{ id: 'flug', ts: 1762200000000, k: 'game', th: TH, f: FG }, ...got.body.profile.wall] };
  assert.equal((await p.handle('put', { via: 'account', rev: 1, profile: next }, {})).status, 200);
  const wall = (await p.handle('get', { via: 'account' }, {})).body.profile.wall;
  assert.deepEqual(wall.map((e) => e.f), [FG, OLD_F, undefined]);
  assert.deepEqual(wall.map((e) => wallLinkFormat(e.f)), ['v2', 'v1', null], 'each entry in its own form, nothing converted');
  // a profile file from before this change loads as it is (same record shape, no version bump needed)
  const { p: p2 } = mkProfile(d);
  assert.deepEqual((await p2.handle('get', { via: 'account' }, {})).body.profile.wall, wall);
});
