// Zugablauf der Quiz-Karten als Daten (wie alt turns.js: ein Spiel = Züge, ein Zug = Eingaben/"prompts"). Daraus baut
// makeCard die Vertragsfunktionen (init/step/observe/status/moves/accepts/view). Zug t gehört Sitz t % 2 (alt state.who).
// Antworten werden wie im Altcode abgelegt: show -> 0, pick -> [k], slide -> Zahl, list -> [Text, ...].
//
// Eingabe (ADR 0001 c/f, wie der Zug-Kern von Z1): { t:"ans", seat, a:<Rohwert>, d? } beantwortet genau einen prompt;
// a ist der Wert, den das Widget schickt (show 0, pick [k], slide Cent/Zahl, list [Text, ...]). d = UTC-Tag, den der
// Host bei manifest.inputDay stempelt; er zählt nur für die Tageskarte ohne Paket (Seed = Tag, alt Turns.today()).
// Schieber und Listen lassen sich nicht aufzählen: accepts() prüft sie; moves() liefert deterministische Hinweiszüge.
import { questClean, questFold } from "./clean.js";
import { fmt } from "../seed32/seed32.js";
function int(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }
function distinct(a) { return new Set(a).size === a.length; }
export function copyPub(p) { return structuredClone(p); }

/** Ist v eine Antwort, die der Bildschirm auf prompt p geben konnte? (alt turns.js okAnswer, nur die Arten hier) */
export function okAnswer(p, v, pub, now, L) {
  if (p.w === "show") return v === 0;
  // Härtung gegenüber dem Altcode (turns.js:1158 prüfte nur den Bereich): ein Schieber mit Schrittweite liefert nur
  // Vielfache davon (Was kostet das?: 5 Cent), also nimmt auch accepts/step nur diese an – ein Link kann nichts senden,
  // was der Bildschirm nicht senden kann. Golden-Eingaben sind Schieberwerte (test/fixtures/gen-quiz-golden.cjs).
  if (p.w === "slide") return int(v, p.min || 0, p.maxOf ? p.maxOf(pub) : p.max) && (!p.step || v % p.step === 0);
  if (p.w === "list") {
    if (!Array.isArray(v) || v.length !== p.n) return false;
    if (p.bytes && new TextEncoder().encode(v.join("")).length > p.bytes) return false; // das ganze Spiel muss in den Link passen
    return v.every((x) => typeof x === "string" && !!questClean(x, p.max) && questClean(x, p.max) === x) && (p.same || distinct(v.map(questFold)));
  }
  if (p.w === "pick") { const n = p.from(pub, now, "de", L).length; return Array.isArray(v) && v.length === 1 && int(v[0], 0, n - 1); }
  return false;
}
const KEYS = ["t", "seat", "a", "d"];
function toAnswer(p, input) {
  if (!input || input.t !== "ans" || !Object.keys(input).every((k) => KEYS.includes(k))) return undefined;
  if (input.d !== undefined && !int(input.d, 1, 10000000)) return undefined;
  const a = input.a;
  if (p.w === "show") return a === 0 ? 0 : undefined;
  if (p.w === "pick") return Array.isArray(a) ? a.slice() : undefined;
  if (p.w === "slide") return a;
  if (p.w === "list") return Array.isArray(a) ? a.slice() : undefined;
  return undefined;
}
/** Seed der Partie; die Tageskarte ohne Paket bekommt ihn mit dem ersten Zug aus dem Tagesstempel d (sonst ""). */
function seeded(pub, d) { return pub.seed || !Number.isInteger(d) ? pub : { ...pub, seed: String(d) }; }
/** Hinweiswert eines Schiebers: Vorgabe der Karte, sonst die Mitte, auf die Schrittweite gerundet. */
function slideHint(p, pub) {
  const lo = p.min || 0, hi = p.maxOf ? p.maxOf(pub) : p.max, st = p.step || 1;
  if (p.defOf) return p.defOf(pub);
  return lo + Math.floor((hi - lo) / 2 / st) * st;
}
/** Hinweisliste: eindeutige kurze Einträge, die durch den Wortfilter gehen (nur für Bot-freie Testläufe und Tipps). */
function listHint(p) { const out = []; for (let i = 0; i < p.n; i++) out.push(String(i + 1)); return out; }

