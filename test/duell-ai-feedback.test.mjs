// liste art feedback (CADS-agent-marketplace PR #135, Daily Business Stufe 2): 3 themes and 1 suggestion from at least
// 5 anonymous notes, never a quote, never a person, never cached; honest criticism is not "mean", a crisis gets help.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi, KINDS, FEEDBACK, CRISIS_HELP, quotes, redactNames, screenInput } from '../lib/duell-ai.mjs';

const DEV = 'b'.repeat(32);
const NOTES = ['Zu lang ohne Pause', 'Ziel war unklar', 'Gute Praxisbeispiele', 'Pausen fehlten', 'Mehr Zeit für Fragen'];
const GOOD = { kind_ok: true, titel: 'Workshop', themen: ['Zeitrahmen', 'Praxisbezug', 'Zielklarheit'], vorschlag: 'Beim nächsten Mal Ziel und Pausen zu Beginn festlegen.', posten: [], aufgaben: [] };
const mk = (answer) => {
  const calls = [];
  const fn = async (s, u, o) => { calls.push({ s, u, o }); return JSON.stringify(typeof answer === 'function' ? answer(s, u) : answer); };
  const d = createDuell({ env: { DUELL_DAILY_MAX: '50', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: fn });
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: fn, shared: d.shared, log: () => {} });
  return { ai, calls };
};
const run = async (ai, notizen) => ai.act({ kind: 'liste', input: { art: 'feedback', notizen }, device: DEV, lang: 'de' }, await ai.who(null, DEV), null);

test('feedback: 3 Themen + 1 Vorschlag, eigener Prompt, Notizen je in <data>', async () => {
  const { ai, calls } = mk(GOOD);
  const r = await run(ai, NOTES);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.options, [{ art: 'feedback', titel: 'Workshop', themen: GOOD.themen, vorschlag: GOOD.vorschlag, posten: [], aufgaben: [] }]);
  assert.match(calls[0].s, /anonymous feedback notes/);
  assert.equal(calls[0].u.match(/<data>/g).length, NOTES.length);
});

test('feedback: erst ab FEEDBACK.least Notizen, hoechstens FEEDBACK.notes, je hoechstens FEEDBACK.note Zeichen', async () => {
  const { ai, calls } = mk(GOOD);
  assert.equal(FEEDBACK.least, 5);
  assert.equal((await run(ai, NOTES.slice(0, 4))).status, 400, '4 notes are not enough');
  assert.equal((await run(ai, [...NOTES.slice(0, 4), ' x '])).status, 400, 'a one-letter note is no note');
  assert.equal(calls.length, 0, 'no model call below the minimum');
  const many = Array.from({ length: 12 }, (_, i) => `Notiz Nummer ${i} ` + 'x'.repeat(80));
  assert.equal((await run(ai, many)).status, 200);
  const sent = calls[0].u.match(/<data>([^<]*)<\/data>/g);
  assert.equal(sent.length, FEEDBACK.notes);
  assert.ok(sent.every((x) => [...x.replace(/<\/?data>/g, '')].length <= FEEDBACK.note));
});

test('feedback: Notizen nie im Cache (zweiter gleicher Aufruf ruft das Modell wieder)', async () => {
  const { ai, calls } = mk(GOOD);
  assert.equal(KINDS.liste.cache({ art: 'feedback' }), false); assert.equal(KINDS.liste.cache({ art: 'einkauf' }), true);
  assert.equal((await run(ai, NOTES)).headers['X-Duell-Cache'], 'miss');
  assert.equal((await run(ai, NOTES)).headers['X-Duell-Cache'], 'miss');
  assert.equal(calls.length, 2);
});

