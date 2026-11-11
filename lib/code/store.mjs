// My Daily Idea, Code-Modus: where a game that passed every check lives, and its signature. The person never sees, sends or
// edits code: a link carries only id + hash + signature; the app fetches the code from here and runs it only when both verify.
//
//   GET  /api/duell/code/key          -> { kid, alg: 'Ed25519', pub }   (the app also has the key built in: CODE_PUBKEY)
//   GET  /api/duell/code/<id>?h=<h>   -> { v, id, h, meta, params, title, genre, at, code, sig }
//                                        404 unknown, 409 h is not this game's hash, 410 pulled (revoked)
//   POST /api/duell/code/<id>         Bearer DUELL_ADMIN_TOKEN, { action: 'revoke', why } -> { id, revoked: true }
//
// Signature: Ed25519 over signedText(record) = "mdi-code-v1\n" + canonical({ v, id, h, meta, params, title, genre, at }),
// h = base64url(SHA-256(code)), the code being the instrumented code (lib/code/check.mjs) exactly as stored. The code
// answer is JSON with nosniff and a CSP of its own (default-src 'none'; sandbox): it is never a script the browser runs
// directly; the app's player puts it into its sandbox (src/code-player.js).
// Key: DUELL_CODE_SIGN_KEY (base64 PKCS#8 DER, Ed25519). Without it a key per process is made and logged (links die on a
// restart: fine for tests and a prototype, not for production; strict: true refuses to start without one).
// Storage: DUELL_CODE_DIR/<id>.json (0600) and DUELL_CODE_DIR/revoked.jsonl; without a dir only in memory.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as edSign, verify as edVerify, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SDK = require('./sdk.js');
export const ID_RE = /^[A-Za-z0-9_-]{16}$/;
export const H_RE = /^[A-Za-z0-9_-]{43}$/;
export const SIG_RE = /^[A-Za-z0-9_-]{86}$/;
export const codeHash = (code) => createHash('sha256').update(String(code), 'utf8').digest('base64url');
export const signedText = (r) => 'mdi-code-v1\n' + SDK.canonical({ v: r.v, id: r.id, h: r.h, meta: r.meta, params: r.params, title: r.title, genre: r.genre, at: r.at });
/** The link part of a game: "<id>.<h>.<sig>" */
export const linkOf = (r) => `${r.id}.${r.h}.${r.sig}`;
export function parseLink(s) {
  const m = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{86})$/.exec(String(s || ''));
  return m ? { id: m[1], h: m[2], sig: m[3] } : null;
}

function loadKey(env, log, strict) {
  if (env.DUELL_CODE_SIGN_KEY) {
    try {
      const k = createPrivateKey({ key: Buffer.from(String(env.DUELL_CODE_SIGN_KEY), 'base64'), format: 'der', type: 'pkcs8' });
      if (k.asymmetricKeyType === 'ed25519') return k;
    } catch { /* below */ }
    log({ event: 'duell-code-key', ok: false, why: 'DUELL_CODE_SIGN_KEY is not an Ed25519 PKCS#8 key' });
    if (strict) throw new Error('code-key');
  } else {
    if (strict) throw new Error('code-key-missing');
    log({ event: 'duell-code-key', note: 'no DUELL_CODE_SIGN_KEY: a key for this process only' });
  }
  return generateKeyPairSync('ed25519').privateKey;
}

