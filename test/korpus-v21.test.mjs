// Korpus v2.1 der freien Karte (W1b/W1c): Schema, Zählung je Schicht und Genre, Inhaltsanker, alt_ok gegen das
// vendorte ideas.json und der Freeze-Kopf {frozen_by, frozen_at, sha256}. Der Harness (W1a) misst gegen diese Labels;
// ohne Freeze durch einen Menschen wäre das Gate zirkulär, deshalb bricht der Test ohne frozen_by ab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pfad = (f) => fileURLToPath(new URL('./fixtures/' + f, import.meta.url));
const lies = (f) => JSON.parse(readFileSync(pfad(f), 'utf8'));
const A = lies('karte-v21-a.json');
const B = existsSync(pfad('karte-v21-b.json')) ? lies('karte-v21-b.json') : null;
const KORPORA = [['karte-v21-a.json', A], ...(B ? [['karte-v21-b.json', B]] : [])];

const IDEAS = JSON.parse(readFileSync(fileURLToPath(new URL('../lib/vendor/duell-web/ideas.json', import.meta.url)), 'utf8'));
const IDEA_IDS = new Set([...IDEAS.ideas, ...(IDEAS.gated || [])].map((x) => x.id));

const GENRES = ['G1', 'G2', 'G11', 'G12', 'G15'];
const ERGEBNIS = ['karte', 'rueckfrage', 'absage_alt', 'weiterleitung', 'block'];
const LANGS = ['de', 'en', 'tr', 'ru', 'ar', 'pl', 'uk', 'it', 'es', 'fr', 'el', 'hr', 'sr', 'ro', 'fa', 'ku', 'vi', 'zh', 'gsw', 'bar', 'mix'];
// Schlüssel der festen Absage-Tabelle (W111f, lib/duell-absage.mjs)
const ABSAGE_KEYS = ['tetris', 'match3', 'memory', 'puzzle', 'rhythmus', 'schach', 'skat', 'dart', 'shooter', 'bot_gegen_bot', 'pong', 'flipper'];
const PFLICHT = A.kopf.pflicht_katalog;
const POLE = new Set([...Object.keys(A.kopf.pole_katalog), 'eigene']);
const WELT = new Set(A.kopf.welt_enum);
const FELDER = ['id', 'satz', 'lang', 'schicht', 'genre_gewaehlt', 'genre_gold', 'ergebnis_gold', 'alt_ok', 'strike_erlaubt', 'anker', 'pflicht'];
// die 30 Golden-Fälle aus h365/phase1/bericht.md Abschnitt 4 (Z. 238-271)
const GOLDEN = ['b1-01', 'b1-02', 'b1-06', 'b2-10', 'b1-05', 'b1-08', 'b3-09', 'b2-08', 'b3-08', 'b1-03', 'b1-11', 'b1-14', 'b1-17', 'b3-16', 'b3-18',
  'b2-11', 'b2-15', 'b1-16', 'b1-15', 'b3-13', 'b1-13', 'b1-20', 'b3-19', 'b3-21', 'b3-22', 'b3-06', 'b1-12', 'b3-24', 'b1-30', 'b3-30'];

const zaehle = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const sha = (eintraege) => createHash('sha256').update(JSON.stringify(eintraege), 'utf8').digest('hex');

