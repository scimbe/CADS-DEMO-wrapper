// Ein Fragmentformat: #v2.<typ>.<b64url(JSON)> (02-spec/02-links.md). Harte Groessengrenze vor dem Parsen,
// UTF-8 fatal, Schema je Typ (Ajv standalone). Ablehnen immer mit Grund – nie raten (A4).
import * as V from "../gen/validators.js";
import { depthOk } from "../contract/equal.js";

// 4000 Zeichen (ADR 0001 f): darueber bietet der Host den Kurzlink an; nie still kuerzen
export const MAX_FRAGMENT = 4000;
export const TYPES = { card: V.linkCard, challenge: V.linkChallenge, live: V.linkLive, ghost: V.linkGhost };

function b64urlEncode(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  if (!/^[A-Za-z0-9_-]+$/.test(str) || str.length % 4 === 1) return null;
  const pad = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  let bin; try { bin = atob(pad); } catch (e) { return null; }
  const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @returns {string} Fragment inkl. "#"; wirft, wenn zu gross (UI zeigt das, statt still zu kuerzen) */
export function encode(type, data) {
  if (!TYPES[type]) throw new Error("link: Typ " + type);
  if (TYPES[type](data) !== true) throw new Error("link: Schema " + type);
  const f = "#v2." + type + "." + b64urlEncode(new TextEncoder().encode(JSON.stringify(data)));
  if (f.length > MAX_FRAGMENT) { const e = new Error("link: zu-lang"); e.code = "zu-lang"; throw e; }
  return f;
}

/** @returns {{ok:true,type:string,data:object}|{ok:false,reason:string}} */
export function decode(hash) {
  if (typeof hash !== "string" || hash.length <= 1) return { ok: false, reason: "leer" };
  if (hash.length > MAX_FRAGMENT) return { ok: false, reason: "zu-lang" };
  const m = /^#v2\.([a-z]{1,16})\.([^.]*)$/.exec(hash);
  if (!m) return { ok: false, reason: "praefix" };
  const type = m[1];
  if (!Object.prototype.hasOwnProperty.call(TYPES, type)) return { ok: false, reason: "typ" };
  const bytes = b64urlDecode(m[2]);
  if (!bytes) return { ok: false, reason: "base64" };
  let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) { return { ok: false, reason: "utf8" }; }
  let data; try { data = JSON.parse(text); } catch (e) { return { ok: false, reason: "json" }; }
  if (!depthOk(data, 8)) return { ok: false, reason: "schema" };
  let ok; try { ok = TYPES[type](data) === true; } catch (e) { ok = false; }
  if (!ok) return { ok: false, reason: "schema" };
  return { ok: true, type, data };
}
