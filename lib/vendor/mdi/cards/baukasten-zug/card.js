// Karte "baukasten-zug" (Strang B): Zugspiele aus "mdi-bau/1" (place, flip, answer) ueber den Zugvertrag v0.2
// (init/step/observe/status/moves/accepts/view/bot). Die Beschreibung steht im oeffentlichen Zustand (pub.D), weil step,
// observe und view nur den Zustand bekommen; Texte stehen auf Papier und sind deshalb immer Tinte (auch im Dunkelmodus,
// wo --text hell wird; e2e 412 dunkel, axe color-contrast); nichts davon ist geheim (manifest hidden "none", Brett folgt aus dem Seed).
import manifest from "./manifest.json" with { type: "json" };
import * as Z from "../../engines/baukasten/zug.js";
import { descOf, paramsFromDoc, docFromParams, sealed } from "../../engines/baukasten/karte.js";
import { BADGE } from "../../engines/frei/seal.js";

const pubOf = (state) => state.pub;
const T = { de: { you: "Du bist dran", other: "Die andere Seite ist dran", score: "Stand", right: "Richtig!", wrong: "Leider falsch", answer: "Antwort", send: "Antworten", hint: "Tippe ein Feld", col: "Spalte", over: "Vorbei" },
  en: { you: "Your turn", other: "The other side's turn", score: "Score", right: "Correct!", wrong: "Not quite", answer: "Answer", send: "Answer", hint: "Tap a field", col: "Column", over: "Game over" } };

function boardView(d, p, seat, L, draft) {
  const t = d.turn, mine = p.tu === seat && !p.over;
  if (t.kind === "place") {
    const face = (v) => (v < 0 ? "" : (d.things.find((x) => x.id === t.pieces[v]) || {}).emoji || (d.things.find((x) => x.id === t.pieces[v]) || {}).text || String(v + 1));
    if (t.drop) {
      const rows = [];
      for (let y = 0; y < t.rows; y++) rows.push({ t: "row", children: Array.from({ length: t.cols }, (_, x) => { const v = p.b[y * t.cols + x]; return { t: "tile", value: v < 0 ? null : face(v), fill: v < 0 ? "paper" : "yellow", a11y: (v < 0 ? "leer" : face(v)) + " " + (x + 1) + "/" + (y + 1), focus: p.last === y * t.cols + x } }) });
      return [{ t: "stack", part: "brett", children: rows }, { t: "choice", label: L.col, wrap: true, options: Array.from({ length: t.cols }, (_, c) => ({ label: String(c + 1), input: { t: "put", seat, i: c }, disabled: !mine || p.b[c] !== -1 })) }];
    }
    return [{ t: "choice", label: L.hint, wrap: true, part: "brett", options: p.b.map((v, i) => ({ label: v < 0 ? "·" : face(v), input: { t: "put", seat, i }, disabled: !mine || v !== -1, on: p.last === i })) }];
  }
  if (t.kind === "flip") {
    return [{ t: "choice", label: L.hint, wrap: true, part: "brett", options: p.f.map((f, i) => {
      const open = p.up[i] || p.sel.includes(i) || p.miss.includes(i);
      return { label: open ? t.pairs[f] : "?", input: { t: "flip", seat, i }, disabled: !mine || p.up[i] || p.sel.includes(i), on: p.sel.includes(i) };
    }) }];
  }
  if (t.kind === "answer") {
    if (p.q >= p.order.length) return [];
    const it = t.items[p.order[p.q]], out = [{ t: "text", role: "title", fill: "ink", text: it.q }];
    if (p.show[p.q]) out.push({ t: "text", role: "big", fill: "ink", text: p.show[p.q] });
    if (t.ask === "pick") out.push({ t: "choice", label: L.answer, options: p.opts[p.q].map((o, a) => ({ label: o === 0 ? it.a : it.wrong.filter(Boolean)[o - 1], input: { t: "say", seat, a }, disabled: !mine })) });
    else out.push({ t: "field", key: "a", label: L.answer, value: String((draft && draft.a) || ""), max: 40, mode: "text" }, { t: "go", label: L.send, input: { t: "say", seat, a: String((draft && draft.a) || "") }, disabled: !mine || !(draft && draft.a), why: mine ? "" : L.other });
    return out;
  }
  return [];
}

export default {
  manifest,
  init({ rng, params, players }) {
    const d = descOf(params, "turn"), s = Z.init(d, rng, players);
    return { pub: { ...s.pub, D: d, ...(sealed(params) ? { ki: 1 } : {}) }, priv: [null, null] };
  },
  step(state, input) { const d = state.pub.D, r = Z.step(d, { pub: state.pub, priv: state.priv }, input); return { pub: { ...r.pub, D: d }, priv: r.priv }; },
  observe(state) { return pubOf(state); },
  status(state) { return Z.status(state.pub.D, state); },
  moves(obs, seat) { return Z.moves(obs.D, obs, seat); },
  accepts(obs, seat, input) { return Z.accepts(obs.D, obs, seat, input); },
  bot(obs, seat, { level, seed }) { return Z.botMove(obs.D, obs, seat, level || 2, String(seed)); },
  view(obs, seat, ctx = {}) {
    const d = obs.D, L = T[ctx.lang === "en" ? "en" : "de"], two = obs.n === 2;
    const head = obs.over ? L.over : obs.tu === seat ? L.you : L.other;
    const fb = d.turn.kind === "answer" && obs.last >= 0 ? [{ t: "text", role: "label", fill: "ink", text: obs.last ? L.right : L.wrong + " – " + d.turn.items[obs.order[obs.lastQ]].a }] : [];
    return { t: "frame", fill: "paper", children: [{ t: "stack", children: [
      { t: "text", role: "label", fill: "ink", text: d.goal },
      { t: "row", part: "stand", children: [{ t: "text", role: "small", fill: "ink", text: L.score + " " + (two ? obs.sc[0] + " : " + obs.sc[1] : obs.sc[0]) }, { t: "text", role: "small", fill: "ink", text: head }] },
      ...fb,
      ...boardView(d, obs, seat, L, ctx.draft),
      ...(obs.ki ? [{ t: "text", role: "small", fill: "ink", text: BADGE[ctx.lang === "en" ? "en" : "de"] }] : [])
    ] }] };
  },
  fromFree(doc) { return paramsFromDoc(doc, "turn", manifest.params.properties); },
  toFree(params) { return docFromParams(params); }
};