for (const [name, K] of KORPORA) {
  test(`${name}: Kopf und sha256 passen zum Inhalt`, () => {
    for (const f of ['korpus', 'version', 'status', 'sha256', 'hash_regel', 'schichten']) assert.ok(f in K.kopf, `Kopf-Feld ${f}`);
    assert.ok('frozen_by' in K.kopf && 'frozen_at' in K.kopf, 'Kopf-Felder frozen_by und frozen_at');
    assert.equal(K.kopf.sha256, sha(K.eintraege), 'sha256 im Kopf passt nicht zum Inhalt: nach jeder Änderung neu einfrieren');
    assert.deepEqual(zaehle(K.eintraege, (e) => e.schicht), K.kopf.schichten, 'Zählung je Schicht im Kopf');
  });

  test(`${name}: von einem Menschen eingefroren (frozen_by, frozen_at)`, () => {
    // Agenten entwerfen die Labels; erst ein Mensch prüft und friert ein (Bauplan W1b). Ohne Freeze ist das Gate zirkulär.
    assert.ok(typeof K.kopf.frozen_by === 'string' && K.kopf.frozen_by.trim().length > 1,
      `${name} ist nicht eingefroren: frozen_by fehlt (Status ${K.kopf.status}). Ein Mensch prüft die Labels und setzt frozen_by, frozen_at und sha256.`);
    assert.match(String(K.kopf.frozen_at), /^\d{4}-\d{2}-\d{2}/, 'frozen_at als ISO-Datum');
    assert.equal(K.kopf.status, 'eingefroren');
  });

  test(`${name}: Schema jedes Eintrags`, () => {
    for (const e of K.eintraege) {
      for (const f of FELDER) assert.ok(f in e, `${e.id}: Feld ${f}`);
      assert.match(e.id, /^[a-z0-9-]+$/, e.id);
      assert.ok(typeof e.satz === 'string' && e.satz.trim().length >= 3 && e.satz.length <= 200, `${e.id}: satz`);
      assert.ok(LANGS.includes(e.lang), `${e.id}: lang ${e.lang}`);
      assert.ok(e.genre_gewaehlt === null || GENRES.includes(e.genre_gewaehlt), `${e.id}: genre_gewaehlt`);
      assert.ok(e.genre_gold === null || GENRES.includes(e.genre_gold), `${e.id}: genre_gold`);
      assert.ok(ERGEBNIS.includes(e.ergebnis_gold), `${e.id}: ergebnis_gold`);
      assert.ok(Array.isArray(e.alt_ok) && e.alt_ok.every((x) => typeof x === 'string'), `${e.id}: alt_ok`);
      assert.equal(typeof e.strike_erlaubt, 'boolean', `${e.id}: strike_erlaubt`);
      if (e.absage_key !== undefined) assert.ok(e.absage_key === null || ABSAGE_KEYS.includes(e.absage_key), `${e.id}: absage_key`);
      if (e.alt_genre !== undefined) assert.ok(e.alt_genre.every((g) => GENRES.includes(g)), `${e.id}: alt_genre`);
      if (e.foto !== undefined) assert.equal(e.foto, 'lokal', `${e.id}: foto bleibt am Gerät`);
      if (e.foto !== undefined) assert.equal(e.ergebnis_gold, 'karte', `${e.id}: foto nur an einer Karte`);
      if (e.ergebnis_gold === 'karte') {
        assert.ok(e.genre_gold, `${e.id}: karte ohne genre_gold`);
        const a = e.anker;
        assert.ok(a && ['welt', 'thema_stamm', 'pole_ids', 'verboten'].every((k) => Array.isArray(a[k])), `${e.id}: anker-Form`);
        assert.ok(a.thema_stamm.length + a.pole_ids.length > 0, `${e.id}: anker leer`);
        assert.ok(e.pflicht && e.pflicht in PFLICHT && e.pflicht.split('_')[0] === e.genre_gold, `${e.id}: pflicht ${e.pflicht}`);
        if (e.genre_gold === 'G1' || e.genre_gold === 'G2') assert.ok(a.welt.length > 0 && a.welt.every((w) => WELT.has(w)), `${e.id}: welt`);
        else assert.deepEqual(a.welt, [], `${e.id}: welt nur für G1/G2`);
        if (e.genre_gold === 'G15') assert.ok(a.pole_ids.length > 0 && a.pole_ids.every((p) => POLE.has(p)), `${e.id}: pole_ids`);
        else assert.deepEqual(a.pole_ids, [], `${e.id}: pole_ids nur für G15`);
        // Inhaltsanker stammen aus dem Satz: jede Stamm-Gruppe hat eine Alternative im Satz, kein verbotenes Wort steht im Satz
        const s = e.satz.toLowerCase();
        for (const g of a.thema_stamm) assert.ok(g.split('|').some((x) => s.includes(x)), `${e.id}: Stamm "${g}" nicht im Satz`);
        for (const v of a.verboten) assert.ok(!s.includes(v), `${e.id}: verbotenes Wort "${v}" steht im Satz`);
      } else {
        assert.equal(e.anker, null, `${e.id}: anker nur bei karte`);
        assert.equal(e.pflicht, null, `${e.id}: pflicht nur bei karte`);
      }
      if (e.ergebnis_gold === 'rueckfrage') {
        const c = e.rueckfrage_chips;
        assert.ok(Array.isArray(c) && c.length >= 2 && c.length <= 3 && c.every((g) => GENRES.includes(g)), `${e.id}: rueckfrage_chips`);
        if (e.genre_gewaehlt) {
          // Genre zuerst: Widerspruch zum Chip -> Rückfrage mit Vorschlag, der Chip selbst bleibt wählbar
          assert.ok(e.genre_gold && e.genre_gold !== e.genre_gewaehlt, `${e.id}: Vorschlag muss vom Chip abweichen`);
          assert.ok(c.includes(e.genre_gewaehlt) && c.includes(e.genre_gold), `${e.id}: Chips [gewählt, Vorschlag]`);
        }
      }
      if (e.ergebnis_gold === 'absage_alt') assert.equal(e.genre_gold, null, `${e.id}: absage_alt ohne genre_gold`);
      if (e.ergebnis_gold === 'weiterleitung') assert.ok(typeof e.ziel === 'string' && e.ziel, `${e.id}: weiterleitung braucht ziel`);
    }
  });

  test(`${name}: alle alt_ok-IDs existieren im vendorten ideas.json`, () => {
    const fehlt = K.eintraege.flatMap((e) => e.alt_ok.filter((x) => !IDEA_IDS.has(x)).map((x) => `${e.id}:${x}`));
    assert.deepEqual(fehlt, []);
  });
}

