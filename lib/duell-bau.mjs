// My Daily Idea, free card, genre G3 "Baukasten" (Strang B): a NEW game from one sentence. The model writes a declarative game
// description in the language mdi-bau/1 (lib/vendor/mdi-baukasten, the app's own code, byte-equal and pinned); the server
// checks it (form, sense, limits), playtests it with bots (ends, winnable, not trivial, fair) and only then hands it out.
// Research and thresholds: CADS-agent-marketplace docs/greenfield/08-forschung/spiel-baukasten.md.
//
// Inside runKarte (lib/duell-karte.mjs) this is stage S3 for art 'bau'; S0-S2 before and S4/S5 after stay the same:
//   S3a takt      deterministic words (turn: memory, quiz, words, boards; realtime: flying, ball, snake, dodging), else the
//                 S2 classifier's answer (closed list, MOD_SCHEMA_BAU)
//   S3b generate  one call with the cached prefix BAU_SYSTEM and the strict schema of the takt (no ranges, no unions, all fields)
//   S3c check     normalize with clamping (numbers into range, said in notes), sense and limits (check.js); S1 on every text
//   S3d playtest  bots in a worker thread with a step budget (pruefer.js); the verdict is the model's only feedback
//   S3e repair    at most 2 more calls with that feedback (external feedback helps, self-critique does not: S3/S15/S35)
//   refusal       still failing: 200 notyet {what:'bau'} with reason bau_<code> and a counter-proposal from a FIXED table (an
//                 example game that passes); no charge, no strike, never a text of the model
import { Worker } from 'node:worker_threads';
import { schemaLlm, compact, normalize, defaults } from './vendor/mdi-baukasten/engines/baukasten/spec.js';
import { check, textsOf as bauTexts, LIMITS } from './vendor/mdi-baukasten/engines/baukasten/check.js';
import { pruefe, feedback, BUDGET } from './vendor/mdi-baukasten/engines/baukasten/pruefer.js';
import { BEISPIELE } from './vendor/mdi-baukasten/engines/baukasten/beispiele.js';

export { bauTexts };
export const TAKTE = ['echtzeit', 'zug'];
export const MODE_OF = { echtzeit: 'realtime', zug: 'turn' };
export const MAX_REPAIRS = 2;
/** Output limit per call: Haiku 5.5 thinks adaptively and the thinking counts toward max_tokens (lib/duell-karte.mjs OUT_MAX) */
export const OUT_MAX_BAU = 8000;

// ---- S3a: the takt of a wish ------------------------------------------------------------------------------------------
const TURN_RE = /\b(memory|memo|paare?|quiz|frage\w*|rätsel\w*|raetsel\w*|wort\w*|w(?:ö|oe)rter\w*|buchstab\w*|lückentext\w*|lueckentext\w*|anagramm\w*|tic[ -]?tac[ -]?toe|drei gewinnt|vier gewinnt|connect four|in einer reihe|abwechselnd|zug um zug|brett\w*|kreuz und kreis|words?|letters?|riddle\w*|pairs?|board|turn[- ]based|take turns)\b/i;
const RT_RE = /\b(flieg\w*|flug\w*|fly\w*|flapp\w*|spring\w*|jump\w*|ball\w*|schläger\w*|schlaeger\w*|paddle|ausweich\w*|dodge\w*|schlange\w*|snake|fang\w*|catch\w*|tipp\w* schnell|reaktion\w*|reaction|ziegel\w*|bricks?|tor\w*|goal\w*|kick\w*|fallen\w*|regen|rennen|renn\w*|race|steuer\w*|lenk\w*|pong|tischtennis|ping-?pong)\b/i;
/** 'echtzeit' | 'zug' | '' (the words say nothing; S2 decides) */
export function taktOf(text) {
  const t = String(text || ''), z = TURN_RE.test(t), r = RT_RE.test(t);
  return z && !r ? 'zug' : r && !z ? 'echtzeit' : '';
}
/** The S2 question for a G3 wish whose words leave the takt open (in the request: the cached rules stay the same) */
export const BAU_ASK = ' Also return "takt" for this game wish: "zug" when players take turns (boards, pairs, quizzes, words, riddles); "echtzeit" when something moves and reacts at once (flying, jumping, balls, dodging, steering, tapping fast).';
export const taktFrom = (r) => (r && r.json && TAKTE.includes(r.json.takt) ? r.json.takt : 'echtzeit');

