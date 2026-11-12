// Scoring of the frozen gold corpus of G3 (test/fixtures/bau-gold.json): every expectation is an executable check on the game
// that came back (or on the refusal), never a model's judgement (KONZEPT §5: executable checks before any judge).
import { normalize } from './vendor/mdi-baukasten/engines/baukasten/spec.js';

/** One property of test/fixtures/bau-gold.json merkmale_doku on a normalized description -> boolean */
export function merkmalOk(d, m) {
  const [k, a, b] = m.split(':');
  const list = (x) => String(x || '').split(',');
  const emojis = [...d.things.map((t) => t.emoji), ...d.turn.pairs].join(' ');
  switch (k) {
    case 'control': return a === 'any' ? d.things.some((t) => list(b).includes(t.control)) : d.things.some((t) => t.control === a);
    case 'gravity': return d.world.gravity !== 0;
    case 'spawn': return d.spawn.length > 0;
    case 'danger': return d.rules.some((r) => ['touch', 'out'].includes(r.when) && r.do.some((e) => (e.act === 'life' && e.n < 0) || e.act === 'lose'));
    case 'bounce': return d.things.some((t) => t.bounce !== 'none');
    case 'rule': return a === 'any' ? d.rules.some((r) => list(b).includes(r.when)) : d.rules.some((r) => r.when === a);
    case 'players': return d.players === Number(a);
    case 'end': return a === 'score' ? d.end.score > 0 : a === 'time' ? d.end.time > 0 : a === 'lives' ? d.end.lives > 0 : false;
    case 'grid': return d.world.cols > 0 && d.world.rows > 0;
    case 'trail': return d.things.some((t) => t.trail > 0);
    case 'life': return d.things.some((t) => t.life > 0);
    case 'ai': return d.things.some((t) => t.ai === a);
    case 'emoji': return emojis.includes(a);
    case 'emoji_any': return list(a).some((e) => emojis.includes(e));
    case 'turn': return d.mode === 'turn' && d.turn.kind === a;
    case 'line': return d.turn.line === Number(a);
    case 'drop': return d.turn.drop === true;
    case 'ask': return d.turn.ask === a;
    case 'form': return d.turn.form === a;
    default: throw new Error('unbekanntes Merkmal ' + m);
  }
}

/**
 * One corpus entry and the server's answer (status, body) -> { ergebnis, ok, merkmale: {m: bool}, passt }
 *   ergebnis: 'spiel' (a kit game came back) | 'absage' (200 notyet, no card) | 'block' (422) | 'fehler' (anything else)
 *   ok: the result is the expected kind; passt: a game that also has every expected property
 */
export function bewerte(entry, status, body) {
  const doc = body && body.options && body.options[0] && body.options[0].doc;
  const ergebnis = doc && doc.k === 'bau' ? 'spiel' : status === 200 && body && body.notyet ? 'absage' : status === 422 ? 'block' : 'fehler';
  const want = entry.erwartet;
  const out = { ergebnis, ok: ergebnis === want.ergebnis || (want.ergebnis === 'block' && ergebnis === 'absage'), merkmale: {}, passt: false };
  if (ergebnis === 'spiel' && want.ergebnis === 'spiel') {
    const n = normalize(doc.b);
    const d = n.desc;
    out.takt = d.mode === 'turn' ? 'zug' : 'echtzeit';
    out.taktOk = out.takt === want.takt;
    for (const m of want.merkmale) out.merkmale[m] = n.errors.length === 0 && merkmalOk(d, m);
    out.passt = out.taktOk && Object.values(out.merkmale).every(Boolean);
  }
  return out;
}

/** Summary numbers of a run: shares over the entries that expect a game, and over those that expect a refusal. */
export function zusammenfassung(rows) {
  const spiel = rows.filter((r) => r.erwartet.ergebnis === 'spiel'), nein = rows.filter((r) => r.erwartet.ergebnis !== 'spiel');
  const share = (xs, f) => (xs.length ? Math.round(1000 * xs.filter(f).length / xs.length) / 1000 : 0);
  const props = spiel.flatMap((r) => Object.values(r.bewertung.merkmale));
  return {
    eintraege: rows.length, spielErwartet: spiel.length, absageErwartet: nein.length,
    spielbar: share(spiel, (r) => r.bewertung.ergebnis === 'spiel'),
    passt: share(spiel, (r) => r.bewertung.passt),
    taktRichtig: share(spiel.filter((r) => r.bewertung.ergebnis === 'spiel'), (r) => r.bewertung.taktOk),
    merkmaleErfuellt: props.length ? Math.round(1000 * props.filter(Boolean).length / props.length) / 1000 : 0,
    absageRichtig: share(nein, (r) => r.bewertung.ok),
    ehrlicheAbsageStattSpiel: share(spiel, (r) => r.bewertung.ergebnis === 'absage'),
    fehler: rows.filter((r) => r.bewertung.ergebnis === 'fehler').map((r) => r.id),
    nachSplit: Object.fromEntries(['dev', 'test'].map((s) => [s, { spielbar: share(spiel.filter((r) => r.split === s), (r) => r.bewertung.ergebnis === 'spiel'), passt: share(spiel.filter((r) => r.split === s), (r) => r.bewertung.passt) }])),
  };
}
