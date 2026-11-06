// My Daily Idea: credit for free cards ("Create your own card"), earned by real use and reach of a card one made.
//
// Decided by the operator (06.11.): credit for use and reach. For this card only, that relaxes the rule "nothing rewards
// passing things on". What keeps it fair:
//   * Fixed amounts, one time per card and reason, a cap per card and per calendar year. No chance, no ranking, no counter
//     the person sees grow (the app shows the balance and the reason, never how many people played).
//   * Earned only through lib/duell-deck.mjs, which counts completed use by distinct, old enough, other accounts (not the
//     creator) and only from k = DUELL_DECK_K accounts up.
//   * Not for sale, not transferable, not payable out: there is no route that buys, moves or pays out credit, and a unit of
//     credit is worth exactly one free card to the account that earned it (test/duell-deck.test.mjs checks the routes).
//   * A block of the card takes back what it earned (revoke). Credit already spent stays spent; the balance then starts
//     below zero inside and is shown as 0 until new credit covers it, so revoking is no way to keep spent credit.
//
//   reason  when                                                                     default  env
//   use     the card reached k completed uses by distinct eligible accounts           2        DUELL_CREDIT_USE
//   reach   the card reached DUELL_CREDIT_REACH_AT distinct eligible accounts (100)   3        DUELL_CREDIT_REACH
//   deck    a human admitted the card to the community deck                          3        DUELL_CREDIT_DECK
//   cap per card (all reasons, near-duplicates of one person count as one card)       8        DUELL_CREDIT_CARD_CAP
//   cap per account and calendar year (UTC)                                           30       DUELL_CREDIT_YEAR_CAP
//
// Subscription pot from 18: only the interface (aboStatus). Payment provider, price and term are open; nothing here sells.
//
// Storage: DUELL_CREDIT_FILE (default credit.json next to DUELL_AI_STATE_FILE), keys are the pot keys of lib/duell-ai.mjs
// (already HMACs, never an e-mail). Written atomically (tmp + rename), debounced.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const REASONS = ['use', 'reach', 'deck'];
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
const KEY_RE = /^[a-z][A-Za-z0-9:_-]{8,80}$/;
const CID_RE = /^[A-Za-z0-9_-]{22}$/;

export function creditConfig(env = process.env) {
  return {
    use: num(env.DUELL_CREDIT_USE, 2),
    reach: num(env.DUELL_CREDIT_REACH, 3),
    reachAt: num(env.DUELL_CREDIT_REACH_AT, 100),
    deck: num(env.DUELL_CREDIT_DECK, 3),
    cardCap: num(env.DUELL_CREDIT_CARD_CAP, 8),
    yearCap: num(env.DUELL_CREDIT_YEAR_CAP, 30),
  };
}

/** The subscription pot from 18: an interface only. Provider and price are open, so it is never offered. */
export const ABO = Object.freeze({ minAge: 18, provider: null, price: null, webOnly: true });
export function aboStatus() { return { offered: false, why: 'provider-open', minAge: ABO.minAge }; }

