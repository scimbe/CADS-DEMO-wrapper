// Spielbeschreibung "mdi-bau/1" (Strang B, 08-forschung/spiel-baukasten.md): EINE Feldtabelle, aus der drei Dinge entstehen:
//   schemaFull()  JSON Schema 2020-12 mit Grenzen (Kartenparameter, Ajv-Standalone im Client, Doku)
//   schemaLlm()   dieselbe Form fuer Structured Outputs: flach, alle Felder Pflicht, keine Zahlen-/Laengengrenzen, keine
//                 Rekursion, keine Unions (Anthropic: <= 24 optionale, <= 16 Union-Felder je Anfrage, S24). Haiku fuellt
//                 jedes Feld; die Grenzen setzt normalize() durch.
//   normalize()   Rohdaten -> vollstaendige Beschreibung mit Standardwerten. strict: Verstoss = Fehler (Link, Test);
//                 clamp: Zahlen in den Bereich ziehen und melden (Modellausgabe). Unbekannte Felder sind immer ein Fehler.
// Struktur nach VGDL (Dinge, Interaktionen bei Beruehrung, Endbedingungen; Schaul 2013) plus Steuerung, Zugbausteine
// (Ludii-artige "Ludeme": setzen, aufdecken, antworten) und eine Bot-Heuristik. Keine eigene Textsyntax (Hu et al. 2024).

export const VERSION = 1;
export const TICK = 60;                                   // Hz, fest fuer alle Baukasten-Spiele
export const COLORS = ["yellow", "red", "ink", "paper", "muted", "blue", "green", "pink", "orange", "sky", "lime", "violet", "white"];
export const HEX = { blue: "#2b4bff", green: "#14c872", pink: "#ff4fa3", orange: "#ff6a1f", sky: "#7ee0ff", lime: "#c8ff00", violet: "#7a1fff", white: "#ffffff" };
export const EDGES = ["wall", "wrap", "open"];
export const LOOKS = ["circle", "box", "emoji", "text"];
export const CONTROLS = ["none", "flap", "jump", "lr", "ud", "move", "drag", "steer", "tap"];
export const AIS = ["none", "patrol", "chase", "flee", "zigzag"];
export const BOUNCE = ["none", "walls", "all"];
export const WHEN = ["touch", "out", "tap", "miss", "every", "clear", "pass"];
export const SIDES = ["", "top", "bottom", "left", "right", "any"];
export const ACTS = ["score", "life", "destroy", "spawn", "bounce", "grow", "speed", "reset", "win", "lose"];
export const ON = ["a", "b", "actor", "other", "seat0", "seat1", "all"];
export const WIN = ["score", "survive", "clear"];
export const TURN_KINDS = ["none", "place", "flip", "answer"];
export const ASK = ["pick", "type"];
export const FORMS = ["plain", "scramble", "gap"];
export const BOTS = ["none", "track", "flap", "jump", "seek", "tap", "dodge", "rollout"];
export const ID = "^[a-z][a-z0-9]{0,11}$";

// ---- Feldtabelle ----------------------------------------------------------------------------------------------------
// Typen: int(lo, hi, def) · bool(def) · str(max, def) · en(list, def) · id(def, {empty}) · obj(fields) · arr(item, max, min)
const int = (lo, hi, def) => ({ t: "int", lo, hi, def });
const bool = (def) => ({ t: "bool", def });
const str = (max, def = "", min = 0) => ({ t: "str", max, def, min });
const en = (list, def) => ({ t: "en", list, def });
const id = (def = "", empty = true) => ({ t: "id", def, empty });
const obj = (fields, desc) => ({ t: "obj", fields, desc });
const arr = (item, max, min = 0) => ({ t: "arr", item, max, min });

const THING = obj({
  id: id("", false),
  look: en(LOOKS, "box"),
  emoji: str(16),
  text: str(12),
  color: en(COLORS, "yellow"),
  w: int(4, 2000, 80), h: int(4, 2000, 80),
  gravity: bool(false),
  solid: bool(false),
  bounce: en(BOUNCE, "none"),
  vx: int(-3000, 3000, 0), vy: int(-3000, 3000, 0),
  spread: int(0, 3000, 0),
  control: en(CONTROLS, "none"),
  power: int(0, 5000, 0),
  ai: en(AIS, "none"),
  life: int(0, 60000, 0),
  trail: int(0, 60, 0)
}, "Eine Art Ding: Spielfigur, Ball, Hindernis, Gegner, Sammelobjekt");

const PLACE = obj({
  thing: id("", false),
  x: int(-2000, 4000, 0), y: int(-2000, 4000, 0),
  seat: int(-1, 1, -1),
  n: int(1, 120, 1), cols: int(1, 40, 1), dx: int(-2000, 2000, 0), dy: int(-2000, 2000, 0)
}, "Startaufstellung; n > 1 legt ein Raster (cols Spalten, Abstand dx/dy) an. seat 0/1 = gehoert dem Sitz, -1 = niemandem");

