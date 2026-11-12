// Die Spiele der Quiz-Karten als Zugtabellen für flow.js (alt:src/quizpack.js game/items, alt:src/turns.js
// GAMES.abfragen und GAMES.schaetzen, alt:src/quizspiele.js preis). Texte wörtlich aus turn.json/quizspiele.json.
import * as P from "./pack.js";
import { ende } from "./make.js";
import * as R from "./preis.js";
import PACKS from "./quiz-packs.json" with { type: "json" };
import { fmt, gameSeed } from "../seed32/seed32.js";

export const NIGHT = PACKS.packs;
export function nightPack(id) { const x = NIGHT.find((p) => p.id === id); return x ? P.sanitize(x.pk) : null; }
/** Nachtpakete, die zu dieser Spielart passen (alt quiz-ui nightPacks, ohne Sprachvorrang: das macht die Ansicht). */
export function nightFor(g) { return NIGHT.filter((x) => x && x.pk && P.fits(g, P.sanitize(x.pk))).map((x) => x.id); }

/** Paket aus den params: eigenes pk oder Nachtpaket, nie beide (widersprüchlicher Link wird abgelehnt, nicht still
 *  aufgelöst). Ein ungültiges Paket wird abgelehnt (nicht still verworfen). need: die Spielart hat ohne Paket keinen
 *  gültigen Zug (Quiz, Typen) – dann ist auch "kein Paket" eine Ablehnung statt einer toten Partie. */
export function packOf(params, g, need = false) {
  if (params.pk && params.paket) throw new Error("ungueltig: eigenes Paket und Nachtpaket zugleich");
  if (params.pk) {
    const pk = P.sanitize(params.pk);
    if (!pk || !P.fits(g, pk)) throw new Error("ungueltig: Fragepaket");
    return pk;
  }
  if (params.paket) {
    const pk = nightPack(params.paket);
    if (!pk || !P.fits(g, pk)) throw new Error("ungueltig: Nachtpaket " + params.paket);
    return pk;
  }
  if (need) throw new Error("ungueltig: Spielart " + g + " braucht ein Fragepaket");
  return null;
}
/** Spielarten ohne Paket (Was kostet das?): ein Paket in den params wäre still ignoriert, also Ablehnung. */
export function noPack(params, g) {
  if (params.pk || params.paket) throw new Error("ungueltig: Spielart " + g + " nimmt kein Fragepaket");
  return null;
}
export function setupWith(g) {
  return (params, rng) => {
    const seed = gameSeed(rng);
    const pk = packOf(params, g);
    return { g, seed, pk };
  };
}
function doc(pub) { return { seed: pub.seed, pk: pub.pk, g: pub.g }; }

// ---------- Spiele mit Paket (alt quizpack.items / game) ----------
function items(pub) {
  const d = doc(pub), g = pub.g;
  if (g === "schaetzen") {
    return P.nums(d).map((i) => ({ w: "slide", l: "sch_go", min: 0, max: P.ZMAX * 3, maxOf: (p) => P.top(doc(p), i), peek: (p) => p.pk.q[i][0], unit: (p) => (p.pk.u || [])[i] || "" }));
  }
  const out = [];
  pub.pk.q.forEach((row, i) => {
    if (g === "abfragen") {
      out.push({ w: "show", l: "abf_think", list: (p) => [p.pk.q[i][0]] });
      out.push({ w: "pick", l: "abf_knew", top: (p) => p.pk.q[i][1], from: (p, now, lang, L) => [L.abf_yes, L.abf_no] });
    } else if (g === "woerter") out.push({ w: "pick", l: "pk_match", top: (p) => p.pk.q[i][1], from: (p) => P.others(doc(p), i).map((k) => p.pk.q[k][0]) });
    else if (g === "typen") out.push({ w: "pick", l: "pk_pick", top: (p) => p.pk.q[i][0], from: (p) => P.typeChoices(doc(p), i) });
    else out.push({ w: "pick", l: "pk_pick", top: (p) => p.pk.q[i][0], from: (p) => P.choices(doc(p), i) });
  });
  return out;
}
function intro(p, L) { return [p.pk.t, fmt(L.pk_intro, { n: p.g === "schaetzen" ? P.nums(doc(p)).length : p.pk.q.length })]; }
function scoreLine(s, who, L) { return fmt(L.pk_score, { w: who, n: s.ok, m: s.n }); }
function endeOf(p, ms, L, who) { return ende(doc(p), ms.map((a) => P.score(doc(p), "schaetzen", a)), L, who); }

