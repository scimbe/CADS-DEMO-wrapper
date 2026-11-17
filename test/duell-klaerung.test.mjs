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
import { createKlaerung, fileHandoff, ohneVerneinung, MOD_KLAERUNG, ARCADE } from '../lib/duell-klaerung.mjs';
import { KINDS } from '../lib/duell-ai.mjs';
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
function setup({ llm = fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste() }), env = {}, age16 = () => true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'klaerung-'));
  const d = createDuell({ env: {}, salt: 's', log: () => {}, llm: async () => '{}' });
  Object.assign(d.shared, { age16, mod: { canCreate: () => ({ ok: true }) } });
  const k = createKlaerung({ env: { DUELL_KLAERUNG: 'on', DUELL_KLAERUNG_DIR: dir, DUELL_ADMIN_TOKEN: 'admin-token-123456', ...env }, shared: d.shared, who: async (req) => (req.headers['x-acct'] ? { ...P, acct: req.headers['x-acct'] } : { account: false }), llm, log: () => {} });
  return { k, llm, dir, store: fileHandoff(dir) };
}
const ANT = [{ art: 'kachel', kachel: 0 }, { art: 'eigen', text: 'Wasserbomben, die bunt platzen' }, { art: 'egal' }];
async function toOrder(s) {
  const f = await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten', lang: 'de' });
  const l = await s.k.liste(P, { id: f.body.id, antworten: ANT });
  assert.equal(l.status, 200, JSON.stringify(l.body));
  const a = s.k.auftrag(P, { id: f.body.id });
  return { f, l, a };
}
/** P3 writes the result through the store; here test data with one missing point */
function withResult(s, id, fehlt = true) {
  const o = s.store.get(id);
  o.ergebnis = { titel: 'Segelboot gegen Piraten', punkte: o.punkte.map((x, i) => ({ id: x.id, erfuellt: !(fehlt && i === 2), notiz: fehlt && i === 2 ? 'bleibt gleich schnell' : '' })) };
  s.store.put(o);
}

test('Verneinung: "ohne Blut", "keine echten Waffen" blocken S1 nicht; doppelte Verneinung und Blut ohne Verneinung schon', () => {
  const s1 = (t) => KINDS.karte.s1(ohneVerneinung(t), false);
  for (const t of ['Space Invaders ohne Blut', 'ein Spiel ohne Blut und ohne Waffen', 'kein Blut bitte', 'Piraten, aber keine echten Waffen', 'ohne Blut, ohne Tote', 'a shooter without blood or guns', 'Wasserbomben, die bunt platzen', 'Seifenblasen', 'Kanonenkugeln, die nur Holz treffen'])
    assert.equal(s1(t), '', t);
  for (const t of ['mit viel Blut', 'nicht ohne Blut', 'ohne Gnade, mit Blut', 'ohne Blut, aber mit Waffen']) assert.notEqual(s1(t), '', t);
  // the negation never hides other categories: sexual words stay
  assert.equal(s1('oben ohne'), 'sexual');
  // the model always rates the text as typed: the arcade block is part of its fixed prefix
  assert.equal(MOD_KLAERUNG.at(-1).text, ARCADE); assert.equal(MOD_KLAERUNG.at(-1).cache, true);
});

test('aus ohne Schalter, Login, 16+; Fragen kommen geprueft mit fester Praefix (Cache) und Satz nur im User-Turn', async () => {
  const off = createKlaerung({ env: {}, shared: createDuell({ env: {}, salt: 's', log: () => {} }).shared, who: async () => P, llm: fakeLlm(), log: () => {} });
  assert.equal(off.on(), false); assert.equal((await off.fragen(P, { satz: 'xyz abc' })).body.error, 'off');
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
  assert.deepEqual(s.k.auftrag(P, { id: f.body.id }).body.auftrag, a.body.auftrag);
  const o = JSON.parse(readFileSync(join(s.dir, a.body.auftrag + '.json'), 'utf8'));
  assert.equal(o.v, K.AUFTRAG_V); assert.equal(o.status, 'bestaetigt'); assert.equal(o.owner, P.acct); assert.ok(!JSON.stringify(o).includes(P.mail), 'no e-mail in the order');
  assert.deepEqual(o.punkte, l.body.punkte); assert.equal(o.satz, 'Space Invaders mit Segelbooten');
  assert.deepEqual(o.fragen[1].antwort, { art: 'eigen', text: 'Wasserbomben, die bunt platzen' });
  assert.deepEqual(o.fragen[0].antwort, { art: 'kachel', kachel: 0, label: 'Ein Segelboot' });
  assert.deepEqual(o.kosten, { guthaben: 1, nurBeiErfolg: true, abgebucht: false });
  assert.deepEqual(o.optin, { push: false, mail: false }, 'no consent until ticked');
  assert.deepEqual(s.k.optin(P, { auftrag: a.body.auftrag, push: true, mail: false }).body.optin, { push: true, mail: false });
  assert.equal(s.store.get(a.body.auftrag).optin.push, true);
  assert.equal(s.k.optin({ ...P, acct: 'aAnderer123' }, { auftrag: a.body.auftrag, push: true, mail: true }).status, 404);
  assert.equal(s.k.optin(P, { auftrag: a.body.auftrag, push: 'ja', mail: false }).status, 400);
  // without a list there is no order
  const f2 = await s.k.fragen(P, { satz: 'Umfrage: Wohin am Samstag?' });
  assert.equal(s.k.auftrag(P, { id: f2.body.id }).status, 410);
});

