// Parameter des Flugspiels (Engine E2): Physik-Regler, Welt, Look, Route, Animation, KI-Marke.
// Exakt portiert aus alt:src/core.js (sanitize*, Route, Presets, Tagesrunde, Wortregeln, stateFromApi) und
// alt:src/daily.js (sanitizeDoc fuer k "game"). Dazu die Bruecke zum Server der freien Karte (Genre G1,
// CADS-DEMO-wrapper lib/duell-karte.mjs compose("game")): fromServerDoc / toServerDoc und das JSON-Schema.
import { hash32, mulberry32 } from "./rng.js";
import { sinD } from "./trig.js";
import { foldText, isClean, sanitizeTitle, sanitizeEmoji, sanitizeName, sanitizePrompt, stripText, emo } from "./text.js";

export const RANGES = { gravity: [900, 2600, 1800], jump: [280, 620, 430], gap: [90, 200, 140], speed: [90, 260, 130] };
const ALIAS = { jump: "flapPower", gap: "pipeGap", speed: "pipeSpeed" };
export const THEME_NAMES = ["day", "night", "sunset", "retro", "candy", "neon", "ocean", "lava"];
export const THEME_EMOJI = { day: "🪁", night: "🦇", sunset: "🦜", retro: "👾", candy: "🦄", neon: "👽", ocean: "🐟", lava: "🐉" };
export const MAX_SCORE = 9999;

export function clampNum(v, min, max, def) {
  if (typeof v === "string" && v.trim() !== "") v = Number(v);
  if (typeof v !== "number" || !isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}
export function sanitizeParams(p) {
  const out = {};
  p = p && typeof p === "object" ? p : {};
  for (const k of Object.keys(RANGES)) {
    const r = RANGES[k]; let v = p[k];
    if (v === undefined && ALIAS[k]) v = p[ALIAS[k]];
    out[k] = Math.round(clampNum(v, r[0], r[1], r[2]));
  }
  return out;
}
export function sanitizeTheme(t) { return typeof t === "string" && THEME_NAMES.indexOf(t) >= 0 ? t : "day"; }
export function sanitizeSeed(s) { return Math.floor(clampNum(s, 0, 4294967295, 1)) >>> 0; }

// Look eines Spiels aus einer Karte: zwei Farben und eine Zeile (alt sanitizeSkin)
export function sanitizeSkin(o) {
  if (!o || typeof o !== "object" || !Array.isArray(o.c) || o.c.length !== 2 || !o.c.every((x) => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x))) return null;
  const skin = { c: [o.c[0], o.c[1]] }, l = Array.from(stripText(o.l)).slice(0, 60).join("").trim();
  if (l && isClean(l)) skin.l = l;
  return skin;
}

// Eigener Look: Rahmen um das Spiel, nie seine Mechanik. a,b Himmel; d Motiv; e treibende Emoji; p,q Hindernis-Fuellung
// und -Kante; f Form; o Emoji des Hindernisses; g,h Boden und Kante; m Spur-Emoji. Hitbox und Physik bleiben gleich.
export const DECOS = ["stars", "bubbles", "clouds", "snow", "rain", "none"], FORMS = ["tube", "block", "round", "emoji"];
function hex(v) { return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : ""; }
export function light(c) { const n = parseInt(c.slice(1), 16); return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; }
export function sanitizeLook(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const l = {};
  for (const k of ["a", "b", "p", "q", "g", "h"]) { const c = hex(o[k]); if (c) l[k] = c; }
  if (DECOS.indexOf(o.d) >= 0) l.d = o.d;
  if (FORMS.indexOf(o.f) >= 0) l.f = o.f;
  const e = (Array.isArray(o.e) ? o.e : []).map(emo).filter(Boolean).slice(0, 3); if (e.length) l.e = e;
  const ob = emo(o.o), m = emo(o.m); if (ob) l.o = ob; if (m) l.m = m;
  if (l.f === "emoji" && !l.o) delete l.f;
  if (l.a && l.p) {                                  // ein Hindernis, das im Himmel verschwindet, ist nicht spielbar
    const sky = (light(l.a) + light(l.b || l.a)) / 2;
    if (Math.abs(sky - light(l.p)) < 0.18) l.p = sky > 0.5 ? "#1f1f2e" : "#f2f2f2";
  }
  return Object.keys(l).length ? l : null;
}

