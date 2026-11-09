/* My Daily Idea: pure logic (no DOM). Runs in Node (tests) and is inlined into dist/index.html. */
(function (root) {
  "use strict";
  var C = typeof module !== "undefined" && module.exports ? require("./core.js") : root.DuellCore;
  var DATA = typeof module !== "undefined" && module.exports ? require("./ideas.json") : root.DuellIdeas;
  var Duel = typeof module !== "undefined" && module.exports ? require("./duel.js") : root.Duel;
  var Quest = typeof module !== "undefined" && module.exports ? require("./quest.js") : root.Quest;
  var Turns = typeof module !== "undefined" && module.exports ? require("./turns.js") : root.Turns;
  var TX = typeof module !== "undefined" && module.exports ? require("./texts.json") : root.DailyTexts;
  var IDEAS = DATA.ideas, GATED = DATA.gated || [], BONUS_EVERY = 6, ORDER_TRIES = 200;
  // In the page the core holds only the catalog's index (scripts/build.js); the part "katalog" brings the full entries and
  // fill() merges them into the same objects, so every list and order built from the index stays valid. In Node: full.
  var FULL = !DATA.index;
  function fill() {
    var F = root.DuellIdeasFull;
    if (FULL || !F) return FULL;
    var by = {};
    (F.ideas || []).concat(F.gated || []).forEach(function (i) { by[i.id] = i; });
    IDEAS.concat(GATED).forEach(function (i) { if (by[i.id]) Object.assign(i, by[i.id]); });
    return (FULL = true);
  }
  fill();   // the part may have run before this file
  var ROUND = IDEAS.filter(function (i) { return !i.on; });   // calendar ideas ("on": "MM-DD" or a list of them) only appear on their days
  var ROUND_KINDS = ROUND.map(function (i) { return i.kind; }).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort();
  var ID_RE = /^[a-z0-9-]{1,32}$/, MAX_WALL = 30, MAX_THUMB = 60000, MAX_TEXT = 90;
  var DAY = 86400000;
  var KINDS = ["game", "photo", "sound", "card", "duel", "quest", "turn", "table"];
  var PLAY = ["arcade"];   // days that are only played (arcade-ui.js), never edited, wished for or sent as a creation
  var STYLES = { card: ["druck", "zettel", "stempel", "neon", "herz", "advent"], photo: ["poster", "sticker", "meme", "glitch"] };
  // Voice effects (the part klang, src/klang.js) and the tempo on top: one effect plus at most one tempo, nothing else.
  var FX = ["chip", "monster", "robot", "echo", "rev", "alien", "tel", "chor"], TEMPO = ["slow", "fast"];
  // Cards merged into one: an old id opens the new card with its variant (old links and walls keep working).
  var MOVED = { "stimme-monster": ["stimme-verzerren", "monster"], "stimme-maus": ["stimme-verzerren", "chip"], "stimme-robo": ["stimme-verzerren", "robot"] };
  var AREAS = ["text", "farbe", "stil", "sticker", "foto", "beat", "stimme", "regeln", "figur", "welt", "idee"];
  var HEX = /^#[0-9a-f]{6}$/;
  var MAX_STICKERS = 8, MAX_TRAIL = 5;

  function dayNumber(date) { return Math.floor((date instanceof Date ? date : new Date()).getTime() / DAY); }
  function byId(id) {
    if (MOVED[id]) id = MOVED[id][0];
    var all = IDEAS.concat(GATED);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  // One shuffled round through all ideas, so nothing repeats before everything has come up once, and never the same kind
  // twice in a row, also across the seam of two rounds: each round's first kind is a pure function of its number, and a
  // round has to end on another kind than the next one starts with.
  function firstKind(round) { return ROUND_KINDS[C.hash32("daily-first-" + round) % ROUND_KINDS.length]; }
  function draftRound(round, attempt) {
    var r = C.mulberry32(C.hash32("daily-round-" + round + "-" + attempt)), mixed = ROUND.slice(), left = {}, out = [], i, j, t;
    for (i = mixed.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = mixed[i]; mixed[i] = mixed[j]; mixed[j] = t; }
    mixed.forEach(function (x) { (left[x.kind] = left[x.kind] || []).push(x); });
    while (out.length < ROUND.length) {
      var rest = ROUND.length - out.length, last = out.length ? out[out.length - 1].kind : "";
      var open = (out.length ? ROUND_KINDS : [firstKind(round)]).filter(function (k) { return k !== last && left[k] && left[k].length; });
      if (!open.length) return null;
      var tight = open.filter(function (k) { return left[k].length * 2 >= rest; });   // now or never: it would run out of gaps
      if (tight.length) open = tight;
      var roll = r() * open.reduce(function (a, k) { return a + left[k].length; }, 0), pick = open[open.length - 1];
      for (i = 0; i < open.length; i++) { roll -= left[open[i]].length; if (roll < 0) { pick = open[i]; break; } }
      out.push(left[pick].pop());
    }
    return out[out.length - 1].kind === firstKind(round + 1) ? null : out;
  }
  var orders = {};
  function roundOrder(round) {
    if (orders[round]) return orders[round];
    for (var a = 0; a < ORDER_TRIES && !orders[round]; a++) orders[round] = draftRound(round, a);
    return orders[round] || (orders[round] = ROUND.slice());   // only if the data itself cannot be spread, see daily.test.js
  }
  // What this device can really do right now. The shells set window.DailyCaps once a channel or a call truly works.
  function caps() {
    var w = root.DailyCaps && typeof root.DailyCaps === "object" ? root.DailyCaps : {};
    return { crypto: w.crypto !== false && Quest.supported(), channel: w.channel === true, call: w.call === true };
  }
  function available(idea, c) {
    c = c || caps();
    return !!idea && (idea.needs || []).every(function (x) { return c[x] === true; });
  }
  function docAvailable(doc, c) {
    c = c || caps();
    if (doc.k === "quest" && !c.crypto) return false;
    if (doc.k === "duel" && doc.m === "deck" && !c.call) return false;
    return !doc.i || available(byId(doc.i), c);
  }
  function baseIdea(n) { var len = ROUND.length; return roundOrder(Math.floor(n / len))[((n % len) + len) % len]; }
  function calendarIdea(n) {
    var md = C.dailyKey(new Date(n * DAY)).slice(5);
    for (var k = 0; k < IDEAS.length; k++) if ([].concat(IDEAS[k].on || []).indexOf(md) >= 0) return IDEAS[k];
    return null;
  }
  // Everyone sees the same day; a device only departs from it where it must. The round already keeps kinds apart, so a
  // day needs a stand-in only if it cannot run here or sits next to a calendar idea of its kind. A stand-in and a bonus
  // from the gated list look at the day shown before and the day planned after, which keeps the rule on every device.
  function ideaOn(n, c) {
    var cal = calendarIdea(n);
    if (cal && available(cal, c)) return cal;
    var base = baseIdea(n), nextCal = calendarIdea(n + 1), prevCal = calendarIdea(n - 1), next = (nextCal || baseIdea(n + 1)).kind;
    var clash = (nextCal && nextCal.kind === base.kind) || (prevCal && prevCal.kind === base.kind);
    var mustMove = !available(base, c) || clash;
    var extra = C.hash32("bonus-" + n) % BONUS_EVERY === 0 ? GATED.filter(function (x) { return available(x, c); }) : [];
    if (!mustMove && !extra.length) return base;
    var prev = ideaOn(n - 1, c).kind;
    var fits = function (x) { return x.kind !== prev && x.kind !== next; };
    var bonus = extra.filter(fits);
    if (bonus.length) return bonus[C.hash32("pick-" + n) % bonus.length];
    if (!mustMove) return base;
    var runnable = ROUND.filter(function (x) { return available(x, c); }), pool = runnable.filter(fits);
    if (!pool.length) pool = runnable;
    return pool.length ? pool[C.hash32("swap-" + n) % pool.length] : null;
  }
  function ideaForDay(date, c) { return ideaOn(dayNumber(date), c || caps()); }
  function dayDate(date, back) { return new Date((dayNumber(date) - (back || 0)) * DAY); }
  function lastDays(date, n) {
    var out = [];
    for (var i = 1; i <= n; i++) { var d = dayDate(date, i); out.push({ date: d, key: C.dailyKey(d), idea: ideaForDay(d) }); }
    return out;
  }
  // ---------- search ----------
  // Case, umlauts and accents do not matter: "Rätsel", "RAETSEL" and "raetsel" are the same word before comparing. A title
  // broken as "Geister-|schicht" reads as one word again.
  function fold(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/-?\|/g, function (m) { return m === "|" ? " " : ""; }).replace(/\u00ad/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  // Title, subtitle, kind and tags in both languages; names maps a kind to its shown words. A new entry in ideas.json is
  // found as soon as it is there, with the day it last came up if that was within the last year.
  // Fill words ("Geschenk für Oma", "game for the class") do not have to appear on the card, unless nothing else is typed.
  var SEARCH_DAYS = 365, MAX_HITS = 30, FILL = " fuer for mit with und and the der die das den dem ein eine einen a an zum zur im in am to of von ";
  function searchIdeas(query, date, names, c) {
    var words = fold(query).split(" ").filter(Boolean), real = words.filter(function (w) { return FILL.indexOf(" " + w + " ") < 0; });
    if (real.length) words = real;
    if (!words.length) return [];
    c = c || caps();
    var hits = IDEAS.concat(GATED).filter(function (i) {
      if (!available(i, c)) return false;
      var parts = [i.kind, i.x || ""].concat(i.tags || [], (names && names[i.kind]) || []);
      ["de", "en"].forEach(function (l) { var L = i[l] || {}; parts = parts.concat(L.t, L.s, L.tags || []); });
      var hay = fold(parts.join(" "));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    if (!hits.length) return [];
    var last = {}, n0 = dayNumber(date);
    for (var b = 1; b <= SEARCH_DAYS; b++) { var x = ideaOn(n0 - b, c); if (x && !last[x.id]) last[x.id] = n0 - b; }
    return hits.map(function (i) { return { idea: i, date: last[i.id] ? new Date(last[i.id] * DAY) : null }; })
      .sort(function (a, b) { return (b.date ? b.date.getTime() : -1) - (a.date ? a.date.getTime() : -1); }).slice(0, MAX_HITS);
  }
  // The core's index of a catalog (scripts/build.js): what the day's sheet and the search need before the part is there;
  // x: the tags of both languages, folded.
  function index(cat) {
    function slim(i) {
      var o = { id: i.id, kind: i.kind };
      ["on", "needs", "min"].forEach(function (k) { if (i[k] != null) o[k] = i[k]; });
      ["de", "en"].forEach(function (l) { if (i[l]) o[l] = { t: i[l].t }; });
      var x = fold([].concat(i.tags || [], (i.de && i.de.tags) || [], (i.en && i.en.tags) || []).join(" ")).split(" ")
        .filter(function (w, k, a) { return w && a.indexOf(w) === k; }).join(" ");
      if (x) o.x = x;
      return o;
    }
    return { index: true, ideas: cat.ideas.map(slim), gated: (cat.gated || []).map(slim) };
  }
  function randomIdea(rnd, notId) {
    var pool = ROUND.concat(GATED).filter(function (i) { return i.id !== notId && available(i); });
    return pool[Math.floor(rnd() * pool.length)];
  }
  function paperIndex(idea, count) { return C.hash32("paper-" + idea.id) % count; }

  // ---------- links ----------
  function sanitizeId(id) { return typeof id === "string" && ID_RE.test(id) && byId(id) ? byId(id).id : null; }
  // An invite to a card; a merged card's old id brings its variant (the effect) along.
  function ideaRoute(i) { var id = sanitizeId(i), r = id ? { type: "idea", id: id } : null; if (r && MOVED[i]) r.fx = MOVED[i][1]; return r; }
  // #i=<id> is the plain invite. {v:1,i:id} or {v:1,d:doc} inside #c= pass through hosts that only forward c=.
  function parseRoute(hash) {
    if (typeof hash !== "string") return null;
    var s = hash.replace(/^#/, ""), m = s.match(/(?:^|&)i=([^&]*)/);
    if (m) return ideaRoute(m[1]);
    var sh = s.match(/^s=([2-9a-km-np-zA-HJ-NP-Z]{8})$/);        // short link opened in an app shell, see shortlink.js
    if (sh) return { type: "short", id: sh[1] };
    var c = s.match(/(?:^|&)c=([^&]*)/);
    if (!c) return null;
    try {
      if (c[1].length <= C.MAX_FRAGMENT && /^[A-Za-z0-9_-]+$/.test(c[1])) {
        var raw = JSON.parse(fromB64(c[1]));
        if (raw && raw.v === 1 && raw.d !== undefined) { var doc = sanitizeDoc(raw.d); return doc ? { type: "doc", doc: doc } : null; }
        if (raw && raw.v === 1 && raw.i !== undefined) return ideaRoute(raw.i);
      }
    } catch (e) { return null; }
    var st = C.decodeState(c[1]);
    return st ? { type: "challenge", state: st } : null;
  }
  function toB64(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/"), bin = atob(b + "===".slice(0, (4 - b.length % 4) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, function (x) { return x.charCodeAt(0); }));
  }
  function inviteUrl(id, viaHost) {
    if (!sanitizeId(id)) throw new Error("unknown idea");
    if (!viaHost) return C.SHARE_BASE + "#i=" + id;
    return C.SHARE_BASE + "#c=" + toB64(JSON.stringify({ v: 1, i: id }));
  }
  // Challenge links never carry a name any more; old links with one still open.
  function challengeUrl(state, score) {
    var st = Object.assign({}, state);
    delete st.name;
    st.score = score;
    return C.buildUrl(st);
  }

  // ---------- user text ----------
  function cleanInput(s, max) {
    var t = Array.from(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max || MAX_TEXT).join("").trim();
    return t && C.isClean(t) ? t : "";
  }

  // ---------- my style (local only) ----------
  function sanitizeColors(c, def) {
    return Array.isArray(c) && c.length === 2 && HEX.test(c[0]) && HEX.test(c[1]) ? [c[0], c[1]] : def;
  }
  var SETS = {
    tiere: ["🐸", "🦆", "🐙", "🦝", "🐌", "🦖"], essen: ["🍕", "🌮", "🍩", "🥨", "🍟", "🧃"],
    weltall: ["🚀", "🛸", "👽", "🪐", "🌟", "☄️"], chaos: ["💥", "🔥", "💀", "🤡", "🌀", "⚡"],
    grusel: ["🎃", "👻", "🦇", "🕷️", "🧛", "🕸️"], herz: ["💛", "🌻", "✨", "🫶", "🌈", "☀️"],
    advent: ["🎄", "⭐", "🎁", "❄️", "⛄", "🍪"]
  };
  function sanitizeProfile(p) {
    p = p && typeof p === "object" ? p : {};
    var o = {
      nick: C.sanitizeName(p.nick) , emoji: typeof p.emoji === "string" ? C.sanitizeEmoji(p.emoji) : "🐸",
      colors: sanitizeColors(p.colors, ["#ffd400", "#ff3b1d"]), set: SETS[p.set] ? p.set : "tiere"
    }, f = sanitizePref(p.pref);
    if (Object.keys(f).length) o.pref = f;
    return o;
  }

  // ---------- my defaults (local only): visible chips the person can drop one by one ----------
  // age: a band the person picks (never a birth date); hh: household size; diet: only asked from 16 (only kept when the
  // age band allows it); no: times without time; pp: own PayPal.me name, only 18+. Nothing of it travels in a link.
  // An adult build (business flavor) is 18+ by its terms, so it never asks the age.
  var AGES = ["u16", "u18", "a18"], DIETS = ["veg", "vegan"], NOTIMES = ["frueh", "tag", "abend", "sa", "so"], PPME = /^[A-Za-z0-9]{1,20}$/;
  function flavorAdult() { return !!(root.DailyFlavor && root.DailyFlavor.adult === true); }
  function adult(p) { var f = p && p.pref; return flavorAdult() || (!!f && f.age === "a18"); }
  function dietOk(p) { var f = p && p.pref; return flavorAdult() || (!!f && (f.age === "u18" || f.age === "a18")); }
  function sanitizePref(f) {
    f = f && typeof f === "object" && !Array.isArray(f) ? f : {};
    var o = {};
    if (AGES.indexOf(f.age) >= 0 && !flavorAdult()) o.age = f.age;
    if (Number.isInteger(f.hh) && f.hh >= 1 && f.hh <= 6) o.hh = f.hh;
    if (DIETS.indexOf(f.diet) >= 0 && dietOk({ pref: o })) o.diet = f.diet;
    var no = NOTIMES.filter(function (k) { return Array.isArray(f.no) && f.no.indexOf(k) >= 0; }); if (no.length) o.no = no;
    if (typeof f.pp === "string" && PPME.test(f.pp) && adult({ pref: o })) o.pp = f.pp;
    return o;
  }
  function tx(lang, k, v) { var s = (TX[lang] || TX.de)[k] || TX.de[k] || k; return s.replace(/\{(\w+)\}/g, function (m, x) { return v && v[x] != null ? v[x] : m; }); }
  // The chips on screen: [{ k, v, l }], in a fixed order. dropPref removes one and checks the rest again.
  function prefChips(p, lang) {
    var f = (p && p.pref) || {}, out = [];
    if (f.age) out.push({ k: "age", v: f.age, l: tx(lang, "pf_age") + " " + tx(lang, "pf_age_" + f.age) });
    if (f.hh) out.push({ k: "hh", v: f.hh, l: tx(lang, "pf_hh_n", { n: f.hh === 6 ? "6+" : f.hh }) });
    if (f.diet) out.push({ k: "diet", v: f.diet, l: tx(lang, "pf_diet_" + f.diet) });
    (f.no || []).forEach(function (k) { out.push({ k: "no", v: k, l: tx(lang, "pf_no") + " " + tx(lang, "pf_no_" + k) }); });
    if (f.pp) out.push({ k: "pp", v: f.pp, l: "paypal.me/" + f.pp });
    return out;
  }
  function dropPref(p, k, v) {
    var f = JSON.parse(JSON.stringify((p && p.pref) || {}));
    if (k === "no") f.no = (f.no || []).filter(function (x) { return x !== v; }); else delete f[k];
    return sanitizePref(f);
  }
  // What an AI feature may add to its prompt (about 60 tokens at most): household, food, times without time - only the
  // parts asked for, in the page's language. Never the age band, never the PayPal name, never a name.
  function prefContext(p, lang, keys) {
    var f = (p && p.pref) || {}, want = function (k) { return !keys || keys.indexOf(k) >= 0; }, out = [];
    if (want("hh") && f.hh) out.push(tx(lang, "pf_ctx_hh", { n: f.hh === 6 ? "6+" : f.hh }));
    if (want("diet") && f.diet) out.push(tx(lang, "pf_diet_" + f.diet));
    if (want("no") && f.no) out.push(tx(lang, "pf_ctx_no", { s: f.no.map(function (k) { return tx(lang, "pf_no_" + k); }).join(", ") }));
    return out.join("; ");
  }

  // ---------- creation ("doc"): what the editor changes and what travels in a link ----------
  function num(v, r, d) { return Math.round(C.clampNum(v, r[0], r[1], d)); }
  function txt(v, max) { return cleanInput(v, max); }
  // An Advent door carries its number 1-24. Before December and after the 24th the door to make is the first one.
  function doorNumber(date) { var d = date instanceof Date ? date : new Date(); return d.getUTCMonth() === 11 && d.getUTCDate() <= 24 ? d.getUTCDate() : 1; }
  function steps(v) { return typeof v === "string" && /^[x-]{16}$/.test(v) ? v : "----------------"; }
  function sanitizeStickers(a) {
    return (Array.isArray(a) ? a : []).slice(0, MAX_STICKERS).map(function (s) {
      var f = function (v, a, b, d) { return Math.round(C.clampNum(v, a, b, d) * 1000) / 1000; };
      return s && typeof s === "object" ? { e: C.sanitizeEmoji(s.e), x: f(s.x, 0, 1, 0.5), y: f(s.y, 0, 1, 0.5), r: f(s.r, -3.14, 3.14, 0), z: f(s.z, 0.5, 2.5, 1) } : null;
    }).filter(Boolean);
  }
  // Weather strip: figures from the weather service only; no wish and no model can set it. The card always names the source.
  function sanitizeWeather(o) {
    if (!o || typeof o !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(o.d)) return null;
    var p = txt(o.p, 32), hi = C.clampNum(o.hi, -60, 60, NaN), lo = C.clampNum(o.lo, -60, 60, NaN);
    if (!p || isNaN(hi) || isNaN(lo)) return null;
    return { p: p, d: o.d, hi: Math.round(hi), lo: Math.round(lo), rn: Math.round(C.clampNum(o.rn, 0, 100, 0)), c: Math.round(C.clampNum(o.c, 0, 99, 0)) };
  }
  function sanitizeTrail(a) {
    return (Array.isArray(a) ? a : []).map(function (e) {
      if (!e || typeof e !== "object") return null;
      var w = (Array.isArray(e.w) ? e.w : []).filter(function (x) { return AREAS.indexOf(x) >= 0; }).slice(0, AREAS.length);
      return w.length ? { n: C.sanitizeName(e.n), w: w } : null;
    }).filter(Boolean).slice(-MAX_TRAIL);
  }
  // KI seal: which AI action made (part of) this sheet, and the server's signature over it when it sent one. The sheet
  // shows "KI" and a report button for it; the page never checks the signature, the server does when a report comes in.
  function sanitizeKi(o) {
    if (!o || typeof o !== "object" || typeof o.k !== "string" || !/^[a-z]{2,12}$/.test(o.k)) return null;
    var r = { k: o.k };
    if (typeof o.s === "string" && /^[A-Za-z0-9._~-]{8,200}$/.test(o.s)) r.s = o.s;
    // h: base64url SHA-256 of the option the seal was made for (Ai.optionHash), only next to a seal. Sheets without it stay valid.
    if (r.s && typeof o.h === "string" && /^[A-Za-z0-9_-]{43}$/.test(o.h)) r.h = o.h;
    // o: the creator tag of a free card (CADS-DEMO-wrapper lib/duell-deck.mjs), an HMAC that names nobody; only next to a seal
    if (r.s && typeof o.o === "string" && /^[A-Za-z0-9_-]{22}$/.test(o.o)) r.o = o.o;
    return r;
  }
  function sanitizeDoc(o) {
    if (!o || typeof o !== "object" || KINDS.indexOf(o.k) < 0) return null;
    var d = { k: o.k, col: sanitizeColors(o.col, ["#ffd400", "#ff3b1d"]), by: sanitizeTrail(o.by) };
    var id = sanitizeId(o.i); if (id) d.i = id;
    var t = txt(o.t, 40), s = txt(o.s, 70), n = C.sanitizeName(o.n);
    if (t) d.t = t; if (s) d.s = s; if (n) d.n = n;    // t/s: an own idea of the day, n: who made it
    var ki = sanitizeKi(o.ki); if (ki) d.ki = ki;
    // remix of a free card: its id (part deck)
    if (typeof o.fr === "string" && /^[A-Za-z0-9_-]{22}$/.test(o.fr)) d.fr = o.fr;
    if (o.k === "card") {
      d.x = txt(o.x, MAX_TEXT); d.st = STYLES.card.indexOf(o.st) >= 0 ? o.st : "druck"; d.sk = sanitizeStickers(o.sk);
      var w = sanitizeWeather(o.w); if (w) d.w = w;
      if (o.nr !== undefined) d.nr = num(o.nr, [1, 24], 1);
    } else if (o.k === "photo") {
      d.x = txt(o.x, 28); d.y = txt(o.y, 28); d.st = STYLES.photo.indexOf(o.st) >= 0 ? o.st : "poster"; d.sk = sanitizeStickers(o.sk);
    } else if (o.k === "sound") {
      d.m = o.m === "voice" ? "voice" : "beat"; d.x = txt(o.x, 28); d.fx = FX.indexOf(o.fx) >= 0 ? o.fx : "chip"; if (TEMPO.indexOf(o.tp) >= 0) d.tp = o.tp; d.bpm = num(o.bpm, [70, 170], 110);
      d.p = { k: steps(o.p && o.p.k), s: steps(o.p && o.p.s), h: steps(o.p && o.p.h), b: steps(o.p && o.p.b) };
      // ly: a song's hook (texte.js), 2 to 4 lines that the sheet shows in time with the beat
      var ly = Array.isArray(o.ly) ? o.ly.slice(0, 4).map(function (l) { return typeof l === "string" ? txt(l, 60) : ""; }).filter(Boolean) : [];
      if (ly.length) d.ly = ly;
    } else if (o.k === "duel") {
      Duel.sanitize(o, d);
    } else if (o.k === "quest") {
      Quest.sanitize(o, d);
    } else if (o.k === "turn") {
      Turns.sanitize(o, d);
    } else if (o.k === "table") {
      d.g = o.g === "skat" || o.g === "bauernskat" ? o.g : "doko";
    } else {
      var g = C.sanitizeState({ v: 1, seed: o.g && o.g.seed, params: o.g && o.g.params, theme: o.g && o.g.theme, title: o.g && o.g.title, emoji: o.g && o.g.emoji, look: o.g && o.g.look, route: o.g && o.g.route });
      d.g = { seed: g.seed, params: g.params, theme: g.theme, title: g.title, emoji: g.emoji };
      if (g.look) d.g.look = g.look;
      if (g.route) d.g.route = g.route;
    }
    return d;
  }
  // A title as one line: "|" marks the break on the sheet. "Tür-|steher" joins to "Türsteher", "Winter-|Tunnel" keeps its hyphen.
  // The bot face's seed: the name, the sheet and which face it is (0 first, then each tap), never the clock or Math.random.
  function botSeed(nick, doc, n) { return C.hash32("bot|" + nick + "|" + (doc.i || doc.k) + "|" + n); }
  function plainTitle(s) { return String(s || "").replace(/-\|(\p{Ll})/gu, "$1").replace(/-\|/g, "-").replace(/\|/g, " ").trim(); }
  function docFromIdea(idea, profile, lang, fx) {
    // Without the catalog part (a broken bundle) the day still shows: its title as a plain card.
    if (!FULL) return sanitizeDoc({ k: "card", i: idea.id, col: profile.colors, by: [], x: plainTitle((idea[lang] || idea.de).t), st: "druck", sk: [] });
    var L = idea[lang] || idea.de, plain = plainTitle(L.t), base = { k: idea.kind, i: idea.id, col: profile.colors, by: [] };
    if (idea.kind === "card") { base.x = L.lines[0]; base.st = idea.style || "druck"; base.sk = []; if (idea.col) base.col = idea.col; if (idea.door) base.nr = doorNumber(); }
    if (idea.kind === "photo") { base.x = L.top; base.y = L.bottom; base.st = idea.photo.mode; base.sk = []; }
    if (idea.kind === "sound") { var s = idea.sound; base.m = s.mode; base.x = plain.slice(0, 28); base.fx = fx || s.fx || "chip"; base.bpm = s.bpm || 110; base.p = { k: s.k || "x---x---x---x---", s: s.s || "----x-------x---", h: s.h || "x-x-x-x-x-x-x-x-", b: s.b || "----------------" }; }
    if (idea.kind === "game") { var g = idea.game; base.g = { seed: g.seed, params: g.params, theme: g.theme, title: plain, emoji: g.emoji, look: g.look }; }
    if (idea.kind === "duel") Duel.fromIdea(idea, profile, lang, base);
    if (idea.kind === "quest") Quest.fromIdea(idea, lang, base);
    if (idea.kind === "turn") Turns.fromIdea(idea, lang, base);
    if (idea.kind === "table") base.g = idea.table.game;
    // Played in arcade-ui.js, never edited or sent: no link ever carries such a doc, so sanitizeDoc keeps refusing it.
    if (idea.kind === "arcade") { base.a = idea.arcade.g; return base; }
    return sanitizeDoc(base);
  }
  // A card that still says a catalog line, sent in one language, reads in the viewer's: the same line of that idea in
  // the other language, with the name in front kept ("Lea, ich wollte ..." -> "Lea, I just wanted ..."). Text the sender
  // wrote or changed stays as it was sent.
  function localDoc(doc, lang) {
    var idea = doc && doc.k === "card" && typeof doc.x === "string" && doc.i ? byId(doc.i) : null, to = idea && idea[lang];
    if (!to || !to.lines) return doc;
    function rest(l) { return /^I\b/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1); }
    for (var k in idea) {
      var L = idea[k]; if (k === lang || !L || !Array.isArray(L.lines)) continue;
      for (var j = 0; j < L.lines.length; j++) {
        var line = L.lines[j], nl = to.lines[j]; if (!line || !nl) continue;
        var x = null;
        if (doc.x === line) x = nl;
        else if (idea.warm && doc.x.slice(-rest(line).length - 2) === ", " + rest(line)) {
          // Only the name a feel-good card puts in front (warm.js named): one plain first name, nothing the sender wrote.
          var who = doc.x.slice(0, -rest(line).length - 2);
          if (who.length <= 14 && /^[\p{L}][\p{L} .'-]*$/u.test(who) && cleanInput(who, 14) === who) x = who + ", " + rest(nl);
        }
        // Too long or filtered in the other language: the card stays as it was sent, never cut off.
        if (x != null) return cleanInput(x, 90) === x ? Object.assign({}, doc, { x: x }) : doc;
      }
    }
    return doc;
  }
  function blankDoc(kind, profile, lang) {
    var pool = IDEAS.filter(function (i) { return i.kind === kind; }), d = docFromIdea(pool[0], profile, lang);
    delete d.i; d.t = ""; return d;
  }
  // Which parts differ, in the words the trail shows. The picture itself is never in the doc, so "foto" comes from the editor.
  function changedAreas(a, b) {
    var w = [];
    function ne(x, y) { return JSON.stringify(x) !== JSON.stringify(y); }
    if (a.x !== b.x || a.y !== b.y || a.nr !== b.nr || ne(a.w, b.w) || ne(a.ly, b.ly)) w.push("text");
    if (ne(a.col, b.col)) w.push("farbe");
    if (a.st !== b.st) w.push("stil");
    if (ne(a.sk, b.sk)) w.push("sticker");
    if (ne(a.p, b.p) || a.bpm !== b.bpm) w.push("beat");
    if (a.fx !== b.fx || a.tp !== b.tp) w.push("stimme");
    if (a.t !== b.t || a.s !== b.s) w.push("idee");
    if (a.e !== b.e || a.f !== b.f) w.push("figur");
    if (ne(a.a, b.a) || ne(a.b, b.b) || a.w !== b.w || a.q !== b.q) w.push("regeln");
    if (a.g && b.g) {
      if (ne(a.g.params, b.g.params)) w.push("regeln");
      if (a.g.emoji !== b.g.emoji) w.push("figur");
      if (a.g.theme !== b.g.theme || ne(a.g.look, b.g.look) || ne(a.g.route, b.g.route)) w.push("welt");
      if (a.g.title !== b.g.title) w.push("text");
    }
    return w;
  }
  function withTrail(doc, nick, areas) {
    var d = sanitizeDoc(doc);
    if (areas.length) d.by = sanitizeTrail(d.by.concat([{ n: nick, w: areas }]));
    return d;
  }
  /* Never over the size the page itself accepts. Stickers give way first, then the option hash h (without it a seal
     that is checked against the option's hash can no longer be checked; the seal itself stays), then the oldest trail. */
  function docUrl(doc) {
    var d = sanitizeDoc(doc), enc = function () { return toB64(JSON.stringify({ v: 1, d: d })); }, over = function () { return enc().length > C.MAX_FRAGMENT; };
    // a free card (ki.k "karte") is known to the deck only by its hash h: there h goes last, after the trail, s and t
    var late = d.ki && d.ki.k === "karte";
    while (over() && d.sk && d.sk.length) d.sk.pop();
    if (!late && over() && d.ki) delete d.ki.h;
    while (over() && d.by.length) d.by.shift();
    if (over()) delete d.s;
    if (over()) delete d.t;
    // the id stays as doc.fr (part deck)
    if (over() && d.ki) { if (late && d.ki.h && !d.fr) d.fr = d.ki.h.slice(0, 22); delete d.ki.h; }
    return C.SHARE_BASE + "#c=" + enc();
  }

  // ---------- wall ----------
  function sanitizeWall(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (e) {
      return e && typeof e === "object" && (sanitizeId(e.id) || e.id === "own") && typeof e.ts === "number" &&
        typeof e.th === "string" && e.th.length <= MAX_THUMB && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(e.th);
    }).slice(0, MAX_WALL).map(function (e) {
      var o = { id: e.id, ts: e.ts, th: e.th };   // f: the link of a work kept with Merken, only a c= fragment
      if (typeof e.f === "string" && e.f.length <= C.MAX_FRAGMENT && /^c=[A-Za-z0-9_-]+={0,2}$/.test(e.f)) o.f = e.f;
      if (typeof e.k === "string" && /^[a-z]{1,12}$/.test(e.k)) o.k = e.k;   // k: what was made; "photo" never leaves the device (profile.js)
      return o;
    });
  }
  function addToWall(list, entry) { return sanitizeWall([entry].concat(list)); }

  // Every text a person can read in an idea, for the content check.
  function ideaStrings(idea) {
    var out = [];
    (function walk(v, key) {
      if (typeof v === "string") { if (["id", "kind", "mode", "fx", "theme", "k", "s", "h", "b", "emoji"].indexOf(key) < 0 || /[A-Z ]/.test(v)) out.push(v); }
      else if (Array.isArray(v)) v.forEach(function (x) { walk(x, key); });
      else if (v && typeof v === "object") Object.keys(v).forEach(function (k) { walk(v[k], k); });
    })(idea, "");
    return out;
  }

  var api = {
    IDEAS: IDEAS, plainTitle: plainTitle, fill: fill, index: index, full: function () { return FULL; }, ROUND: ROUND, GATED: GATED, roundOrder: roundOrder, KINDS: KINDS, PLAY: PLAY, caps: caps, available: available, docAvailable: docAvailable, MAX_WALL: MAX_WALL, byId: byId, localDoc: localDoc, dayNumber: dayNumber, ideaForDay: ideaForDay, dayDate: dayDate, lastDays: lastDays, fold: fold, searchIdeas: searchIdeas,
    randomIdea: randomIdea, paperIndex: paperIndex, sanitizeId: sanitizeId, parseRoute: parseRoute, botSeed: botSeed, fromB64: fromB64, inviteUrl: inviteUrl, challengeUrl: challengeUrl,
    cleanInput: cleanInput, sanitizeProfile: sanitizeProfile, sanitizePref: sanitizePref, prefChips: prefChips, dropPref: dropPref, prefContext: prefContext, adult: adult, dietOk: dietOk, PREF: { AGES: AGES, DIETS: DIETS, NOTIMES: NOTIMES }, sanitizeDoc: sanitizeDoc, sanitizeKi: sanitizeKi, doorNumber: doorNumber, docFromIdea: docFromIdea, blankDoc: blankDoc,
    changedAreas: changedAreas, withTrail: withTrail, docUrl: docUrl, SETS: SETS, STYLES: STYLES, FX: FX, TEMPO: TEMPO, MOVED: MOVED, AREAS: AREAS, MAX_STICKERS: MAX_STICKERS, sanitizeWall: sanitizeWall, addToWall: addToWall, ideaStrings: ideaStrings
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Daily = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