/** Mechanics the kit cannot express (the free card still answers them honestly "not yet"); everything else may try G3 */
export const BAU_DENY = new Set(['Zahlen-Schiebepuzzle', 'Zahlenspiel', 'Stapelspiel', 'Strategiespiel', 'Schach', 'Kartenspiel', 'Sudoku', 'Kreuzworträtsel', 'Mühle', 'Dame',
  'Backgammon', 'Online-Mehrspieler-Spiel', 'Billard', 'Minigolf', 'Bowling', 'Schießspiel', 'Dart', 'Puzzle', 'Würfelspiel', 'Bingo', 'Rennspiel']);
/** Fixed-table games of lib/duell-absage.mjs that G3 builds (the others stay refused: a brand, a weapon, a real card table) */
export const BAU_OK_KEYS = new Set(['memory', 'pong', 'flipper']);

// ---- the counter-proposals: example games that pass the playtests (fixed, never the model's text) ---------------------
export const GEGEN = {
  flap: { satz: { de: 'Flugspiel: Tippe zum Flattern und fliege durch Lücken', en: 'Flying game: tap to flap through gaps' }, ex: 'flappy' },
  jump: { satz: { de: 'Hüpfspiel: Springe über heranrollende Kisten', en: 'Jumping game: jump over rolling boxes' }, ex: 'huepfer' },
  steer: { satz: { de: 'Schlangenspiel: Steuere die Schlange zu den Äpfeln', en: 'Snake game: steer the snake to the apples' }, ex: 'snake' },
  ball: { satz: { de: 'Ziegelspiel: Lenke den Ball und räume alle Ziegel ab', en: 'Brick game: steer the ball and clear all bricks' }, ex: 'breakout' },
  duel: { satz: { de: 'Pingpong zu zweit: Wer zuerst 5 Punkte hat, gewinnt', en: 'Ping-pong for two: first to 5 points wins' }, ex: 'pong' },
  dodge: { satz: { de: 'Ausweichspiel: Weiche fallenden Steinen 40 Sekunden lang aus', en: 'Dodging game: dodge falling rocks for 40 seconds' }, ex: 'ausweichen' },
  tap: { satz: { de: 'Reaktionsspiel: Tippe jeden Stern, bevor er verschwindet', en: 'Reaction game: tap every star before it fades' }, ex: 'reaktion' },
  place: { satz: { de: 'Drei in einer Reihe: Setzt abwechselnd, drei in einer Reihe gewinnen', en: 'Three in a row: take turns, three in a row wins' }, ex: 'drei' },
  flip: { satz: { de: 'Memory mit Tieren: Findet abwechselnd die Paare', en: 'Animal memory: take turns finding the pairs' }, ex: 'memory' },
  answer: { satz: { de: 'Buchstabensalat: Ordne die Buchstaben zum richtigen Wort', en: 'Letter jumble: put the letters in order' }, ex: 'wortsalat' },
};
/** The counter-proposal for a failed description (its mechanic), or for a wish (its takt). */
export function gegenOf(desc, takt, lang) {
  let key = takt === 'zug' ? 'flip' : 'flap';
  if (desc && desc.mode === 'turn') key = ['place', 'flip', 'answer'].includes(desc.turn.kind) ? desc.turn.kind : 'flip';
  else if (desc) {
    const own = desc.start.map((p) => desc.things.find((t) => t.id === p.thing)).find((t) => t && t.control !== 'none');
    const c = own ? own.control : desc.things.some((t) => t.control === 'tap') ? 'tap' : '';
    key = c === 'flap' ? 'flap' : c === 'jump' ? 'jump' : c === 'steer' ? 'steer' : c === 'tap' ? 'tap' : desc.things.some((t) => t.bounce !== 'none') ? (desc.players === 2 ? 'duel' : 'ball') : 'dodge';
  }
  const g = GEGEN[key];
  return { kind: 'genre', id: 'G3', satz: g.satz[lang === 'en' ? 'en' : 'de'] };
}
export const REASONS = ['nicht_gewinnbar', 'trivial', 'endet_nicht', 'zu_kurz', 'unfair', 'kaputt'];
const reasonOf = (v) => {
  if (!v || v.stage === 'schema' || v.stage === 'budget') return 'kaputt';
  const c = (v.reasons[0] || {}).code || '';
  return { 'nicht-gewinnbar': 'nicht_gewinnbar', trivial: 'trivial', 'endet-nicht': 'endet_nicht', 'zu-kurz': 'zu_kurz', unfair: 'unfair' }[c] || 'kaputt';
};

