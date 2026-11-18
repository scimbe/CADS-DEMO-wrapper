// Freie Karte 2, P3/P4 (lib/duell-fk2-bau.mjs): the internal build queue (token, never through the tunnel), leases, the
// checked result (contract, S1, module by sha256), 1 credit only on success, a failed repair keeps the old version, no game
// says why, "Karte fertig" by push and mail only with opt-in (also for a partial result, honest text, link ?go=fertig).
// Together with lib/duell-klaerung.mjs as in server.mjs. No network: worker, credit, push and mail are doubles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createKlaerung } from '../lib/duell-klaerung.mjs';
import { createBau, MAIL_TEXT, KARTE_KINDS, CODE_MAX, ausNetz, GRUND_SATZ } from '../lib/duell-fk2-bau.mjs';
import { KARTE_KINDS as PUSH_KARTE } from '../lib/duell-push.mjs';
import { HINWEISE as K_HINWEISE, BAU_GRUENDE as K_GRUENDE } from '../lib/vendor/mdi/features/frei/klaerung.js';

const P = { account: true, acct: 'aKonto12345', mail: 'lea@example.org' };
const TOKEN = 'bau-token-1234567890abcdef';
const MARK = 'M'.repeat(22);
const OK_MOD = { json: { risk: 0, cats: [], drink: 'none' } };
const FRAGEN = { ok: true, verstehe: 'ein Spiel. Boote kommen.', fragen: [{ frage: 'Wer bist du im Spiel?', hinweis: '', kacheln: [{ label: 'Ein Segelboot', sub: '', emoji: '⛵' }, { label: 'Eine Badeente', sub: '', emoji: '🦆' }] }] };
const LISTE = { ok: true, titel: 'Segelboot gegen Piraten', verstehe: 'Ein Spiel mit Wasserbomben.', nicht: [], punkte: [
  { text: 'Du steuerst ein Segelboot unten am Rand.', pruefung: 'Links bewegt das Boot nach links.' },
  { text: 'Wasserbomben lassen Piratenboote kentern.', pruefung: 'Ein Treffer gibt Punkte.' },
  { text: 'Mit jeder Runde etwas schneller.', pruefung: 'Runde 2 ist schneller.' }] };
const CODE = 'export default { title: "Boot" };\n', SHA = createHash('sha256').update(CODE).digest('hex');

