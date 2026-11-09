/* Duell core: pure logic (no DOM). Runs in Node (tests) and is inlined into dist/index.html. */
(function (root) {
  "use strict";

  var SHARE_BASE = (root.DailyFlavor && root.DailyFlavor.shareBase) || "https://bunsenbrenner.org/duell";   // a flavor build is shared under its own path
  var SHORT_BASE = "https://bunsenbrenner.org/s/";
  var DEFAULT_API = "https://demos-34a13a96.bunsenbrenner.org/api/duell/config";
  var MAX_FRAGMENT = 1200;       // hard cap on the encoded payload we are willing to parse
  var MAX_NAME = 16, MAX_TITLE = 28, MAX_PROMPT = 80, MAX_SCORE = 9999;

  var RANGES = {
    gravity: [900, 2600, 1800],
    jump: [280, 620, 430],
    gap: [90, 200, 140],
    speed: [90, 260, 130]
  };
  var ALIAS = { jump: "flapPower", gap: "pipeGap", speed: "pipeSpeed" };
  var THEME_NAMES = ["day", "night", "sunset", "retro", "candy", "neon", "ocean", "lava"];
  var DEFAULT_EMOJI = "🪁";

  // ---------- numbers / sanitizing ----------
  function clampNum(v, min, max, def) {
    if (typeof v === "string" && v.trim() !== "") v = Number(v);
    if (typeof v !== "number" || !isFinite(v)) return def;
    return Math.min(max, Math.max(min, v));
  }
  function sanitizeParams(p) {
    var out = {};
    p = p && typeof p === "object" ? p : {};
    Object.keys(RANGES).forEach(function (k) {
      var r = RANGES[k], v = p[k];
      if (v === undefined && ALIAS[k]) v = p[ALIAS[k]];   // API names: flapPower, pipeGap, pipeSpeed
      out[k] = Math.round(clampNum(v, r[0], r[1], r[2]));
    });
    return out;
  }
  function sanitizeTheme(t) {
    return typeof t === "string" && THEME_NAMES.indexOf(t) >= 0 ? t : "day";
  }
  function sanitizeSeed(s) {
    var n = clampNum(s, 0, 4294967295, 1);
    return Math.floor(n) >>> 0;
  }

  // ---------- word filter (de/en) ----------
  // Long stems match as substrings, short/ambiguous words only as whole words.
  var STEMS = [
    "fuck", "shit", "bitch", "asshole", "nigger", "nigga", "faggot", "whore", "slut", "rapist", "hitler", "nazi",
    "scheiss", "arschloch", "fotze", "hurensohn", "wichser", "ficken", "schlampe", "missgeburt", "vergewaltig", "kanake", "behindert", "neger", "mongo", "judensau", "kinderfick", "pornhub"
  ];
  var WORDS = ["cunt", "pedo", "dick", "cock", "porn", "rape", "fag", "fick", "nutte", "hure", "spast", "kkk", "isis", "nsdap"];
  var BANNED_WORDS = WORDS;
  var LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "+": "t" };

  function foldText(s) {
    s = String(s == null ? "" : s).toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* old engine */ }
    s = s.replace(/ß/g, "ss");
    return s;
  }
  // Words are not enough: these sentences are clean word by word and still hurt.
  var HURT = /\b(du|ihr)\s+(bist|seid)\s+((so|voll|echt|total|richtig|einfach)\s+)*(h(ä|ae)sslich|fett|dumm|bl(ö|oe)d|peinlich|eklig|wertlos|nichts|ein\s+opfer|ein\s+loser)|(niemand|keiner)\s+mag\s+(dich|euch)|lachen\s+(alle\s+)?(ü|ue)ber\s+(dich|euch)|hasse\s+dich|geh\s+sterben|bring\s+dich\s+um|solltest\s+(sterben|verschwinden)|\byou\s+are\s+((so|really|just)\s+)*(ugly|fat|stupid|worthless|nothing|a\s+loser)|\byou'?re\s+((so|really|just)\s+)*(ugly|fat|stupid|worthless|nothing|a\s+loser)|nobody\s+likes\s+you|laugh(s|ing)?\s+at\s+you\b|i\s+hate\s+you|kill\s+yourself/;
  function isClean(input) {
    if (HURT.test(String(input == null ? "" : input).toLowerCase().replace(/\s+/g, " "))) return false;
    var base = foldText(input);
    var leet = base.replace(/[0134578@$!+]/g, function (c) { return LEET[c] || c; });
    var variants = [base, leet];
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var joined = v.replace(/[^a-z]/g, "");            // "f u c k", "f.u.c.k"
      var squeezed = joined.replace(/(.)\1+/g, "$1");   // "fuuuck"
      for (var j = 0; j < STEMS.length; j++) {
        var stem = STEMS[j];
        if (joined.indexOf(stem) >= 0 || squeezed.indexOf(stem.replace(/(.)\1+/g, "$1")) >= 0) return false;
      }
      var tokens = v.split(/[^a-z]+/);
      for (var t = 0; t < tokens.length; t++) {
        if (tokens[t] && BANNED_WORDS.indexOf(tokens[t]) >= 0) return false;
      }
    }
    return true;
  }

  // ---------- text sanitizing ----------
  function cpSlice(s, max) { return Array.from(s).slice(0, max).join(""); }
  function stripText(s) {
    s = String(s == null ? "" : s);
    // keep letters, digits, space, a few punctuation marks and emoji; drop control, bidi, markup characters
    s = s.replace(/[^\p{L}\p{N}\p{Extended_Pictographic}‍️ _\-.!?'’:,&+#]/gu, "");
    return s.replace(/\s+/g, " ").trim();
  }
  function sanitizeName(s) {
    var n = cpSlice(stripText(s), MAX_NAME).trim();
    return n && isClean(n) ? n : "";
  }
  function sanitizeTitle(s, fallback) {
    var t = cpSlice(stripText(s), MAX_TITLE).trim();
    return t && isClean(t) ? t : (fallback || "Duell");
  }
  var EMOJI_RE = /^\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*/u;
  function sanitizeEmoji(s) {
    if (typeof s !== "string") return DEFAULT_EMOJI;
    var m = s.trim().match(EMOJI_RE);
    return m && m[0].length <= 12 ? m[0] : DEFAULT_EMOJI;
  }
  function sanitizePrompt(s) {
    return cpSlice(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim(), MAX_PROMPT);
  }

  // Optional look of a game made from a card: two colours and one line, nothing that could carry a picture.
  function sanitizeSkin(o) {
    if (!o || typeof o !== "object" || !Array.isArray(o.c) || o.c.length !== 2 || !o.c.every(function (x) { return typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x); })) return null;
    var skin = { c: [o.c[0], o.c[1]] }, l = cpSlice(stripText(o.l), 60).trim();
    if (l && isClean(l)) skin.l = l;
    return skin;
  }

  // Own look of a game: a frame around the game, never its mechanics. a,b sky; d motif; e drifting emoji; p,q obstacle
  // fill and edge; f its form; o its emoji; g,h ground and edge; m trail emoji. Hitboxes and physics stay the same for all.
  var DECOS = ["stars", "bubbles", "clouds", "snow", "rain", "none"], FORMS = ["tube", "block", "round", "emoji"];
  function hex(v) { return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : ""; }
  function emo(v) { var m = typeof v === "string" && v.trim().match(EMOJI_RE); return m && m[0].length <= 12 ? m[0] : ""; }
  function light(c) { var n = parseInt(c.slice(1), 16); return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; }
  function sanitizeLook(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    var l = {};
    ["a", "b", "p", "q", "g", "h"].forEach(function (k) { var c = hex(o[k]); if (c) l[k] = c; });
    if (DECOS.indexOf(o.d) >= 0) l.d = o.d;
    if (FORMS.indexOf(o.f) >= 0) l.f = o.f;
    var e = (Array.isArray(o.e) ? o.e : []).map(emo).filter(Boolean).slice(0, 3); if (e.length) l.e = e;
    var ob = emo(o.o), m = emo(o.m); if (ob) l.o = ob; if (m) l.m = m;
    if (l.f === "emoji" && !l.o) delete l.f;
    if (l.a && l.p) {                                  // an obstacle that melts into the sky cannot be played
      var sky = (light(l.a) + light(l.b || l.a)) / 2;
      if (Math.abs(sky - light(l.p)) < 0.18) l.p = sky > 0.5 ? "#1f1f2e" : "#f2f2f2";
    }
    return Object.keys(l).length ? l : null;
  }

  // A route: exactly 3 sections from start to end (the welt kind). Each one moves the physics by a fixed step d (the
  // server's table, never a number the model chose), shows its own world t and drifting emoji e; p names the step.
  // The page clamps base + d to RANGES, so no section can leave the playable range.
  var STEPS = ["normal", "ruhig", "schnell", "eng", "schwebend", "schwer", "sturm"], SECTIONS = 3;
  var DELTA_MAX = { gravity: 800, jump: 120, gap: 60, speed: 80 };
  function sanitizeRoute(r) {
    if (!Array.isArray(r) || r.length !== SECTIONS) return null;
    var out = r.map(function (a) {
      if (!a || typeof a !== "object") return null;
      var d = {}, src = a.d || a.delta || {};
      Object.keys(DELTA_MAX).forEach(function (k) {
        var v = src[k] !== undefined ? src[k] : src[ALIAS[k]];
        v = Math.round(clampNum(v, -DELTA_MAX[k], DELTA_MAX[k], 0)); if (v) d[k] = v;
      });
      var t = a.t || a.thema, e = emo(a.e || a.emoji);
      if (typeof t !== "string" || THEME_NAMES.indexOf(t) < 0 || !e) return null;
      return { p: STEPS.indexOf(a.p || a.physik) >= 0 ? a.p || a.physik : "normal", d: d, t: t, e: e };
    });
    return out.every(Boolean) ? out : null;
  }
  // The physics of section i: base + its step, clamped to RANGES.
  function sectionParams(params, route, i) {
    var d = route && route[i] ? route[i].d : {}, p = {};
    Object.keys(RANGES).forEach(function (k) { p[k] = params[k] + (d[k] || 0); });
    return sanitizeParams(p);
  }
  function routeParams(st) { return st && st.route ? st.route.map(function (x, i) { return sectionParams(st.params, st.route, i); }) : null; }
  // The AI mark of a world: kind, seal and option hash, the same form as a sheet's ki (daily.js sanitizeKi).
  function sanitizeKiMark(o) {
    // welt: a world the AI built; karte: a game card the free card made (the badge in the game says so, AI Act Art. 50)
    if (!o || typeof o !== "object" || (o.k !== "welt" && o.k !== "karte")) return null;
    var r = { k: o.k };
    if (typeof o.s === "string" && /^[A-Za-z0-9._~-]{8,200}$/.test(o.s)) r.s = o.s; else return null;
    if (typeof o.h === "string" && /^[A-Za-z0-9_-]{43}$/.test(o.h)) r.h = o.h;
    return r;
  }

  // ---------- state (the shared contract) ----------
  function sanitizeState(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (o.v !== 1) return null;
    var st = {
      v: 1,
      seed: sanitizeSeed(o.seed),
      params: sanitizeParams(o.params),
      theme: sanitizeTheme(o.theme),
      title: sanitizeTitle(o.title),
      emoji: sanitizeEmoji(o.emoji)
    };
    var skin = sanitizeSkin(o.skin);
    if (skin) st.skin = skin;
    var lk = sanitizeLook(o.look);
    if (lk) st.look = lk;
    var rt = sanitizeRoute(o.route);
    if (rt) st.route = rt;
    var ki = sanitizeKiMark(o.ki);
    if (ki) st.ki = ki;
    if (o.score !== undefined && o.score !== null) {
      var sc = clampNum(o.score, 0, MAX_SCORE, NaN);
      if (!isNaN(sc)) st.score = Math.floor(sc);
    }
    if (o.name !== undefined && o.name !== null) {
      var nm = sanitizeName(o.name);
      if (nm) st.name = nm;
    }
    return st;
  }
  function toB64url(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64url(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad charset");
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  function encodeState(state) {
    var st = sanitizeState(state);
    if (!st) throw new Error("invalid state");
    return toB64url(JSON.stringify(st));
  }
  function decodeState(str) {
    try {
      if (typeof str !== "string" || str.length === 0 || str.length > MAX_FRAGMENT) return null;
      return sanitizeState(JSON.parse(fromB64url(str)));
    } catch (e) { return null; }
  }
  function parseHash(hash) {
    if (typeof hash !== "string") return null;
    var m = hash.replace(/^#/, "").match(/(?:^|&)c=([^&]*)/);
    return m ? decodeState(m[1]) : null;
  }
  function buildUrl(state, base) {
    return (base || SHARE_BASE) + "#c=" + encodeState(state);
  }
  function configKey(st) {
    var p = st.params;
    return [st.seed, p.gravity, p.jump, p.gap, p.speed, st.theme].join(".") + (st.route ? "." + hash32(JSON.stringify(st.route)) : "");
  }

  // ---------- seeds ----------
  function hash32(str) {            // FNV-1a
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailyKey(date) {         // UTC date, no server needed
    var d = date instanceof Date ? date : new Date();
    return d.toISOString().slice(0, 10);
  }
  function dailySeed(date) { return hash32("duell-daily-" + dailyKey(date)); }
  function dailyConfig(date, lang) {
    var key = dailyKey(date), seed = dailySeed(date), r = mulberry32(seed);
    var params = sanitizeParams({
      gravity: 1700 + Math.floor(r() * 300),
      jump: 420 + Math.floor(r() * 30),
      gap: 128 + Math.floor(r() * 24),
      speed: 125 + Math.floor(r() * 30)
    });
    var theme = THEME_NAMES[Math.floor(r() * THEME_NAMES.length)];
    return { v: 1, seed: seed, params: params, theme: theme, title: lang === "en" ? "Daily round " + key.slice(5) : "Tagesrunde " + key.slice(5), emoji: THEME_EMOJI[theme] };
  }

  // ---------- presets + offline word logic ----------
  var THEME_EMOJI = { day: "🪁", night: "🦇", sunset: "🦜", retro: "👾", candy: "🦄", neon: "👽", ocean: "🐟", lava: "🐉" };
  var PRESETS = [
    { id: "chill",   emoji: "🪁", de: "Chill",        en: "Chill",       theme: "day",    seed: 101, params: { gravity: 1400, jump: 400, gap: 175, speed: 105 } },
    { id: "rocket",  emoji: "🚀", de: "Rakete",       en: "Rocket",      theme: "night",  seed: 202, params: { gravity: 1500, jump: 430, gap: 135, speed: 175 } },
    { id: "night",   emoji: "🦇", de: "Nachtschicht", en: "Night shift", theme: "night",  seed: 303, params: { gravity: 1800, jump: 430, gap: 140, speed: 130 } },
    { id: "candy",   emoji: "🦄", de: "Zuckerwatte",  en: "Candy",       theme: "candy",  seed: 404, params: { gravity: 1300, jump: 390, gap: 165, speed: 115 } },
    { id: "retro",   emoji: "👾", de: "Retro",        en: "Retro",       theme: "retro",  seed: 505, params: { gravity: 1900, jump: 440, gap: 128, speed: 145 } },
    { id: "lava",    emoji: "🐉", de: "Lava",         en: "Lava",        theme: "lava",   seed: 606, params: { gravity: 2300, jump: 500, gap: 105, speed: 190 } },
    { id: "ocean",   emoji: "🐟", de: "Tiefsee",      en: "Deep sea",    theme: "ocean",  seed: 707, params: { gravity: 1100, jump: 360, gap: 150, speed: 120 } },
    { id: "neon",    emoji: "👽", de: "Neon-Chaos",   en: "Neon chaos",  theme: "neon",   seed: 808, params: { gravity: 2100, jump: 470, gap: 112, speed: 210 } }
  ];
  function presetState(p, lang) {
    return { v: 1, seed: p.seed, params: sanitizeParams(p.params), theme: p.theme, title: lang === "en" ? p.en : p.de, emoji: p.emoji };
  }

  // [pattern on folded text, multipliers]
  var WORD_RULES = [
    [/schnell|rasant|\bfast|speed|turbo|rush|zoom|hektisch|flitz/, { speed: 1.35 }],
    [/langsam|\bslow|chill|entspann|gemutlich|relax|ruhig|cozy/, { speed: 0.8, gap: 1.15 }],
    [/schwer|hart\b|\bhard|insane|krass|irre|wahnsinn|unmoglich|impossible|extrem|brutal|hardcore/, { gap: 0.8, speed: 1.2 }],
    [/leicht|\beasy|einfach|anfanger|beginner|simpel|noob/, { gap: 1.2, speed: 0.85 }],
    [/\beng|tight|knapp|narrow/, { gap: 0.82 }],
    [/\bweit|wide|breit|grosszugig/, { gap: 1.2 }],
    [/heavy|blei|fett|dick/, { gravity: 1.2, jump: 1.08 }],
    [/mond|moon|float|schweb|feder|feather|weltall|\bspace/, { gravity: 0.7, jump: 0.85 }]
  ];
  var THEME_RULES = [
    ["night", /nacht|night|dark|dunkel|mitternacht|mond|moon|vampir|fledermaus|\bbat\b|weltraum|weltall|\bspace\b|alien|\bsterne?n?\b|\bstars?\b|galax|planet|rakete|rocket|\bufo/],   // space: a sky of stars
    ["sunset", /sonnenuntergang|sunset|abend|dusk|golden|sommer|summer/],
    ["retro", /retro|8.?bit|pixel|arcade|oldschool/],
    ["candy", /candy|zuckerl|suss|sweet|bonbon|pink|einhorn|unicorn|zuckerwatte/],
    ["neon", /neon|cyber|disco|party|rave|club|glitch/],
    ["ocean", /ozean|ocean|meer|\bsea|wasser|water|tauch|fisch|\bfish|\bhai\b|shark|delfin|dolphin/],
    ["lava", /lava|feuer|\bfire|\bhell|vulkan|volcano|drache|dragon|heiss|\bhot|brenn/]
  ];
  var EMOJI_RULES = [
    [/rakete|rocket/, "🚀"], [/katze|\bcat/, "🐱"], [/\bhund|\bdog/, "🐶"], [/pizza/, "🍕"],
    [/geist|ghost/, "👻"], [/drache|dragon/, "🐉"], [/fisch|\bfish/, "🐟"], [/\bhai\b|shark/, "🦈"],
    [/biene|\bbee/, "🐝"], [/alien|\bufo/, "👽"], [/frosch|\bfrog/, "🐸"], [/einhorn|unicorn/, "🦄"],
    [/fledermaus|\bbat\b/, "🦇"], [/schwein|\bpig/, "🐷"], [/pinguin|penguin/, "🐧"], [/burger/, "🍔"],
    [/fussball|soccer|\bball\b/, "⚽"], [/totenkopf|skull/, "💀"], [/vogel|\bbird/, "🐦"]
  ];

  function localConfig(prompt, lang) {
    var p = sanitizePrompt(prompt);
    if (!p) return { rejected: "empty" };
    if (!isClean(p)) return { rejected: "filter" };
    var f = foldText(p);
    var params = { gravity: RANGES.gravity[2], jump: RANGES.jump[2], gap: RANGES.gap[2], speed: RANGES.speed[2] };
    WORD_RULES.forEach(function (r) {
      if (r[0].test(f)) Object.keys(r[1]).forEach(function (k) { params[k] *= r[1][k]; });
    });
    var theme = "day";
    for (var i = 0; i < THEME_RULES.length; i++) if (THEME_RULES[i][1].test(f)) { theme = THEME_RULES[i][0]; break; }
    var emoji = THEME_EMOJI[theme];
    for (var j = 0; j < EMOJI_RULES.length; j++) if (EMOJI_RULES[j][0].test(f)) { emoji = EMOJI_RULES[j][1]; break; }
    var words = p.split(" ").slice(0, 4).join(" ");
    var title = sanitizeTitle(words.charAt(0).toUpperCase() + words.slice(1), lang === "en" ? "My game" : "Mein Spiel");
    return { v: 1, seed: hash32("p:" + f), params: sanitizeParams(params), theme: theme, title: title, emoji: emoji };
  }

  // Server answer {params,theme,title,emoji} -> full state; seed comes from the prompt so the same idea = same track.
  function stateFromApi(resp, prompt) {
    if (!resp || typeof resp !== "object" || !resp.params || typeof resp.params !== "object") return null;
    var st = sanitizeState({
      v: 1, seed: hash32("p:" + foldText(sanitizePrompt(prompt))), params: resp.params,
      theme: resp.theme, title: resp.title, emoji: resp.emoji, route: resp.abschnitte || resp.route
    });
    return st;
  }

  // The web conference wears the app's look in the player's own two colours (theme.js in CADS-webconference-demo).
  // Only "rrggbb" goes into the link; anything else falls back to the app's yellow and red.
  var CONF_BASE = "https://webconference.bunsenbrenner.org/";
  function confLink(colors) {
    var c = Array.isArray(colors) ? colors : [], hex = /^#[0-9a-fA-F]{6}$/;
    var a = hex.test(c[0]) ? c[0] : "#ffd400", b = hex.test(c[1]) ? c[1] : "#ff3b1d";
    return CONF_BASE + "?look=daily&a=" + a.slice(1).toLowerCase() + "&b=" + b.slice(1).toLowerCase();
  }

  // Languages, as many as the text data has: every text table is { de: {...}, en: {...}, ... }, so a further language is
  // one more block of data. A gap in a block falls back to German; in a "de|en|..." pair a language reads its own
  // column (its place in the table), German where the pair has none. Plurals, numbers and money go through Intl.
  var LOCALE = { de: "de-DE", en: "en-GB" };
  function locale(l) { return LOCALE[l] || l || "de-DE"; }
  function langsOf(tab) { return Object.keys(tab || {}).filter(function (k) { return /^[a-z]{2,3}$/.test(k); }); }
  // The block for a language; what it lacks it reads from the German block below it (also keys added later).
  function textsFor(tab, l) {
    var b = tab[l], de = tab.de;
    if (!b || !de) return de || b;
    if (b !== de && Object.getPrototypeOf(b) === Object.prototype) Object.setPrototypeOf(b, de);
    return b;
  }
  function column(tab, l) { var i = langsOf(tab).indexOf(l); return i < 0 ? 0 : i; }
  function pick(s, i) { var p = String(s).split("|"); return p[i] != null && p[i] !== "" ? p[i] : p[0]; }
  function plural(l, n) { try { return new Intl.PluralRules(locale(l)).select(n); } catch (e) { return n === 1 ? "one" : "other"; } }
  // "off_count" with n = 1 reads "off_count_one" where the block has it ("1 Stimme"), otherwise "off_count".
  function form(block, k, n, l) { var s = typeof n === "number" ? block[k + "_" + plural(l, n)] : null; return s != null ? s : block[k]; }
  function sp(s) { return s.replace(/[\u00a0\u202f]/g, " "); }
  // A number with d decimals as the language writes it ("1,23" / "1.23"); d null: as many as it has, up to 3.
  function num(x, d, l) { return sp(Number(x).toLocaleString(locale(l), d == null ? { maximumFractionDigits: 3, useGrouping: false } : { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false })); }
  // Cents as money: "7 €" / "9,37 €" in German, "€7" / "€9.37" in English.
  function money(c, l) { return sp(new Intl.NumberFormat(locale(l), { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(c / 100)); }

  var api = {
    locale: locale, langsOf: langsOf, textsFor: textsFor, column: column, pick: pick, plural: plural, form: form, num: num, money: money,
    SHARE_BASE: SHARE_BASE, SHORT_BASE: SHORT_BASE, DEFAULT_API: DEFAULT_API, MAX_FRAGMENT: MAX_FRAGMENT, MAX_NAME: MAX_NAME, MAX_TITLE: MAX_TITLE,
    MAX_PROMPT: MAX_PROMPT, MAX_SCORE: MAX_SCORE, RANGES: RANGES, THEME_NAMES: THEME_NAMES, PRESETS: PRESETS,
    clampNum: clampNum, sanitizeParams: sanitizeParams, sanitizeTheme: sanitizeTheme, sanitizeSeed: sanitizeSeed,
    isClean: isClean, sanitizeName: sanitizeName, sanitizeTitle: sanitizeTitle, sanitizeEmoji: sanitizeEmoji, sanitizePrompt: sanitizePrompt,
    sanitizeState: sanitizeState, encodeState: encodeState, decodeState: decodeState, parseHash: parseHash, buildUrl: buildUrl,
    configKey: configKey, hash32: hash32, mulberry32: mulberry32, dailyKey: dailyKey, dailySeed: dailySeed, dailyConfig: dailyConfig,
    sanitizeLook: sanitizeLook, sanitizeRoute: sanitizeRoute, sectionParams: sectionParams, routeParams: routeParams, STEPS: STEPS, SECTIONS: SECTIONS, DECOS: DECOS, FORMS: FORMS, presetState: presetState, localConfig: localConfig, stateFromApi: stateFromApi, CONF_BASE: CONF_BASE, confLink: confLink
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DuellCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
