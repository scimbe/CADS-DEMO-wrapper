// My Daily Idea: credit for free cards ("Create your own card"), earned only by real use of a card one made.
//
// Decided by the operator (06.11., narrowed 08.11.): credit for real use only. Opening, sharing, passing on or reach earn
// nothing. What keeps it fair:
//   * Fixed amounts, one time per card and reason, a cap per card and per calendar year. No chance, no ranking, no counter
//     the person sees grow (the app shows the balance and the reason, never how many people played).
//   * Earned only through lib/duell-deck.mjs, which counts completed use by distinct, old enough, other accounts (not the
//     creator) and only from k = DUELL_DECK_K accounts up.
//   * Not for sale, not transferable, not payable out: there is no route that buys, moves or pays out credit, and a unit of
//     credit is worth exactly one free card to the account that earned it (test/duell-deck.test.mjs checks the routes).
//   * The one other way in is grant(): a voucher code the operator configured (lib/duell-voucher.mjs, DUELL_VOUCHERS), for
//     tests and gifts. Granted units are spent like earned ones, never count against the caps of earned credit, and are
//     never taken back by revoke (they belong to no card).
//   * hold/commit/release: a unit reserved for something that is only charged when it is delivered (a KI-Bild, lib/duell-bild.mjs).
//     A held unit is not available to anything else (no double spend across features, also with requests at the same time);
//     commit charges it, release frees it again. Holds live in memory only, like the jobs they belong to: after a restart
//     nothing held was charged.
//   * A block of the card takes back what it earned (revoke). Credit already spent stays spent; the balance then starts
//     below zero inside and is shown as 0 until new credit covers it, so revoking is no way to keep spent credit.
//
//   reason  when                                                                     default  env
//   use     the card reached k completed uses by distinct eligible accounts           2        DUELL_CREDIT_USE
//   deck    a human admitted the card to the community deck                          3        DUELL_CREDIT_DECK
//   cap per card (all reasons, near-duplicates of one person count as one card)       8        DUELL_CREDIT_CARD_CAP
//   cap per account and calendar year (UTC)                                           30       DUELL_CREDIT_YEAR_CAP
//
// Subscription pot from 18: only the interface (aboStatus). Payment provider, price and term are open; nothing here sells.
//
// Storage: DUELL_CREDIT_FILE (default credit.json next to DUELL_AI_STATE_FILE), keys are the pot keys of lib/duell-ai.mjs
// (already HMACs, never an e-mail). Written atomically (tmp + rename), debounced.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { keepCorrupt } from './duell-mod.mjs';
import { dirname } from 'node:path';

export const REASONS = ['use', 'deck'];   // no 'reach': spreading a card earns nothing (08.11.)
export const GRANTS = ['voucher'];       // credit the operator hands out (lib/duell-voucher.mjs), never earned
const TAG_RE = /^[0-9a-f]{8,64}$/;
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
const KEY_RE = /^[a-z][A-Za-z0-9:_-]{8,80}$/;
const CID_RE = /^[A-Za-z0-9_-]{22}$/;