// ---- the prompt (fixed prefix, cached; the takt only selects the schema) ----------------------------------------------
const show = (o) => JSON.stringify(o);
const DEFAULTS = defaults();
const LANGUAGE = `Game type: bau - a NEW small game built from parts (language mdi-bau/1). You describe the game as data; the app plays it. Write EVERY field the schema lists; a field you do not need gets its default value shown below.

Coordinates: the world is world.w x world.h units (default 1000 x 1600, portrait; x to the right, y down). Speeds are units per second (vx, vy, power), gravity is units per second squared (about 2000-3500 for jumping or flying), times are milliseconds (every, after, life, rule n of "every"), end.time is seconds. Sizes w, h are units (a figure is about 80-110).
Grid games (snake, mazes) set world.cols and world.rows (e.g. 16 x 24); then x, y of start are cells and things move cell by cell ("steer" with power = cells per second).
Edges world.top/bottom/left/right: "wall" (things stop or bounce), "wrap" (come in on the other side), "open" (things may leave; the rule "out" fires). Things that are created outside the world (spawn x beyond the right edge) need that edge "open".

things (at most 12): the kinds of things. id (lowercase letters/digits, e.g. "bird"), look "emoji" (with one emoji) | "box" | "circle" | "text" (with text), color (box/circle; must contrast with bg: light colors on ink/blue/violet, dark ones on paper/yellow/sky/lime/white), w, h,
  gravity (falls), solid (others stand on it / stop at it), bounce "walls" (bounces off the edges) | "all" (also off solid things) | "none",
  vx, vy (start speed), spread (random extra speed from the seed),
  control: "flap" (tap = upward kick of power), "jump" (tap = jump of power when standing), "lr" / "ud" / "move" (arrow keys or finger, speed power), "drag" (follows the finger left-right: paddles), "steer" (grid: direction by arrows or swipe), "tap" (the thing can be tapped), "none",
  ai: "patrol" (moves and turns at walls), "chase" / "flee" (towards / away from the nearest player figure, speed power), "zigzag", "none"; life (ms until it vanishes, 0 = stays); trail (grid: length of the tail, grows with "grow").
start (at most 24): where things are at the beginning; seat 0 / 1 = belongs to player 1 / 2 (their figure or paddle), -1 = nobody; n > 1 makes a block (cols columns, spacing dx, dy).
spawn (at most 4): creates a thing every "every" ms (first after "after"), at x +- xr, y +- yr; gap > 0 creates a pair above and below a gap of that size (pipes); max = how many may exist at once.
rules (at most 16): when a/b happens, do up to 4 effects. when "touch" (thing a touches thing b; a may equal b in a grid: the snake bites itself), "out" (a leaves the world over edge b: top, bottom, left, right, any), "tap" (a is tapped), "miss" (a tap hits nothing), "every" (every n ms), "clear" (no a is left), "pass" (a got past b, e.g. a bird past a pipe).
  effects: act "score" (n points), "life" (n lives, -1 loses one), "destroy", "spawn" (thing at a), "bounce" (a bounces off b), "grow" (tail +n), "speed" (n percent faster), "reset" (back to the start), "win", "lose"; on: "a" (the thing a or its player), "b", "actor" (who tapped), "other" (the other player), "seat0", "seat1", "all". A ball belongs to nobody: give its points to "seat0"/"seat1".
end: time (seconds, 0 = none), score (points to win, 0 = none), lives (each player's lives), win "score" (more points / reaching end.score) | "survive" (last one alive / alive at the end of the time) | "clear" (only a rule "win" ends it). Every game needs an end and a way to win.
bot: how the computer plays it (opponent and tester): kind "track" (moves thing to follow target: paddles), "flap" (thing flies through gaps of target), "jump" (thing jumps over target), "seek" (grid: thing goes to target), "tap" (taps target), "dodge" (thing avoids target), "rollout" (tries moves), "none".
turn (turn games only): kind "place" (put pieces on a cols x rows board, line = how many in a row win, drop = pieces fall to the bottom of a column; pieces = the two things, each with an emoji), "flip" (memory: pairs = the emoji or short words, cols x rows = 2 x pairs, again = a found pair gives another turn), "answer" (items: q question, a answer, wrong = up to 3 wrong answers; ask "pick" (choose) or "type" (write); form "plain" | "scramble" (letters mixed) | "gap" (every second letter hidden); rounds = how many questions, 0 = all).
players: 1 (alone; a second person can race against your ghost) or 2 (against each other or the computer). Make it fair: both seats get the same conditions, mirrored.

Defaults (fields you leave as they are): ${show(DEFAULTS)}

Design so it can be won but needs skill: something must be in danger (lose a life when touching an obstacle, falling out, a timer), the goal must be reachable (gaps wider than about 3 x the figure, speeds a person can follow, an end.score that fits the time). Danger only after a short while (spawn.after). Never place a figure on an obstacle at the start.
The game's title and texts are your own invention, short, and follow the content rules. Use emoji that fit the wish; no weapons, no violence against people (dodging, catching, bouncing, collecting are fine).`;

