// Zugspiele des Baukastens (Strang B) nach dem Zugvertrag (src/contract/session.js): init/step/observe/status/moves.
// Drei Bausteine (Ludii-artige Ludeme, 08-forschung/spiel-baukasten.md): place (Steine setzen, n in einer Reihe, optional
// mit Schwerkraft), flip (Paare aufdecken), answer (Fragen/Woerter: Auswahl oder Eingabe, Formen plain/scramble/gap).
// Kein verdecktes Wissen eines Sitzes (manifest hidden "none"): Brett und Fragen folgen fuer alle aus Seed und Beschreibung.
import { rng as mkRng } from "../../contract/sdk.js";

const BOT_SEAT = 1;
/** Memory: hoechstens so viele Versuche je Paar (Solo: alle Paare in der Zeit = gewonnen). */
export const TRIES_PER_PAIR = 6;
export const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Woerter einer Frage fuer die Formen scramble (Buchstaben gemischt, aus dem Seed) und gap (jeder zweite Buchstabe _). */
export function shown(d, item, r) {
  if (d.turn.form === "scramble") {
    const letters = [...item.a.toUpperCase().replace(/\s+/g, "")];
    let mix = letters;
    for (let tries = 0; tries < 6 && mix.join("") === letters.join(""); tries++) mix = r.shuffle(letters);
    return mix.join(" ");
  }
  if (d.turn.form === "gap") return [...item.a.toUpperCase()].map((c, i) => (c === " " ? "  " : i % 2 === 1 ? "_" : c)).join(" ");
  return "";
}

/** r: RNG der Partie (Zugvertrag: init bekommt rng(seed + "|init")) oder ein Seed-Text (Pruefer, Tests). */
export function init(d, r, players) {
  if (typeof r === "string") r = mkRng(r + "|bau-zug");
  const T = d.turn, n = d.players === 2 || players > 1 ? 2 : 1;
  const pub = { k: T.kind, tu: 0, sc: [0, 0], n, over: 0, win: -1, moves: 0 };
  if (T.kind === "place") { pub.b = new Array(T.cols * T.rows).fill(-1); }
  if (T.kind === "flip") {
    const faces = []; T.pairs.forEach((_, i) => { faces.push(i, i); });
    pub.f = r.shuffle(faces); pub.up = new Array(faces.length).fill(0); pub.sel = []; pub.miss = []; pub.seen = new Array(faces.length).fill(0);
  }
  if (T.kind === "answer") {
    const order = r.shuffle(T.items.map((_, i) => i)).slice(0, T.rounds || T.items.length);
    pub.q = 0; pub.order = order; pub.last = -1;
    pub.opts = order.map((i) => r.shuffle([0, 1, 2, 3].slice(0, 1 + T.items[i].wrong.filter(Boolean).length)));
    pub.show = order.map((i) => shown(d, T.items[i], r));
  }
  return { pub, priv: [null, null] };
}

function lineAt(d, b, i) {
  const C = d.turn.cols, R = d.turn.rows, need = d.turn.line, s = b[i], x0 = i % C, y0 = Math.floor(i / C);
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let c = 1;
    for (const sg of [1, -1]) { let x = x0 + dx * sg, y = y0 + dy * sg; while (x >= 0 && y >= 0 && x < C && y < R && b[y * C + x] === s) { c++; x += dx * sg; y += dy * sg; } }
    if (c >= need) return true;
  }
  return false;
}
function dropCell(d, b, col) { for (let y = d.turn.rows - 1; y >= 0; y--) if (b[y * d.turn.cols + col] === -1) return y * d.turn.cols + col; return -1; }
export function correct(d, pub, a) {
  const it = d.turn.items[pub.order[pub.q]];
  if (d.turn.ask === "pick") return Number.isInteger(a) && pub.opts[pub.q][a] === 0;
  return typeof a === "string" && fold(a) === fold(it.a);
}

