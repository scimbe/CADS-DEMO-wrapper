// Agenten-Duelle (E10): reine Logik, Port von duel.js (Altcode, Zeilen 1-215) ohne DOM. Zwei Agenten mit drei Reglern
// (Mut r, Frechheit c, Geduld p, je 0-100) und derselbe Seed ergeben auf beiden Geraeten dasselbe Duell. Modi wie alt:
// rps (Schere-Stein-Papier), mind (du gegen deinen lernenden Agenten), rap, auction, deck (Partydeck mit Uhr). flappy
// (Agent fliegt) gehoert zur Flug-Engine von Strang L und ist hier nicht enthalten.
import { hash32, mulberry32, clean } from "../zug/alt.js";
import DATA from "./duel.json" with { type: "json" };

export { DATA };
export const MODES = ["rps", "mind", "rap", "auction", "deck"];
export const SLIDERS = { rps: ["r", "c", "p"], mind: ["c"], rap: ["r", "c", "p"], auction: ["r", "c", "p"], deck: [] };
export const ROUNDS = { rps: 9, mind: 10, rap: 4, auction: 4 };
const HANDS = 3;

// core.js:108-113: ein Emoji (mit Varianten, Hauttoenen und ZWJ-Folgen), sonst der Drachen
const EMOJI_RE = /^\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*/u, DEFAULT_EMOJI = "🪁";
export function emoji(s) { if (typeof s !== "string") return DEFAULT_EMOJI; const m = s.trim().match(EMOJI_RE); return m && m[0].length <= 12 ? m[0] : DEFAULT_EMOJI; }
function slider(v, d) { return Number.isInteger(v) && v >= 0 && v <= 100 ? v : d; }
/** Agent wie alt sanitizeAgent (duel.js:18-22): Name (16, Filter), Emoji aus der Liste, Regler 0-100, sonst Vorgabe. */
export function agent(a, f = {}) {
  a = a && typeof a === "object" ? a : {};
  const n = clean(a.n, 16);
  return { n: n || f.n || "", e: typeof a.e === "string" ? emoji(a.e) : (f.e || "🤖"), r: slider(a.r, f.r == null ? 50 : f.r), c: slider(a.c, f.c == null ? 50 : f.c), p: slider(a.p, f.p == null ? 50 : f.p) };
}
/** Pruefung einer Agent-Eingabe: genau die Felder, gueltige Werte (ein Link laesst sich von Hand bauen). */
export function agentOk(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const k = Object.keys(a).sort().join(",");
  if (k !== "c,e,n,p,r") return false;
  if (typeof a.n !== "string" || (a.n !== "" && clean(a.n, 16) !== a.n)) return false;
  return typeof a.e === "string" && emoji(a.e) === a.e && ["r", "c", "p"].every((x) => Number.isInteger(a[x]) && a[x] >= 0 && a[x] <= 100);
}

// Beide Geraete sortieren die Agenten gleich, damit das Duell nicht davon abhaengt, wer es gestartet hat (duel.js:42-43).
function canonical(a, b) { return JSON.stringify(a) <= JSON.stringify(b); }
export function rngFor(doc) { const x = canonical(doc.a, doc.b) ? [doc.a, doc.b] : [doc.b, doc.a]; return mulberry32(hash32("duel|" + doc.m + "|" + doc.seed + "|" + (doc.w || "") + "|" + JSON.stringify(x))); }
function beats(x, y) { return (x + 2) % HANDS === y; }
export function outcome(x, y) { return x === y ? 0 : beats(x, y) ? 1 : -1; }