export function createCodeStore({ env = process.env, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)), strict = false, key } = {}) {
  const priv = key || loadKey(env, log, strict);
  const pubKey = createPublicKey(priv);
  const pubRaw = pubKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const kid = createHash('sha256').update(pubRaw).digest('base64url').slice(0, 8);
  const dir = String(env.DUELL_CODE_DIR || '');
  const mem = new Map(), revoked = new Map();
  if (dir) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const f = join(dir, 'revoked.jsonl');
      if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) { try { const r = JSON.parse(line); if (r && ID_RE.test(r.id)) revoked.set(r.id, r); } catch { /* half a line */ } }
    } catch (e) { log({ event: 'duell-code-store', ok: false, why: String(e.message).slice(0, 100) }); }
  }
  const sign = (r) => edSign(null, Buffer.from(signedText(r), 'utf8'), priv).toString('base64url');

  /** A checked game -> its signed record (stored). */
  function put({ code, meta, params = {}, title, genre, extra = {} }) {
    const r = { v: 1, id: randomBytes(12).toString('base64url'), h: codeHash(code), meta, params, title: String(title || meta.title || '').slice(0, 40), genre: String(genre || ''), at: Math.floor(now()) };
    r.sig = sign(r);
    const rec = { ...r, code, ...extra };
    mem.set(r.id, rec);
    if (dir) { const f = join(dir, r.id + '.json'); writeFileSync(f + '.tmp', JSON.stringify(rec), { mode: 0o600 }); renameSync(f + '.tmp', f); }
    return rec;
  }
  function get(id) {
    if (!ID_RE.test(String(id || ''))) return null;
    if (mem.has(id)) return mem.get(id);
    if (!dir) return null;
    try { const rec = JSON.parse(readFileSync(join(dir, id + '.json'), 'utf8')); mem.set(id, rec); return rec; } catch { return null; }
  }
  /** Checks a record as the app does: hash of the code, signature of the signed text. */
  function verify(rec) {
    if (!rec || typeof rec.code !== 'string' || codeHash(rec.code) !== rec.h || !SIG_RE.test(String(rec.sig || ''))) return false;
    try { return edVerify(null, Buffer.from(signedText(rec), 'utf8'), pubKey, Buffer.from(rec.sig, 'base64url')); } catch { return false; }
  }
  function revoke(id, why = '') {
    if (!ID_RE.test(String(id || ''))) return false;
    const r = { id, why: String(why).slice(0, 80), at: Math.floor(now()) };
    revoked.set(id, r);
    if (dir) try { appendFileSync(join(dir, 'revoked.jsonl'), JSON.stringify(r) + '\n', { mode: 0o600 }); } catch (e) { log({ event: 'duell-code-revoke', ok: false, why: String(e.message).slice(0, 100) }); }
    log({ event: 'duell-code-revoke', id });
    return true;
  }
  const isRevoked = (id) => revoked.has(id);

  // ---- http ----------------------------------------------------------------------------------------------------------------
  const HDR = {
    'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin',
    'Referrer-Policy': 'no-referrer',
  };
  const send = (res, status, body, extra = {}) => { res.writeHead(status, { ...HDR, ...extra }); res.end(JSON.stringify(body)); };
  const admin = env.DUELL_ADMIN_TOKEN && String(env.DUELL_ADMIN_TOKEN).length >= 16 ? createHash('sha256').update(String(env.DUELL_ADMIN_TOKEN)).digest() : null;
  const isAdmin = (req) => {
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    return !!(admin && m && timingSafeEqual(createHash('sha256').update(m[1]).digest(), admin));
  };
  async function route(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/api/duell/code/')) return false;
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...HDR, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' }); res.end(); return true; }
    if (p === '/api/duell/code/key' && req.method === 'GET') { send(res, 200, { kid, alg: 'Ed25519', pub: pubRaw.toString('base64url') }, { 'Cache-Control': 'public, max-age=3600' }); return true; }
    const id = p.slice('/api/duell/code/'.length);
    if (!ID_RE.test(id)) { send(res, 404, { error: 'unknown' }); return true; }
    if (req.method === 'GET') {
      const rec = get(id);
      if (!rec) { send(res, 404, { error: 'unknown' }); return true; }
      if (isRevoked(id)) { send(res, 410, { error: 'pulled' }, { 'Cache-Control': 'no-store' }); return true; }
      if (url.searchParams.get('h') !== rec.h) { send(res, 409, { error: 'hash' }); return true; }
      const { v, h, meta, params, title, genre, at, code, sig } = rec;
      // short cache: a pulled game stops within minutes also where a cache kept it
      send(res, 200, { v, id, h, meta, params, title, genre, at, code, sig }, { 'Cache-Control': 'public, max-age=300' });
      return true;
    }
    if (req.method === 'POST') {
      if (!isAdmin(req)) { send(res, 401, { error: 'auth' }); return true; }
      let body = '';
      for await (const c of req) { body += c; if (body.length > 2000) break; }
      let j; try { j = JSON.parse(body); } catch { j = {}; }
      if (j.action !== 'revoke') { send(res, 400, { error: 'bad-action' }); return true; }
      revoke(id, j.why);
      send(res, 200, { id, revoked: true });
      return true;
    }
    send(res, 405, { error: 'method' });
    return true;
  }
  return { put, get, verify, revoke, isRevoked, route, kid, pub: pubRaw.toString('base64url'), sign };
}
