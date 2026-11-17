// Freie Karte 2, P1 (lib/duell-klaerung.mjs): questions and check list from the model through the app's strict contract,
// one repair round then an honest error, the same moderation for the sentence and own words (negations do not block,
// arcade play without violence passes), the confirmed order for P3, opt-in stored, repairs counted on the server (the
// 4th is refused), the report with its data set and the operator view. No network: the model is a double.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { writeFileSync, readdirSync, statSync } from 'node:fs';
import { createKlaerung, fileHandoff, ohneVerneinung, MOD_KLAERUNG, ARCADE, RETENTION_DAYS, HARNESS_MAX_BYTES } from '../lib/duell-klaerung.mjs';
import { createBau } from '../lib/duell-fk2-bau.mjs';
import { KINDS, createDuellAi } from '../lib/duell-ai.mjs';
import * as K from '../lib/vendor/mdi/features/frei/klaerung.js';

const P = { account: true, acct: 'aKonto12345', mail: 'lea@example.org' };
const OK_MOD = { json: { risk: 0, cats: [], drink: 'none' } };
const FRAGEN = { ok: true, verstehe: 'ein Spiel. Von oben kommt etwas angesegelt, du wehrst es ab.', fragen: [
  { frage: 'Wer bist du im Spiel?', hinweis: 'Tipp ein Bild an.', kacheln: [{ label: 'Ein Segelboot', sub: '', emoji: '⛵' }, { label: 'Eine Badeente', sub: '', emoji: '🦆' }] },
  { frage: 'Womit wirfst du?', hinweis: 'Es soll nass oder lustig werden.', kacheln: [{ label: 'Wasserbomben', sub: 'Platsch – das Boot kentert.', emoji: '💧' }, { label: 'Seifenblasen', sub: 'Die Boote schweben davon.', emoji: '🫧' }, { label: 'Kanonenkugeln', sub: 'Sie treffen nur Holz und Segel.', emoji: '🎯' }] },
  { frage: 'Wie schwer soll es sein?', hinweis: '', kacheln: [{ label: 'Gemütlich', sub: 'langsam, viele Leben', emoji: '🐢' }, { label: 'Normal', sub: 'wird schneller', emoji: '🌊' }, { label: 'Knifflig', sub: 'schnell, 1 Leben', emoji: '⚡' }] }] };
const liste = (eigen = 'Wasserbomben, die bunt platzen') => ({ ok: true, titel: 'Segelboot gegen Piraten', verstehe: 'Ein Spiel, in dem du Piratenboote nass machst.', punkte: [
  { text: 'Du steuerst ein Segelboot unten am Rand – wischen oder Pfeiltasten.', pruefung: 'Wischen nach links bewegt das Boot nach links.' },
  { text: `Ein großer Knopf wirft „${eigen}“ – so wie du es gesagt hast.`, pruefung: 'Antippen wirft eine Wasserbombe nach oben.' },
  { text: 'Normal schwer: 3 Leben, mit jeder Runde etwas schneller.', pruefung: 'Runde 2 ist messbar schneller als Runde 1.' }],
  nicht: ['Gleichzeitig online gegeneinander spielen ist nicht dabei.'] });

/** model double by call name; each entry a json, a function(req) or an array consumed in order */
function fakeLlm(by = {}) {
  const calls = [];
  const pick = (name, req) => { const a = by[name]; const v = Array.isArray(a) ? a.shift() : a; return typeof v === 'function' ? v(req) : v; };
  return { calls, async generate(req) {
    calls.push(req);
    if (req.name === 'check') return pick('check', req) || OK_MOD;
    const v = pick(req.name, req);
    if (v === 'throw') throw Object.assign(new Error('budget'), { code: 'budget' });
    return { json: v === undefined ? null : v };
  } };
}
const MARK = 'M'.repeat(22);
/** the build (P3) attached as in server.mjs, with doubles for credit, push and mail */
function withBau(k, shared, dir) {
  const bau = createBau({ env: { DUELL_BAU: 'on', DUELL_BAU_TOKEN_FILE: join(dir, 'token'), DUELL_SPIEL_ORIGIN: 'https://spiel-f29c55da.bunsenbrenner.org', DUELL_SPIEL_MODULE_DIR: join(dir, 'spiele'), DUELL_APP_URL: 'https://demos.example/duell', DUELL_IP_HEADER: 'X-Real-IP' },
    store: k.store, shared, push: { on: () => true, notify: async () => 'sent' }, mail: { on: () => true, send: async () => ({ ok: true }) }, log: () => {} });
  k.useBau(bau);
  return bau;
}
function setup({ llm = fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste() }), env = {}, age16 = () => true, guthaben = 5 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'klaerung-'));
  const d = createDuell({ env: {}, salt: 's', log: () => {}, llm: async () => '{}' });
  const spent = [];
  const credit = { available: () => guthaben - spent.length, spend: (k, n) => { if (guthaben - spent.length < n) return false; spent.push([k, n]); return true; }, refund: (k, n) => { const i = spent.findIndex((x) => x[0] === k && x[1] === n); if (i < 0) return false; spent.splice(i, 1); return true; } };
  Object.assign(d.shared, { age16, mod: { canCreate: () => ({ ok: true }) }, credit });
  const k = createKlaerung({ env: { DUELL_KLAERUNG: 'on', DUELL_KLAERUNG_DIR: dir, DUELL_ADMIN_TOKEN: 'admin-token-123456', ...env }, shared: d.shared, who: async (req) => (req.headers['x-acct'] ? { ...P, acct: req.headers['x-acct'] } : { account: false }), llm, log: () => {} });
  const bau = withBau(k, d.shared, dir);
  return { k, llm, dir, store: fileHandoff(dir), bau, spent, shared: d.shared };
}
const ANT = [{ art: 'kachel', kachel: 0 }, { art: 'eigen', text: 'Wasserbomben, die bunt platzen' }, { art: 'egal' }];
async function toOrder(s) {
  const f = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten', lang: 'de' });
  const l = await s.k.liste(P, { id: f.body.id, antworten: ANT });
  assert.equal(l.status, 200, JSON.stringify(l.body));
  const a = s.k.auftrag(P, { id: f.body.id });
  return { f, l, a };
}
/** P3 writes the result through the store; here test data with one missing point (test/duell-fk2-bau.test.mjs: the real path) */
function withResult(s, id, fehlt = true) {
  const o = s.store.get(id);
  o.ergebnis = { titel: 'Segelboot gegen Piraten', punkte: o.punkte.map((x, i) => ({ id: x.id, erfuellt: !(fehlt && i === 2), notiz: fehlt && i === 2 ? 'bleibt gleich schnell' : '', geprueft: 'gespielt' })) };
  o.spiel = { sha256: 'a'.repeat(64) }; o.bau = { status: 'fertig', art: 'neu', at: o.at };
  s.store.put(o);
}