export function createCredit({ env = process.env, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)), file } = {}) {
  const cfg = creditConfig(env);
  const path = file !== undefined ? file : env.DUELL_CREDIT_FILE || (env.DUELL_AI_STATE_FILE ? dirname(env.DUELL_AI_STATE_FILE) + '/credit.json' : '');
  // key -> { e: [{ c: cid, g?: root cid, r: reason, n, at, x?: revokedAt }], s: spent }
  const book = new Map();
  let timer = null;
  if (path && existsSync(path)) {
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(path, 'utf8')).book || {})) book.set(k, v); }
    catch (e) { log({ event: 'duell-credit-load-failed', why: String(e && e.message || e).slice(0, 120) }); }
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path + '.tmp', JSON.stringify({ v: 1, book: Object.fromEntries(book) }), { mode: 0o600 });
      renameSync(path + '.tmp', path);
    } catch (e) { log({ event: 'duell-credit-write-failed', why: String(e && e.message || e).slice(0, 120) }); }
  }
  const save = () => { if (path && !timer) { timer = setTimeout(flush, 2000); if (timer.unref) timer.unref(); } };
  const acc = (key) => { let a = book.get(key); if (!a) { a = { e: [], s: 0 }; book.set(key, a); } return a; };
  const year = (t) => new Date(t).getUTCFullYear();
  const live = (a) => a.e.filter((x) => !x.x);
  const raw = (key) => { const a = book.get(key); return a ? live(a).reduce((s, x) => s + x.n, 0) - a.s : 0; };

  /**
   * Books credit once per card cluster and reason. root: the first card of a cluster of near-duplicates of the same person
   * (lib/duell-deck.mjs), so five small variations of one card earn what one card earns. -> units booked (0 when capped).
   */
  function award(key, cid, reason, root = cid) {
    if (!KEY_RE.test(String(key)) || !CID_RE.test(String(cid)) || !CID_RE.test(String(root)) || !REASONS.includes(reason)) return 0;
    const a = acc(key), t = now(), want = reason === 'use' ? cfg.use : reason === 'reach' ? cfg.reach : cfg.deck;
    if (a.e.some((x) => (x.g || x.c) === root && x.r === reason)) return 0;   // once per cluster and reason (revoked ones too)
    const inCard = live(a).filter((x) => (x.g || x.c) === root).reduce((s, x) => s + x.n, 0);
    const inYear = live(a).filter((x) => year(x.at) === year(t)).reduce((s, x) => s + x.n, 0);
    const n = Math.max(0, Math.min(want, cfg.cardCap - inCard, cfg.yearCap - inYear));
    if (!n) return 0;
    a.e.push({ c: cid, ...(root !== cid ? { g: root } : {}), r: reason, n, at: t });
    save();
    return n;
  }
  /**
   * Takes back everything a card (or the cluster it heads) earned. why: 'block' (a human or the AI re-check removed the
   * card; an objection that is lifted gives it back) or 'ring' (the ring check; never given back). -> units taken back.
   */
  function revoke(cid, why = 'block') {
    let n = 0;
    const t = now();
    for (const a of book.values()) for (const x of a.e) if (!x.x && (x.c === cid || x.g === cid)) { x.x = t; x.xw = why === 'ring' ? 'ring' : 'block'; n += x.n; }
    if (n) save();
    return n;
  }
  /** An objection was lifted: what the block took back counts again. What the ring check took back stays taken. */
  function unrevoke(cid) {
    let n = 0;
    for (const a of book.values()) for (const x of a.e) if (x.x && x.xw === 'block' && (x.c === cid || x.g === cid)) { delete x.x; delete x.xw; n += x.n; }
    if (n) save();
    return n;
  }
  const available = (key) => Math.max(0, raw(key));
  /** One free card from credit. -> true when there was credit to spend. */
  function spend(key, n = 1) {
    n = Math.floor(Number(n));
    if (!(n > 0) || available(key) < n) return false;
    acc(key).s += n; save(); return true;
  }
  /** "Verwerfen" gives a spent unit back (never more than was spent). */
  function refund(key, n = 1) {
    const a = book.get(key); n = Math.floor(Number(n));
    if (!a || !(n > 0) || a.s < n) return false;
    a.s -= n; save(); return true;
  }
  /** What the account itself sees: the balance and why, never how many people used a card. */
  function view(key) {
    const a = book.get(key);
    return {
      balance: available(key),
      items: a ? a.e.slice(-50).map((x) => ({ cid: x.c, reason: x.r, n: x.n, at: new Date(x.at).toISOString(), revoked: !!x.x })) : [],
      transferable: false, purchasable: false, payable: false,
      abo: aboStatus(),
    };
  }
  return { award, revoke, unrevoke, available, spend, refund, view, cfg, flush, _book: book };
}
