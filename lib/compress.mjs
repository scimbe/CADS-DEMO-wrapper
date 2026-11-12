// Compressed delivery of text files that are the same for everyone (the game page, its parts, the protocol page, vendored
// scripts and wasm): brotli or gzip by Accept-Encoding, a content ETag for every representation and 304 on If-None-Match.
//
//   * Compressed once per file version (size + mtime) and kept in memory; zlib runs in the thread pool, so a first request
//     never blocks the event loop. warm() starts it at boot, so the first visitor already gets the small file.
//   * At most COMPRESS_PARALLEL zlib jobs at a time (default 1), for the whole process (staging findings L4, L8): the thread
//     pool has 4 threads and also does file reads and getaddrinfo. Compressing all parts at once at boot left none free,
//     so the gate check's DNS lookup ran into its 3 s timeout (logged-in requests answered 503 for ~15 s after a start),
//     and process.exit waited for every running job (docker stop up to its 10 s kill). A request moves the jobs of its
//     file ahead of the warm-up.
//   * Only text-like types (COMPRESSIBLE) up to MAX_BYTES. Pictures, video and model weights pass through untouched
//     (callers keep their streaming path for those).
//   * A Range request always gets the identity bytes (206 without Content-Encoding): a byte range of a brotli stream is
//     useless to the client, and resuming must address the same bytes as the uncompressed ETag.
//   * HEAD answers exactly the headers GET would send, Content-Encoding and Content-Length of the chosen body included.
//   * Vary: Accept-Encoding on every answer of a compressible file, so a shared cache never hands br to a client without it.
import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const brotliP = promisify(brotliCompress), gzipP = promisify(gzip);

/**
 * A queue for zlib jobs: at most `parallel` run at once; urgent jobs (a request waits) before warm-up jobs. -> run(fn, urgent)
 * returns fn's promise; promote(tag) moves the waiting jobs of that tag to the urgent end.
 */
export function createJobQueue(parallel = 1) {
  const max = Math.max(1, Math.floor(Number(parallel)) || 1);
  const urgent = [], later = [];
  let running = 0, queued = 0;
  const next = () => {
    while (running < max && (urgent.length || later.length)) {
      const j = urgent.length ? urgent.shift() : later.shift();
      running++;
      Promise.resolve().then(j.fn).then(j.ok, j.fail).finally(() => { running--; next(); });
    }
  };
  return {
    run(fn, isUrgent = false, tag = null) { queued++; return new Promise((ok, fail) => { (isUrgent ? urgent : later).push({ fn, ok, fail, tag }); next(); }); },
    promote(tag) { for (let i = later.length - 1; i >= 0; i--) if (later[i].tag === tag) urgent.push(...later.splice(i, 1)); },
    stats: () => ({ running, waiting: urgent.length + later.length, max, queued }),   // queued: every job accepted so far
  };
}
const SHARED = createJobQueue(process.env.COMPRESS_PARALLEL || 1);

export const COMPRESSIBLE = /^(text\/|application\/(javascript|json|wasm|xml)|image\/svg\+xml|font\/ttf)/i;
export const MAX_BYTES = 4 * 1024 * 1024;   // larger files stream as they are
export const MIN_BYTES = 1024;              // below this the headers cost more than the saving

/** Accept-Encoding -> 'br' | 'gzip' | null. q=0 refuses, '*' stands for every coding not named. br wins a tie. */
export function pickEncoding(header) {
  const q = new Map();
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    let v = 1;
    for (const p of params) { const m = /^\s*q=([0-9.]+)\s*$/.exec(p); if (m) v = Number(m[1]); }
    q.set(name, Number.isFinite(v) ? v : 0);
  }
  const of = (c) => (q.has(c) ? q.get(c) : q.has('*') ? q.get('*') : 0);
  const br = of('br'), gz = Math.max(of('gzip'), q.has('x-gzip') ? q.get('x-gzip') : 0);
  if (br > 0 && br >= gz) return 'br';
  if (gz > 0) return 'gzip';
  return null;
}

