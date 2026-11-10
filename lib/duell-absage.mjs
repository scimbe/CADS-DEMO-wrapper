// My Daily Idea, free card ("Create your own card"): the honest refusal with a counter-proposal (Konzept v2.1, 7.1).
// A wish the free card cannot build (a named game it does not have, a brand, a star, gambling or a weapon in a game) gets a
// FIXED answer from this table: the key of an app text (grund) and at most one counter-proposal (alt). Nothing of it is ever
// written by the model, nothing is replaced automatically, it costs no credit and is never a strike.
//
// alt.kind 'katalog': a card of the catalog, found by its mechanic in the vendored ideas.json (turn.g, table.game, arcade.g,
//   kind + tag), never by its title; alt.id is that card's stable id.
// alt.kind 'genre': a genre of the free card (G1 Flieger, G2 Runner, G11 Schaetzen, G12 Wahl & Bluff, G15 Skala) with a fixed
//   example sentence (satz). The person may send it as a new, normal wish; it goes through S1-S4 like any other.
// This file owns the table; the genre lexicon (W2) only reads it.

import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const IDEAS = req('./vendor/duell-web/daily.js').IDEAS;

/** The genres of the free card (the chips the person chooses first) */
export const GENRES = ['G1', 'G2', 'G11', 'G12', 'G15'];

// a catalog card by its mechanic: exactly one card must have it (test/duell-absage.test.mjs), else no alt
const BY = {
  turn: (g) => (i) => i.kind === 'turn' && i.turn && i.turn.g === g,
  table: (game) => (i) => i.kind === 'table' && i.table && i.table.game === game,
  arcade: (g) => (i) => i.kind === 'arcade' && i.arcade && i.arcade.g === g,
  tag: (kind, tag) => (i) => i.kind === kind && Array.isArray(i.tags) && i.tags.includes(tag),
};
/** The ids of the catalog cards a lookup finds (in catalog order) */
export function lookup(find) { return IDEAS.filter(find).map((i) => i.id); }
const one = (find) => { const ids = lookup(find); return ids.length === 1 ? ids[0] : null; };
const katalog = (find, satz) => { const id = one(find); return id ? { kind: 'katalog', id, satz } : null; };
const genre = (id, satz) => ({ kind: 'genre', id, satz });

// The table. grund: the key of the app's text (apps/duell-web/src/texts.json, create_absage_*). catalog: further chips.
// Mechanic keys first (a named game), then the soft categories of S1 and S2 (no game named).
const T = {
  tetris: { alt: katalog(BY.turn('steine'), 'Gleiche Steine für uns beide') },
  match3: { alt: katalog(BY.turn('steine'), 'Gleiche Steine für uns beide') },
  memory: { alt: katalog(BY.turn('kennst'), 'Kennst du mich wirklich?') },
  puzzle: { alt: katalog(BY.turn('steine'), 'Gleiche Steine für uns beide') },
  rhythmus: { alt: katalog(BY.tag('sound', 'rhythmus'), 'Bau einen Beat') },
  schach: { alt: null, catalog: lookup(BY.tag('turn', 'strategie')).slice(0, 3) },
  skat: { alt: katalog(BY.table('skat'), 'Skat live') },
  dart: { alt: katalog(BY.turn('dart'), 'Dart im Wohnzimmer') },
  shooter: { alt: null },
  bot_gegen_bot: { alt: genre('G1', 'Spiel du vor: ein Flugspiel, in dem die andere Person gegen deinen Geist fliegt') },
  rennen: { alt: genre('G1', 'Flug-Wettrennen: ich fliege vor, du fliegst gegen meinen Geist') },
  pong: { alt: katalog(BY.arcade('puck'), 'Puck-Duell') },
  flipper: { alt: katalog(BY.arcade('flipper'), 'Flipper-Duell') },
  marke: { alt: null },
  person: { alt: null },
  gluecksspiel: { alt: null },
  spielwaffe: { alt: null },
  alkohol: { alt: null },
  horror: { alt: null },
  allgemein: { alt: null },
};
/** Games the free card builds itself as an ability (the matching of lib/duell-karte.mjs covers them, Dart since #183): no
 * refusal for them in art game; their entry answers only where nothing is built (a soft refusal) */
