// Static files below one root (static/motion, static/vendor/untertitel): fixed content types, HTTP Range (iOS/Safari will not
// play a video without 206), validators and cache headers, and no way out of the root.
import { statSync, createReadStream } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import { createHash } from 'node:crypto';

export const MEDIA_TYPES = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.vtt': 'text/vtt; charset=utf-8', '.png': 'image/png', '.webm': 'video/webm', '.wasm': 'application/wasm', '.js': 'text/javascript; charset=utf-8', '.bin': 'application/octet-stream', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };

/** URL tail -> absolute file below root, or null (traversal, NUL, hidden files, unknown type). */
export function safeMediaPath(root, tail) {
  let rel;
  try { rel = decodeURIComponent(String(tail)); } catch { return null; }
  if (!rel || rel.includes('\0') || rel.includes('\\')) return null;
  if (rel.split('/').some((seg) => seg === '..' || seg === '.' || seg === '' || seg.startsWith('.'))) return null;
  if (!MEDIA_TYPES[extname(rel).toLowerCase()]) return null;
  const base = resolve(root);
  const abs = resolve(join(base, rel));
  return abs.startsWith(base + sep) ? abs : null;
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

/** Serve `tail` below `root`. Returns true when it answered (also for 404/416). */
export function serveMedia(req, res, root, tail, extraHeaders = {}) {
  const abs = safeMediaPath(root, tail);
  let st = null;
  if (abs) { try { st = statSync(abs); } catch { st = null; } }
  if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('nf'); return true; }
  const etag = '"' + createHash('sha1').update(`${st.size}-${st.mtimeMs}`).digest('hex').slice(0, 16) + '"';
  const base = {
    'Content-Type': MEDIA_TYPES[extname(abs).toLowerCase()], 'Accept-Ranges': 'bytes', ETag: etag,
    'Last-Modified': st.mtime.toUTCString(), 'Cache-Control': 'public, max-age=86400, must-revalidate', 'X-Content-Type-Options': 'nosniff', ...extraHeaders,
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, base).end(); return true; }
  const range = req.headers.range ? parseRange(req.headers.range, st.size) : null;
  if (range === 'unsatisfiable') { res.writeHead(416, { ...base, 'Content-Range': `bytes */${st.size}` }).end(); return true; }
  if (range) {
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`, 'Content-Length': range.end - range.start + 1 });
    if (req.method === 'HEAD') return res.end(), true;
    createReadStream(abs, { start: range.start, end: range.end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...base, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end(), true;
  createReadStream(abs).pipe(res);
  return true;
}
