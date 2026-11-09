// My Daily Idea: the community deck of free cards ("Create your own card", wave W4): fair measurement of use, candidates,
// AI re-check, human approval, the signed deck, thumbs and the graded moderation (lib/duell-mod.mjs), credit
// (lib/duell-credit.mjs).
//
// The card (contract with W2, lib/duell-karte.mjs): doc.ki = { k: "karte", s, h, o }
//   o    creator tag: HMAC-SHA256(DUELL_DECK_SALT, "o1|" + potKey + "|" + optionHash(doc without ki)), 22 chars. Different
//        on every card, so cards of one person cannot be linked by it; only the server can recompute it.
//   C    the sealed content { card: doc without ki, o };  h = optionHash(C);  s = sealer.seal("karte", C, at)
//   cid  h.slice(0, 22): the card's id here
// W2 registers a card when the person takes it ("Uebernehmen"): shared.deck.register({ cid, owner: potKey, doc, at }).
// Only registered cards are counted, proposed or credited.
//
// Fair measurement (a use counts once per account and card, only when all of this holds):
//   * a completed use: POST /api/duell/deck/use { ki, ev: "start" } hands out a token, { ev: "done", t } counts only
//     DUELL_DECK_USE_MIN_S (20) seconds to 6 hours later. Opening a link counts nothing.
//   * a login account (bunsenbrenner gate). Stored as HMAC (uTag), never the e-mail. Without login nothing is counted.
//   * not the creator; an account first seen here at least DUELL_DECK_ACCOUNT_MIN_DAYS (7) ago and on at least
//     DUELL_DECK_ACCOUNT_ACTIVE_DAYS (3) different days, today included, so once in between (Keycloak gives us no creation
//     date; "first seen" stands in);
//     not paused or blocked; at most DUELL_DECK_COUNT_PER_DAY (10) counted uses per account and day.
//   * The server knows no client IP (DUELL_IP_HEADER is empty live), so there are no IP buckets; the rules above do not need one.
//   * k-anonymity: below k = DUELL_DECK_K (25) distinct accounts nothing is evaluated or shown. Nobody, the creator included,
//     sees a count; the reviewer sees a bucket (< k, k-99, 100+).
//   * Ring check (sybil): when >= DUELL_DECK_RING_SHARE (60 %) of a card's accounts also counted for two or more other
//     cards of the same creator, the card is "flagged": no credit and no automatic proposal, a human sees it.
//   * Duplicates: a fingerprint of the card's words (bottom-k word-pair hashes). >= DUELL_DECK_DUP_SIM (0.8) with a card
//     of the same person: one cluster, credit once (lib/duell-credit.mjs root). Same as a deck card or an older card of
//     another person: never a candidate, no credit.
//
// Deck: threshold reached (k accounts, card >= DUELL_DECK_CARD_MIN_DAYS (14) old, no open report, thumbs down below the
// moderation share, creator in good standing, <= DUELL_DECK_CAND_PER_MONTH (3) candidates per creator and month) ->
// candidate -> AI re-check (shared.cardReview, W2's call B; run in batches by the timer) -> a human admits or rejects at
// /duell/pruefen. Without the AI re-check a candidate waits (DUELL_DECK_REVIEW_REQUIRED=0 lets a human decide anyway).
//
//   GET  /api/duell/deck                  the deck: { v, at, kid, cards: [{ cid, doc }], revoked: [cid], sig } (Ed25519)
//   GET  /api/duell/deck/key              { kid, alg: "Ed25519", pub } (raw public key, base64url)
//   GET  /api/duell/deck/status?c=<cid>   { c, st: "ok" | "blocked" }, no-store: the app shows a shared free card (and every
//                                         remix of it, doc.fr = the root's cid) only after "ok"; unknown -> it says so (fail closed)
// Revocation (operator 08.11.): a shared free card can be blocked at any time. A human on /duell/pruefen blocks with a rule
// ground ("block"), or confirms or releases a provisional block ("held"). Held automatically: DUELL_DECK_REPORT_ACCOUNTS (3)
// reports by distinct signed-in accounts within DUELL_DECK_REPORT_DAYS (7), or the AI re-check finds risk 3. Thumbs never hold.
//   POST /api/duell/deck/use              login, { ki, ev: "start"|"done", t? } -> 200 { t } | 204
//   POST /api/duell/deck/vote             login, { ki, v: 1|-1|0, t } -> 204
//   POST /api/duell/deck/me               login -> { cards: [{ cid, st }], credit, mod }
//   GET  /api/duell/deck/review           admin -> { queue, deck, hidden, v, mod }
//   POST /api/duell/deck/review/<cid>     admin, { action: admit|reject|block|restore, severe?, note? }
//   /api/duell/mod/...                    lib/duell-mod.mjs (served here)
//   GET  /api/duell/admin/stat?days=7|30|90|365  admin -> { days, k, stat: { masked, cards } | null, free: [...] } (no k mask)
//   GET  /duell/pruefen                   the small reviewer page (token typed in, kept in sessionStorage only)
// The deck changes its version with every admission or removal; the same version is the same bytes on every device.
// The daily rotation (ROUND in the app) never takes deck cards (apps/duell-web test/deck.test.js pins it).

import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as edSign, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { keepCorrupt } from './duell-mod.mjs';
import { dirname } from 'node:path';
import { canonical, HASH_RE, optionHash } from './duell-seal.mjs';
import { makeAdminCheck } from './duell-mod.mjs';

/** Rule grounds a human gives for a block (the reasons of lib/duell-report.mjs). */
export const GROUNDS = ['harm', 'sex', 'hate', 'private', 'wrong', 'other'];

const DAY = 86400000, HOUR = 3600000;
// The signed deck lists the most recent REVOKED_MAX revoked seals (about 25 bytes each). An older revoked card is long out
// of the deck and the search; only its "Siegel widerrufen" mark on a link someone kept can fade then.
const REVOKED_MAX = 2000;
export const STAT_DAYS = [7, 30, 90, 365];   // windows of the statistics tab
const STAT_KEEP = 400;                       // days of per-day use counters kept per free card
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
const CID_RE = /^[A-Za-z0-9_-]{22}$/;
const DOC_MAX = 4096;   // a card link is at most 1200 characters; the doc as JSON stays well below this
const b64 = (buf) => Buffer.from(buf).toString('base64url');

// ---- the card's seal (W2 contract) ------------------------------------------------------------------------------------
export function stripKi(doc) { if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null; const { ki, ...rest } = doc; return rest; }
export const ownerTag = (salt, potKey, card) => createHmac('sha256', String(salt)).update(`o1|${potKey}|${optionHash(card)}`).digest('base64url').slice(0, 22);
export const karteContent = (card, o) => ({ card, o });
/** -> { ki, cid } for a frozen card of potKey. salt: DUELL_DECK_SALT. */
export function sealKarte(sealer, salt, doc, potKey, at) {
  const card = stripKi(doc);
  if (!card) throw new Error('bad-doc');
  const o = ownerTag(salt, potKey, card), c = karteContent(card, o), h = optionHash(c);
  return { ki: { k: 'karte', s: sealer.seal('karte', c, at), h, o }, cid: h.slice(0, 22) };
}
/** Checks a sheet that carries doc.ki. -> { valid, cid?, o?, at? } */
export function checkKarte(sealer, doc) {
  const ki = doc && doc.ki, card = stripKi(doc);
  if (!card || !ki || ki.k !== 'karte' || typeof ki.o !== 'string' || !CID_RE.test(ki.o)) return { valid: false };
  const h = optionHash(karteContent(card, ki.o));
  if (ki.h !== h) return { valid: false };
  const v = sealer.verify(ki.s, karteContent(card, ki.o));
  return v.valid && v.kind === 'karte' ? { valid: true, cid: h.slice(0, 22), o: ki.o, at: v.at } : { valid: false };
}
/** Only the seal and hash (what /use and /vote get): the hash must be one our server sealed as a free card. */
function checkKi(sealer, ki) {
  if (!ki || typeof ki !== 'object' || ki.k !== 'karte' || typeof ki.h !== 'string' || !HASH_RE.test(ki.h)) return null;
  const v = sealer.verifyHash(ki.s, ki.h);
  return v.valid && v.kind === 'karte' ? ki.h.slice(0, 22) : null;
}