export const ALS_FAEHIGKEIT = Object.freeze(new Set(['dart']));
/** ABSAGE[key] = { grund, alt: {kind, id, satz} | null, catalog: [ids] } (frozen) */
export const ABSAGE = Object.freeze(Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Object.freeze({
  grund: 'create_absage_' + k,
  alt: v.alt ? Object.freeze({ ...v.alt }) : null,
  catalog: Object.freeze([...new Set([...(v.alt && v.alt.kind === 'katalog' ? [v.alt.id] : []), ...(v.catalog || [])])]),
})])));

// The game a wish names that the free card does not have (W2 replaces this short list by the genre lexicon). A wish about
// flying stays a flying game ("Flugspiel mit Tetris-Steinen"), as namedGame in lib/duell-karte.mjs.
const FLIGHT = /\bflieg\w*|\bflug\w*|\bfly\w*|\bflight\b|\bflapp\w*|\bschweb\w*|\bglid\w*|\bsegel\w*|\bwings?\b|\bflügel\w*|\bfluegel\w*/i;
const GAMES = [
  ['tetris', /\btetris\w*/i],
  ['match3', /\bmatch[- ]?(?:3|three|drei)\b|\bcandy ?crush\b|\bbejeweled\b/i],
  ['memory', /\bmemory\b|\bmemo-?spiel\w*|\bpaare finden\b/i],
  ['puzzle', /\bpuzzle\w*|\bpuzzel\w*/i],
  ['rhythmus', /\brhythmus-?spiel\w*|\brhythm game\w*|\bguitar hero\b|\bsingstar\b|\btakt-?spiel\w*/i],
  ['schach', /\bschach\w*|\bchess\b/i],
  ['skat', /\b(?:bauern)?skat\b/i],
  ['dart', /\bdarts?\w*/i],
  ['shooter', /\bshooter\b|\begoshooter\b|\bschie(?:ß|ss)spiel\w*|\bballerspiel\w*|\bcounter-?strike\b|\bcall of duty\b/i],
  ['bot_gegen_bot', /\b(?:bots?|kis?|agenten?|roboter) (?:gegen|vs\.?|versus) (?:bots?|kis?|agenten?|roboter)\b|\b(?:zwei|2|beide|two) (?:bots|kis|agenten|roboter)\b/i],
  ['rennen', /\bmario ?kart\b|\brennspiel\w*|\bautorennen\b|\bracing game\b|\bkart-?rennen\b/i],
  ['pong', /(?<!ping[ -]?)\bpong\b/i],
  ['flipper', /\bflipper\w*|\bpinball\b/i],
];
/** The table key of a game the wish names, or '' (none, or a wish about flying) */
export function gameKeyOf(text) {
  const t = String(text || '');
  if (FLIGHT.test(t)) return '';
  const hit = GAMES.find(([, re]) => re.test(t));
  return hit ? hit[0] : '';
}
const GAMBLE = /poker|lotto|gambl|betting|gl(?:ü|ue|u)cksspiel|sportwett|wettb(?:ü|ue|u)ro|spielautomat|spielhalle|casino|kasino|roulette|blackjack|einarmige/i;
/** The table key of a soft category (S1: brand, real_person, youth, weapons; S2: brand, real_person, drugs, weapons, violence) */
export function categoryKeyOf(cat, text) {
  if (cat === 'brand') return 'marke';
  if (cat === 'real_person') return 'person';
  if (cat === 'youth') return GAMBLE.test(String(text || '')) ? 'gluecksspiel' : 'spielwaffe';
  if (cat === 'weapons') return 'spielwaffe';
  if (cat === 'drugs') return GAMBLE.test(String(text || '')) ? 'gluecksspiel' : 'alkohol';
  if (cat === 'violence') return 'horror';
  return '';
}
/** The answer of a soft refusal: { notyet: true, reason, alt, catalog }; every field from the table, none from a model */
export function absage(key) {
  const a = ABSAGE[key];
  if (!a) return null;
  return { notyet: true, reason: key, alt: a.alt ? { ...a.alt } : null, catalog: [...a.catalog] };
}
/** The answer for a wish refused softly: the game it names wins over the category (Tetris is a brand and a game) */
export function absageOf(text, cat) { return absage(gameKeyOf(text) || categoryKeyOf(cat, text) || 'allgemein'); }
/** Is alt a counter-proposal of this table: a catalog id in the vendored ideas.json, or a genre of the free card */
export function altOk(alt) {
  if (!alt || typeof alt !== 'object') return false;
  if (alt.kind === 'katalog') return typeof alt.id === 'string' && IDEAS.some((i) => i.id === alt.id);
  if (alt.kind === 'genre') return GENRES.includes(alt.id) && typeof alt.satz === 'string' && !!alt.satz;
  return false;
}