const SPAWN = obj({
  thing: id("", false),
  every: int(100, 60000, 1500),
  after: int(0, 60000, 0),
  x: int(-2000, 4000, 0), y: int(-2000, 4000, 0),
  xr: int(0, 4000, 0), yr: int(0, 4000, 0),
  gap: int(0, 2000, 0),
  max: int(1, 60, 8)
}, "Erzeugt regelmaessig ein Ding (Zufall aus dem Seed: x +- xr, y +- yr; gap > 0 = Paar ueber/unter einer Luecke)");

const EFFECT = obj({ act: en(ACTS, "score"), on: en(ON, "a"), n: int(-999, 999, 1), thing: id("") });
const RULE = obj({
  when: en(WHEN, "touch"),
  a: id(""), b: str(12),
  n: int(0, 60000, 0),
  do: arr(EFFECT, 4, 1)
}, "Wenn a b beruehrt (touch), a den Rand b verlaesst (out), a angetippt wird (tap), ein Tippen nichts trifft (miss), alle n ms (every), kein a mehr da ist (clear), a an b vorbei ist (pass)");

const ITEM = obj({ q: str(90, "", 1), a: str(40, "", 1), wrong: arr(str(40), 3) });

export const SPEC = obj({
  v: int(1, 1, 1),
  title: str(30, "", 1),
  goal: str(90),
  mode: en(["realtime", "turn"], "realtime"),
  players: int(1, 2, 1),
  bg: en(COLORS, "ink"),
  world: obj({
    w: int(200, 2000, 1000), h: int(200, 2000, 1600),
    cols: int(0, 40, 0), rows: int(0, 40, 0),
    gravity: int(-6000, 6000, 0),
    top: en(EDGES, "wall"), bottom: en(EDGES, "wall"), left: en(EDGES, "wall"), right: en(EDGES, "wall"),
    flip: bool(false)
  }),
  things: arr(THING, 12),
  start: arr(PLACE, 24),
  spawn: arr(SPAWN, 4),
  rules: arr(RULE, 16),
  end: obj({ time: int(0, 600, 0), score: int(0, 999, 0), lives: int(0, 9, 0), win: en(WIN, "score") }),
  turn: obj({
    kind: en(TURN_KINDS, "none"),
    cols: int(0, 10, 0), rows: int(0, 10, 0),
    pieces: arr(id(""), 2),
    line: int(0, 8, 0), drop: bool(false),
    pairs: arr(str(16), 18),
    items: arr(ITEM, 12),
    ask: en(ASK, "pick"), form: en(FORMS, "plain"),
    again: bool(false), rounds: int(0, 12, 0)
  }),
  bot: obj({ kind: en(BOTS, "none"), thing: id(""), target: id("") })
});

// Felder, die nur eine Art braucht: das LLM-Schema der jeweils anderen Art laesst sie weg (weniger Token, weniger Verwechslung)
const RT_ONLY = ["world", "spawn", "rules", "bot"];
const TURN_ONLY = ["turn"];

// ---- Schemata -------------------------------------------------------------------------------------------------------
function jsonOf(f, full) {
  switch (f.t) {
    case "int": return full ? { type: "integer", minimum: f.lo, maximum: f.hi, default: f.def } : { type: "integer" };
    case "bool": return full ? { type: "boolean", default: f.def } : { type: "boolean" };
    case "str": return full ? { type: "string", maxLength: f.max, ...(f.min ? { minLength: f.min } : {}), default: f.def } : { type: "string" };
    case "en": return full ? { enum: f.list.slice(), default: f.def } : { type: "string", enum: f.list.slice() };
    case "id": return full ? { type: "string", pattern: f.empty ? "^$|" + ID : ID, default: f.def } : { type: "string" };
    case "arr": return full ? { type: "array", items: jsonOf(f.item, full), maxItems: f.max, ...(f.min ? { minItems: f.min } : {}) } : { type: "array", items: jsonOf(f.item, full) };
    case "obj": {
      const props = {};
      for (const [k, v] of Object.entries(f.fields)) props[k] = jsonOf(v, full);
      // voll: Pflicht nur, was keinen Standard hat; LLM: alles Pflicht (keine optionalen Felder)
      const req = full ? Object.keys(f.fields).filter((k) => needed(f.fields[k])) : Object.keys(f.fields);
      return { type: "object", additionalProperties: false, ...(req.length ? { required: req } : {}), properties: props, ...(full && f.desc ? { description: f.desc } : {}) };
    }
  }
  throw new Error("spec: Typ " + f.t);
}
function needed(f) { return (f.t === "id" && !f.empty) || (f.t === "str" && f.min > 0) || (f.t === "arr" && f.min > 0); }

/** Kanonisches JSON Schema (Kartenparameter `desc`). */
export function schemaFull() { return { $schema: "https://json-schema.org/draft/2020-12/schema", ...jsonOf(SPEC, true), required: ["v", "title", "mode"] }; }
/** Schema fuer Structured Outputs: mode "realtime" | "turn", plus "ok" (Absage des Modells). */
export function schemaLlm(mode) {
  const s = jsonOf(SPEC, false), drop = mode === "turn" ? RT_ONLY : TURN_ONLY;
  for (const k of drop) { delete s.properties[k]; s.required = s.required.filter((r) => r !== k); }
  s.properties.mode = { type: "string", enum: [mode] };
  return { type: "object", additionalProperties: false, required: ["ok", ...s.required], properties: { ok: { type: "boolean" }, ...s.properties } };
}

