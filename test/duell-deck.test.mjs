// Free cards, wave W4: seal contract, fair measurement (sock puppets never reach the threshold), deck with signature and
// version, credit with caps and revocation, graded moderation with notices and appeal, report hooks, reviewer routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync as readF, writeFileSync as writeF } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { createReports } from '../lib/duell-report.mjs';
import { canonical } from '../lib/duell-seal.mjs';
import { checkKarte, createDeck, fingerprint, gateHash, gateView, sealKarte, similarity } from '../lib/duell-deck.mjs';
import { createCredit } from '../lib/duell-credit.mjs';
import { createMod } from '../lib/duell-mod.mjs';
import { freeChecksOf, freeCidOf, freeIdsOf } from '../lib/shortlink.mjs';
import { testShortLinks } from './short-helper.mjs';
import { App } from '../lib/duell-karte.mjs';

const DAY = 86400000, ADMIN = 'admin-token-0123456789abcdef', SALT = 'deck-salt';
const T0 = Date.UTC(2026, 10, 1, 12);

function setup({ env = {}, review, blockLink, dir = mkdtempSync(join(tmpdir(), 'duell-deck-')) } = {}) {
  const clock = { t: T0 };
  const now = () => clock.t, log = () => {};
  const E = { DUELL_SEAL_SECRET: 'seal', DUELL_AI_SALT: 'ai', DUELL_DECK_SALT: SALT, DUELL_ADMIN_TOKEN: ADMIN, DUELL_DECK_TICK_MS: '0', DUELL_DECK_EPHEMERAL: '1', ...env };
  const d = createDuell({ env: E, salt: 's', log, llm: async () => '{}', now });
  const auth = { mode: 'gate', identify: async (req) => ({ email: (req && req.headers['x-mail']) || null }) };
  const ai = createDuellAi({ env: E, shared: d.shared, auth, log, llm: async () => '{}', now });
  const credit = createCredit({ env: E, now, log, file: join(dir, 'credit.json') });
  const mod = createMod({ env: E, now, log, file: join(dir, 'mod.json') });
  const deck = createDeck({ env: E, shared: d.shared, who: ai.who, credit, mod, review, blockLink, now, log, file: join(dir, 'deck.json') });
  const reports = createReports({ env: { ...E, DUELL_REPORT_DIR: join(dir, 'rep') }, shared: d.shared, onCard: deck, now, log });
  return { clock, d, ai, credit, mod, deck, reports, dir, E };
}
const keyOf = async (s, mail) => (await s.ai.who({ headers: { 'x-mail': mail } }, {})).key;
let nr = 0;
const doc = (x = 'Wer zuerst den Stern fängt, gewinnt', extra = {}) => ({ x, s: 'neon', t: 'Sternfang ' + (++nr), ...extra });
async function make(s, mail, d = doc()) {
  const owner = await keyOf(s, mail);
  const { ki, cid } = sealKarte(s.d.shared.sealer, SALT, d, owner, s.clock.t);
  const full = { ...d, ki };
  assert.equal(s.deck.register({ cid, owner, doc: full, at: s.clock.t }).ok, true);
  return { cid, owner, doc: full, ki };
}
/** n accounts, first seen now and on `active` days in a row, then aged to `ageDays` after the first sight. */
async function accounts(s, n, { prefix = 'u', ageDays = 8, active = 2 } = {}) {
  const mails = Array.from({ length: n }, (_, i) => `${prefix}${i}@example.org`);
  const start = s.clock.t;
  for (let d = 0; d < active; d++) { s.clock.t = start + d * DAY; for (const m of mails) s.deck.seen(await keyOf(s, m)); }
  s.clock.t = start + Math.max(ageDays, active) * DAY;
  return mails;
}
async function serve(s) {
  const srv = http.createServer(async (q, r) => {
    const url = new URL(q.url, 'http://x');
    if (!(await s.deck.route(q, r, url)) && !(await s.reports.route(q, r, url))) r.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (path, body, mail, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(mail ? { 'x-mail': mail } : {}), ...headers }, body: JSON.stringify(body) });
  const adm = { Authorization: 'Bearer ' + ADMIN };
  return { srv, base, post, adm, close: () => new Promise((r) => srv.close(r)) };
}
/** A completed use over HTTP: start, wait `sec` on the fake clock, done. */
async function use(h, s, mail, ki, sec = 30) {
  const r = await h.post('/api/duell/deck/use', { ki, ev: 'start' }, mail);
  if (r.status !== 200) return r.status;
  const { t } = await r.json();
  s.clock.t += sec * 1000;
  return (await h.post('/api/duell/deck/use', { ki, ev: 'done', t }, mail)).status;
}
async function thumb(h, s, mail, ki, v) {
  const { t } = await (await h.post('/api/duell/deck/use', { ki, ev: 'start' }, mail)).json();
  s.clock.t += 15000;
  return (await h.post('/api/duell/deck/vote', { ki, v, t }, mail)).status;
}

test('Siegel-Vertrag: ki {k,s,h,o} haelt, jede Aenderung bricht es, o ist je Karte anders, Konto muss passen', async () => {
  const s = setup();
  const owner = await keyOf(s, 'ana@example.org');
  const a = sealKarte(s.d.shared.sealer, SALT, doc('Eins'), owner, T0), b = sealKarte(s.d.shared.sealer, SALT, doc('Zwei'), owner, T0);
  assert.equal(a.ki.k, 'karte'); assert.match(a.ki.o, /^[A-Za-z0-9_-]{22}$/); assert.notEqual(a.ki.o, b.ki.o, 'cards of one person cannot be linked');
  const d1 = doc('Eins'), sealed = sealKarte(s.d.shared.sealer, SALT, d1, owner, T0);
  const full = { ...d1, ki: sealed.ki };
  assert.equal(checkKarte(s.d.shared.sealer, full).valid, true);
  assert.equal(checkKarte(s.d.shared.sealer, { ...full, x: full.x + '!' }).valid, false);
  assert.equal(checkKarte(s.d.shared.sealer, { ...full, ki: { ...full.ki, o: 'A'.repeat(22) } }).valid, false);
  const other = await keyOf(s, 'bo@example.org');
  assert.equal(s.deck.register({ cid: sealed.cid, owner: other, doc: full }).error, 'bad-owner', 'only the real creator can register');
  assert.equal(s.deck.register({ cid: sealed.cid, owner, doc: full }).ok, true);
  assert.equal(typeof s.d.shared.deck.register, 'function', 'W2 reaches the deck over shared');
  assert.equal(s.d.shared.deck.check(full).cid, sealed.cid);
  const viaShared = s.d.shared.deck.sealKarte(d1, owner, T0);
  assert.deepEqual(viaShared, sealed, 'shared.deck.sealKarte(doc, potKey, at) is the same seal');
  assert.deepEqual(s.mod.cfg.severe, ['minors'], 'W2 category names');
});

test('Sockenpuppen-Lasttest: junge Konten, inaktive Konten, Ersteller, Wiederholung, zu schnell, ohne Login, Ring – Schwelle nie erreicht', async () => {
  const s = setup(), h = await serve(s);
  try {
    const card = await make(s, 'creator@example.org');
    // 1) 200 fresh accounts (first seen right now)
    for (let i = 0; i < 200; i++) assert.equal(await use(h, s, `fresh${i}@example.org`, card.ki), 204);
    assert.equal(s.deck._cards.get(card.cid).n, 0, 'young accounts never count');
    // 2) 60 accounts that are old enough but were seen on one day only
    const lone = await accounts(s, 60, { prefix: 'lone', active: 1 });
    for (const m of lone) await use(h, s, m, card.ki);
    assert.equal(s.deck._cards.get(card.cid).n, 0, 'one active day is not enough');
    // 3) the creator, 30 times
    for (let i = 0; i < 30; i++) await use(h, s, 'creator@example.org', card.ki);
    assert.equal(s.deck._cards.get(card.cid).n, 0, 'the creator never counts');
    // 4) one eligible account 50 times, and uses that are too fast or come with a forged token
    const [one] = await accounts(s, 1, { prefix: 'solo' });
    for (let i = 0; i < 50; i++) await use(h, s, one, card.ki);
    assert.equal(s.deck._cards.get(card.cid).n, 1, 'one account counts once');
    const [quick] = await accounts(s, 1, { prefix: 'quick' });
    for (let i = 0; i < 20; i++) await use(h, s, quick, card.ki, 3);
    assert.equal((await h.post('/api/duell/deck/use', { ki: card.ki, ev: 'done', t: '0.' + 'A'.repeat(22) }, quick)).status, 204);
    assert.equal(s.deck._cards.get(card.cid).n, 1, 'too fast or forged: nothing');
    assert.equal((await h.post('/api/duell/deck/use', { ki: card.ki, ev: 'start' })).status, 401, 'no login, nothing counted');
    // 5) a ring: 40 eligible puppets that boost three cards of one creator
    const ringCards = [await make(s, 'ring@example.org', doc('Ring Karte eins Sonne')), await make(s, 'ring@example.org', doc('Ring Karte zwei Mond')), await make(s, 'ring@example.org', doc('Ring Karte drei Wolke'))];
    const puppets = await accounts(s, 40, { prefix: 'pup' });
    s.clock.t += 20 * DAY;
    for (const c of ringCards) for (const m of puppets) await use(h, s, m, c.ki);
    await s.deck.tick();   // the timer looks at the creator's other cards (ring check across cards)
    for (const c of ringCards) {
      const x = s.deck._cards.get(c.cid);
      assert.equal(x.n, 40);
      assert.ok(!['candidate', 'review', 'deck'].includes(x.st), 'never proposed automatically');
    }
    assert.ok(ringCards.some((c) => s.deck._cards.get(c.cid).ring >= 0.6), 'ring share flagged');
    assert.equal(s.credit.available(ringCards[0].owner), 0, 'a ring earns nothing: what the first card got before the ring showed goes back');
    // 6) k - 1 genuine accounts stay below k
    const fair = await make(s, 'fair@example.org');
    const real = await accounts(s, s.deck.cfg.k - 1, { prefix: 'real' });
    s.clock.t += 15 * DAY;
    for (const m of real) await use(h, s, m, fair.ki);
    assert.equal(s.deck._cards.get(fair.cid).st, 'private');
    assert.equal(s.credit.available(fair.owner), 0);
    assert.equal(s.deck._cards.get(card.cid).st, 'private', 'the attacked card is no candidate');
    // nobody learns a count: the creator sees a status only
    const me = await (await h.post('/api/duell/deck/me', {}, 'fair@example.org')).json();
    assert.deepEqual(Object.keys(me.cards[0]).sort(), ['cid', 'st']);
    assert.equal(me.cards[0].st, 'privat');
  } finally { await h.close(); }
});