// ---- duplicates --------------------------------------------------------------------------------------------------------
const fold = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
function words(v, out) {
  if (typeof v === 'string') { for (const w of fold(v).split(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/u)) if (w) out.push(w); }
  else if (Array.isArray(v)) for (const x of v) words(x, out);
  else if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) if (k !== 'ki') words(v[k], out);
  return out;
}
/** Bottom-64 hashes of word pairs (single words for very short cards): similar cards share most of them. */
export function fingerprint(doc) {
  const w = words(doc, []), grams = new Set();
  if (w.length < 3) for (const x of w) grams.add(x); else for (let i = 0; i < w.length - 1; i++) grams.add(w[i] + ' ' + w[i + 1]);
  const hs = [...grams].map((g) => createHash('sha1').update(g).digest().readUInt32BE(0));
  return [...new Set(hs)].sort((a, b) => a - b).slice(0, 64);
}
/** Jaccard estimate of two fingerprints (bottom-k sketch). */
export function similarity(a, b) {
  if (!a || !b || !a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b), k = Math.min(64, A.size, B.size);
  const union = [...new Set([...a, ...b])].sort((x, y) => x - y).slice(0, k);
  let both = 0; for (const x of union) if (A.has(x) && B.has(x)) both++;
  return union.length ? both / union.length : 0;
}

export function deckConfig(env = process.env) {
  return {
    k: Math.max(2, num(env.DUELL_DECK_K, 25)),
    cardMinDays: num(env.DUELL_DECK_CARD_MIN_DAYS, 14),
    accountMinDays: num(env.DUELL_DECK_ACCOUNT_MIN_DAYS, 7),
    accountActiveDays: num(env.DUELL_DECK_ACCOUNT_ACTIVE_DAYS, 3),
    useMinS: num(env.DUELL_DECK_USE_MIN_S, 20),
    voteMinS: num(env.DUELL_DECK_VOTE_MIN_S, 10),
    useMaxS: num(env.DUELL_DECK_USE_MAX_S, 6 * 3600),
    countPerDay: num(env.DUELL_DECK_COUNT_PER_DAY, 10),
    reportShare: num(env.DUELL_DECK_REPORT_SHARE, 0.02),
    ringShare: num(env.DUELL_DECK_RING_SHARE, 0.6),
    dupSim: num(env.DUELL_DECK_DUP_SIM, 0.8),
    candPerMonth: num(env.DUELL_DECK_CAND_PER_MONTH, 3),
    rejectDays: num(env.DUELL_DECK_REJECT_DAYS, 60),
    reviewRequired: String(env.DUELL_DECK_REVIEW_REQUIRED ?? '1') !== '0',
    reviewPerTick: num(env.DUELL_DECK_REVIEW_PER_TICK, 20),
    tickMs: num(env.DUELL_DECK_TICK_MS, HOUR),
    keepDays: num(env.DUELL_DECK_KEEP_DAYS, 180),
    cardsMax: num(env.DUELL_DECK_CARDS_MAX, 20000),
    accountsMax: num(env.DUELL_DECK_ACCOUNTS_MAX, 200000),
    usersMax: num(env.DUELL_DECK_USERS_MAX, 20000),
    perOwnerDay: num(env.DUELL_DECK_PER_OWNER_DAY, 20),
    reportAccounts: Math.max(1, num(env.DUELL_DECK_REPORT_ACCOUNTS, 3)),   // distinct accounts whose reports hold a card
    reportDays: num(env.DUELL_DECK_REPORT_DAYS, 7),
    appealDays: num(env.DUELL_MOD_APPEAL_DAYS, 183),   // a removed card keeps its sheet as long as an objection can bring it back
  };
}

function loadKey(env, log, strict) {
  let why = 'DUELL_DECK_SIGN_KEY missing';
  if (env.DUELL_DECK_SIGN_KEY) {
    try {
      const k = createPrivateKey({ key: Buffer.from(String(env.DUELL_DECK_SIGN_KEY), 'base64'), format: 'der', type: 'pkcs8' });
      if (k.asymmetricKeyType === 'ed25519') return k;
      why = 'DUELL_DECK_SIGN_KEY is no Ed25519 key';
    } catch { why = 'DUELL_DECK_SIGN_KEY is no PKCS8 key (base64 DER)'; }
  }
  if (strict) throw new Error(why + ': the deck would be signed with a new key per process (set it, or DUELL_DECK_EPHEMERAL=1 for tests)');
  log({ event: 'duell-deck-config', note: why + ': the deck is signed with a new key per process' });
  return generateKeyPairSync('ed25519').privateKey;
}

/**
 * shared: lib/duell.mjs shared (sealer, readJson, send). who: lib/duell-ai.mjs who(req, input). credit, mod: the two
 * modules. review: async (doc) => { risk, cats } (W2's call B), or shared.cardReview when that is set later.
 */
