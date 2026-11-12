// Server-Docs der freien Karte und des Decks: bereinigen, pruefen, auf eine Karte des Neuentwurfs abbilden (Strang K).
// Ein Doc kommt vom Server (POST /api/duell/ai kind karte: options[{art, doc, ki}], GET /api/duell/deck) im Format der alten
// App (lib/duell-karte.mjs compose, gegen deren sanitizeDoc geprueft). Hier wird es wie ein fremder Link behandelt: nur
// bekannte Felder, feste Laengen, nichts wird erfunden (A4). Altcode (Untergrenze): create-ui.js artOk/kindOk/preview/lines,
// daily.js sanitizeDoc/sanitizeKi/sanitizeStickers.
//
// Abbildung auf Karten (Kartenvertrag): card/meme -> Karte "frei" (src/cards/frei); game -> "flug", lauf -> "lauf" (Strang L);
// quiz -> "zug-abfragen" (Strang S, Fragepaket); faehigkeit -> die Katalogkarte doc.i (Z1/Z2). Jede Zielkarte bringt ihren
// eigenen Adapter mit: `fromFree(doc) -> params | null` am Kartenmodul (und `toFree(params) -> doc` fuer Robot/Verfeinern).
// Fehlt die Karte oder ihr Adapter, sagt die Seite das ehrlich (frei_missing); es entsteht nie still eine andere Karte.

import { CARD_STYLES, PHOTO_STYLES, PAIRS, PAIR_NAMES, CARD_STICKERS, txt, emoji, sanitizeKi, sanitizeDoc, fillOf, freiParams, freiDoc } from "../../engines/frei/doc.js";
export { CARD_STYLES, PHOTO_STYLES, PAIRS, PAIR_NAMES, CARD_STICKERS, txt, emoji, sanitizeKi, sanitizeDoc, fillOf, freiParams, freiDoc };
export const ARTS = ["card", "meme", "game", "quiz", "faehigkeit"];
export const GENRES = ["G1", "G2"];
/** Wer spielt? je Genre (Altcode MODES): allein immer, Duell per Link (Geist bzw. Punkte), kein Bot, kein Live */
export const MODES = { G1: { allein: true, bot: false, duell: true }, G2: { allein: true, bot: false, duell: true } };
/** Was die freie Karte noch nicht baut, mit den naechsten Katalogkarten oder einem Genre (Altcode SOON) */
export const SOON = [["strategie", ["zug-bluff", "zug-steine"]], ["schieben", ["zug-steine"]], ["rennen", "G1"], ["brett", ["tisch-skat"]], ["schaetzen", ["quiz-preis"]], ["bluff", ["zug-luege", "zug-bluff"]], ["skala", []]];
const KIND_OF = { card: "card", meme: "photo", game: "game", quiz: "turn", lauf: "lauf" };

/** Was zurueckkam, muss das Gefragte sein (Kategorie und Art), sonst verworfen und zurueckgegeben (Altcode artOk/kindOk). */
export function artOk(asked, art) { return art === asked || (asked === "game" && art === "lauf"); }
export function kindOk(art, doc) {
  if (!doc) return false;
  if (art === "faehigkeit") return (doc.k === "turn" || doc.k === "duel") && !!doc.i;
  if (art === "quiz") return doc.k === "turn" && !!doc.pk;
  return doc.k === KIND_OF[art];
}

/** Die id einer freien Karte fuer Status-Gate und Deck: die Wurzel eines Remix (fr), sonst h.slice(0, 22) des Siegels. */
export function freeIdOf(doc) {
  if (!doc) return "";
  if (typeof doc.fr === "string" && /^[A-Za-z0-9_-]{22}$/.test(doc.fr)) return doc.fr;
  return doc.ki && doc.ki.k === "karte" && typeof doc.ki.h === "string" && /^[A-Za-z0-9_-]{43}$/.test(doc.ki.h) ? doc.ki.h.slice(0, 22) : "";
}

