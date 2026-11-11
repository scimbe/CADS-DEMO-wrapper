// The free card's game wish without a silent default (user, 11.11.2026: chip "Spiel", "Ich möchte mit jemanden übers Netz
// oder alleine 2024 spielen", meant the number-sliding puzzle, became the flying game; before: "Dart-Spiel" 08.11., "Endless
// Runner über Brücken" 10.11.). A wish that names a game or a mechanic without an engine is honestly not yet; a wish that
// names no engine is decided by S2 on a closed list: only a scene is built, with a note which game it became; any other
// answer is not yet, never the flying game. A genre chosen first (G1 Fliegen, G2 Jump & Run) wins; a sentence that clearly
// names the other genre is asked back. No model is called for real: the model is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { App, CARD_SYSTEM, MOD_SYSTEM, MOD_SCHEMA, MOD_SCHEMA_SPIEL, SCHEMAS, SPIEL, SPIEL_ASK, catalogFor, engineOf, genreClash, nameIn, spielOf } from '../lib/duell-karte.mjs';

const DEV = 'd'.repeat(32);
const FLY = { ok: true, title: 'Meeresflug', emoji: SCHEMAS.game.properties.emoji.enum[0], theme: 'day', motif: 'none', level: 'normal', route: [0, 1, 2].map(() => ({ physik: 'normal', thema: 'day', emoji: SCHEMAS.game.properties.emoji.enum[0] })) };
const RUN = { ok: true, title: 'Waldlauf', mode: 'endlos', world: 'bruecke', level: 'normal', figure: '🦊', obstacle: '📦', coin: '🪙', foe: '🐦', has: ['luecken', 'hindernisse', 'muenzen'], foes: ['geh'] };
const bySchema = (req) => (req.schema === SCHEMAS.lauf ? RUN : FLY);
// spiel: what the stubbed S2 says about the game (undefined: the field is missing)
function fakeLlm(spiel, answer = bySchema) {
  const calls = [];
  return {
    calls, configured: true,
    async generate(req) {
      calls.push(req);
      if (req.system === MOD_SYSTEM) return { json: { risk: 0, cats: [], drink: 'none', ...(spiel === undefined ? {} : { spiel }) }, stop: 'end_turn', usage: { in: 10, out: 8 } };
      return { json: answer(req), stop: 'end_turn', usage: { in: 40, out: 60 } };
    },
  };
}
function mk(cardLlm) {
  const d = createDuell({ env: { DUELL_DAILY_MAX: '200', DUELL_SEAL_SECRET: 'seal' }, salt: 's', log: () => {}, llm: async () => '{}' });
  d.shared.age16 = () => true; d.shared.age18 = () => false;
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0' }, llm: async () => '{}', cardLlm, shared: d.shared, auth: { mode: 'gate', identify: async () => ({ email: 'lea@example.org' }) }, log: () => {} });
  return { d, ai };
}
const body = (text, extra = {}) => ({ kind: 'karte', input: { text, art: 'game', ...extra }, device: DEV, lang: 'de' });
const run = async (ai, b) => ai.act(b, await ai.who({}, b), null);
const kindOf = (r) => r.body.options && r.body.options[0] && r.body.options[0].doc.k;

// wishes that name a game or a mechanic the free card has no engine for: never a flying game, whatever the model would say
const NIE_FLUG = [
  'Ich möchte mit jemanden übers Netz oder alleine 2024 spielen',
  '2048', '2048 spielen', '2024 spielen', 'Zahlen schieben', 'Kacheln zusammenschieben', 'Tetris-artig', 'Snake', 'Pac-Man-artig',
  'Wordle', 'Mehrspieler übers Netz', 'Ein Strategiespiel mit Burgen', 'Brettspiel für den Familienabend', 'Blöcke stapeln, bis die Reihe voll ist',
  'merge the tiles until you reach the big number', 'a word game for my grandma',
];