test('feedback: ein zitierendes Thema oder ein zitierender Vorschlag faellt weg; ohne 3 Themen und Vorschlag keine Option', async () => {
  assert.equal(quotes('Pausen fehlten', NOTES, FEEDBACK.run), true, 'a note as a whole');
  assert.equal(quotes('Mehr Zeit fuer Fragen einplanen', NOTES, FEEDBACK.run), true, 'ue = ü, 3 words in a row');
  assert.equal(quotes('Pausen', NOTES, FEEDBACK.run), false, 'one word is a theme');
  assert.equal(quotes('Zeit für Rückfragen', NOTES, FEEDBACK.run), false);
  const quoted = mk({ ...GOOD, themen: ['Zeitrahmen', 'Pausen fehlten', 'Zielklarheit'] });
  assert.equal((await run(quoted.ai, NOTES)).status, 503, 'two themes left: bad-output, nothing charged');
  const tip = mk({ ...GOOD, vorschlag: 'Mehr Zeit für Fragen einplanen und Pausen machen' });
  assert.equal((await run(tip.ai, NOTES)).status, 503);
  const extra = mk({ ...GOOD, themen: ['Zeitrahmen', 'Pausen fehlten', 'Praxisbezug', 'Zielklarheit'] });
  assert.deepEqual((await run(extra.ai, NOTES)).body.options[0].themen, ['Zeitrahmen', 'Praxisbezug', 'Zielklarheit'], 'a fourth theme fills the gap');
});

test('feedback: Namen in Notizen werden vor dem Modell ersetzt (auch Frau/Herr Nachname), ein Name im Ergebnis wird verworfen', async () => {
  const { ai, calls } = mk(GOOD);
  await run(ai, [...NOTES.slice(0, 4), 'Thomas und Kevin redeten dauernd', 'Frau Yilmaz hat gut moderiert', 'Herrn Schulz fragen']);
  assert.doesNotMatch(calls[0].u, /Thomas|Kevin|Yilmaz|Schulz/);
  assert.match(calls[0].u, /\[Name\] und \[Name\]/);
  assert.equal(redactNames('Frau Dr. Yilmaz und Hr. Meier'), '[Name] und [Name]');
  assert.equal(redactNames('Herr der Ringe, Frau sein'), 'Herr der Ringe, Frau sein', 'only a capitalised name after the title');
  const named = mk({ ...GOOD, vorschlag: 'Thomas soll kürzer sprechen.' });
  assert.equal((await run(named.ai, NOTES)).status, 503);
});

test('feedback: ehrliche Kritik ist nicht "gemein" und wird nicht gesperrt (eigener Screen ohne isMean)', async () => {
  for (const note of ['Die Übung war dumm', 'Lächerlich lang', 'Ich hasse Montagsmeetings', 'Mobbing im Team ansprechen']) {
    const data = KINDS.liste.read({ art: 'feedback', notizen: [...NOTES.slice(0, 4), note] });
    assert.equal(screenInput(KINDS.liste, data), '', note);
    const { ai } = mk(GOOD);
    assert.equal((await run(ai, [...NOTES.slice(0, 4), note])).status, 200, note);
  }
  // still blocked: unfit words and contact data (a number is replaced before, so it never reaches the model either);
  // the other lists keep the youth screen
  assert.equal(screenInput(KINDS.liste, { art: 'feedback', notizen: [...NOTES.slice(0, 4), 'Ruft mich an: 0171 2345678'] }), 'blocked');
  assert.doesNotMatch(KINDS.liste.read({ art: 'feedback', notizen: ['Ruft mich an: 0171 2345678'] }).notizen[0], /2345678/);
  assert.equal(screenInput(KINDS.liste, KINDS.liste.read({ art: 'feedback', notizen: [...NOTES.slice(0, 4), 'Zu viel Alkohol am Abend'] })), 'blocked');
  assert.equal(screenInput(KINDS.liste, KINDS.liste.read({ art: 'einkauf', satz: 'Party, wer mobbt wird ausgelacht' })), 'blocked');
});

test('feedback: Krise in einer Notiz -> Hilfe, kein Modellaufruf; "ich kann nicht mehr" als ganze Notiz zaehlt, Burnout als Thema nicht', async () => {
  for (const note of ['Ich will nicht mehr leben', 'Ich kann nicht mehr.', 'kann einfach nicht mehr!!']) {
    const { ai, calls } = mk(GOOD);
    const r = await run(ai, [...NOTES.slice(0, 4), note]);
    assert.equal(r.status, 422, note); assert.equal(r.body.why, 'crisis', note); assert.equal(r.body.help, CRISIS_HELP.de);
    assert.equal(calls.length, 0, note);
  }
  for (const note of ['Ich kann nicht mehr folgen, zu schnell', 'Burnout-Thema ansprechen']) {
    const { ai } = mk(GOOD);
    assert.equal((await run(ai, [...NOTES.slice(0, 4), note])).status, 200, note);
  }
});
