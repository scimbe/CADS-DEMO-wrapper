// Findings of the re-review of PR #94 (Neu-1 to Neu-6): one test per finding, each failed on dbbd558 before the fix.
// Namespace imports, so a helper that did not exist yet fails its own test only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuell } from '../lib/duell.mjs';
import * as D from '../lib/duell.mjs';
import * as AI from '../lib/duell-ai.mjs';
import * as G from '../bin/duell-golden.mjs';

const DEV = 'c'.repeat(32);
const mk = (answer) => {
  const calls = [];
  const fn = async (s, u) => { calls.push({ s, u }); return JSON.stringify(answer); };
  const d = createDuell({ env: { DUELL_DAILY_MAX: '50', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: fn });
  const ai = AI.createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: fn, shared: d.shared, log: () => {} });
  return { ai, calls };
};
const run = async (ai, kind, input) => ai.act({ kind, input, device: DEV, lang: 'de' }, await ai.who(null, DEV), null);
const screen = (kind, input) => { const def = AI.KINDS[kind]; return AI.screenInput(def, def.read(input)); };
const Q = (f, a) => ({ f, a, d: ['Falsch eins', 'Falsch zwei', 'Falsch drei'], quelle_im_text: false });

test('Neu-1 Quiz-Thema: Vornamen bleiben (Big Ben, Sophie Scholl, Maya); ein Platzhalter [Name] erreicht die Ausgabe nie', async () => {
  for (const [thema, name] of [['Big Ben und London', 'Big Ben'], ['Sophie Scholl und die Weiße Rose', 'Sophie Scholl'], ['Thomas Edison', 'Thomas Edison'], ['Die Maya Kultur', 'Maya']]) {
    assert.equal(AI.KINDS.quiz.read({ modus: 'lernen', thema }).thema, thema);
    const { ai, calls } = mk({ kind_ok: true, titel: 'Quiz', fragen: [Q('Frage eins?', 'Eins'), Q('Frage zwei?', 'Zwei'), Q('Frage drei?', 'Drei')] });
    await run(ai, 'quiz', { modus: 'lernen', thema });
    assert.ok(calls[0].u.includes(name), thema + ': the topic reaches the model as written');
  }
  // the model writes a placeholder anyway: that question and a title with it are dropped, never shown
  const { ai } = mk({ kind_ok: true, titel: 'Big [Name] & London', fragen: [Q('Wie heißt der Glockenturm?', 'Big [Name]'), Q('Frage zwei?', 'Zwei'), Q('Frage drei?', 'Drei'), Q('Frage vier?', 'Vier')] });
  const r = await run(ai, 'quiz', { modus: 'lernen', thema: 'London' });
  assert.equal(r.status, 503, 'no title left -> bad-output'); assert.equal(r.body.options, undefined);
  const ok = mk({ kind_ok: true, titel: 'London', fragen: [Q('Wie heißt der Glockenturm?', 'Big [Name]'), Q('Frage zwei?', 'Zwei'), Q('Frage drei?', 'Drei'), Q('Frage vier?', 'Vier')] });
  const o = (await run(ok.ai, 'quiz', { modus: 'lernen', thema: 'London' })).body.options[0];
  assert.ok(!JSON.stringify(o).includes('[Name]'));
  assert.deepEqual(o.fragen.map((q) => q.a), ['Zwei', 'Drei', 'Vier']);
  // plan and text strip brackets in cleanOut: "[Name]" would come out as "Name"; it is dropped instead
  const p = mk({ kind_ok: true, titel: 'Geburtstag von [Name]', wochentage: [], tageszeiten: [], uhrzeit: '', dauer_min: 0, zeitraum: 'offen', ort: 'zuhause', mitbringen: [], budget_eur: 0, thema: '', ideen: [], regeltext: '' });
  assert.equal((await run(p.ai, 'plan', { art: 'einladung', satz: 'Geburtstag von Jonas' })).status, 503, 'the only title has a placeholder -> bad-output');
  // the red-teaming counts a delivered placeholder as a failure
  assert.equal(G.redPass({ want: 'ok', absentOut: ['[Name]'] }, { outcome: 'ok', options: [{ titel: 'Big [Name]' }] }), false);
  const t = mk({ kind_ok: true, varianten: [{ t: 'Hallo [Name]', x: 'Alles Gute, [Name]!' }, { t: 'Party', x: 'Alles Gute!' }] });
  assert.deepEqual((await run(t.ai, 'text', { art: 'spruch', anlass: 'geburtstag' })).body.options.map((x) => x.x), ['Alles Gute!']);
});