// Route: genau 3 Abschnitte; jeder verschiebt die Physik um einen festen Schritt d (Tabelle des Servers), zeigt seine Welt t
// und sein Emoji e; p nennt den Schritt. base + d wird auf RANGES geklemmt.
export const STEPS = ["normal", "ruhig", "schnell", "eng", "schwebend", "schwer", "sturm"], SECTIONS = 3;
export const DELTA_MAX = { gravity: 800, jump: 120, gap: 60, speed: 80 };
export function sanitizeRoute(r) {
  if (!Array.isArray(r) || r.length !== SECTIONS) return null;
  const out = r.map((a) => {
    if (!a || typeof a !== "object") return null;
    const d = {}, src = a.d || a.delta || {};
    for (const k of Object.keys(DELTA_MAX)) {
      let v = src[k] !== undefined ? src[k] : src[ALIAS[k]];
      v = Math.round(clampNum(v, -DELTA_MAX[k], DELTA_MAX[k], 0)); if (v) d[k] = v;
    }
    const t = a.t || a.thema, e = emo(a.e || a.emoji);
    if (typeof t !== "string" || THEME_NAMES.indexOf(t) < 0 || !e) return null;
    return { p: STEPS.indexOf(a.p || a.physik) >= 0 ? a.p || a.physik : "normal", d, t, e };
  });
  return out.every(Boolean) ? out : null;
}
export function sectionParams(params, route, i) {
  const d = route && route[i] ? route[i].d : {}, p = {};
  for (const k of Object.keys(RANGES)) p[k] = params[k] + (d[k] || 0);
  return sanitizeParams(p);
}
export function routeParams(st) { return st && st.route ? st.route.map((x, i) => sectionParams(st.params, st.route, i)) : null; }
// KI-Marke einer Welt: welt (KI baute die Welt) oder karte (freie Karte), AI Act Art. 50
export function sanitizeKiMark(o) {
  if (!o || typeof o !== "object" || (o.k !== "welt" && o.k !== "karte")) return null;
  const r = { k: o.k };
  if (typeof o.s === "string" && /^[A-Za-z0-9._~-]{8,200}$/.test(o.s)) r.s = o.s; else return null;
  if (typeof o.h === "string" && /^[A-Za-z0-9_-]{43}$/.test(o.h)) r.h = o.h;
  return r;
}

// ---------- Animation der Figur (g.anim bzw. l.anim) ----------
export const ANIM = ["huepfen", "wippen", "drehen", "wackeln", "fluegel", "blinken", "pulsieren", "keine"], ANIM_BEI = ["immer", "sprung", "treffer", "sieg"];
export function sanitizeAnim(o) {
  if (!o || typeof o !== "object" || ANIM.indexOf(o.art) < 0 || o.art === "keine") return null;
  const a = { art: o.art }, tp = o.tempo, s = o.staerke;
  if (typeof tp === "number" && tp >= 0.5 && tp <= 2) a.tempo = Math.round(tp * 10) / 10;
  if (typeof s === "number" && s >= 0 && s <= 1) a.staerke = Math.round(s * 10) / 10;
  if (ANIM_BEI.indexOf(o.bei) > 0) a.bei = o.bei;
  return a;
}
/** Pose zur Zeit t (Sekunden; since = seit dem Ausloeser). Nur fuer die Anzeige (Math.sin ist dort erlaubt, nie im Zustand). */
export function animPose(a, t, since, seed, z) {
  const P = { x: 0, y: 0, r: 0, sx: 1, sy: 1, a: 1 }, f = a && (a.tempo || 1), s = a && (a.staerke == null ? 0.6 : a.staerke), d = a && a.bei === "sieg" ? 2.5 : 0.7;
  const on = !a ? 0 : !a.bei ? 1 : since >= 0 && since < d ? 1 - since / d : 0, w = 6.283 * f * t + ((seed >>> 0) % 628) / 100, k = s * on;
  if (!k) return P;
  if (a.art === "huepfen") P.y = -Math.abs(sinD(w / 2)) * 0.45 * z * k;
  else if (a.art === "wippen") P.y = sinD(w) * 0.18 * z * k;
  else if (a.art === "drehen") P.r = (w * (0.4 + s)) % 6.283;
  else if (a.art === "wackeln") P.r = sinD(w * 2) * 0.45 * k;
  else if (a.art === "fluegel") { const q = Math.abs(sinD(w * 2)); P.sy = 1 - 0.4 * k * q; P.sx = 1 + 0.15 * k * q; }
  else if (a.art === "blinken") P.a = sinD(w * 1.5) > 0.3 ? 1 - 0.8 * k : 1;
  else if (a.art === "pulsieren") P.sx = P.sy = 1 + 0.22 * k * sinD(w);
  return P;
}
const ANIM_WORDS = [["huepfen", /hupf|huepf|hops|bounce|hop\b/], ["wippen", /wipp|schaukel|bob\b|sway/], ["drehen", /dreh|rotier|spin|kreisel/], ["wackeln", /wackel|zitter|wobbl|shake|wiggle/],
  ["fluegel", /flugel|fluegel|flatter|flap/], ["blinken", /blink|funkel|glitzer|flash|twinkl/], ["pulsieren", /puls|pump|pochen|grow and shrink/], ["keine", /(keine|ohne|stop\w*) (animation|bewegung)|nicht mehr (bewegen|animier)/]];