const EXAMPLE_WISHES = {
  flappy: { de: 'Ein Küken flattert durch Wolkenlücken' }, breakout: { de: 'Ball und Schläger, alle Ziegel abräumen' }, pong: { de: 'Pingpong gegeneinander' },
  snake: { de: 'Schlange frisst Äpfel und wird länger' }, reaktion: { de: 'Sterne antippen, bevor sie verschwinden' }, ausweichen: { de: 'Igel weicht fallenden Steinen aus' },
  memory: { de: 'Memory mit Tieren' }, drei: { de: 'Tic Tac Toe' }, quiz: { de: 'Weltraum-Quiz zu zweit' }, wortsalat: { de: 'Buchstabensalat zum Winter' },
};
const EXAMPLES = 'Examples of whole games (short form: fields left out have the default value; you still write every field; a realtime game is written in two steps, scene first, then spawn and rules):\n\n' + Object.entries(EXAMPLE_WISHES).map(([k, w]) => {
  const d = check(BEISPIELE[k]).desc;
  return `Card type: bau, takt ${d.mode === 'turn' ? 'zug' : 'echtzeit'}. Language: German. <data>${JSON.stringify({ wish: w.de })}</data>\n${JSON.stringify({ ok: true, ...compact(d) })}`;
}).join('\n\n');

/** The fixed prefix: the card rules of the free card (shared), the language, the examples (cache breakpoint). */
export function bauSystem(rules) { return [{ text: rules, cache: false }, { text: LANGUAGE, cache: false }, { text: EXAMPLES, cache: true }]; }
/** The variable part: takt, language, players asked for, the wish as DATA, and the playtest feedback of a repair round. */
/** JSON fuer das <data>-Gehaeuse: < > & als \u-Escapes (gleiches JSON fuer das Modell, kein Tag moeglich) */
export const dataJson = (v) => JSON.stringify(v).replace(/[<>&]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
export function bauUser(d, takt, lang, fb, stage = 'ganz', scene = null) {
  const what = stage === 'szene' ? ' Step 1 of 2: write the scene only (everything except spawn and rules); the next step adds them.'
    : stage === 'regeln' ? ' Step 2 of 2: write only spawn and rules for the scene given as DATA (its thing ids, edges and seats); together they must make a complete, winnable game.' : '';
  const data = stage === 'regeln' ? { wish: d.text, scene } : { wish: d.text };
  // die Szene ist Modellausgabe: < und > werden maskiert, damit kein Text das <data>-Gehaeuse schliessen kann (Review L5)
  const base = `Card type: bau, takt ${takt}. Language: ${lang === 'en' ? 'English' : 'German'}.${what} <data>${dataJson(data)}</data>`;
  return fb ? base + ` Your last description did not pass the app's checks. ${fb} Write it again, fixed.` : base;
}
// Realtime in two steps (measured 12.11.2026: the API refuses the whole realtime schema with "compiled grammar is too large";
// without any one of rules/spawn/world/things it compiles). The split follows VGDL's own structure: first the scene (the
// SpriteSet and level: world, things, start, end, bot), then the interactions (spawners, rules) for that scene. Turn games
// fit in one call. Each step keeps clear headroom below the limit.
export const STEP_KEYS = { regeln: ['spawn', 'rules'] };
/** stage: 'ganz' (turn games), 'szene' or 'regeln' (realtime) */
export function schemaFor(takt, stage = takt === 'zug' ? 'ganz' : 'szene') {
  const full = schemaLlm(MODE_OF[takt] || 'realtime');
  if (stage === 'ganz') return full;
  const keys = stage === 'regeln' ? ['ok', ...STEP_KEYS.regeln] : full.required.filter((k) => !STEP_KEYS.regeln.includes(k));
  return { type: 'object', additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map((k) => [k, full.properties[k]])) };
}
export const stagesOf = (takt) => (takt === 'zug' ? ['ganz'] : ['szene', 'regeln']);