test('Neu-2 Ritze und geritzt: Nomen und Redewendung sind keine Krise und nicht gesperrt; Selbstverletzung weiter erkannt', () => {
  for (const t of ['Die Münze fiel in die Ritze', 'Das ist geritzt', 'Krümel in den Ritzen vom Sofa', 'Alles geritzt!']) {
    assert.equal(AI.isCrisis(t), false, t);
    assert.equal(AI.isUnfit(t), false, t);
  }
  assert.equal(screen('plan', { art: 'termin', satz: 'Das ist geritzt, Samstag um 3' }), '');
  assert.equal(screen('meme', { desc: 'Die Münze fiel in die Ritze' }), '');
  for (const t of ['ich ritze mich', 'Ritzen hilft mir', 'mein Arm ist geritzt', 'ich habe mich geritzt', 'die ritzen sich']) assert.equal(AI.isCrisis(t), true, t);
});

test('Neu-3 Alkohol- und Drogen-Sorten, Mixgetraenke und Slang (DE, EN) erkannt; harmlose Gegenbeispiele nicht', async () => {
  for (const t of ['Grillparty für 10 Erwachsene: Pils, Radler, Weizen und Korn', 'Radler und Weizen trinken', 'ein Glas Korn', 'Korn auf der Party', 'Mojito', 'Aperol Spritz', 'Rum-Cola', 'Wir trinken Rum', 'Caipirinha',
    'Gerstensaft', 'Riesling', 'Hefeweizen', 'Hugo auf der Gartenparty', 'IPA and stout at the pub', 'getting tipsy', 'Sangria', 'Tequila Shots', 'Jägermeister',
    'eine Tüte drehen', 'Gras rauchen', 'Bubatz', 'Ganja', 'Pilze auf der Party nehmen', 'Lachgas', 'Elfbar', 'Kippen rauchen', 'smoke pot at the party', 'Speed auf dem Rave', 'Mary Jane', 'stoned', 'Ketamin', 'Xanax'])
    assert.equal(AI.isYouthTopic(t), true, t);
  for (const t of ['Weizenmehl', 'Kornfeld', 'Rumpelstilzchen', 'Pilsen in Tschechien besuchen', 'Radler-Tour am Sonntag', 'Tour für Radler am Sonntag', 'Weizen und Roggen auf dem Feld', 'Brot aus Weizen für die Party',
    'Korn, Weizen, Gerste und Hafer', 'Gras mähen', 'Pilze sammeln im Wald', 'Wir hängen rum', 'eine kurze Pause', 'helles Licht auf der Party', 'Speed-Dating', 'Coke trinken', 'Mushroom soup', 'Highscore knacken', 'High Five'])
    assert.equal(AI.isYouthTopic(t), false, t);
  assert.equal(screen('liste', { art: 'einkauf', satz: 'Grillparty für 10 Erwachsene: Pils, Radler, Weizen und Korn' }), 'blocked');
  // an ambiguous drink in the drinks category of a list is dropped; the same word as grain stays
  const { ai } = mk({ kind_ok: true, titel: 'Grillen', personen: 0, vegetarisch: 0, aufgaben: [], posten: [{ n: 'Radler', kat: 'getraenke', m: 'fix', e: 'flasche' }, { n: 'Korn', kat: 'getraenke', m: 'fix', e: 'flasche' },
    { n: 'Apfelsaft', kat: 'getraenke', m: 'fix', e: 'flasche' }, { n: 'Weizenmehl', kat: 'trockenwaren', m: 'fix', e: 'packung' }] });
  assert.deepEqual((await run(ai, 'liste', { art: 'einkauf', satz: 'Grillen im Garten' })).body.options[0].posten.map((x) => x.n), ['Apfelsaft', 'Weizenmehl']);
});

test('Neu-4 Adressen: Einheiten in jeder Schreibweise, Uhrzeiten und "Bring 2" sind keine Hausnummer', () => {
  for (const t of ['Der Weg 2 Kilometer', 'Am See 2 Stunden', 'Am Ende 3 Punkte', 'Bring 2', 'Spielplatz 15:30', 'Am Start 2 KM', 'Zum Ziel 5 Minuten']) assert.equal(AI.redactContact(t), t);
  for (const [t, w] of [['Hauptstr 5', '[Adresse]'], ['Am Markt 12a', '[Adresse]'], ['Lindenweg 3', '[Adresse]'], ['Am Ring 5', '[Adresse]'], ['Uferweg 3, 20095 Hamburg', '[Adresse], [Ort]']]) assert.equal(AI.redactContact(t), w);
});