test('Verneinung: nur wenn sie den ganzen Rest des Teilsatzes bildet; kein Weitertragen ueber Komma; harte Kategorien auf dem Rohtext', () => {
  const w = (t) => KINDS.karte.s1w(t, false);
  // a whole-clause negation of a soft violence word does not block
  for (const t of ['Space Invaders ohne Blut', 'ein Spiel ohne Blut und ohne Waffen', 'kein Blut bitte', 'Piraten, aber keine echten Waffen', 'Gruselkarte, aber kein Blut', 'weder Blut noch Waffen', 'a shooter without blood', 'never kill', 'nicht töten', 'Wasserbomben, die bunt platzen', 'Seifenblasen', 'Kanonenkugeln, die nur Holz treffen'])
    assert.equal(w(t), '', t);
  // the review examples (neg.mjs): the negation never reaches beyond its clause, a further word needs its own negation,
  // a double negation in the clause stays, a clause that goes on stays
  for (const t of ['ohne Blut, Waffen', 'ohne Blut und Messer', 'ohne Blut, Bomben auf Menschen', 'Ich will töten, nicht Tote', 'ohne Blut und mit Messer', 'not without blood',
    'keine Waffen, nur Pistolen', 'ohne Blut, Schusswaffen und Tote', 'Spiel: nicht Blut sondern Gewalt', 'nie ohne Blut', 'ohne Blut und ohne Gnade Waffen', 'ohne  Blut​, Waffen',
    'no kill, only murder', 'without blood, guns aimed at people', 'ohne Blut. Waffen', 'ohne Blut, kill yourself', 'no gore, kill all jews', 'niemals ohne Blut', 'keine Karte ohne Blut',
    'Ohne Blut geht es nicht', 'ohne Blut und ohne Gnade: tot', 'mit Blut', 'nicht ohne Blut'])
    assert.notEqual(w(t), '', t);
  // what remains is exactly the rest of the text: nothing outside the negated clause is taken away
  assert.equal(ohneVerneinung('ohne Blut, Bomben auf Menschen').trim(), ', Bomben auf Menschen');
  assert.equal(ohneVerneinung('ohne Blut und Messer'), 'ohne Blut und Messer');
  assert.match(ohneVerneinung('no kill, only murder'), /only murder/);
  assert.match(ohneVerneinung('nicht tod, nicht verletzt, sondern gefoltert'), /sondern gefoltert/);
  for (const t of ['nie ohne Blut', 'niemals ohne Blut', 'keine Karte ohne Blut', 'Ohne Blut geht es nicht', 'not without blood', 'ohne Blut und ohne Gnade Waffen']) assert.equal(ohneVerneinung(t), t, t);
  // hard categories always on the raw text: crisis, hate words, sexual words stay whatever is negated next to them
  assert.equal(w('ohne Blut, kill yourself'), KINDS.karte.s1('ohne Blut, kill yourself', false));
  assert.equal(w('oben ohne'), 'sexual');
  assert.equal(w('ohne Blut, ich will nicht mehr leben'), 'crisis');
  // linear time on long input
  const t0 = Date.now(); ohneVerneinung('ohne Blut' + ', Blut'.repeat(300)); ohneVerneinung('no '.repeat(600)); w('ohne '.repeat(400) + 'Blut'); assert.ok(Date.now() - t0 < 500);
  // the model always rates the text as typed: the arcade block is part of its fixed prefix
  assert.equal(MOD_KLAERUNG.at(-1).text, ARCADE); assert.equal(MOD_KLAERUNG.at(-1).cache, true);
});