// ---- Normalisieren --------------------------------------------------------------------------------------------------
// Text: Steuer-/Formatzeichen und spitze Klammern raus, Leerraum zusammenziehen, nach Zeichen (Graphemen grob: Codepunkte)
export function txt(v, max) {
  if (typeof v !== "string") return "";
  const s = v.normalize("NFC").replace(/[\p{Cc}\p{Cf}<>]/gu, " ").replace(/\s+/g, " ").trim();
  return [...s].slice(0, max).join("").trim();
}
const EMOJI = /^[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}‍️\u{1F3FB}-\u{1F3FF}]{1,16}$/u;
export function emojiOk(e) { return typeof e === "string" && EMOJI.test(e); }

function norm(f, v, path, o, errs) {
  const err = (m) => errs.push(path + ": " + m);
  if (v === undefined) {
    if (needed(f)) { err("fehlt"); }
    return def(f);
  }
  switch (f.t) {
    case "int": {
      if (typeof v !== "number" || !Number.isInteger(v)) { err("keine Ganzzahl"); return f.def; }
      if (v < f.lo || v > f.hi) { if (o.clamp) { o.notes.push(path + " -> " + (v < f.lo ? f.lo : f.hi)); return v < f.lo ? f.lo : f.hi; } err("ausserhalb " + f.lo + ".." + f.hi); return f.def; }
      return v;
    }
    case "bool": if (typeof v !== "boolean") { err("kein Wahrheitswert"); return f.def; } return v;
    case "str": {
      if (typeof v !== "string") { err("kein Text"); return f.def; }
      const s = txt(v, f.max);
      if ([...v.trim()].length > f.max && !o.clamp) err("laenger als " + f.max);
      if (s.length < f.min) err("leer");
      return s;
    }
    case "en": if (!f.list.includes(v)) { err("unbekannt: " + String(v).slice(0, 20)); return f.def; } return v;
    case "id": {
      if (typeof v !== "string" || !(new RegExp(f.empty ? "^$|" + ID : ID)).test(v)) { err("keine id"); return f.def; }
      return v;
    }
    case "arr": {
      if (!Array.isArray(v)) { err("keine Liste"); return []; }
      let a = v;
      if (a.length > f.max) { if (o.clamp) { o.notes.push(path + " gekuerzt auf " + f.max); a = a.slice(0, f.max); } else { err("mehr als " + f.max); a = a.slice(0, f.max); } }
      if (a.length < f.min) err("weniger als " + f.min);
      return a.map((x, i) => norm(f.item, x, path + "[" + i + "]", o, errs));
    }
    case "obj": {
      if (!v || typeof v !== "object" || Array.isArray(v)) { err("kein Objekt"); return def(f); }
      for (const k of Object.keys(v)) if (!Object.hasOwn(f.fields, k)) err("unbekanntes Feld " + k.slice(0, 20));
      const out = {};
      for (const [k, sub] of Object.entries(f.fields)) out[k] = norm(sub, v[k], path ? path + "." + k : k, o, errs);
      return out;
    }
  }
  throw new Error("spec: Typ " + f.t);
}
function def(f) {
  if (f.t === "obj") { const o = {}; for (const [k, v] of Object.entries(f.fields)) o[k] = def(v); return o; }
  if (f.t === "arr") return [];
  return f.def;
}

/**
 * Rohdaten -> { desc, errors[], notes[] }. opt.clamp: Zahlen und Listen begrenzen statt ablehnen (Modellausgabe, Hinweis in
 * notes). opt.llm: das Feld "ok" der Modellantwort wird ignoriert. Strukturfehler sind immer Fehler.
 */
export function normalize(raw, opt = {}) {
  const errors = [], o = { clamp: !!opt.clamp, notes: [] };
  let src = raw;
  if (opt.llm && raw && typeof raw === "object") { const { ok, ...rest } = raw; src = rest; }
  const desc = norm(SPEC, src, "", o, errors);
  return { desc, errors, notes: o.notes };
}
export const defaults = () => def(SPEC);

/** Kurzform: Felder mit Standardwert weglassen (Links, Docs, Prompt-Beispiele). normalize(compact(d)).desc ist wieder d. */
export function compact(desc) {
  const walk = (f, v) => {
    if (f.t === "obj") {
      const o = {};
      for (const [k, sub] of Object.entries(f.fields)) {
        const x = walk(sub, v[k]);
        if (x !== undefined) o[k] = x;
      }
      return Object.keys(o).length || needed(f) ? o : undefined;
    }
    if (f.t === "arr") return v.length ? v.map((x) => { const y = walk(f.item, x); return y === undefined ? def(f.item) : y; }) : undefined;
    return v === f.def && !needed(f) ? undefined : v;
  };
  const out = walk(SPEC, desc) || {};
  for (const k of ["v", "title", "mode"]) out[k] = desc[k];
  return out;
}