test('Fairer Weg: k Konten -> Guthaben, Kandidat, KI-Nachpruefung, Mensch nimmt auf; Deck signiert, versioniert, ueberall gleich', async () => {
  const seen = [];
  const s = setup({ review: async (d) => { seen.push(d.x); return { risk: 0, cats: [] }; } }), h = await serve(s);
  try {
    const card = await make(s, 'maker@example.org');
    const users = await accounts(s, 25, { prefix: 'fan' });
    s.clock.t = T0 + 15 * DAY;
    for (const m of users) assert.equal(await use(h, s, m, card.ki), 204);
    const c = s.deck._cards.get(card.cid);
    assert.equal(c.n, 25); assert.equal(c.st, 'candidate', 'proposed automatically, nothing more');
    assert.equal(s.credit.available(card.owner), 2, 'use: +2 at k accounts');
    // a human cannot admit before the AI re-check
    let r = await h.post('/api/duell/deck/review/' + card.cid, { action: 'admit' }, null, h.adm);
    assert.equal(r.status, 409); assert.equal((await r.json()).error, 'ai-review-open');
    // the timer runs the batch (the reviewer view never waits for the model); then the card waits for a human
    await s.deck.tick();
    const view = await (await fetch(h.base + '/api/duell/deck/review', { headers: h.adm })).json();
    assert.deepEqual(seen, [card.doc.x]);
    assert.equal(view.queue[0].st, 'review'); assert.equal(view.queue[0].users, '25-99', 'a bucket, not a count');
    const before = await (await fetch(h.base + '/api/duell/deck')).json();
    r = await h.post('/api/duell/deck/review/' + card.cid, { action: 'admit' }, null, h.adm);
    assert.equal(r.status, 200);
    assert.equal(s.credit.available(card.owner), 5, 'deck: +3');
    // the next version, the same bytes for every device, signed with the published key
    const r1 = await fetch(h.base + '/api/duell/deck'), r2 = await fetch(h.base + '/api/duell/deck', { headers: { 'x-mail': 'other@example.org' } });
    const t1 = await r1.text(), t2 = await r2.text();
    assert.equal(t1, t2, 'same version, same bytes');
    const j = JSON.parse(t1);
    assert.equal(j.v, before.v + 1);
    assert.deepEqual(j.cards.map((x) => x.cid), [card.cid]);
    assert.deepEqual(j.cards[0].doc, card.doc, 'data only: the sealed sheet');
    const key = await (await fetch(h.base + '/api/duell/deck/key')).json();
    const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key.pub, 'base64url')]), format: 'der', type: 'spki' });
    const { sig, ...body } = j;
    assert.equal(edVerify(null, Buffer.from(canonical(body)), pub, Buffer.from(sig, 'base64url')), true, 'signature holds');
    assert.equal(edVerify(null, Buffer.from(canonical({ ...body, v: body.v + 1 })), pub, Buffer.from(sig, 'base64url')), false);
    assert.equal(r1.headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(h.base + '/api/duell/deck', { headers: { 'If-None-Match': r1.headers.get('etag') } })).status, 304);
    const me = await (await h.post('/api/duell/deck/me', {}, 'maker@example.org')).json();
    assert.equal(me.cards[0].st, 'deck');
    assert.equal(me.credit.balance, 5);
    assert.deepEqual([me.credit.transferable, me.credit.purchasable, me.credit.payable], [false, false, false]);
    assert.equal(me.credit.abo.offered, false, 'subscription: interface only');
    // after admission the same 25 accounts do not count again; more accounts bring no more credit (no reward for reach)
    for (const m of users) await use(h, s, m, card.ki);
    assert.equal(s.deck._cards.get(card.cid).n, 25, 'distinct accounts stay distinct after admission');
    const more = await accounts(s, 80, { prefix: 'zweite' });
    for (const m of more) await use(h, s, m, card.ki);
    assert.equal(s.deck._cards.get(card.cid).n, 105);
    assert.equal(s.credit.available(card.owner), 5, 'no credit for 100 accounts: use and deck only');
  } finally { await h.close(); }
});

test('Block: Karte raus aus der naechsten Deck-Version, Siegel widerrufen, Guthaben zurueck (auch schon ausgegebenes)', async () => {
  const s = setup({ env: { DUELL_DECK_REVIEW_REQUIRED: '0' } }), h = await serve(s);
  try {
    const card = await make(s, 'maker@example.org');
    const users = await accounts(s, 25, { prefix: 'b' });
    s.clock.t = T0 + 15 * DAY;
    for (const m of users) await use(h, s, m, card.ki);
    await h.post('/api/duell/deck/review/' + card.cid, { action: 'admit' }, null, h.adm);
    assert.equal(s.credit.available(card.owner), 5);
    assert.equal(s.credit.spend(card.owner, 2), true, 'two free cards from credit');
    const v1 = (await (await fetch(h.base + '/api/duell/deck')).json()).v;
    const r = await (await h.post('/api/duell/deck/review/' + card.cid, { action: 'block', note: 'Marke' }, null, h.adm)).json();
    assert.equal(r.creditBack, 5);
    const j = await (await fetch(h.base + '/api/duell/deck')).json();
    assert.equal(j.v, v1 + 1);
    assert.deepEqual(j.cards, []); assert.deepEqual(j.revoked, [card.cid]);
    assert.equal(s.credit.available(card.owner), 0, 'spent credit stays spent; the balance starts below zero inside');
    // new credit first covers what was taken back: 2 spent of revoked credit -> the next +2 shows 0
    const next = await make(s, 'maker@example.org', doc('Eine ganz andere Idee mit Ballons und Wind'));
    const more = await accounts(s, 25, { prefix: 'c' });
    s.clock.t += 15 * DAY;
    for (const m of more) await use(h, s, m, next.ki);
    assert.equal(s.deck._cards.get(next.cid).n, 25);
    assert.equal(s.credit.available(card.owner), 0);
    const me = await (await h.post('/api/duell/mod/me', {}, 'maker@example.org')).json();
    assert.ok(me.notices.some((n) => n.type === 'card-removed' && n.cid === card.cid && n.automated.decided === false), 'a human decided, and the notice says so');
    await use(h, s, more[0], card.ki);
    assert.equal(s.deck._cards.get(card.cid).st, 'removed', 'a removed card stays removed');
  } finally { await h.close(); }
});

test('Dubletten: Varianten einer Person bringen einmal Guthaben, Kopien fremder Karten nie', async () => {
  const s = setup(), h = await serve(s);
  try {
    const text = 'Fang die fallenden Sterne bevor sie den Boden beruehren und sammle dabei Punkte fuer dein Team';
    const fa = fingerprint({ x: text }), fb = fingerprint({ x: text + ' jetzt' });
    assert.ok(similarity(fa, fb) >= 0.8, 'near duplicate: ' + similarity(fa, fb));
    assert.ok(similarity(fa, fingerprint({ x: 'Ein Quiz ueber Vulkane und ihre Gesteine' })) < 0.3);
    const a = await make(s, 'ana@example.org', { x: text, s: 'neon' });
    const a2 = await make(s, 'ana@example.org', { x: text + ' jetzt', s: 'neon' });
    const copy = await make(s, 'copy@example.org', { x: text + ' schnell', s: 'neon' });
    assert.equal(s.deck._cards.get(a2.cid).g, a.cid, 'one cluster');
    assert.equal(s.deck._cards.get(copy.cid).dupOf, a.cid);
    const users = await accounts(s, 25, { prefix: 'd' });
    s.clock.t = T0 + 15 * DAY;
    for (const c of [a, a2, copy]) for (const m of users) await use(h, s, m, c.ki);
    assert.equal(s.credit.available(a.owner), 2, 'variants: credit once');
    assert.equal(s.credit.available(copy.owner), 0, 'a copy earns nothing');
    assert.equal(s.deck._cards.get(copy.cid).st, 'private');
    assert.equal(s.deck._cards.get(a2.cid).st, 'private', 'the variant waits while its root is a candidate');
  } finally { await h.close(); }
});

test('Melden und Sperren von Ende zu Ende: Daumen runter -> Karte raus und vorgelegt, Konto bleibt; Mensch pausiert (Art. 17), Widerspruch (Art. 20), Mensch hebt auf, Mensch sperrt', async () => {
  const s = setup({ env: { DUELL_DECK_REVIEW_REQUIRED: '0' } }), h = await serve(s);
  try {
    const one = await make(s, 'bad@example.org', doc('Karte eins mit Kuchen'));
    const two = await make(s, 'bad@example.org', doc('Karte zwei mit Zitronen und Salz'));
    const users = await accounts(s, 25, { prefix: 'e' });
    s.clock.t = T0 + 15 * DAY;
    for (const m of users) await use(h, s, m, one.ki);
    assert.equal((await h.post('/api/duell/deck/review/' + one.cid, { action: 'admit' }, null, h.adm)).status, 200);
    const v = (await (await fetch(h.base + '/api/duell/deck')).json()).v;
    // brigading: 50 young accounts thumbs down, and eligible accounts without having opened the card: nothing
    for (let i = 0; i < 50; i++) await thumb(h, s, `young${i}@example.org`, one.ki, -1);
    for (const m of users.slice(0, 10)) assert.equal((await h.post('/api/duell/deck/vote', { ki: one.ki, v: -1 }, m)).status, 204);
    assert.equal(s.deck._cards.get(one.cid).down.size, 0);
    // 7 eligible down and 2 up: below the count, stays
    for (const m of users.slice(0, 7)) await thumb(h, s, m, one.ki, -1);
    for (const m of users.slice(20, 22)) await thumb(h, s, m, one.ki, 1);
    assert.equal(s.deck._cards.get(one.cid).st, 'deck');
    // the 8th: >= 8 accounts inside the window and >= 60 % -> out of the deck and the search, before a human
    await thumb(h, s, users[7], one.ki, -1);
    assert.equal(s.deck._cards.get(one.cid).st, 'hidden');
    const j = await (await fetch(h.base + '/api/duell/deck')).json();
    assert.equal(j.v, v + 1); assert.deepEqual(j.cards, []);
    const view = await (await fetch(h.base + '/api/duell/deck/review', { headers: h.adm })).json();
    assert.ok(view.hidden.some((x) => x.cid === one.cid), 'the hidden card is shown on /duell/pruefen');
    // the second card of the same account gets hidden too: the account stays as it is (thumbs only sort and hide)
    for (const m of users.slice(0, 8)) await thumb(h, s, m, two.ki, -1);
    assert.equal(s.deck._cards.get(two.cid).st, 'hidden');
    assert.equal(s.mod.status(one.owner).st, 'ok', 'no pause from thumbs, however many cards');
    assert.equal(s.mod.canCreate(one.owner).ok, true);
    let me = await (await h.post('/api/duell/mod/me', {}, 'bad@example.org')).json();
    assert.deepEqual([...new Set(me.notices.map((n) => n.type))], ['card-hidden'], 'only notices about the cards');
    // a human decides on the review page: pause, with a statement of reasons
    let q = await (await fetch(h.base + '/api/duell/mod', { headers: h.adm })).json();
    assert.equal(q.accounts.length, 0, 'thumbs do not even flag the account');
    const mid = s.mod.midOf(one.owner);
    assert.equal((await h.post('/api/duell/mod/' + mid, { action: 'pause', note: 'zwei Karten nach Pruefung' }, null, h.adm)).status, 200);
    assert.equal(s.mod.status(one.owner).st, 'paused');
    assert.equal(s.mod.canCreate(one.owner).error, 'account-paused', 'W2: no new free cards');
    assert.equal((await h.post('/api/duell/mod/' + mid, { action: 'pause' })).status, 401, 'only with the admin token');
    me = await (await h.post('/api/duell/mod/me', {}, 'bad@example.org')).json();
    const pause = me.notices.find((n) => n.type === 'pause');
    for (const f of ['facts', 'ground', 'automated', 'until', 'redress', 'appealUntil']) assert.ok(pause[f] !== undefined, 'Art. 17 field ' + f);
    assert.equal(pause.automated.decided, false, 'a human decided');
    assert.equal(pause.facts.by, 'human');
    assert.deepEqual(pause.redress, ['appeal', 'court']);
    assert.ok(Date.parse(pause.appealUntil) - Date.parse(pause.at) >= 180 * DAY, 'six months to complain');
    // complaint, once
    assert.equal((await h.post('/api/duell/mod/appeal', { nid: pause.nid, text: 'Das war eine Gruppe aus der Klasse.' }, 'bad@example.org')).status, 202);
    assert.equal((await h.post('/api/duell/mod/appeal', { nid: pause.nid, text: 'nochmal' }, 'bad@example.org')).status, 409);
    assert.equal((await h.post('/api/duell/mod/appeal', { nid: pause.nid, text: 'x' }, 'someone@example.org')).status, 404, 'only the own notices');
    const hid = me.notices.find((n) => n.type === 'card-hidden' && n.cid === one.cid);
    assert.equal((await h.post('/api/duell/mod/appeal', { nid: hid.nid, text: 'Die Karte ist harmlos.' }, 'bad@example.org')).status, 202);
    // the human: lifts the pause and restores the first card
    q = await (await fetch(h.base + '/api/duell/mod', { headers: h.adm })).json();
    assert.equal(q.appeals.length, 2); assert.equal(q.accounts[0].st, 'paused');
    assert.equal(q.accounts[0].mid, mid);
    assert.equal(mid.length, 16); assert.ok(!JSON.stringify(q).includes(one.owner), 'reviewers see an opaque id');
    assert.equal((await h.post('/api/duell/mod/' + mid, { action: 'lift', nid: pause.nid, note: 'Brigading' }, null, h.adm)).status, 200);
    assert.equal((await h.post('/api/duell/mod/' + mid, { action: 'lift', nid: hid.nid }, null, h.adm)).status, 200);
    assert.equal(s.mod.status(one.owner).st, 'ok');
    assert.equal(s.deck._cards.get(one.cid).st, 'deck', 'the card is back');
    assert.deepEqual((await (await fetch(h.base + '/api/duell/deck')).json()).cards.map((c) => c.cid), [one.cid]);
    me = await (await h.post('/api/duell/mod/me', {}, 'bad@example.org')).json();
    assert.equal(me.notices.find((n) => n.nid === pause.nid).appeal.state, 'lifted');
    // final block only by a human
    assert.equal((await h.post('/api/duell/mod/' + mid, { action: 'ban' }, null, h.adm)).status, 200);
    assert.equal(s.mod.canCreate(one.owner).error, 'account-banned');
    me = await (await h.post('/api/duell/mod/me', {}, 'bad@example.org')).json();
    assert.equal(me.notices.at(-1).type, 'ban'); assert.equal(me.notices.at(-1).automated.decided, false);
    // and a pause ends by itself after 14 days
    const s2 = setup();
    const k = await keyOf(s2, 'p@example.org');
    s2.mod.pause(k, { test: 1 });
    s2.clock.t += 14 * DAY + 1;
    assert.equal(s2.mod.status(k).st, 'ok');
    assert.equal(s2.mod.me(k).notices.at(-1).type, 'lift');
  } finally { await h.close(); }
});