test('aus ohne Schalter, Login, 16+; Fragen kommen geprueft mit fester Praefix (Cache) und Satz nur im User-Turn', async () => {
  const off = createKlaerung({ env: {}, shared: createDuell({ env: {}, salt: 's', log: () => {} }).shared, who: async () => P, llm: fakeLlm(), log: () => {} });
  assert.equal(off.on(), false); assert.equal((await off.fragen(P, { satz: 'xyz abc' })).body.error, 'off');
  // the switch the app asks for its entry (without login): off by default, on only with DUELL_KLAERUNG=on
  assert.deepEqual(off.an().body, { on: false }); assert.deepEqual(setup().k.an().body, { on: true });
  const s = setup();
  assert.equal((await s.k.fragen(null, { satz: 'Space Invaders' })).status, 401);
  assert.equal((await setup({ age16: () => false }).k.fragen(P, { satz: 'Space Invaders' })).body.error, 'age16');
  const r = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten', lang: 'de' });
  assert.equal(r.status, 200); assert.equal(r.body.fragen.length, 3); assert.match(r.body.id, /^[A-Za-z0-9_-]{22}$/);
  const gen = s.llm.calls.find((c) => c.name === 'klaerung_fragen');
  assert.equal(gen.system.length, 1); assert.equal(gen.system[0].cache, true);
  assert.ok(!gen.system[0].text.includes('Segelbooten'), 'the sentence never enters the cached prefix');
  assert.match(gen.user, /<data>"Space Invaders mit Segelbooten"<\/data>/);
  assert.deepEqual(gen.schema, K.FRAGEN_SCHEMA);
});

test('Krise, harte und weiche Absage des Satzes; Modell nimmt Verneinung, Arcade passiert', async () => {
  const s = setup({ llm: fakeLlm({ klaerung_fragen: FRAGEN, check: (req) => (/Raketen/.test(req.user) ? { json: { risk: 2, cats: ['weapons'], drink: 'none' } } : OK_MOD) }) });
  const c = await s.k.fragen(P, { satz: 'ich will nicht mehr leben' });
  assert.equal(c.body.why, 'crisis'); assert.ok(c.body.help);
  assert.equal((await s.k.fragen(P, { satz: 'Raketen, die alles in die Luft jagen' })).body.reason, 'weapons');
  assert.equal((await s.k.fragen(P, { satz: 'Space Invaders ohne Blut' })).status, 200, 'negation passes S1 and the model');
  assert.equal((await s.k.fragen(P, { satz: 'Wasserbomben auf Piratenboote werfen' })).status, 200);
  const hard = await s.k.fragen(P, { satz: 'ein Spiel mit nackten Leuten' });
  assert.equal(hard.body.error, 'blocked'); assert.equal(hard.body.reason, 'sexual');
});

