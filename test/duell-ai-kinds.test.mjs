// The five structured AI kinds (plan, liste, quiz, welt, text): schema, numbers only from the input, kind_ok, caps,
// placeholders, cache, profile context, cost, red-teaming, the golden set's shape and the s2 seal with optionHash.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi, repairJson, KINDS, PLAN, LISTE, WELT, TEXT, CRISIS_HELP, fit, inText, isCrisis, isMean, redactContact, screenInput, statedNumbers } from '../lib/duell-ai.mjs';
import { createReports } from '../lib/duell-report.mjs';
import { makeSealer, optionHash, HASH_RE } from '../lib/duell-seal.mjs';
import { at, check, GOLDEN, verdict } from '../bin/duell-golden.mjs';

const DEV = 'a'.repeat(32);
const NEW = ['plan', 'liste', 'quiz', 'welt', 'text'];
const ANSWERS = {
  plan: { kind_ok: true, titel: 'Grillabend', wochentage: ['sa', 'xx'], tageszeiten: ['abends'], uhrzeit: '17:00', dauer_min: 120, zeitraum: 'naechstes_wochenende', ort: 'zuhause', mitbringen: ['salat', 'bier'], budget_eur: 0, thema: '', ideen: ['buch'], regeltext: '' },
  liste: { kind_ok: true, titel: 'Grillabend', personen: 8, vegetarisch: 2, posten: [{ n: 'Bratwurst', kat: 'fleisch_fisch', m: 'pro_person', e: 'stueck', veg: false, menge: 16 }, { n: 'Grillkaese', kat: 'vegetarisch', m: 'pro_person', e: 'stueck', veg: true }, { n: 'Bratwurst', kat: 'fleisch_fisch', m: 'fix', e: 'stueck' }, { n: 'Bier', kat: 'getraenke', m: 'fix', e: 'flasche' }], aufgaben: [{ was: 'Grill putzen', frist: 'am_tag', wer: 'Papa' }] },
  quiz: { kind_ok: true, titel: 'Photosynthese', fragen: [1, 2, 3].map((i) => ({ f: `Frage ${i}?`, a: 'Sauerstoff', d: ['Helium', 'Sauerstoff', 'Stickstoff', 'Neon', 'Argon'], quelle_im_text: true })) },
  welt: { kind_ok: true, gravity: 2100, flapPower: 500, pipeGap: 100, pipeSpeed: 200, theme: 'night', emoji: '🦈', title: 'Tiefsee', route: [{ physik: 'ruhig', thema: 'night', emoji: '🐠' }, { physik: 'warp', thema: 'day', emoji: '🐙' }, { physik: 'sturm', thema: 'retro', emoji: '🐳' }] },
  text: { kind_ok: true, varianten: [{ ton: 'warm', x: '{name}, du bist nicht allein. Ich denke an dich und bin da, wann immer du mich brauchst, versprochen!' }, { ton: 'locker', x: 'Hey { name }, ich bin da.' }, { ton: 'kurz', x: 'Halt durch, 你好' }] },
};
const INPUTS = {
  plan: { art: 'einladung', satz: 'Grillparty bei mir naechsten Samstag ab 17 Uhr, bringt Salat mit' },
  liste: { art: 'einkauf', satz: 'Grillabend fuer 8, 2 vegetarisch' },
  quiz: { modus: 'lernen', text: 'Die Photosynthese findet in den Chloroplasten statt. Als Nebenprodukt wird Sauerstoff abgegeben, den wir atmen.' },
  welt: { satz: 'Tiefsee mit Haien' },
  text: { art: 'worte', anlass: 'trost', name: true },
};
const mk = ({ answer, llm, env = {} } = {}) => {
  const calls = [];
  const fn = llm || (async (s, u, o) => { calls.push({ s, u, o }); return JSON.stringify(typeof answer === 'function' ? answer(s, u) : answer); });
  const d = createDuell({ env: { DUELL_DAILY_MAX: '50', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: fn });
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0', ...env }, llm: fn, shared: d.shared, log: () => {} });
  return { d, ai, calls };
};
const run = async (ai, kind, input, lang = 'de') => ai.act({ kind, input, device: DEV, lang }, await ai.who(null, DEV), null);

test('Fuenf Arten: jede liefert gepruefte Struktur, Siegel s2 und optionHash je Option', async () => {
  for (const kind of NEW) {
    const { ai, d, calls } = mk({ answer: ANSWERS[kind] });
    const r = await run(ai, kind, INPUTS[kind]);
    assert.equal(r.status, 200, kind + ' ' + JSON.stringify(r.body));
    assert.ok(r.body.options.length >= 1);
    assert.equal(r.body.seals.length, r.body.options.length);
    r.body.options.forEach((o, i) => {
      assert.match(r.body.seals[i], /^s2\./);
      assert.match(r.body.hashes[i], HASH_RE);
      assert.equal(r.body.hashes[i], optionHash(o));
      assert.equal(d.shared.sealer.verify(r.body.seals[i], o).valid, true, kind + ': seal over the option');
      assert.equal(d.shared.sealer.verifyHash(r.body.seals[i], r.body.hashes[i]).valid, true, kind + ': seal over the hash');
    });
    assert.match(calls[0].u, /minified JSON/);
    assert.match(calls[0].s, /kind_ok/);
  }
});

test('plan: nur Regeln aus festen Listen; Uhrzeit und Budget nur, wenn sie in der Eingabe stehen; temperature 0.1', async () => {
  const { ai, calls } = mk({ answer: ANSWERS.plan });
  const o = (await run(ai, 'plan', INPUTS.plan)).body.options[0];
  assert.deepEqual(o.wochentage, ['sa']);
  assert.equal(o.uhrzeit, '17:00');
  assert.deepEqual(o.mitbringen, ['salat'], 'not on the list -> dropped');
  assert.deepEqual(o.ideen, [], 'gift ideas only for wichteln');
  assert.equal(calls[0].o.temperature, 0.1);
  assert.ok(!/\d{4}-\d\d-\d\d/.test(JSON.stringify(o)), 'never a date');
  const made = mk({ answer: { ...ANSWERS.plan, uhrzeit: '19:30', budget_eur: 30, dauer_min: 100, zeitraum: '2026-12-24', ort: 'Lindenweg 3' } });
  const p = (await run(made.ai, 'plan', { art: 'wichteln', satz: 'Wichteln in der Klasse, 10 Euro' })).body.options[0];
  assert.equal(p.uhrzeit, '', 'a time the input does not name is dropped');
  assert.equal(p.budget_eur, 0, 'a computed or invented budget is dropped');
  assert.equal(p.dauer_min, 0); assert.equal(p.zeitraum, 'offen'); assert.equal(p.ort, 'offen');
  const ok = mk({ answer: { ...ANSWERS.plan, budget_eur: 10, ideen: ['buch', 'auto', 'suesses'], regeltext: 'Jeder zieht einen Namen, Geschenk bis 10 Euro.' } });
  const w = (await run(ok.ai, 'plan', { art: 'wichteln', satz: 'Wichteln in der Klasse, zehn Euro' })).body.options[0];
  assert.equal(w.budget_eur, 10, 'number words count as stated'); assert.deepEqual(w.ideen, ['buch', 'suesses']); assert.deepEqual(w.mitbringen, []);
  assert.match(w.regeltext, /Geschenk bis 10 Euro/);
});

test('liste: Posten mit Kategorie und Mengen-Schluessel, keine berechnete Menge; Personen nur wie angegeben; Aufgaben ohne Namen', async () => {
  const { ai } = mk({ answer: ANSWERS.liste });
  const o = (await run(ai, 'liste', INPUTS.liste)).body.options[0];
  assert.equal(o.personen, 8); assert.equal(o.vegetarisch, 2);
  assert.deepEqual(o.posten.map((p) => p.n), ['Bratwurst', 'Grillkaese'], 'duplicates and alcohol (13+) are dropped');
  for (const p of o.posten) { assert.deepEqual(Object.keys(p).sort(), ['e', 'kat', 'm', 'n', 'veg']); assert.ok(LISTE.menge.includes(p.m)); assert.ok(LISTE.kat.includes(p.kat)); }
  assert.deepEqual(o.aufgaben, [], 'an Einkauf has no tasks');
  const sum = mk({ answer: { ...ANSWERS.liste, personen: 8 } });
  assert.equal((await run(sum.ai, 'liste', { art: 'einkauf', satz: 'Grillen mit 4 Erwachsenen und 4 Kindern' })).body.options[0].personen, 0, '4 + 4 is the page\'s sum, not the model\'s');
  const tasks = mk({ answer: { ...ANSWERS.liste, posten: [], aufgaben: [{ was: 'Einladungen schreiben', frist: '2_wochen_vorher', wer: 'Mama' }, { was: 'Kuchen backen', frist: 'gestern' }] } });
  const t = (await run(tasks.ai, 'liste', { art: 'aufgaben', satz: 'Kindergeburtstag im Garten' })).body.options[0];
  assert.deepEqual(t.aufgaben, [{ was: 'Einladungen schreiben', frist: '2_wochen_vorher', wer: '' }, { was: 'Kuchen backen', frist: 'offen', wer: '' }]);
});

test('quiz: Distraktoren ohne die Antwort, quelle_im_text vom Code geprueft, eigener Text nie im Cache, kostet mindestens 2', async () => {
  const { ai, calls } = mk({ answer: ANSWERS.quiz });
  const r = await run(ai, 'quiz', INPUTS.quiz);
  const q = r.body.options[0].fragen[0];
  assert.deepEqual(q.d, ['Helium', 'Stickstoff', 'Neon'], 'the answer is no distractor, three at most');
  assert.equal(q.quelle_im_text, true, 'Sauerstoff stands in the text');
  assert.equal(r.body.cost, 2, 'a question set costs 2 at least');
  assert.equal((await run(ai, 'quiz', INPUTS.quiz)).headers['X-Duell-Cache'], 'miss', 'own text: never cached');
  assert.equal(calls.length, 2);
  const claim = mk({ answer: { ...ANSWERS.quiz, fragen: ANSWERS.quiz.fragen.map((f) => ({ ...f, a: 'Mitochondrien' })) } });
  assert.equal((await run(claim.ai, 'quiz', INPUTS.quiz)).body.options[0].fragen[0].quelle_im_text, false, 'the model claims it, the text does not say it');
  const topic = mk({ answer: ANSWERS.quiz });
  const t1 = await run(topic.ai, 'quiz', { modus: 'lernen', thema: 'Photosynthese' });
  assert.equal(t1.body.options[0].fragen[0].quelle_im_text, false, 'no text, no source');
  assert.equal((await run(topic.ai, 'quiz', { modus: 'lernen', thema: '  photosynthese ' })).headers['X-Duell-Cache'], 'hit', 'a topic is cached by its normalised form');
  // a biology text may name alcohol: only the hard filter for own text, the youth list for a topic
  const bio = mk({ answer: ANSWERS.quiz });
  assert.equal((await run(bio.ai, 'quiz', { modus: 'lernen', text: 'Hefe vergaert Zucker zu Alkohol und Kohlendioxid. Das nennt man alkoholische Gaerung, sie braucht keinen Sauerstoff.' })).status, 200);
  assert.equal((await run(bio.ai, 'quiz', { modus: 'lernen', thema: 'Alkohol trinken' })).status, 422);
  const heart = mk({ answer: { ...ANSWERS.quiz, fragen: [1, 2, 3].map((i) => ({ f: `Wohin pumpt das Herz das Blut ${i}?`, a: 'In die Lunge', d: ['In den Magen', 'In die Leber', 'In die Niere'] })) } });
  assert.equal((await run(heart.ai, 'quiz', { modus: 'lernen', thema: 'Das menschliche Herz' })).body.options[0].fragen.length, 3, 'a biology answer may say Blut');
});

test('quiz gruppe: Ergebnistypen sind Staerken mit gueltigem Index, nie ein echter Name aus der Eingabe', async () => {
  const answer = { kind_ok: true, titel: 'Welcher Teamtyp bist du?', typen: [{ name: 'Die Planerin', staerke: 'Du behaeltst den Ueberblick.' }, { name: 'Der Motor', staerke: 'Du steckst alle an.' }],
    fragen: [1, 2, 3].map((i) => ({ f: `Frage ${i}?`, antworten: [{ t: 'Plan machen', typ: 0 }, { t: 'Loslegen', typ: 1 }, { t: 'Kaputt', typ: 7 }] })) };
  const { ai, calls } = mk({ answer });
  const o = (await run(ai, 'quiz', { modus: 'gruppe', thema: 'Handballteam, Pizza, Zeltlager', text: 'wird ignoriert' })).body.options[0];
  assert.equal(o.typen.length, 2); assert.equal(o.fragen[0].antworten.length, 2, 'an answer pointing to no type is dropped');
  assert.match(calls[0].s, /STRENGTH/); assert.ok(!calls[0].u.includes('wird ignoriert'), 'group mode takes no text');
});

test('welt: Config-Werte wie /api/duell/config plus 3 Abschnitte aus festen Listen, Physik als feste Delta-Stufe', async () => {
  const { ai } = mk({ answer: ANSWERS.welt });
  const o = (await run(ai, 'welt', INPUTS.welt)).body.options[0];
  assert.deepEqual(Object.keys(o).sort(), ['abschnitte', 'emoji', 'params', 'theme', 'title']);
  assert.deepEqual(o.params, { gravity: 2100, flapPower: 500, pipeGap: 100, pipeSpeed: 200 });
  assert.deepEqual(o.abschnitte.map((a) => a.physik), ['ruhig', 'normal', 'sturm'], 'unknown physics -> normal');
  assert.deepEqual(o.abschnitte[2].delta, WELT.physik.sturm);
  const odd = mk({ answer: { ...ANSWERS.welt, route: [{ physik: 'ruhig', thema: 'night', emoji: '💣' }, ...ANSWERS.welt.route.slice(1)] } });
  assert.equal((await run(odd.ai, 'welt', INPUTS.welt)).body.options[0].abschnitte[0].emoji, '🌙', 'an emoji off the list -> the theme\'s fixed emoji');
  const few = mk({ answer: { ...ANSWERS.welt, route: [{ physik: 'ruhig', thema: 'space', emoji: '🐠' }, ...ANSWERS.welt.route.slice(1)] } });
  assert.equal((await run(few.ai, 'welt', INPUTS.welt)).status, 503, 'a theme off the list leaves 2 sections: no world');
});

test('text: 3 Varianten, Laengen-Cap am Wortende, {name} bleibt Platzhalter, fremde Schrift faellt weg, persoenlich nie im Cache', async () => {
  const { ai, calls } = mk({ answer: ANSWERS.text });
  const r = await run(ai, 'text', INPUTS.text);
  const xs = r.body.options.map((o) => o.x);
  assert.equal(xs.length, 2, 'the variant with a foreign script is dropped');
  assert.ok(xs.every((x) => [...x].length <= 80)); assert.match(xs[0], /^\{name\}, du bist nicht allein\. .*[.…]$/, 'cut at a sentence or word, never mid-word');
  assert.equal(xs[1], 'Hey {name}, ich bin da.');
  assert.match(calls[0].s, /\{name\}/);
  assert.equal((await run(ai, 'text', INPUTS.text)).headers['X-Duell-Cache'], 'miss', 'a name makes it personal');
  const plain = mk({ answer: ANSWERS.text });
  await run(plain.ai, 'text', { art: 'worte', anlass: 'trost' });
  assert.equal((await run(plain.ai, 'text', { art: 'worte', anlass: 'trost' })).headers['X-Duell-Cache'], 'hit');
  assert.equal((await run(plain.ai, 'text', { art: 'spruch', anlass: 'roast' })).status, 400, 'only kind occasions exist');
  const song = mk({ answer: { kind_ok: true, varianten: [{ titel: 'Kuchenparty', hook: 'Heute wird gefeiert\nalle singen mit' }], beat: { bpm: 300, k: 'x-x', s: '----x-------x---', fx: 'laser' } } });
  const s = (await run(song.ai, 'text', { art: 'song', anlass: 'geburtstag' })).body.options[0];
  assert.deepEqual(s.hook, ['Heute wird gefeiert', 'alle singen mit']);
  assert.equal(s.beat.bpm, 170); assert.equal(s.beat.k, 'x---x---x---x---'); assert.equal(s.beat.s, '----x-------x---'); assert.equal(s.beat.fx, 'chip');
  assert.equal(fit('Eins zwei drei vier', 10), 'Eins zwei…'); assert.equal(fit('Das ist gut. Und noch mehr Text hier', 20), 'Das ist gut.'); assert.equal(fit('Kurz. Und noch mehr Text hier', 20), 'Kurz. Und noch mehr…');
});

test('kind_ok: false oder fehlend -> 422 blocked, kostet nichts, kein Cache', async () => {
  for (const answer of [{ ...ANSWERS.plan, kind_ok: false }, (() => { const a = { ...ANSWERS.plan }; delete a.kind_ok; return a; })()]) {
    const { ai, calls } = mk({ answer });
    const r = await run(ai, 'plan', INPUTS.plan);
    assert.equal(r.status, 422); assert.equal(r.body.error, 'blocked'); assert.equal(r.body.why, 'kind_ok');
    assert.equal(r.body.meter.remaining, 7, 'a refusal costs nothing');
    await run(ai, 'plan', INPUTS.plan); assert.equal(calls.length, 2, 'a refusal is not cached');
  }
});

test('Profil-Kontext: hoechstens 240 Zeichen als Daten, Kontaktdaten ersetzt, Teil des Cache-Schluessels', async () => {
  const { ai, calls } = mk({ answer: ANSWERS.liste });
  await run(ai, 'liste', { ...INPUTS.liste, ctx: 'Haushalt: 4 Personen; vegetarisch; ' + 'x'.repeat(400) });
  assert.match(calls[0].u, /Profile of the household \(preferences, use when it fits\): <data>Haushalt: 4 Personen; vegetarisch; x+<\/data>/);
  assert.ok(calls[0].u.length < 600);
  await run(ai, 'liste', { ...INPUTS.liste, ctx: 'Haushalt: 2 Personen' });
  assert.equal(calls.length, 2, 'another profile is another cache entry');
  assert.equal((await run(ai, 'liste', { ...INPUTS.liste, ctx: 'mail an a@b.de' })).status, 200);
  assert.match(calls[2].u, /\[E-Mail\]/);
});

test('Englisch: Ausgabesprache im Prompt, sonst gleiche Schemata', async () => {
  const { ai, calls } = mk({ answer: ANSWERS.plan });
  assert.equal((await run(ai, 'plan', INPUTS.plan, 'en')).status, 200);
  assert.match(calls[0].s, /Texts in English/);
  const de = mk({ answer: ANSWERS.plan }); await run(de.ai, 'plan', INPUTS.plan); assert.match(de.calls[0].s, /Texts in German/);
});

test('Red-Teaming offline: Beleidigung, Mobbing, Mutprobe, Gewalt -> 422 ohne Modell; Selbstgefaehrdung -> Hinweis; Adresse -> Platzhalter', async () => {
  const set = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  for (const c of set.redteam) {
    const { ai, calls } = mk({ answer: ANSWERS[c.kind] });
    const r = await run(ai, c.kind, c.input);
    if (c.want === 'blocked') { assert.equal(r.status, 422, c.id); assert.equal(r.body.error, 'blocked', c.id); assert.equal(calls.length, 0, c.id); }
    if (c.want === 'crisis') {
      assert.equal(r.status, 422, c.id); assert.equal(r.body.why, 'crisis', c.id); assert.equal(r.body.help, CRISIS_HELP.de); assert.match(r.body.help, /116 111/);
      assert.equal(calls.length, 0, c.id); assert.equal(r.body.meter.remaining, 7);
    }
    if (c.want === 'bad-request') assert.equal(r.status, 400, c.id);
    if (c.want === 'redacted') { assert.equal(calls.length, 1, c.id); for (const x of c.absent) assert.ok(!calls[0].u.includes(x), `${c.id}: ${x} reached the model`); }
    if (c.want === 'unkind') {   // passes the word lists; the model's kind_ok decides (measured live, bin/duell-golden.mjs --redteam)
      const refuse = mk({ answer: { kind_ok: false } });
      const rr = await run(refuse.ai, c.kind, c.input);
      assert.ok(rr.status === 422, c.id);
    }
  }
  assert.equal(isCrisis('Ich will nicht mehr leben'), true); assert.equal(isCrisis('I want to die'), true);
  assert.equal(isMean('Roast fuer Ben'), true); assert.equal(isMean('Danke fuer alles'), false);
  assert.equal(redactContact('Party, Lindenweg 3, 20095 Hamburg'), 'Party, [Adresse], [Ort]');
  assert.equal(redactContact('Treffen Am Markt 12a'), 'Treffen [Adresse]');
  assert.equal(redactContact('Bringt alles in die Hauptstraße 12 in 10115 Berlin'), 'Bringt alles in die [Adresse] in [Ort]');
  assert.equal(redactContact('Bienen leben in Voelkern mit bis zu 50000 Tieren'), 'Bienen leben in Voelkern mit bis zu 50000 Tieren', 'a number before a noun is no postcode');
  assert.equal(redactContact('PLZ 20095'), '[Ort]');
  assert.equal(redactContact('Grillabend fuer 8, 2 vegetarisch, 500 g'), 'Grillabend fuer 8, 2 vegetarisch, 500 g', 'numbers of a list stay');
});

test('Golden-Set: je Art 30 deutsche Faelle, gueltige Eingaben, Pruefungen wohlgeformt; Pruefsprache', () => {
  const set = JSON.parse(readFileSync(GOLDEN, 'utf8')), ids = new Set();
  const OPS = new Set(['at', 'eq', 'in', 'has', 'hasAny', 'not', 'min', 'max', 'any']);
  for (const kind of NEW) {
    assert.equal(set.kinds[kind].length, 30, kind);
    for (const c of set.kinds[kind]) {
      assert.ok(!ids.has(c.id)); ids.add(c.id);
      const def = KINDS[kind], d = def.read(c.input);
      assert.ok(def.need(d), c.id + ' is a valid input'); assert.equal(screenInput(def, d), '', c.id + ' passes the screens');
      assert.ok(c.expect.length >= 1);
      for (const e of c.expect) { assert.ok(typeof e.at === 'string'); assert.ok(Object.keys(e).every((k) => OPS.has(k)), c.id); assert.ok(Object.keys(e).length === 2, c.id); }
    }
  }
  assert.ok(set.redteam.length >= 15);
  const o = { a: [{ n: 'Grillkäse', k: 'x' }, { n: 'Brot', k: 'y' }], z: 'abends' };
  assert.deepEqual(at(o, 'a.n'), ['Grillkäse', 'Brot']);
  assert.equal(check(o, { at: 'a.n', any: ['kase'] }), '', 'umlauts folded');
  assert.equal(check(o, { at: 'a.k', has: ['x', 'y'] }), ''); assert.notEqual(check(o, { at: 'a.k', not: ['y'] }), '');
  assert.equal(check(o, { at: 'a', min: 2 }), ''); assert.notEqual(check(o, { at: 'z', eq: 'morgens' }), '');
  assert.deepEqual(verdict('text', [{ x: 'Danke dir' }, { x: 'Hallo' }], [{ at: 'x', any: ['dank'] }, { at: '', min: 2 }]), []);
});

test('Hilfen: statedNumbers, inText, repairJson', () => {
  const bad = '{"f":"Was?","a":"Herrschaft","d":"Neue Sportart","Ein Tanzstil","Ein Gericht"],"q":false}';
  assert.deepEqual(JSON.parse(repairJson(bad)).d, ['Neue Sportart', 'Ein Tanzstil', 'Ein Gericht']);
  assert.equal(repairJson('{"a":"x","b":["y"]}'), '{"a":"x","b":["y"]}', 'valid JSON stays as it is');
  const nested = '{"kind_ok":true,"varianten":[{"titel":"A","hook":["x","y"]},{"beat":{"bpm":110}}}';
  assert.deepEqual(JSON.parse(repairJson(nested)).varianten[1], { beat: { bpm: 110 } }, 'a missing ] is closed');
  assert.equal(JSON.parse(repairJson('{"a":["b}",1')).a[0], 'b}', 'brackets in strings do not count');
  assert.deepEqual([...statedNumbers('Grillen fuer acht, 2 vegetarisch, 10 Euro')].sort((a, b) => a - b), [2, 8, 10]);
  assert.equal(inText('In den Chloroplasten', 'Die Photosynthese findet in den Chloroplasten statt.'), true);
  assert.equal(inText('Mitochondrien', 'Die Photosynthese findet in den Chloroplasten statt.'), false);
  assert.equal(inText('1789', 'Die Revolution begann 1789 in Paris.'), true);
  assert.ok(PLAN.zeitraum.includes('offen') && TEXT.anlass.worte.length === 10);
});

// ---- s2 seal: bound to sha256(canonical(option)); report and seal check take optionHash ---------------------------
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'duell-kinds-'));
  const fn = async () => JSON.stringify(ANSWERS.plan);
  const d = createDuell({ env: { DUELL_SEAL_SECRET: 'seal-secret' }, salt: 's', log: () => {}, llm: fn });
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: fn, shared: d.shared, log: () => {} });
  const rep = createReports({ env: { DUELL_REPORT_DIR: join(dir, 'r'), DUELL_ADMIN_TOKEN: 'admin-token-0123456789abcdef' }, shared: d.shared, log: () => {} });
  return { d, ai, rep, dir };
}
test('Siegel s2: optionHash (43 Zeichen) statt Option bei /report und /seal; s1-Siegel bleiben pruefbar (nur mit Inhalt)', async () => {
  const s = setup();
  const r = await run(s.ai, 'plan', INPUTS.plan), seal = r.body.seals[0], h = r.body.hashes[0], option = r.body.options[0];
  assert.equal(h.length, 43);
  const srv = http.createServer(async (q, res) => { const url = new URL(q.url, 'http://x'); if (!(await s.rep.route(q, res, url))) res.writeHead(404).end(); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const post = (p, b) => fetch(`http://127.0.0.1:${srv.address().port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (x) => ({ status: x.status, body: await x.json() }));
  try {
    assert.deepEqual((await post('/api/duell/seal', { seal, optionHash: h })).body.valid, true);
    assert.deepEqual((await post('/api/duell/seal', { seal, content: option })).body.valid, true);
    const other = optionHash({ ...option, titel: 'Anders' });
    assert.equal((await post('/api/duell/seal', { seal, optionHash: other })).body.valid, false);
    assert.equal((await post('/api/duell/seal', { seal, optionHash: h.slice(0, 22) })).body.valid, false, 'a shortened hash is not enough');
    const rep = await post('/api/duell/report', { reason: 'wrong', seal, optionHash: h });
    assert.equal(rep.status, 202);
    const rec = s.rep.open().find((x) => x.id === rep.body.id);
    assert.equal(rec.sealOk, true); assert.equal(rec.kind, 'plan'); assert.equal(rec.content, undefined, 'a hash is no content');
    // an s1 seal (made before s2) still checks against the content, never against a hash
    const old = s.d.shared.sealer.sealV1('wish', { x: 'Hallo' }, Date.now());
    assert.match(old, /^s1\./);
    assert.equal((await post('/api/duell/seal', { seal: old, content: { x: 'Hallo' } })).body.valid, true);
    assert.equal((await post('/api/duell/seal', { seal: old, optionHash: optionHash({ x: 'Hallo' }) })).body.valid, false);
    const r1 = await post('/api/duell/report', { reason: 'wrong', seal: old, option: { x: 'Hallo' } });
    assert.equal(s.rep.open().find((x) => x.id === r1.body.id).sealOk, true);
  } finally { srv.close(); s.rep.stop(); }
  const k = makeSealer('k'), t = Date.parse('2026-11-05T10:00:00Z');
  assert.equal(k.verifyHash(k.seal('plan', { a: 1 }, t), undefined).valid, false);
  assert.equal(k.verifyAny(k.seal('plan', { a: 1 }, t), null, optionHash({ a: 1 })).valid, true);
});