test('Schwerer Verstoss: KI-Nachpruefung findet eine Kategorie aus DUELL_MOD_SEVERE_CATS -> Karte vorlaeufig gesperrt, Konto vorgelegt (nicht gesperrt), Mensch bestaetigt (Strike) und sperrt; Risiko 2 nur zurueck', async () => {
  const s = setup({ review: async (d) => (d.x.includes('schlimm') ? { risk: 3, cats: ['minors'] } : { risk: 2, cats: ['violence'] }) }), h = await serve(s);
  try {
    const bad = await make(s, 'x@example.org', doc('schlimm schlimm'));
    const meh = await make(s, 'y@example.org', doc('etwas grob aber erlaubt'));
    const users = await accounts(s, 25, { prefix: 'f' });
    s.clock.t = T0 + 15 * DAY;
    for (const c of [bad, meh]) for (const m of users) await use(h, s, m, c.ki);
    await s.deck.tick();
    assert.equal(s.deck._cards.get(bad.cid).st, 'held', 'provisional: before a human');
    assert.equal((await (await fetch(h.base + '/api/duell/deck/status?c=' + bad.cid)).json()).st, 'blocked', 'no access while held');
    assert.equal(s.mod.status(bad.owner).st, 'ok', 'the AI never blocks an account');
    const held = s.mod.me(bad.owner).notices.find((n) => n.type === 'card-held');
    assert.deepEqual(held.facts.cats, ['minors']); assert.equal(held.facts.provisional, true); assert.deepEqual(held.redress, ['appeal', 'court']);
    const q = await (await fetch(h.base + '/api/duell/mod', { headers: h.adm })).json();
    const acc = q.accounts.find((a) => a.mid === s.mod.midOf(bad.owner));
    assert.equal(acc.review.why, 'severe'); assert.equal(acc.st, 'ok');
    const view = await (await fetch(h.base + '/api/duell/deck/review', { headers: h.adm })).json();
    assert.ok(view.held.some((x) => x.cid === bad.cid), 'held cards are on the review page');
    // the human confirms: blocked for good with a rule ground, a strike with its own notice; then a final block
    assert.equal((await h.post('/api/duell/deck/review/' + bad.cid, { action: 'confirm', ground: 'sex' }, null, h.adm)).status, 200);
    assert.equal(s.deck._cards.get(bad.cid).st, 'removed');
    assert.equal(s.credit.available(bad.owner), 0, 'credit taken back');
    const st = s.mod.me(bad.owner).notices.find((n) => n.type === 'strike');
    assert.equal(st.facts.src, 'confirmed'); assert.equal(st.facts.ground, 'sex'); assert.equal(st.automated.decided, false); assert.ok(st.facts.lapses);
    assert.equal((await h.post('/api/duell/mod/' + acc.mid, { action: 'ban', note: 'geprueft' }, null, h.adm)).status, 200);
    assert.equal(s.mod.status(bad.owner).st, 'banned');
    assert.equal(s.deck._cards.get(meh.cid).st, 'private'); assert.equal(s.mod.status(meh.owner).st, 'ok');
    // "Kein Befund" clears a flag without a sanction
    const z = await keyOf(s, 'z@example.org');
    s.mod.flag(z, 'severe', { cards: ['z'.repeat(22)] });
    assert.equal((await h.post('/api/duell/mod/' + s.mod.midOf(z), { action: 'dismiss' }, null, h.adm)).status, 200);
    assert.equal(s.mod.status(z).st, 'ok'); assert.equal(s.mod._accounts.get(z).review, undefined);
    assert.equal((await h.post('/api/duell/mod/' + s.mod.midOf(z), { action: 'dismiss' }, null, h.adm)).status, 409);
  } finally { await h.close(); }
});

test('Meldungen: offene Meldung stoppt den Vorschlag, viele verstecken ohne Strike, Block der Meldung entfernt die Karte', async () => {
  const s = setup({ env: { DUELL_DECK_REVIEW_REQUIRED: '0', DUELL_REPORT_PER_HOUR: '99', DUELL_MOD_REPORTS_HIDE: '5' } }), h = await serve(s);
  try {
    // default: anonymous reports never hide (no account, no IP: five could be one person)
    const d0 = setup({ env: { DUELL_REPORT_PER_HOUR: '99' } }), h0 = await serve(d0);
    try {
      const c0 = await make(d0, 'm0@example.org');
      for (let i = 0; i < 8; i++) assert.equal((await h0.post('/api/duell/report', { reason: 'other', kind: 'karte', seal: c0.ki.s, optionHash: c0.ki.h })).status, 202);
      assert.equal(d0.deck._cards.get(c0.cid).st, 'private'); assert.equal(d0.deck._cards.get(c0.cid).rep, 8);
    } finally { await h0.close(); }
    const card = await make(s, 'm@example.org');
    const users = await accounts(s, 25, { prefix: 'g' });
    s.clock.t = T0 + 15 * DAY;
    for (const m of users) await use(h, s, m, card.ki);
    assert.equal(s.deck._cards.get(card.cid).st, 'review');
    const rep = (reason) => h.post('/api/duell/report', { reason, kind: 'karte', seal: card.ki.s, optionHash: card.ki.h });
    assert.equal((await rep('wrong')).status, 202);
    assert.equal(s.deck._cards.get(card.cid).st, 'private', 'an open report stops the proposal');
    for (let i = 0; i < 4; i++) await rep('other');
    assert.equal(s.deck._cards.get(card.cid).st, 'hidden');
    assert.equal(s.mod.status(card.owner).st, 'ok');
    assert.equal(s.mod._accounts.get(card.owner).strikes.length, 0, 'anonymous reports never pause an account');
    const open = await (await fetch(h.base + '/api/duell/report', { headers: h.adm })).json();
    assert.equal(open.open.length, 5); assert.equal(open.open[0].kind, 'karte'); assert.equal(open.open[0].optionHash, card.ki.h);
    await h.post('/api/duell/report/' + open.open[0].id, { action: 'block' }, null, h.adm);
    assert.equal(s.deck._cards.get(card.cid).st, 'removed');
  } finally { await h.close(); }
});

test('Guthaben: nur echte Nutzung, feste Betraege, Deckel je Karte und Jahr, verwerfen gibt zurueck, kein Weg zum Kaufen, Uebertragen, Auszahlen', async () => {
  const s = setup({ env: { DUELL_CREDIT_YEAR_CAP: '5', DUELL_CREDIT_CARD_CAP: '4' } });
  const k = await keyOf(s, 'c@example.org'), cid = (i) => String(i).padStart(22, 'A');
  assert.equal(s.credit.award(k, cid(1), 'use'), 2);
  assert.equal(s.credit.award(k, cid(1), 'use'), 0, 'once per card and reason');
  for (const r of ['reach', 'share', 'open', 'forward']) assert.equal(s.credit.award(k, cid(1), r), 0, 'no credit for ' + r);
  assert.equal(s.credit.award(k, cid(1), 'deck'), 2, 'card cap 4 (2 + 2 of 3)');
  assert.equal(s.credit.award(k, cid(2), 'use'), 1, 'year cap 5');
  s.clock.t = Date.UTC(2027, 0, 2);
  assert.equal(s.credit.award(k, cid(3), 'use'), 2, 'a new year');
  assert.equal(s.credit.award(k, cid(3), 'deck'), 2, 'card cap 4 again');
  assert.equal(s.credit.available(k), 9);
  assert.equal(s.credit.spend(k, 1), true); assert.equal(s.credit.refund(k, 1), true); assert.equal(s.credit.refund(k, 1), false, 'never more than spent');
  assert.equal(s.credit.spend(k, 10), false);
  const h = await serve(s);
  try {
    for (const p of ['/api/duell/credit', '/api/duell/credit/buy', '/api/duell/credit/transfer', '/api/duell/credit/payout', '/api/duell/deck/buy', '/api/duell/deck/transfer'])
      assert.equal((await h.post(p, { n: 1, to: 'x' }, 'c@example.org')).status, 404, p);
  } finally { await h.close(); }
});

test('Pruefoberflaeche und Admin-Routen: nur mit Token, Seite ohne Fremdskript, Zustand ueberlebt den Neustart', async () => {
  const s = setup(), h = await serve(s);
  try {
    assert.equal((await fetch(h.base + '/api/duell/deck/review')).status, 401);
    assert.equal((await fetch(h.base + '/api/duell/deck/review', { headers: { Authorization: 'Bearer wrong-token-0123456789' } })).status, 401);
    assert.equal((await fetch(h.base + '/api/duell/mod')).status, 401);
    assert.equal((await h.post('/api/duell/deck/review/' + 'A'.repeat(22), { action: 'admit' })).status, 401);
    const page = await fetch(h.base + '/duell/pruefen');
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+';/);
    assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe/);
    const html = await page.text();
    assert.ok(!html.includes(ADMIN)); assert.match(html, /type="password"/);
    assert.equal((await h.post('/api/duell/deck/me', {})).status, 401, 'own status needs a login');
  } finally { await h.close(); }
  const card = await make(s, 'z@example.org');
  s.deck.flush(); s.credit.flush(); s.mod.flush();
  const again = setup({ dir: s.dir });
  assert.equal(again.deck._cards.get(card.cid).o, card.owner, 'state survives a restart');
  const off = setup({ env: { DUELL_ADMIN_TOKEN: '' } }), h2 = await serve(off);
  try { assert.equal((await fetch(h2.base + '/api/duell/deck/review', { headers: { Authorization: 'Bearer ' + ADMIN } })).status, 503); } finally { await h2.close(); }
});