export function packGame(pub) {
  const g = pub.g, fl = P.flow(g, pub.pk);
  if (!fl) return null;
  const it = items(pub), part = g === "schaetzen";
  const first = { w: "show", l: "pk_start", list: (p, now, lang, L) => intro(p, L) };
  if (fl === "free") return { turns: [[first], it], result: (p, lang, L) => ({ h: p.pk.t, lines: endeOf(p, [p.m[1]], L, []) }) };
  if (fl === "l") return {
    turns: [it, it],
    result: (p, lang, L) => {
      if (part) return { h: p.pk.t, lines: endeOf(p, p.m, L, [L.first, L.second]) };
      const a = P.score(doc(p), g, p.m[0]), b = P.score(doc(p), g, p.m[1]), open = a.open.concat(b.open).filter((x, i, all) => all.indexOf(x) === i);
      return { h: p.pk.t, lines: [scoreLine(a, L.first, L), scoreLine(b, L.second, L)].concat(open.slice(0, 4)) };
    }
  };
  const last = {
    w: "show", l: g === "typen" ? "pk_type" : "pk_you", later: g === "typen" ? "pk_group" : "pk_team",
    list: (p, now, lang, L) => {
      if (g === "typen") { const y = p.pk.y[P.typeOf(doc(p), now)]; return [fmt(L.pk_is, { n: y[0] }), y[1]]; }
      return part ? endeOf(p, [now], L, [L.pk_me]) : [scoreLine(P.score(doc(p), g, now), L.pk_me, L)];
    },
    notes: (p, now) => (g === "typen" || part ? [] : P.score(doc(p), g, now).open)
  };
  return { turns: [[first], it.concat([last])], stay: true, result: (p, lang, L) => ({ h: p.pk.t, lines: [L[g === "typen" ? "pk_group" : "pk_team"]] }) };
}

// ---------- Frag mich ab ohne Paket: vier eigene Lernkarten je Person (alt turns.js GAMES.abfragen) ----------
function cardPrompts() { return [{ w: "list", l: "abf_q", n: 4, max: 28, bytes: 130 }, { w: "list", l: "abf_a", n: 4, max: 24, same: true, bytes: 110 }]; }
function cardBack(t) {
  const out = [];
  [0, 1, 2, 3].forEach((i) => {
    out.push({ w: "show", l: "abf_think", list: (p) => [p.m[t][t ? 8 : 0][i]] });
    out.push({ w: "pick", l: "abf_knew", top: (p) => p.m[t][(t ? 8 : 0) + 1][i], from: (p, now, lang, L) => [L.abf_yes, L.abf_no] });
  });
  return out;
}
const OWN = {
  turns: [cardPrompts(), cardBack(0).concat(cardPrompts()), cardBack(1)],
  result: (p, lang, X) => {
    const m = p.m, a = [0, 1, 2, 3].map((i) => m[1][i * 2 + 1][0]), b = [0, 1, 2, 3].map((i) => m[2][i * 2 + 1][0]);
    const sa = a.filter((x) => x === 0).length, sb = b.filter((x) => x === 0).length, lines = [fmt(X.abf_score, { w: X.second, n: sa }), fmt(X.abf_score, { w: X.first, n: sb })];
    a.forEach((x, i) => { if (x) lines.push(fmt(X.abf_open, { w: X.second, q: m[0][0][i] })); });
    b.forEach((x, i) => { if (x) lines.push(fmt(X.abf_open, { w: X.first, q: m[1][8][i] })); });
    return { h: X.abf_h, lines };
  }
};
export function ownGame() { return OWN; }

// ---------- Was kostet das? (alt quizspiele preis) ----------
function guess(i) {
  return {
    w: "slide", l: "pre_go", min: 0, max: R.PREIS_MAX, step: R.STEP, money: true, maxOf: (p) => R.top(p.seed, i), defOf: (p) => R.start(p.seed, i),
    title: (p, now, lang, L) => fmt(L.pre_nr, { i: i + 1, m: R.PREIS_N }),
    peek: (p, now, lang, L) => fmt(L.pre_q, { s: R.items(lang)[R.preisItems(p.seed)[i]].t })
  };
}
const PREIS_TURN = Array.from({ length: R.PREIS_N }, (x, i) => guess(i));
const PREIS = {
  turns: [PREIS_TURN, PREIS_TURN],
  result: (p, lang, L) => {
    const a = R.off(p.seed, p.m[0]), b = R.off(p.seed, p.m[1]), X = R.items(lang);
    const h = a === b ? L.pre_tie : fmt(L.pre_win, { w: a < b ? L.first : L.second });
    const note = R.preisItems(p.seed).map((k, i) => fmt(L.pre_line, { s: X[k].s, p: R.money(R.cents(k), lang), a: R.money(p.m[0][i], lang), b: R.money(p.m[1][i], lang) })).join(" · ");
    return { h, lines: [fmt(L.pk_off, { w: L.first, n: a }), fmt(L.pk_off, { w: L.second, n: b }), L.pre_src], note };
  }
};
export function preisGame() { return PREIS; }

// ---------- Fünf mal schätzen ohne Paket (alt turns.js GAMES.schaetzen: Tageskarte, eine Person) ----------
function guessAsk(i) { return { w: "slide", l: "sch_go", min: 0, max: 12000, maxOf: (p) => R.guesses(p.seed)[i][3], peek: (p, now, lang) => R.guesses(p.seed)[i][lang === "en" ? 1 : 0] }; }
const SCH = {
  turns: [[0, 1, 2, 3, 4].map(guessAsk)],
  result: (p, lang, X) => {
    const g = R.guesses(p.seed), o = R.guessOff(p.seed, p.m[0]);
    return { h: fmt(X.sch_h, { n: o.mean }), lines: o.offs.map((x, i) => fmt(X.sch_line, { i: i + 1, n: x })), note: g.map((q) => q[lang === "en" ? 1 : 0] + " " + q[2]).join(" · ") };
  }
};
export function schaetzenGame() { return SCH; }