test('ungueltige Antwort: eine Reparaturrunde mit Fehlerliste, dann ehrlich 502 – nie ein Ersatz', async () => {
  const bad = { ...FRAGEN, fragen: [...FRAGEN.fragen, FRAGEN.fragen[0]] };   // 4 questions
  const s = setup({ llm: fakeLlm({ klaerung_fragen: [bad, FRAGEN] }) });
  const r = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' });
  assert.equal(r.status, 200);
  const gens = s.llm.calls.filter((c) => c.name === 'klaerung_fragen');
  assert.equal(gens.length, 2); assert.match(gens[1].user, /INVALID: fragen: 4 statt 1\.\.3/);
  const s2 = setup({ llm: fakeLlm({ klaerung_fragen: [bad, { ...FRAGEN, fragen: [{ ...FRAGEN.fragen[0], kacheln: [{ label: 'Pistole', sub: '', emoji: '🔫' }, FRAGEN.fragen[0].kacheln[0]] }] }] }) });
  const r2 = await s2.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' });
  assert.equal(r2.status, 502); assert.equal(r2.body.error, 'bad-output');
  // a refusal of the model is a refusal, not a repair
  const s3 = setup({ llm: fakeLlm({ klaerung_fragen: { ok: false, verstehe: '', fragen: [] } }) });
  assert.equal((await s3.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' })).body.error, 'refused');
  // S1 on the output: a weapon word in a tile is invalid output
  const s4 = setup({ llm: fakeLlm({ klaerung_fragen: [{ ...FRAGEN, fragen: [{ ...FRAGEN.fragen[0], kacheln: [{ label: 'Eine Pistole', sub: '', emoji: '🎯' }, FRAGEN.fragen[0].kacheln[0]] }] }, FRAGEN] }) });
  assert.equal((await s4.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' })).status, 200);
  assert.match(s4.llm.calls.filter((c) => c.name === 'klaerung_fragen')[1].user, /label: not allowed \(weapons\)/);
  // the model layer down: honest 503
  assert.equal((await setup({ llm: fakeLlm({ klaerung_fragen: 'throw' }) }).k.fragen(P, { satz: 'Space Invaders mit Segelbooten' })).body.error, 'llm-off');
});

test('eigene Worte: gleiche Moderation mit Satz als Kontext; Absage ehrlich mit den Kacheln der Frage als Vorschlag', async () => {
  const s = setup({ llm: fakeLlm({ klaerung_fragen: FRAGEN, check: (req) => (/Raketen/.test(req.user) ? { json: { risk: 2, cats: ['weapons'], drink: 'none' } } : OK_MOD) }) });
  const f = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' });
  const ok = await s.k.antwort(P, { id: f.body.id, frage: 1, text: '  Wasserbomben,   die bunt platzen ' });
  assert.deepEqual(ok.body, { ok: true, text: 'Wasserbomben, die bunt platzen' });
  assert.match(s.llm.calls.at(-1).user, /Space Invaders mit Segelbooten · Womit wirfst du\? Wasserbomben/);
  const no = await s.k.antwort(P, { id: f.body.id, frage: 1, text: 'Raketen, die alles in die Luft jagen' });
  assert.equal(no.status, 422); assert.equal(no.body.error, 'refused'); assert.equal(no.body.reason, 'weapons'); assert.deepEqual(no.body.vorschlaege, [0, 1]);
  assert.equal((await s.k.antwort(P, { id: f.body.id, frage: 1, text: 'ohne Blut' })).status, 200);
  assert.equal((await s.k.antwort(P, { id: f.body.id, frage: 1, text: 'x'.repeat(121) })).status, 400, 'maxlength 120');
  assert.equal((await s.k.antwort(P, { id: 'A'.repeat(22), frage: 1, text: 'Seife' })).status, 410);
  assert.equal((await s.k.antwort({ ...P, acct: 'aAnderer123' }, { id: f.body.id, frage: 1, text: 'Seife' })).status, 410, 'a draft belongs to its owner');
});

test('Liste: eigene Worte woertlich als Pflicht, sonst Reparatur; prueft eigene Worte erneut; Dauer und Kosten fest', async () => {
  const wrong = liste('Wasserbomben die bunt platzen');   // comma lost: not verbatim
  const s = setup({ llm: fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: [wrong, liste()] }) });
  const f = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' });
  const l = await s.k.liste(P, { id: f.body.id, antworten: ANT });
  assert.equal(l.status, 200);
  assert.match(s.llm.calls.filter((c) => c.name === 'klaerung_liste')[1].user, /eigene Worte fehlen woertlich: Wasserbomben, die bunt platzen/);
  assert.ok(l.body.punkte.some((x) => x.text.includes('„Wasserbomben, die bunt platzen“')));
  assert.ok(l.body.punkte.every((x) => x.pruefung), 'every point is checkable');
  assert.equal(l.body.dauerMaxMin, 15); assert.deepEqual(l.body.kosten, { guthaben: 1, nurBeiErfolg: true });
  const lu = s.llm.calls.filter((c) => c.name === 'klaerung_liste')[0].user;
  assert.match(lu, /OWN WORDS "Wasserbomben, die bunt platzen"/); assert.match(lu, /surprise me/); assert.match(lu, /tile "Ein Segelboot"/);
  assert.equal(s.llm.calls.filter((c) => c.name === 'check' && /^CARD/.test(c.user)).length, 1, 'the finished list is checked as a CARD');
  // the app's earlier check is no proof: a refused own answer sent directly to /liste is refused here
  const s2 = setup({ llm: fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste(), check: (req) => (/Raketen/.test(req.user) ? { json: { risk: 2, cats: ['weapons'], drink: 'none' } } : OK_MOD) }) });
  const f2 = await s2.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' });
  const r2 = await s2.k.liste(P, { id: f2.body.id, antworten: [ANT[0], { art: 'eigen', text: 'Raketen' }, ANT[2]] });
  assert.equal(r2.status, 422); assert.equal(r2.body.frage, 1);
  assert.equal((await s2.k.liste(P, { id: f2.body.id, antworten: ANT.slice(0, 2) })).status, 400, 'one answer per question');
});

test('Ja, so bauen: Bauauftrag als JSON fuer P3, genau die gesehene Liste; doppelt getippt ein Auftrag; Opt-in nur gespeichert', async () => {
  const s = setup();
  const { f, l, a } = await toOrder(s);
  assert.equal(a.status, 202);
  assert.equal(a.body.bau, 'wartet', 'the build (P3) is attached: queued');
  assert.deepEqual(s.k.auftrag(P, { id: f.body.id }).body.auftrag, a.body.auftrag);
  const o = JSON.parse(readFileSync(join(s.dir, a.body.auftrag + '.json'), 'utf8'));
  assert.equal(o.v, K.AUFTRAG_V); assert.equal(o.status, 'bestaetigt'); assert.equal(o.owner, P.acct); assert.ok(!JSON.stringify(o).includes(P.mail), 'no e-mail in the order');
  assert.deepEqual(o.punkte, l.body.punkte); assert.equal(o.satz, 'Space Invaders mit Segelbooten');
  assert.deepEqual(o.fragen[1].antwort, { art: 'eigen', text: 'Wasserbomben, die bunt platzen' });
  assert.deepEqual(o.fragen[0].antwort, { art: 'kachel', kachel: 0, label: 'Ein Segelboot' });
  assert.equal(o.kosten.guthaben, 1); assert.equal(o.kosten.abgebucht, false); assert.equal(o.kosten.stand, 'vorgemerkt', '1 credit reserved, not charged');
  assert.deepEqual(o.optin, { push: false, mail: false }, 'no consent until ticked');
  assert.deepEqual(s.k.optin(P, { auftrag: a.body.auftrag, push: true, mail: false, mark: MARK }).body.optin, { push: true, mail: false });
  assert.equal(s.store.get(a.body.auftrag).optin.push, true); assert.equal(s.store.get(a.body.auftrag).optin.mark, MARK);
  assert.equal(s.k.optin(P, { auftrag: a.body.auftrag, push: true, mail: false }).status, 409, 'a push needs the mark of this device');
  assert.equal(s.k.optin(P, { auftrag: a.body.auftrag, push: false, mail: true }).status, 200);
  assert.equal(s.store.get(a.body.auftrag).optin.adresse, P.mail, 'the address only while mail is ticked');
  assert.equal(s.k.optin(P, { auftrag: a.body.auftrag, push: false, mail: false }).status, 200);
  assert.ok(!JSON.stringify(s.store.get(a.body.auftrag)).includes(P.mail), 'unticked: the address is gone');
  assert.equal(s.k.optin({ ...P, acct: 'aAnderer123' }, { auftrag: a.body.auftrag, push: true, mail: true }).status, 404);
  assert.equal(s.k.optin(P, { auftrag: a.body.auftrag, push: 'ja', mail: false }).status, 400);
  // without a list there is no order
  const f2 = await s.k.fragen(P, { satz: 'Umfrage: Wohin am Samstag?' });
  assert.equal(s.k.auftrag(P, { id: f2.body.id }).status, 410);
});