test('Spielwunsch ohne Engine: nie ein Flugspiel, auch wenn das Modell "szene" sagen und ein Flugspiel liefern wuerde; kein Abbuchen', async () => {
  for (const w of NIE_FLUG) {
    for (const spiel of ['szene', 'flug', undefined]) {
      const llm = fakeLlm(spiel, () => FLY), { ai } = mk(llm);
      const r = await run(ai, body(w));
      assert.equal(r.status, 200, w);
      assert.ok(r.body.notyet, `${w}: ehrlich noch nicht, nicht ${kindOf(r)}`);
      assert.equal(kindOf(r), undefined, w);
      assert.equal(r.body.receipt, undefined, `${w}: nichts abgebucht`);
      assert.equal(llm.calls.filter((c) => c.system === CARD_SYSTEM).length, 0, `${w}: kein Karten-Aufruf`);
    }
  }
});

test('Der Satz vom 11.11.: "Zahlenspiel" gibt es noch nicht, mit dem naechsten Katalogspiel; ohne Modellaufruf', async () => {
  const llm = fakeLlm('szene'), { ai } = mk(llm);
  const r = await run(ai, body('Ich möchte mit jemanden übers Netz oder alleine 2024 spielen'));
  assert.deepEqual(r.body.notyet, { what: 'game', name: 'Zahlenspiel' });
  assert.ok(r.body.catalog.includes('zug-steine'));
  assert.equal(llm.calls.length, 0);
  // the name is the mechanic, never a game's title; in English the English name
  assert.equal(engineOf('2048 spielen').notyet, 'Zahlen-Schiebepuzzle');
  assert.equal(nameIn('Zahlen-Schiebepuzzle', 'en'), 'number sliding puzzle');
  assert.equal(nameIn('Schach', 'en'), 'Schach');
  // a year said as the date is no game name: the model decides
  assert.equal(engineOf('Silvester 2025 spielen wir zusammen'), 'offen');
  // the closest catalog cards exist in the vendored catalog
  for (const n of ['Zahlen-Schiebepuzzle', 'Zahlenspiel', 'Stapelspiel', 'Wörterrätsel', 'Strategiespiel', 'Brettspiel', 'Online-Mehrspieler-Spiel']) {
    const c = catalogFor(n);
    assert.ok(c.length > 0, n);
    for (const id of c) assert.ok(App.D.byId(id), `${n}: ${id}`);
  }
});

test('Offener Wunsch, nur Szene: Flugspiel mit Hinweis engine:flug; S2 fragt "spiel" auf geschlossener Liste; hoechstens 3 Aufrufe', async () => {
  for (const w of ['Unter Wasser mit Fischen, dann ein Sturm', 'Ganz entspannt nach Feierabend']) {
    const llm = fakeLlm('szene'), { ai } = mk(llm);
    const r = await run(ai, body(w));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(kindOf(r), 'game', w);
    assert.ok(r.body.note.includes('engine:flug'), w);
    const s2 = llm.calls[0];
    assert.equal(s2.system, MOD_SYSTEM); assert.equal(s2.schema, MOD_SCHEMA_SPIEL);
    assert.ok(s2.user.endsWith(SPIEL_ASK), 'die Frage steht in der Anfrage, die gecachten Regeln bleiben gleich');
    assert.ok(llm.calls.length <= 3, `${llm.calls.length} Aufrufe`);
  }
  assert.deepEqual(MOD_SCHEMA_SPIEL.properties.spiel.enum, SPIEL);
  assert.deepEqual(SPIEL, ['flug', 'lauf', 'szene', 'anderes_spiel']);
});

test('Offener Wunsch: S2 sagt lauf -> Lauf-Karte mit engine:lauf; anderes_spiel oder Unbekanntes -> noch nicht, nie Flug', async () => {
  let llm = fakeLlm('lauf'); let { ai } = mk(llm);
  let r = await run(ai, body('Ein Fuchs im Herbstwald'));
  assert.equal(kindOf(r), 'lauf'); assert.ok(r.body.note.includes('engine:lauf'));
  for (const spiel of ['anderes_spiel', 'puzzle', '', null, undefined]) {
    llm = fakeLlm(spiel, () => FLY); ({ ai } = mk(llm));
    r = await run(ai, body('Ein Spiel mit Murmeln und Löchern'));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.notyet, { what: 'game', name: '' }, String(spiel));
    assert.equal(r.body.receipt, undefined); assert.equal(kindOf(r), undefined);
    assert.equal(llm.calls.length, 1, 'nur S2, kein Karten-Aufruf');
  }
  assert.equal(spielOf({ json: { spiel: 'flug' } }), 'flug');
  assert.equal(spielOf({ json: { spiel: 'FLUG' } }), 'anderes_spiel');
  assert.equal(spielOf(null), 'anderes_spiel');
});