// Mut lehnt zur ersten Hand, Frechheit wiederholt einen Sieg, Geduld kontert die letzte Hand der anderen Seite.
function hand(ag, me, foe, rnd) {
  const last = me.length - 1;
  if (last >= 0 && rnd() < ag.p / 130) return (foe[last] + 1) % HANDS;
  if (last >= 0 && outcome(me[last], foe[last]) > 0 && rnd() < ag.c / 110) return me[last];
  const x = rnd(), lead = 1 / 3 + (ag.r / 100) * 0.5;
  return x < lead ? 0 : x < lead + (1 - lead) / 2 ? 1 : 2;
}
function seq(v) { return mulberry32(Math.floor(v * 4294967295)); }
function playRps(doc, rnd) {
  const ah = [], bh = [], out = [], flip = !canonical(doc.a, doc.b);
  let sa = 0, sb = 0;
  for (let i = 0; i < ROUNDS.rps; i++) {
    const first = rnd(), second = rnd(), x = hand(doc.a, ah, bh, seq(flip ? second : first)), y = hand(doc.b, bh, ah, seq(flip ? first : second)), o = outcome(x, y);
    ah.push(x); bh.push(y); if (o > 0) sa++; else if (o < 0) sb++;
    out.push({ x, y, o, sa, sb });
  }
  return { rounds: out, sa, sb };
}
function pick(list, rnd) { return list[Math.floor(rnd() * list.length)]; }
function fill(s, ag, doc) { return s.replace(/\{w\}/g, doc.w || "").replace(/\{n\}/g, ag.n || ag.e); }
function rapLine(ag, foe, doc, rnd, lang) {
  const T = DATA.rap[lang] || DATA.rap.de, x = rnd(), kind = x < ag.c / (ag.c + ag.p + 1) ? "boast" : "calm", list = doc.w ? T[kind].concat(T.word) : T[kind];
  const base = 3 + Math.floor(rnd() * (2 + (ag.r / 100) * 7)), pat = ag.p > 60 ? 1 : 0;
  let bon = 0;
  if (kind === "boast" && foe.p < 40) bon++;
  if (kind === "calm" && foe.c > 60) bon++;
  return { text: fill(pick(list, rnd), ag, doc), pts: base + pat + bon, base, pat, bon };
}
function playRap(doc, rnd, lang) {
  const out = [], flip = !canonical(doc.a, doc.b);
  let sa = 0, sb = 0;
  for (let i = 0; i < ROUNDS.rap; i++) {
    const p = rapLine(flip ? doc.b : doc.a, flip ? doc.a : doc.b, doc, rnd, lang), q = rapLine(flip ? doc.a : doc.b, flip ? doc.b : doc.a, doc, rnd, lang), l = flip ? q : p, m = flip ? p : q;
    sa += l.pts; sb += m.pts; out.push({ x: l, y: m, sa, sb });
  }
  return { rounds: out, sa, sb };
}
function bidFor(ag, value, left, rest, rnd) {
  const keep = (ag.p / 100) * (rest - 1) * 8;
  const raw = value * (0.45 + (ag.r / 100) * 0.9) + (rnd() < ag.c / 200 ? 8 : 0);
  return Math.max(0, Math.min(left, Math.round(Math.min(raw, left - keep))));
}
function playAuction(doc, rnd, lang) {
  const flip = !canonical(doc.a, doc.b), left = [100, 100], gain = [0, 0], out = [], items = (DATA.items[lang] || DATA.items.de).slice(), list = [];
  while (list.length < ROUNDS.auction) list.push(items.splice(Math.floor(rnd() * items.length), 1)[0]);
  if (doc.w) list[0] = doc.w;
  list.forEach((item, i) => {
    const who = flip ? [doc.b, doc.a] : [doc.a, doc.b], vals = [20 + Math.floor(rnd() * 41), 20 + Math.floor(rnd() * 41)];
    const bids = [bidFor(who[0], vals[0], left[0], list.length - i, rnd), bidFor(who[1], vals[1], left[1], list.length - i, rnd)];
    const win = bids[0] === bids[1] ? -1 : bids[0] > bids[1] ? 0 : 1;
    if (win >= 0) { left[win] -= bids[win]; gain[win] += vals[win] - bids[win]; }
    const A = flip ? 1 : 0, B = 1 - A;
    out.push({ item, ba: bids[A], bb: bids[B], va: vals[A], vb: vals[B], o: win < 0 ? 0 : win === A ? 1 : -1, sa: gain[A], sb: gain[B], la: left[A], lb: left[B] });
  });
  return { rounds: out, sa: out[out.length - 1].sa, sb: out[out.length - 1].sb };
}