test('IDs sind über beide Korpusdateien eindeutig, kein Satz doppelt je Chip', () => {
  const alle = KORPORA.flatMap(([, K]) => K.eintraege);
  const ids = alle.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'doppelte IDs');
  const paare = alle.map((e) => `${e.genre_gewaehlt}|${e.satz.toLowerCase()}`);
  assert.equal(new Set(paare).size, paare.length, 'doppelter Satz mit gleichem Chip');
});

test('karte-v21-a: Schichten 250/40/40/30/30 plus 50 Chip-Widersprüche, je Genre genau 50 klare Wünsche', () => {
  const E = A.eintraege;
  assert.deepEqual(zaehle(E, (e) => e.schicht), { klar: 250, themen_falle: 40, nicht_abbildbar: 40, mehrdeutig: 30, golden: 30, chip_widerspruch: 50 });
  const klar = E.filter((e) => e.schicht === 'klar');
  assert.deepEqual(zaehle(klar, (e) => e.genre_gold), { G1: 50, G2: 50, G11: 50, G12: 50, G15: 50 });
  // Genre zuerst: bei klaren Wünschen ist der Chip das Gold-Genre, das Gate zählt Treffer je gewähltem Genre
  assert.deepEqual(zaehle(klar, (e) => e.genre_gewaehlt), { G1: 50, G2: 50, G11: 50, G12: 50, G15: 50 });
  assert.ok(klar.every((e) => e.ergebnis_gold === 'karte' && e.genre_gewaehlt === e.genre_gold));
  // G12 deckt beide Modi ab
  const g12 = zaehle(klar.filter((e) => e.genre_gold === 'G12'), (e) => e.pflicht);
  assert.ok(g12.G12_wahl >= 15 && g12.G12_luege >= 15, JSON.stringify(g12));
  // Teil A enthält nur harmlose Wünsche: nie ein Strike
  assert.ok(E.every((e) => e.strike_erlaubt === false), 'strike_erlaubt in Teil A immer false');
  // jede Schicht außer golden und mehrdeutig (Start-Satz-Weg) hat einen Chip
  for (const e of E.filter((x) => ['klar', 'themen_falle', 'nicht_abbildbar', 'chip_widerspruch'].includes(x.schicht))) assert.ok(e.genre_gewaehlt, `${e.id}: Chip fehlt`);
});