// ---- S3d: playtests in a worker (the event loop stays free; a stuck test is stopped) ------------------------------------
const WORKER = new URL('./duell-bau-worker.mjs', import.meta.url);
/** -> verdict of pruefe(); in a worker thread with a wall-clock guard (the step budget is the real limit). */
// Hoechstens so viele Playtest-Worker gleichzeitig (Review M5): weitere warten, statt Kerne zu ueberbuchen.
// Zustand des Moduls (eine Warteschlange je Prozess), bewusst so: der Server ist ein Prozess, Worker sind sein Betriebsmittel.
export const MAX_WORKERS = Math.max(1, Number(process.env.DUELL_BAU_WORKERS) || 2);
const pool = { running: 0, waiting: [] };
const acquire = () => new Promise((ok) => { if (pool.running < MAX_WORKERS) { pool.running++; ok(); } else pool.waiting.push(ok); });
const release = () => { const next = pool.waiting.shift(); if (next) next(); else pool.running--; };
export const poolState = () => ({ running: pool.running, waiting: pool.waiting.length });
export async function playtest(desc, opt = {}) {
  if (opt.inline) return pruefe(desc, opt);
  await acquire();
  try { return await playtestNow(desc, opt); } finally { release(); }
}
function playtestNow(desc, opt) {
  return new Promise((resolve) => {
    let done = false;
    const w = new Worker(WORKER, { workerData: { desc, games: opt.games || 6, budget: opt.budget || BUDGET, seed: opt.seed || 'pruef' }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const end = (v) => { if (done) return; done = true; clearTimeout(t); w.terminate(); resolve(v); };
    const t = setTimeout(() => end({ ok: false, stage: 'budget', errors: [], reasons: [{ code: 'budget', wert: 0, schwelle: 0, text: 'Zeitlimit' }], metrics: null, desc }), opt.timeoutMs || 15000);
    w.once('message', end);
    // ein Worker, der ohne Antwort endet (Absturz, Speichergrenze), ist sofort eine Ablehnung, nicht erst nach dem Zeitlimit
    w.once('exit', (code) => end({ ok: false, stage: 'budget', errors: ['exit ' + code], reasons: [{ code: 'budget', wert: 0, schwelle: 0, text: 'Pruefer beendet' }], metrics: null, desc }));
    w.once('error', (e) => end({ ok: false, stage: 'budget', errors: [String(e && e.message)], reasons: [{ code: 'budget', wert: 0, schwelle: 0, text: 'Pruefer-Fehler' }], metrics: null, desc }));
  });
}

// ---- S3b-e ------------------------------------------------------------------------------------------------------------
/**
 * The model's answer -> { desc, notes } | { bad: feedback text } | { refused: true }. Texts go through the server's output
 * filter (text: cleanOut + S1); a text it drops is a broken description, said to the model.
 */
export function readAnswer(j, text) {
  if (!j || typeof j !== 'object') return { bad: 'The answer was no JSON object.' };
  if (j.ok !== true) return { refused: true };
  const c = check(j, { llm: true, clamp: true });
  if (!c.ok) return { bad: feedback({ stage: 'schema', errors: c.errors }) };
  const d = c.desc, dropped = [];
  const keep = (v, max, where) => { if (!v) return v; const t = text(v, max); if (!t) dropped.push(where); return t; };
  d.title = keep(d.title, 30, 'title'); d.goal = keep(d.goal, 90, 'goal');
  for (const t of d.things) t.text = keep(t.text, 12, 'things.' + t.id + '.text');
  d.turn.pairs = d.turn.pairs.map((p, i) => (/^[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]+$/u.test(p) ? p : keep(p, 16, 'pairs[' + i + ']')));
  d.turn.items = d.turn.items.map((it, i) => ({ q: keep(it.q, 90, 'items[' + i + '].q'), a: keep(it.a, 40, 'items[' + i + '].a'), wrong: it.wrong.map((w, k) => keep(w, 40, 'items[' + i + '].wrong[' + k + ']')) }));
  if (dropped.length) return { bad: 'These texts are not allowed on this card, write them differently: ' + dropped.join(', ') + '.' };
  const again = check(d);
  if (!again.ok) return { bad: feedback({ stage: 'schema', errors: again.errors }) };
  return { desc: again.desc, notes: c.notes };
}

/**
 * S3 for art 'bau'. ctx: { llm (counted), add(usage), text, rules, takt, lang, playtest? }
 * -> { doc, note[] } | { fail, why } | { notyet, reason, alt, catalog }
 */
export async function runBau(data, ctx) {
  const takt = TAKTE.includes(ctx.takt) ? ctx.takt : 'echtzeit', lang = ctx.lang;
  const test = ctx.playtest || playtest;
  let fb = '', last = null, lastDesc = null;
  const ask = async (stage, scene) => {
    const g = await ctx.llm.generate({ system: bauSystem(ctx.rules), user: bauUser(data, takt, lang, fb, stage, scene), schema: schemaFor(takt, stage), name: 'card_bau_' + (stage === 'ganz' ? takt : stage), maxTokens: OUT_MAX_BAU, timeoutMs: 90000 });
    ctx.add(g.usage);
    return g;
  };
  for (let round = 0; round <= MAX_REPAIRS; round++) {
    let g = null;
    const parts = {};
    for (const stage of stagesOf(takt)) {
      g = await ask(stage, stage === 'regeln' ? parts : null);
      if (g.stop === 'refusal' || g.stop === 'max_tokens' || !g.json || g.json.ok !== true) break;
      Object.assign(parts, g.json);
    }
    if (g.stop === 'refusal') return { fail: 'unkind', why: 'refusal' };
    if (g.stop === 'max_tokens' || !g.json) { fb = 'Your answer was cut off or no JSON. Keep it shorter: fewer things and rules.'; last = { stage: 'schema', errors: ['cut'] }; continue; }
    if (g.json.ok !== true) { if (round === 0) return { fail: 'unkind', why: 'ok-false' }; return { fail: 'bad-output', why: 'bau-ok-false' }; }
    g = { ...g, json: { ...parts, ok: true } };
    const r = readAnswer(g.json, ctx.text);
    // the model's refusal of a wish S1 and S2 let through is hard (the same as every other art, lib/duell-karte.mjs)
    if (r.refused) return round === 0 ? { fail: 'unkind', why: 'ok-false' } : { fail: 'bad-output', why: 'bau-ok-false' };
    if (r.bad) { fb = r.bad; last = { stage: 'schema', errors: [r.bad] }; continue; }
    if (r.desc.mode !== MODE_OF[takt]) { fb = 'mode must be ' + MODE_OF[takt] + '.'; continue; }
    // S1 on every text and emoji of the game (a peach in a fruit memory is a sexual emoji to S1, measured 12.11.2026): the
    // model's slip gets one more round with the category only, no strike. The S4 classifier after it (finishCard) keeps the
    // policy of every art: its refusal is a strike, because a request built to be refused late must not be free to repeat
    const said = ctx.s1 ? ctx.s1(bauTexts(r.desc).join(' / ')) : '';
    if (said === 'crisis') return { fail: 'crisis', why: 'output' };
    if (said) { fb = 'A text or emoji of your game is not allowed on this card (' + said + '). Replace it with a harmless one.'; last = { stage: 'schema', errors: [said] }; continue; }
    lastDesc = r.desc;
    const v = await test(r.desc);
    if (v.ok) {
      const note = ['engine:bau', 'takt:' + takt, ...(round > 0 ? ['bau:repariert'] : []), ...(r.notes.length ? ['bau:begrenzt'] : [])];
      return { doc: docOf(r.desc), note, metrics: v.metrics, rounds: round + 1 };
    }
    last = v; fb = feedback(v);
  }
  const reason = reasonOf(last);
  return { notyet: { what: 'bau', name: reason }, reason: 'bau_' + reason, alt: gegenOf(lastDesc, takt, lang), catalog: [] };
}

/** The doc the app reads (Strang K doc.js: k "bau", b = short form, checked again by the card's fromFree). */
export function docOf(desc) { return { k: 'bau', t: desc.title, b: compact(desc), col: ['#ffd400', '#ff3b1d'], by: [] }; }
/** A bau doc from a request or the deck -> the same doc, checked, or null */
export function bauDoc(o) {
  if (!o || o.k !== 'bau' || !o.b || typeof o.b !== 'object') return null;
  let size; try { size = JSON.stringify(o.b).length; } catch { return null; }
  if (size > LIMITS.descBytes) return null;
  const c = check(o.b);
  return c.ok ? docOf(c.desc) : null;
}
/** Every text the game shows (S4) */
export function bauShown(doc) { const c = doc && doc.b ? normalize(doc.b) : null; return c && !c.errors.length ? bauTexts(c.desc).join(' / ') : ''; }