test('Ein eindeutiger Wunsch fragt S2 nicht nach dem Spiel (Schema wie bisher)', async () => {
  const llm = fakeLlm(undefined), { ai } = mk(llm);
  const r = await run(ai, body('Ein Drache fliegt durch die Nacht'));
  assert.equal(kindOf(r), 'game');
  assert.equal(llm.calls[0].schema, MOD_SCHEMA);
  assert.ok(!(r.body.note || []).some((n) => /^engine:/.test(n)));
});

test('Genre zuerst: der gewaehlte Genre-Chip gewinnt; klarer Widerspruch -> Rueckfrage mit beiden Genres; fest -> gebaut', async () => {
  let llm = fakeLlm(undefined), { ai } = mk(llm);
  let r = await run(ai, body('Unter Wasser mit Fischen, dann ein Sturm', { genre: 'G2' }));
  assert.equal(kindOf(r), 'lauf'); assert.equal(llm.calls[0].schema, MOD_SCHEMA, 'mit Genre keine Spiel-Frage');
  assert.ok(!(r.body.note || []).some((n) => /^engine:/.test(n)));
  // weak words under a genre: the genre wins, no question
  ({ ai } = mk(fakeLlm(undefined)));
  r = await run(ai, body('Mein Hund springt über die Wolken', { genre: 'G1' }));
  assert.equal(kindOf(r), 'game');
  // clear other genre: asked back, nothing called, nothing charged
  llm = fakeLlm(undefined); ({ ai } = mk(llm));
  r = await run(ai, body('Endless Runner über Brücken', { genre: 'G1' }));
  assert.deepEqual(r.body.notyet, { what: 'genre', name: 'G2', chosen: 'G1' });
  assert.equal(llm.calls.length, 0); assert.equal(r.body.receipt, undefined);
  ({ ai } = mk(fakeLlm(undefined)));
  r = await run(ai, body('Endless Runner über Brücken', { genre: 'G1', fest: true }));
  assert.equal(kindOf(r), 'game', 'die Person hat Fliegen bestaetigt');
  ({ ai } = mk(fakeLlm(undefined)));
  r = await run(ai, body('Ein Drache fliegt durch die Nacht', { genre: 'G2' }));
  assert.deepEqual(r.body.notyet, { what: 'genre', name: 'G1', chosen: 'G2' });
  // a named game without an engine stays not yet under any genre
  ({ ai } = mk(fakeLlm('szene')));
  r = await run(ai, body('2048 spielen', { genre: 'G1', fest: true }));
  assert.equal(r.body.notyet.name, 'Zahlen-Schiebepuzzle');
  // genres the server does not build are ignored (the sentence decides as without a genre)
  ({ ai } = mk(fakeLlm('szene')));
  r = await run(ai, body('Ganz entspannt nach Feierabend', { genre: 'G15' }));
  assert.ok(r.body.note.includes('engine:flug'));
  // a game the free card builds as an ability (Dart) still reaches its ability under a genre
  llm = fakeLlm(undefined, () => ({ ok: true })); ({ ai } = mk(llm));
  r = await run(ai, body('Erstelle ein Dart Spiel', { genre: 'G1' }));
  assert.equal(r.body.notyet, undefined, JSON.stringify(r.body));
  assert.match(llm.calls.find((c) => c.system === CARD_SYSTEM).name, /^card_faehigkeit/);
  assert.equal(genreClash('G1', 'Jump and Run im Wald'), 'G2');
  assert.equal(genreClash('G2', 'Jump and Run mit fliegenden Gegnern'), '');
});

test('Ohne Kategorie: feste Absage vor jedem Modellaufruf, nichts abgebucht', async () => {
  for (const art of [undefined, '', 'tetris']) {
    const llm = fakeLlm('szene'), { ai } = mk(llm);
    const r = await run(ai, { kind: 'karte', input: { text: 'Ganz entspannt nach Feierabend', ...(art === undefined ? {} : { art }) }, device: DEV, lang: 'de' });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'bad-request'); assert.equal(r.body.why, 'art');
    assert.equal(llm.calls.length, 0);
  }
});