test('Kein Pfad von Daumen zu einer Kontosanktion: viele Daumen runter auf vielen Karten -> Karten vorgelegt, Konto unveraendert; Fenster; Daumen sortieren', async () => {
  const s = setup({ env: { DUELL_DECK_REVIEW_REQUIRED: '0' } }), h = await serve(s);
  try {
    const owner = 'heavy@example.org', made = [];
    for (let i = 0; i < 4; i++) made.push(await make(s, owner, doc('Karte ' + i + ' ' + 'abcdefghij'.slice(i) + ' Sterne zaehlen und Wolken malen')));
    const users = await accounts(s, 40, { prefix: 'hv' });
    for (const c of made) for (const m of users) await thumb(h, s, m, c.ki, -1);   // 40 accounts, 100 %, on every card
    for (const c of made) assert.equal(s.deck._cards.get(c.cid).st, 'hidden');
    const k = made[0].owner;
    assert.equal(s.mod.status(k).st, 'ok'); assert.equal(s.mod.canCreate(k).ok, true); assert.equal(s.mod.inGood(k), true);
    assert.equal(s.mod._accounts.get(k).strikes.length, 0, 'no strike'); assert.equal(s.mod._accounts.get(k).review, undefined, 'no flag');
    assert.ok(!s.mod.me(k).notices.some((n) => n.type !== 'card-hidden'), 'no pause, no ban');
    const q = await (await fetch(h.base + '/api/duell/mod', { headers: h.adm })).json();
    assert.equal(q.accounts.length, 0);
    // the window: 7 thumbs down, 15 days later one more is no 8 inside DUELL_MOD_DOWN_DAYS
    const late = await make(s, 'late@example.org', doc('Langsam gemeinsam einen Turm aus Wolken bauen'));
    for (const m of users.slice(0, 7)) await thumb(h, s, m, late.ki, -1);
    s.clock.t += 15 * DAY;
    await thumb(h, s, users[7], late.ki, -1);
    assert.notEqual(s.deck._cards.get(late.cid).st, 'hidden', 'old thumbs fall out of the window');
    for (const m of users.slice(8, 15)) await thumb(h, s, m, late.ki, -1);
    assert.equal(s.deck._cards.get(late.cid).st, 'hidden', '8 inside the window');
  } finally { await h.close(); }
  // sorting: thumbs change the order of the deck (a new signed version), nothing else
  const s2 = setup({ env: { DUELL_DECK_REVIEW_REQUIRED: '0' } }), h2 = await serve(s2);
  try {
    const a = await make(s2, 'a@example.org', doc('Erste Karte mit Papierflugzeugen')), b = await make(s2, 'b@example.org', doc('Zweite Karte mit Seifenblasen'));
    const fans = await accounts(s2, 25, { prefix: 'so' });
    s2.clock.t = T0 + 15 * DAY;
    for (const c of [a, b]) { for (const m of fans) await use(h2, s2, m, c.ki); assert.equal((await h2.post('/api/duell/deck/review/' + c.cid, { action: 'admit' }, null, h2.adm)).status, 200); }
    let j = await (await fetch(h2.base + '/api/duell/deck')).json();
    assert.deepEqual(j.cards.map((x) => x.cid), [a.cid, b.cid]);
    for (const m of fans.slice(0, 3)) await thumb(h2, s2, m, b.ki, 1);
    const j2 = await (await fetch(h2.base + '/api/duell/deck')).json();
    assert.deepEqual(j2.cards.map((x) => x.cid), [b.cid, a.cid], 'more thumbs up: further up');
    assert.equal(j2.v, j.v + 1);
    for (const m of fans.slice(0, 5)) await thumb(h2, s2, m, b.ki, -1);
    j = await (await fetch(h2.base + '/api/duell/deck')).json();
    assert.deepEqual(j.cards.map((x) => x.cid), [a.cid, b.cid], 'thumbs down: further down, still in the deck');
    assert.equal(s2.mod.status(b.owner).st, 'ok');
  } finally { await h2.close(); }
});

test('Widerspruch gegen eine entfernte Karte: aufgehoben -> Karte zurueck im Deck, Siegel nicht mehr widerrufen, Guthaben zurueck', async () => {
  const s = setup({ env: { DUELL_DECK_REVIEW_REQUIRED: '0' } }), h = await serve(s);
  try {
    const card = await make(s, 'back@example.org');
    const users = await accounts(s, 25, { prefix: 'bk' });
    s.clock.t = T0 + 15 * DAY;
    for (const m of users) await use(h, s, m, card.ki);
    await h.post('/api/duell/deck/review/' + card.cid, { action: 'admit' }, null, h.adm);
    await h.post('/api/duell/deck/review/' + card.cid, { action: 'block' }, null, h.adm);
    assert.equal(s.credit.available(card.owner), 0);
    const n = s.mod.me(card.owner).notices.find((x) => x.type === 'card-removed');
    assert.equal((await h.post('/api/duell/mod/appeal', { nid: n.nid, text: 'Das ist meine eigene Figur.' }, 'back@example.org')).status, 202);
    const view = await (await fetch(h.base + '/api/duell/deck/review', { headers: h.adm })).json();
    assert.equal(view.removed[0].cid, card.cid, 'the reviewer sees removed cards');
    assert.equal((await h.post('/api/duell/mod/' + s.mod.midOf(card.owner), { action: 'lift', nid: n.nid }, null, h.adm)).status, 200);
    const j = await (await fetch(h.base + '/api/duell/deck')).json();
    assert.deepEqual(j.cards.map((c) => c.cid), [card.cid]); assert.deepEqual(j.revoked, []);
    assert.equal(s.credit.available(card.owner), 5, 'credit counts again');
    for (const m of users) await use(h, s, m, card.ki);
    assert.equal(s.deck._cards.get(card.cid).n, 25, 'nobody counts twice after the restore');
  } finally { await h.close(); }
});

test('Grenzen: hoechstens DUELL_DECK_PER_OWNER_DAY Registrierungen je Person und Tag, Siegelzeit statt Angabe', async () => {
  const s = setup({ env: { DUELL_DECK_PER_OWNER_DAY: '3' } });
  for (let i = 0; i < 3; i++) await make(s, 'many@example.org', doc('Idee ' + i + ' ' + 'abcdefghij'[i]));
  const owner = await keyOf(s, 'many@example.org'), d = doc('Noch eine');
  const { ki, cid } = sealKarte(s.d.shared.sealer, SALT, d, owner, s.clock.t);
  assert.equal(s.deck.register({ cid, owner, doc: { ...d, ki }, at: 0 }).error, 'owner-limit');
  s.clock.t += DAY;
  assert.equal(s.deck.register({ cid, owner, doc: { ...d, ki }, at: 0 }).ok, true);
  assert.equal(s.deck._cards.get(cid).at, T0, 'the time comes from the seal');
});

test('Statistik-Reiter: nur mit Token, Zeitfenster 7/30/90/365, ohne k-Maske, freie Karten mit Nutzung, Status, Daumen, Meldungen', async () => {
  const s = setup(), h = await serve(s);
  try {
    const path = '/api/duell/admin/stat';
    assert.equal((await fetch(h.base + path)).status, 401, 'admin only');
    assert.equal((await fetch(h.base + path, { headers: { Authorization: 'Bearer wrong-token-0123456789' } })).status, 401);
    assert.equal((await fetch(h.base + path + '?days=14', { headers: h.adm })).status, 400, 'only the four windows');
    assert.equal((await fetch(h.base + path, { method: 'POST', headers: h.adm, body: '{}' })).status, 405);
    let j = await (await fetch(h.base + path, { headers: h.adm })).json();
    assert.equal(j.days, 30); assert.equal(j.stat, null, 'no source attached yet'); assert.deepEqual(j.free, []);

    // free card: 3 uses on day 0, 2 more on day 40 -> 7 days: 2, 90 days: 5 (below k, still shown exactly: admin, counters only)
    const card = await make(s, 'maker@example.org');
    const first = await accounts(s, 3, { prefix: 'erst' });
    for (const m of first) assert.equal(await use(h, s, m, card.ki), 204);
    const later = await accounts(s, 2, { prefix: 'spaet', ageDays: 40 });
    for (const m of later) await use(h, s, m, card.ki);
    await thumb(h, s, 'spaet0@example.org', card.ki, -1);
    await thumb(h, s, 'erst0@example.org', card.ki, 1);
    s.deck.onReport(card.ki.h);
    const seenDays = [];
    s.deck.useStat({ readAdmin: (d) => { seenDays.push(d); return { days: d, cards: [{ i: 'kino', share: 1, remix: 1, open: 2, up: 0, down: 1, w: JSON.parse('{"farbe":1,"__proto__":9,"X":2}') }, { i: card.cid, share: 2, remix: 0, open: 7, up: null, down: null, w: {} }] }; } });
    const get = async (d) => (await fetch(h.base + path + '?days=' + d, { headers: h.adm })).json();
    j = await get(7);
    assert.equal(j.k, 25);
    assert.deepEqual(j.stat.cards, [{ i: 'kino', share: 1, remix: 1, open: 2, up: 0, down: 1, w: { farbe: 1 } }], 'unmasked, unknown areas dropped, free card joined below');
    assert.equal(j.stat.masked, false);
    const row = j.free[0];
    assert.deepEqual([row.cid, row.st, row.use, row.useAll, row.k, row.up, row.down, row.reports, row.reportsAll, row.share, row.open], [card.cid, 'privat', 2, 5, false, 1, 1, 1, 1, 2, 7]);
    assert.equal(row.t, card.doc.t);
    assert.equal((await get(90)).free[0].use, 5);
    assert.deepEqual(seenDays, [7, 90]);
    for (const d of [30, 365]) assert.equal((await fetch(h.base + path + '?days=' + d, { headers: h.adm })).status, 200);
    // status labels: block -> gesperrt
    await h.post('/api/duell/deck/review/' + card.cid, { action: 'block' }, null, h.adm);
    assert.equal((await get(30)).free[0].st, 'gesperrt');
    // a source with only the public read(days) is used, but marked as masked; a throwing source does not break the tab
    s.deck.useStat({ read: () => ({ cards: [{ i: 'kino', share: null, remix: null, open: null, up: null, down: null, w: {} }] }) });
    assert.equal((await get(30)).stat.masked, true);
    s.deck.useStat({ readAdmin: () => { throw new Error('x'); } });
    assert.equal((await get(30)).stat, null);
    // per-day counters survive a restart
    s.deck.flush();
    const again = setup({ dir: s.dir });
    assert.equal(again.deck.statView(90).free[0].use, 5);
    // the page carries the tab, and its one inline script still matches the CSP hash
    const page = await fetch(h.base + '/duell/pruefen'), html = await page.text();
    assert.match(html, /role="tab" id="ts"[^>]*>Statistik</);
    const hash = page.headers.get('content-security-policy').match(/sha256-([A-Za-z0-9+/=]+)/)[1];
    const { createHash } = await import('node:crypto');
    assert.equal(createHash('sha256').update(html.match(/<script>([\s\S]*)<\/script>/)[1]).digest('base64'), hash);
    assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write/, 'textContent only');
  } finally { await h.close(); }
});