export function animWords(text) {
  const f = foldText(text); let a = null;
  for (let i = 0; i < ANIM_WORDS.length && !a; i++) if (ANIM_WORDS[i][1].test(f)) a = { art: ANIM_WORDS[i][0] };
  if (!a) return null;
  if (/beim? (sprung|springen|flattern)|when (it )?(jumps|flaps)/.test(f)) a.bei = "sprung";
  else if (/(bei|nach) (jedem )?(punkt|treffer|munze)|when (it )?scores/.test(f)) a.bei = "treffer";
  else if (/(beim? )?(sieg|gewinnen|rekord)|when (it )?wins/.test(f)) a.bei = "sieg";
  if (/schnell|fast|wild/.test(f)) a.tempo = 1.6; else if (/langsam|slow|gemutlich|sanft|gentle/.test(f)) a.tempo = 0.7;
  return a;
}

/** Zustand eines Flugspiels (alt sanitizeState, Version 1). spurOk: Pruefer fuer Spur-Bytes (spur.js sanitize). */
export function sanitizeState(o, spurOk) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  if (o.v !== 1) return null;
  const st = { v: 1, seed: sanitizeSeed(o.seed), params: sanitizeParams(o.params), theme: sanitizeTheme(o.theme), title: sanitizeTitle(o.title), emoji: sanitizeEmoji(o.emoji) };
  const skin = sanitizeSkin(o.skin); if (skin) st.skin = skin;
  const lk = sanitizeLook(o.look); if (lk) st.look = lk;
  const rt = sanitizeRoute(o.route); if (rt) st.route = rt;
  const an = sanitizeAnim(o.anim); if (an) st.anim = an;
  const ki = sanitizeKiMark(o.ki); if (ki) st.ki = ki;
  if (o.score !== undefined && o.score !== null) { const sc = clampNum(o.score, 0, MAX_SCORE, NaN); if (!isNaN(sc)) st.score = Math.floor(sc); }
  if (o.name !== undefined && o.name !== null) { const nm = sanitizeName(o.name); if (nm) st.name = nm; }
  if (o.ev === (o.ev | 0) && o.ev > 0) st.ev = o.ev;
  if (o.k === .5 || o.k === .75) st.k = o.k;
  const sp = spurOk ? spurOk(o.spur) : null;
  if (sp) st.spur = sp;
  return st;
}
export function configKey(st) {
  const p = st.params;
  return [st.seed, p.gravity, p.jump, p.gap, p.speed, st.theme].join(".") + (st.route ? "." + hash32(JSON.stringify(st.route)) : "");
}