test('Nachbessern: hoechstens 3x, im Server gezaehlt; jedes erst nach einem NEUEN Ergebnis von P3; der 4. wird abgelehnt', async () => {
  const s = setup();
  const { a } = await toOrder(s);
  const id = a.body.auftrag;
  assert.equal(s.k.status(P, { auftrag: id }).body.status, 'baut', 'queued for the build worker');
  withResult(s, id);
  const st = s.k.status(P, { auftrag: id });
  assert.equal(st.body.nachbessernLeft, 3); assert.equal(st.body.ergebnis.fehlt, 1); assert.equal(st.body.kosten, 1);
  assert.equal((await s.k.melden(P, { auftrag: id, text: 'zu frueh' })).body.error, 'noch-nachbessern', 'report only after the repairs');
  // three times in a row WITHOUT a new result: only the first counts, the counter is not used up without a rebuild
  assert.equal((await s.k.nachbessern(P, { auftrag: id })).body.nachbessernLeft, 2);
  assert.equal((await s.k.nachbessern(P, { auftrag: id })).body.error, 'wird-nachgebessert');
  assert.equal((await s.k.nachbessern(P, { auftrag: id })).body.error, 'wird-nachgebessert');
  assert.equal(s.store.get(id).nachbessert, 1);
  const wait = s.k.status(P, { auftrag: id }).body;
  assert.equal(wait.status, 'nachbessern'); assert.equal(wait.ergebnis, null); assert.equal(wait.nachbessernLeft, 2);
  assert.equal(s.k.behalten(P, { auftrag: id }).body.error, 'wird-nachgebessert', 'keep only a result that exists');
  // P3 writes a new result each time
  withResult(s, id); assert.equal((await s.k.nachbessern(P, { auftrag: id })).body.nachbessernLeft, 1);
  withResult(s, id); assert.equal((await s.k.nachbessern(P, { auftrag: id })).body.nachbessernLeft, 0);
  withResult(s, id);
  const fourth = await s.k.nachbessern(P, { auftrag: id });
  assert.equal(fourth.status, 409); assert.equal(fourth.body.error, 'limit');
  assert.equal(s.store.get(id).nachbessert, 3, 'the 4th try changed nothing');
  assert.equal(s.store.get(id).ergebnisse.length, 3, 'earlier results are kept with the order');
  // a fresh server (restart) keeps the count: it lives with the order, not in the app or in memory
  const sh2 = Object.assign(createDuell({ env: {}, salt: 's', log: () => {} }).shared, { age16: () => true });
  const s2 = { ...s, k: createKlaerung({ env: { DUELL_KLAERUNG: 'on', DUELL_KLAERUNG_DIR: s.dir }, shared: sh2, who: async () => P, llm: fakeLlm(), log: () => {} }) };
  withBau(s2.k, sh2, s.dir);
  assert.equal(s2.k.status(P, { auftrag: id }).body.nachbessernLeft, 0);
  assert.equal((await s2.k.nachbessern(P, { auftrag: id })).body.error, 'limit');
  s2.k.stop();
  // nothing missing: nothing to repair
  const s3 = setup(); const o3 = await toOrder(s3); withResult(s3, o3.a.body.auftrag, false);
  assert.equal((await s3.k.nachbessern(P, { auftrag: o3.a.body.auftrag })).body.error, 'nichts-fehlt');
});

/** three repairs, each with a new result of P3 */
async function repairAll(s, id) { for (let i = 0; i < 3; i++) { withResult(s, id); assert.equal((await s.k.nachbessern(P, { auftrag: id })).status, 200); } withResult(s, id); }

