// zug-kreis "Meine Regeln, dein Problem" – Altregel turns.js:355-373 (GAMES.kreis): fuenf Woerter im Kreis (jedes schlaegt die
// zwei naechsten), drei Testpaare, dann die Reihenfolge raten. Variante raum-tuer "Türsteher" turns.js:797-821 (GAMES.tuer):
// geheime Regel an der Tuer, Wesen aus dem Tagesseed, eine Minute.
import { D, T, fmt, pair, places, mix, hash32, mulberry32 } from "../../engines/zug-z2/lib.js";
import { base } from "../../engines/zug-z2/views.js";

function beats(order, a, b) { const p = places(order), d = (p[b] - p[a] + 5) % 5; return d === 1 || d === 2; }
function circleSoFar(doc, m, now, lang) {
  const X = T(lang), w = m[0][0], o = m[0][1];
  const out = now.map((p) => { let a = p[0], b = p[1]; if (!beats(o, a, b)) { a = p[1]; b = p[0]; } return fmt(X.krs_beat, { a: w[a], b: w[b] }); });
  return out.length ? out.join(" · ") : X.krs_first;
}
function circleTest() { return { w: "pick", l: "krs_test", n: 2, peek: (doc, m, now, lang) => circleSoFar(doc, m, now, lang), from: (doc, m) => m[0][0] }; }
function circleSame(a, b) { const s = a.indexOf(b[0]); return b.every((x, i) => a[(s + i) % 5] === x); }
export const kreis = {
  turns: [
    [{ w: "list", l: "krs_words", n: 5, max: 14 }, { w: "rank", l: "krs_rank", from: (doc, m, now) => now[0] }],
    [0, 1, 2].map(circleTest).concat([{ w: "rank", l: "krs_guess", peek: (doc, m, now, lang) => circleSoFar(doc, m, now, lang), from: (doc, m) => m[0][0] }])
  ],
  result(doc, m, lang) {
    const X = T(lang), o = m[0][1], w = m[0][0], ok = circleSame(o, m[1][3]);
    return { h: ok ? X.krs_right : X.krs_wrong, lines: [fmt(X.krs_was, { w: o.map((i) => w[i]).join(" → ") + " → " + w[o[0]] })] };
  }
};
export { beats, circleSame };

// being: [Tier 0-3, Hut 0/1, Farbe 0-2, Socken 0/1]
export const DOOR_RULES = [(b) => b[1] === 1, (b) => b[1] === 0, (b) => b[3] === 1, (b) => b[3] === 0,
  (b) => b[2] === 0, (b) => b[2] === 1, (b) => b[2] === 2, (b) => b[0] !== 0, (b) => b[0] === 1, (b) => b[0] !== 2];
export function doorOrder(doc) { return mix(doc, "tuer", DOOR_RULES.length); }
// Jedes zweite Wesen liegt auf der anderen Seite der Regel, wenn die letzten zwei gleich waren: Die Regel ist durch Hinsehen
// zu finden, nicht durch Glueck (Altkommentar turns.js:801).
export function doorBeing(doc, r, i, prev) {
  const rnd = mulberry32(hash32("wesen|" + doc.seed + "|" + r + "|" + i));
  const draw = () => [Math.floor(rnd() * 4), rnd() < 0.5 ? 1 : 0, Math.floor(rnd() * 3), rnd() < 0.5 ? 1 : 0];
  let b = draw();
  if (prev && prev.length >= 2 && prev[prev.length - 1] === prev[prev.length - 2]) {
    const want = !prev[prev.length - 1];
    for (let k = 0; k < 24 && DOOR_RULES[r](b) !== want; k++) b = draw();
  }
  return b;
}
export function doorIn(r, b) { return DOOR_RULES[r](b); }
// Darstellung eines Wesens wie alt (turn2.js:366-373): Tier, Hut, Farbe, Socken
const ANI = ["🐱", "🐶", "🐸", "🐰"], COL = ["🔴", "🔵", "🟡"];
const SAY = { de: { a: ["Katze", "Hund", "Frosch", "Hase"], c: ["rot", "blau", "gelb"], hat: "mit Hut", nohat: "ohne Hut", socks: "mit Socken", nosocks: "ohne Socken" },
  en: { a: ["Cat", "Dog", "Frog", "Rabbit"], c: ["red", "blue", "yellow"], hat: "with a hat", nohat: "no hat", socks: "with socks", nosocks: "no socks" } };
export function lookOf(b, lang) {
  const S = SAY[lang] || SAY.de;
  return { look: [ANI[b[0]], b[1] ? "🎩" : "", COL[b[2]], b[3] ? "🧦🧦" : ""].filter(Boolean), a11y: [S.a[b[0]], b[1] ? S.hat : S.nohat, S.c[b[2]], b[3] ? S.socks : S.nosocks].join(", ") };
}
export const tuer = {
  local: true, daily: true,
  // Widget tuer (ADR 0001): Regelfolge und je Regel 40 Wesen mit Antwort aus dem Seed; Uhr und Serie haelt das Widget
  view: {
    door(p, c) {
      const rules = doorOrder(c.doc).map((r) => {
        const prev = [], beings = [];
        for (let i = 0; i < 40; i++) { const b = doorBeing(c.doc, r, i, prev), inn = doorIn(r, b); beings.push({ in: inn, ...lookOf(b, c.lang) }); prev.push(inn); }
        return { beings }; // die Regel selbst bleibt geheim, erst das Ergebnis nennt sie
      });
      return { ...base(p, c, { secs: p.secs, streak: p.streak, rules }), t: "tuer" };
    }
  },
  turns: [[{ w: "door", l: "tue_go", auto: true, secs: 60, streak: 4 }]],
  result(doc, m, lang) {
    const X = T(lang), a = m[0][0], k = a[0], order = doorOrder(doc), lines = [];
    for (let i = 0; i <= Math.min(k, DOOR_RULES.length - 1); i++) lines.push((i < k ? "✓ " : "✗ ") + pair(D.doorRules, order[i], lang));
    lines.push(fmt(X.tue_right, { n: a[1], m: a[2] }));
    return { h: fmt(X.tue_h, { n: k }), lines };
  }
};
export const GAMES = { kreis, tuer };
export default kreis;
