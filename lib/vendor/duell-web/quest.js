/* Secret channel: each answer is the key to the next riddle. Pure logic (no DOM), Web Crypto only. */
(function (root) {
  "use strict";
  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./core.js") : root.DuellCore;
  var MAX_STOPS = 3, MAX_Q = 44, MAX_A = 24, ITER = 30000, NONCE = 12;
  var BLOB = /^[A-Za-z0-9_-]{20,420}$/;
  // No meeting places, addresses or ways to reach someone: a riddle is about what two people already share.
  var CONTACT = /https?:|www\.|\.(de|com|org|net)\b|@|\d[\d\s/-]{4,}\d|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*uhr\b|stra(ß|ss)e|\bstr\.|(markt|sport|spiel|park|schul)platz|treffpunkt|treffen\b|\btreff\b|adresse|standort|bahnhof|haltestelle|komm (zu|allein|\w* ?vorbei)|allein|hausnummer|handynummer|telefon|snap|insta|tiktok|whatsapp|discord|\bstreet\b|\bmeet\b|address|location|\bcome (to|alone|over)|\balone\b|phone number/i;

  function clean(s, max) {
    var t = Array.from(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
    return t && C.isClean(t) && !CONTACT.test(t) ? t : "";
  }
  function fold(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/ß/g, "ss").replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
  }
  function b64(bytes) { var s = ""; bytes.forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64(s) { var b = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(b + "===".slice(0, (4 - b.length % 4) % 4)), function (x) { return x.charCodeAt(0); }); }
  function subtle() { var c = root.crypto; return c && c.subtle ? c.subtle : null; }
  async function keyFor(answer, nonce) {
    var raw = await subtle().importKey("raw", new TextEncoder().encode(fold(answer)), "PBKDF2", false, ["deriveKey"]);
    return subtle().deriveKey({ name: "PBKDF2", salt: nonce, iterations: ITER, hash: "SHA-256" }, raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function lock(obj, answer) {
    var nonce = root.crypto.getRandomValues(new Uint8Array(NONCE)), key = await keyFor(answer, nonce);
    var ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(JSON.stringify(obj)))), out = new Uint8Array(NONCE + ct.length);
    out.set(nonce); out.set(ct, NONCE);
    return b64(out);
  }
  function hintOf(answer) { var a = Array.from(String(answer).trim()); return a.length ? a[0].toUpperCase() + a.length : ""; }

  function cleanDraft(d) {
    var stops = (d && Array.isArray(d.stops) ? d.stops : []).slice(0, MAX_STOPS).map(function (s) { return { q: clean(s && s.q, MAX_Q), a: clean(s && s.a, MAX_A) }; });
    return { stops: stops, end: clean(d && d.end, MAX_Q) };
  }
  function complete(d) {
    var c = cleanDraft(d);
    return !!c.stops.length && !!c.end && c.stops.every(function (s) { return s.q && fold(s.a).length >= 2; });
  }
  // Built from the last riddle backwards: every answer opens exactly the next step and nothing beyond it.
  async function seal(draft) {
    var d = cleanDraft(draft); if (!complete(d)) return null;
    var blobs = [], i;
    for (i = 0; i < d.stops.length; i++) {
      var next = d.stops[i + 1];
      blobs.push(await lock(next ? { q: next.q, h: hintOf(next.a) } : { e: d.end }, d.stops[i].a));
    }
    return { q0: d.stops[0].q, h0: hintOf(d.stops[0].a), c: blobs };
  }
  // A link can be built by hand, so what comes out of it passes the same filter as what goes in.
  async function open(blob, answer) {
    if (typeof blob !== "string" || !BLOB.test(blob)) return null;
    var raw;
    try {
      raw = unb64(blob); var key = await keyFor(answer, raw.slice(0, NONCE));
      raw = JSON.parse(new TextDecoder().decode(await subtle().decrypt({ name: "AES-GCM", iv: raw.slice(0, NONCE) }, key, raw.slice(NONCE))));
    } catch (e) { return null; }
    if (raw && typeof raw.q === "string") { var q = clean(raw.q, MAX_Q); return q ? { q: q, h: typeof raw.h === "string" ? clean(raw.h, 6) : "" } : { blocked: true }; }
    if (raw && typeof raw.e === "string") { var e = clean(raw.e, MAX_Q); return e ? { e: e } : { blocked: true }; }
    return { blocked: true };
  }
  function sanitize(o, d) {
    var c = (Array.isArray(o.c) ? o.c : []).filter(function (b) { return typeof b === "string" && BLOB.test(b); }).slice(0, MAX_STOPS);
    d.q0 = clean(o.q0, MAX_Q); d.h0 = clean(o.h0, 6); d.c = c;
    d.e = typeof o.e === "string" ? C.sanitizeEmoji(o.e) : "🗝️";
    return d;
  }
  function fromIdea(idea, lang, base) {
    var L = idea[lang] || idea.de;
    base.q0 = L.riddles[0]; base.h0 = ""; base.c = []; base.e = idea.quest.e;
    return base;
  }
  var api = { MAX_STOPS: MAX_STOPS, MAX_Q: MAX_Q, MAX_A: MAX_A, clean: clean, fold: fold, seal: seal, open: open, complete: complete, sanitize: sanitize, fromIdea: fromIdea, supported: function () { return !!subtle(); } };
  if (node) module.exports = api; else root.Quest = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