/** Probe of the W4 review: a creator with three cards used by the same two accounts (k = 2) -> ring on card A. */
async function ringSetup(review) {
  const s = setup({ env: { DUELL_DECK_K: '2' }, review });
  const owner = await keyOf(s, 'creator@example.org');
  const ids = [];
  for (const x of ['Alpha Beta Gamma Delta Epsilon Zeta', 'Rot Gruen Blau Gelb Lila Orange Weiss', 'Hund Katze Maus Pferd Esel Kuh Schaf']) {
    const d = { x, s: 'neon', t: x.split(' ')[0] }, { ki, cid } = sealKarte(s.d.shared.sealer, SALT, d, owner, s.clock.t);
    s.deck.register({ cid, owner, doc: { ...d, ki }, at: s.clock.t }); ids.push(cid);
  }
  const keys = [await keyOf(s, 'r0@example.org'), await keyOf(s, 'r1@example.org')];
  for (let i = 0; i < 3; i++) { for (const k of keys) s.deck.seen(k); s.clock.t += DAY; }
  s.clock.t += 15 * DAY;
  const C = s.deck._cards;
  for (const id of ids.slice(0, 2)) for (const k of keys) s.deck.count(k, id, C.get(id));
  const before = s.credit.available(owner);
  for (const k of keys) s.deck.count(k, ids[2], C.get(ids[2]));
  await s.deck.tick();
  return { s, owner, ids, keys, before };
}

test('Review W4 HOLD 1: was die Ring-Pruefung zuruecknimmt, kommt durch Wiederherstellen nicht zurueck; ein Block schon', async () => {
  const { s, owner, ids, before } = await ringSetup();
  assert.equal(before, 4); assert.ok(s.deck._cards.get(ids[0]).ring, 'ring on A');
  const afterRing = s.credit.available(owner);
  assert.equal(afterRing, 0, 'the ring took back what A and B earned');
  assert.equal(s.deck.decide(ids[0], 'block').status, 200);
  assert.equal(s.deck.decide(ids[0], 'restore').status, 200);
  assert.equal(s.credit.available(owner), 0, 'restore does not give back the ring revocation (was 2 before the fix)');
  // a block of a clean card still comes back on restore
  const t = await make(s, 'clean@example.org'), more = await accounts(s, 25, { prefix: 'cl', active: 3 });
  s.clock.t += 15 * DAY;
  for (const m of more) s.deck.count(await keyOf(s, m), t.cid, s.deck._cards.get(t.cid));
  const got = s.credit.available(t.owner);
  assert.ok(got > 0);
  s.deck.decide(t.cid, 'block'); assert.equal(s.credit.available(t.owner), 0);
  s.deck.decide(t.cid, 'restore'); assert.equal(s.credit.available(t.owner), got, 'block revocation is given back');
  // the reason is kept on disk
  s.credit.flush();
  const again = createCredit({ env: s.E, now: () => s.clock.t, log: () => {}, file: join(s.dir, 'credit.json') });
  again.unrevoke(ids[0]); again.unrevoke(ids[1]);
  assert.equal(again.available(owner), 0, 'ring revocation survives a restart');
});

test('Strikes: zwei vorlaeufige Sperren im Fenster = ein Strike, bestaetigte Sperre = Strike; gestuft Hinweis -> Pause -> Vorlage; Verfall nach DUELL_MOD_STRIKE_DAYS; Widerspruch und Freigabe nehmen ihn weg; Daumen sind keine Strikes', async () => {
  const s = setup(), v = await keyOf(s, 'victim@example.org'), w = await keyOf(s, 'w@example.org'), x = await keyOf(s, 'x@example.org');
  const C = (ch) => ch.repeat(22);
  s.mod.cardHidden(v, C('c'), { why: 'thumbs', down: 8, share: 0.7 });
  assert.equal(s.mod.strikes(v), 0, 'thumbs: no strike');
  // two holds inside 30 days: no strike by themselves (review #102), the account goes to a human on /duell/pruefen
  s.mod.cardHeld(w, C('e'), { why: 'reports', accounts: 3 });
  assert.equal(s.mod.strikes(w), 0, 'one hold: no strike');
  s.clock.t += 10 * DAY;
  s.mod.cardHeld(w, C('f'), { why: 'reports', accounts: 3 });
  assert.equal(s.mod.strikes(w), 0, 'two holds: still no strike, never automatic');
  assert.equal(s.mod._accounts.get(w).review.why, 'holds'); assert.deepEqual(s.mod._accounts.get(w).review.cards, [C('e'), C('f')]);
  assert.equal(s.mod.status(w).st, 'ok');
  s.mod.cardHeld(x, C('g'), { why: 'reports' });
  s.clock.t += 31 * DAY;
  s.mod.cardHeld(x, C('h'), { why: 'reports' });
  assert.equal(s.mod.strikes(x), 0, 'holds 31 days apart make no strike');
  // graded: the 2nd live strike flags the account for a human, who may pause (never automatic, review #102); the 3rd -> before
  // a human for a final block, not banned
  const g = await keyOf(s, 'g@example.org');
  s.mod.cardRemoved(g, C('i'), { by: 'human', ground: 'hate' });
  assert.equal(s.mod.strikes(g), 1); assert.equal(s.mod.status(g).st, 'ok');
  s.clock.t += DAY;
  s.mod.cardRemoved(g, C('j'), { by: 'human', ground: 'harm' });
  assert.equal(s.mod.status(g).st, 'ok', 'no automatic pause'); assert.equal(s.mod._accounts.get(g).review.why, 'pause-due');
  assert.equal(s.mod.decide(s.mod.midOf(g), 'pause', null, 'zwei bestaetigte Verstoesse').status, 200);
  assert.equal(s.mod.status(g).st, 'paused'); assert.equal(s.mod.canCreate(g).error, 'account-paused');
  const pause = s.mod.me(g).notices.find((n) => n.type === 'pause');
  assert.equal(pause.facts.by, 'human'); assert.equal(pause.automated.decided, false); assert.deepEqual(pause.redress, ['appeal', 'court']);
  s.clock.t += DAY;
  s.mod.cardRemoved(g, C('k'), { by: 'human', ground: 'harm' });
  assert.equal(s.mod._accounts.get(g).review.why, 'strikes'); assert.notEqual(s.mod.status(g).st, 'banned', 'final block only by a human');
  // a successful complaint takes its strike away
  const third = s.mod.me(g).notices.filter((n) => n.type === 'strike').at(-1);
  assert.equal(s.mod.appeal(g, third.nid, 'Die Karte war ein Zitat aus dem Unterricht.').status, 202);
  assert.equal(s.mod.decide(s.mod.midOf(g), 'lift', third.nid).status, 200);
  assert.equal(s.mod.strikes(g), 2);
  // strikes lapse: 30 days after the first two, nothing is left and the pause is over
  s.clock.t += 31 * DAY;
  assert.equal(s.mod.strikes(g), 0); assert.equal(s.mod.status(g).st, 'ok');
  // a released hold counts no more, and its strike goes
  s.mod.cardReleased(w, C('f'));
  assert.equal(s.mod.strikes(w), 0);
});

test('Review W4 NIT: Ring-Verdacht (flag) -> Aufnehmen erzwingt KI-Nachpruefung, Deck-Guthaben erst nach Ende des Verdachts; Publikums-Hinweis', async () => {
  const seen = [];
  const { s, owner, ids, keys } = await ringSetup(async (d) => { seen.push(d.t); return { risk: 0, cats: [] }; });
  const C = s.deck._cards, a = C.get(ids[0]);
  assert.equal(a.st, 'flag');
  const view = s.deck.reviewView().queue.find((r) => r.cid === ids[0]);
  assert.ok(view.pool && view.pool.share >= 0.6 && view.pool.same === true, 'audience overlap shown to the reviewer');
  let r = s.deck.decide(ids[0], 'admit');
  assert.equal(r.status, 202); assert.equal(r.body.st, 'candidate'); assert.equal(s.deck._deck().list.length, 0, 'not in the deck yet');
  await s.deck.tick();
  assert.ok(seen.includes('Alpha'), 'AI re-check ran'); assert.equal(a.st, 'review');
  const bal = s.credit.available(owner);
  r = s.deck.decide(ids[0], 'admit');
  assert.equal(r.status, 200); assert.equal(a.st, 'deck');
  assert.equal(s.credit.available(owner), bal, 'no deck credit while the ring suspicion stands');
  assert.equal(a.ms.deckHeld, 1);
  // the suspicion ends: many other accounts use only A -> share below 60 % -> the held deck credit is booked
  const fans = await accounts(s, 6, { prefix: 'nurA', active: 3 });
  for (const m of fans) s.deck.count(await keyOf(s, m), ids[0], a);
  await s.deck.tick();
  assert.equal(a.ring, undefined);
  assert.equal(s.credit.available(owner), bal + 3, 'deck +3 once the suspicion is gone');
  assert.equal(a.ms.deckHeld, undefined);
  assert.ok(keys.length === 2);
});

test('Review W4 NIT: ohne DUELL_DECK_SALT oder DUELL_DECK_SIGN_KEY startet ein Deck mit Datei nicht (fail closed)', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'duell-deck-strict-')), file = join(dir, 'deck.json');
  const ed = generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const x = generateKeyPairSync('x25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const base = { DUELL_SEAL_SECRET: 'seal', DUELL_DECK_TICK_MS: '0' }, log = () => {};
  const mk = (env, f = file) => createDeck({ env: { ...base, ...env }, shared: null, who: async () => null, log, file: f });
  assert.throws(() => mk({ DUELL_DECK_SIGN_KEY: ed }), /DUELL_DECK_SALT missing/);
  assert.throws(() => mk({ DUELL_DECK_SALT: 's' }), /DUELL_DECK_SIGN_KEY missing/);
  assert.throws(() => mk({ DUELL_DECK_SALT: 's', DUELL_DECK_SIGN_KEY: 'nonsense' }), /PKCS8/);
  assert.throws(() => mk({ DUELL_DECK_SALT: 's', DUELL_DECK_SIGN_KEY: x }), /no Ed25519/);
  const ok = mk({ DUELL_DECK_SALT: 's', DUELL_DECK_SIGN_KEY: ed }); ok.stop();
  mk({ DUELL_DECK_EPHEMERAL: '1' }).stop();
  mk({}, '').stop();   // in memory only: logs, starts
});

test('Review W4 Nachpruefung: Ring nimmt nur das Guthaben der einen Karte, alte Block-Ruecknahmen ohne Grund kommen zurueck', async () => {
  const s = setup(), c = s.credit, key = 'aKeyForTests1234', root = 'R'.repeat(22), vari = 'V'.repeat(22);
  c.award(key, vari, 'use', root);
  assert.equal(c.available(key), 2);
  assert.equal(c.revoke(root, 'ring'), 0, 'a ring on the root leaves the variant\'s own credit');
  assert.equal(c.revoke(root, 'block'), 2, 'a block of the root takes the cluster');
  assert.equal(c.unrevoke(root), 2);
  // an entry revoked before reasons existed (no xw) counts as a block
  c.revoke(root, 'block'); delete c._book.get(key).e[0].xw;
  assert.equal(c.unrevoke(root), 2);
});