export function createDeck({ env = process.env, shared, who, credit, mod, review, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)), file } = {}) {
  const cfg = deckConfig(env);
  const path = file !== undefined ? file : env.DUELL_DECK_FILE || (env.DUELL_AI_STATE_FILE ? dirname(env.DUELL_AI_STATE_FILE) + '/deck.json' : '');
  // Fail closed: a deck that keeps state on disk (production: DUELL_AI_STATE_FILE is set in docker-compose) does not start
  // without a fixed salt and signing key; with a new one per start, tags, counts and the pinned key would all break.
  // DUELL_DECK_EPHEMERAL=1 allows it (tests, local runs); without a file the deck lives in memory and only logs.
  const strict = !!path && String(env.DUELL_DECK_EPHEMERAL || '') !== '1';
  if (!env.DUELL_DECK_SALT) {
    if (strict) throw new Error('DUELL_DECK_SALT missing: creator tags and counts would restart with the process (set it, or DUELL_DECK_EPHEMERAL=1 for tests)');
    log({ event: 'duell-deck-config', note: 'DUELL_DECK_SALT missing: creator tags and counts restart with the process' });
  }
  const salt = env.DUELL_DECK_SALT || randomBytes(16).toString('hex');
  const admin = makeAdminCheck(env);
  const key = loadKey(env, log, strict), pubRaw = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
  const kid = createHash('sha256').update(pubRaw).digest('base64url').slice(0, 8);
  const mac = (s) => createHmac('sha256', salt).update(s).digest('base64url').slice(0, 22);
  const uTagOf = (potKey) => mac('u|' + potKey);
  const iso = (t) => new Date(t).toISOString();
  const today = () => iso(now()).slice(0, 10);

  // state: accounts uTag -> { f: first seen ms, d: days seen, l: last day, cd: count day, cn: counted that day }
  //        cards cid -> { o: owner pot key, at, doc, fp, st, users, n, up, down, rep, g?, dupOf?, ring?, ki?, ms, ... }
  //        deck { v, at, list: [cid], revoked: [cid] }
  const accounts = new Map(), cards = new Map(), byOwner = new Map();   // byOwner: pot key -> Set(cid), built on load
  let deck = { v: 0, at: iso(now()), list: [], revoked: [] };
  // an unreadable file (it holds the blocks) is kept aside and never overwritten; while broken nothing is shown (status 503)
  let broken = false;
  if (path && existsSync(path)) {
    try {
      const j = JSON.parse(readFileSync(path, 'utf8'));
      for (const [k, v] of Object.entries(j.accounts || {})) accounts.set(k, v);
      for (const [k, v] of Object.entries(j.cards || {})) cards.set(k, { ...v, users: new Set(v.users || []), up: new Set(v.up || []), down: new Set(v.down || []) });
      if (j.deck) deck = j.deck;
      for (const [id, c] of cards) { if (!byOwner.has(c.o)) byOwner.set(c.o, new Set()); byOwner.get(c.o).add(id); }
    } catch (e) { broken = true; keepCorrupt(path, log, 'duell-deck'); log({ event: 'duell-deck-load-failed', why: String(e && e.message || e).slice(0, 120) }); }
  }
  let timer = null;
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!path || broken) return;
    try {
      const c = {};
      for (const [k, v] of cards) c[k] = { ...v, users: [...v.users], up: [...v.up], down: [...v.down] };
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path + '.tmp', JSON.stringify({ v: 1, accounts: Object.fromEntries(accounts), cards: c, deck }), { mode: 0o600 });
      renameSync(path + '.tmp', path);
    } catch (e) { log({ event: 'duell-deck-write-failed', why: String(e && e.message || e).slice(0, 120) }); }
  }
  const save = () => { if (path && !timer) { timer = setTimeout(flush, 2000); if (timer.unref) timer.unref(); } };

  // ---- accounts ----
  /** W2 and every logged-in call here: the account was seen today. First seen is what "account age" means here. */
  function seen(potKey) {
    if (typeof potKey !== 'string' || !potKey) return null;
    const u = uTagOf(potKey), d = today();
    let a = accounts.get(u);
    if (!a) {
      if (accounts.size >= cfg.accountsMax) return null;
      a = { f: now(), d: 1, l: d, cd: d, cn: 0 }; accounts.set(u, a); save();
    } else if (a.l !== d) { a.d++; a.l = d; save(); }
    return a;
  }
  /** -> reason the account's use or thumb does not count, or '' when it does. */
  function notEligible(potKey, card) {
    if (potKey === card.o) return 'creator';
    const a = accounts.get(uTagOf(potKey));
    if (!a || now() - a.f < cfg.accountMinDays * DAY) return 'young';
    if (a.d < cfg.accountActiveDays) return 'inactive';
    if (mod && !mod.inGood(potKey)) return 'restricted';
    return '';
  }

  // ---- cards ----
  const rootOf = (c, cid) => c.g || cid;
  const bucket = (n) => (n < cfg.k ? `<${cfg.k}` : n < 100 ? `${cfg.k}-99` : '100+');
  const share = (c) => { const u = c.up.size, d = c.down.size; return u + d ? d / (u + d) : 0; };
  /** Thumbs down given since t (each account once, its last vote; old files without times count none). */
  const downSince = (c, t) => { let n = 0; for (const u of c.down) if (c.dAt && c.dAt[u] >= t) n++; return n; };
  function register({ cid, owner, doc, at } = {}) {
    const chk = shared && shared.sealer ? checkKarte(shared.sealer, doc) : { valid: false };
    if (!chk.valid || chk.cid !== cid) return { ok: false, error: 'bad-seal' };
    if (typeof owner !== 'string' || !owner || ownerTag(salt, owner, stripKi(doc)) !== chk.o) return { ok: false, error: 'bad-owner' };
    if (Buffer.byteLength(canonical(doc)) > DOC_MAX) return { ok: false, error: 'too-large' };
    if (cards.has(cid)) return { ok: true, cid, known: true };
    if (cards.size >= cfg.cardsMax) return { ok: false, error: 'full' };
    const mine = byOwner.get(owner) || new Set(), d = today();
    if ([...mine].filter((id) => cards.get(id) && iso(cards.get(id).at).slice(0, 10) === d).length >= cfg.perOwnerDay) return { ok: false, error: 'owner-limit' };
    const fp = fingerprint(doc), c = { o: owner, at: Number.isFinite(chk.at) ? chk.at : now(), doc, fp, st: 'private', users: new Set(), n: 0, up: new Set(), down: new Set(), rep: 0, ms: {} };
    for (const [id, x] of cards) {
      if (!x.fp || similarity(fp, x.fp) < cfg.dupSim) continue;
      if (x.o === owner) { if (!c.g) c.g = rootOf(x, id); }
      else if (x.st === 'deck' || x.at <= c.at) { if (!c.dupOf) c.dupOf = id; }
    }
    cards.set(cid, c);
    mine.add(cid); byOwner.set(owner, mine);
    seen(owner);
    save();
    return { ok: true, cid, ...(c.g ? { cluster: c.g } : {}), ...(c.dupOf ? { duplicate: true } : {}) };
  }
  /** Share of a card's accounts that also counted for >= 2 other cards of the same creator. */
  function ring(cid, c) {
    const others = [...(byOwner.get(c.o) || [])].filter((id) => id !== cid).map((id) => [id, cards.get(id)]).filter(([, x]) => x && x.users.size);
    if (others.length < 2 || !c.users.size) return 0;
    let hit = 0;
    for (const u of c.users) if (others.filter(([, x]) => x.users.has(u)).length >= 2) hit++;
    return hit / c.users.size;
  }
  /**
   * Coarse hint for the reviewer, no automatic step: the largest share of this card's accounts (a sample of 100) that also
   * counted for one other card with >= k accounts, of the same person or of anyone else. Catches what ring() cannot see:
   * creators with only 1-2 other cards, and one pool of accounts working for several creators. A real fan base can look
   * alike, so a human weighs it. -> { cid, share, same } or null below DUELL_DECK_RING_SHARE.
   */
  function overlap(cid, c, budget) {
    if (c.users.size < cfg.k) return null;
    const sample = [];
    for (const u of c.users) { sample.push(u); if (sample.length >= 100) break; }
    let best = null;
    for (const [id, x] of cards) {
      if (id === cid || x.users.size < cfg.k) continue;
      if ((budget.n -= sample.length) < 0) return best && { ...best, partial: true };   // keeps one admin GET short
      let hit = 0;
      for (const u of sample) if (x.users.has(u)) hit++;
      const sh = hit / sample.length;
      if (sh >= cfg.ringShare && (!best || sh > best.share)) best = { cid: id, share: Math.round(sh * 100) / 100, same: x.o === c.o };
    }
    return best;
  }
  const month = () => iso(now()).slice(0, 7);
  function candidatesThisMonth(owner) {
    let n = 0; for (const id of byOwner.get(owner) || []) { const x = cards.get(id); if (x && x.candAt && iso(x.candAt).slice(0, 7) === month()) n++; }
    return n;
  }
  /** Milestones and the threshold, run after every counted use and by the timer. */
  function evaluate(cid, c) {
    if (c.st === 'removed' || c.st === 'hidden' || c.n < cfg.k) return;
    const ownerOk = !mod || mod.inGood(c.o);
    if (['private', 'flag', 'candidate', 'review'].includes(c.st) || (c.st === 'deck' && c.ms.deckHeld)) {
      const r = ring(cid, c), was = c.ring;
      c.ring = r >= cfg.ringShare ? Math.round(r * 100) / 100 : undefined;
      if (c.ring && !was) {   // a ring shows only once its other cards are used: what the card earned goes back, a human looks
        if (credit && c.ms.use) { credit.revoke(cid, 'ring'); c.ms = { ...c.ms, use: 1, ringBack: 1 }; }
        if (c.st === 'candidate' || c.st === 'review') { c.st = 'private'; delete c.candAt; }
        save();
      }
    }
    const clean = ownerOk && !c.ring && !c.dupOf;
    if (clean && credit && c.st === 'deck' && c.ms.deckHeld) { delete c.ms.deckHeld; credit.award(c.o, cid, 'deck', rootOf(c, cid)); save(); }
    if (clean && credit) {
      if (!c.ms.use) { c.ms.use = 1; credit.award(c.o, cid, 'use', rootOf(c, cid)); save(); }
    }
    if (c.st !== 'private') return;
    if (c.ring) { if (!c.flagAt && ownerOk) { c.st = 'flag'; c.flagAt = now(); save(); } return; }   // a human looks; no automatic proposal
    const old = now() - c.at >= cfg.cardMinDays * DAY, rejected = c.rejAt && now() - c.rejAt < cfg.rejectDays * DAY;
    const reports = c.rep > 0 || (c.repAll || 0) / Math.max(1, c.n) >= cfg.reportShare;
    const thumbs = mod ? share(c) >= mod.cfg.cardShare && c.down.size >= 3 : false;
    const root = c.g && cards.get(c.g), rootBusy = root && ['candidate', 'review', 'flag', 'deck'].includes(root.st);
    if (!old || rejected || reports || thumbs || !clean || rootBusy) return;
    if (candidatesThisMonth(c.o) >= cfg.candPerMonth) return;
    c.st = cfg.reviewRequired ? 'candidate' : 'review'; c.candAt = now();
    log({ event: 'duell-deck-candidate', cid });
    save();
  }
  function count(potKey, cid, c) {
    const u = uTagOf(potKey);
    if (c.st === 'removed' || c.users.has(u) || notEligible(potKey, c)) return false;
    const a = accounts.get(u), d = today();
    if (a.cd !== d) { a.cd = d; a.cn = 0; }
    if (a.cn >= cfg.countPerDay || c.users.size >= cfg.usersMax) return false;   // past usersMax a card is long past every milestone
    a.cn++;
    c.users.add(u); c.n = c.users.size;   // n is the number of distinct accounts, never more
    if (!c.du) c.du = {};
    c.du[d] = (c.du[d] || 0) + 1;         // new distinct accounts per UTC day, for the windows of the statistics tab
    save();
    evaluate(cid, c);   // its siblings (ring check across the creator's cards) are looked at by the timer
    return true;
  }

  // ---- the deck ----
  let signed = null;   // { v, body: string, etag }
  function bump(why, cid) { deck = { ...deck, v: deck.v + 1, at: iso(now()) }; signed = null; log({ event: 'duell-deck-version', v: deck.v, why, cid }); save(); }
  function publish() {
    if (signed && signed.v === deck.v) return signed;
    const body = { v: deck.v, at: deck.at, kid, cards: deck.list.map((cid) => ({ cid, doc: cards.get(cid).doc })), revoked: deck.revoked.slice(-REVOKED_MAX) };
    const sig = b64(edSign(null, Buffer.from(canonical(body)), key));
    signed = { v: deck.v, body: JSON.stringify({ ...body, sig }), etag: `"d${deck.v}-${kid}"` };
    return signed;
  }
  function takeOut(cid, revoke) {
    const was = deck.list.includes(cid);
    if (was) deck.list = deck.list.filter((x) => x !== cid);
    if (revoke && !deck.revoked.includes(cid)) deck.revoked = [...deck.revoked, cid];
    else revoke = false;
    if (was || revoke) bump(revoke ? 'revoke' : 'hide', cid);
    return was;
  }
  /** Out of the deck (and so the search) and before a human on /duell/pruefen, until a human restores or blocks it. */
  function hide(cid, facts) {
    const c = cards.get(cid);
    if (!c || c.st === 'hidden' || c.st === 'removed') return false;
    c.was = c.st; c.st = 'hidden'; c.hidAt = now(); delete c.candAt;
    takeOut(cid, false);
    if (mod) mod.cardHidden(c.o, cid, facts);
    save();
    return true;
  }
  /** Provisional block: no access any more (status "blocked"), out of the deck, before a human. by: 'reports' | 'ai'. */
  function hold(cid, facts) {
    const c = cards.get(cid);
    if (!c || c.st === 'held' || c.st === 'removed') return false;
    c.was = c.st === 'hidden' ? c.was || 'private' : c.st; c.st = 'held'; c.heldAt = now(); delete c.candAt;
    takeOut(cid, false);
    if (mod && c.o) mod.cardHeld(c.o, cid, facts);
    log({ event: 'duell-deck-held', cid, why: facts.why });
    save();
    return true;
  }
  /** A human found nothing: the provisional block ends, no strike. */
  function release(cid) {
    const c = cards.get(cid);
    if (!c || c.st !== 'held') return false;
    c.st = c.was === 'deck' ? 'deck' : 'private'; delete c.was; delete c.heldAt; c.rA = {};
    if (c.st === 'deck' && !deck.list.includes(cid)) { deck.list = [...deck.list, cid]; bump('release', cid); }
    if (mod && c.o) mod.cardReleased(c.o, cid);
    save();
    return true;
  }
  /** What the app may show: a held or removed card (or one whose seal the deck revoked) is blocked for every link. */
  const blocked = (cid) => { const c = cards.get(cid); return (c && (c.st === 'held' || c.st === 'removed')) || deck.revoked.includes(cid); };
  /** A human undid a step (review page "restore", or an objection lifted): hidden or removed, the card comes back. */
  function restore(cid) {
    const c = cards.get(cid);
    if (!c || (c.st !== 'hidden' && c.st !== 'removed' && c.st !== 'held') || !c.doc) return false;
    const removed = c.st === 'removed';
    c.st = c.was === 'deck' ? 'deck' : 'private'; delete c.was; delete c.hidAt; delete c.remAt; delete c.flagAt; delete c.heavy; delete c.heldAt; c.rA = {};
    c.down = new Set(); c.up = new Set(); c.dAt = {}; c.rep = 0;   // the old thumbs and reports led to the decision a human has undone
    if (removed) { deck.revoked = deck.revoked.filter((x) => x !== cid); if (credit) credit.unrevoke(cid); }
    if (c.st === 'deck' && !deck.list.includes(cid)) deck.list = [...deck.list, cid];
    if (removed || c.st === 'deck') bump('restore', cid);
    save();
    return true;
  }
  if (mod && mod.onRestore) mod.onRestore((cid) => restore(cid));
  /** "block" (a human, from the review page or a report): out for good, credit back, the seal listed as revoked. */
  function block(cid, { severe = false, note, ground, quiet = false } = {}) {
    const c = cards.get(cid);
    if (!c) return { ok: false };
    if (c.st === 'removed') return { ok: true, already: true };
    c.was = c.st === 'hidden' || c.st === 'held' ? c.was : c.st; c.st = 'removed'; delete c.heldAt; c.remAt = now(); c.up = new Set(); c.down = new Set(); c.dAt = {}; delete c.candAt;
    takeOut(cid, true);   // the accounts stay until the retention drops them, so a restored card counts nobody twice
    const back = credit ? credit.revoke(cid, 'block') : 0;
    const g = GROUNDS.includes(ground) ? ground : 'other';
    if (mod && c.o && !quiet) { if (severe) mod.severe(c.o, cid, { by: 'human', cid, ground: g }); else mod.cardRemoved(c.o, cid, { by: 'human', ground: g, ...(note ? { note } : {}) }); }
    save();
    return { ok: true, creditBack: back };
  }
  /** Thumbs sort the deck: up minus down, ties keep their place. A new order is a new signed version. */
  const score = (cid) => { const c = cards.get(cid); return c ? c.up.size - c.down.size : 0; };
  function resort() {
    const next = deck.list.map((cid, i) => [cid, score(cid), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
    if (next.some((cid, i) => cid !== deck.list[i])) { deck.list = next; bump('sort'); }
  }
  function admit(cid, c) {
    c.st = 'deck'; c.admAt = now();   // the accounts stay: they keep a use from counting twice
    deck.list = [...deck.list, cid];
    bump('admit', cid);
    // under ring suspicion a human may admit the card, but the deck credit waits until the suspicion is gone (evaluate)
    if (credit) { if (c.ring) c.ms.deckHeld = 1; else credit.award(c.o, cid, 'deck', rootOf(c, cid)); }
  }
  function decide(cid, action, opts = {}) {
    const c = cards.get(cid);
    if (!c) return { status: 404, body: { error: 'unknown' } };
    if (action === 'admit') {
      if (c.st === 'flag' && cfg.reviewRequired) {
        // ring suspicion: a human's "admit" clears it for the AI re-check, never past it; the card comes back as 'review'
        if (mod && !mod.inGood(c.o)) return { status: 409, body: { error: 'owner-restricted' } };
        c.st = 'candidate'; c.candAt = now(); save();
        return { status: 202, body: { cid, st: c.st, next: 'ai-review', v: deck.v } };
      }
      const ready = c.st === 'review' || c.st === 'flag' || (c.st === 'candidate' && !cfg.reviewRequired);
      if (!ready) return { status: 409, body: { error: c.st === 'candidate' ? 'ai-review-open' : 'not-a-candidate', st: c.st } };
      if (mod && !mod.inGood(c.o)) return { status: 409, body: { error: 'owner-restricted' } };
      admit(cid, c);
    } else if (action === 'reject') {
      if (!['candidate', 'review', 'flag'].includes(c.st)) return { status: 409, body: { error: 'not-a-candidate', st: c.st } };
      c.st = 'private'; c.rejAt = now(); delete c.candAt;
    } else if (action === 'block' || action === 'confirm') {
      if (action === 'confirm' && c.st !== 'held') return { status: 409, body: { error: 'not-held', st: c.st } };
      return { status: 200, body: { cid, st: 'removed', ...block(cid, opts), v: deck.v } };
    } else if (action === 'release') { if (!release(cid)) return { status: 409, body: { error: 'not-held', st: c.st } }; }
    else if (action === 'restore') { if (!restore(cid)) return { status: 409, body: { error: 'not-hidden', st: c.st } }; }
    else return { status: 400, body: { error: 'bad-action' } };
    save();
    return { status: 200, body: { cid, st: c.st, v: deck.v } };
  }

  // ---- thumbs and reports ----
  function vote(potKey, cid, c, v) {
    const u = uTagOf(potKey);
    if (c.st === 'removed' || c.st === 'held' || notEligible(potKey, c)) return false;
    c.up.delete(u); c.down.delete(u); if (c.dAt) delete c.dAt[u];
    if (v === 1) c.up.add(u); else if (v === -1) { c.down.add(u); (c.dAt || (c.dAt = {}))[u] = now(); }
    save();
    // Thumbs sort the deck. Past the threshold (distinct accounts inside a window, and a share) the card leaves the deck and a
    // human looks at it on /duell/pruefen. Never a strike, a pause or a block of the account: that is a human's decision.
    const days = mod ? mod.cfg.downDays : 14, recent = downSince(c, now() - days * DAY);
    if (mod && c.st !== 'hidden' && c.st !== 'held' && recent >= mod.cfg.cardDown && share(c) >= mod.cfg.cardShare) hide(cid, { down: recent, days, share: Math.round(share(c) * 100) / 100, why: 'thumbs' });
    else if (c.st === 'deck') resort();
    return true;
  }
  /**
   * lib/duell-report.mjs: a report about a sealed free card (h = its checked optionHash, req = the reporter's request).
   * Every report stops a proposal. Reports of DUELL_DECK_REPORT_ACCOUNTS distinct signed-in accounts inside
   * DUELL_DECK_REPORT_DAYS hold the card (no access until a human decides); anonymous reports go to the reviewer only.
   * A card nobody registered (a shared card that was never taken) gets an entry without owner, so it can be blocked too.
   */
  async function onReport(h, req) {
    const cid = typeof h === 'string' ? h.slice(0, 22) : '';
    if (!CID_RE.test(cid)) return;
    let c = cards.get(cid);
    if (!c && cards.size < cfg.cardsMax) { c = { o: null, at: now(), doc: null, st: 'private', users: new Set(), n: 0, up: new Set(), down: new Set(), rep: 0, ms: {}, stub: 1 }; cards.set(cid, c); }
    if (!c || c.st === 'removed') return;
    c.rep++; c.repAll = (c.repAll || 0) + 1;
    if (['candidate', 'review', 'flag'].includes(c.st)) { c.st = 'private'; delete c.candAt; delete c.flagAt; }   // an open report stops the proposal
    let p = null;
    try { p = req && who ? await who(req, {}) : null; } catch { p = null; }
    // only eligible accounts hold a card, by the same rules as a thumb (old enough, active, in good standing): second accounts
    // made for it do not count; every report still reaches the reviewer (c.rep)
    if (p && p.account && !p.error && p.key !== c.o && !notEligible(p.key, c)) {
      const t = now(), from = t - cfg.reportDays * DAY;
      c.rA = Object.fromEntries(Object.entries(c.rA || {}).filter(([, at]) => at >= from));
      c.rA[uTagOf(p.key)] = t;
      const n = Object.keys(c.rA).length;
      if (n >= cfg.reportAccounts && c.st !== 'held') hold(cid, { why: 'reports', accounts: n, days: cfg.reportDays });
    }
    if (mod && mod.cfg.reportsHide > 0 && c.rep >= mod.cfg.reportsHide && c.st !== 'hidden' && c.st !== 'held') hide(cid, { reports: c.rep, why: 'reports' });
    save();
  }
  function onDecide(h, action) {
    const cid = typeof h === 'string' ? h.slice(0, 22) : '', c = cards.get(cid);
    if (!c) return;
    c.rep = Math.max(0, c.rep - 1);
    if (action === 'block') block(cid, { note: 'report' });
    save();
  }

  // ---- the timer: AI re-check in batches, thresholds that need time, retention ----
  let busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const t = now(), fn = review || (shared && shared.cardReview);
      let done = 0;
      for (const [cid, c] of [...cards]) {
        if (c.n >= cfg.k) evaluate(cid, c);
        if (c.st === 'candidate' && typeof fn === 'function' && done < cfg.reviewPerTick) {
          done++;
          let r;
          try { r = await fn(c.doc); } catch { r = null; }
          if (!r || !Number.isInteger(r.risk) || c.st !== 'candidate') continue;   // the model is away: next round
          c.ki = { risk: Math.max(0, Math.min(3, r.risk)), cats: Array.isArray(r.cats) ? r.cats.filter((x) => typeof x === 'string').slice(0, 8) : [], at: iso(t) };
          const severe = mod && c.ki.cats.some((x) => mod.cfg.severe.includes(x));
          if (c.ki.risk >= 3 || severe) {
            // provisional: no access, before a human who confirms (strike) or releases; severe ones flag the account too
            hold(cid, { risk: c.ki.risk, cats: c.ki.cats, why: 'ai-recheck', ...(severe ? { severe: true } : {}) });
          } else if (c.ki.risk === 2) { c.st = 'private'; c.rejAt = t; delete c.candAt; }
          else c.st = 'review';
          save();
        }
        // retention: a reporter's account tag stays at most DUELL_DECK_REPORT_DAYS (the privacy page says 7 days)
        if (c.rA) { const from = t - cfg.reportDays * DAY, n0 = Object.keys(c.rA).length; c.rA = Object.fromEntries(Object.entries(c.rA).filter(([, at]) => at >= from)); if (Object.keys(c.rA).length !== n0) save(); }
        // retention: a private card nobody used leaves after keepDays; a removed one keeps only its id for the seal list
        if (c.st === 'private' && !c.n && t - c.at > cfg.keepDays * DAY) { cards.delete(cid); const o = byOwner.get(c.o); if (o) o.delete(cid); save(); }
        else if (c.st === 'removed' && c.doc && t - c.remAt > cfg.appealDays * DAY) { c.doc = null; c.fp = []; c.users = new Set(); save(); }
        if (c.du) { const old = iso(t - STAT_KEEP * DAY).slice(0, 10); for (const d of Object.keys(c.du)) if (d < old) { delete c.du[d]; save(); } }
      }
      for (const [u, a] of accounts) if (t - Date.parse(a.l) > 400 * DAY) { accounts.delete(u); save(); }
      if (mod) mod.expire();
    } finally { busy = false; }
  }
  const tm = cfg.tickMs > 0 ? setInterval(() => { tick().catch(() => {}); }, cfg.tickMs) : null;
  if (tm && tm.unref) tm.unref();

  // ---- views ----
  const ST = { private: 'privat', flag: 'pruefung', candidate: 'pruefung', review: 'pruefung', deck: 'deck', hidden: 'pausiert', held: 'gesperrt', removed: 'entfernt' };
  function mine(potKey) {
    const list = [];
    for (const [cid, c] of cards) if (c.o && c.o === potKey) list.push({ cid, st: ST[c.st] || 'privat' });
    return { cards: list.slice(-100), credit: credit ? credit.view(potKey) : null, mod: mod ? mod.status(potKey) : { st: 'ok' } };
  }
  function reviewView() {
    const row = (cid, c) => ({
      cid, st: c.st, doc: c.doc, users: bucket(c.n), ageDays: Math.floor((now() - c.at) / DAY),
      thumbs: c.up.size + c.down.size >= cfg.k ? { downShare: Math.round(share(c) * 100) / 100 } : null,
      reports: c.rep, ring: c.ring || null, cluster: c.g || null, duplicateOf: c.dupOf || null, ki: c.ki || null,
      owner: mod && c.o ? mod.midOf(c.o) : null, ownerSt: mod && c.o ? mod.status(c.o).st : 'ok',
    });
    const all = [...cards];
    return {
      // the overlap hint costs set lookups: at most 2 million per view, spent on the queue in order (oldest first)
      queue: ((b) => all.filter(([, c]) => ['candidate', 'review', 'flag'].includes(c.st)).map(([id, c]) => ({ ...row(id, c), pool: b.n > 0 ? overlap(id, c, b) : null })))({ n: 2e6 }),
      deck: deck.list.map((id) => row(id, cards.get(id))),
      held: all.filter(([, c]) => c.st === 'held').map(([id, c]) => ({ ...row(id, c), reporters: Object.keys(c.rA || {}).length })),
      hidden: all.filter(([, c]) => c.st === 'hidden').map(([id, c]) => row(id, c)),
      removed: all.filter(([, c]) => c.st === 'removed' && c.doc).slice(-50).map(([id, c]) => row(id, c)),
      v: deck.v, reviewRequired: cfg.reviewRequired, ai: typeof (review || (shared && shared.cardReview)) === 'function',
      mod: mod ? mod.queue() : null,
    };
  }

  // ---- statistics tab (admin only): card statistics of lib/duell-stat.mjs plus the free cards' own numbers ----
  // The source is attached with useStat(stats). It should offer readAdmin(days) -> { cards: [{ i, share, remix, open, up,
  // down, w }] } without the k mask (counters only, no personal data); a source with only read(days) is used masked.
  let statSrc = null;
  function useStat(s) { statSrc = s && (typeof s.readAdmin === 'function' || typeof s.read === 'function') ? s : null; }
  const LABEL = { private: 'privat', flag: 'kandidat', candidate: 'kandidat', review: 'kandidat', deck: 'deck', hidden: 'pausiert', removed: 'gesperrt' };
  const cnt = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  function statView(days) {
    let rows = null, masked = false;
    if (statSrc) {
      try {
        const r = typeof statSrc.readAdmin === 'function' ? statSrc.readAdmin(days) : (masked = true, statSrc.read(days));
        if (r && Array.isArray(r.cards)) rows = r.cards;
      } catch (e) { log({ event: 'duell-deck-stat-failed', why: String(e && e.message || e).slice(0, 120) }); }
    }
    const daily = new Map();
    for (const x of (rows || []).slice(0, 5000)) {
      if (!x || typeof x.i !== 'string' || x.i.length > 40 || daily.has(x.i)) continue;
      const w = {};
      if (x.w && typeof x.w === 'object') for (const a of Object.keys(x.w).slice(0, 32)) if (/^[a-z]{1,16}$/.test(a)) w[a] = cnt(x.w[a]);
      daily.set(x.i, { i: x.i, share: cnt(x.share), remix: cnt(x.remix), open: cnt(x.open), up: cnt(x.up), down: cnt(x.down), w });
    }
    const from = iso(now() - (days - 1) * DAY).slice(0, 10), free = [];
    for (const [cid, c] of cards) {
      let use = 0;
      for (const [d, n] of Object.entries(c.du || {})) if (d >= from) use += n;
      const s = daily.get(cid);
      if (s) daily.delete(cid);
      free.push({
        cid, t: c.doc ? String(c.doc.t || c.doc.x || '').slice(0, 80) : null, st: LABEL[c.st] || 'privat',
        use, useAll: c.n, k: c.n >= cfg.k, up: c.up.size, down: c.down.size, reports: c.rep, reportsAll: c.repAll || 0,
        share: s ? s.share : null, remix: s ? s.remix : null, open: s ? s.open : null,
      });
    }
    free.sort((a, b) => b.use - a.use || b.useAll - a.useAll || (a.cid < b.cid ? -1 : 1));
    return { days, at: iso(now()), k: cfg.k, stat: rows ? { masked, cards: [...daily.values()] } : null, free: free.slice(0, 5000) };
  }

  // ---- HTTP ----
  const raw = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
  async function person(req, json) {
    const p = await who(req, { ...(json && typeof json.device === 'string' ? { device: json.device } : {}) });
    if (p && p.error && p.status === 503) return { status: 503, error: 'auth-unavailable' };
    if (!p || p.error || !p.account) return { status: 401, error: 'login' };
    seen(p.key);
    return p;
  }
  function useToken(potKey, cid, t) { const at = Math.floor(t).toString(36); return at + '.' + mac(`t|${uTagOf(potKey)}|${cid}|${at}`); }
  function tokenAge(potKey, cid, tok) {
    const m = typeof tok === 'string' && tok.match(/^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/);
    if (!m) return -1;
    const want = Buffer.from(mac(`t|${uTagOf(potKey)}|${cid}|${m[1]}`)), got = Buffer.from(m[2]);
    if (!timingSafeEqual(want, got)) return -1;
    return (now() - parseInt(m[1], 36)) / 1000;
  }

  async function route(req, res, url) {
    const p = url.pathname;
    if (p === '/duell/pruefen') { servePage(req, res); return true; }
    if (p === '/api/duell/deck' || p === '/api/duell/deck/key') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { req.resume(); raw(res, 405, { error: 'method' }, { Allow: 'GET, HEAD' }); return true; }
      const pub = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
      if (broken && p === '/api/duell/deck') { raw(res, 503, { error: 'unavailable' }, pub); return true; }
      if (p === '/api/duell/deck/key') { raw(res, 200, { kid, alg: 'Ed25519', pub: b64(pubRaw) }, { ...pub, 'Cache-Control': 'public, max-age=3600' }); return true; }
      const s = publish();
      if (req.headers['if-none-match'] === s.etag) { res.writeHead(304, { ETag: s.etag, ...pub }).end(); return true; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', ETag: s.etag, ...pub });
      res.end(req.method === 'HEAD' ? undefined : s.body); return true;
    }
    if (p === '/api/duell/deck/status') {
      req.resume();
      const cid = url.searchParams.get('c') || '';
      if (req.method !== 'GET' && req.method !== 'HEAD') { raw(res, 405, { error: 'method' }, { Allow: 'GET' }); return true; }
      const open = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
      if (!CID_RE.test(cid)) { raw(res, 400, { error: 'bad-id' }, open); return true; }
      // the blocks are not known (a broken deck or mod file): no answer that would let a card be shown (fail-closed)
      if (broken || (mod && mod.broken && mod.broken())) { raw(res, 503, { c: cid, error: 'unavailable' }, open); return true; }
      raw(res, 200, { c: cid, st: blocked(cid) ? 'blocked' : 'ok' }, open); return true;   // raw() sends Cache-Control: no-store
    }
    const adminPath = p === '/api/duell/admin/stat' || p === '/api/duell/deck/review' || p.startsWith('/api/duell/deck/review/') || p === '/api/duell/mod' || /^\/api\/duell\/mod\/[A-Za-z0-9_-]{16}$/.test(p);
    if (adminPath) {
      if (!admin.on) { req.resume(); raw(res, 503, { error: 'admin-off' }); return true; }
      if (!admin.ok(req)) { req.resume(); raw(res, 401, { error: 'token' }, { 'WWW-Authenticate': 'Bearer' }); return true; }
      if (p === '/api/duell/admin/stat') {
        req.resume();
        if (req.method !== 'GET') { raw(res, 405, { error: 'method' }, { Allow: 'GET' }); return true; }
        const days = Number(url.searchParams.get('days') ?? 30);
        if (!STAT_DAYS.includes(days)) { raw(res, 400, { error: 'bad-days', allowed: STAT_DAYS }); return true; }
        raw(res, 200, statView(days)); return true;
      }
      if (req.method === 'GET' && (p === '/api/duell/deck/review' || p === '/api/duell/mod')) {
        req.resume();
        for (const [id, c] of cards) if (c.n >= cfg.k) evaluate(id, c);   // thresholds only; the model runs in the timer
        raw(res, 200, p === '/api/duell/mod' ? (mod ? mod.queue() : { accounts: [], appeals: [] }) : reviewView()); return true;
      }
      if (p === '/api/duell/deck/review' || p === '/api/duell/mod') { req.resume(); raw(res, 405, { error: 'method' }, { Allow: 'GET' }); return true; }
      const { json } = await shared.readJson(req, res, 'POST');
      if (json === undefined) return true;
      const body = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
      if (p.startsWith('/api/duell/deck/review/')) {
        const cid = p.slice('/api/duell/deck/review/'.length);
        const r = CID_RE.test(cid) ? decide(cid, body.action, { severe: body.severe === true, ground: typeof body.ground === 'string' ? body.ground : undefined, note: typeof body.note === 'string' ? body.note.slice(0, 300) : undefined }) : { status: 404, body: { error: 'unknown' } };
        raw(res, r.status, r.body); return true;
      }
      if (!mod) { raw(res, 503, { error: 'off' }); return true; }
      const r = mod.decide(p.slice('/api/duell/mod/'.length), body.action, typeof body.nid === 'string' ? body.nid : undefined, body.note);
      raw(res, r.status, r.body); return true;
    }
    const login = ['/api/duell/deck/use', '/api/duell/deck/vote', '/api/duell/deck/me', '/api/duell/mod/me', '/api/duell/mod/appeal'];
    if (!login.includes(p)) return false;
    const { cors, json } = await shared.readJson(req, res, 'POST, OPTIONS', 8 * 1024);
    if (json === undefined) return true;
    const send = (status, body) => (status === 204 ? res.writeHead(204, { 'Cache-Control': 'no-store', ...cors.headers }).end() : shared.send(res, status, body, cors.headers));
    if (!json || typeof json !== 'object' || Array.isArray(json)) { send(400, { error: 'bad-request' }); return true; }
    const me = await person(req, json);
    if (me.error) { send(me.status, { error: me.error }); return true; }
    if (p === '/api/duell/deck/me') { send(200, mine(me.key)); return true; }
    if (p === '/api/duell/mod/me') { send(200, mod ? mod.me(me.key) : { st: 'ok', notices: [] }); return true; }
    if (p === '/api/duell/mod/appeal') { const r = mod ? mod.appeal(me.key, json.nid, json.text) : { status: 503, body: { error: 'off' } }; send(r.status, r.body); return true; }
    const cid = checkKi(shared.sealer, json.ki);
    if (!cid) { send(400, { error: 'bad-seal' }); return true; }
    const c = cards.get(cid);
    // Unknown, removed or not countable: 204 all the same, so nobody learns from the answer whether a use counted.
    if (p === '/api/duell/deck/use') {
      if (json.ev === 'start') { send(200, { t: useToken(me.key, cid, now()) }); return true; }
      if (json.ev !== 'done') { send(400, { error: 'bad-event' }); return true; }
      const age = tokenAge(me.key, cid, json.t);
      if (c && age >= cfg.useMinS && age <= cfg.useMaxS) count(me.key, cid, c);
      send(204); return true;
    }
    if (![1, -1, 0].includes(json.v)) { send(400, { error: 'bad-vote' }); return true; }
    const age = tokenAge(me.key, cid, json.t);
    if (c && age >= cfg.voteMinS && age <= 30 * DAY / 1000) vote(me.key, cid, c, json.v);
    send(204); return true;
  }

  // ---- the reviewer page: one inline script, allowed by its hash only; the token never leaves sessionStorage ----
  const PAGE_JS = String.raw`(function(){var $=function(s){return document.querySelector(s)},tok=sessionStorage.getItem('mdi-admin')||'',tab='p',days=30,last=null,sorts={},seq=0;
function api(m,p,b){return fetch(p,{method:m,headers:Object.assign({Authorization:'Bearer '+tok},b?{'Content-Type':'application/json'}:{}),body:b?JSON.stringify(b):undefined}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error)||r.status);return j})})}
function el(t,txt,cls){var e=document.createElement(t);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e}
function btn(txt,fn,ask){var b=el('button',txt);b.type='button';b.onclick=function(){if(ask&&!confirm(ask))return;b.disabled=true;fn().then(load,function(e){$('#msg').textContent='Fehler: '+e.message;b.disabled=false})};return b}
function card(r,acts){var d=el('article',null,'c');d.setAttribute('data-cid',r.cid);d.appendChild(el('h3',(r.doc&&(r.doc.t||r.doc.x))||r.cid));d.appendChild(el('p','Status: '+r.st+' · Konten: '+r.users+' · Alter: '+r.ageDays+' T · Meldungen offen: '+r.reports+(r.thumbs?' · Daumen runter: '+Math.round(r.thumbs.downShare*100)+' %':'')+(r.ring?' · Ring-Verdacht: '+Math.round(r.ring*100)+' %':'')+(r.pool?' · Publikum deckt sich zu '+Math.round(r.pool.share*100)+' % mit '+r.pool.cid+(r.pool.same?' (gleiche Person)':' (andere Person)'):'')+(r.cluster?' · Variante von '+r.cluster:'')+(r.duplicateOf?' · Dublette von '+r.duplicateOf:'')+' · KI: '+(r.ki?('Risiko '+r.ki.risk+(r.ki.cats.length?' ('+r.ki.cats.join(', ')+')':'')):'offen')+' · Konto '+r.owner+' ('+r.ownerSt+')'));
d.appendChild(el('pre',JSON.stringify(r.doc,null,1)));var row=el('div',null,'a'),sel=el('select');sel.setAttribute('aria-label','Regelgrund');[['other','Regelgrund: sonstiger Verstoss'],['harm','Regelgrund: Gewalt, Mobbing, Selbstverletzung'],['sex','Regelgrund: Sexuelles'],['hate','Regelgrund: Hass'],['private','Regelgrund: fremde Daten oder Bilder'],['wrong','Regelgrund: Irrefuehrung, Phishing']].forEach(function(g){var x=el('option',g[1]);x.value=g[0];sel.appendChild(x)});if(acts.some(function(a){return a[1].action==='block'||a[1].action==='confirm'}))row.appendChild(sel);acts.forEach(function(a){row.appendChild(btn(a[0],function(){return api('POST','/api/duell/deck/review/'+r.cid,a[1].action==='block'||a[1].action==='confirm'?Object.assign({ground:sel.value},a[1]):a[1])},a[1].severe?'Karte entfernen und Konto sofort endgueltig sperren?':null))});d.appendChild(row);return d}
function load(){$('#msg').textContent='';if(!tok){$('#out').textContent='';return}if(tab==='s')stat();else rev()}
function rev(){var n=++seq;api('GET','/api/duell/deck/review').then(function(j){if(n!==seq||tab!=='p')return;var o=$('#out');o.textContent='';o.appendChild(el('p','Deck-Version '+j.v+(j.ai?'':' · KI-Nachpruefung nicht verfuegbar')));
o.appendChild(el('h2','Zur Pruefung ('+j.queue.length+')'));j.queue.forEach(function(r){o.appendChild(card(r,[['Aufnehmen',{action:'admit'}],['Ablehnen',{action:'reject'}],['Sperren',{action:'block'}],['Sperren, schwer',{action:'block',severe:true}]]))});
o.appendChild(el('h2','Vorlaeufig gesperrt, kein Zugriff ('+(j.held||[]).length+')'));(j.held||[]).forEach(function(r){o.appendChild(card(r,[['Sperre bestaetigen (Strike)',{action:'confirm'}],['Freigeben',{action:'release'}]]))});
o.appendChild(el('h2','Aus dem Deck genommen, Daumen ('+j.hidden.length+')'));j.hidden.forEach(function(r){o.appendChild(card(r,[['Wiederherstellen',{action:'restore'}],['Sperren',{action:'block'}]]))});
o.appendChild(el('h2','Entfernt ('+j.removed.length+')'));j.removed.forEach(function(r){o.appendChild(card(r,[['Wiederherstellen',{action:'restore'}]]))});
o.appendChild(el('h2','Im Deck ('+j.deck.length+')'));j.deck.forEach(function(r){o.appendChild(card(r,[['Sperren',{action:'block'}]]))});
var m=j.mod||{accounts:[],appeals:[]};o.appendChild(el('h2','Widersprueche ('+m.appeals.length+')'));m.appeals.forEach(function(a){var d=el('article',null,'c');d.appendChild(el('p',a.type+' · '+(a.cid||'')+' · Konto '+a.mid+' · '+a.at));d.appendChild(el('blockquote',a.appeal.text));var row=el('div',null,'a');
[['Aufheben','lift'],['Bestaetigen','uphold']].forEach(function(x){row.appendChild(btn(x[0],function(){return api('POST','/api/duell/mod/'+a.mid,{action:x[1],nid:a.nid})}))});d.appendChild(row);o.appendChild(d)});
o.appendChild(el('h2','Konten zur Pruefung ('+m.accounts.length+')'));m.accounts.forEach(function(a){var d=el('article',null,'c');d.appendChild(el('p','Konto '+a.mid+' · '+a.st+(a.until?' bis '+a.until:'')));if(a.review)d.appendChild(el('p','Vorgelegt: '+a.review.why+(a.review.cats&&a.review.cats.length?' ('+a.review.cats.join(', ')+')':'')+(a.review.cards?' · Karten '+a.review.cards.join(', '):'')+' · keine Einschraenkung, bis du entscheidest'));var row=el('div',null,'a');
if(a.st!=='ok')row.appendChild(btn('Aufheben',function(){return api('POST','/api/duell/mod/'+a.mid,{action:'lift'})}));if(a.st==='ok')row.appendChild(btn('Pausieren',function(){return api('POST','/api/duell/mod/'+a.mid,{action:'pause'})},'Konto pausieren (keine neuen freien Karten)? Das Konto bekommt eine Begruendung und kann widersprechen.'));if(a.review)row.appendChild(btn('Kein Befund',function(){return api('POST','/api/duell/mod/'+a.mid,{action:'dismiss'})}));if(a.st!=='banned')row.appendChild(btn('Endgueltig sperren',function(){return api('POST','/api/duell/mod/'+a.mid,{action:'ban'})},'Konto endgueltig sperren? Das Konto kann widersprechen.'));d.appendChild(row);o.appendChild(d)})},function(e){$('#out').textContent='';$('#msg').textContent='Fehler: '+e.message})}
function setTab(t){tab=t;$('#tp').setAttribute('aria-selected',String(t==='p'));$('#ts').setAttribute('aria-selected',String(t==='s'));load()}
function N(v){return v==null?'–':String(v)}
function val(c,r){return c[3]?c[3](r):r[c[0]]}
function cell(v,txt){var s=v==null?'':String(v);if(txt&&/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",;\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function csv(name,cols,rows){var t='﻿'+cols.map(function(c){return cell(c[1],1)}).join(';')+'\r\n'+rows.map(function(r){return cols.map(function(c){return cell(val(c,r),c[4])}).join(';')}).join('\r\n')+'\r\n';
var a=el('a');a.href=URL.createObjectURL(new Blob([t],{type:'text/csv;charset=utf-8'}));a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1000)}
function table(id,cols,rows,def){var s=sorts[id]||(sorts[id]={k:def,d:-1}),by=cols.filter(function(c){return c[0]===s.k})[0]||cols[0];
rows=rows.slice().sort(function(a,b){var x=val(by,a),y=val(by,b);if(by[2]){x=x==null?-1:x;y=y==null?-1:y;return (x-y)*s.d}x=String(x==null?'':x);y=String(y==null?'':y);return (x<y?-1:x>y?1:0)*s.d});
var w=el('div',null,'tw'),t=el('table'),hd=el('thead'),tr=el('tr'),tb=el('tbody');t.id=id;
cols.forEach(function(c){var th=el('th');th.scope='col';if(c[0]===s.k)th.setAttribute('aria-sort',s.d>0?'ascending':'descending');var b=el('button',c[1]+(c[0]===s.k?(s.d>0?' ▲':' ▼'):''));b.type='button';b.setAttribute('data-k',c[0]);
b.onclick=function(){sorts[id]=s.k===c[0]?{k:c[0],d:-s.d}:{k:c[0],d:c[2]?-1:1};draw();var f=document.querySelector('#'+id+' [data-k="'+c[0]+'"]');if(f)f.focus()};th.appendChild(b);tr.appendChild(th)});
hd.appendChild(tr);t.appendChild(hd);rows.forEach(function(r){var tr=el('tr');cols.forEach(function(c){var v=val(c,r);tr.appendChild(el('td',c[2]?N(v):(v==null?'–':String(v))))});tb.appendChild(tr)});t.appendChild(tb);w.appendChild(t);return w}
function W(r){return Object.keys(r.w||{}).sort().map(function(a){return a+' '+N(r.w[a])}).join(' · ')}
function draw(){var j=last,o=$('#out');o.textContent='';var f=el('p'),l=el('label','Zeitraum '),sel=el('select');sel.id='d';l.htmlFor='d';[7,30,90,365].forEach(function(d){var op=el('option',d+' Tage');op.value=String(d);if(d===days)op.selected=true;sel.appendChild(op)});
sel.onchange=function(){days=Number(sel.value);stat()};f.appendChild(l);f.appendChild(sel);o.appendChild(f);o.appendChild(el('p','Stand '+j.at+' · k = '+j.k+' · ohne k-Maske, nur Zaehler, keine Personendaten'));
var dc=[['i','Karte',0],['share','geteilt',1],['remix','angepasst',1],['w','angepasst nach Bereich',0,W],['open','geoeffnet',1],['up','👍',1],['down','👎',1]];
o.appendChild(el('h2','Tageskarten ('+(j.stat?j.stat.cards.length:0)+')'));
if(!j.stat)o.appendChild(el('p','Kartenstatistik (lib/duell-stat.mjs) ist nicht angebunden.'));else{if(j.stat.masked)o.appendChild(el('p','Hinweis: Quelle ohne readAdmin, Werte unter k fehlen (–).'));
o.appendChild(table('st',dc,j.stat.cards,'share'));var areas={};j.stat.cards.forEach(function(r){Object.keys(r.w||{}).forEach(function(a){areas[a]=1})});
var cc=dc.filter(function(c){return c[0]!=='w'});Object.keys(areas).sort().forEach(function(a){cc.splice(cc.length-3,0,['w.'+a,'angepasst: '+a,1,function(r){return r.w?r.w[a]:null}])});
var b1=el('button','CSV Tageskarten');b1.type='button';b1.onclick=function(){csv('statistik-tageskarten-'+j.days+'t.csv',cc,j.stat.cards)};o.appendChild(b1)}
var fc=[['t','Karte',0,function(r){return r.t||r.cid}],['st','Status',0],['use','Nutzung im Zeitraum',1],['useAll','Nutzung gesamt',1],['k','ab k',0,function(r){return r.k?'ja':'nein'}],['up','👍 gesamt',1],['down','👎 gesamt',1],['reports','Meldungen offen',1],['reportsAll','Meldungen gesamt',1],['share','geteilt',1],['open','geoeffnet',1]];
o.appendChild(el('h2','Freie Karten ('+j.free.length+')'));o.appendChild(el('p','Nutzung: verschiedene berechtigte Konten mit abgeschlossener Nutzung (nicht der Ersteller). Daumen und Meldungen sind Gesamtwerte. Die Nutzung je Tag wird erst seit diesem Reiter gezaehlt; aeltere Nutzung steht nur in „gesamt“.'));
o.appendChild(table('fr',fc,j.free,'use'));var b2=el('button','CSV Freie Karten');b2.type='button';b2.onclick=function(){csv('statistik-freie-karten-'+j.days+'t.csv',[['cid','cid',0],['t','Karte',0,function(r){return r.t},1]].concat(fc.slice(1)),j.free)};o.appendChild(b2)}
function stat(){var n=++seq;api('GET','/api/duell/admin/stat?days='+days).then(function(j){if(n!==seq||tab!=='s')return;last=j;draw()},function(e){if(n!==seq)return;$('#out').textContent='';$('#msg').textContent='Fehler: '+e.message})}
$('#tp').onclick=function(){setTab('p')};$('#ts').onclick=function(){setTab('s')};
$('#f').onsubmit=function(e){e.preventDefault();tok=$('#t').value.trim();$('#t').value='';sessionStorage.setItem('mdi-admin',tok);load()};
$('#x').onclick=function(){sessionStorage.removeItem('mdi-admin');tok='';load()};load()})();`;
  const PAGE_HASH = createHash('sha256').update(PAGE_JS).digest('base64');
  const PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Deck pruefen</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:0 auto;max-width:860px;padding:16px;background:#fff;color:#111}h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:1.6rem}.c{border:1px solid #bbb;border-radius:8px;padding:10px 12px;margin:10px 0}.c h3{margin:0 0 4px;font-size:1rem}pre{white-space:pre-wrap;word-break:break-word;background:#f4f4f4;padding:8px;font-size:12px;max-height:240px;overflow:auto}.a{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid #333;background:#ffd400;color:#111;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #ff3b1d;outline-offset:2px}input{font:inherit;padding:6px;width:min(420px,100%)}.tabs{display:flex;gap:6px;margin-top:14px}[role=tab][aria-selected=true]{background:#111;color:#fff}.tw{overflow-x:auto;margin:8px 0}table{border-collapse:collapse;font-size:13px;min-width:100%}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left;white-space:normal}th button{background:none;border:0;padding:2px;font-weight:600}select{font:inherit;padding:4px}</style></head>