/** If-None-Match against one file version: '*', or any listed tag naming the same content (any coding, weak or strong). */
export function etagMatches(header, hash) {
  if (!header) return false;
  return String(header).split(',').some((t) => {
    t = t.trim();
    if (t === '*') return true;
    const m = /^(?:W\/)?"([^"]*)"$/.exec(t);
    return !!m && m[1].replace(/-(br|gz)$/, '') === hash;
  });
}

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" -> {start,end} | 'unsatisfiable' | null (ignore the header). */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { const n = Number(m[2]); if (n === 0) return 'unsatisfiable'; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

export function createCompressedFiles({ maxEntries = 256, maxBytes = MAX_BYTES, log = () => {}, queue = SHARED } = {}) {
  const entries = new Map();   // abs path -> { key, raw, hash, br: Promise<Buffer>, gzip: Promise<Buffer> }

  /** The current version of file, or null when it is no regular file or too large. */
  async function load(file, st = null, urgent = false) {
    try { st = st || statSync(file); } catch { return null; }
    if (!st.isFile() || st.size > maxBytes) return null;
    const key = `${st.size}-${st.mtimeMs}`;
    const old = entries.get(file);
    if (old && old.key === key) { entries.delete(file); entries.set(file, old); if (urgent) queue.promote(file); return old; }   // move to the end (LRU)
    let raw;
    try { raw = await readFile(file); } catch { return null; }
    const e = { key, raw, hash: createHash('sha256').update(raw).digest('base64url').slice(0, 22) };
    if (raw.length >= MIN_BYTES) {
      const keep = (p, name) => p.then((b) => (b.length < raw.length ? b : null), (err) => { log({ event: 'compress-error', coding: name, error: String(err && err.message || err) }); return null; });
      e.br = keep(queue.run(() => brotliP(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }), urgent, file), 'br');
      e.gzip = keep(queue.run(() => gzipP(raw, { level: 9 }), urgent, file), 'gzip');
    }
    entries.set(file, e);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return e;
  }

  /** Starts reading and compressing in the background (boot). Never throws. */
  function warm(file) { load(file).then((e) => e && Promise.all([e.br, e.gzip])).catch(() => {}); }

  /**
   * Answers GET/HEAD for file with headers (Content-Type and Cache-Control from the caller). Returns false, having sent
   * nothing, when the file is missing or not served from memory (too large): the caller then answers 404 or streams.
   * ranges: true answers Range with 206/416 on the identity bytes and sends Accept-Ranges.
   */
  async function serve(req, res, file, headers, { ranges = false, st = null } = {}) {
    const e = await load(file, st, true);
    if (!e) return false;
    const type = String(headers['Content-Type'] || '');
    const canCompress = COMPRESSIBLE.test(type) && !!e.br;
    const range = ranges && req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === `"${e.hash}"`)
      ? parseRange(req.headers.range, e.raw.length) : null;
    let coding = null, body = e.raw;
    if (canCompress && !range) {
      const want = pickEncoding(req.headers['accept-encoding']);
      const b = want && await e[want];
      if (b) { coding = want; body = b; }
    }
    const tag = `"${e.hash}${coding === 'br' ? '-br' : coding === 'gzip' ? '-gz' : ''}"`;
    const base = { ...headers, ETag: tag };
    if (canCompress) base.Vary = 'Accept-Encoding';
    if (ranges) base['Accept-Ranges'] = 'bytes';
    if (etagMatches(req.headers['if-none-match'], e.hash)) { res.writeHead(304, base).end(); return true; }
    if (range === 'unsatisfiable') { res.writeHead(416, { ...base, 'Content-Range': `bytes */${e.raw.length}` }).end(); return true; }
    if (range) {
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${e.raw.length}`, 'Content-Length': String(range.end - range.start + 1) });
      return res.end(req.method === 'HEAD' ? undefined : e.raw.subarray(range.start, range.end + 1)), true;
    }
    if (coding) base['Content-Encoding'] = coding;
    res.writeHead(200, { ...base, 'Content-Length': String(body.length) });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  return { serve, warm, load, _entries: entries };
}
