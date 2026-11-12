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

/** Cohen's kappa for two binary raters (arrays of booleans, same order) -> { kappa, agree, n, table: [[a,b],[c,d]] }.
 *  table[i][j]: rater 1 = i (1 yes), rater 2 = j. Reported together with the plain agreement (McHugh 2012). */
export function cohenKappa(r1, r2) {
  if (r1.length !== r2.length || !r1.length) throw new Error('kappa: gleich lange, nicht leere Listen');
  const n = r1.length, t = [[0, 0], [0, 0]];
  for (let i = 0; i < n; i++) t[r1[i] ? 1 : 0][r2[i] ? 1 : 0]++;
  const po = (t[0][0] + t[1][1]) / n;
  const p1 = (t[1][0] + t[1][1]) / n, p2 = (t[0][1] + t[1][1]) / n, pe = p1 * p2 + (1 - p1) * (1 - p2);
  return { kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), agree: po, n, table: t };
}

/** A delivered game in plain words for a human or agent rater (what a player sees and does; no prompt, no internal check). */
export function spielText(b) {
  const n = normalize(b), d = n.desc;
  if (n.errors.length) return 'ungueltige Beschreibung';
  const L = [`Titel: ${d.title}`, `Ziel (so steht es im Spiel): ${d.goal}`, `Art: ${d.mode === 'turn' ? 'Zugspiel' : 'Echtzeit'}, ${d.players} Spieler`];
  if (d.mode === 'turn') {
    const t = d.turn;
    if (t.kind === 'place') L.push(`Brett ${t.cols}x${t.rows}, ${t.line} in einer Reihe gewinnt${t.drop ? ', Steine fallen in Spalten' : ''}; Steine: ${t.pieces.map((p) => (d.things.find((x) => x.id === p) || {}).emoji || p).join(' gegen ')}`);
    if (t.kind === 'flip') L.push(`Memory mit ${t.pairs.length} Paaren: ${t.pairs.join(' ')}`);
    if (t.kind === 'answer') L.push(`Fragen (${t.ask === 'type' ? 'eintippen' : 'auswaehlen'}${t.form !== 'plain' ? ', ' + (t.form === 'scramble' ? 'Buchstaben gemischt' : 'Luecken') : ''}): ` + t.items.map((i) => `${i.q} -> ${i.a}`).join(' | '));
  } else {
    L.push('Dinge: ' + d.things.map((t) => `${t.emoji || t.text || t.look + ' ' + t.color} (${t.id}${t.control !== 'none' ? ', Steuerung ' + t.control : ''}${t.ai !== 'none' ? ', bewegt sich ' + t.ai : ''}${t.gravity ? ', faellt' : ''})`).join('; '));
    L.push('Regeln: ' + d.rules.map((r) => `wenn ${r.when} ${r.a}${r.b ? ' ' + r.b : ''}: ${r.do.map((e) => e.act + (e.n && !['destroy', 'reset', 'bounce', 'win', 'lose'].includes(e.act) ? ' ' + e.n : '')).join(', ')}`).join('; '));
    L.push(`Ende: ${[d.end.time ? d.end.time + ' s' : '', d.end.score ? d.end.score + ' Punkte' : '', d.end.lives ? d.end.lives + ' Leben' : ''].filter(Boolean).join(', ') || 'durch Regel'}`);
  }
  return L.join('\n');
}