// ---------- Tagesrunde, Presets ----------
export function dailyKey(date) { return date.toISOString().slice(0, 10); }
export function dailySeed(date) { return hash32("duell-daily-" + dailyKey(date)); }
/** Tagesrunde aus dem UTC-Datum (date ist Pflicht: keine Uhr in der Logik). */
export function dailyConfig(date, lang) {
  const key = dailyKey(date), seed = dailySeed(date), r = mulberry32(seed);
  const params = sanitizeParams({ gravity: 1700 + Math.floor(r() * 300), jump: 420 + Math.floor(r() * 30), gap: 128 + Math.floor(r() * 24), speed: 125 + Math.floor(r() * 30) });
  const theme = THEME_NAMES[Math.floor(r() * THEME_NAMES.length)];
  return { v: 1, seed, params, theme, title: lang === "en" ? "Daily round " + key.slice(5) : "Tagesrunde " + key.slice(5), emoji: THEME_EMOJI[theme] };
}
export const PRESETS = [
  { id: "chill", emoji: "🪁", de: "Chill", en: "Chill", theme: "day", seed: 101, params: { gravity: 1400, jump: 400, gap: 175, speed: 105 } },
  { id: "rocket", emoji: "🚀", de: "Rakete", en: "Rocket", theme: "night", seed: 202, params: { gravity: 1500, jump: 430, gap: 135, speed: 175 } },
  { id: "night", emoji: "🦇", de: "Nachtschicht", en: "Night shift", theme: "night", seed: 303, params: { gravity: 1800, jump: 430, gap: 140, speed: 130 } },
  { id: "candy", emoji: "🦄", de: "Zuckerwatte", en: "Candy", theme: "candy", seed: 404, params: { gravity: 1300, jump: 390, gap: 165, speed: 115 } },
  { id: "retro", emoji: "👾", de: "Retro", en: "Retro", theme: "retro", seed: 505, params: { gravity: 1900, jump: 440, gap: 128, speed: 145 } },
  { id: "lava", emoji: "🐉", de: "Lava", en: "Lava", theme: "lava", seed: 606, params: { gravity: 2300, jump: 500, gap: 105, speed: 190 } },
  { id: "ocean", emoji: "🐟", de: "Tiefsee", en: "Deep sea", theme: "ocean", seed: 707, params: { gravity: 1100, jump: 360, gap: 150, speed: 120 } },
  { id: "neon", emoji: "👽", de: "Neon-Chaos", en: "Neon chaos", theme: "neon", seed: 808, params: { gravity: 2100, jump: 470, gap: 112, speed: 210 } }
];
export function presetState(p, lang) { return { v: 1, seed: p.seed, params: sanitizeParams(p.params), theme: p.theme, title: lang === "en" ? p.en : p.de, emoji: p.emoji }; }

