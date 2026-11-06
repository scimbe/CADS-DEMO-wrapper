// My Daily Idea: graded moderation of free cards and their creators (operator: "an account that stands out by thumbs down
// is blocked"), with a statement of reasons (DSA Art. 17) for every decision and an internal complaint (Art. 20).
//
//   step  what                                        who decides            trigger (defaults, all configurable)
//   1     the card leaves the deck and the search     automatic              lib/duell-deck.mjs: >= 8 distinct eligible
//                                                                             accounts thumbs down and >= 60 % of the thumbs,
//                                                                             or the AI re-check (risk 3) removes it
//   2     the account is paused (no new free cards,   automatic              2 hidden cards in 30 days, or one card with
//         its cards are no deck candidates)                                  >= 20 thumbs down at >= 75 %
//         ends by itself after DUELL_MOD_PAUSE_DAYS (14) unless a human decides
//   3     final block of the account                  only a human           admin action "ban" (after the pause or at once)
//   4     immediate block for clear, severe cases     automatic              the AI re-check finds a category of
//                                                                             DUELL_MOD_SEVERE_CATS (minors), or a human blocks a
//                                                                             card as severe
// Brigading: only thumbs of eligible accounts count (old enough, seen on several days, not the creator, and who opened the
// card themselves, see lib/duell-deck.mjs), and both a count over distinct accounts and a share must be reached.
//
// Every step leaves a notice for the account: facts (numbers, categories), the contractual ground (terms, section
// "community cards"), whether it was detected and decided automatically, how long it lasts and the way to complain. Within
// DUELL_MOD_APPEAL_DAYS (183, Art. 20 asks for at least six months) the account may complain once per notice, free of charge;
// a human decides (uphold | lift), never this code. "lift" undoes the step: the account is ok again, a hidden card comes back.
//
//   GET  /api/duell/mod/me          login                    -> { st, until?, notices: [...] }
//   POST /api/duell/mod/appeal      login, { nid, text }     -> 202 { nid }
//   GET  /api/duell/mod             Bearer DUELL_ADMIN_TOKEN -> { accounts: [...], appeals: [...] }
//   POST /api/duell/mod/<mid>       Bearer DUELL_ADMIN_TOKEN, { action: lift|ban|uphold, nid?, note? } -> { mid, st }
// (the routes live in lib/duell-deck.mjs, next to the deck's own)
//
// Stored: the pot key of the account (an HMAC of lib/duell-ai.mjs, no e-mail), state, notices, the complaint text (up to
// 1000 characters, it is what the person wrote to us). Reviewers see an opaque id (mid), not the pot key.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY = 86400000;
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
export const GROUND = 'terms:community-cards';   // the section of the terms the decisions rest on
const TEXT_MAX = 1000;