test('karte-v21-a: Themen-Fallen, Nicht-Abbildbares, Mehrdeutiges und Chip-Widersprüche tragen das richtige Soll', () => {
  const E = A.eintraege;
  const von = (s) => E.filter((e) => e.schicht === s);
  const fallen = von('themen_falle');
  assert.ok(fallen.every((e) => e.ergebnis_gold === 'karte' && e.genre_gold === e.genre_gewaehlt));
  assert.deepEqual(zaehle(fallen, (e) => e.genre_gold), { G1: 8, G2: 8, G11: 8, G12: 8, G15: 8 });
  const nicht = von('nicht_abbildbar');
  assert.ok(nicht.every((e) => e.ergebnis_gold === 'absage_alt' && e.genre_gold === null));
  assert.ok(nicht.filter((e) => e.absage_key).length >= 20, 'mindestens 20 Fälle aus der festen Absage-Tabelle');
  assert.ok(nicht.every((e) => e.alt_ok.length > 0 || e.absage_key === 'shooter' || (e.alt_genre || []).length > 0),
    'Gegenvorschlag fehlt');
  const mehr = von('mehrdeutig');
  assert.ok(mehr.filter((e) => e.genre_gewaehlt).every((e) => e.ergebnis_gold === 'karte' && e.genre_gold === e.genre_gewaehlt), 'Chip löst Mehrdeutigkeit');
  assert.ok(mehr.filter((e) => !e.genre_gewaehlt).every((e) => e.ergebnis_gold === 'rueckfrage'), 'ohne Chip: Rückfrage');
  const wid = von('chip_widerspruch');
  assert.ok(wid.every((e) => e.ergebnis_gold === 'rueckfrage' && e.genre_gold !== e.genre_gewaehlt));
  assert.deepEqual(zaehle(wid, (e) => e.genre_gewaehlt), { G1: 10, G2: 10, G11: 10, G12: 10, G15: 10 });
});

test('karte-v21-a: die 30 Golden-Fälle aus h365/phase1 sind vollständig', () => {
  const gold = A.eintraege.filter((e) => e.schicht === 'golden');
  assert.deepEqual(gold.map((e) => e.id.replace(/^a-gold-/, '')).sort(), GOLDEN.slice().sort());
  const by = Object.fromEntries(gold.map((e) => [e.id.replace(/^a-gold-/, ''), e]));
  // Stichproben gegen den Bericht: Runner über Brücken nie als Flieger, Döner-Flappy fliegt, Glücksspiel geblockt, Gruß wird weitergeleitet
  assert.equal(by['b1-11'].genre_gold, 'G2');
  assert.equal(by['b2-11'].genre_gold, 'G1');
  assert.equal(by['b1-30'].ergebnis_gold, 'block');
  assert.equal(by['b3-30'].ergebnis_gold, 'block');
  assert.equal(by['b1-01'].ergebnis_gold, 'weiterleitung');
  assert.ok(by['b1-17'].alt_ok.includes('zug-steine'));
});

test('karte-v21-b: Zählung je Schicht wie im Bauplan W1c (160 Einträge)', { skip: B ? false : 'karte-v21-b.json kommt mit W1c' }, () => {
  assert.equal(B.eintraege.length, 160);
});