test('Widerruf geteilter freier Karten: Status no-store, Meldungen verschiedener Konten sperren vorlaeufig, anonyme nicht, Daumen nie; Admin gibt frei oder sperrt mit Regelgrund; nie uebernommene Karten auch', async () => {
  const s = setup(), h = await serve(s);
  const status = async (cid) => { const r = await fetch(h.base + '/api/duell/deck/status?c=' + cid); return { st: (await r.json()).st, cache: r.headers.get('cache-control'), cors: r.headers.get('access-control-allow-origin') }; };
  const report = (card, mail) => h.post('/api/duell/report', { reason: 'harm', kind: 'karte', seal: card.ki.s, optionHash: card.ki.h }, mail);
  const settle = () => new Promise((r) => setTimeout(r, 30));
  try {
    // reporters who count are eligible like a thumb (old enough, active); fresh second accounts never hold a card (review #102)
    const [r1, r2, r3] = await accounts(s, 3, { prefix: 'rep', active: 3 });
    const card = await make(s, 'maker@example.org', doc('Geteilte Karte mit Wolken und Sternen'));
    let st = await status(card.cid);
    assert.deepEqual(st, { st: 'ok', cache: 'no-store', cors: '*' });
    assert.equal((await fetch(h.base + '/api/duell/deck/status?c=kurz')).status, 400);
    // thumbs alone never block, however many
    const users = await accounts(s, 30, { prefix: 'w' });
    for (const m of users) await thumb(h, s, m, card.ki, -1);
    assert.equal((await status(card.cid)).st, 'ok', 'thumbs sort and hide, they never revoke');
    assert.equal(s.mod.strikes(card.owner), 0);
    // anonymous reports: to the reviewer, no hold
    for (let i = 0; i < 5; i++) assert.equal((await report(card)).status, 202);
    await settle();
    assert.equal((await status(card.cid)).st, 'ok');
    // two accounts, and the creator itself: no hold; the third distinct account: held, blocked for every link
    await report(card, r1); await report(card, r1); await report(card, 'maker@example.org'); await report(card, r2);
    await settle();
    assert.equal((await status(card.cid)).st, 'ok', 'two distinct accounts are not enough');
    await report(card, r3); await settle();
    assert.equal(s.deck._cards.get(card.cid).st, 'held');
    assert.equal((await status(card.cid)).st, 'blocked');
    const held = s.mod.me(card.owner).notices.find((n) => n.type === 'card-held');
    assert.equal(held.facts.why, 'reports'); assert.equal(held.facts.accounts, 3); assert.equal(held.facts.provisional, true);
    // the human finds nothing: released, no strike
    assert.equal((await h.post('/api/duell/deck/review/' + card.cid, { action: 'release' }, null, h.adm)).status, 200);
    assert.equal((await status(card.cid)).st, 'ok'); assert.equal(s.mod.strikes(card.owner), 0);
    // the window: reports older than DUELL_DECK_REPORT_DAYS fall out
    await report(card, 'r4@example.org'); await report(card, 'r5@example.org'); await settle();
    s.clock.t += 8 * DAY;
    await report(card, 'r6@example.org'); await settle();
    assert.equal((await status(card.cid)).st, 'ok', 'old reports fall out of the window');
    // at any time: the human blocks with a rule ground -> blocked for good, a strike for the creator
    assert.equal((await h.post('/api/duell/deck/review/' + card.cid, { action: 'block', ground: 'private' })).status, 401);
    assert.equal((await h.post('/api/duell/deck/review/' + card.cid, { action: 'block', ground: 'private' }, null, h.adm)).status, 200);
    assert.equal((await status(card.cid)).st, 'blocked');
    const sn = s.mod.me(card.owner).notices.find((n) => n.type === 'strike');
    assert.equal(sn.facts.ground, 'private'); assert.equal(s.mod.strikes(card.owner), 1);
    // a successful complaint against the block: the card opens again, the strike is gone
    const rm = s.mod.me(card.owner).notices.find((n) => n.type === 'card-removed');
    assert.equal(s.mod.appeal(card.owner, rm.nid, 'Das ist eine Wetterkarte.').status, 202);
    assert.equal(s.mod.decide(s.mod.midOf(card.owner), 'lift', rm.nid).status, 200);
    assert.equal((await status(card.cid)).st, 'ok'); assert.equal(s.mod.strikes(card.owner), 0);
    // a sealed card nobody registered: reports still hold it, without an owner and without strikes
    const owner = await keyOf(s, 'never@example.org');
    const d = doc('Nie uebernommene Karte mit Regenbogen'), { ki, cid } = sealKarte(s.d.shared.sealer, SALT, d, owner, s.clock.t);
    for (const m of [r1, r2, r3]) await report({ ki }, m);   // eligible reporters (review #102)
    await settle();
    assert.equal((await status(cid)).st, 'blocked');
    assert.equal(s.mod.strikes(owner), 0);
  } finally { await h.close(); }
});

test('Speicherdauer: Melde-Kennung eines Kontos hoechstens DUELL_DECK_REPORT_DAYS, Strikes und vorlaeufige Sperren hoechstens DUELL_MOD_STRIKE_DAYS (Datenschutzseite)', async () => {
  const s = setup(), h = await serve(s);
  try {
    const [k1] = await accounts(s, 1, { prefix: 'keep-rep', active: 3 });
    const card = await make(s, 'keep@example.org', doc('Karte fuer die Speicherdauer mit Monden'));
    await h.post('/api/duell/report', { reason: 'harm', kind: 'karte', seal: card.ki.s, optionHash: card.ki.h }, k1);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(Object.keys(s.deck._cards.get(card.cid).rA).length, 1);
    s.clock.t += 8 * DAY; await s.deck.tick();
    assert.equal(Object.keys(s.deck._cards.get(card.cid).rA).length, 0, 'gone after 7 days');
    const k = card.owner;
    s.mod.cardHeld(k, 'q'.repeat(22), { why: 'reports' }); s.mod.cardHeld(k, 'r'.repeat(22), { why: 'reports' });
    assert.equal(s.mod.strikes(k), 0, 'holds are no strike'); assert.equal(s.mod._accounts.get(k).holds.length, 2);
    s.clock.t += 31 * DAY; await s.deck.tick();
    assert.equal(s.mod._accounts.get(k).strikes.length, 0); assert.equal(s.mod._accounts.get(k).holds.length, 0, 'gone after 30 days');
  } finally { await h.close(); }
});

test('Review #102: frische Zweitkonten halten keine Karte (Brigading), ihre Meldungen gehen nur an den Pruefer; geeignete Konten wie beim Daumen', async () => {
  const s = setup(), h = await serve(s);
  const report = (card, mail) => h.post('/api/duell/report', { reason: 'harm', kind: 'karte', seal: card.ki.s, optionHash: card.ki.h }, mail);
  try {
    const card = await make(s, 'target@example.org', doc('Karte, die jemand wegmelden will'));
    for (const m of ['neu1@example.org', 'neu2@example.org', 'neu3@example.org', 'neu4@example.org']) await report(card, m);
    await new Promise((r) => setTimeout(r, 30));
    const c = s.deck._cards.get(card.cid);
    assert.notEqual(c.st, 'held', 'four fresh accounts: no hold'); assert.equal(Object.keys(c.rA || {}).length, 0, 'none of them counts');
    assert.ok(c.rep >= 4, 'every report still reaches the reviewer'); assert.equal(s.mod.strikes(card.owner), 0);
  } finally { await h.close(); }
});

test('Review #102: kaputte deck.json, mod.json, credit.json werden gesichert und nie ueberschrieben; solange gibt es keinen Status, keine neue Karte, kein Guthaben (fail-closed)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duell-deck-corrupt-'));
  for (const f of ['deck.json', 'mod.json', 'credit.json']) writeF(join(dir, f), '{"v":1,"cards":{ kaputt');
  const s = setup({ dir }), h = await serve(s);
  try {
    assert.equal(s.deck.broken(), true); assert.equal(s.mod.broken(), true); assert.equal(s.credit.broken(), true);
    for (const f of ['deck.json', 'mod.json', 'credit.json']) assert.ok(readdirSync(dir).some((x) => x.startsWith(f + '.corrupt-')), 'kept aside: ' + f);
    const r = await fetch(h.base + '/api/duell/deck/status?c=' + 'a'.repeat(22));
    assert.equal(r.status, 503, 'no status that would let a card be shown');
    assert.equal((await fetch(h.base + '/api/duell/deck')).status, 503);
    const k = await keyOf(s, 'someone@example.org');
    assert.deepEqual(s.mod.canCreate(k), { ok: false, error: 'mod-unavailable' }); assert.equal(s.mod.inGood(k), false);
    assert.equal(s.credit.available(k), 0); assert.equal(s.credit.spend(k, 1), false);
    s.mod.flag(k, 'test'); s.mod.flush && s.mod.flush(); s.deck.flush && s.deck.flush(); s.credit.flush();
    for (const f of ['deck.json', 'mod.json', 'credit.json']) assert.equal(readF(join(dir, f), 'utf8'), '{"v":1,"cards":{ kaputt', 'never overwritten: ' + f);
  } finally { await h.close(); }
});

test('Review #102: Beschwerde- und Notiztexte werden nach der Widerspruchsfrist und der Entscheidung geloescht, der Hinweis bleibt, solange der Schritt laeuft', async () => {
  const s = setup(), k = await keyOf(s, 'texte@example.org'), C = (ch) => ch.repeat(22);
  s.mod.cardRemoved(k, C('t'), { by: 'human', ground: 'harm', note: 'interne Notiz des Pruefers' });
  const rm = s.mod.me(k).notices.find((n) => n.type === 'card-removed');
  assert.equal(s.mod.appeal(k, rm.nid, 'Das war ein Zitat aus dem Unterricht.').status, 202);
  assert.equal(s.mod.decide(s.mod.midOf(k), 'uphold', rm.nid, 'bleibt so').status, 200);
  const days = s.mod.cfg.appealDays;
  s.clock.t += (days - 1) * DAY; s.mod.status(k);
  assert.ok(s.mod._accounts.get(k).n.some((n) => n.appeal && n.appeal.text), 'inside the complaint period the text stays');
  s.clock.t += 2 * DAY; s.mod.status(k);
  const left = s.mod._accounts.get(k).n;
  assert.ok(!left.some((n) => (n.appeal && (n.appeal.text || n.appeal.note)) || (n.facts && n.facts.note)), 'texts gone after the period and the decision');
  // an open complaint keeps its text until a human decides
  const k2 = await keyOf(s, 'offen@example.org');
  s.mod.cardRemoved(k2, C('u'), { by: 'human', ground: 'harm' });
  const n2 = s.mod.me(k2).notices.find((n) => n.type === 'card-removed');
  s.mod.appeal(k2, n2.nid, 'Bitte noch einmal ansehen.');
  s.clock.t += (days + 5) * DAY; s.mod.status(k2);
  assert.ok(s.mod._accounts.get(k2).n.some((n) => n.appeal && n.appeal.text), 'open complaint: text stays');
});