export function creditConfig(env = process.env) {
  return {
    use: num(env.DUELL_CREDIT_USE, 2),
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
  // an unreadable book is kept aside and never overwritten; while broken there is no credit to spend (fail-closed)
  let broken = false;
  if (path && existsSync(path)) {
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(path, 'utf8')).book || {})) book.set(k, v); }
    catch (e) { broken = true; keepCorrupt(path, log, 'duell-credit'); log({ event: 'duell-credit-load-failed', why: String(e && e.message || e).slice(0, 120) }); }
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!path || broken) return;
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
  const earned = (a) => live(a).filter((x) => !GRANTS.includes(x.r));
  const raw = (key) => { const a = book.get(key); return a ? live(a).reduce((s, x) => s + x.n, 0) - a.s : 0; };

  /**
   * Books credit once per card cluster and reason. root: the first card of a cluster of near-duplicates of the same person
   * (lib/duell-deck.mjs), so five small variations of one card earn what one card earns. -> units booked (0 when capped).
   */
  function award(key, cid, reason, root = cid) {
    if (!KEY_RE.test(String(key)) || !CID_RE.test(String(cid)) || !CID_RE.test(String(root)) || !REASONS.includes(reason)) return 0;
    const a = acc(key), t = now(), want = reason === 'use' ? cfg.use : cfg.deck;
    if (a.e.some((x) => (x.g || x.c) === root && x.r === reason)) return 0;   // once per cluster and reason (revoked ones too)
    const inCard = earned(a).filter((x) => (x.g || x.c) === root).reduce((s, x) => s + x.n, 0);
    const inYear = earned(a).filter((x) => year(x.at) === year(t)).reduce((s, x) => s + x.n, 0);
    const n = Math.max(0, Math.min(want, cfg.cardCap - inCard, cfg.yearCap - inYear));
    if (!n) return 0;
    a.e.push({ c: cid, ...(root !== cid ? { g: root } : {}), r: reason, n, at: t });
    save();
    return n;
  }
  /**
   * Credit the operator hands out (a voucher): n units for the account, booked with the reason and a tag (the voucher's
   * hash prefix, never the code), so limits per account and day can be counted. -> units booked (0 when broken or bad).
   */
  function grant(key, n, reason = 'voucher', tag = '') {
    n = Math.floor(Number(n));
    if (broken || !KEY_RE.test(String(key)) || !GRANTS.includes(reason) || !(n > 0 && n <= 1000) || (tag && !TAG_RE.test(String(tag)))) return 0;
    acc(key).e.push({ c: '', r: reason, n, at: now(), ...(tag ? { v: tag } : {}) });
    save();
    return n;
  }
  /** Grants with this tag since `since` (ms): of one account (key) or of all accounts. */
  function granted(tag, { key, since = 0 } = {}) {
    let n = 0;
    for (const [k, a] of book) if (key === undefined || k === key) for (const x of a.e) if (x.v === tag && x.at >= since) n++;
    return n;
  }
  /**
   * Takes back everything a card (or the cluster it heads) earned. why: 'block' (a human or the AI re-check removed the
   * card; an objection that is lifted gives it back; also takes the cluster's variants) or 'ring' (the ring check; only
   * what this one card earned, never given back). -> units taken back.
   */
  function revoke(cid, why = 'block') {
    let n = 0;
    const t = now();
    const ring = why === 'ring';
    for (const a of book.values()) for (const x of a.e) if (!x.x && x.c && (x.c === cid || (!ring && x.g === cid))) { x.x = t; x.xw = ring ? 'ring' : 'block'; n += x.n; }
    if (n) save();
    return n;
  }
  /** An objection was lifted: what the block took back counts again. What the ring check took back stays taken. */
  function unrevoke(cid) {
    let n = 0;
    for (const a of book.values()) for (const x of a.e) if (x.x && x.xw !== 'ring' && (x.c === cid || x.g === cid)) { delete x.x; delete x.xw; n += x.n; }
    if (n) save();
    return n;
  }
  const holds = new Map();   // hold id -> { key, n, at }
  let hseq = 0;
  const heldOf = (key) => { let n = 0; for (const h of holds.values()) if (h.key === key) n += h.n; return n; };
  const available = (key) => Math.max(0, raw(key) - heldOf(key));
  /** Reserves n units for a charge that only happens on delivery. -> hold id, or null when there is not enough credit. */
  function hold(key, n = 1) {
    n = Math.floor(Number(n));
    if (!KEY_RE.test(String(key)) || !(n > 0) || available(key) < n) return null;
    const id = 'h' + (++hseq).toString(36);
    holds.set(id, { key, n, at: now() });
    return id;
  }
  /** The reserved thing was delivered: the held units are spent now. -> true once per hold. */
  function commit(id) {
    const h = holds.get(id);
    if (!h) return false;
    holds.delete(id); acc(h.key).s += h.n; save();
    return true;
  }
  /** Nothing was delivered: the held units are free again, nothing was charged. */
  const release = (id) => holds.delete(id);
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
      held: heldOf(key),
      items: a ? a.e.slice(-50).map((x) => ({ cid: x.c || null, reason: x.r, n: x.n, at: new Date(x.at).toISOString(), revoked: !!x.x })) : [],
      transferable: false, purchasable: false, payable: false,
      abo: aboStatus(),
    };
  }
  return { broken: () => broken, award, grant, granted, revoke, unrevoke, available: (...a) => (broken ? 0 : available(...a)), spend: (...a) => (broken ? false : spend(...a)), refund, hold: (...a) => (broken ? null : hold(...a)), commit, release, view, cfg, flush, _book: book };
}