// WCAG-Kontrast zweier #rrggbb
export function contrast(a, b) {
  const L = (h) => { const v = [1, 3, 5].map((i) => { const c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Die Zielkarte eines Docs im Kartenvertrag. cardOf: Kartenregister. -> {cardId, params} | {missing: name} */
export function targetOf(doc, cardOf) {
  if (!doc) return { missing: "?" };
  if (doc.k === "card" || doc.k === "photo") return { cardId: "frei", params: freiParams(doc) };
  const id = doc.k === "game" ? "flug" : doc.k === "lauf" ? "lauf" : doc.pk ? "zug-abfragen" : doc.i || "?";
  const card = cardOf(id);
  if (!card || typeof card.fromFree !== "function") return { missing: id };
  let params = null;
  try { params = card.fromFree(doc); } catch (e) { params = null; }
  return params ? { cardId: card.manifest.id, params } : { missing: id };
}

/** Kurzbeschreibung fuer die Vorschau (Altcode lines/preview): Titel, Zeilen, Sticker, Fotohinweis. */
export function previewOf(doc) {
  const sk = (doc.sk || []).map((s) => s.e);
  if (doc.k === "card") return { title: doc.t || "", lines: [doc.x || ""], sk, photo: false };
  if (doc.k === "photo") return { title: doc.t || "", lines: [doc.x || "", doc.y || ""], sk, photo: true };
  if (doc.k === "game") { const g = doc.g || {}; return { title: [g.emoji, g.title || doc.t].filter(Boolean).join(" "), lines: [(Array.isArray(g.route) ? g.route : []).map((r) => r && r.e).filter(Boolean).join(" → ")], sk: [], photo: false, kind: "game" }; }
  if (doc.k === "lauf") { const l = doc.l || {}; return { title: [l.e, doc.t].filter(Boolean).join(" "), lines: [l.m === "ziel" ? "ziel" : "endlos", [l.o, l.c, l.f].filter(Boolean).join(" ")], sk: [], photo: false, kind: "lauf" }; }
  if (doc.pk) return { title: doc.pk.t || doc.t || "", lines: [doc.pk.q[0][0]], sk: [], photo: false, kind: "quiz", n: doc.pk.q.length };
  return { title: doc.t || "", lines: [doc.s || ""], sk: [], photo: false, kind: "faehigkeit", uses: doc.i };
}

// ---- Inhalt einer geteilten freien Karte (Status-Gate) ------------------------------------------------------------------
// Byte fuer Byte dieselbe Projektion wie der Server (CADS-DEMO-wrapper lib/duell-deck.mjs gateView, fix/deck-status-hash):
// nur, was eine Person sieht. gateHash = base64url(SHA-256(canonical(gateView(doc)))). Feste Vektoren in test/frei.test.js.
export function gateView(doc) {
  const d = doc && typeof doc === "object" ? doc : {}, s = (x) => (typeof x === "string" ? x : "");
  const sk = [...new Set((Array.isArray(d.sk) ? d.sk : []).map((x) => s(x && x.e)).filter(Boolean))].slice(0, 6);
  const v = { k: s(d.k), t: s(d.t), col: Array.isArray(d.col) ? d.col.map((c) => s(c).toLowerCase()) : [] };
  if (d.k === "card") Object.assign(v, { x: s(d.x), st: s(d.st), sk });
  else if (d.k === "photo") Object.assign(v, { x: s(d.x), y: s(d.y), st: s(d.st), sk });
  else if (d.k === "game") { const g = d.g && typeof d.g === "object" ? d.g : {}; v.g = { title: s(g.title), emoji: s(g.emoji), theme: s(g.theme), route: (Array.isArray(g.route) ? g.route : []).map((r) => [s(r && r.p), s(r && r.t), s(r && r.e)]) }; }
  else if (d.k === "lauf") { const l = d.l && typeof d.l === "object" ? d.l : {}; v.l = [s(l.m), s(l.w), s(l.e), s(l.o), s(l.c), s(l.f)]; }
  else { v.i = s(d.i); v.s = s(d.s); v.w = s(d.w); v.pk = d.pk && typeof d.pk === "object" ? { t: s(d.pk.t), q: Array.isArray(d.pk.q) ? d.pk.q.map((q) => (Array.isArray(q) ? q.map(s) : [])) : [] } : null; }
  return v;
}
/** Was das Gate fragt: [{cid, doc|null}] – eine Karte mit eigenem Siegel (ki.h) mit ihrem Inhalt, ein Remix (fr) nur per id. */
export function gateChecksOf(doc) {
  if (!doc) return [];
  const out = [];
  if (doc.ki && doc.ki.k === "karte" && typeof doc.ki.h === "string" && /^[A-Za-z0-9_-]{43}$/.test(doc.ki.h)) out.push({ cid: doc.ki.h.slice(0, 22), doc });
  if (typeof doc.fr === "string" && /^[A-Za-z0-9_-]{22}$/.test(doc.fr) && !out.some((c) => c.cid === doc.fr)) out.push({ cid: doc.fr, doc: null });
  return out;
}