// ---------- Satz ohne KI: feste Wortregeln ----------
const WORD_RULES = [
  [/schnell|rasant|\bfast|speed|turbo|rush|zoom|hektisch|flitz/, { speed: 1.35 }],
  [/langsam|\bslow|chill|entspann|gemutlich|relax|ruhig|cozy/, { speed: 0.8, gap: 1.15 }],
  [/schwer|hart\b|\bhard|insane|krass|irre|wahnsinn|unmoglich|impossible|extrem|brutal|hardcore/, { gap: 0.8, speed: 1.2 }],
  [/leicht|\beasy|einfach|anfanger|beginner|simpel|noob/, { gap: 1.2, speed: 0.85 }],
  [/\beng|tight|knapp|narrow/, { gap: 0.82 }],
  [/\bweit|wide|breit|grosszugig/, { gap: 1.2 }],
  [/heavy|blei|fett|dick/, { gravity: 1.2, jump: 1.08 }],
  [/mond|moon|float|schweb|feder|feather|weltall|\bspace/, { gravity: 0.7, jump: 0.85 }]
];
const THEME_RULES = [
  ["night", /nacht|night|dark|dunkel|mitternacht|mond|moon|vampir|fledermaus|\bbat\b|weltraum|weltall|\bspace\b|alien|\bsterne?n?\b|\bstars?\b|galax|planet|rakete|rocket|\bufo/],
  ["sunset", /sonnenuntergang|sunset|abend|dusk|golden|sommer|summer/],
  ["retro", /retro|8.?bit|pixel|arcade|oldschool/],
  ["candy", /candy|zuckerl|suss|sweet|bonbon|pink|einhorn|unicorn|zuckerwatte/],
  ["neon", /neon|cyber|disco|party|rave|club|glitch/],
  ["ocean", /ozean|ocean|meer|\bsea|wasser|water|tauch|fisch|\bfish|\bhai\b|shark|delfin|dolphin/],
  ["lava", /lava|feuer|\bfire|\bhell|vulkan|volcano|drache|dragon|heiss|\bhot|brenn/]
];
const EMOJI_RULES = [
  [/rakete|rocket/, "🚀"], [/katze|\bcat/, "🐱"], [/\bhund|\bdog/, "🐶"], [/pizza/, "🍕"],
  [/geist|ghost/, "👻"], [/drache|dragon/, "🐉"], [/fisch|\bfish/, "🐟"], [/\bhai\b|shark/, "🦈"],
  [/biene|\bbee/, "🐝"], [/alien|\bufo/, "👽"], [/frosch|\bfrog/, "🐸"], [/einhorn|unicorn/, "🦄"],
  [/fledermaus|\bbat\b/, "🦇"], [/schwein|\bpig/, "🐷"], [/pinguin|penguin/, "🐧"], [/burger/, "🍔"],
  [/fussball|soccer|\bball\b/, "⚽"], [/totenkopf|skull/, "💀"], [/vogel|\bbird/, "🐦"]
];
export function localConfig(prompt, lang) {
  const p = sanitizePrompt(prompt);
  if (!p) return { rejected: "empty" };
  if (!isClean(p)) return { rejected: "filter" };
  const f = foldText(p);
  const params = { gravity: RANGES.gravity[2], jump: RANGES.jump[2], gap: RANGES.gap[2], speed: RANGES.speed[2] };
  for (const r of WORD_RULES) if (r[0].test(f)) for (const k of Object.keys(r[1])) params[k] *= r[1][k];
  let theme = "day";
  for (const r of THEME_RULES) if (r[1].test(f)) { theme = r[0]; break; }
  let emoji = THEME_EMOJI[theme];
  for (const r of EMOJI_RULES) if (r[0].test(f)) { emoji = r[1]; break; }
  const w = p.split(" ").slice(0, 4).join(" ");
  const title = sanitizeTitle(w.charAt(0).toUpperCase() + w.slice(1), lang === "en" ? "My game" : "Mein Spiel");
  const st = { v: 1, seed: hash32("p:" + f), params: sanitizeParams(params), theme, title, emoji }, an = animWords(p);
  if (an) st.anim = an.art === "keine" ? null : sanitizeAnim(an);
  return st;
}
/** Antwort der KI-Art welt {params,theme,title,emoji,abschnitte,anim} -> Zustand; der Seed kommt aus dem Satz. */
export function stateFromApi(resp, prompt) {
  if (!resp || typeof resp !== "object" || !resp.params || typeof resp.params !== "object") return null;
  const st = sanitizeState({ v: 1, seed: hash32("p:" + foldText(sanitizePrompt(prompt))), params: resp.params, theme: resp.theme, title: resp.title, emoji: resp.emoji, route: resp.abschnitte || resp.route, anim: resp.anim });
  if (st && resp.anim && resp.anim.art === "keine") st.anim = null;
  return st;
}