test('Melden: Text optional, gleiche Moderation, gespeichert mit Liste und fehlt-Punkten, Harness-Datensatz, Pruefansicht; Karte kostenlos, Behalten bleibt', async () => {
  const s = setup({ llm: fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste(), check: (req) => (/Idioten/.test(req.user) ? { json: { risk: 2, cats: ['harassment'], drink: 'none' } } : OK_MOD) }) });
  const { a } = await toOrder(s);
  const id = a.body.auftrag;
  await await repairAll(s, id);
  assert.equal((await s.k.melden(P, { auftrag: id, text: 'x'.repeat(501) })).status, 400, 'max 500');
  const no = await s.k.melden(P, { auftrag: id, text: 'ihr seid Idioten' });
  assert.equal(no.status, 422, 'same moderation as the wish');
  assert.ok(!existsSync(join(s.dir, 'meldungen')) || !readFileSync(join(s.dir, 'meldungen', 'harness.jsonl'), 'utf8').includes('Idioten'), 'a refused text is not stored');
  const ok = await s.k.melden(P, { auftrag: id, text: 'Die Boote werden nie schneller, nach 2 Minuten ist es langweilig.' });
  assert.deepEqual(ok.body, { gemeldet: true, kosten: { erlassen: true } });
  const lines = readFileSync(join(s.dir, 'meldungen', 'harness.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  assert.equal(lines.length, 1);
  const m = lines[0];
  assert.equal(m.auftrag, id); assert.equal(m.owner, P.acct); assert.ok(!JSON.stringify(m).includes(P.mail), 'account only as pseudonym');
  assert.equal(m.karte.titel, 'Segelboot gegen Piraten'); assert.equal(m.punkte.length, 3); assert.deepEqual(m.fehlt.map((x) => x.id), ['p3']);
  assert.equal(m.fehlt[0].notiz, 'bleibt gleich schnell'); assert.match(m.text, /nie schneller/); assert.ok(Date.parse(m.at) > 0);
  assert.equal(s.store.get(id).kosten.erlassen, true);
  assert.equal((await s.k.melden(P, { auftrag: id })).body.gemeldet, true, 'once per card, the second is the same answer');
  assert.equal(readFileSync(join(s.dir, 'meldungen', 'harness.jsonl'), 'utf8').trim().split('\n').length, 1);
  // "Trotzdem so behalten" stays possible and charges nothing in P1
  assert.deepEqual(s.k.behalten(P, { auftrag: id }).body, { behalten: true, abgebucht: false, guthaben: 1 });
  assert.equal((await s.k.nachbessern(P, { auftrag: id })).body.error, 'abgeschlossen');
  // no text at all is fine (no required fields)
  const t = setup(); const o2 = await toOrder(t); await repairAll(t, o2.a.body.auftrag);
  assert.equal((await t.k.melden(P, { auftrag: o2.a.body.auftrag })).body.gemeldet, true);
  assert.equal(t.store.meldungen()[0].text, '');

  // the operator's review view over HTTP: Bearer token only
  const srv = http.createServer(async (q, r) => { if (!(await s.k.route(q, r, new URL(q.url, 'http://x')))) r.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/duell/klaerung/admin/meldungen')).status, 401);
    const v = await (await fetch(base + '/api/duell/klaerung/admin/meldungen', { headers: { authorization: 'Bearer admin-token-123456' } })).json();
    assert.equal(v.meldungen.length, 1); assert.match(v.meldungen[0].text, /nie schneller/);
    const st = await fetch(base + '/api/duell/klaerung/status', { method: 'POST', headers: { 'content-type': 'application/json', 'x-acct': P.acct }, body: JSON.stringify({ auftrag: id }) });
    const sb = await st.json();
    assert.equal(st.status, 200); assert.equal(sb.gemeldet, true); assert.equal(sb.nachbessernLeft, 0);
    assert.equal((await fetch(base + '/api/duell/klaerung/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  } finally { await new Promise((r) => srv.close(r)); }
});

test('Tageskappe zaehlt echte Modellaufrufe; nach 3 Strikes nur Neues gesperrt, die gebaute Karte bleibt erreichbar; "an" ohne Login und ohne Kontodienst', async () => {
  // fragen = check + generation = 2 calls; liste with one own answer = check + generation + CARD check = 3
  const s = setup({ env: { DUELL_KLAERUNG_PER_DAY: '4' } });
  const f = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' });
  assert.equal(f.status, 200); assert.equal(s.llm.calls.length, 2);
  const l = await s.k.liste(P, { id: f.body.id, antworten: ANT });
  assert.equal(l.status, 429); assert.equal(l.body.error, 'daily-cap', 'the 5th model call is refused inside the request');
  assert.equal((await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' })).body.error, 'daily-cap');
  // three hard refusals: new things wait, the existing card does not
  const t = setup();
  const { a } = await toOrder(t); const id = a.body.auftrag; withResult(t, id);
  for (let i = 0; i < 3; i++) assert.equal((await t.k.fragen(P, { satz: 'ein Spiel mit nackten Leuten' })).body.error, 'blocked');
  assert.equal((await t.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' })).body.error, 'throttled');
  assert.equal((await t.k.nachbessern(P, { auftrag: id })).body.error, 'throttled', 'a repair is new');
  assert.equal(t.k.status(P, { auftrag: id }).status, 200);
  assert.equal(t.k.optin(P, { auftrag: id, push: true, mail: false, mark: MARK }).status, 200);
  assert.equal(t.k.behalten(P, { auftrag: id }).status, 200);
  // the switch over HTTP: no login, and the account service down does not matter
  const down = createKlaerung({ env: { DUELL_KLAERUNG: 'on', DUELL_KLAERUNG_DIR: t.dir }, shared: createDuell({ env: {}, salt: 's', log: () => {} }).shared, who: async () => ({ status: 503 }), llm: fakeLlm(), log: () => {} });
  const srv = http.createServer(async (q, r) => { if (!(await down.route(q, r, new URL(q.url, 'http://x')))) r.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/duell/klaerung/an`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { on: true });
    assert.equal((await fetch(`http://127.0.0.1:${srv.address().port}/api/duell/klaerung/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 503);
  } finally { await new Promise((r) => srv.close(r)); down.stop(); }
});

test('Melden: nie nach Behalten (Server), nur einmal auch bei gleichzeitigen Anfragen', async () => {
  const s = setup();
  const { a } = await toOrder(s); const id = a.body.auftrag;
  await await repairAll(s, id);
  assert.equal(s.k.behalten(P, { auftrag: id }).status, 200);
  const r = await s.k.melden(P, { auftrag: id, text: 'nach behalten' });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'abgeschlossen');
  assert.equal(s.store.meldungen().length, 0);
  // two reports at once, the check of the text slow: exactly one is stored
  let release;
  const gateCheck = new Promise((r) => { release = r; });
  const slow = fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste(), check: (req) => (/REPORT/.test(req.user) ? gateCheck.then(() => OK_MOD) : OK_MOD) });
  const t = setup({ llm: slow });
  const o = await toOrder(t); const tid = o.a.body.auftrag; await repairAll(t, tid);
  const p1 = t.k.melden(P, { auftrag: tid, text: 'erste Meldung' });
  const p2 = t.k.melden(P, { auftrag: tid, text: 'zweite Meldung' });
  // keep while the report is being checked: the re-read after the check sees it and refuses the report
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]); assert.equal([r1, r2].find((x) => x.status === 409).body.error, 'laeuft');
  assert.equal(t.store.meldungen().length, 1);
  const u = setup({ llm: fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste(), check: (req) => (/REPORT/.test(req.user) ? new Promise((ok) => setTimeout(() => ok(OK_MOD), 30)) : OK_MOD) }) });
  const o3 = await toOrder(u); const uid = o3.a.body.auftrag; await repairAll(u, uid);
  const pm = u.k.melden(P, { auftrag: uid, text: 'dauert' });
  u.k.behalten(P, { auftrag: uid });
  assert.equal((await pm).body.error, 'abgeschlossen', 'kept during the check: no report');
  assert.equal(u.store.meldungen().length, 0);
});

test('Speicher: kaputte Dateien werden uebersprungen und protokolliert; harness.jsonl rotiert; TTL 180 Tage; Loeschen je Konto', async () => {
  const lines = [];
  const dir = mkdtempSync(join(tmpdir(), 'klaerung-store-'));
  let t = Date.parse('2026-11-17T12:00:00Z');
  const st = fileHandoff(dir, { log: (o) => lines.push(o), now: () => t });
  const m = (id, owner, at) => ({ v: 1, id, owner, at, auftrag: 'X'.repeat(22), text: 'x'.repeat(200) });
  st.meldung(m('A'.repeat(22), 'aEins', '2026-01-01T00:00:00.000Z'));
  st.meldung(m('B'.repeat(22), 'aZwei', '2026-11-16T00:00:00.000Z'));
  writeFileSync(join(dir, 'meldungen', 'C'.repeat(22) + '.json'), '{kaputt');
  const got = st.meldungen();
  assert.equal(got.length, 2); assert.ok(lines.some((l) => l.why === 'broken'), 'logged, not silent');
  assert.equal(st.meldungen(1).length, 1, 'read lazily up to the limit');
  st.put({ id: 'D'.repeat(22), owner: 'aEins', at: '2026-01-01T00:00:00.000Z' });
  st.put({ id: 'E'.repeat(22), owner: 'aZwei', at: '2026-11-16T00:00:00.000Z' });
  // retention: everything older than 180 days goes, also the harness lines
  assert.equal(RETENTION_DAYS, 180);
  const gone = st.purge(t - RETENTION_DAYS * 86400000);
  assert.ok(gone >= 3, String(gone));
  assert.equal(st.get('D'.repeat(22)), null); assert.ok(st.get('E'.repeat(22)));
  assert.ok(!readFileSync(join(dir, 'meldungen', 'harness.jsonl'), 'utf8').includes('aEins'));
  // per account
  const fg = st.forget('aZwei'); assert.ok(fg >= 3, String(fg));
  assert.equal(st.get('E'.repeat(22)), null); assert.equal(st.meldungen().length, 0);
  assert.equal(readFileSync(join(dir, 'meldungen', 'harness.jsonl'), 'utf8'), '');
  // rotation at the size limit
  writeFileSync(join(dir, 'meldungen', 'harness.jsonl'), 'x'.repeat(HARNESS_MAX_BYTES));
  t += 1000; st.meldung(m('F'.repeat(22), 'aDrei', '2026-11-17T00:00:00.000Z'));
  const names = readdirSync(join(dir, 'meldungen')).filter((n) => n.startsWith('harness'));
  assert.equal(names.length, 2); assert.ok(statSync(join(dir, 'meldungen', 'harness.jsonl')).size < 2000);
  // the person deletes their own data through the server
  const s = setup(); const { a } = await toOrder(s);
  assert.ok(s.k.loeschen(P).body.geloescht >= 1); assert.equal(s.store.get(a.body.auftrag), null);
  assert.equal(s.k.loeschen(null).status, 401);
});

test('Schalter tester: nur Konten aus DUELL_TESTER_ACCTS (wie who() geschluesselt), alle Endpunkte pruefen es; on und aus wie bisher', async () => {
  const { parseTesterMails, createTesters } = await import('../lib/duell-tester.mjs');
  assert.deepEqual(parseTesterMails(' Lea@Example.org, ,tom@example.org,keine-adresse, lea@example.org'), ['lea@example.org', 'tom@example.org']);
  // the key exactly as who() builds it for a login
  const ai = createDuellAi({ env: {}, salt: 'salz', shared: createDuell({ env: {}, salt: 'salz', log: () => {} }).shared, log: () => {}, llm: async () => '{}' });
  const testers = createTesters({ env: { DUELL_TESTER_ACCTS: ' LEA@example.org ' }, acctOf: ai.acctOf });
  const lea = { account: true, acct: ai.acctOf('lea@example.org'), mail: 'lea@example.org' }, tom = { account: true, acct: ai.acctOf('tom@example.org'), mail: 'tom@example.org' };
  assert.equal(testers.size, 1); assert.equal(testers.isTester(lea.acct), true); assert.equal(testers.isTester(tom.acct), false); assert.equal(testers.isTester(''), false);
  assert.equal(createTesters({ env: { DUELL_TESTER_ACCTS: 'lea@example.org' } }).isTester(lea.acct), false, 'without acctOf nobody (fail closed)');
  const lines = [];
  const mk = (mode, whoFn) => {
    const dir = mkdtempSync(join(tmpdir(), 'klaerung-t-'));
    const d = createDuell({ env: {}, salt: 's', log: () => {}, llm: async () => '{}' });
    Object.assign(d.shared, { age16: () => true, mod: { canCreate: () => ({ ok: true }) } });
    return createKlaerung({ env: { DUELL_KLAERUNG: mode, DUELL_KLAERUNG_DIR: dir, DUELL_TESTER_ACCTS: 'lea@example.org' }, shared: d.shared, who: whoFn, llm: fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste() }), testers, log: (o) => lines.push(o) });
  };
  const asWho = (h) => (h === 'lea' ? lea : h === 'tom' ? tom : { account: false });
  const anOf = async (k) => {
    const srv = http.createServer(async (q, r) => { if (!(await k.route(q, r, new URL(q.url, 'http://x')))) r.writeHead(404).end(); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}/api/duell/klaerung/an`;
    const q = async (h) => { const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(h ? { 'x-who': h } : {}) }, body: '{}' }); return [r.status, (await r.json()).on]; };
    try { return { lea: await q('lea'), tom: await q('tom'), anon: await q('') }; } finally { await new Promise((r) => srv.close(r)); k.stop(); }
  };
  const who = async (req) => asWho(req.headers['x-who']);
  assert.deepEqual(await anOf(mk('tester', who)), { lea: [200, true], tom: [200, false], anon: [200, false] });
  assert.deepEqual(await anOf(mk('on', who)), { lea: [200, true], tom: [200, true], anon: [200, true] });
  assert.deepEqual(await anOf(mk('', who)), { lea: [200, false], tom: [200, false], anon: [200, false] });
  // the account service down in tester mode: off, never 503
  assert.deepEqual(await anOf(mk('tester', async () => ({ status: 503, error: 'auth-unavailable' }))), { lea: [200, false], tom: [200, false], anon: [200, false] });
  assert.deepEqual(await anOf(mk('tester', async () => { throw new Error('down'); })), { lea: [200, false], tom: [200, false], anon: [200, false] });
  // every endpoint checks it on the server: a non-tester gets the same answer as "off"
  const k = mk('tester', who);
  const f = await k.fragen(lea, { satz: 'Space Invaders mit Segelbooten' });
  assert.equal(f.status, 200);
  assert.equal((await k.fragen(tom, { satz: 'Space Invaders mit Segelbooten' })).body.error, 'off');
  assert.equal((await k.fragen(null, { satz: 'Space Invaders mit Segelbooten' })).body.error, 'off');
  assert.equal((await k.antwort(tom, { id: f.body.id, frage: 1, text: 'Seife' })).body.error, 'off');
  assert.equal((await k.liste(tom, { id: f.body.id, antworten: ANT })).body.error, 'off');
  assert.equal(k.auftrag(tom, { id: f.body.id }).body.error, 'off');
  for (const op of ['optin', 'status', 'nachbessern', 'behalten', 'loeschen']) assert.equal((await k[op](tom, { auftrag: 'A'.repeat(22), push: true, mail: false })).body.error, 'off', op);
  assert.equal((await k.melden(tom, { auftrag: 'A'.repeat(22) })).body.error, 'off');
  assert.equal((await k.liste(lea, { id: f.body.id, antworten: ANT })).status, 200);
  k.stop();
  assert.ok(!JSON.stringify(lines).includes('example.org'), 'addresses are never logged');
});

test('Bau-Worker: ohne angeschlossenen Bau (P3) sagt der Server "nicht-verfuegbar", mit ihm "wartet"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'klaerung-w-'));
  const d = createDuell({ env: {}, salt: 's', log: () => {}, llm: async () => '{}' });
  Object.assign(d.shared, { age16: () => true, mod: { canCreate: () => ({ ok: true }) }, credit: { available: () => 5, spend: () => true, refund: () => true } });
  const k = createKlaerung({ env: { DUELL_KLAERUNG: 'on', DUELL_KLAERUNG_DIR: dir }, shared: d.shared, who: async () => P, llm: fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste() }), log: () => {} });
  const ohne = async () => { const f = await k.fragen(P, { satz: 'Space Invaders mit Segelbooten' }); await k.liste(P, { id: f.body.id, antworten: ANT }); return k.auftrag(P, { id: f.body.id }).body; };
  const a = await ohne();
  assert.equal(a.bau, 'nicht-verfuegbar');
  assert.deepEqual(k.status(P, { auftrag: a.auftrag }).body, { error: 'kein-ergebnis', bau: 'nicht-verfuegbar' });
  withBau(k, d.shared, dir);
  assert.equal((await ohne()).bau, 'wartet');
  k.stop();
});