test('Nachbessern: hoechstens 3x, im Server gezaehlt; der 4. Versuch wird abgelehnt, erst dann Melden', async () => {
  const s = setup();
  const { a } = await toOrder(s);
  const id = a.body.auftrag;
  assert.equal(s.k.status(P, { auftrag: id }).body.error, 'kein-ergebnis');
  withResult(s, id);
  const st = s.k.status(P, { auftrag: id });
  assert.equal(st.body.nachbessernLeft, 3); assert.equal(st.body.ergebnis.fehlt, 1);
  assert.equal((await s.k.melden(P, { auftrag: id, text: 'zu frueh' })).body.error, 'noch-nachbessern', 'report only after the repairs');
  assert.equal(s.k.nachbessern(P, { auftrag: id }).body.nachbessernLeft, 2);
  assert.equal(s.k.nachbessern(P, { auftrag: id }).body.nachbessernLeft, 1);
  assert.equal(s.k.nachbessern(P, { auftrag: id }).body.nachbessernLeft, 0);
  const fourth = s.k.nachbessern(P, { auftrag: id });
  assert.equal(fourth.status, 409); assert.equal(fourth.body.error, 'limit');
  assert.equal(s.store.get(id).nachbessert, 3, 'the 4th try changed nothing');
  // a fresh server (restart) keeps the count: it lives with the order, not in the app or in memory
  const s2 = { ...s, k: createKlaerung({ env: { DUELL_KLAERUNG: 'on', DUELL_KLAERUNG_DIR: s.dir }, shared: Object.assign(createDuell({ env: {}, salt: 's', log: () => {} }).shared, { age16: () => true }), who: async () => P, llm: fakeLlm(), log: () => {} }) };
  assert.equal(s2.k.status(P, { auftrag: id }).body.nachbessernLeft, 0);
  assert.equal(s2.k.nachbessern(P, { auftrag: id }).body.error, 'limit');
  // nothing missing: nothing to repair
  const s3 = setup(); const o3 = await toOrder(s3); withResult(s3, o3.a.body.auftrag, false);
  assert.equal(s3.k.nachbessern(P, { auftrag: o3.a.body.auftrag }).body.error, 'nichts-fehlt');
});

test('Melden: Text optional, gleiche Moderation, gespeichert mit Liste und fehlt-Punkten, Harness-Datensatz, Pruefansicht; Karte kostenlos, Behalten bleibt', async () => {
  const s = setup({ llm: fakeLlm({ klaerung_fragen: FRAGEN, klaerung_liste: liste(), check: (req) => (/Idioten/.test(req.user) ? { json: { risk: 2, cats: ['harassment'], drink: 'none' } } : OK_MOD) }) });
  const { a } = await toOrder(s);
  const id = a.body.auftrag;
  withResult(s, id);
  for (let i = 0; i < 3; i++) s.k.nachbessern(P, { auftrag: id });
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
  assert.equal(s.k.nachbessern(P, { auftrag: id }).body.error, 'abgeschlossen');
  // no text at all is fine (no required fields)
  const t = setup(); const o2 = await toOrder(t); withResult(t, o2.a.body.auftrag);
  for (let i = 0; i < 3; i++) t.k.nachbessern(P, { auftrag: o2.a.body.auftrag });
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

test('Tageskappe und Sperre nach harten Absagen', async () => {
  const s = setup({ env: { DUELL_KLAERUNG_PER_DAY: '2' } });
  await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' }); await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' });
  assert.equal((await s.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' })).body.error, 'daily-cap');
  const t = setup();
  for (let i = 0; i < 3; i++) assert.equal((await t.k.fragen(P, { satz: 'ein Spiel mit nackten Leuten' })).body.error, 'blocked');
  assert.equal((await t.k.fragen(P, { satz: 'Space Invaders mit Segelbooten' })).body.error, 'throttled');
});