/**
 * @param {object} manifest
 * @param {{setup:(params:object, seed:string)=>object, game:(pub:object)=>({turns:object[][], result:(pub, lang, X)=>({h:string, lines:string[], note?:string})}|null),
 *          texts:object, title?:(pub, lang, X)=>string}} spec
 */
export function makeCard(manifest, spec) {
  const X = (lang) => spec.texts[lang] || spec.texts.de;
  function at(pub) {
    const g = spec.game(pub);
    if (!g) return { g: null, prompt: null, t: -1 };
    const t = pub.m.length;
    if (t >= g.turns.length) return { g, prompt: null, t };
    return { g, prompt: g.turns[t][pub.now.length], t };
  }
  function status(state) {
    const p = state.pub, { g, t } = at(p);
    if (!g) return { over: false, turn: -1, reveal: false, score: [], winner: -1 };
    const over = t >= g.turns.length;
    return { over, turn: over ? -1 : t % 2, reveal: false, score: [], winner: -1 };
  }
  // Hinweiszüge (ADR 0001 f: moves() bleibt für Bot und Hinweise): show 0, jede pick-Option, Schieber-Vorgabe bzw.
  // -Mitte, eine gültige Liste. Ohne Seed (Tageskarte vor dem ersten Zug) ist nur der untere Schieberrand sicher gültig.
  function moves(obs, seat) {
    const p = obs.pub, { prompt, t } = at(p);
    if (!prompt || t % 2 !== seat) return [];
    if (prompt.w === "show") return [{ t: "ans", seat, a: 0 }];
    if (prompt.w === "pick") return prompt.from(p, p.now, "de", X("de")).map((x, k) => ({ t: "ans", seat, a: [k] }));
    if (prompt.w === "slide") return [{ t: "ans", seat, a: p.seed ? slideHint(prompt, p) : prompt.min || 0 }];
    if (prompt.w === "list") return [{ t: "ans", seat, a: listHint(prompt) }];
    return [];
  }
  function accepts(obs, seat, input) {
    const p0 = obs.pub, { prompt, t } = at(p0);
    if (!prompt || t % 2 !== seat || !input || input.seat !== seat) return false;
    const v = toAnswer(prompt, input), p = seeded(p0, input.d);
    if (!p.seed) return false;
    return v !== undefined && okAnswer(prompt, v, p, p.now, X("de"));
  }
  return {
    manifest,
    init({ rng, params }) { return { pub: { ...spec.setup(params, rng), m: [], now: [] }, priv: [null, null] }; },
    step(state, input) {
      const p = copyPub(state.pub), { g, prompt, t } = at(p);
      if (!g) throw new Error("ungueltig: kein Paket");
      if (!prompt) throw new Error("ungueltig: Partie vorbei");
      if (!input || input.seat !== t % 2) throw new Error("ungueltig: nicht am Zug");
      if (!p.seed) { if (!Number.isInteger(input.d) || input.d < 1) throw new Error("ungueltig: Tag fehlt"); p.seed = String(input.d); }
      const v = toAnswer(prompt, input);
      if (v === undefined || !okAnswer(prompt, v, p, p.now, X("de"))) throw new Error("ungueltig: " + prompt.w);
      p.now.push(v);
      if (p.now.length === g.turns[t].length) { p.m.push(p.now); p.now = []; }
      return { pub: p, priv: state.priv.slice() };
    },
    observe(state) { return { pub: copyPub(state.pub), mine: null }; },
    status, moves, accepts,
    /** Ergebnis (nur wenn vorbei), für Tests und die Ansicht. */
    result(pub, lang) { const { g, t } = at(pub); return g && t >= g.turns.length ? g.result(pub, lang, X(lang)) : null; },
    view(obs, seat, ctx) {
      const lang = ctx.lang === "en" ? "en" : "de", L = X(lang), { g, prompt, t } = at(obs.pub), kids = [];
      // Tageskarte vor dem ersten Zug: der Seed ist der heutige Tag (ctx.today); step legt ihn mit d fest
      const p = obs.pub.seed || !Number.isInteger(ctx.today) ? obs.pub : { ...obs.pub, seed: String(ctx.today) };
      if (spec.title) kids.push({ t: "text", role: "label", text: spec.title(p, lang, L) });
      if (ctx.preview) {
        kids.push({ t: "text", role: "body", text: manifest.howto[lang], part: "regeln" });
        // Ankerelement fuer die Blase "Fragenpaket" im Editor: ohne sichtbaren Teil gaebe es nichts anzutippen
        if ((manifest.parts || []).some((x) => x.id === "paket")) kids.push({ t: "text", role: "label", text: p.pk && p.pk.t ? p.pk.t : L.pk_btn, part: "paket" });
        return { t: "stack", children: kids };
      }
      if (!g) { kids.push({ t: "text", role: "body", text: L.pk_need }); return { t: "stack", children: kids }; }
      if (!prompt) {
        const r = g.result(p, lang, L);
        if (r.h) kids.push({ t: "text", role: "big", text: r.h });
        for (const line of r.lines) kids.push({ t: "text", role: "body", text: line });
        if (r.note) kids.push({ t: "text", role: "small", text: r.note });
        return { t: "stack", result: true, children: kids };
      }
      if (t % 2 !== seat) return { t: "stack", children: kids };
      if (!p.seed) { kids.push({ t: "text", role: "body", text: L.day_need || L.pk_need }); return { t: "stack", children: kids }; }
      const now = p.now, step = { i: now.length + 1, n: g.turns[t].length };
      // Widget nach ADR 0001 c: der Host schickt { ...submit, a: <Wert> }; Gültigkeit prüfen accepts und step
      const w = { id: "q" + t + "-" + now.length, submit: { t: "ans", seat } };
      const top = prompt.top ? prompt.top(p, now, lang, L) : undefined, peek = prompt.peek ? prompt.peek(p, now, lang, L) || undefined : undefined;
      const label = prompt.title ? prompt.title(p, now, lang, L) : L[prompt.l];
      if (prompt.w === "show") {
        kids.push({ t: "show", ...w, label: L[prompt.l], top, lines: prompt.list(p, now, lang, L),
          notes: (prompt.notes ? prompt.notes(p, now, lang, L) : []).filter(Boolean), later: prompt.later ? L[prompt.later] : undefined, confirm: L.next });
      } else if (prompt.w === "pick") {
        kids.push({ t: "pick", ...w, label: L[prompt.l], top, n: 1, auto: true, options: prompt.from(p, now, lang, L).map((s) => ({ label: s })) });
      } else if (prompt.w === "slide") {
        const max = prompt.maxOf ? prompt.maxOf(p) : prompt.max;
        kids.push({ t: "slide", ...w, label, peek, hint: L[prompt.l], min: prompt.min || 0, max, step: prompt.step || 1, value: slideHint(prompt, p),
          format: prompt.money ? "cents" : "int", unit: prompt.unit ? prompt.unit(p) : undefined, confirm: L.next });
      } else if (prompt.w === "list") {
        kids.push({ t: "list", ...w, label: L[prompt.l], n: prompt.n, max: prompt.max, same: !!prompt.same, bytes: prompt.bytes, confirm: L.next });
      }
      return { t: "stack", step, children: kids };
    }
  };
}
export { fmt };