// Spieler gegen den eigenen Agenten: er zaehlt, was meist worauf folgt (duel.js:156-163, 171-174)
export function predict(history, sharp) {
  const n = history.length, counts = [1, 1, 1];
  if (n) for (let i = 1; i < n; i++) if (history[i - 1] === history[n - 1]) counts[history[i]] += 2;
  for (let i = 0; i < n; i++) counts[history[i]] += 0.25;
  const best = counts.indexOf(Math.max(...counts));
  return { guess: best, confident: sharp / 100 };
}
export function mindHand(history, sharp, v) { const p = predict(history, sharp); return v < p.confident ? (p.guess + 1) % HANDS : Math.floor(v * 1000) % HANDS; }
/** mind: die Haende der Spielerin gegen den Agenten (b.c = wie schnell er lernt); Zufall aus dem Duell-Seed. */
export function playMind(doc, hands) {
  const rnd = rngFor(doc), hist = [], rounds = [];
  let sa = 0, sb = 0;
  for (const i of hands) { const y = mindHand(hist, doc.b.c, rnd()), o = outcome(i, y); hist.push(i); if (o > 0) sa++; else if (o < 0) sb++; rounds.push({ x: i, y, o, sa, sb }); }
  return { rounds, sa, sb };
}
// "Gegner wuerfeln": der n-te Wurf zum Seed des Blatts, gleiche Wuerfe ergeben denselben Gegner (duel.js:165-168)
export function rival(seed, n, names, faces) {
  const r = mulberry32(hash32("rival|" + seed + "|" + n)), f = (m) => Math.floor(r() * m);
  return { n: names[f(names.length)], e: faces[f(faces.length)], r: f(101), c: f(101), p: f(101) };
}
export function play(doc, lang) {
  const rnd = rngFor(doc), m = doc.m, L = lang === "en" ? "en" : "de";
  if (m === "rps") return playRps(doc, rnd);
  if (m === "rap") return playRap(doc, rnd, L);
  if (m === "auction") return playAuction(doc, rnd, L);
  return { rounds: [], sa: 0, sb: 0 };
}
export function winner(res) { return res.sa === res.sb ? 0 : res.sa > res.sb ? 1 : -1; }

// Warum es so ausging: aus dem Duell und den Reglern gelesen, ohne KI (duel.js:179-209, ohne flappy)
export function explain(doc, res) {
  const w = winner(res), W = w > 0 ? "a" : w < 0 ? "b" : "", Lo = W === "a" ? "b" : W === "b" ? "a" : "", m = doc.m, R = res.rounds || [];
  function out(k, v, tip) { return { k, w: W, v: Object.assign({ a: res.sa, b: res.sb }, v || {}), tip: W ? tip || null : null }; }
  function best(list) { let top = null; list.forEach((c) => { if (c[1] > 0 && (!top || c[1] > top[1])) top = c; }); return top; }
  if (!W) return out("draw");
  if (m === "rps") {
    const me = (r) => (Lo === "a" ? r.x : r.y), foe = (r) => (Lo === "a" ? r.y : r.x), lost = (r) => (Lo === "a" ? r.o < 0 : r.o > 0);
    let counter = 0, again = 0, lead = 0;
    const L = doc[Lo], Wg = doc[W];
    R.forEach((r, i) => {
      if (me(r) === 0) lead++;
      if (!i || !lost(r)) return;
      const p = R[i - 1];
      if (foe(r) === (me(p) + 1) % HANDS) counter++;
      if (me(r) === me(p) && (Lo === "a" ? p.o > 0 : p.o < 0)) again++;
    });
    const top = best([["rpsCounter", counter, { n: counter, p: Wg.p }, "tipCounter"], ["rpsRepeat", again, { n: again, c: L.c }, "tipRepeat"],
      ["rpsLead", lead >= 5 ? lead : 0, { n: lead, h: 0, r: L.r }, "tipLead"]]);
    return top ? out(top[0], top[2], top[3]) : out("luck");
  }
  if (m === "rap") {
    const sum = (side, f) => R.reduce((s, r) => s + r[side][f], 0), ws = W === "a" ? "x" : "y", ls = W === "a" ? "y" : "x";
    const t2 = best([["rapCourage", sum(ws, "base") - sum(ls, "base"), { r: doc[W].r, s: doc[Lo].r }, "tipCourage"], ["rapPatience", sum(ws, "pat") - sum(ls, "pat"), { p: doc[W].p }, "tipPatience"],
      ["rapCounter", sum(ws, "bon") - sum(ls, "bon"), { n: sum(ws, "bon") }, "tipCheek"]]);
    return t2 ? out(t2[0], t2[2], t2[3]) : out("luck");
  }
  if (m === "auction") {
    const lw = Lo === "a" ? 1 : -1, over = R.filter((r) => r.o === lw && (Lo === "a" ? r.ba > r.va : r.bb > r.vb)).length;
    const left = R.length ? (Lo === "a" ? R[R.length - 1].la : R[R.length - 1].lb) : 0;
    const got = (o) => R.filter((r) => r.o === o).length;
    if (over) return out("aucOver", { n: over, r: doc[Lo].r }, "tipOver");
    if (left >= 30) return out("aucLeft", { m: left, p: doc[Lo].p }, "tipLeft");
    return out("aucFew", { k: got(-lw), j: got(lw) }, "tipFew");
  }
  return null;
}