function fakeLlm() {
  return { async generate(req) { if (req.name === 'check') return /Messer/.test(req.user) ? { json: { risk: 3, cats: ['weapons'], drink: 'none' } } : OK_MOD; return { json: req.name === 'klaerung_fragen' ? FRAGEN : LISTE }; } };
}
function setup({ guthaben = 5, env = {}, mailOn = true, pushOn = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fk2-bau-'));
  writeFileSync(join(dir, 'token'), TOKEN + '\n');
  const d = createDuell({ env: {}, salt: 's', log: () => {}, llm: async () => '{}' });
  const spent = [];
  // the credit book as lib/duell-credit.mjs: spend raises the spent count, refund lowers it
  const credit = { available: () => guthaben - spent.reduce((a, x) => a + x[1], 0), spend: (k, n) => { if (credit.available() < n) return false; spent.push([k, n]); return true; },
    refund: (k, n) => { const i = spent.findIndex((x) => x[0] === k && x[1] === n); if (i < 0) return false; spent.splice(i, 1); return true; } };
  Object.assign(d.shared, { age16: () => true, mod: { canCreate: () => ({ ok: true }) }, credit });
  const k = createKlaerung({ env: { DUELL_KLAERUNG: 'on', DUELL_KLAERUNG_DIR: join(dir, 'auftraege') }, shared: d.shared, who: async () => P, llm: fakeLlm(), log: () => {} });
  const pushes = [], mails = [], logs = [];
  const push = { on: () => pushOn, notify: async (mark, kind, auftrag) => { pushes.push([mark, kind, auftrag]); return 'sent'; } };
  const mail = { on: () => mailOn, send: async (m) => { mails.push(m); return { ok: true }; } };
  let t = Date.parse('2026-11-18T10:00:00Z');
  const benv = { DUELL_BAU: 'on', DUELL_BAU_TOKEN_FILE: join(dir, 'token'), DUELL_SPIEL_ORIGIN: 'https://spiel-f29c55da.bunsenbrenner.org', DUELL_SPIEL_MODULE_DIR: join(dir, 'spiele'), DUELL_APP_URL: 'https://demos-34a13a96.bunsenbrenner.org/duell', DUELL_BAU_NETZ: '172.31.250.0/28', ...env };
  const bau = createBau({ env: benv, store: k.store, shared: d.shared, push, mail, now: () => t, log: (o) => logs.push(o) });
  k.useBau(bau);
  // the worker gets its answer at once; the notification runs on its own (review S4): erg() waits for both
  const erg = async (b) => { const r = await bau.ergebnis(b); await new Promise((ok) => setTimeout(ok, 5)); return r; };
  return { dir, k, bau, erg, spent, pushes, mails, logs, credit, benv, shared: d.shared, push, mail, tick: (ms) => { t += ms; } };
}
async function order(s) {
  const f = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten', lang: 'de' });
  await s.k.liste(P, { id: f.body.id, antworten: [{ art: 'kachel', kachel: 0 }] });
  const a = s.k.auftrag(P, { id: f.body.id });
  assert.equal(a.status, 202, JSON.stringify(a.body));
  return a.body.auftrag;
}
const punkte = (ids, fehlt = []) => ids.map((id) => ({ id, erfuellt: !fehlt.includes(id), notiz: fehlt.includes(id) ? 'Die Boote werden noch nicht schneller.' : '', geprueft: id === 'p3' ? 'gelesen' : 'gespielt' }));
const okBody = (job, fehlt = []) => ({ auftrag: job.auftrag.id, lease: job.lease, art: job.art, ok: true, titel: job.auftrag.titel, punkte: punkte(job.auftrag.punkte.map((p) => p.id), fehlt), spiel: { code: CODE, sha256: SHA }, plan: { typ: 'echtzeit', spielplan: 'x', punkte: [] }, ms: 1000, usd: 0.01 });

test('Auftrag: 1 Guthaben wird vorgemerkt (ohne Guthaben kein Auftrag), dann in der Warteschlange; Kanaele ehrlich', async () => {
  const arm = setup({ guthaben: 0 });
  const f = await arm.k.fragen(P, { satz: 'Space Invaders mit Segelbooten', lang: 'de' });
  await arm.k.liste(P, { id: f.body.id, antworten: [{ art: 'kachel', kachel: 0 }] });
  assert.deepEqual(arm.k.auftrag(P, { id: f.body.id }), { status: 402, body: { error: 'guthaben' } });
  const s = setup({ mailOn: false });
  const f2 = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten', lang: 'de' });
  await s.k.liste(P, { id: f2.body.id, antworten: [{ art: 'kachel', kachel: 0 }] });
  const a = s.k.auftrag(P, { id: f2.body.id });
  assert.deepEqual(a.body.kanaele, { push: true, mail: false }, 'mail off: not offered');
  assert.deepEqual(s.spent, [[P.acct, 1]], 'reserved at the order');
  const st0 = s.k.status(P, { auftrag: a.body.auftrag }).body;
  assert.equal(st0.status, 'baut'); assert.equal(st0.vorgemerkt, true); assert.equal(st0.abgebucht, false);
  assert.equal(s.k.optin(P, { auftrag: a.body.auftrag, push: false, mail: true }).status, 409, 'a channel that cannot deliver is refused');
  assert.deepEqual(s.bau._queue, [a.body.auftrag]);
});

test('Warteschlange intern: Token aus Datei, nur aus DUELL_BAU_NETZ, nur POST; Lease, Ablauf, zweiter Ablauf ehrlich "fehler"', async () => {
  const s = setup({ env: { DUELL_BAU_NETZ: '127.0.0.0/8' } });   // der Test-Listener ist 127.0.0.1: hier das Netz des Workers
  const id = await order(s);
  const srv = http.createServer(async (q, r) => { if (!(await s.bau.route(q, r, new URL(q.url, 'http://x')))) r.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/intern/fk2/`;
  const post = (p, body, h = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...h }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('holen', {}, { authorization: 'Bearer falsch-falsch-falsch-1' })).status, 401);
    assert.equal((await post('holen', {}, { authorization: '', 'x-real-ip': '172.31.250.5', 'x-forwarded-for': '172.31.250.5' })).status, 401, 'ohne Token abgelehnt, Kopfzeilen zaehlen nicht');
    assert.equal((await fetch(base + 'holen')).status, 405);
    const r = await post('holen', {});
    assert.equal(r.status, 200);
    const job = await r.json();
    assert.equal(job.art, 'neu'); assert.equal(job.auftrag.id, id);
    assert.deepEqual(Object.keys(job.auftrag).sort(), ['fragen', 'id', 'lang', 'nicht', 'punkte', 'satz', 'titel', 'verstehe'], 'no owner, no address, no opt-in');
    assert.deepEqual(job.auftrag.fragen, [{ frage: 'Wer bist du im Spiel?', antwort: 'Ein Segelboot' }]);
    assert.equal((await post('holen', {})).status, 204);
    assert.equal(s.k.status(P, { auftrag: id }).body.status, 'baut');
    // lease runs out: queued once more, the second time the build ends honestly
    s.tick(21 * 60000);
    const again = await (await post('holen', {})).json();
    assert.equal(again.auftrag.id, id); assert.notEqual(again.lease, job.lease);
    assert.equal((await post('ergebnis', okBody(job))).status, 409, 'the old lease is void');
    s.tick(21 * 60000);
    assert.equal((await post('holen', {})).status, 204);
    const st = s.k.status(P, { auftrag: id }).body;
    assert.equal(st.status, 'gescheitert'); assert.equal(st.grund, 'fehler'); assert.equal(st.abgebucht, false);
    assert.deepEqual(s.pushes, [], 'no opt-in, no push');
  } finally { srv.close(); }
  const off = createBau({ env: { DUELL_BAU: 'on' }, store: s.k.store, log: () => {} });
  assert.equal(off.on(), false, 'without token file, origin and module directory the build stays off');
});

test('Ergebnis: alles erfuellt -> Modul geschrieben, 1 Guthaben abgebucht, Push und Mail mit ehrlichem Text, Adresse danach geloescht', async () => {
  const s = setup();
  const id = await order(s);
  assert.equal(s.k.optin(P, { auftrag: id, push: true, mail: true, mark: MARK }).status, 200);
  const job = s.bau.holen().body;
  assert.deepEqual(await s.erg(okBody(job)), { status: 200, body: { ok: true } });
  const f = join(s.benv.DUELL_SPIEL_MODULE_DIR, SHA + '.js');
  assert.equal(readFileSync(f, 'utf8'), CODE);
  const st = s.k.status(P, { auftrag: id }).body;
  assert.equal(st.status, 'fertig'); assert.equal(st.abgebucht, true); assert.equal(st.ergebnis.fehlt, 0);
  assert.deepEqual(st.spiel, { rahmen: 'https://spiel-f29c55da.bunsenbrenner.org/frame.html', modul: `https://spiel-f29c55da.bunsenbrenner.org/m/${SHA}.js`, sha256: SHA });
  assert.deepEqual(st.ergebnis.punkte.map((p) => p.geprueft), ['gespielt', 'gespielt', 'gelesen']);
  assert.deepEqual(s.spent, [[P.acct, 1]], 'the reservation became the charge: still exactly one credit');
  assert.equal(st.vorgemerkt, false);
  assert.deepEqual(s.pushes, [[MARK, 'karte-fertig', id]]);
  assert.equal(s.mails.length, 1);
  assert.equal(s.mails[0].to, P.mail); assert.equal(s.mails[0].subject, 'Deine Karte ist fertig');
  assert.match(s.mails[0].text, /„Segelboot gegen Piraten“ ist fertig\. Alle 3 Punkte sind erfüllt\. 1 Guthaben ist abgebucht\./);
  assert.ok(s.mails[0].text.includes(`https://demos-34a13a96.bunsenbrenner.org/duell?go=fertig&auftrag=${id}`));
  assert.match(s.mails[0].text, /nur, weil du beim Bauen „E-Mail an dein Konto“ angehakt hast/);
  assert.ok(!/Angebot|Rabatt|jetzt kaufen|newsletter/i.test(s.mails[0].text), 'no advertising');
  assert.ok(!JSON.stringify(s.k.store.get(id)).includes(P.mail), 'settled: the address is gone');
  assert.equal(s.k.behalten(P, { auftrag: id }).body.error, 'nichts-fehlt', 'a full success needs no keeping');
});

test('Teilerfolg: nichts abgebucht, Benachrichtigung "fast fertig"; Nachbessern mit Text (moderiert) -> neuer Bau; scheitert er, bleibt die alte Version', async () => {
  const s = setup();
  const id = await order(s);
  s.k.optin(P, { auftrag: id, push: false, mail: true });
  const job = s.bau.holen().body;
  await s.erg(okBody(job, ['p3']));
  let st = s.k.status(P, { auftrag: id }).body;
  assert.equal(st.ergebnis.fehlt, 1); assert.equal(st.abgebucht, false); assert.equal(st.vorgemerkt, true); assert.deepEqual(s.spent, [[P.acct, 1]], 'still only reserved');
  assert.equal(s.mails[0].subject, 'Deine Karte ist fast fertig');
  assert.match(s.mails[0].text, /ist fast fertig – ein Punkt fehlt noch\. Abgebucht ist nichts\./);
  assert.ok(JSON.stringify(s.k.store.get(id)).includes(P.mail), 'a repair may still notify: the address stays until the card is settled');
  // own words are moderated; a refusal changes nothing
  assert.equal((await s.k.nachbessern(P, { auftrag: id, text: 'mit einem Messer' })).status, 422);
  assert.equal(s.k.store.get(id).nachbessert || 0, 0);
  assert.equal((await s.k.nachbessern(P, { auftrag: id, text: 'x'.repeat(201) })).status, 400);
  const nb = await s.k.nachbessern(P, { auftrag: id, text: 'Die Boote sollen schneller werden.' });
  assert.equal(nb.body.nachbessernLeft, 2);
  assert.equal(s.k.status(P, { auftrag: id }).body.status, 'nachbessern');
  const job2 = s.bau.holen().body;
  assert.equal(job2.art, 'nachbessern');
  assert.equal(job2.auftrag.nachbessern.code, CODE, 'the existing game goes in');
  assert.equal(job2.auftrag.nachbessern.kundentext, 'Die Boote sollen schneller werden.');
  assert.deepEqual(job2.auftrag.nachbessern.punkte.filter((p) => !p.erfuellt).map((p) => p.id), ['p3']);
  // the repair fails the check: the previous version stays, said honestly; the counter stays used
  await s.erg({ auftrag: id, lease: job2.lease, art: 'nachbessern', ok: false, grund: 'nicht_geschafft', alt: true, ms: 1, usd: 0 });
  st = s.k.status(P, { auftrag: id }).body;
  assert.equal(st.status, 'fertig'); assert.equal(st.hinweis, 'nachbessern_nicht_geschafft'); assert.equal(st.nachbessernLeft, 2); assert.equal(st.ergebnis.fehlt, 1);
  // keeping a partial result costs 1 credit
  const b = s.k.behalten(P, { auftrag: id });
  assert.deepEqual(b.body, { behalten: true, abgebucht: true, guthaben: 1 });
  assert.deepEqual(s.spent, [[P.acct, 1]], 'keeping books the reservation, no second credit');
  assert.ok(!JSON.stringify(s.k.store.get(id)).includes(P.mail), 'kept: the address is gone');
  // the reservation released after VORMERK_TAGE without a decision; keeping later needs credit again (402 without)
  const arm = setup({ guthaben: 1 });
  const id2 = await order(arm);
  const j = arm.bau.holen().body; await arm.erg(okBody(j, ['p2']));
  arm.tick(31 * 86400000);
  assert.equal(arm.bau.verfallen(), 1);
  assert.deepEqual(arm.spent, [], 'never decided: released');
  arm.credit.spend('jemand', 1);
  assert.deepEqual(arm.k.behalten(P, { auftrag: id2 }), { status: 402, body: { error: 'guthaben' } });
  assert.equal(arm.k.store.get(id2).behalten, undefined);
});

test('Ergebnis wird geprueft: falsche Punkte, Hash, Groesse, Technik-Text oder Gewaltwort -> keine Karte ("fehler"); kein Spiel sagt warum', async () => {
  const s = setup();
  const bad = [
    (b) => ({ ...b, punkte: b.punkte.slice(0, 2) }),
    (b) => ({ ...b, punkte: b.punkte.map((p) => ({ ...p, geprueft: 'geraten' })) }),
    (b) => ({ ...b, spiel: { code: CODE, sha256: 'f'.repeat(64) } }),
    (b) => ({ ...b, spiel: { code: 'x'.repeat(CODE_MAX + 1), sha256: createHash('sha256').update('x'.repeat(CODE_MAX + 1)).digest('hex') } }),
    (b) => ({ ...b, punkte: b.punkte.map((p, i) => (i ? p : { ...p, erfuellt: false, notiz: 'Der Pirat wird getötet und blutet.' })) }),
  ];
  for (const f of bad) {
    const id = await order(s);
    const job = s.bau.holen().body;
    assert.equal((await s.erg(f(okBody(job)))).status, 200);
    const st = s.k.status(P, { auftrag: id }).body;
    assert.equal(st.status, 'gescheitert'); assert.equal(st.grund, 'fehler');
  }
  assert.equal(s.spent.length, 0, 'no game: every reservation released');
  assert.equal(existsSync(join(s.benv.DUELL_SPIEL_MODULE_DIR, 'f'.repeat(64) + '.js')), false);
  const id = await order(s);
  const job = s.bau.holen().body;
  assert.equal((await s.erg({ auftrag: id, lease: job.lease, art: 'neu', ok: false, grund: 'irgendwas' })).status, 400);
  await s.erg({ auftrag: id, lease: job.lease, art: 'neu', ok: false, grund: 'kein_spiel', ms: 1, usd: 0 });
  assert.deepEqual([s.k.status(P, { auftrag: id }).body.status, s.k.status(P, { auftrag: id }).body.grund], ['gescheitert', 'kein_spiel']);
});

test('Neustart: wartende und laufende Bauten stehen wieder in der Warteschlange; Mailtexte fuer alle Arten, Push-Arten nur fuer den Server', async () => {
  const s = setup();
  const a = await order(s), b = await order(s);
  s.bau.holen();
  const again = createBau({ env: s.benv, store: s.k.store, shared: s.shared, log: () => {} });
  assert.deepEqual(again._queue.slice().sort(), [a, b].sort());
  for (const L of ['de', 'en']) for (const kind of KARTE_KINDS) assert.ok(MAIL_TEXT[L][kind].subject && MAIL_TEXT[L][kind].text({ titel: 'T', link: 'L', n: 3, fehlt: 1, kosten: 1 }).includes('L'), L + kind);
  assert.deepEqual(PUSH_KARTE, KARTE_KINDS);
});

test('Guthaben nebenlaeufig: zwei Auftraege mit 1 Guthaben -> einer; Behalten und Melden gleichzeitig buchen oder geben genau einmal frei', async () => {
  const s = setup({ guthaben: 1 });
  const fa = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten', lang: 'de' }), fb = await s.k.fragen(P, { satz: 'Snake mit Raupe', lang: 'de' });
  await s.k.liste(P, { id: fa.body.id, antworten: [{ art: 'kachel', kachel: 0 }] }); await s.k.liste(P, { id: fb.body.id, antworten: [{ art: 'kachel', kachel: 0 }] });
  const [a, b] = await Promise.all([Promise.resolve().then(() => s.k.auftrag(P, { id: fa.body.id })), Promise.resolve().then(() => s.k.auftrag(P, { id: fb.body.id }))]);
  assert.deepEqual([a.status, b.status].sort(), [202, 402]);
  assert.deepEqual(s.spent, [[P.acct, 1]]);
  assert.equal(s.k.auftrag(P, { id: fa.body.id }).status, 202, 'tapped twice: the same order, no second reservation');
  assert.deepEqual(s.spent, [[P.acct, 1]]);
  // report (slow moderation) and keep at once after three repairs: exactly one wins, the credit moves exactly once
  const t = setup({ guthaben: 1 });
  const id = await order(t);
  for (let i = 0; i < 4; i++) {
    const job = t.bau.holen().body;
    await t.erg(okBody(job, ['p3']));
    if (i < 3) assert.equal((await t.k.nachbessern(P, { auftrag: id })).status, 200);
  }
  const meld = t.k.melden(P, { auftrag: id, text: 'zu langsam' });
  const keep = t.k.behalten(P, { auftrag: id });
  const m = await meld;
  const o = t.k.store.get(id);
  assert.equal(keep.status, 200); assert.equal(m.status, 409, 'kept first: no report after keeping');
  assert.equal(o.kosten.stand, 'gebucht'); assert.deepEqual(t.spent, [[P.acct, 1]]);
  assert.equal(t.bau.freigeben(o, 'nochmal')(), false, 'a booked credit is never released'); assert.equal(t.bau.buchen(o), false, 'and never booked twice');
  // report alone: released exactly once, keeping afterwards stays free
  const u = setup({ guthaben: 1 });
  const id3 = await order(u);
  for (let i = 0; i < 4; i++) { const job = u.bau.holen().body; await u.erg(okBody(job, ['p3'])); if (i < 3) await u.k.nachbessern(P, { auftrag: id3 }); }
  const [m1, m2] = await Promise.all([u.k.melden(P, { auftrag: id3 }), u.k.melden(P, { auftrag: id3 })]);
  assert.deepEqual([m1.status, m2.status], [200, 200]);
  assert.deepEqual(u.spent, [], 'released once');
  assert.deepEqual(u.k.behalten(P, { auftrag: id3 }).body, { behalten: true, abgebucht: false, guthaben: 1 }, 'reported: the card is free');
  assert.deepEqual(u.spent, []);
  // deleting an order with a reservation gives the credit back
  const v = setup({ guthaben: 1 });
  await order(v);
  assert.equal(v.k.loeschen(P).status, 200);
  assert.deepEqual(v.spent, []);
});

test('Review S2: nach dem Verfall wird ein spaeterer Erfolg erneut vorgemerkt und gebucht; ohne Guthaben bleibt das Teilergebnis', async () => {
  for (const guthaben of [2, 1]) {
    const s = setup({ guthaben });
    const id = await order(s);
    await s.erg(okBody(s.bau.holen().body, ['p3']));
    s.tick(31 * 86400000); assert.equal(s.bau.verfallen(), 1); assert.deepEqual(s.spent, []);
    if (guthaben === 1) s.credit.spend('jemand', 1);   // the credit went elsewhere meanwhile
    assert.equal((await s.k.nachbessern(P, { auftrag: id })).status, 200);
    await s.erg(okBody(s.bau.holen().body));            // the repair meets every point
    const st = s.k.status(P, { auftrag: id }).body;
    if (guthaben === 2) {
      assert.equal(st.ergebnis.fehlt, 0); assert.equal(st.abgebucht, true); assert.deepEqual(s.spent, [[P.acct, 1]], 'reserved again and booked');
    } else {
      assert.equal(st.ergebnis.fehlt, 1, 'the previous partial result stays'); assert.equal(st.hinweis, 'guthaben_fehlt'); assert.equal(st.abgebucht, false);
      assert.deepEqual(s.spent, [['jemand', 1]]);
    }
  }
});

test('Review S3/S4: der Worker bekommt sofort 200; ein Loeschen waehrend des Sendens bleibt geloescht', async () => {
  const s = setup();
  const id = await order(s);
  s.k.optin(P, { auftrag: id, push: false, mail: true });
  let weiter;
  s.mail.send = (m) => { s.mails.push(m); return new Promise((ok) => { weiter = () => ok({ ok: true }); }); };   // a slow SMTP server
  const r = await s.bau.ergebnis(okBody(s.bau.holen().body));
  assert.equal(r.status, 200, 'answered before the mail is out');
  await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(s.mails.length, 1);
  assert.ok(!JSON.stringify(s.k.store.get(id)).includes(P.mail), 'settled: the address went before the send');
  assert.equal(s.k.loeschen(P).status, 200);
  weiter(); await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(s.k.store.get(id), null, 'the deletion stays');
});

test('Review S9: speichert der Store nicht, bewegt sich kein Guthaben (Melden, Behalten, Bauende)', async () => {
  const s = setup({ guthaben: 3 });
  const id = await order(s);
  for (let i = 0; i < 4; i++) { await s.erg(okBody(s.bau.holen().body, ['p3'])); if (i < 3) await s.k.nachbessern(P, { auftrag: id }); }
  const put = s.k.store.put;
  s.k.store.put = () => { throw Object.assign(new Error('voll'), { code: 'ENOSPC' }); };
  assert.equal((await s.k.melden(P, { auftrag: id })).status, 503);
  assert.deepEqual(s.spent, [[P.acct, 1]], 'report not stored: the reservation stays');
  // keeping after the reservation was released: the new spend goes back when it cannot be saved
  s.k.store.put = put;
  s.tick(31 * 86400000); s.bau.verfallen(); assert.deepEqual(s.spent, []);
  s.k.store.put = () => { throw Object.assign(new Error('voll'), { code: 'ENOSPC' }); };
  assert.equal(s.k.behalten(P, { auftrag: id }).status, 503);
  assert.deepEqual(s.spent, [], 'not kept: no credit taken');
  // a build that ends without a game and cannot be saved keeps its reservation
  s.k.store.put = put;
  const id2 = await order(s);
  const job = s.bau.holen().body;
  s.k.store.put = () => { throw Object.assign(new Error('voll'), { code: 'ENOSPC' }); };
  await s.erg({ auftrag: id2, lease: job.lease, art: 'neu', ok: false, grund: 'zeit', ms: 1, usd: 0 });
  assert.deepEqual(s.spent, [[P.acct, 1]]);
  s.k.store.put = put;
});

test('Review S5 und Nit 14: DUELL_IP_HEADER spielt keine Rolle, ohne Token bleibt der Bau aus; Zahlen des Workers geprueft; Module ohne Auftrag werden entfernt', async () => {
  const s = setup();
  // Produktion: DUELL_IP_HEADER bewusst leer (Hotfix fix/fk2-bau-ohne-ipheader) – der Bau laeuft trotzdem, mit und ohne Wert
  assert.equal(s.bau.on(), true);
  assert.equal(createBau({ env: { ...s.benv, DUELL_IP_HEADER: 'X-Real-IP' }, store: s.k.store, log: () => {} }).on(), true);
  // ohne lesbares Token (fehlt, Datei weg, zu kurz) bleibt er aus (fail closed)
  writeFileSync(join(s.dir, 'kurz'), 'kurz\n');
  for (const f of ['', join(s.dir, 'gibt-es-nicht'), join(s.dir, 'kurz')]) assert.equal(createBau({ env: { ...s.benv, DUELL_BAU_TOKEN_FILE: f }, store: s.k.store, log: () => {} }).on(), false, f);
  const id = await order(s);
  const job = s.bau.holen().body;
  for (const bad of [{ ms: -1 }, { ms: 'x' }, { usd: NaN }, { usd: 1e9 }]) assert.equal((await s.bau.ergebnis({ ...okBody(job), ...bad })).status, 400, JSON.stringify(bad));
  await s.erg(okBody(job));
  const f = join(s.benv.DUELL_SPIEL_MODULE_DIR, SHA + '.js');
  writeFileSync(join(s.benv.DUELL_SPIEL_MODULE_DIR, 'e'.repeat(64) + '.js'), 'alt');
  assert.equal(s.bau.aufraeumen(), 1, 'nur das Modul ohne Auftrag');
  assert.ok(existsSync(f));
  s.k.loeschen(P);
  assert.equal(existsSync(f), false, 'mit dem Auftrag geht sein Spiel');
  void id;
});

test('Bau-Netz: vom Netz des Workers beantwortet der oeffentliche Port nichts; ohne DUELL_BAU_NETZ bleibt der Bau aus', () => {
  const s = setup();
  assert.equal(s.bau.ausBauNetz('172.31.250.5'), true); assert.equal(s.bau.ausBauNetz('::ffff:172.31.250.14'), true);
  assert.equal(s.bau.ausBauNetz('172.31.250.16'), false); assert.equal(s.bau.ausBauNetz('127.0.0.1'), false); assert.equal(s.bau.ausBauNetz(undefined), false);
  assert.equal(ausNetz('kaputt', '172.31.250.5'), false);
  assert.equal(createBau({ env: { ...s.benv, DUELL_BAU_NETZ: '' }, store: s.k.store, log: () => {} }).on(), false);
  assert.equal(createBau({ env: { ...s.benv, DUELL_BAU_NETZ: '300.1.1.0/28' }, store: s.k.store, log: () => {} }).on(), false);
});

test('KI-Ausfall im Worker: ki_nicht_verfuegbar ohne Abbuchung, Klasse an die Betreiber-Warnung, unbekannte Klasse abgelehnt', async () => {
  const s = setup();
  const gemeldet = [];
  const b2 = createBau({ env: s.benv, store: s.k.store, shared: s.shared, ki: { melde: async (k, i) => { gemeldet.push([k, i.model]); } }, log: () => {} });
  s.k.useBau(b2);
  const id = await order(s);
  const job = b2.holen().body;
  assert.equal((await b2.ergebnis({ auftrag: id, lease: job.lease, art: 'neu', ok: false, grund: 'ki_nicht_verfuegbar', ki: 'quatsch', ms: 1, usd: 0 })).status, 400);
  assert.equal((await b2.ergebnis({ auftrag: id, lease: job.lease, art: 'neu', ok: false, grund: 'ki_nicht_verfuegbar', ki: 'ki-limit', ms: 1, usd: 0 })).status, 200);
  const st = s.k.status(P, { auftrag: id }).body;
  assert.deepEqual([st.status, st.grund, st.abgebucht, st.vorgemerkt], ['gescheitert', 'ki_nicht_verfuegbar', false, false]);
  assert.deepEqual(s.spent, [], 'Vormerkung zurueck');
  assert.deepEqual(gemeldet, [['ki-limit', 'fk2-bau-worker']]);
});

test('Delta-Review 3: ein KI-Ausfall beim Nachbessern verbraucht keinen der 3 Versuche; ehrlicher Hinweis, vorige Version bleibt', async () => {
  const s = setup();
  const id = await order(s);
  const job = s.bau.holen().body;
  await s.erg(okBody(job, ['p3']));
  assert.equal((await s.k.nachbessern(P, { auftrag: id, text: '' })).body.nachbessernLeft, 2);
  const job2 = s.bau.holen().body;
  assert.equal(job2.art, 'nachbessern');
  assert.equal((await s.erg({ auftrag: id, lease: job2.lease, art: 'nachbessern', ok: false, grund: 'ki_nicht_verfuegbar', ki: 'ki-ueberlastet', alt: true, ms: 1, usd: 0 })).status, 200);
  const st = s.k.status(P, { auftrag: id }).body;
  assert.deepEqual([st.status, st.hinweis, st.nachbessernLeft, st.ergebnis.fehlt, st.abgebucht], ['fertig', 'ki_nicht_erreichbar', 3, 1, false]);
  assert.ok(K_HINWEISE.includes('ki_nicht_erreichbar'), 'der Vertrag der App kennt den Hinweis');
  // ein Fehlschlag aus anderem Grund zaehlt weiter
  await s.k.nachbessern(P, { auftrag: id, text: '' });
  const job3 = s.bau.holen().body;
  await s.erg({ auftrag: id, lease: job3.lease, art: 'nachbessern', ok: false, grund: 'nicht_geschafft', alt: true, ms: 1, usd: 0 });
  assert.deepEqual([s.k.status(P, { auftrag: id }).body.hinweis, s.k.status(P, { auftrag: id }).body.nachbessernLeft], ['nachbessern_nicht_geschafft', 2]);
});

test('Review Nit 9: ueberstimmt und Szenario-Anlaeufe werden geprueft, am Bau gespeichert und geloggt', async () => {
  const s = setup();
  const id = await order(s);
  const job = s.bau.holen().body;
  const sz = [{ id: 'p1', ok: true, grund: null, anlauf: 2, kontrolle: false }, { id: 'p2', ok: false, grund: 'von_allein', anlauf: 2, kontrolle: true }];
  assert.equal((await s.erg({ ...okBody(job, ['p2']), ueberstimmt: 9, szenarien: sz })).status, 200);
  assert.equal(s.k.status(P, { auftrag: id }).body.status, 'gescheitert', 'unplausible Kennzahl: kein Ergebnis');
  assert.ok(s.logs.some((l) => l.why === 'result-kennzahlen'));
  const t = setup();
  const id2 = await order(t);
  const j2 = t.bau.holen().body;
  await t.erg({ ...okBody(j2, ['p2']), ueberstimmt: 1, szenarien: sz });
  const bau = t.k.store.get(id2).bau;
  assert.deepEqual([bau.ueberstimmt, bau.szenarien], [1, sz]);
  const l = t.logs.find((x) => x.event === 'duell-bau' && x.ok === true);
  assert.deepEqual([l.ueberstimmt, l.szenarien], [1, 'p1:ok@2 p2:von_allein@2k']);
  // ohne Felder (aelterer Worker): 0 und leer
  const u = setup();
  const id3 = await order(u);
  const j3 = u.bau.holen().body;
  await u.erg(okBody(j3));
  assert.deepEqual([u.k.store.get(id3).bau.ueberstimmt, u.k.store.get(id3).bau.szenarien], [0, []]);
});

test('Hotfix ohne DUELL_IP_HEADER: der Bau-Listener lehnt fremde Netze ab, auch mit Token und gefaelschten Kopfzeilen', async () => {
  const s = setup();   // Netz des Workers 172.31.250.0/28, der Test ruft von 127.0.0.1
  const id = await order(s);
  const srv = http.createServer(async (q, r) => { if (!(await s.bau.route(q, r, new URL(q.url, 'http://x')))) r.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/intern/fk2/`;
  try {
    for (const h of [{}, { 'x-real-ip': '172.31.250.5' }, { 'x-forwarded-for': '172.31.250.5' }, { forwarded: 'for=172.31.250.5' }]) {
      const r = await fetch(base + 'holen', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...h }, body: '{}' });
      assert.equal(r.status, 404, JSON.stringify(h));
    }
  } finally { srv.close(); }
  assert.equal(s.k.status(P, { auftrag: id }).body.status, 'baut', 'nichts geholt');
  assert.equal(s.k.store.get(id).bau.status, 'wartet');
  // die Sperre des oeffentlichen Listeners (server.mjs): /api/intern/* immer, aus dem Netz des Workers alles
  assert.equal(s.bau.oeffentlichGesperrt('/api/intern/fk2/holen', '203.0.113.9'), true);
  assert.equal(s.bau.oeffentlichGesperrt('/api/intern/x', '127.0.0.1'), true);
  assert.equal(s.bau.oeffentlichGesperrt('/duell', '172.31.250.5'), true);
  assert.equal(s.bau.oeffentlichGesperrt('/duell', '203.0.113.9'), false);
  // Bau aus: /api/intern/* bleibt gesperrt, das Netz des Workers zaehlt dann nicht
  const aus = createBau({ env: { ...s.benv, DUELL_BAU_NETZ: '' }, store: s.k.store, log: () => {} });
  assert.equal(aus.on(), false, 'ohne DUELL_BAU_NETZ bleibt der Bau aus');
  assert.equal(aus.oeffentlichGesperrt('/api/intern/fk2/holen', '1.2.3.4'), true);
  assert.equal(aus.oeffentlichGesperrt('/duell', '172.31.250.5'), false);
});

// B2 (18.11.): the state volume of the worker was not writable, every build ended without a result, the lease ran out twice
// and the build ended "gescheitert" -- without any notification. Now every end of a build notifies (opt-in only), with the
// reason in plain words, "nichts abgebucht" only when true, and the link to the order; no error text, no path.
const KUNDENTAUGLICH = /EACCES|ENOENT|\/var\/|\/tmp|\.json|\blease\b|stack|Error|undefined|\bnull\b|\bfehler\b|ki_nicht|nicht_geschafft|kein_spiel/;
test('B2: Lease zweimal abgelaufen -> gescheitert mit Push und Mail (nur mit Haken), Grund in einfachen Worten, nichts abgebucht, Link', async () => {
  const s = setup();
  const id = await order(s);
  assert.equal(s.k.optin(P, { auftrag: id, push: true, mail: true, mark: MARK }).status, 200);
  assert.equal(s.bau.holen().body.auftrag.id, id);
  s.tick(21 * 60000);
  assert.equal(s.bau.holen().body.auftrag.id, id, 'once more');
  assert.deepEqual(s.pushes, [], 'queued again: nothing sent yet');
  s.tick(21 * 60000);
  assert.equal(s.bau.holen().status, 204);
  await new Promise((ok) => setTimeout(ok, 5));
  const st = s.k.status(P, { auftrag: id }).body;
  assert.equal(st.status, 'gescheitert'); assert.equal(st.grund, 'fehler'); assert.equal(st.abgebucht, false);
  assert.deepEqual(s.spent, [], 'the reservation went back');
  assert.deepEqual(s.pushes, [[MARK, 'karte-nicht', id]]);
  assert.equal(s.mails.length, 1);
  const m = s.mails[0];
  assert.equal(m.to, P.mail); assert.equal(m.subject, 'Deine Karte hat nicht geklappt');
  assert.match(m.text, /„Segelboot gegen Piraten“ hat leider nicht geklappt\.\nBeim Bauen ist bei uns etwas schiefgegangen\. An deinem Wunsch lag es nicht\. Abgebucht ist nichts\./);
  assert.ok(m.text.includes(`https://demos-34a13a96.bunsenbrenner.org/duell?go=fertig&auftrag=${id}`));
  assert.doesNotMatch(m.text, KUNDENTAUGLICH);
  assert.ok(!JSON.stringify(s.k.store.get(id)).includes(P.mail), 'settled: the address is gone');
  // without the tick nothing goes out
  const s2 = setup();
  await order(s2); s2.bau.holen(); s2.tick(21 * 60000); s2.bau.holen(); s2.tick(21 * 60000); s2.bau.holen();
  await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual([s2.pushes, s2.mails], [[], []]);
});

test('B2: jeder Grund des Workers hat einen eigenen kundentauglichen Satz (de, en), nur der gewaehlte Kanal', async () => {
  const s = setup();
  for (const grund of K_GRUENDE) {
    const id = await order(s);
    assert.equal(s.k.optin(P, { auftrag: id, push: false, mail: true }).status, 200);
    const job = s.bau.holen().body;
    const b = { auftrag: id, lease: job.lease, art: 'neu', ok: false, grund, ms: 1, usd: 0, ...(grund === 'ki_nicht_verfuegbar' ? { ki: 'ki-limit' } : {}) };
    assert.equal((await s.erg(b)).status, 200);
    const m = s.mails.at(-1);
    assert.ok(m.text.includes(GRUND_SATZ.de[grund] + ' Abgebucht ist nichts.'), grund);
    assert.ok(m.text.includes('?go=fertig&auftrag=' + id), grund);
    assert.doesNotMatch(m.text, KUNDENTAUGLICH, grund);
  }
  assert.equal(s.mails.length, K_GRUENDE.length);
  assert.deepEqual(s.pushes, [], 'push not ticked: no push');
  assert.deepEqual(Object.keys(GRUND_SATZ.de).sort(), [...K_GRUENDE].sort());
  assert.deepEqual(Object.keys(GRUND_SATZ.en).sort(), [...K_GRUENDE].sort());
  for (const g of K_GRUENDE) {
    const en = MAIL_TEXT.en['karte-nicht'].text({ titel: 'T', link: 'L', grund: g });
    assert.ok(en.includes(GRUND_SATZ.en[g] + ' Nothing is charged.'), g); assert.doesNotMatch(en, KUNDENTAUGLICH, g);
  }
  assert.ok(MAIL_TEXT.de['karte-nicht'].text({ titel: 'T', link: 'L', grund: 'quatsch' }).includes(GRUND_SATZ.de.fehler), 'unknown reason: the general sentence');
});

test('B2: "Abgebucht ist nichts" nur, wenn es stimmt (Erstattung fehlgeschlagen -> Satz fehlt)', async () => {
  const s = setup();
  const id = await order(s);
  s.k.optin(P, { auftrag: id, push: false, mail: true });
  s.credit.refund = () => false;
  const job = s.bau.holen().body;
  await s.erg({ auftrag: id, lease: job.lease, art: 'neu', ok: false, grund: 'zeit', ms: 1, usd: 0 });
  assert.equal(s.mails.length, 1);
  assert.ok(s.mails[0].text.includes(GRUND_SATZ.de.zeit));
  assert.doesNotMatch(s.mails[0].text, /Abgebucht ist nichts/);
});

test('B1: /api/status-Feld bau meldet einen stillen Worker und Auftraege ohne Ergebnis, laut im Log, einmal je Wechsel', async () => {
  const s = setup();
  assert.deepEqual(s.bau.status(), { on: true, ok: true, grund: null, worker: null }, 'nothing waits: ok');
  const id = await order(s);
  s.tick(3 * 60000);
  assert.deepEqual(s.bau.status(), { on: true, ok: false, grund: 'worker-still', worker: null }, 'an order waits, the worker never asked');
  s.bau.status();
  assert.equal(s.logs.filter((l) => l.event === 'duell-bau-warnung' && l.grund === 'worker-still').length, 1, 'logged once');
  assert.equal(s.bau.holen().body.auftrag.id, id);
  assert.equal(s.bau.status().ok, true, 'the worker asked: ok again');
  assert.ok(s.logs.some((l) => l.event === 'duell-bau-warnung' && l.ok === true));
  s.tick(21 * 60000);   // it took the order and never answered (as on 18.11. with the unwritable volume)
  const st = s.bau.status();
  assert.equal(st.ok, false); assert.equal(st.grund, 'ohne-ergebnis');
  assert.ok(s.logs.some((l) => l.event === 'duell-bau' && l.why === 'lease-expired'));
  const job = s.bau.holen().body;
  await s.erg(okBody(job));
  assert.equal(s.bau.status().ok, true, 'a result clears it');
  assert.ok(!JSON.stringify(s.bau.status()).includes(id), 'no order id on the public status');
  assert.deepEqual(createBau({ env: {}, store: s.k.store, log: () => {} }).status(), { on: false });
  assert.deepEqual(createBau({ env: { DUELL_BAU: 'on' }, store: s.k.store, log: () => {} }).status(), { on: false, ok: false, grund: 'konfiguration' });
});
