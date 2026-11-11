// My Daily Idea, "Robot": any card of the deck becomes a free card (user, 11.11.2026). The base is the deck card (by its
// catalog id, never the client's copy) plus the person's own edits, checked like every free-card doc; then THE SAME refine
// step of the free card (lib/duell-karte.mjs runKarte with data.base) changes it by one sentence.
//
// Kinds the free card has a schema for (card, meme, game, lauf, quiz, the abilities of the catalog) are refined in their own
// schema. Every other kind (arcade duels, the card tables, the tools, the beat, turn cards outside the abilities) gets a
// bounded "free" schema here: the model may only pick values from fixed lists (never code, never a number of its own), the
// server builds the doc and checks it with freeDoc() below. The app has the same rules in src/frei.js; both sides test the
// same vectors (test/fixtures/frei-vectors.json), so a doc the server sealed is the doc the app plays.
//
// What a wish asks that a kind's engine cannot do yet is never silently dropped: the model names it in "missing" (a closed
// list), the answer carries note "skip:<part>" and the app says it with a fixed text. The kind itself is never refused.

import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const D = req('./vendor/duell-web/daily.js');

/** The app's colour pairs (apps/duell-web/src/app.js PAIRS), index = "palette"; the same table as lib/duell-karte.mjs. */
export const PAIRS = [['#ffd400', '#ff3b1d'], ['#2b4bff', '#ffe600'], ['#ff4fa3', '#0a7f55'], ['#14c872', '#ff3da5'], ['#ff6a1f', '#1b2bd8'], ['#c8ff00', '#7a1fff'], ['#ffffff', '#ff2d2d'], ['#7ee0ff', '#ff5a1f']];
// ---- arcade duels (apps/duell-web/src/arcade.js, arcade2.js): what a free arcade card may set --------------------------
// w: points to win (the engines' WIN, 3 or 5 today); the same number on both phones, it rides in the live "go" message.
// e: the figure on the board and the menu, a: b: the two colours of the board (META in src/arcade-ui.js).
export const ARCADE_GAMES = ['puck', 'ziegel', 'volley', 'panzer', 'kick', 'flipper', 'snow', 'elfer', 'stock', 'murmel'];
export const ARCADE_WIN = [1, 9];
export const ARCADE_EMOJI = ['🏒', '🧱', '🏐', '💥', '⚽', '🎯', '❄️', '🥅', '🥌', '🔮', '🚀', '🛸', '🐸', '🦆', '🐙', '🦖', '🐉', '🦄', '🐝', '🍕', '🍩', '🎃', '👻', '⭐', '🌈', '🔥', '⚡', '🌙', '🎄', '⛄', '🎁', '🐱', '🐶', '🐧', '🦉', '🐌'];
// ---- card tables (src/skat.js, doko.js, bauernskat.js RULES): house rules only from the engine's own list ---------------
export const TABLE_RULES = { skat: ['ramsch', 'kontra'], doko: ['dulle', 'nosp'], bauernskat: ['null', 'kontra'] };
// ---- tools (src/tools.js, PR #221): look and a ready text; the tool's function stays as it is ----------------------------
export const TOOL_IDS = { notizzettel: 'notiz', 'datei-rueber': 'datei' };
export const TOOL_LOOKS = ['zettel', 'karo', 'neon', 'kraft'];
// ---- the beat card (daily.js): its voice and speed, never a beat or a lyric of the model (no sound card, 11.11.) ---------
export const FX = ['chip', 'monster', 'robot', 'echo'];
export const BPMS = [70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
/** The parts of a wish a kind cannot apply: a closed list, each said with a fixed text in the app (create_skip_<part>). */
export const MISSING = ['regeln', 'tempo', 'figur', 'ablauf', 'ton', 'bild', 'text', 'spieler', 'anderes'];

const HEX = /^#[0-9a-f]{6}$/;
/** A text as both sides keep it: no control or format characters, no < >, one space, at most max code points. */
export function line(v, max) {
  if (typeof v !== 'string') return '';
  return [...v.normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
}
const cols = (c) => (Array.isArray(c) && c.length === 2 && c.every((x) => typeof x === 'string' && HEX.test(x.toLowerCase())) ? c.map((x) => x.toLowerCase()) : PAIRS[0].slice());
const int = (v, [a, b]) => (Number.isInteger(v) && v >= a && v <= b ? v : undefined);
const KI = /^[A-Za-z0-9._~:-]{1,400}$/;
function ki(o) {
  if (!o || typeof o !== 'object' || o.k !== 'karte') return undefined;
  const out = { k: 'karte' };
  for (const f of ['s', 'h', 'o']) if (typeof o[f] === 'string' && KI.test(o[f])) out[f] = o[f];
  return out.s ? out : undefined;
}
/** The free part of a table doc: house rules of its game only, in the engine's order. -> {} | { r } */
export function tableFa(g, fa) {
  const ok = TABLE_RULES[g] || [], r = fa && Array.isArray(fa.r) ? ok.filter((k) => fa.r.includes(k)) : [];
  return r.length ? { r } : {};
}
/**
 * A doc of any kind as the free card keeps it, or null. The kinds of the app's sanitizeDoc go through it (byte for byte the
 * app's code, vendored); arcade and tool docs, which the app never sends as a creation, get their own strict shape here.
 * The same function as src/frei.js sanitize() in the app (test/fixtures/frei-vectors.json).
 */
export function freeDoc(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (o.k === 'arcade' || o.k === 'tool') {
    const id = typeof o.i === 'string' ? o.i : '';
    const d = { k: o.k, i: id, col: cols(o.col), by: [] };
    if (o.k === 'arcade') {
      if (!ARCADE_GAMES.includes(o.a) || !/^arcade-[a-z]+$/.test(id)) return null;
      d.a = o.a;
    } else if (!Object.prototype.hasOwnProperty.call(TOOL_IDS, id)) return null;
    const t = line(o.t, 34), s = line(o.s, 60);
    if (t) d.t = t; if (s) d.s = s;
    const fa = {}, f = o.fa && typeof o.fa === 'object' ? o.fa : {};
    if (o.k === 'arcade') {
      if (ARCADE_EMOJI.includes(f.e)) fa.e = f.e;
      const w = int(f.w, ARCADE_WIN); if (w !== undefined) fa.w = w;
    } else {
      if (TOOL_LOOKS.includes(f.v)) fa.v = f.v;
      const x = line(f.x, 120); if (x) fa.x = x;
    }
    if (Object.keys(fa).length) d.fa = fa;
    const k = ki(o.ki); if (k) d.ki = k;
    return d;
  }
  const d = D.sanitizeDoc(o);
  if (!d) return null;
  if (d.k === 'table') { const fa = tableFa(d.g, o.fa); if (fa.r) d.fa = fa; }
  return d;
}

/** The free family of a doc: which schema the refine step uses. 'karte' arts first (lib/duell-karte.mjs), then ours. */
export function familyOf(doc) {
  if (!doc) return '';
  if (doc.k === 'arcade') return 'arcade';
  if (doc.k === 'tool') return 'tool';
  if (doc.k === 'table') return 'table';
  if (doc.k === 'sound') return 'sound';
  return 'plain';
}
const str = { type: 'string' };
/** The schema of one free family (structured outputs: enums only, the server checks every value again). */
export function freeSchema(doc) {
  const fam = familyOf(doc), props = { ok: { type: 'boolean' }, title: str, palette: { type: 'integer', enum: PAIRS.map((p, i) => i) }, missing: { type: 'array', items: { type: 'string', enum: MISSING } } };
  if (fam !== 'sound') props.sub = str;
  if (fam === 'arcade') { props.emoji = { type: 'string', enum: ARCADE_EMOJI }; props.win = { type: 'integer', enum: Array.from({ length: ARCADE_WIN[1] - ARCADE_WIN[0] + 1 }, (x, i) => ARCADE_WIN[0] + i) }; }
  if (fam === 'table') props.rules = { type: 'array', items: { type: 'string', enum: TABLE_RULES[doc.g] || [] } };
  if (fam === 'tool') { props.look = { type: 'string', enum: TOOL_LOOKS }; props.text = str; }
  if (fam === 'sound') { props.fx = { type: 'string', enum: FX }; props.bpm = { type: 'integer', enum: BPMS }; }
  return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props };
}
/** What the model is told about a free family (the variable user turn; the cached prefix stays as it is). */
export function freeText(doc) {
  const fam = familyOf(doc);
  const what = { arcade: `an arcade duel of two phones (${doc.a}); the game itself stays, you may set its title, a line below, the colour pair, the figure "emoji" and "win" (points to win, ${ARCADE_WIN.join('-')})`,
    table: `a card table (${doc.g}); the game and its rules stay, you may set the title, a line below, the colour pair and "rules": the house rules to switch on, only from the list (${(TABLE_RULES[doc.g] || []).join(', ')}), [] for tournament rules`,
    tool: 'a tool (a note or a file to send); it keeps working as it is, you may set the title, a line below, the colour pair, the paper "look" and "text": a ready text, at most 120 characters, or ""',
    sound: 'a beat card; the beat stays, you may set the title (at most 26 characters), the colour pair, the voice "fx" and the speed "bpm"',
    plain: 'an existing card that plays as it is; you may set its title, a line below and the colour pair' }[fam];
  return ` Card type: anpassung - ${what}. "title" at most 34 characters, "sub" at most 60. Put in "missing" every part of the wish these fields cannot do (regeln: other rules, tempo: speed or physics, figur: other figures or players' looks, ablauf: another course of the game, ton: sounds or music, bild: pictures or photos, text: texts the fields cannot hold, spieler: more or other players, anderes: anything else); [] when everything fits.`;
}
/** The model's answer for a free family -> the new doc (on top of the base) and its notes, or null. text: the output filter. */
export function freeCompose(base, o, text) {
  if (!o || typeof o !== 'object' || o.ok !== true || !base) return null;
  const fam = familyOf(base), d = JSON.parse(JSON.stringify(base));
  delete d.ki; d.by = [];
  const t = text(o.title, fam === 'sound' ? 26 : 34), s = fam === 'sound' ? '' : text(o.sub, 60);
  if (fam === 'sound') { if (t) d.x = t; } else { if (t) d.t = t; if (s) d.s = s; }
  if (Number.isInteger(o.palette) && PAIRS[o.palette]) d.col = PAIRS[o.palette].slice();
  if (fam === 'arcade') d.fa = { ...(d.fa || {}), ...(ARCADE_EMOJI.includes(o.emoji) ? { e: o.emoji } : {}), ...(int(o.win, ARCADE_WIN) !== undefined ? { w: o.win } : {}) };
  if (fam === 'table') d.fa = { r: Array.isArray(o.rules) ? o.rules : [] };
  if (fam === 'tool') { const x = text(o.text, 120); d.fa = { ...(d.fa || {}), ...(TOOL_LOOKS.includes(o.look) ? { v: o.look } : {}), ...(x ? { x } : {}) }; }
  if (fam === 'sound') { if (FX.includes(o.fx)) d.fx = o.fx; if (BPMS.includes(o.bpm)) d.bpm = o.bpm; }
  const doc = freeDoc(d);
  if (!doc || doc.k !== base.k || doc.i !== base.i) return null;
  const notes = [...new Set((Array.isArray(o.missing) ? o.missing : []).filter((m) => MISSING.includes(m)))].map((m) => 'skip:' + m);
  return { doc, notes };
}

// ---- the deck card as the base --------------------------------------------------------------------------------------
// The tools are in the app's catalog with PR #221; until the vendored copy has them, their two ids are known here.
const TOOL_IDEAS = { notizzettel: { id: 'notizzettel', kind: 'tool', de: { t: 'Notiz-|zettel' }, en: { t: 'Sticky|note' } }, 'datei-rueber': { id: 'datei-rueber', kind: 'tool', de: { t: 'Datei|rüber' }, en: { t: 'Beam|a file' } } };
export const DECK_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
/** The canonical doc of a deck card (catalog id), or null. Never the client's copy. */
export function deckDoc(id, lang) {
  if (typeof id !== 'string' || !DECK_ID.test(id)) return null;
  const idea = D.byId(id) || TOOL_IDEAS[id] || null;
  if (!idea || (idea.kind === 'arcade' && !(idea.arcade && ARCADE_GAMES.includes(idea.arcade.g)))) return null;
  const L = idea[lang === 'en' ? 'en' : 'de'] || idea.de || {};
  if (idea.kind === 'tool') return freeDoc({ k: 'tool', i: id, col: PAIRS[0].slice(), t: D.plainTitle(L.t || '') });
  const raw = D.docFromIdea(idea, { colors: PAIRS[0].slice(), nick: '' }, lang === 'en' ? 'en' : 'de');
  if (!raw) return null;
  if (raw.k === 'arcade') return freeDoc({ ...raw, t: D.plainTitle(L.t || '') });
  return freeDoc(raw);
}
/** The base of a refine step: the deck card with the person's own edits (same kind and card only), or a free card's doc. */
export function baseOf(from, edits, lang) {
  const canon = from ? deckDoc(from, lang) : null;
  if (from && !canon) return null;
  const mine = edits ? freeDoc(edits) : null;
  if (!canon) return mine;
  if (!mine || mine.k !== canon.k || mine.i !== canon.i || (canon.k === 'arcade' && mine.a !== canon.a) || (canon.k === 'table' && mine.g !== canon.g)) return canon;
  const out = { ...mine };
  delete out.ki;   // a seal belongs to the card it was made for; the new card gets its own
  return out;
}