// ---------- Dokument "game" (alt:src/daily.js sanitizeDoc) und die freie Karte (Server G1) ----------
const HEX = /^#[0-9a-fA-F]{6}$/;
function colors(c) { return Array.isArray(c) && c.length === 2 && HEX.test(c[0]) && HEX.test(c[1]) ? [c[0], c[1]] : ["#ffd400", "#ff3b1d"]; }
function kiDoc(o) {
  if (!o || typeof o !== "object" || typeof o.k !== "string" || !/^[a-z]{2,12}$/.test(o.k)) return null;
  const r = { k: o.k };
  if (typeof o.s === "string" && /^[A-Za-z0-9._~-]{8,200}$/.test(o.s)) r.s = o.s;
  if (r.s && typeof o.h === "string" && /^[A-Za-z0-9_-]{43}$/.test(o.h)) r.h = o.h;
  if (r.s && typeof o.o === "string" && /^[A-Za-z0-9_-]{22}$/.test(o.o)) r.o = o.o;
  return r;
}
function txt(s, max) {
  const t = Array.from(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
  return t && isClean(t) ? t : "";
}
/** Spielwerte g eines Dokuments (alt sanitizeDoc, Zweig "game"). */
export function sanitizeGame(g) {
  g = g && typeof g === "object" ? g : {};
  const s = sanitizeState({ v: 1, seed: g.seed, params: g.params, theme: g.theme, title: g.title, emoji: g.emoji, look: g.look, route: g.route, anim: g.anim });
  const out = { seed: s.seed, params: s.params, theme: s.theme, title: s.title, emoji: s.emoji };
  if (s.look) out.look = s.look;
  if (s.route) out.route = s.route;
  if (s.anim) out.anim = s.anim;
  return out;
}

import { trail } from "../lauf/params.js";
// ---------- Kartenparameter der Karte "flug" (flach, eine Quelle fuer Editor, Link, freie Karte) ----------
export const TEMPOS = [1, 0.75, 0.5];
const VARIANT_ID = /^[a-z0-9]+(-[a-z0-9]+){0,4}$/;
export const AGENT0 = { n: "", e: "🦊", r: 50, c: 50, p: 50 };
/** Spielwerte (sanitizeState v1) aus Kartenparametern. */
export function gameOf(params) {
  const p = params || {};
  const st = sanitizeState({ v: 1, seed: p.seed, params: { gravity: p.gravity, jump: p.jump, gap: p.gap, speed: p.speed }, theme: p.theme, title: p.title, emoji: p.emoji,
    look: p.look, route: p.route, anim: p.anim, skin: p.skin, ki: p.ki && (p.ki.k === "welt" || p.ki.k === "karte") ? p.ki : null, k: p.tempo === 1 ? undefined : p.tempo });
  return st;
}
/** Kartenparameter aus Spielwerten g (Form von doc.g) plus Rest. */
export function paramsOfGame(g, rest) {
  const s = sanitizeGame(g);
  const out = Object.assign({ variant: "eigen", mode: "solo", seed: s.seed, gravity: s.params.gravity, jump: s.params.jump, gap: s.params.gap, speed: s.params.speed, theme: s.theme, title: s.title, emoji: s.emoji,
    look: s.look || null, route: s.route || null, anim: s.anim || null, tempo: 1, col: ["#ffd400", "#ff3b1d"], t: "", ki: null, fr: null }, rest || {});
  return out;
}

/**
 * Kartenparameter der Karte "flug" aus einem Server-Dokument der freien Karte (Genre G1) oder einem alten Link-Dokument
 * {k:"game", col, by, t?, ki?, fr?, g}. Unbekanntes faellt weg, nichts wird erfunden. null: kein Flugspiel.
 */
export function fromServerDoc(doc) {
  if (!doc || typeof doc !== "object" || doc.k !== "game" || !doc.g || typeof doc.g !== "object") return null;
  const rest = { col: colors(doc.col), by: trail(doc.by) };
  const t = txt(doc.t, 40); if (t) rest.t = t;
  const ki = kiDoc(doc.ki); if (ki) rest.ki = ki;
  if (typeof doc.fr === "string" && /^[A-Za-z0-9_-]{22}$/.test(doc.fr)) rest.fr = doc.fr;
  // die Katalogkarte, aus der das Blatt kam (alt doc.i): bleibt als Variante stehen
  if (typeof doc.i === "string" && VARIANT_ID.test(doc.i)) rest.variant = doc.i;
  return paramsOfGame(doc.g, rest);
}
/** Gegenrichtung fuer Robot/Verfeinern: die bearbeitete Karte als base an den Server (dieselbe Form wie compose). */
export function toServerDoc(params, base) {
  const p = params || {}, b = base && typeof base === "object" ? base : {};
  const s = gameOf(p), g = { seed: s.seed, params: s.params, theme: s.theme, title: s.title, emoji: s.emoji };
  if (s.look) g.look = s.look; if (s.route) g.route = s.route; if (s.anim) g.anim = s.anim;
  const doc = { k: "game", col: colors(p.col || b.col), by: trail(Array.isArray(p.by) ? p.by : b.by), g };
  if (typeof p.variant === "string" && p.variant !== "eigen" && VARIANT_ID.test(p.variant)) doc.i = p.variant;
  const t = txt(p.t, 40); if (t) doc.t = t;
  if (typeof p.fr === "string" && /^[A-Za-z0-9_-]{22}$/.test(p.fr)) doc.fr = p.fr;
  const ki = kiDoc(p.ki); if (ki) doc.ki = ki;
  return doc;
}
