/* My Daily Idea, Code-Modus: the tiny game SDK. One file, the same bytes in the app (src/code-sdk.js) and on the server
   (CADS-DEMO-wrapper lib/code/sdk.js; a test there pins its SHA-256).

   A code game is ONE module the model writes against this contract (checked by the server's harness, signed, never shown
   to the person):

     const GAME = {
       meta: { title, players: { min, max }, mode: 'turn' | 'realtime', inputs: ['tap'|'swipe'|'key'|'tick'...] },
       init(rng, params, players)  -> state      pure data (JSON), nothing else
       step(state, input, rng)     -> state      input = { seat, t: 'tap'|'swipe'|'key'|'tick'|'move', ... }
       view(state, seat)           -> ops        declarative draw commands (OPS below); no DOM, no canvas
       status(state)               -> { over, score: [n per seat], winner: seat | -1 (draw) | null, turn?: seat }
       moves(state, seat)?         -> [input]    legal inputs (turn games): the SDK's bot plays from them
     };

   Deterministic by construction: the only randomness is the rng the host hands in (seeded, state kept by the host and part
   of the state hash), the only maths is the exact part of Math (see the harness's allowlist). Same code + seed + inputs give
   the same state hash on every device, so a duel link can be replayed (ghost) and a live match runs in lockstep.

   Parts:  rng (sfc32), canonical + hash (FNV-1a, 2x32 bit), OPS + cleanView (the display list), hostOf (runs a GAME with
   per-call budgets; lives INSIDE the sandbox), Lockstep (turn order and realtime ticks over any channel; lives in the
   trusted player), bot (random/greedy over moves()). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CodeSDK = factory();
})(typeof self !== "undefined" ? self : this, function factory() {
  "use strict";
  var W = 360, H = 640;                      // the logical canvas (portrait); the player scales it
  var MAX_OPS = 600, MAX_TEXT = 40, MAX_STATE = 64 * 1024, TICK_MS = 50;
  var PALETTE = ["#111111", "#fff6dc", "#ffd400", "#ff3b1d", "#2b4bff", "#14c872", "#ff4fa3", "#7a1fff", "#ff6a1f", "#00b3c7", "#c8ff00", "#ffffff"];
  var EMOJI = ["🚀", "🛸", "🪐", "🌟", "☄️", "🐠", "🐙", "🐳", "🦈", "🐸", "🦆", "🦖", "🐉", "🦅", "🐝", "🦋", "🐧", "🦉", "🎈", "🪁", "🍩", "🍭", "🍕", "❄️", "⛄", "🔥",
    "🌵", "🌴", "🌈", "☁️", "⚡", "🌙", "🌸", "🌻", "🌊", "🌲", "🏰", "🍬", "🦄", "🎃", "🐟", "☀️", "👻", "🐌", "🐱", "🐶", "👾", "🫧", "⭐", "💎", "🍀", "🍎", "🍒", "🧱", "🚩",
    "🏁", "👑", "🎯", "🧩", "🔷", "🔶", "⚪", "⚫", "🟡", "🟢", "🔵", "🟣", "🟠", "🔴", "❤️", "💛", "💚", "💙", "🏆", "⏳", "🙂", "😮", "🐞", "🌼", "🍄", "🪙"];
  var EMOJI_SET = {}; EMOJI.forEach(function (e) { EMOJI_SET[e] = 1; });
  var INPUTS = ["tap", "swipe", "key", "tick", "move"], DIRS = ["l", "r", "u", "d"], KEYS = ["a", "b"];

  // ---- rng: sfc32 on four uint32, state is a plain array (part of the host state) ----------------------------------
  function mix(a) { a = Math.imul(a ^ (a >>> 16), 0x7feb352d); a = Math.imul(a ^ (a >>> 15), 0x846ca68b); return (a ^ (a >>> 16)) >>> 0; }
  function seedState(seed) { var s = [mix(seed >>> 0), mix((seed >>> 0) ^ 0x9e3779b9), mix((seed >>> 0) + 0x243f6a88), mix((seed >>> 0) ^ 0xb7e15162)]; for (var i = 0; i < 12; i++) sfc(s); return s; }
  function sfc(s) {
    var a = s[0], b = s[1], c = s[2], d = s[3];
    var t = (((a + b) | 0) + d) | 0; d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    s[0] = a >>> 0; s[1] = b >>> 0; s[2] = c >>> 0; s[3] = d >>> 0; return t >>> 0;
  }
  /** The rng a game sees. int(n): 0..n-1; float(): [0,1) as k/2^32 (exact); keyed(n, ...k): the same number for the same keys
   * and seed whatever happened before (fair spawns for both seats of a race). */
  function rngOf(st, seed) {
    function int(n) { n = Math.floor(n); if (!(n > 0) || n > 0x7fffffff) return 0; return sfc(st) % n; }
    return {
      int: int, float: function () { return sfc(st) / 4294967296; },
      chance: function (p) { return sfc(st) / 4294967296 < p; },
      pick: function (arr) { return arr && arr.length ? arr[int(arr.length)] : undefined; },
      keyed: function (n) { var h = mix(seed >>> 0); for (var i = 1; i < arguments.length; i++) h = mix(h ^ ((arguments[i] | 0) + 0x9e3779b9 + i)); n = Math.floor(n); return n > 0 ? h % n : 0; }
    };
  }

  // ---- canonical JSON + hash ---------------------------------------------------------------------------------------
  function canonical(v) {
    if (v === null || typeof v !== "object") return typeof v === "number" && !isFinite(v) ? "null" : JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(function (x) { return canonical(x === undefined ? null : x); }).join(",") + "]";
    return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ":" + canonical(v[k]); }).join(",") + "}";
  }
  function fnv(s, h) { for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function hex8(n) { return ("0000000" + (n >>> 0).toString(16)).slice(-8); }
  function hashOf(v) { var s = canonical(v); return hex8(fnv(s, 2166136261)) + hex8(fnv(s, 0x811c9dc5 ^ 0x5bd1e995)); }

  // ---- the display list ----------------------------------------------------------------------------------------------
  // bg {c} · rect {x,y,w,h,c,r?,a?} · circle {x,y,r,c,a?} · line {x1,y1,x2,y2,c,w?} · text {x,y,s,c?,z?,al?,b?} · emoji {x,y,e,z?}
  // Colours: "#rgb", "#rrggbb" or 0..11 (PALETTE, the app's own). Coordinates in the logical canvas W x H.
  function num(v, lo, hi, d) { v = typeof v === "number" && isFinite(v) ? v : d; return v < lo ? lo : v > hi ? hi : v; }
  function col(c, d) {
    if (typeof c === "number" && c >= 0 && c < PALETTE.length) return PALETTE[c | 0];
    if (typeof c === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) return c.toLowerCase();
    return d;
  }
  function txt(s) { if (typeof s === "number" && isFinite(s)) s = String(s); if (typeof s !== "string") return ""; s = s.replace(/[\u0000-\u001f\u007f<>]/g, ""); return Array.from(s).slice(0, MAX_TEXT).join(""); }
  /** -> a clean display list or null (not a list). Unknown ops and fields are dropped, numbers clamped, at most MAX_OPS. */
  function cleanView(list) {
    if (!Array.isArray(list)) return null;
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX_OPS; i++) {
      var o = list[i]; if (!o || typeof o !== "object") continue;
      var a = o.a === undefined ? 1 : num(o.a, 0, 1, 1);
      if (o.o === "bg") out.push({ o: "bg", c: col(o.c, PALETTE[1]) });
      else if (o.o === "rect") out.push({ o: "rect", x: num(o.x, -W, 2 * W, 0), y: num(o.y, -H, 2 * H, 0), w: num(o.w, 0, 2 * W, 0), h: num(o.h, 0, 2 * H, 0), c: col(o.c, PALETTE[0]), r: num(o.r, 0, 60, 0), a: a });
      else if (o.o === "circle") out.push({ o: "circle", x: num(o.x, -W, 2 * W, 0), y: num(o.y, -H, 2 * H, 0), r: num(o.r, 0, W, 0), c: col(o.c, PALETTE[0]), a: a });
      else if (o.o === "line") out.push({ o: "line", x1: num(o.x1, -W, 2 * W, 0), y1: num(o.y1, -H, 2 * H, 0), x2: num(o.x2, -W, 2 * W, 0), y2: num(o.y2, -H, 2 * H, 0), c: col(o.c, PALETTE[0]), w: num(o.w, 1, 20, 2) });
      else if (o.o === "text") { var s = txt(o.s); if (s) out.push({ o: "text", x: num(o.x, -W, 2 * W, 0), y: num(o.y, -H, 2 * H, 0), s: s, c: col(o.c, PALETTE[0]), z: num(o.z, 8, 72, 18), al: o.al === "l" || o.al === "r" ? o.al : "c", b: !!o.b }); }
      else if (o.o === "emoji") { if (EMOJI_SET[o.e]) out.push({ o: "emoji", x: num(o.x, -W, 2 * W, 0), y: num(o.y, -H, 2 * H, 0), e: o.e, z: num(o.z, 10, 160, 32) }); }
    }
    return out;
  }
  /** Every text a view can show (for the harness's content check). */
  function textsOfView(list) { return (list || []).filter(function (o) { return o.o === "text"; }).map(function (o) { return o.s; }); }

  // ---- inputs ------------------------------------------------------------------------------------------------------------
  /** -> a clean input or null. move carries one entry of moves() (plain JSON, at most 200 characters). */
  function cleanInput(i, seats) {
    if (!i || typeof i !== "object" || INPUTS.indexOf(i.t) < 0) return null;
    if (i.t === "tick") return { seat: -1, t: "tick", dt: TICK_MS };
    var seat = i.seat | 0; if (seat < 0 || seat >= seats) return null;
    if (i.t === "tap") return { seat: seat, t: "tap", x: Math.round(num(i.x, 0, W, 0)), y: Math.round(num(i.y, 0, H, 0)) };
    if (i.t === "swipe") return DIRS.indexOf(i.d) >= 0 ? { seat: seat, t: "swipe", d: i.d } : null;
    if (i.t === "key") return KEYS.indexOf(i.k) >= 0 ? { seat: seat, t: "key", k: i.k } : null;
    if (i.t === "tick") return { seat: -1, t: "tick", dt: TICK_MS };
    if (i.t === "move") { var m; try { m = JSON.parse(JSON.stringify(i.m)); } catch (e) { return null; } if (m === undefined || JSON.stringify(m).length > 200) return null; return { seat: seat, t: "move", m: m }; }
    return null;
  }
  // compact form for links and the wire: "l" "r" "u" "d" (swipe), "a" "b" (key), "x,y" (tap), "m<json>" (move)
  function packInput(i) { return i.t === "swipe" ? i.d : i.t === "key" ? (i.k === "a" ? "A" : "B") : i.t === "tap" ? i.x + "," + i.y : i.t === "move" ? "m" + JSON.stringify(i.m) : ""; }
  function unpackInput(s, seat) {
    if (typeof s !== "string" || s.length > 210) return null;
    if (DIRS.indexOf(s) >= 0) return { seat: seat, t: "swipe", d: s };
    if (s === "A" || s === "B") return { seat: seat, t: "key", k: s.toLowerCase() };
    var m = /^(\d{1,3}),(\d{1,3})$/.exec(s); if (m) return cleanInput({ seat: seat, t: "tap", x: +m[1], y: +m[2] }, seat + 1);
    if (s[0] === "m") { try { return cleanInput({ seat: seat, t: "move", m: JSON.parse(s.slice(1)) }, seat + 1); } catch (e) { return null; } }
    return null;
  }

  // ---- the host: runs a GAME inside the sandbox --------------------------------------------------------------------------
  /** guard: { reset() } of the instrumented code's budget (the harness puts the counters into the code; reset per call).
   * -> { start, apply, view, status, moves, hash, snapshot, restore, meta }. Every answer is plain JSON. */
  function hostOf(GAME, guard) {
    var meta = cleanMeta(GAME && GAME.meta);
    if (!meta) throw new Error("contract-meta");
    ["init", "step", "view", "status"].forEach(function (k) { if (typeof GAME[k] !== "function") throw new Error("contract-" + k); });
    var S = null;   // { g: game state, r: rng state, seed, n: inputs applied, p: players }
    function call(fn) { if (guard) guard.reset(); return fn(); }
    function plain(v, what) { var s = JSON.stringify(v); if (s === undefined) throw new Error(what + "-not-json"); if (s.length > MAX_STATE) throw new Error(what + "-too-big"); return JSON.parse(s); }
    function rng() { return rngOf(S.r, S.seed); }
    function status() {
      var st = call(function () { return GAME.status(S.g); }) || {};
      var score = Array.isArray(st.score) ? st.score.slice(0, S.p).map(function (x) { return num(x, -1e9, 1e9, 0) | 0; }) : [num(st.score, -1e9, 1e9, 0) | 0];
      while (score.length < S.p) score.push(0);
      var w = st.winner === null || st.winner === undefined ? null : st.winner | 0;
      return { over: !!st.over, score: score, winner: w !== null && (w < -1 || w >= S.p) ? null : w, turn: st.turn === undefined ? null : (st.turn | 0) % S.p };
    }
    return {
      meta: meta,
      start: function (seed, params, players) {
        players = Math.max(meta.players.min, Math.min(meta.players.max, players | 0 || 1));
        S = { seed: seed >>> 0, r: seedState(seed), n: 0, p: players, g: null };
        S.g = plain(call(function () { return GAME.init(rng(), params && typeof params === "object" ? plain(params, "params") : {}, players); }), "state");
        return { hash: this.hash(), status: status() };
      },
      /** -> { status, hash? } (the hash only when asked: it costs a canonical JSON of the state) */
      apply: function (input, wantHash) {
        // after the end nothing changes any more (also not the input count): both devices freeze at the same state, however
        // many late inputs one of them still applies
        var i = cleanInput(input, S.p), before = i ? status() : null;
        if (i && before.over) i = null;
        if (i) { S.g = plain(call(function () { return GAME.step(S.g, i, rng()); }), "state"); S.n++; }
        var r = { status: i || !before ? status() : before }; if (wantHash) r.hash = this.hash(); if (!i) r.skipped = true;
        return r;
      },
      view: function (seat) { var v = cleanView(call(function () { return GAME.view(S.g, seat | 0); })); if (!v) throw new Error("view-not-list"); return v; },
      status: status,
      moves: function (seat) {
        if (typeof GAME.moves !== "function") return null;
        var m = call(function () { return GAME.moves(S.g, seat | 0); });
        return Array.isArray(m) ? m.slice(0, 400).map(function (x) { return cleanInput(Object.assign({}, x, { seat: seat }), S.p); }).filter(Boolean) : [];
      },
      hash: function () { return hashOf({ g: S.g, r: S.r, n: S.n }); },
      snapshot: function () { return JSON.stringify(S); },
      restore: function (s) { S = JSON.parse(s); return this.hash(); }
    };
  }
  function cleanMeta(m) {
    if (!m || typeof m !== "object") return null;
    var p = m.players || {}, min = p.min | 0, max = p.max | 0;
    if (min < 1 || max < min || max > 4) return null;
    if (m.mode !== "turn" && m.mode !== "realtime") return null;
    var inputs = (Array.isArray(m.inputs) ? m.inputs : []).filter(function (x) { return INPUTS.indexOf(x) >= 0; });
    if (!inputs.length) return null;
    return { title: txt(m.title) || "Spiel", players: { min: min, max: max }, mode: m.mode, inputs: inputs };
  }

  // ---- the bot -----------------------------------------------------------------------------------------------------------
  /** One input for seat: greedy over moves() when the game has them (score after the move, ties by rng), else random from
   * the declared inputs. peek(input) -> score of seat after it (optional, the host's dry run). r: an rng of the bot's own. */
  function botInput(meta, moves, seat, r, peek) {
    if (moves && moves.length) {
      if (!peek) return moves[r.int(moves.length)];
      var best = null, bs = -Infinity;
      for (var i = 0; i < moves.length; i++) { var s = peek(moves[i]) + r.float() * 0.5; if (s > bs) { bs = s; best = moves[i]; } }
      return best;
    }
    var kinds = meta.inputs.filter(function (k) { return k !== "tick" && k !== "move"; });
    if (!kinds.length) return null;
    var k = kinds[r.int(kinds.length)];
    if (k === "swipe") return { seat: seat, t: "swipe", d: DIRS[r.int(4)] };
    if (k === "key") return { seat: seat, t: "key", k: KEYS[r.int(2)] };
    return { seat: seat, t: "tap", x: r.int(W), y: r.int(H) };
  }

  // ---- lockstep ------------------------------------------------------------------------------------------------------------
  /** Two (or more) devices, one game, the same states. Pure: the caller sends what out() gives over its channel, hands every
   * message it gets to receive(), and applies what ready() returns in that order. Message types (all small JSON):
   *   turn:     { t: 'cg-m', n, s, i }            the n-th move, by seat s (only the seat whose turn it is)
   *   realtime: { t: 'cg-i', k, s, i: [...] }     seat s's inputs for tick k (sent DELAY ticks ahead, also when empty)
   *   both:     { t: 'cg-h', k, h }               the state hash after step k: a mismatch is a desync (honest stop)
   * Messages may arrive late, twice or out of order; ready() releases a step only when it is complete. */
  function Lockstep(o) {
    var seat = o.seat | 0, seats = o.seats | 0, mode = o.mode, delay = o.delay || 3, every = o.hashEvery || 20;
    var got = {}, mine = [], next = 0, sentUpTo = -1, hashes = {}, desync = null, outbox = [];
    function send(m) { outbox.push(m); }
    function key(k, s) { return k + ":" + s; }
    var me = {
      seat: seat, mode: mode,
      /** a local input: realtime queues it for the next sent tick; turn sends it as move n (the caller checks the turn) */
      local: function (input) {
        var i = packInput(input); if (!i) return false;
        if (mode === "turn") { var m = { t: "cg-m", n: next, s: seat, i: i }; got[key(next, 0)] = m; send(m); return true; }
        mine.push(i); return true;
      },
      /** realtime: called every TICK_MS by the caller; sends this seat's packet for tick (next + delay) once */
      pump: function () {
        if (mode !== "realtime") return;
        while (sentUpTo < next + delay) {
          sentUpTo++;
          var m = { t: "cg-i", k: sentUpTo, s: seat, i: sentUpTo < delay ? [] : mine.splice(0, 8) };
          got[key(sentUpTo, seat)] = m; send(m);
        }
      },
      receive: function (m) {
        if (!m || typeof m !== "object") return;
        if (m.t === "cg-m" && mode === "turn" && (m.n | 0) === m.n && m.n >= next && (m.s | 0) === m.s && m.s >= 0 && m.s < seats && typeof m.i === "string") {
          var g = got[key(m.n, 0)];
          if (!g) got[key(m.n, 0)] = m;
          else if ((g.s !== m.s || g.i !== m.i) && !desync) desync = { k: m.n, why: "race" };   // two different moves n: never silently one of them
        }
        else if (m.t === "cg-i" && mode === "realtime" && (m.k | 0) === m.k && m.k >= next && (m.s | 0) === m.s && m.s >= 0 && m.s < seats && m.s !== seat && Array.isArray(m.i) && m.i.length <= 8) { if (!got[key(m.k, m.s)]) got[key(m.k, m.s)] = m; }
        else if (m.t === "cg-h" && (m.k | 0) === m.k && typeof m.h === "string") {
          var have = hashes[m.k];
          if (have === undefined) hashes[m.k] = "peer:" + m.h;
          else if (have.indexOf("peer:") !== 0 && have !== m.h && !desync) desync = { k: m.k };
        }
      },
      /** -> the steps that are complete, in order: [{ k, inputs: [clean input per arrival order: seat 0, 1, ...; then tick] }]
       * turnOf(): the seat whose turn it is now (turn mode; a move by another seat is dropped as a cheat or a race); max: at most
       * this many steps per call (realtime: the caller's clock paces the game) */
      ready: function (turnOf, max) {
        var out = [];
        for (;;) {
          if (max && out.length >= max) break;   // realtime pacing: one tick per TICK_MS (two to catch up), never a fast-forward
          if (mode === "turn") {
            var m = got[key(next, 0)]; if (!m) break;
            delete got[key(next, 0)];
            var t = turnOf ? turnOf() : m.s;
            var inp = unpackInput(m.i, m.s);
            out.push({ k: next, inputs: inp && (t === null || t === m.s) ? [inp] : [] });
            next++;
            break;   // one move at a time: the caller applies it before the next turn check
          }
          var all = [];
          for (var s = 0; s < seats; s++) { var p = got[key(next, s)]; if (!p) { all = null; break; } all.push(p); }
          if (!all) break;
          var ins = [];
          all.forEach(function (p) { p.i.forEach(function (x) { var i = unpackInput(x, p.s); if (i) ins.push(i); }); delete got[key(p.k, p.s)]; });
          ins.push({ seat: -1, t: "tick", dt: TICK_MS });
          out.push({ k: next, inputs: ins });
          next++;
        }
        return out;
      },
      /** after the caller applied step k: its hash; every `every` steps it is compared with the peer's */
      applied: function (k, h) {
        if (k % every !== 0) return;
        var peer = hashes[k];
        if (peer !== undefined && peer.indexOf("peer:") === 0 && peer.slice(5) !== h && !desync) desync = { k: k };
        hashes[k] = h; send({ t: "cg-h", k: k, h: h });
      },
      out: function () { return outbox.splice(0); },
      desync: function () { return desync; },
      at: function () { return next; }
    };
    return me;
  }

  // ---- the sandbox script: the same text on the server (vm) and in the app (iframe) --------------------------------------
  // Property names the instrumented code may never reach through a computed key (the static check refuses them as names).
  var DENY_KEYS = ["constructor", "__proto__", "prototype", "caller", "callee", "arguments", "call", "apply", "bind",
    "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "defineProperty", "defineProperties", "setPrototypeOf",
    "getPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertyNames", "getOwnPropertySymbols", "toString",
    "valueOf", "toLocaleString", "toLocaleUpperCase", "toLocaleLowerCase", "localeCompare", "toLocaleDateString", "toLocaleTimeString", "then",
    "catch", "finally", "repeat", "padStart", "padEnd", "fromCharCode", "fromCodePoint", "raw", "eval", "normalize", "globalThis", "window", "self",
    "document", "Function", "Reflect", "Proxy", "Symbol", "WeakRef", "import"];
  /** the budgets of the instrumented code: ops per host call (loops and calls), call depth; the guard functions are handed to
   * the module as parameters, so they are fast local names and out of the code's reach ("__" names are refused) */
  function guardSource() {
    return "var __guard = (function () {\n" +
      "  var ops = 0, dep = 0, OPS = 200000, DEP = 64, DENY = Object.create(null);\n" +
      "  " + JSON.stringify(DENY_KEYS) + ".forEach(function (k) { DENY[k] = 1; });\n" +
      "  return {\n" +
      "    g: function () { if (++ops > OPS) throw new Error(\"budget-ops\"); },\n" +
      "    in: function () { if (++dep > DEP) { dep = 0; throw new Error(\"budget-depth\"); } if (++ops > OPS) throw new Error(\"budget-ops\"); },\n" +
      "    out: function () { dep--; },\n" +
      "    k: function (k) { if (typeof k === \"number\") return k; if (typeof k === \"string\" && !DENY[k] && k.slice(0, 2) !== \"__\") return k; throw new Error(\"bad-key\"); },\n" +
      "    reset: function () { ops = 0; dep = 0; }\n" +
      "  };\n})();";
  }
  /** checked (instrumented) code -> the script that defines __GAME and __H; needs __SDK (this SDK) in scope */
  function wrapGame(code) {
    return guardSource() + "\nvar __GAME = (function (SDK, __g, __in, __out, __k) { \"use strict\";\n" + code + "\nreturn GAME; })(__SDK.lib, __guard.g, __guard.in, __guard.out, __guard.k);\nvar __H = __SDK.hostOf(__GAME, __guard);";
  }
  /** the SDK itself as script text (the sandbox gets its own copy, it never shares objects with the page) */
  function selfSource() { return "var __SDK = (" + factory.toString() + ")();"; }

  return {
    DENY_KEYS: DENY_KEYS, guardSource: guardSource, wrapGame: wrapGame, selfSource: selfSource,
    W: W, H: H, MAX_OPS: MAX_OPS, MAX_STATE: MAX_STATE, TICK_MS: TICK_MS, PALETTE: PALETTE, EMOJI: EMOJI,
    seedState: seedState, rngOf: rngOf, canonical: canonical, hashOf: hashOf,
    cleanView: cleanView, textsOfView: textsOfView, cleanInput: cleanInput, packInput: packInput, unpackInput: unpackInput,
    hostOf: hostOf, cleanMeta: cleanMeta, botInput: botInput, Lockstep: Lockstep,
    // helpers the game code may use as SDK.range(n), SDK.grid(w, h, v), SDK.clamp(v, a, b): capped, so no huge arrays
    lib: {
      range: function (n) { n = Math.max(0, Math.min(4096, n | 0)); var a = []; for (var i = 0; i < n; i++) a.push(i); return a; },
      grid: function (w, h, v) { w = Math.max(0, Math.min(64, w | 0)); h = Math.max(0, Math.min(64, h | 0)); var g = []; for (var y = 0; y < h; y++) { var r = []; for (var x = 0; x < w; x++) r.push(v === undefined ? 0 : v); g.push(r); } return g; },
      clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
      W: W, H: H
    }
  };
});