export function modConfig(env = process.env) {
  return {
    cardDown: num(env.DUELL_MOD_CARD_DOWN, 8),            // step 1: distinct eligible accounts with thumbs down
    cardShare: num(env.DUELL_MOD_CARD_SHARE, 0.6),        // step 1: share of thumbs down among all thumbs
    pauseStrikes: num(env.DUELL_MOD_PAUSE_STRIKES, 2),    // step 2: hidden cards within the window
    strikeDays: num(env.DUELL_MOD_STRIKE_DAYS, 30),
    heavyDown: num(env.DUELL_MOD_HEAVY_DOWN, 20),         // step 2 with one card
    heavyShare: num(env.DUELL_MOD_HEAVY_SHARE, 0.75),
    pauseDays: num(env.DUELL_MOD_PAUSE_DAYS, 14),
    appealDays: num(env.DUELL_MOD_APPEAL_DAYS, 183),
    // open reports that take a card out until a human looks. 0 (default): off, because reports carry no account and the
    // server knows no IP, so five could come from one person; reports go to the reviewer and stop a proposal instead.
    reportsHide: num(env.DUELL_MOD_REPORTS_HIDE, 0),
    // categories of W2's classifier (lib/duell-karte.mjs): sexual, minors, hate, harassment, violence, weapons, self_harm,
    // drugs, real_person, brand, phishing, injection, politics, religion, other. Only "minors" (it holds sexual content
    // with minors) blocks at once by default; every other risk-3 finding removes the card with a strike (step 1/2).
    severe: String(env.DUELL_MOD_SEVERE_CATS ?? 'minors').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** Bearer DUELL_ADMIN_TOKEN, same rule as lib/duell-report.mjs (at least 16 characters, compared as hashes). */
export function makeAdminCheck(env = process.env) {
  const want = env.DUELL_ADMIN_TOKEN && String(env.DUELL_ADMIN_TOKEN).length >= 16 ? createHash('sha256').update(String(env.DUELL_ADMIN_TOKEN)).digest() : null;
  const ok = (req) => {
    if (!want) return false;
    const m = String(req.headers.authorization || '').match(/^Bearer (\S{16,200})$/);
    return !!m && timingSafeEqual(createHash('sha256').update(m[1]).digest(), want);
  };
  return { on: !!want, ok };
}

export function createMod({ env = process.env, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)), file, salt, onRestore = () => {} } = {}) {
  const cfg = modConfig(env);
  const path = file !== undefined ? file : env.DUELL_MOD_FILE || (env.DUELL_AI_STATE_FILE ? dirname(env.DUELL_AI_STATE_FILE) + '/mod.json' : '');
  const midSalt = salt || env.DUELL_DECK_SALT || env.DUELL_AI_SALT || randomBytes(16).toString('hex');
  const midOf = (key) => createHmac('sha256', midSalt).update('m|' + key).digest('base64url').slice(0, 16);
  // key -> { st: 'ok'|'paused'|'banned', until?, strikes: [{ c, at, used? }], n: [notice] }
  const accounts = new Map();
  let timer = null;
  let restore = onRestore;
  if (path && existsSync(path)) {
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(path, 'utf8')).accounts || {})) accounts.set(k, v); }
    catch (e) { log({ event: 'duell-mod-load-failed', why: String(e && e.message || e).slice(0, 120) }); }
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path + '.tmp', JSON.stringify({ v: 1, accounts: Object.fromEntries(accounts) }), { mode: 0o600 });
      renameSync(path + '.tmp', path);
    } catch (e) { log({ event: 'duell-mod-write-failed', why: String(e && e.message || e).slice(0, 120) }); }
  }
  const save = () => { if (path && !timer) { timer = setTimeout(flush, 1000); if (timer.unref) timer.unref(); } };
  const acc = (key) => { let a = accounts.get(key); if (!a) { a = { st: 'ok', strikes: [], n: [] }; accounts.set(key, a); } return a; };
  const iso = (t) => new Date(t).toISOString();

  /** A statement of reasons (DSA Art. 17 (3)): what, why (facts and ground), automated or not, how long, how to complain. */
  function notice(key, type, { cid, facts = {}, automated = true, until } = {}) {
    const t = now(), a = acc(key), lift = type === 'lift';
    const n = {
      nid: randomBytes(9).toString('base64url'), at: iso(t), type, scope: type.startsWith('card') ? 'card' : 'account',
      ...(cid ? { cid } : {}), facts, ground: GROUND,
      automated: { detected: !!automated, decided: !!automated },
      ...(until ? { until: iso(until) } : {}),
      redress: lift ? [] : ['appeal', 'court'], ...(lift ? {} : { appealUntil: iso(t + cfg.appealDays * DAY) }),
    };
    a.n.push(n);
    if (a.n.length > 50) a.n.splice(0, a.n.length - 50);
    save();
    log({ event: 'duell-mod', type, mid: midOf(key), cid: cid || undefined, automated: !!automated });
    return n;
  }
  function expire() {
    const t = now();
    for (const [key, a] of accounts) if (a.st === 'paused' && a.until && t >= a.until) {
      a.st = 'ok'; delete a.until; notice(key, 'lift', { facts: { why: 'pause-ended' } });
    }
  }
  function status(key) {
    expire();
    const a = accounts.get(key);
    return a ? { st: a.st, ...(a.until ? { until: iso(a.until) } : {}) } : { st: 'ok' };
  }
  /** For lib/duell-karte.mjs (W2): may this account make a new free card? */
  function canCreate(key) {
    const s = status(key);
    if (s.st === 'ok') return { ok: true };
    const last = [...acc(key).n].reverse().find((n) => n.type === (s.st === 'paused' ? 'pause' : 'ban'));
    return { ok: false, error: s.st === 'paused' ? 'account-paused' : 'account-banned', ...(s.until ? { until: s.until } : {}), notice: last && last.nid };
  }
  /** May this account's cards become deck candidates, and do its thumbs and uses count? */
  const inGood = (key) => status(key).st === 'ok';

  function pause(key, facts, automated = true) {
    const a = acc(key);
    if (a.st !== 'ok') return a.st;
    a.st = 'paused'; a.until = now() + cfg.pauseDays * DAY;
    notice(key, 'pause', { facts, automated, until: a.until });
    return a.st;
  }
  function ban(key, facts, automated) {
    const a = acc(key);
    if (a.st === 'banned') return a.st;
    a.st = 'banned'; delete a.until;
    notice(key, 'ban', { facts, automated });
    return a.st;
  }
  /** Drops strikes outside the window (and an older one of the same card), adds this one -> the unused ones in the window. */
  function addStrike(a, cid, t) {
    a.strikes = a.strikes.filter((s) => t - s.at < cfg.strikeDays * DAY && s.c !== cid);
    a.strikes.push({ c: cid, at: t });
    return a.strikes.filter((s) => !s.used);
  }
  /**
   * Step 1 happened (lib/duell-deck.mjs took a card out). Notes a strike and pauses the account when the strikes in the
   * window reach cfg.pauseStrikes, or when this one card is heavy. strike false: notice only (hidden by anonymous reports).
   */
  function cardHidden(key, cid, facts, { strike = true } = {}) {
    const a = acc(key), t = now(), n = notice(key, 'card-hidden', { cid, facts });
    if (!strike) return { notice: n, st: a.st };   // open reports are anonymous: they hide a card until a human looks, never pause
    const open = addStrike(a, cid, t);
    const heavy = (facts.down || 0) >= cfg.heavyDown && (facts.share || 0) >= cfg.heavyShare;
    if (a.st === 'ok' && (open.length >= cfg.pauseStrikes || heavy)) {
      for (const s of open) s.used = 1;
      pause(key, { cards: open.map((s) => s.c), heavy, ...(heavy ? { down: facts.down, share: facts.share } : {}) });
    }
    save();
    return { notice: n, st: a.st };
  }
  /**
   * The card was removed: by a human (review, report), or automatically by the AI re-check (risk 3). Only the automatic
   * removal is a strike, and like cardHidden only strikes inside DUELL_MOD_STRIKE_DAYS count towards a pause.
   */
  const cardRemoved = (key, cid, facts, automated = false) => {
    const n = notice(key, 'card-removed', { cid, facts, automated });
    if (automated) {
      const a = acc(key), open = addStrike(a, cid, now());
      if (a.st === 'ok' && open.length >= cfg.pauseStrikes) { for (const s of open) s.used = 1; pause(key, { cards: open.map((s) => s.c) }); }
      save();
    }
    return n;
  };
  /** Step 2 with one card: thumbs down went on past the heavy mark after the card was hidden. */
  function cardHeavy(key, cid, facts) {
    const a = acc(key);
    if (a.st === 'ok') { const t = now(); a.strikes = a.strikes.filter((s) => t - s.at < cfg.strikeDays * DAY); for (const s of a.strikes) s.used = 1; pause(key, { cards: [cid], heavy: true, down: facts.down, share: facts.share }); }
    return a.st;
  }
  /** Step 4: a clear, severe case. Automated, only categories of cfg.severe count. -> true when it blocked. */
  function severe(key, cid, facts, automated = true) {
    const cats = (facts.cats || []).filter((c) => cfg.severe.includes(c));
    if (automated && !cats.length) return false;
    ban(key, { ...facts, cid, cats: automated ? cats : facts.cats || [], severe: true }, automated);
    return true;
  }
  /** The account's own view: state and notices (no other person's data in there). */
  function me(key) {
    const s = status(key), a = accounts.get(key);
    return { ...s, notices: a ? a.n.map((n) => ({ ...n })) : [] };
  }
  function appeal(key, nid, text) {
    const a = accounts.get(key), n = a && typeof nid === 'string' && a.n.find((x) => x.nid === nid);
    if (!n || n.type === 'lift') return { status: 404, body: { error: 'unknown' } };
    if (n.appeal) return { status: 409, body: { error: 'appealed', state: n.appeal.state } };
    if (Date.parse(n.appealUntil) < now()) return { status: 410, body: { error: 'too-late' } };
    const t = String(typeof text === 'string' ? text : '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
    if (!t || [...t].length > TEXT_MAX) return { status: 400, body: { error: 'bad-text', max: TEXT_MAX } };
    n.appeal = { text: t, at: iso(now()), state: 'open' };
    save();
    return { status: 202, body: { nid } };
  }
  const findMid = (mid) => { for (const [k] of accounts) if (midOf(k) === mid) return k; return null; };
  /** A human decides. lift: undo (pause/ban ends, a hidden card comes back); uphold: the decision stays; ban: final block. */
  function decide(mid, action, nid, note) {
    const key = typeof mid === 'string' ? findMid(mid) : null;
    if (!key) return { status: 404, body: { error: 'unknown' } };
    const a = acc(key), n = nid ? a.n.find((x) => x.nid === nid) : null;
    if (nid && !n) return { status: 404, body: { error: 'unknown-notice' } };
    const why = typeof note === 'string' && note ? note.slice(0, 300) : undefined;
    const close = (state) => { if (n && n.appeal && n.appeal.state === 'open') { n.appeal.state = state; n.appeal.decidedAt = iso(now()); if (why) n.appeal.note = why; } };
    if (action === 'ban') { close('upheld'); ban(key, { by: 'human', ...(why ? { note: why } : {}) }, false); }
    else if (action === 'uphold') {
      if (!n || !n.appeal || n.appeal.state !== 'open') return { status: 409, body: { error: 'no-open-appeal' } };
      close('upheld');
    } else if (action === 'lift') {
      close('lifted');
      if (n && n.cid && (n.type === 'card-hidden' || n.type === 'card-removed')) { a.strikes = a.strikes.filter((s) => s.c !== n.cid); restore(n.cid, key); }
      if (a.st !== 'ok' && (!n || n.type === 'pause' || n.type === 'ban')) { a.st = 'ok'; delete a.until; }
      notice(key, 'lift', { facts: { by: 'human', ...(n ? { of: n.nid } : {}) }, automated: false, ...(n && n.cid ? { cid: n.cid } : {}) });
    } else return { status: 400, body: { error: 'bad-action' } };
    save();
    return { status: 200, body: { mid, st: a.st } };
  }
  /** Reviewer queue: accounts not ok, and every open complaint. */
  function queue() {
    expire();
    const list = [], appeals = [];
    for (const [k, a] of accounts) {
      const mid = midOf(k);
      if (a.st !== 'ok') list.push({ mid, st: a.st, ...(a.until ? { until: iso(a.until) } : {}), notices: a.n.slice(-5) });
      for (const n of a.n) if (n.appeal && n.appeal.state === 'open') appeals.push({ mid, nid: n.nid, type: n.type, cid: n.cid, facts: n.facts, at: n.at, appeal: n.appeal });
    }
    return { accounts: list.slice(0, 200), appeals: appeals.slice(0, 200) };
  }
  return { status, canCreate, inGood, cardHidden, cardHeavy, cardRemoved, severe, pause, ban, me, appeal, decide, queue, expire, midOf, cfg, flush, onRestore: (fn) => { restore = fn; }, _accounts: accounts };
}
