// Zugkarte "Frag mich ab" (alt zug-abfragen) mit der eingeklappten Variante "Quiz aus Lernstoff" (alt zug-quiz).
// Ohne Paket: vier eigene Lernkarten je Person (alt turns.js GAMES.abfragen). Mit Paket (Nachtpaket oder eigenes, z. B.
// von der KI-Art quiz): die Spiele der Quiz-Engine (alt quizpack.js), Modus l/f/g wie im Altcode.
import manifest from "./manifest.json" with { type: "json" };
import TEXTS from "../../engines/quiz/texts.json" with { type: "json" };
import { makeCard } from "../../engines/quiz/flow.js";
import { packOf, packGame, ownGame } from "../../engines/quiz/games.js";
import { sanitize, fits } from "../../engines/quiz/pack.js";
import { gameSeed } from "../../engines/seed32/seed32.js";

/** Titel der Spielarten (alt ideas.json zug-abfragen, zug-quiz). */
export const VARIANTS = { abfragen: { de: "Frag mich ab", en: "Quiz me" }, quiz: { de: "Quiz aus Lernstoff", en: "Quiz from your notes" } };

const card = makeCard(manifest, {
  texts: TEXTS,
  setup(params, rng) {
    const g = params.variante === "quiz" ? "quiz" : "abfragen";
    return { g, seed: gameSeed(rng), pk: packOf(params, g, g === "quiz") };
  },
  // Quiz braucht ein Paket (alt GAMES.quiz needs): ohne Paket lehnt setup ab (Review: keine tote Partie)
  game(pub) { return pub.pk ? packGame(pub) : pub.g === "abfragen" ? ownGame() : null; }
});

// ---------- Übergabe an die freie Karte (Strang K) ----------
// Doc der freien Karte in der Kategorie Quiz: {k:"turn", g:"quiz"|"abfragen", t, pk:{t, m?, q:[[Frage, richtig, falsch…]…]}}
// (Server compose setzt m "l"; fehlt m, gilt "l" wie dort). Ohne Paket wie Z2: {k:"turn", i:"zug-abfragen"|"zug-quiz"}.
// Das Paket geht durch sanitize und muss zur Spielart passen; sonst null (kein stiller Ersatz).
function defaults(schema) { const o = {}; for (const [k, v] of Object.entries(schema.properties)) o[k] = structuredClone(v.default); return o; }
const OLD = { "zug-abfragen": "abfragen", "zug-quiz": "quiz" };
card.fromFree = function fromFree(doc) {
  if (!doc || typeof doc !== "object" || doc.k !== "turn") return null;
  const p = defaults(manifest.params);
  if (doc.pk !== undefined && doc.pk !== null) {
    const g = doc.g === "abfragen" ? "abfragen" : doc.g === "quiz" ? "quiz" : null;
    if (!g || typeof doc.pk !== "object") return null;
    const pk = sanitize({ m: "l", ...doc.pk });
    if (!pk || !fits(g, pk)) return null;
    return { ...p, variante: g, paket: "", pk };
  }
  if (!OLD[doc.i]) return null;
  return { ...p, variante: OLD[doc.i] };
};
card.toFree = function toFree(params) {
  const g = params && params.variante === "quiz" ? "quiz" : "abfragen";
  if (params && params.pk) return { k: "turn", g, t: params.pk.t, pk: params.pk };
  return { k: "turn", i: g === "quiz" ? "zug-quiz" : "zug-abfragen" };
};
export default card;