// ---- Umbau Teil 2 (09.11.): "Entfernen + Strike" fuer geteilte Karten ausserhalb des Decks -----------------------------
// the app's card link (apps/duell-web daily.js docUrl): c= base64url of { v: 1, d: doc }
const fragOf = (d) => 'c=' + Buffer.from(JSON.stringify({ v: 1, d })).toString('base64url');
const bareOf = (d) => 'c=' + Buffer.from(JSON.stringify(d)).toString('base64url');
async function shortStack(env = {}) {
  let short = null;
  const s = setup({ env, blockLink: (id) => short.block(id) });
  short = testShortLinks({ env: { SHORT_DATA_DIR: join(s.dir, 'short') }, now: () => s.clock.t, log: () => {}, free: () => s.deck });
  const h = await serve(s);
  const srv = http.createServer(async (q, r) => { const url = new URL(q.url, 'http://x'); if (!(await short.route(q, r, url))) r.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const sb = `http://127.0.0.1:${srv.address().port}`;
  return { s, h, short, sb, close: async () => { await h.close(); await new Promise((r) => srv.close(r)); } };
}

test('Umbau Teil 2: teilen -> Admin entfernt mit Pflichtgrund -> Link, Seite, Bild und Status sofort gesperrt ("nicht mehr verfuegbar") -> Strike gezaehlt, Begruendung und Widerspruch beim Ersteller', async () => {
  const { s, h, short, sb, close } = await shortStack();
  try {
    const one = await make(s, 'teilt@example.org');
    assert.equal(freeCidOf(fragOf(one.doc)), one.cid, 'the card id comes from the link itself');
    const c = short.create({ f: fragOf(one.doc), k: 'card' });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const id = c.body.id;
    assert.equal((await fetch(sb + '/api/s/' + id)).status, 200);
    assert.equal((await fetch(sb + '/s/' + id)).status, 200);
    assert.deepEqual(await (await fetch(h.base + '/api/duell/deck/status?c=' + one.cid)).json(), { c: one.cid, st: 'ok' });
    // the reviewer sees it as shared outside the deck
    let rv = await (await fetch(h.base + '/api/duell/deck/review', { headers: h.adm })).json();
    const row = rv.shared.find((x) => x.cid === one.cid);
    assert.ok(row, 'listed as shared'); assert.equal(row.links, 1); assert.equal(row.st, 'private');
    // the reason is required: no ground, no words, too short -> nothing happens
    for (const b of [{ action: 'remove' }, { action: 'remove', ground: 'hate' }, { action: 'remove', ground: 'hate', note: 'ab' }, { action: 'remove', ground: 'nope', note: 'Beleidigt eine Mitschuelerin' }]) {
      const r = await h.post('/api/duell/deck/review/' + one.cid, b, null, h.adm);
      assert.equal(r.status, 400, JSON.stringify(b)); assert.equal((await r.json()).error, 'reason-required');
    }
    assert.equal((await fetch(sb + '/api/s/' + id)).status, 200, 'still open after the refused tries');
    assert.equal((await h.post('/api/duell/deck/review/' + one.cid, { action: 'remove', ground: 'hate', note: 'Beleidigt eine Mitschuelerin' })).status, 401, 'admin only');
    const r = await h.post('/api/duell/deck/review/' + one.cid, { action: 'remove', ground: 'hate', note: 'Beleidigt eine Mitschuelerin' }, null, h.adm);
    assert.equal(r.status, 200); const rb = await r.json();
    assert.equal(rb.st, 'removed'); assert.equal(rb.links, 1); assert.equal(rb.strikes, 1);
    // at once: the short link, its page, its picture and the status
    const api = await fetch(sb + '/api/s/' + id);
    assert.equal(api.status, 410); assert.equal((await api.json()).error, 'blocked');
    const pg = await fetch(sb + '/s/' + id);
    assert.equal(pg.status, 410); assert.match(await pg.text(), /gesperrt|nicht mehr verfügbar/);
    assert.equal((await fetch(sb + '/s/img/' + id + '.jpg')).status, 404);
    assert.deepEqual(await (await fetch(h.base + '/api/duell/deck/status?c=' + one.cid)).json(), { c: one.cid, st: 'blocked' });
    assert.ok(!JSON.stringify(short._state.links.get(id)).includes(one.doc.t), 'the link content left the disk');
    // a new short link for the removed card is refused; a long link of it asks status and gets "blocked"
    assert.equal(short.create({ f: fragOf(one.doc), k: 'card' }).status, 409);
    // strike counted, notice with ground, words and appeal for the creator; the account is not paused by it
    const me = s.mod.me(one.owner);
    const rm = me.notices.find((n) => n.type === 'card-removed'), st = me.notices.find((n) => n.type === 'strike');
    assert.equal(rm.cid, one.cid); assert.equal(rm.facts.ground, 'hate'); assert.equal(rm.facts.note, 'Beleidigt eine Mitschuelerin');
    assert.ok(rm.redress.includes('appeal') && rm.appealUntil, 'appeal possible (DSA Art. 17/20)');
    assert.equal(st.automated.decided, false); assert.equal(s.mod.strikes(one.owner), 1); assert.equal(me.st, 'ok', 'no automatic pause or block');
    rv = await (await fetch(h.base + '/api/duell/deck/review', { headers: h.adm })).json();
    assert.ok(!rv.shared.some((x) => x.cid === one.cid), 'out of the shared list');
    // a deck card is not removed this way (its own block path stays)
    assert.equal((await h.post('/api/duell/deck/review/' + one.cid, { action: 'remove', ground: 'hate', note: 'noch einmal' }, null, h.adm)).status, 409);
  } finally { await close(); }
});

test('Umbau Teil 2: fail-closed - eine unbekannte Karte ist nie "ok", ohne lesbares Deck oeffnet kein Link einer freien Karte; Strikes verfallen, Stufen bleiben beim Menschen', async () => {
  const { s, h, short, sb, close } = await shortStack();
  try {
    // never registered: status "unknown", no short link
    const d = doc('Nie uebernommen');
    const { ki, cid } = sealKarte(s.d.shared.sealer, SALT, d, await keyOf(s, 'x@example.org'), s.clock.t);
    assert.deepEqual(await (await fetch(h.base + '/api/duell/deck/status?c=' + cid)).json(), { c: cid, st: 'unknown' });
    const no = short.create({ f: fragOf({ ...d, ki }), k: 'card' });
    assert.equal(no.status, 409); assert.equal(no.body.error, 'card-unknown');
    // other links are untouched by the deck
    assert.equal(short.create({ f: 'c=' + Buffer.from(JSON.stringify({ t: 'Idee' })).toString('base64url'), k: 'idea' }).status, 201);
    // a registered, shared card: deck unreadable (or gone) -> 503 everywhere, nothing of the card is served
    const one = await make(s, 'zwei@example.org');
    const id = short.create({ f: fragOf(one.doc), k: 'card' }).body.id;
    const real = s.deck.linkState;
    s.deck.linkState = () => { throw new Error('disk'); };
    assert.equal((await fetch(sb + '/api/s/' + id)).status, 503);
    assert.equal((await fetch(sb + '/s/' + id)).status, 503);
    s.deck.linkState = () => 'unavailable';
    assert.equal((await fetch(sb + '/api/s/' + id)).status, 503);
    s.deck.linkState = real;
    assert.equal((await fetch(sb + '/api/s/' + id)).status, 200);
    const lone = testShortLinks({ env: { SHORT_DATA_DIR: join(s.dir, 'short2') }, log: () => {} });   // no deck wired at all
    assert.equal(lone.create({ f: fragOf(one.doc), k: 'card' }).status, 503, 'a free card needs the deck to be checked');
    // two removals: two strikes (graded: a flag for a human, never an automatic pause); after strikeDays they lapse
    const two = await make(s, 'zwei@example.org');
    for (const c of [one, two]) assert.equal((await h.post('/api/duell/deck/review/' + c.cid, { action: 'remove', ground: 'harm', note: 'Mobbing gegen eine Person' }, null, h.adm)).status, 200);
    assert.equal(s.mod.strikes(one.owner), 2); assert.equal(s.mod.status(one.owner).st, 'ok');
    assert.ok(s.mod.queue().accounts.some((a) => a.review && a.review.why === 'pause-due'), 'a human decides about a pause');
    s.clock.t += s.mod.cfg.strikeDays * DAY + 1;
    assert.equal(s.mod.strikes(one.owner), 0, 'strikes lapse after the window');
  } finally { await close(); }
});

test('Umbau Teil 3: Pruefseite hat Deck-Test mit echter Karte zum Ausprobieren und den drei Knoepfen; Entfernen + Strike nur mit Begruendung', async () => {
  const s = setup(); const h = await serve(s);
  try {
    const res = await fetch(h.base + '/duell/pruefen'), html = await res.text();
    const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new Function(js), 'the page script parses');
    for (const t of ['Deck-Test', 'Ins Deck', 'Nicht ins Deck', 'Entfernen + Strike', 'Als echte Karte ausprobieren', 'Begruendung', 'Geteilt, ausserhalb des Decks']) assert.ok(html.includes(t), t);
    assert.match(js, /'\/duell#c='\+frag\(r\.doc\)/); assert.match(js, /rel='noopener noreferrer'/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/, 'the page itself is never framed');
  } finally { await h.close(); }
});

test('Review Umbau: Link-Sperre greift fuer jede Fragmentform (App-Link {v,d}, nackter Zustand, Remix fr); eine geliehene fr-ID oeffnet keinen gesperrten Inhalt; ohne Moderation nichts; Begruendung hoechstens 300 Zeichen; Entfernen sofort auf der Platte', async () => {
  const { s, h, short, sb, close } = await shortStack();
  try {
    const bad = await make(s, 'boese@example.org'), good = await make(s, 'gut@example.org');
    assert.deepEqual(freeIdsOf(fragOf(bad.doc)), [bad.cid]); assert.deepEqual(freeIdsOf(bareOf(bad.doc)), [bad.cid]);
    const ids = [fragOf(bad.doc), bareOf(bad.doc), fragOf({ t: 'Remix', x: 'neu', fr: bad.cid }), fragOf({ ...bad.doc, fr: good.cid })]
      .map((f) => { const r = short.create({ f, k: 'card' }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id; });
    assert.equal(s.deck._cards.get(bad.cid).sl.length, 4, 'every short link of the card is known');
    // reason over 300 characters: refused on the server too
    assert.equal((await h.post('/api/duell/deck/review/' + bad.cid, { action: 'remove', ground: 'hate', note: 'x'.repeat(301) }, null, h.adm)).status, 400);
    assert.equal((await h.post('/api/duell/deck/review/' + bad.cid, { action: 'remove', ground: 'hate', note: 'Hetze gegen eine Gruppe' }, null, h.adm)).status, 200);
    assert.equal(JSON.parse(readF(join(s.dir, 'deck.json'), 'utf8')).cards[bad.cid].st, 'removed', 'on disk at once, not after the 2 s timer');
    assert.ok(JSON.parse(readF(join(s.dir, 'mod.json'), 'utf8')), 'mod flushed');
    for (const id of ids) { const r = await fetch(sb + '/api/s/' + id); assert.equal(r.status, 410, id); }
    // a fresh link that borrows a good card's fr next to the removed card's seal stays blocked
    assert.equal(short.create({ f: fragOf({ ...bad.doc, fr: good.cid }), k: 'card' }).status, 409);
    assert.equal(short.create({ f: fragOf(good.doc), k: 'card' }).status, 201, 'the good card is not touched');
  } finally { await close(); }
  // no moderation wired: no link of a free card opens, no removal without strike and notice
  const s2 = setup(); const one = await make(s2, 'ohne@example.org');
  const deck2 = createDeck({ env: s2.E, shared: s2.d.shared, who: s2.ai.who, credit: s2.credit, now: () => s2.clock.t, log: () => {}, file: '' });
  assert.equal(deck2.linkState(one.cid), 'unavailable');
  assert.equal(s2.deck.linkState(one.cid), 'ok');
});

test('Review #110 Punkt 1: "Als echte Karte ausprobieren" oeffnet die Karte selbst - der Link geht durch parseRoute der vendorten App', async () => {
  const s = setup(); const h = await serve(s);
  try {
    const one = await make(s, 'test@example.org', doc('Wer zuerst den Stern fängt, gewinnt', { k: 'card', st: 'druck', col: ['#ffd400', '#ff3b1d'], by: [] }));
    const html = await (await fetch(h.base + '/duell/pruefen')).text();
    const src = html.match(/function frag\(doc\)\{[\s\S]*?\n/)[0];
    const frag = new Function(src + ';return frag')();
    const href = '/duell#c=' + frag(one.doc);
    const r = App.D.parseRoute(href.split('#')[1]);
    assert.ok(r && r.type === 'doc', 'a card, not the idea of the day: ' + JSON.stringify(r));
    assert.equal(r.doc.t, one.doc.t); assert.equal(r.doc.x, one.doc.x);
    assert.equal(r.doc.ki.k, 'karte'); assert.equal(r.doc.ki.h, one.doc.ki.h, 'the seal stays: the app asks the deck status for this card');
    assert.deepEqual(freeIdsOf(href.split('#')[1]), [one.cid], 'the server reads the same link as this card');
  } finally { await h.close(); }
});

// ---- Status-Gate mit Inhalts-Hash (fix/deck-status-hash): eine freigegebene id mit anderem Inhalt oeffnet nie -----------
test('Status-Gate: gateHash bindet den gezeigten Inhalt an die id; anderer Inhalt -> "changed", ohne d wie bisher; Route und Kurzlink', async () => {
  const { s, h, short, sb, close } = await shortStack();
  try {
    const one = await make(s, 'gate@example.org', { k: 'card', x: 'Du bringst Sonne in jeden Tag', st: 'herz', t: 'Sonnenblumen', col: ['#ffd400', '#ff3b1d'], by: [], sk: [{ e: '🌻', x: 0.1, y: 0.1, r: 0, z: 1 }] });
    const gh = gateHash(one.doc);
    assert.match(gh, /^[A-Za-z0-9_-]{43}$/);
    // nur Gezeigtes zaehlt: Positionen, Seed, Siegel und Spur aendern den Hash nicht, Text, Titel, Farben, Stil, Sticker schon
    assert.equal(gateHash({ ...one.doc, sk: [{ e: '🌻', x: 0.9, y: 0.8, r: 1, z: 2 }], seed: 7, ki: undefined, by: [{ n: 'x', w: ['text'] }] }), gh);
    for (const ch of [{ x: 'Anderer Text' }, { t: 'Anders' }, { col: ['#2b4bff', '#ffe600'] }, { st: 'neon' }, { sk: [{ e: '🎂' }] }, { k: 'photo' }]) assert.notEqual(gateHash({ ...one.doc, ...ch }), gh, JSON.stringify(ch));
    assert.equal(s.deck.linkState(one.cid), 'ok', 'ohne d: die id allein (alte App, Remix)');
    assert.equal(s.deck.linkState(one.cid, gh), 'ok');
    assert.equal(s.deck.linkState(one.cid, gateHash({ ...one.doc, x: 'Fremder Text' })), 'changed');
    for (const bad of ['', 'kurz', gh.slice(1) + '!', 42, {}]) assert.equal(s.deck.linkState(one.cid, bad), 'changed', String(bad));
    // Route: d in der Abfrage
    const st = async (q) => (await (await fetch(h.base + '/api/duell/deck/status?' + q)).json()).st;
    assert.equal(await st('c=' + one.cid + '&d=' + gh), 'ok');
    assert.equal(await st('c=' + one.cid + '&d=' + gateHash({ ...one.doc, t: 'Gefaelscht' })), 'changed');
    assert.equal(await st('c=' + one.cid + '&d='), 'changed', 'leeres d ist kein fehlendes d');
    assert.equal(await st('c=' + one.cid), 'ok');
    // gesperrt bleibt gesperrt, auch mit passendem d; unbekannt bleibt unbekannt
    const two = await make(s, 'gate@example.org', doc('Zweite Karte'));
    assert.equal((await h.post('/api/duell/deck/review/' + two.cid, { action: 'remove', ground: 'other', note: 'Test der Sperre' }, null, h.adm)).status, 200);
    assert.equal(s.deck.linkState(two.cid, gateHash(two.doc)), 'blocked');
    assert.equal(s.deck.linkState('A'.repeat(22), gh), 'unknown');
    // Kurzlink (alte App): eine Karte mit eigenem Siegel muss ihren eigenen Inhalt zeigen
    assert.deepEqual(freeChecksOf(fragOf(one.doc)), [[one.cid, gh]]);
    const ok = short.create({ f: fragOf(one.doc), k: 'card' });
    assert.equal(ok.status, 201);
    const forged = short.create({ f: fragOf({ ...one.doc, x: 'Gefaelschter Text' }), k: 'card' });
    assert.notEqual(forged.status, 201, 'gefaelschter Inhalt mit echter id bekommt keinen Kurzlink: ' + forged.status);
    // Remix (fr ohne eigenes Siegel): die id allein, wie bisher
    assert.deepEqual(freeChecksOf(fragOf({ k: 'card', x: 'Mein Remix', st: 'druck', col: ['#ffd400', '#ff3b1d'], by: [], fr: one.cid })), [[one.cid, undefined]]);
    void sb;
  } finally { await close(); }
});

test('Status-Gate: feste Vektoren (dieselben prueft die App, apps/mdi test/frei.test.js) und die Projektion je Art', () => {
  const v = gateView({ k: 'game', t: 'Tiefsee', col: ['#FFD400', '#ff3b1d'], g: { seed: 1, params: { gravity: 1 }, title: 'Tiefsee', emoji: '🐠', theme: 'ocean', route: [{ p: 'ruhig', d: {}, t: 'ocean', e: '🐟' }] } });
  assert.deepEqual(v, { k: 'game', t: 'Tiefsee', col: ['#ffd400', '#ff3b1d'], g: { title: 'Tiefsee', emoji: '🐠', theme: 'ocean', route: [['ruhig', 'ocean', '🐟']] } });
  assert.deepEqual(gateView({ k: 'lauf', t: 'Lauf', col: [], l: { m: 'endlos', w: 'wald', e: '🦊', o: '📦', c: '🪙', f: '🐦', p: { g: 1 } } }).l, ['endlos', 'wald', '🦊', '📦', '🪙', '🐦']);
  const b = { v: 'mdi-bau/1', mode: 'realtime', goal: 'Fang zehn Sterne' };
  assert.deepEqual(gateView({ k: 'bau', t: 'Sternfang', col: [], b }).b, b, 'Baukasten: die ganze Beschreibung');
  assert.notEqual(gateHash({ k: 'bau', t: 'S', col: [], b }), gateHash({ k: 'bau', t: 'S', col: [], b: { ...b, goal: 'Fang einen Stern' } }), 'eine geaenderte Regel aendert den Hash');
  assert.deepEqual(gateView({ k: 'turn', i: 'zug-termin', t: 'Grillen', s: 'Untertitel', col: ['#ffd400', '#ff3b1d'] }), { k: 'turn', t: 'Grillen', i: 'zug-termin', w: '', pk: null }, 'Faehigkeit: Farben und Untertitel zeigt keine zug-*-Karte');
  assert.equal(gateHash({ k: 'card', t: 'Sonnenblumen-Tag', x: 'Alles Gute! Du bringst Sonne in jeden Tag.', st: 'herz', col: ['#ffd400', '#ff3b1d'], sk: [{ e: '🌻' }, { e: '🎂' }, { e: '✨' }] }), 'qWCCWKwM4uDjfi6dd2XxVOGSfnB1cCOmbQODRO2urHo');
});

test('Status-Gate: Migration - vorhandene Deck-Eintraege ohne Hash bekommen ihn beim Laden aus dem gespeicherten Doc', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duell-deck-gate-'));
  const s = setup({ dir, env: { DUELL_DECK_SIGN_KEY: '' } });
  const one = await make(s, 'alt@example.org', { k: 'card', x: 'Alte Karte', st: 'druck', t: 'Alt', col: ['#ffd400', '#ff3b1d'], by: [], sk: [] });
  s.deck.flush();
  // so sah deck.json vor dieser Aenderung aus: Karten ohne gh
  const file = join(dir, 'deck.json'), j = JSON.parse(readF(file, 'utf8'));
  for (const c of Object.values(j.cards)) delete c.gh;
  writeF(file, JSON.stringify(j));
  const logs = [];
  const again = createDeck({ env: { ...s.E }, shared: s.d.shared, who: s.ai.who, credit: s.credit, mod: s.mod, now: () => s.clock.t, log: (o) => logs.push(o), file });
  assert.ok(logs.some((o) => o.event === 'duell-deck-gate-hash-migrated' && o.cards >= 1), JSON.stringify(logs));
  assert.equal(again.linkState(one.cid, gateHash(one.doc)), 'ok');
  assert.equal(again.linkState(one.cid, gateHash({ ...one.doc, x: 'anders' })), 'changed');
  again.flush();
  const after = JSON.parse(readF(file, 'utf8'));
  assert.equal(after.cards[one.cid].gh, gateHash(one.doc), 'der Hash steht danach in der Datei');
});

test('Security-Review H1: ein Siegel der freien Karte ohne gueltigen Hash ist nie pruefbar - kein Kurzlink, Status nie ok', async () => {
  const { s, short, close } = await shortStack();
  try {
    const one = await make(s, 'h1@example.org', { k: 'card', x: 'Echte Karte', st: 'druck', t: 'Echt', col: ['#ffd400', '#ff3b1d'], by: [], sk: [] });
    for (const ki of [{ k: 'karte', s: 'AAAAAAAAAAAA' }, { k: 'karte', s: one.ki.s, h: 'kurz' }, { k: 'karte', s: one.ki.s, h: one.ki.h + 'x' }]) {
      const f = fragOf({ k: 'card', x: 'Schick 50 EUR an ...', st: 'druck', t: 'Gewinn', col: ['#ffd400', '#ff3b1d'], by: [], ki });
      assert.deepEqual(freeChecksOf(f), [['', undefined]], JSON.stringify(ki));
      const r = short.create({ f, k: 'card' });
      assert.notEqual(r.status, 201, 'kein Kurzlink fuer ein ungueltiges Siegel: ' + JSON.stringify(ki));
    }
    assert.equal(s.deck.linkState(''), 'unknown'); assert.equal(s.deck.linkState(null), 'unknown');
    assert.equal(short.create({ f: fragOf(one.doc), k: 'card' }).status, 201, 'das echte Siegel geht weiter');
  } finally { await close(); }
});

test('Security-Review M6: feste Pfade mit Body fuer die App-Bruecke - POST /api/duell/deck/status, POST /api/s/get, POST /api/s/delete', async () => {
  const { s, h, short, sb, close } = await shortStack();
  try {
    const one = await make(s, 'm6@example.org', { k: 'card', x: 'Karte fuer die App', st: 'druck', t: 'App', col: ['#ffd400', '#ff3b1d'], by: [], sk: [] });
    const gh = gateHash(one.doc), J = { 'Content-Type': 'application/json' };
    const st = async (b) => (await (await fetch(h.base + '/api/duell/deck/status', { method: 'POST', headers: J, body: JSON.stringify(b) })).json());
    assert.deepEqual(await st({ c: one.cid, d: gh }), { c: one.cid, st: 'ok' }, 'wie GET ?c=&d=');
    assert.equal((await st({ c: one.cid, d: gateHash({ ...one.doc, x: 'fremd' }) })).st, 'changed');
    assert.equal((await st({ c: one.cid, d: '' })).st, 'changed', 'leeres d ist kein fehlendes d');
    assert.equal((await st({ c: one.cid })).st, 'ok');
    assert.equal((await fetch(h.base + '/api/duell/deck/status', { method: 'POST', headers: J, body: JSON.stringify({ c: 'kaputt' }) })).status, 400);
    const made = short.create({ f: fragOf(one.doc), k: 'card' });
    assert.equal(made.status, 201);
    const { id, token } = made.body;
    const get = await fetch(sb + '/api/s/get', { method: 'POST', headers: J, body: JSON.stringify({ id }) });
    assert.equal(get.status, 200); assert.equal((await get.json()).f, fragOf(one.doc));
    assert.equal((await fetch(sb + '/api/s/delete', { method: 'POST', headers: J, body: JSON.stringify({ id, token: 'falsch' }) })).status, 403);
    assert.equal((await fetch(sb + '/api/s/delete', { method: 'POST', headers: J, body: JSON.stringify({ id, token }) })).status, 204);
    assert.equal((await fetch(sb + '/api/s/get', { method: 'POST', headers: J, body: JSON.stringify({ id }) })).status, 410);
  } finally { await close(); }
});