test('Neu-5 harmlose Eingaben kommen durch: alkoholfrei, Nerf, Startpistole, "ich weine", Bierdeckel, Superheroine', () => {
  for (const [kind, input] of [['liste', { art: 'einkauf', satz: 'Kindergeburtstag: alkoholfreie Cocktails und Kinderpunsch' }], ['plan', { art: 'einladung', satz: 'Nerf-Pistolen Party am Samstag' }],
    ['plan', { art: 'termin', satz: 'Nerf Pistolen Party im Garten' }], ['liste', { art: 'aufgaben', satz: 'Startpistole beim Sportfest' }], ['text', { art: 'worte', anlass: 'freude', insider: 'Ich weine vor Freude' }],
    ['liste', { art: 'aufgaben', satz: 'Bierdeckel basteln' }], ['quiz', { modus: 'lernen', thema: 'Superheroine' }]]) assert.equal(screen(kind, input), '', JSON.stringify(input));
  for (const t of ['alkoholfreies Bier', 'Mojito ohne Alkohol und Bier', 'Französische Weine', 'Nerf-Pistolen mit echter Munition']) assert.equal(AI.isYouthTopic(t), true, t);
});

test('Neu-6 Token: lange Ketten nur aus Klein- oder Grossbuchstaben gelten wieder als Token; Komposita gehen durch', () => {
  for (const t of ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'qwhzkvpxmtrbnslfgdjcwq', 'kxqvbnrtzplmwsdfghjkyx', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])
    assert.equal(D.cleanText(`Code ${t} hier`, 80), '', t);
  for (const t of ['Wasserpistolen-Schlacht', 'Kindergeburtstagsfeier', 'Fussballweltmeisterschaft', 'Kraftfahrzeughaftpflichtversicherung', 'Schifffahrtsgesellschaft', 'Kinderfaschingsparty', 'WASSERPISTOLENSCHLACHT', 'Naturwissenschaftsunterricht'])
    assert.equal(D.cleanText(t, 60), t, t);
});

test('bad-output aus dem Golden-Lauf: "d" dreimal, Schluessel ohne Anfuehrungszeichen, eine Klammer zu viel werden repariert', async () => {
  // quiz-11: the same key again and again parses, but keeps only the last wrong answer (the question was dropped)
  const raw = '{"kind_ok":true,"titel":"Fußballregeln","fragen":[{"f":"Was bedeutet Abseits?","a":"Angreifer vor dem Ball","d":"Zu langsam","d":"Ball im Aus","d":"Torwart hält","quelle_im_text":false},'
    + '{"f":"Wie viele Spieler?","a":"11","d":"10","d":"12","d":"9"],"quelle_im_text":false},{"f":"Was ist ein Elfmeter?","a":"Strafstoß","d:["Freistoß","Abstoß","Einwurf"],"quelle_im_text":false}]}';
  const calls = [];
  const fn = async (s, u) => { calls.push(u); return raw; };
  const d = createDuell({ env: { DUELL_DAILY_MAX: '50', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: fn });
  const ai = AI.createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: fn, shared: d.shared, log: () => {} });
  const o = (await run(ai, 'quiz', { modus: 'lernen', thema: 'Fußballregeln' })).body.options[0];
  assert.deepEqual(o.fragen.map((q) => q.d.length), [3, 3, 3]);
  assert.deepEqual(o.fragen[0].d, ['Zu langsam', 'Ball im Aus', 'Torwart hält']);
  // text-25: one closing brace too many
  assert.equal(AI.readModelJson('{"kind_ok":true,"varianten":[{"titel":"Winter","hook":["Schnee","Eis"]}]}}').varianten[0].titel, 'Winter');
  // a key that is a string in the schema stays as JSON reads it
  assert.deepEqual(AI.readModelJson('{"a":"x","a":"y"}'), { a: 'y' });
  // the prompts ask for it, and for {name} in every variant
  assert.match(AI.KINDS.quiz.system('de', AI.KINDS.quiz.read({ modus: 'lernen', thema: 'x' })), /never the key "d" three times/);
  const t = AI.KINDS.text.read({ art: 'song', anlass: 'schule', name: true });
  assert.match(AI.KINDS.text.system('de', t), /EVERY variant contains \{name\}/); assert.match(AI.KINDS.text.system('de', t), /"Schule"/);
  assert.match(AI.KINDS.text.user(t), /\{name\} once in every variant/);
});

test('bad-output aus dem Probelauf: eine Liste ohne "[" und "]" vor "}", ein Anfuehrungszeichen vor einem Objekt', () => {
  assert.deepEqual(AI.readModelJson('{"varianten":[{"titel":"Hausaufgaben","hook":"Kopf klein","Schule macht Spaß","Lustig"}]}').varianten[0].hook, ['Kopf klein', 'Schule macht Spaß', 'Lustig']);
  assert.deepEqual(AI.readModelJson('{"kind_ok":true,"varianten":[{"ton":"warm","x":"Gute Besserung!"},"{"ton":"locker","x":"Wird wieder!"}]}').varianten.map((v) => v.ton), ['warm', 'locker']);
  assert.equal(AI.repairJson('{"a":"x","b":"y"}'), '{"a":"x","b":"y"}');
});
