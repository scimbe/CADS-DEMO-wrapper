// The link format of the new app (scimbe/CADS-agent-marketplace apps/mdi): #v2.<type>.<base64url(JSON)>. The server takes the
// fragment without "#", the way the app sends it to POST /api/s and keeps it in a wall entry of "Meins".
//
// The decoding and the envelope check are the app's own (app/link.js decode with its generated validators, lib/vendor/mdi,
// bin/vendor-mdi.mjs): size, prefix, base64url, UTF-8 fatal, JSON, nesting depth, schema per type. One implementation, no
// copy written here. The server adds only what it decides itself, before or after that:
//   * only card and challenge are kept: live carries a one-time token of a live session, ghost a whole recorded run (typ);
//   * the limit counts the fragment without "#" (the app's MAX_FRAGMENT counts it with "#");
//   * one link has one spelling: canonical base64url only (no stray bits), so the same content is never stored twice.
// Reasons are the app's words: leer | zu-lang | praefix | typ | base64 | utf8 | json | schema.
import { decode as appDecode, encode as appEncode, MAX_FRAGMENT as APP_MAX } from './vendor/mdi/index.js';

export const V2_MAX = APP_MAX - 1;
export const V2_TYPES = ['card', 'challenge'];

/** A v2 fragment without "#" -> { ok: true, type, data } | { ok: false, reason }. */
export function decodeV2(f) {
  if (typeof f !== 'string' || !f) return { ok: false, reason: 'leer' };
  if (f.length > V2_MAX) return { ok: false, reason: 'zu-lang' };
  const t = /^v2\.([a-z]{1,16})\./.exec(f);
  if (t && !V2_TYPES.includes(t[1])) return { ok: false, reason: 'typ' };
  const r = appDecode('#' + f);
  if (!r.ok) return { ok: false, reason: r.reason };
  const body = f.slice(f.lastIndexOf('.') + 1);
  if (Buffer.from(body, 'base64url').toString('base64url') !== body) return { ok: false, reason: 'base64' };
  return { ok: true, type: r.type, data: r.data };
}
/** The fragment for a type and its data, without "#" (tests and tools; the app encodes its own links). Throws like the app. */
export function encodeV2(type, data) {
  if (!V2_TYPES.includes(type)) throw new Error('link-v2: typ ' + type);
  return appEncode(type, data).slice(1);
}