/** Zug anwenden; wirft bei ungueltigen Zuegen (nie raten). */
export function step(d, state, input) {
  // die Beschreibung (pub.D in der Karte) nicht mitkopieren: sie aendert sich nie (Review H2: 6,5 KB je Kopie im Minimax)
  const { D, ...rest } = state.pub, pub = JSON.parse(JSON.stringify(rest)), T = d.turn, me = input.seat;
  if (D) pub.D = D;
  if (pub.over) throw new Error("vorbei");
  if (me !== pub.tu) throw new Error("nicht am Zug");
  const next = () => { if (pub.n === 2) pub.tu = 1 - pub.tu; };
  pub.moves++;
  if (T.kind === "place") {
    if (input.t !== "put" || !Number.isInteger(input.i)) throw new Error("Zug");
    const cell = T.drop ? (input.i >= 0 && input.i < T.cols ? dropCell(d, pub.b, input.i) : -1) : input.i;
    if (cell < 0 || cell >= pub.b.length || pub.b[cell] !== -1) throw new Error("Feld belegt");
    pub.b[cell] = me; pub.last = cell;
    if (lineAt(d, pub.b, cell)) { pub.over = 1; pub.win = me; pub.sc[me]++; }
    else if (pub.b.every((v) => v !== -1)) { pub.over = 1; pub.win = -1; }
    else next();
  } else if (T.kind === "flip") {
    if (input.t !== "flip" || !Number.isInteger(input.i) || input.i < 0 || input.i >= pub.f.length) throw new Error("Zug");
    const i = input.i;
    if (pub.up[i] || pub.sel.includes(i)) throw new Error("schon offen");
    pub.miss = [];
    pub.sel.push(i); pub.seen[i] = 1;
    if (pub.sel.length === 2) {
      const [x, y] = pub.sel;
      if (pub.f[x] === pub.f[y]) { pub.up[x] = 1; pub.up[y] = 1; pub.sc[me]++; if (!T.again) next(); }
      else { pub.miss = [x, y]; next(); }
      pub.sel = []; pub.tries = (pub.tries || 0) + 1;
      // jede Partie endet: spaetestens nach TRIES_PER_PAIR x Paare Versuchen entscheidet der Stand
      if (pub.up.every(Boolean) || pub.tries >= TRIES_PER_PAIR * T.pairs.length) { pub.over = 1; pub.win = pub.n === 1 ? (pub.up.every(Boolean) ? 0 : -1) : pub.sc[0] > pub.sc[1] ? 0 : pub.sc[1] > pub.sc[0] ? 1 : -1; }
    }
  } else if (T.kind === "answer") {
    if (input.t !== "say") throw new Error("Zug");
    const ok = correct(d, pub, input.a);
    if (ok) pub.sc[me]++;
    pub.last = ok ? 1 : 0; pub.lastQ = pub.q;
    pub.q++;
    if (pub.q >= pub.order.length) {
      pub.over = 1;
      if (pub.n === 1) pub.win = pub.sc[0] * 2 > pub.order.length ? 0 : -1;
      else pub.win = pub.sc[0] > pub.sc[1] ? 0 : pub.sc[1] > pub.sc[0] ? 1 : -1;
    } else next();
  } else throw new Error("Art");
  return { pub, priv: state.priv };
}

export function status(d, state) {
  const p = state.pub;
  return { over: !!p.over, score: p.sc.slice(0, p.n), winner: p.over ? p.win : -1, turn: p.over ? -1 : p.tu, ...(d.turn.kind === "answer" ? { turnNo: Math.min(p.q + 1, p.order.length), turns: p.order.length } : {}) };
}

/** Alle erlaubten Zuege des Sitzes (fuer Bot, Hinweise und die Pruefung der Eingaben). */
export function moves(d, pub, seat) {
  if (pub.over || seat !== pub.tu) return [];
  const T = d.turn;
  if (T.kind === "place") {
    if (T.drop) { const out = []; for (let c = 0; c < T.cols; c++) if (dropCell(d, pub.b, c) >= 0) out.push({ t: "put", seat, i: c }); return out; }
    return pub.b.map((v, i) => (v === -1 ? { t: "put", seat, i } : null)).filter(Boolean);
  }
  if (T.kind === "flip") {
    // Reihenfolge = Hinweis aus offen gesehenem Wissen (beide Seiten haben es gesehen): bekanntes Gegenstueck zuerst, dann
    // ungesehene Karten, dann der Rest. So endet die Partie auch, wenn jemand immer den ersten Zug nimmt (Treibertests).
    const open = pub.f.map((_, i) => i).filter((i) => !pub.up[i] && !pub.sel.includes(i));
    const pairOf = (i) => open.find((j) => j !== i && pub.seen[j] && pub.f[j] === pub.f[i]);
    let first = [];
    if (pub.sel.length === 1) { const j = pairOf(pub.sel[0]); if (j !== undefined) first = [j]; }
    else { const k = open.find((i) => pub.seen[i] && pairOf(i) !== undefined); if (k !== undefined) first = [k]; }
    const rest = open.filter((i) => !first.includes(i));
    return [...first, ...rest.filter((i) => !pub.seen[i]), ...rest.filter((i) => pub.seen[i])].map((i) => ({ t: "flip", seat, i }));
  }
  if (T.kind === "answer") {
    if (T.ask === "pick") return pub.opts[pub.q].map((_, a) => ({ t: "say", seat, a }));
    const it = T.items[pub.order[pub.q]];
    return [{ t: "say", seat, a: it.a }, { t: "say", seat, a: "?" }];
  }
  return [];
}
/** Eingaben, die nicht aufzaehlbar sind (Texteingabe): nur Form pruefen, die Wertung macht step. */
export function accepts(d, pub, seat, input) {
  if (pub.over || seat !== pub.tu) return false;
  if (d.turn.kind === "answer" && d.turn.ask === "type") return input.t === "say" && typeof input.a === "string" && input.a.length <= 40;
  return moves(d, pub, seat).some((m) => m.t === input.t && m.i === input.i && m.a === input.a);
}