<body><h1>Community-Deck pruefen</h1><p>Nur fuer Pruefende. Der Zugangsschluessel bleibt in diesem Tab (sessionStorage) und geht nur an diese Seite.</p>
<form id="f"><label for="t">Zugangsschluessel</label><br><input id="t" type="password" autocomplete="off" required> <button>Anmelden</button> <button type="button" id="x">Abmelden</button></form>
<div role="tablist" class="tabs" aria-label="Bereich"><button type="button" role="tab" id="tp" aria-selected="true" aria-controls="out">Pruefen</button><button type="button" role="tab" id="ts" aria-selected="false" aria-controls="out">Statistik</button></div>
<p id="msg" role="alert"></p><div id="out" role="tabpanel" aria-live="polite"></div><script>${PAGE_JS}</script></body></html>`;
  function servePage(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { req.resume(); res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${PAGE_HASH}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
    res.end(req.method === 'HEAD' ? undefined : PAGE);
  }

  const seal = (doc, potKey, at = now()) => sealKarte(shared.sealer, salt, doc, potKey, at);
  // W2 calls shared.deck.sealKarte(doc, potKey, at) (no static import while this module is not in main)
  if (shared) shared.deck = { register, seen, seal, sealKarte: seal, check: (doc) => checkKarte(shared.sealer, doc) };
  return {
    broken: () => broken, route, useStat, statView, register, seen, seal, block, hide, hold, release, blocked, restore, decide, vote, count, evaluate, tick, onReport, onDecide, publish, mine, reviewView,
    cfg, kid, pub: b64(pubRaw), flush, stop: () => clearInterval(tm), uTagOf, _cards: cards, _accounts: accounts, _deck: () => deck,
  };
}