// ---- Bot (deterministisch aus seed und Stufe) -------------------------------------------------------------------------
/** Knotenbudget je Botzug (Review H2): danach zaehlt die Stellung als offen (Wert 0). */
export const MINIMAX_NODES = 20000;
function minimax(d, pub, seat, depth, budget = { n: MINIMAX_NODES }) {
  if (--budget.n < 0) return { v: 0, m: null };
  const ms = moves(d, pub, pub.tu);
  if (!ms.length || pub.over) return { v: pub.over ? (pub.win === seat ? 100 : pub.win === -1 ? 0 : -100) : 0, m: null };
  if (depth === 0) return { v: 0, m: ms[0] };
  let best = null;
  for (const m of ms) {
    const nx = step(d, { pub, priv: [null, null] }, m).pub;
    const v = minimax(d, nx, seat, depth - 1, budget).v * (nx.over ? 1 : 0.95);
    const score = pub.tu === seat ? v : -v;
    if (!best || score > best.s) best = { s: score, v, m };
  }
  return { v: best.v, m: best.m };
}
/** Zug des Bots: place = Suche mit Tiefe nach Stufe, flip = Gedaechtnis nach Stufe, answer = Trefferquote nach Stufe. */
export function botMove(d, pub, seat, level, seed) {
  const ms = moves(d, pub, seat);
  if (!ms.length) return null;
  const r = mkRng(seed + "|bot|" + pub.moves);
  const T = d.turn;
  if (T.kind === "place") {
    if (level === 1 && r.int(3) === 0) return ms[r.int(ms.length)];
    const depth = Math.min(level === 3 ? 4 : 2, ms.length);
    // sofort gewinnen oder sofort abwehren hat Vorrang (billig, auch bei grossem Brett)
    for (const who of [seat, 1 - seat]) for (const m of ms) { const p = JSON.parse(JSON.stringify(pub)); p.tu = who; const nx = step(d, { pub: p, priv: [null, null] }, { ...m, seat: who }).pub; if (nx.over && nx.win === who) return m; }
    if (ms.length > 12 && level < 3) return ms[r.int(ms.length)];
    return minimax(d, pub, seat, depth).m || ms[0];
  }
  if (T.kind === "flip") {
    const mem = level === 3 ? 1 : level === 2 ? 0.6 : 0.25;
    const known = new Map();
    pub.seen.forEach((s, i) => { if (s && !pub.up[i] && r.int(1000) < mem * 1000) { const f = pub.f[i]; (known.get(f) || known.set(f, []).get(f)).push(i); } });
    if (pub.sel.length === 1) {
      const f = pub.f[pub.sel[0]], pair = (known.get(f) || []).find((i) => i !== pub.sel[0]);
      if (pair !== undefined) return { t: "flip", seat, i: pair };
      const fresh = ms.filter((m) => !pub.seen[m.i]); return (fresh.length ? fresh : ms)[r.int((fresh.length ? fresh : ms).length)];
    }
    for (const [, cells] of known) if (cells.length >= 2) return { t: "flip", seat, i: cells[0] };
    const fresh = ms.filter((m) => !pub.seen[m.i]);
    return (fresh.length ? fresh : ms)[r.int((fresh.length ? fresh : ms).length)];
  }
  if (T.kind === "answer") {
    const hit = r.int(100) < (level === 3 ? 85 : level === 2 ? 65 : 40);
    if (T.ask === "pick") { const right = pub.opts[pub.q].indexOf(0); return hit ? { t: "say", seat, a: right } : ms[(right + 1 + r.int(ms.length - 1)) % ms.length]; }
    return hit ? ms[0] : ms[1];
  }
  return ms[0];
}
export { BOT_SEAT };
