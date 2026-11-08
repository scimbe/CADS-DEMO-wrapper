/* Zug per Link: games for two, one move at a time. Every link is the whole game, so no server holds anything, and every
   new game gets its own seed, so each share is a new pair. Pure logic (no DOM). The table GAMES is the only thing that
   differs between the games. */
(function (root) {
  "use strict";
  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./core.js") : root.DuellCore;
  var Q = node ? require("./quest.js") : root.Quest;
  var DATA = node ? require("./turn.json") : root.TurnData;
  var P = node ? require("./quizpack.js") : root.QuizPack;
  var BLOB = /^[A-Za-z0-9_-]{0,900}$/, SHAPES = ["cookie", "star", "heart", "bolt", "ring", "drop", "coin"], DAY = 86400000;

  function T(lang) { return C.textsFor(DATA.text, lang); }
  // "de|en" pairs and [de, en] lists: a language reads its own column, German where there is none yet
  function col(lang) { return C.column(DATA.text, lang); }
  function pk(s, lang) { return C.pick(s, col(lang)); }
  function alt(a, lang) { var x = a[col(lang)]; return x != null ? x : a[0]; }
  function pair(list, i, lang) { return pk(list[i], lang); }
  function mix(doc, tag, n) {          // the same order on both phones, from the seed in the link
    var r = C.mulberry32(C.hash32("turn|" + doc.seed + "|" + tag)), a = [], i, j, t;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function board(doc, lang) { return mix(doc, "wort", DATA.words.length).slice(0, 9).map(function (i) { return pair(DATA.words, i, lang); }); }
  function smuggle(doc) { return mix(doc, "schmuggel", DATA.smuggle.length).slice(0, 12); }
  function smugglePick(doc, who) { var s = smuggle(doc); return who ? s.slice(3, 6) : s.slice(0, 3); }
  function smuggleBoard(doc, lang) { var s = smuggle(doc); return mix(doc, "board", 12).map(function (i) { return pair(DATA.smuggle, s[i], lang); }); }
  function smuggleSpot(doc, who) { var s = smuggle(doc), o = mix(doc, "board", 12), mine = smugglePick(doc, who); return o.map(function (i, at) { return mine.indexOf(s[i]) >= 0 ? at : -1; }).filter(function (x) { return x >= 0; }); }
  function lots(doc, lang) { return mix(doc, "items", DATA.items.length).slice(0, 5).map(function (i) { return pair(DATA.items, i, lang); }); }
  function worth(doc, who) { return mix(doc, "wert" + who, 5).map(function (i) { return (i + 1) * 10; }); }
  function praise(doc, lang) { return DATA.praise.map(function (x, i) { return pair(DATA.praise, i, lang); }); }
  function hits(a, b) { return a.filter(function (x) { return b.indexOf(x) >= 0; }); }
  function places(order) { var p = []; order.forEach(function (o, at) { p[o] = at; }); return p; }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k]; }); }
  function things(doc, lang) { return doc.w || T(lang).things; }

  function splitLine(x, y, f) { return x >= f ? { a: 10 - x, b: x } : null; }
  var GAMES = {
    deal: {
      turns: [
        [{ w: "slide", l: "deal_offer", max: 10 }],
        [{ w: "slide", l: "deal_floor", max: 10 }, { w: "slide", l: "deal_offer2", max: 10, peek: function (doc, m, now, lang) { return dealLine(doc, m[0][0], now[0], 0, lang); } }],
        [{ w: "slide", l: "deal_floor", max: 10 }]
      ],
      result: function (doc, m, lang) {
        var X = T(lang), one = splitLine(m[0][0], 0, m[1][0]), two = splitLine(m[1][1], 0, m[2][0]);
        return {
          h: one && two ? X.deal_both : X.deal_broke,
          lines: [dealLine(doc, m[0][0], m[1][0], 0, lang), dealLine(doc, m[1][1], m[2][0], 1, lang)]
        };
      }
    },
    einig: {
      turns: [
        [{ w: "list", l: "einig_list", n: 5, max: 16 }, { w: "rank", l: "einig_rank", from: function (doc, m, now) { return now[0]; } }],
        [{ w: "rank", l: "einig_rank", from: function (doc, m) { return m[0][0]; } }]
      ],
      result: function (doc, m, lang) {
        var X = T(lang), opts = m[0][0], pa = places(m[0][1]), pb = places(m[1][0]), best = -1, score = null, tie = mix(doc, "einig", 5);
        opts.forEach(function (o, i) {
          var worst = Math.max(pa[i], pb[i]), sum = pa[i] + pb[i], s = worst * 100 + sum * 10 + tie.indexOf(i);
          if (score === null || s < score) { score = s; best = i; }
        });
        var fight = 0, far = -1;
        opts.forEach(function (o, i) { var d = Math.abs(pa[i] - pb[i]); if (d > far) { far = d; fight = i; } });
        return { h: fmt(X.einig_win, { o: opts[best] }), lines: far > 0 ? [fmt(X.einig_fight, { o: opts[fight] })] : [X.einig_same] };
      }
    },
    wort: {
      turns: [
        [{ w: "pick", l: "wort_pick", n: 3, from: function (doc, m, now, lang) { return board(doc, lang); } }, { w: "text", l: "wort_clue", max: 14, oneWord: true, bad: function (v, doc, lang) { return board(doc, lang).some(function (x) { return Q.fold(x) === Q.fold(v); }); } }],
        [{ w: "pick", l: "wort_guess", n: 3, top: function (doc, m) { return m[0][1]; }, from: function (doc, m, now, lang) { return board(doc, lang); } }]
      ],
      result: function (doc, m, lang) {
        var X = T(lang), n = hits(m[0][0], m[1][0]).length, b = board(doc, lang);
        return { h: fmt(X["wort_" + n], { n: n }), lines: [fmt(X.wort_was, { c: m[0][1], w: m[0][0].map(function (i) { return b[i]; }).join(", ") })] };
      }
    },
    schmuggel: {
      turns: [
        [{ w: "show", l: "smug_mine", list: function (doc, m, now, lang) { return smugglePick(doc, 0).map(function (i) { return pair(DATA.smuggle, i, lang); }); } }],
        [{ w: "show", l: "smug_mine", list: function (doc, m, now, lang) { return smugglePick(doc, 1).map(function (i) { return pair(DATA.smuggle, i, lang); }); }, later: "smug_later" }, { w: "pick", l: "smug_guess", n: 3, from: function (doc, m, now, lang) { return smuggleBoard(doc, lang); } }],
        [{ w: "pick", l: "smug_guess", n: 3, from: function (doc, m, now, lang) { return smuggleBoard(doc, lang); } }]
      ],
      result: function (doc, m, lang) {
        var X = T(lang), b = hits(m[1][1], smuggleSpot(doc, 0)).length, a = hits(m[2][0], smuggleSpot(doc, 1)).length;
        return { h: a === b ? X.smug_tie : X.smug_win, lines: [fmt(X.smug_score, { w: X.first, n: b }), fmt(X.smug_score, { w: X.second, n: a })] };
      }
    },
    lob: {
      turns: [
        [{ w: "pick", l: "lob_me", n: 3, from: function (doc, m, now, lang) { return praise(doc, lang); } }, { w: "pick", l: "lob_you", n: 3, from: function (doc, m, now, lang) { return praise(doc, lang); } }],
        [{ w: "pick", l: "lob_me", n: 3, from: function (doc, m, now, lang) { return praise(doc, lang); } }, { w: "pick", l: "lob_you", n: 3, from: function (doc, m, now, lang) { return praise(doc, lang); } }]
      ],
      result: function (doc, m, lang) {
        var X = T(lang), p = praise(doc, lang), names = function (l) { return l.map(function (i) { return p[i]; }).join(", "); };
        var a = hits(m[0][0], m[1][1]), b = hits(m[1][0], m[0][1]), sa = m[1][1].filter(function (i) { return a.indexOf(i) < 0; }), sb = m[0][1].filter(function (i) { return b.indexOf(i) < 0; }), out = [];
        if (a.length + b.length) out.push(fmt(X.lob_same, { w: names(a.concat(b)) }));
        if (sa.length) out.push(fmt(X.lob_sees, { n: X.first, w: names(sa) }));
        if (sb.length) out.push(fmt(X.lob_sees, { n: X.second, w: names(sb) }));
        return { h: X.lob_head, lines: out };
      }
    },
    auktion: {
      turns: [
        [{ w: "alloc", l: "auk_bid", sum: 100, step: 10, from: function (doc, m, now, lang) { return lots(doc, lang); }, vals: function (doc) { return worth(doc, 0); } }],
        [{ w: "alloc", l: "auk_bid", sum: 100, step: 10, from: function (doc, m, now, lang) { return lots(doc, lang); }, vals: function (doc) { return worth(doc, 1); } }]
      ],
      result: function (doc, m, lang) {
        var X = T(lang), l = lots(doc, lang), wa = worth(doc, 0), wb = worth(doc, 1), sa = 0, sb = 0, lines = [];
        l.forEach(function (x, i) {
          var a = m[0][0][i], b = m[1][0][i], who = a === b ? null : a > b ? 0 : 1;
          if (who === 0) sa += wa[i]; if (who === 1) sb += wb[i];
          lines.push(x + ": " + (who === null ? X.auk_none : who === 0 ? X.first : X.second));
        });
        return { h: fmt(sa === sb ? X.auk_tie : X.auk_win, { w: sa > sb ? X.first : X.second, a: sa, b: sb }), lines: lines };
      }
    },
    kapsel: {
      turns: [
        [{ w: "pick", l: "kap_pick", n: 1, from: function (doc, m, now, lang) { return DATA.fates.map(function (x, i) { return pair(DATA.fates, i, lang); }); } }, { w: "slide", l: "kap_days", min: 1, max: 30, def: 7 }],
        [{ w: "pick", l: "kap_true", n: 1, from: function (doc, m, now, lang) { return [T(lang).yes, T(lang).no]; } }]
      ],
      // Opens on the day it names, counted from the seal. A clock can be turned; this is a game, not a lock.
      gate: function (doc, m) { return m.length === 1 ? doc.o : 0; },
      peekWhole: function (doc, m, lang) { return m.length === 1 ? pair(DATA.fates, m[0][0][0], lang) : ""; },
      result: function (doc, m, lang) {
        var X = T(lang);
        return { h: m[1][0][0] === 0 ? X.kap_right : X.kap_wrong, lines: [pair(DATA.fates, m[0][0][0], lang)] };
      }
    }
  };
  function side(s, lang) { return alt(s.split("||"), lang).split("|"); }
  function asks(doc) { return mix(doc, "frag", DATA.ask.length).slice(0, 5); }
  function askText(doc, i, lang) { return side(DATA.ask[asks(doc)[i]], lang); }
  function fives(key, l) {
    return [0, 1, 2, 3, 4].map(function (i) {
      return { w: "pick", n: 1, auto: true, l: key, top: function (doc, m, lang) { return fmt(T(lang)[key], { q: askText(doc, i, lang)[0] }); }, from: function (doc, m, now, lang) { return askText(doc, i, lang).slice(1); } };
    });
  }
  function eithers(doc) { return mix(doc, "either", DATA.either.length).slice(0, 10); }
  function tens() {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) {
      return { w: "pick", n: 1, auto: true, l: "snack_q", from: function (doc, m, now, lang) { return pair(DATA.either, eithers(doc)[i], lang).split(lang === "en" ? " or " : " oder "); } };
    });
  }
  function score(a, b) { var n = 0; a.forEach(function (x, i) { if (x[0] === b[i][0]) n++; }); return n; }
  GAMES.kennst = {
    turns: [fives("ken_self"), fives("ken_guess").concat(fives("ken_self")), fives("ken_guess")],
    result: function (doc, m, lang) {
      var X = T(lang), a = score(m[0], m[1].slice(0, 5)), b = score(m[1].slice(5), m[2]);
      return { h: a + b >= 7 ? X.ken_top : fmt(X.ken_head, { a: a, b: b }), lines: [fmt(X.ken_head, { a: a, b: b })] };
    }
  };
  GAMES.snack = {
    turns: [tens(), tens()],
    result: function (doc, m, lang) {
      var X = T(lang), n = score(m[0], m[1]), e = eithers(doc), diff = e.filter(function (x, i) { return m[0][i][0] !== m[1][i][0]; }).slice(0, 2);
      return { h: fmt(X.snack_h, { n: n }), lines: [n >= 7 ? X.snack_top : X.snack_low].concat(diff.map(function (i) { return fmt(X.snack_fight, { o: pair(DATA.either, i, lang) }); })) };
    }
  };
  function tasks(doc, m, now, lang) { return DATA.tasks.map(function (x, i) { return pair(DATA.tasks, i, lang); }); }
  GAMES.teilen = {
    turns: [[{ w: "alloc", l: "teil_bid", sum: 10, step: 1, from: tasks }], [{ w: "alloc", l: "teil_bid", sum: 10, step: 1, from: tasks }]],
    result: function (doc, m, lang) {
      var X = T(lang), a = [], b = [], l = tasks(doc, m, [], lang), tie = mix(doc, "teil", 4), want = function (s, i) { return s[0][i]; };
      l.forEach(function (x, i) {
        var d = m[0][0][i] - m[1][0][i], first = d > 0 || (d === 0 && tie[i] % 2 === 0);
        (first ? a : b).push(x);
      });
      return { h: X.teil_h, lines: [fmt(X.teil_a, { w: a.join(", ") || "-" }), fmt(X.teil_b, { w: b.join(", ") || "-" })] };
    }
  };
  GAMES.wette = {
    gateFrom: 1,
    turns: [
      [{ w: "pick", l: "wet_pick", n: 1, from: function (doc, m, now, lang) { return DATA.vows.map(function (x, i) { return pair(DATA.vows, i, lang); }); } }, { w: "slide", l: "wet_days", min: 1, max: 7, def: 3 }],
      [{ w: "pick", l: "wet_judge", n: 1, from: function (doc, m, now, lang) { return [T(lang).wet_yes, T(lang).wet_no]; } }]
    ],
    gate: function (doc, m) { return m.length === 1 ? doc.o : 0; },
    peekWhole: function (doc, m, lang) { return m.length === 1 ? pair(DATA.vows, m[0][0][0], lang) : ""; },
    result: function (doc, m, lang) { var X = T(lang); return { h: m[1][0][0] === 0 ? X.wet_done : X.wet_fail, lines: [pair(DATA.vows, m[0][0][0], lang)].concat(m[1][0][0] === 0 ? [] : [pk(DATA.forfeit[0], lang)]) }; }
  };
  GAMES.luecke = {
    turns: [
      [{ w: "pick", l: "luck_pick", n: 1, from: function (doc, m, now, lang) { return DATA.stories.map(function (s, i) { return alt(s.split("||"), lang).split(" ").slice(0, 3).join(" ") + " ..."; }); } }],
      [{ w: "list", l: "luck_fill", n: 6, max: 18, hints: function (lang) { return side(DATA.hints[0], lang); } }]
    ],
    result: function (doc, m, lang) {
      var s = alt(DATA.stories[m[0][0][0]].split("||"), lang), w = m[1][0];
      return { h: T(lang).luck_h, lines: [s.replace(/\{(\d)\}/g, function (x, i) { return w[i]; })] };
    }
  };
  GAMES.socke = {
    turns: [[{ w: "slide", l: "soc_limit", min: 10, max: 200, def: 50 }], [{ w: "slide", l: "soc_bid", min: 10, max: 200, def: 50 }]],
    result: function (doc, m, lang) {
      var X = T(lang), a = m[0][0], b = m[1][0];
      return { h: fmt(X.soc_h, { n: a + b }), lines: [a === b ? X.soc_tie : fmt(X.soc_win, { w: a > b ? X.first : X.second })] };
    }
  };
  function cards(doc) { return mix(doc, "karten", 12).slice(0, 5).map(function (i) { return i % 6 + 1; }); }
  function says() {
    return [0, 1, 2, 3, 4].map(function (i) {
      return { w: "pick", n: 1, auto: true, l: "blf_say", top: function (doc, m, lang) { return fmt(T(lang).blf_say, { n: i + 1, v: cards(doc)[i] }); }, from: function (doc) { var o = []; for (var v = cards(doc)[i]; v <= 6; v++) o.push(String(v)); return o; } };
    });
  }
  function checks() {
    return [0, 1, 2, 3, 4].map(function (i) {
      return { w: "pick", n: 1, auto: true, l: "blf_see", top: function (doc, m, lang) { return fmt(T(lang).blf_see, { n: i + 1, v: cards(doc)[i] + m[0][i][0] }); }, from: function (doc, m, now, lang) { return [T(lang).blf_yes, T(lang).blf_no]; } };
    });
  }
  GAMES.bluff = {
    turns: [says(), checks()],
    result: function (doc, m, lang) {
      var X = T(lang), c = cards(doc), a = 0, b = 0, lines = [];
      c.forEach(function (t, i) {
        var said = t + m[0][i][0], open = m[1][i][0] === 1;
        if (!open) a += said; else if (said === t) a += t + 2; else b += said;
        lines.push(fmt(X.blf_line, { c: said, t: t }));
      });
      return { h: fmt(X.blf_h, { a: a, b: b }), lines: lines };
    }
  };
  function jobs(doc, m, now, lang) { return DATA.jobs.map(function (x, i) { return pair(DATA.jobs, i, lang); }); }
  GAMES.auftrag = {
    turns: [[{ w: "pick", l: "job_pick", n: 1, from: jobs }], [{ w: "pick", l: "job_pick", n: 1, from: jobs }]],
    result: function (doc, m, lang) { var X = T(lang), l = jobs(doc, m, [], lang); return { h: X.job_h, lines: [fmt(X.job_a, { w: l[m[1][0][0]] }), fmt(X.job_b, { w: l[m[0][0][0]] })] }; }
  };
  function listOf(k) { return function (doc, m, now, lang) { return DATA[k].map(function (x, i) { return pair(DATA[k], i, lang); }); }; }
  function wheel(k, l) { return { w: "pick", n: 1, auto: true, l: l, from: function (doc, m, now, lang) { return mix(doc, k, DATA[k].length).slice(0, 4).map(function (i) { return pair(DATA[k], i, lang); }); } }; }
  function excuse(doc, m, lang) { var w = ["who", "what", "why"].map(function (k, i) { return pair(DATA[k], mix(doc, k, DATA[k].length)[m[0][i][0]], lang); }); return w.join(" "); }
  GAMES.ausrede = {
    turns: [[wheel("who", "aus_who"), wheel("what", "aus_what"), wheel("why", "aus_why")],
      [{ w: "pick", n: 1, auto: true, l: "aus_stamp", top: function (doc, m, lang) { return excuse(doc, m, lang); }, from: function (doc, m, now, lang) { var X = T(lang); return [X.aus_s0, X.aus_s1, X.aus_s2]; } }]],
    result: function (doc, m, lang) { var X = T(lang); return { h: [X.aus_s0, X.aus_s1, X.aus_s2][m[1][0][0]], lines: [excuse(doc, m, lang)] }; }
  };
  GAMES.gutschein = {
    turns: [[{ w: "pick", n: 3, l: "gut_pick", from: listOf("vouchers") }],
      [{ w: "pick", n: 1, l: "gut_take", from: function (doc, m, now, lang) { return m[0][0].map(function (i) { return pair(DATA.vouchers, i, lang); }); } }]],
    result: function (doc, m, lang) { var X = T(lang), l = m[0][0].map(function (i) { return pair(DATA.vouchers, i, lang); }); return { h: X.gut_h, lines: [fmt(X.gut_used, { w: l[m[1][0][0]] })] }; }
  };
  function fields(doc, m, now, lang) { return [1, 2, 3, 4, 5, 6].map(function (n) { return fmt(T(lang).rub_field, { n: n }); }); }
  GAMES.rubbellos = {
    turns: [[{ w: "pick", n: 1, l: "rub_prize", from: listOf("prizes") }, { w: "pick", n: 1, l: "rub_hide", from: fields }], [{ w: "pick", n: 3, l: "rub_try", from: fields }]],
    result: function (doc, m, lang) {
      var X = T(lang), at = m[0][1][0];
      return m[1][0].indexOf(at) >= 0 ? { h: fmt(X.rub_win, { w: pair(DATA.prizes, m[0][0][0], lang) }), lines: [fmt(X.rub_was, { n: at + 1 })] } : { h: X.rub_lose, lines: [fmt(X.rub_was, { n: at + 1 })] };
    }
  };
  GAMES.urkunde = {
    local: true, turns: [[{ w: "pick", n: 1, l: "urk_what", from: listOf("awards") }, { w: "slide", l: "urk_a", min: 0, max: 10, def: 5 }, { w: "slide", l: "urk_b", min: 0, max: 10, def: 5 }, { w: "slide", l: "urk_c", min: 0, max: 10, def: 5 }]],
    result: function (doc, m, lang) { var X = T(lang), sum = m[0][1] + m[0][2] + m[0][3]; return { h: fmt(X.urk_h, { r: X["urk_" + (sum >= 24 ? 3 : sum >= 16 ? 2 : sum >= 8 ? 1 : 0)] }), lines: [pair(DATA.awards, m[0][0][0], lang)] }; }
  };
  function three(m) { return m[0][0]; }
  GAMES.luege = {
    turns: [[{ w: "list", l: "lie_write", n: 3, max: 44 }, { w: "pick", n: 1, l: "lie_which", from: function (doc, m, now) { return now[0]; } }],
      [{ w: "pick", n: 1, l: "lie_guess", from: function (doc, m) { return three(m); } }]],
    result: function (doc, m, lang) { var X = T(lang), at = m[0][1][0]; return { h: m[1][0][0] === at ? X.lie_ok : X.lie_no, lines: [fmt(X.lie_was, { s: three(m)[at] })] }; }
  };
  function letter(doc) { return DATA.letters[doc.seed % DATA.letters.length]; }
  function blitzHint(lang) { return side(DATA.cats[0], lang); }
  function blitzBox() { return { w: "list", l: "blz_go", n: 6, max: 16, loose: true, title: function (doc, lang) { return fmt(T(lang).blz_go, { l: letter(doc) }); }, hints: blitzHint, keep: function (x, doc) { return Q.fold(x).charAt(0) === letter(doc).toLowerCase(); } }; }
  GAMES.blitz = {
    turns: [[blitzBox()], [blitzBox()]],
    result: function (doc, m, lang) {
      var X = T(lang), a = m[0][0].map(Q.fold), b = m[1][0].map(Q.fold), good = function (l, o) { return l.filter(function (x) { return x && o.indexOf(x) < 0 && x.charAt(0) === letter(doc).toLowerCase(); }).length; };
      var same = m[0][0].filter(function (x) { return x && b.indexOf(Q.fold(x)) >= 0; });
      return { h: fmt(X.blz_h, { a: good(a, b), b: good(b, a) }), lines: [fmt(X.blz_go, { l: letter(doc) })].concat(same.length ? [fmt(X.blz_same, { w: same.join(", ") })] : []) };
    }
  };
  function fight(doc, lang) { return pair(DATA.fights, doc.seed % DATA.fights.length, lang); }
  GAMES.recht = {
    turns: [[{ w: "text", l: "rec_a", max: 44 }], [{ w: "text", l: "rec_b", max: 44 }],
      [{ w: "pick", n: 1, l: "rec_who", top: function (doc, m, lang) { return fight(doc, lang) + " A: " + m[0][0] + " B: " + m[1][0]; }, from: function (doc, m, now, lang) { return [T(lang).first, T(lang).second]; } }, { w: "pick", n: 1, l: "rec_why", from: listOf("verdicts") }]],
    result: function (doc, m, lang) { var X = T(lang); return { h: fmt(X.rec_h, { w: m[2][0][0] ? X.second : X.first }), lines: [fmt(X.rec_case, { f: fight(doc, lang) }), m[0][0], m[1][0], pair(DATA.verdicts, m[2][1][0], lang)] }; }
  };
  GAMES.morgen = {
    gateFrom: 1,
    turns: [[{ w: "pick", n: 1, l: "mor_pick", from: listOf("lifts") }, { w: "slide", l: "mor_days", min: 1, max: 7, def: 1 }], [{ w: "show", l: "mor_open", list: function (doc, m, now, lang) { return [pair(DATA.lifts, m[0][0][0], lang)]; } }]],
    gate: function (doc, m) { return m.length === 1 ? doc.o : 0; },
    result: function (doc, m, lang) { return { h: T(lang).mor_h, lines: [pair(DATA.lifts, m[0][0][0], lang)] }; }
  };
  function envs(lang) { return side(DATA.envs[0], lang); }
  GAMES.umschlag = {
    turns: [[{ w: "text", l: "env_a", max: 44 }, { w: "text", l: "env_b", max: 44 }, { w: "text", l: "env_c", max: 44 }],
      [{ w: "pick", n: 1, l: "env_pick", from: function (doc, m, now, lang) { return envs(lang); } }]],
    result: function (doc, m, lang) { var i = m[1][0][0]; return { h: envs(lang)[i], lines: [m[0][i]] }; }
  };
  function numbers(doc, m, now, lang) { return [1, 2, 3].map(function (n) { return fmt(T(lang).rad_n, { n: n }); }); }
  GAMES.rad = {
    turns: [[{ w: "pick", n: 3, l: "rad_pick", from: listOf("fates2") }], [{ w: "pick", n: 1, auto: true, l: "rad_spin", from: numbers }]],
    result: function (doc, m, lang) { var o = mix(doc, "rad", 3); return { h: T(lang).rad_h, lines: [pair(DATA.fates2, m[0][0][o[m[1][0][0]]], lang)] }; }
  };
  // Same seed, same blocks: both sides play the identical stream, and the receiver replays the moves instead of trusting a score.
  var SIZE = 8, MAX_BLOCKS = 40;
  var BLOCKS = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [1, 1]]];
  function blockAt(doc, i) { var r = C.mulberry32(C.hash32("steine|" + doc.seed)), v = 0; for (var k = 0; k <= i; k++) v = r(); return BLOCKS[Math.floor(v * BLOCKS.length)]; }
  function fits(grid, block, at) {
    var x = at % SIZE, y = Math.floor(at / SIZE);
    return block.every(function (c) { var cx = x + c[0], cy = y + c[1]; return cx < SIZE && cy < SIZE && !grid[cy * SIZE + cx]; });
  }
  function drop(st, block, at) {
    var x = at % SIZE, y = Math.floor(at / SIZE), g = st.grid.slice(), rows = [], cols = [], i, j;
    block.forEach(function (c) { g[(y + c[1]) * SIZE + x + c[0]] = 1; });
    for (i = 0; i < SIZE; i++) {
      var r = true, k = true;
      for (j = 0; j < SIZE; j++) { if (!g[i * SIZE + j]) r = false; if (!g[j * SIZE + i]) k = false; }
      if (r) rows.push(i); if (k) cols.push(i);
    }
    rows.forEach(function (r) { for (j = 0; j < SIZE; j++) g[r * SIZE + j] = 0; });
    cols.forEach(function (c) { for (j = 0; j < SIZE; j++) g[j * SIZE + c] = 0; });
    var n = rows.length + cols.length;
    return { grid: g, score: st.score + block.length + n * n * 10, lines: n, i: st.i + 1 };
  }
  function replay(doc, cells) {
    var st = { grid: new Array(SIZE * SIZE).fill(0), score: 0, lines: 0, i: 0 };
    for (var n = 0; n < cells.length; n++) { var b = blockAt(doc, st.i); if (!fits(st.grid, b, cells[n])) return null; st = drop(st, b, cells[n]); }
    return st;
  }
  function canMove(st, doc) { var b = blockAt(doc, st.i); for (var a = 0; a < SIZE * SIZE; a++) if (fits(st.grid, b, a)) return true; return false; }
  function blocksPrompt() { return { w: "blocks", l: "blk_go", max: MAX_BLOCKS, auto: true }; }
  GAMES.steine = {
    turns: [[blocksPrompt()], [blocksPrompt()]],
    result: function (doc, m, lang) {
      var X = T(lang), a = replay(doc, m[0][0]).score, b = replay(doc, m[1][0]).score;
      return { h: a === b ? X.blk_tie : fmt(X.blk_h, { a: a, b: b }), lines: [X.blk_fair] };
    }
  };
  // A plain counter: after each pair of taps it guesses what usually came next. No model, no look at the player beyond these taps.
  function foreseen(tips) {
    var seen = {}, hit = 0;
    tips.forEach(function (x, i) {
      var key = i >= 2 ? tips[i - 2] + "" + tips[i - 1] : "", c = seen[key] || [0, 0];
      if ((c[1] > c[0] ? 1 : 0) === x) hit++;
      c[x]++; seen[key] = c;
    });
    return hit;
  }
  function twenty() {
    var o = [];
    for (var i = 0; i < 20; i++) o.push({ w: "pick", n: 1, auto: true, l: "unl_go", from: function (doc, m, now, lang) { return [T(lang).unl_a, T(lang).unl_b]; } });
    return o;
  }
  GAMES.unlesbar = {
    local: true, turns: [twenty()],
    result: function (doc, m, lang) { var X = T(lang), n = foreseen(m[0].map(function (a) { return a[0]; })); return { h: fmt(X.unl_h, { n: n }), lines: [n <= 12 ? X.unl_top : X.unl_low] }; }
  };
  function pastAsk(i) { return { w: "text", l: "dam_q", max: 44, top: function (doc, m, lang) { return pair(DATA.past, i, lang); } }; }
  GAMES.damals = {
    local: true, turns: [[0, 1, 2, 3, 4].map(pastAsk)],
    result: function (doc, m, lang) { return { h: T(lang).dam_h, lines: m[0].map(function (a, i) { return pair(DATA.past, i, lang) + " " + a; }) }; }
  };
  // ---------- Stufe 3: the circle, the polite line, the word book, the study cards ----------
  function beats(order, a, b) { var p = places(order), d = (p[b] - p[a] + 5) % 5; return d === 1 || d === 2; }
  function circleTest(i) {
    return { w: "pick", l: "krs_test", n: 2, peek: function (doc, m, now, lang) { return circleSoFar(doc, m, now, lang); }, from: function (doc, m) { return m[0][0]; } };
  }
  function circleSoFar(doc, m, now, lang) {
    var X = T(lang), w = m[0][0], o = m[0][1], out = now.map(function (p) { var a = p[0], b = p[1]; if (!beats(o, a, b)) { a = p[1]; b = p[0]; } return fmt(X.krs_beat, { a: w[a], b: w[b] }); });
    return out.length ? out.join(" · ") : X.krs_first;
  }
  function circleSame(a, b) { var s = a.indexOf(b[0]); return b.every(function (x, i) { return a[(s + i) % 5] === x; }); }
  GAMES.kreis = {
    turns: [
      [{ w: "list", l: "krs_words", n: 5, max: 14 }, { w: "rank", l: "krs_rank", from: function (doc, m, now) { return now[0]; } }],
      [0, 1, 2].map(circleTest).concat([{ w: "rank", l: "krs_guess", peek: function (doc, m, now, lang) { return circleSoFar(doc, m, now, lang); }, from: function (doc, m) { return m[0][0]; } }])
    ],
    result: function (doc, m, lang) {
      var X = T(lang), o = m[0][1], w = m[0][0], ok = circleSame(o, m[1][3]);
      return { h: ok ? X.krs_right : X.krs_wrong, lines: [fmt(X.krs_was, { w: o.map(function (i) { return w[i]; }).join(" → ") + " → " + w[o[0]] })] };
    }
  };
  function politeLimit(doc) { return 7 + mix(doc, "grenze", 10)[0]; }
  function politeRow(doc, t) { return [0, 1, 2].map(function (s) { var l = DATA.polite[s]; return l[mix(doc, "hof" + s, l.length)[t % l.length]]; }); }
  function politeLevel(m) { return m.reduce(function (a, x) { return a + x[0][0] + 1; }, 0); }
  function politeTurn(t) {
    return [{ w: "pick", l: "hof_pick", n: 1, auto: true, peek: function (doc, m, now, lang) { return fmt(T(lang).hof_level, { n: politeLevel(m) }); }, from: function (doc, m, now, lang) { return politeRow(doc, t).map(function (x, s) { return "•••".slice(0, s + 1) + " " + x.split("|")[lang === "en" ? 1 : 0]; }); } }];
  }
  GAMES.hoeflich = {
    turns: [0, 1, 2, 3, 4, 5].map(politeTurn),
    ends: function (doc, m) { return politeLevel(m) > politeLimit(doc); },
    result: function (doc, m, lang) {
      var X = T(lang), at = m.length - 1, burst = politeLevel(m) > politeLimit(doc), a = 0, b = 0, last = pk(politeRow(doc, at)[m[at][0][0]], lang);
      m.forEach(function (x, i) { if (i % 2) b += x[0][0] + 1; else a += x[0][0] + 1; });
      if (burst) return { h: fmt(X.hof_burst, { w: at % 2 ? X.first : X.second }), lines: [fmt(X.hof_line, { l: last }), fmt(X.hof_limit, { n: politeLimit(doc) })] };
      return { h: a === b ? X.hof_tie : fmt(X.hof_win, { w: a > b ? X.first : X.second, a: a, b: b }), lines: [fmt(X.hof_limit, { n: politeLimit(doc) })] };
    }
  };
  function coinSlot(doc, r) { return mix(doc, "wort5", DATA.coined.length).slice(r * 5, r * 5 + 5); }
  function momentSlot(doc, r) { return mix(doc, "moment", DATA.moments.length).slice(r * 6, r * 6 + 6); }
  function coinPrompts(r) {
    return [
      { w: "pick", l: "wbu_word", n: 1, auto: true, from: function (doc) { return coinSlot(doc, r).map(function (i) { return DATA.coined[i]; }); } },
      { w: "pick", l: "wbu_moment", n: 1, auto: true, from: function (doc, m, now, lang) { return momentSlot(doc, r).map(function (i) { return pair(DATA.moments, i, lang); }); } }
    ];
  }
  function coinWord(doc, m, r) { var a = m[r], off = r ? 1 : 0; return coinSlot(doc, r)[a[off][0]]; }
  function coinMoment(doc, m, r) { var a = m[r], off = r ? 1 : 0; return momentSlot(doc, r)[a[off + 1][0]]; }
  function coinOptions(doc, m, r) {
    var s = momentSlot(doc, r), at = s.indexOf(coinMoment(doc, m, r)), o = [s[at], s[(at + 1) % 6], s[(at + 2) % 6]], k = mix(doc, "wahl" + r, 3);
    return k.map(function (i) { return o[i]; });
  }
  function coinGuess(r) {
    return { w: "pick", l: "wbu_guess", n: 1, auto: true, top: function (doc, m) { return DATA.coined[coinWord(doc, m, r)]; }, from: function (doc, m, now, lang) { return coinOptions(doc, m, r).map(function (i) { return pair(DATA.moments, i, lang); }); } };
  }
  GAMES.woerter = {
    turns: [coinPrompts(0), [coinGuess(0)].concat(coinPrompts(1)), [coinGuess(1)].concat(coinPrompts(2)), [coinGuess(2)].concat(coinPrompts(3)), [coinGuess(3)]],
    result: function (doc, m, lang) {
      var X = T(lang), hit = 0, lines = [0, 1, 2, 3].map(function (r) {
        if (coinOptions(doc, m, r)[m[r + 1][0][0]] === coinMoment(doc, m, r)) hit++;
        return fmt(X.wbu_line, { w: DATA.coined[coinWord(doc, m, r)], m: pair(DATA.moments, coinMoment(doc, m, r), lang) });
      });
      return { h: fmt(X.wbu_h, { n: hit }), lines: lines };
    }
  };
  function cardPrompts() { return [{ w: "list", l: "abf_q", n: 4, max: 28, bytes: 130 }, { w: "list", l: "abf_a", n: 4, max: 24, same: true, bytes: 110 }]; }
  function cardBack(t) {
    var out = [];
    [0, 1, 2, 3].forEach(function (i) {
      out.push({ w: "show", l: "abf_think", list: function (doc, m) { return [m[t][t ? 8 : 0][i]]; } });
      out.push({ w: "pick", l: "abf_knew", n: 1, auto: true, top: function (doc, m) { return m[t][(t ? 8 : 0) + 1][i]; }, from: function (doc, m, now, lang) { return [T(lang).abf_yes, T(lang).abf_no]; } });
    });
    return out;
  }
  GAMES.abfragen = {
    turns: [cardPrompts(), cardBack(0).concat(cardPrompts()), cardBack(1)],
    result: function (doc, m, lang) {
      var X = T(lang), a = [0, 1, 2, 3].map(function (i) { return m[1][i * 2 + 1][0]; }), b = [0, 1, 2, 3].map(function (i) { return m[2][i * 2 + 1][0]; });
      var sa = a.filter(function (x) { return x === 0; }).length, sb = b.filter(function (x) { return x === 0; }).length, lines = [fmt(X.abf_score, { w: X.second, n: sa }), fmt(X.abf_score, { w: X.first, n: sb })];
      a.forEach(function (x, i) { if (x) lines.push(fmt(X.abf_open, { w: X.second, q: m[0][0][i] })); });
      b.forEach(function (x, i) { if (x) lines.push(fmt(X.abf_open, { w: X.first, q: m[1][8][i] })); });
      return { h: X.abf_h, lines: lines };
    }
  };
  // ---------- the rule on a tablet: only words from a fixed box, so no names and nothing mean can get in ----------
  function ruleStart(doc) { return DATA.rule.map(function (l, s) { return mix(doc, "regel" + s, l.length)[0]; }); }
  function ruleOthers(cur, s) { return DATA.rule[s].map(function (x, i) { return i; }).filter(function (i) { return i !== cur[s]; }); }
  function ruleAt(doc, m) { var c = ruleStart(doc); m.forEach(function (x) { c[x[0][0]] = ruleOthers(c, x[0][0])[x[1][0]]; }); return c; }
  function ruleText(c, lang) { return c.map(function (w, s) { return pair(DATA.rule[s], w, lang); }).join(" ") + "."; }
  function ruleTurn() {
    return [
      { w: "pick", l: "reg_slot", n: 1, auto: true, peek: function (doc, m, now, lang) { return ruleText(ruleAt(doc, m), lang); }, from: function (doc, m, now, lang) { return ruleAt(doc, m).map(function (w, s) { return pair(DATA.rule[s], w, lang); }); } },
      { w: "pick", l: "reg_word", n: 1, auto: true, from: function (doc, m, now, lang) { var s = now[0][0]; return ruleOthers(ruleAt(doc, m), s).map(function (i) { return pair(DATA.rule[s], i, lang); }); } }
    ];
  }
  GAMES.regel = {
    turns: [ruleTurn(), ruleTurn(), ruleTurn(), ruleTurn(), ruleTurn()],
    result: function (doc, m, lang) {
      var X = T(lang), old = [];
      for (var i = 0; i < m.length; i++) old.push(fmt(X.reg_old, { r: ruleText(ruleAt(doc, m.slice(0, i)), lang) }));
      return { h: fmt(X.reg_h, { r: ruleText(ruleAt(doc, m), lang) }), lines: old };
    }
  };
  function buyers(doc, lang) { return pair(DATA.buyers, mix(doc, "kunde", DATA.buyers.length)[0], lang); }
  function sellTurn(i) { return [{ w: "clock", l: "wer_sell", secs: 30, auto: true, text: function (doc, m, lang) { return fmt(T(lang).wer_for, { n: m[0][0][i], b: buyers(doc, lang) }); } }]; }
  function buyTurn(i) { return [{ w: "pick", l: "wer_buy", n: 1, auto: true, peek: function (doc, m, now, lang) { return fmt(T(lang).ask_you, { n: m[0][0][i] }); }, from: function (doc, m) { return m[0][0].filter(function (x, at) { return at !== i; }); } }]; }
  GAMES.werbung = {
    local: true, turns: [[{ w: "list", l: "ask_names", n: 3, max: 12 }], sellTurn(0), sellTurn(1), sellTurn(2), buyTurn(0), buyTurn(1), buyTurn(2)],
    result: function (doc, m, lang) {
      var X = T(lang), names = m[0][0], c = [0, 0, 0];
      [0, 1, 2].forEach(function (v) { var o = [0, 1, 2].filter(function (x) { return x !== v; }); c[o[m[4 + v][0][0]]]++; });
      var top = Math.max.apply(null, c), best = names.filter(function (x, i) { return c[i] === top; });
      return { h: best.length === 1 ? fmt(X.wer_h, { n: best[0], c: top }) : X.wer_tie, lines: names.map(function (x, i) { return x + ": " + c[i]; }) };
    }
  };
  function askAt(doc, q, lang) { return pair(DATA.either, eithers(doc)[q], lang).split(lang === "en" ? " or " : " oder "); }
  function machineRows(doc, m) {
    var flip = mix(doc, "aus", 6).slice(0, 1 + doc.seed % 2), rows = [1, 2, 3].map(function (t) { return m[t].map(function (a) { return a[0]; }); });
    rows.push([0, 1, 2, 3, 4, 5].map(function (q) { var one = rows[0][q] + rows[1][q] + rows[2][q], most = one >= 2 ? 1 : 0; return flip.indexOf(q) >= 0 ? 1 - most : most; }));
    return rows;
  }
  function machineSeen(doc) { return mix(doc, "reihe", 4); }
  function rowText(doc, r, lang) { return r.map(function (a, q) { return askAt(doc, q, lang)[a]; }).join(", "); }
  function machineAsk(i) {
    return [0, 1, 2, 3, 4, 5].map(function (q) { return { w: "pick", l: "mas_q", n: 1, auto: true, peek: function (doc, m, now, lang) { return fmt(T(lang).ask_you, { n: m[0][0][i] }); }, from: function (doc, m, now, lang) { return askAt(doc, q, lang); } }; });
  }
  function machineVote(i) {
    return [{ w: "pick", l: "mas_vote", n: 1, auto: true, peek: function (doc, m, now, lang) { return fmt(T(lang).ask_you, { n: m[0][0][i] }); }, from: function (doc, m, now, lang) { var r = machineRows(doc, m); return machineSeen(doc).map(function (at) { return rowText(doc, r[at], lang); }); } }];
  }
  GAMES.maschine = {
    local: true, turns: [[{ w: "list", l: "ask_names", n: 3, max: 12 }], machineAsk(0), machineAsk(1), machineAsk(2), machineVote(0), machineVote(1), machineVote(2)],
    result: function (doc, m, lang) {
      var X = T(lang), r = machineRows(doc, m), seen = machineSeen(doc), at = seen.indexOf(3), found = m[0][0].filter(function (x, i) { return m[4 + i][0][0] === at; });
      return { h: fmt(X.mas_h, { n: 3 - found.length }), lines: [fmt(X.mas_was, { r: rowText(doc, r[3], lang) }), found.length ? fmt(X.mas_found, { n: found.join(", ") }) : X.mas_none] };
    }
  };
  function huntWords(doc, lang) { return mix(doc, "suche", DATA.words.length).slice(0, 4).map(function (i) { return pair(DATA.words, i, lang); }); }
  GAMES.suche = {
    local: true,
    turns: [
      [{ w: "show", l: "suc_words", list: function (doc, m, now, lang) { return huntWords(doc, lang); }, later: "suc_later" }, { w: "list", l: "suc_hints", n: 4, max: 40 }],
      [{ w: "hunt", l: "suc_go", auto: true, max: 3600, list: function (doc, m, lang) { return huntWords(doc, lang).map(function (x, i) { return { w: x, hint: m[0][1][i] }; }); } }]
    ],
    result: function (doc, m, lang) { var X = T(lang); return { h: fmt(X.suc_h, { n: m[1][0] }), lines: [X.suc_note] }; }
  };
  // ---------- draws, lists and a daily guess ----------
  function drawNames(m) { return m[0][0].filter(Boolean); }
  function drawn(doc, n) {          // one closed circle, so nobody can draw themselves
    var r = C.mulberry32(C.hash32("wichtel|" + doc.seed)), a = [], i, j, x, to = [];
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) { j = Math.floor(r() * i); x = a[i]; a[i] = a[j]; a[j] = x; }
    a.forEach(function (v, at) { to[v] = a[(at + 1) % n]; });
    return to;
  }
  GAMES.wichteln = {
    stay: true,
    turns: [
      [{ w: "list", l: "wic_names", n: 12, max: 12, loose: true, least: 3 }],
      [{ w: "pick", l: "wic_me", n: 1, auto: true, from: function (doc, m) { return drawNames(m); } },
       { w: "show", l: "wic_you", list: function (doc, m, now) { var n = drawNames(m); return [n[drawn(doc, n.length)[now[0][0]]]]; } }]
    ],
    result: function (doc, m, lang) { return { h: T(lang).wic_h, lines: [T(lang).wic_note] }; }
  };
  function tiers(doc, lang) { return side(DATA.tiers[doc.seed % DATA.tiers.length], lang); }
  GAMES.rangliste = {
    turns: [
      [{ w: "rank", l: "ran_go", from: function (doc, m, now, lang) { return tiers(doc, lang); } }],
      [{ w: "rank", l: "ran_go", from: function (doc, m, now, lang) { return tiers(doc, lang); } }]
    ],
    result: function (doc, m, lang) {
      var X = T(lang), l = tiers(doc, lang), a = places(m[0][0]), b = places(m[1][0]), far = 0, sum = 0;
      l.forEach(function (x, i) { var d = Math.abs(a[i] - b[i]); sum += d; if (d > Math.abs(a[far] - b[far])) far = i; });
      return { h: fmt(X.ran_h, { n: Math.round((1 - sum / 32) * 100) }), lines: [fmt(X.ran_top, { w: X.first, o: l[m[0][0][0]] }), fmt(X.ran_top, { w: X.second, o: l[m[1][0][0]] }), sum ? fmt(X.ran_far, { o: l[far] }) : X.ran_same] };
    }
  };
  function guesses(doc) { return mix(doc, "tag", DATA.guess.length).slice(0, 5).map(function (i) { return DATA.guess[i]; }); }
  function guessAsk(i) { return { w: "slide", l: "sch_go", max: 12000, maxOf: function (doc) { return guesses(doc)[i][3]; }, peek: function (doc, m, now, lang) { return guesses(doc)[i][lang === "en" ? 1 : 0]; } }; }
  GAMES.schaetzen = {
    local: true, daily: true, turns: [[0, 1, 2, 3, 4].map(guessAsk)],
    result: function (doc, m, lang) {
      var X = T(lang), g = guesses(doc), off = g.map(function (q, i) { return Math.min(100, Math.round(Math.abs(m[0][i] - q[2]) / q[2] * 100)); });
      return { h: fmt(X.sch_h, { n: Math.round(off.reduce(function (a, b) { return a + b; }, 0) / 5) }), lines: off.map(function (x, i) { return fmt(X.sch_line, { i: i + 1, n: x }); }), note: g.map(function (q) { return q[lang === "en" ? 1 : 0] + " " + q[2]; }).join(" · ") };
    }
  };
  function signTurn() {
    return [
      { w: "pick", l: "rei_start", n: 1, auto: true, peek: function (doc, m, now, lang) { return signedSoFar(m, lang) || T(lang).rei_first; }, from: function (doc, m, now, lang) { return DATA.starts.map(function (x, i) { return pair(DATA.starts, i, lang); }); } },
      { w: "text", l: "rei_line", max: 34 }, { w: "text", l: "rei_name", max: 12 }
    ];
  }
  function signedLine(x, lang) { return pair(DATA.starts, x[0][0], lang) + " " + x[1] + " (" + x[2] + ")"; }
  function signedSoFar(m, lang) { return m.map(function (x) { return signedLine(x, lang); }).join(" · "); }
  GAMES.reihum = {
    turns: [signTurn(), signTurn(), signTurn(), signTurn()],
    result: function (doc, m, lang) { return { h: T(lang).rei_h, lines: m.map(function (x) { return signedLine(x, lang); }) }; }
  };
  // ---------- finding a date: dates are tapped, never typed, so no place or time of day slips in as free text ----------
  // A date is day * 10 + hour slot. Whoever asks chose the dates and counts as yes everywhere; up to ten people in one link.
  var HOURS = [10, 12, 14, 15, 16, 17, 18, 19, 20], VOTERS = 10;
  function dayText(day, lang) { var X = T(lang), d = new Date(day * DAY); return fmt(X.ter_day, { w: X.ter_days.split("|")[d.getUTCDay()], d: d.getUTCDate(), m: d.getUTCMonth() + 1 }); }
  function hourText(i, lang) { var h = HOURS[i]; return lang === "en" ? (h > 12 ? h - 12 : h) + (h < 12 ? " am" : " pm") : fmt(T(lang).ter_hour, { h: h }); }
  function slotText(s, lang) { return dayText(Math.floor(s / 10), lang) + ", " + hourText(s % 10, lang); }
  function nameOk(v) { return typeof v === "string" && !!Q.fold(v) && Q.clean(v, 12) === v && new TextEncoder().encode(v).length <= 24; }
  function termDates(m) { return m[0][0][1]; }
  function voted(m) { return m.map(function (t) { return t[0][0]; }); }
  function tally(m) {
    return termDates(m).map(function (s, i) {
      var c = { s: s, yes: 1, maybe: 0, who: [m[0][0][0]] };
      m.slice(1).forEach(function (t) { var v = t[0][1][i]; if (v === 0) { c.yes++; c.who.push(t[0][0]); } else if (v === 1) c.maybe++; });
      c.pts = (c.yes * 2 + c.maybe) * 100 + c.yes;
      return c;
    }).sort(function (a, b) { return b.pts - a.pts || a.s - b.s; });
  }
  function few(names) { return names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : ""); }
  function termHead(m, lang) {
    var X = T(lang), l = tally(m), top = l.filter(function (c) { return c.pts === l[0].pts; });
    if (m.length === 1) return fmt(X.ter_open, { s: termDates(m).map(function (s) { return slotText(s, lang); }).join(" · ") });   // only the one who asks so far
    if (top.length > 1) return fmt(X.ter_tie, { s: top.map(function (c) { return slotText(c.s, lang); }).join(" · ") });
    return fmt(l[0].yes === m.length ? X.ter_all : X.ter_most, { s: slotText(l[0].s, lang) });
  }
  function ballot() {
    return { w: "vote", l: "ter_vote", peek: function (doc, m, now, lang) { return termHead(m, lang); }, ok: function (v, m) {
      return Array.isArray(v) && v.length === 2 && nameOk(v[0]) && voted(m).every(function (n) { return Q.fold(n) !== Q.fold(v[0]); }) &&
        Array.isArray(v[1]) && v[1].length === termDates(m).length && v[1].every(function (x) { return intIn(x, 0, 2); });
    } };
  }
  GAMES.termin = {
    turns: [[{ w: "slots", l: "ter_pick", ok: function (v) {
      var s = Array.isArray(v) && v.length === 2 && v[1];
      return !!s && nameOk(v[0]) && Array.isArray(s) && s.length >= 2 && s.length <= 5 && s.every(function (x, i) { return intIn(x, 0, 9999999) && x % 10 < HOURS.length && (!i || x > s[i - 1]); });
    } }]].concat(Array.apply(null, Array(VOTERS - 1)).map(function () { return [ballot()]; })),
    words: { you_start: "ter_start", go_first: "ter_go_first", go_play: "ter_go", note_turn: "ter_note", note_over: "ter_over", ready: "ter_ready", send: "ter_send", rematch: "ter_again" },
    face: function (doc, m, lang) { return m.length ? [termHead(m, lang), fmt(T(lang).ter_count, { n: m.length }), T(lang).ter_you] : null; },
    result: function (doc, m, lang) {
      var X = T(lang), l = tally(m);
      return { h: termHead(m, lang), lines: l.slice(0, 2).map(function (c) { return fmt(X.ter_line, { s: slotText(c.s, lang), y: c.yes, v: c.maybe }); }).concat([fmt(X.ter_can, { w: few(l[0].who) })]) };
    }
  };
  // ---------- thanks, candles, a secret alphabet, a letter to yourself ----------
  GAMES.danke = {
    turns: [[{ w: "text", l: "dan_why", max: 44 }, { w: "text", l: "dan_from", max: 12 }], [{ w: "show", l: "dan_got", list: function (doc, m, now, lang) { return [fmt(T(lang).dan_h, { s: m[0][0] }), m[0][1]]; } }]],
    peekWhole: function (doc, m, lang) { return m.length === 1 ? fmt(T(lang).dan_h, { s: m[0][0] }) : ""; },
    result: function (doc, m, lang) { return { h: fmt(T(lang).dan_h, { s: m[0][0] }), lines: [fmt(T(lang).dan_sig, { n: m[0][1] }), T(lang).dan_ok] }; }
  };
  GAMES.kerzen = {
    turns: [[{ w: "text", l: "ker_text", max: 60 }], [{ w: "blow", l: "ker_blow", auto: true, n: 5 }]],
    result: function (doc, m, lang) { return { h: m[0][0], lines: [T(lang).ker_h] }; }
  };
  // Same word on two phones, same 26 signs: nothing goes through the app, the notes are paper.
  var DOTS = [1, 8, 2, 16, 4, 32, 64, 128];
  function glyphs(word) {
    var r = C.mulberry32(C.hash32("tunnel|" + Q.fold(word))), seen = {}, out = [];
    for (var i = 0; i < 26; i++) {
      var g; do { g = 0; DOTS.forEach(function (d) { if (r() < 0.5) g |= d; }); } while (seen[g] || [0, 255].indexOf(g) >= 0 || (g & 15) === 0 || (g & 240) === 0);
      seen[g] = 1; out.push(String.fromCharCode(0x2800 + g));
    }
    return out;
  }
  GAMES.tunnel = {
    local: true, turns: [[{ w: "text", l: "tun_word", max: 14, oneWord: true }]],
    result: function (doc, m, lang) {
      var g = glyphs(m[0][0]), lines = [];
      for (var i = 0; i < 26; i += 2) lines.push(String.fromCharCode(65 + i) + " " + g[i] + "    " + String.fromCharCode(66 + i) + " " + g[i + 1]);
      return { h: T(lang).tun_h, lines: lines, note: T(lang).tun_note };
    }
  };
  GAMES.post = {
    gateFrom: 1,
    turns: [[{ w: "list", l: "pst_say", n: 3, max: 40, hints: function (lang) { return DATA.postStarts.map(function (x, i) { return pair(DATA.postStarts, i, lang); }); } }, { w: "slide", l: "pst_days", min: 7, max: 30, def: 30 }],
      [0, 1, 2].map(function (i) { return { w: "pick", l: "pst_true", n: 1, auto: true, top: function (doc, m, lang) { return m[0][0][i]; }, from: function (doc, m, now, lang) { return [T(lang).pst_yes, T(lang).pst_no]; } }; })],
    gate: function (doc, m) { return m.length === 1 ? doc.o : 0; },
    result: function (doc, m, lang) {
      var X = T(lang), n = m[1].filter(function (a) { return a[0] === 0; }).length;
      return { h: fmt(X.pst_h, { n: n }), lines: m[0][0].map(function (s, i) { return (m[1][i][0] === 0 ? "✓ " : "✗ ") + s; }) };
    }
  };
  // ---------- a falling price, and socks on a field ----------
  function junk(doc, lang) { return mix(doc, "quatsch", DATA.items.length).slice(0, 4).map(function (i) { return pair(DATA.items, i, lang); }); }
  function junkWorth(doc, who) { return mix(doc, "qwert" + who, 9).slice(0, 4).map(function (i) { return 20 + i * 10; }); }
  function dropTurn(who) { return [0, 1, 2, 3].map(function (i) { return { w: "drop", l: "aq_tap", auto: true, max: 100, item: function (doc, lang) { return junk(doc, lang)[i]; }, worth: function (doc) { return junkWorth(doc, who)[i]; } }; }); }
  GAMES.fallpreis = {
    turns: [dropTurn(0), dropTurn(1)],
    result: function (doc, m, lang) {
      var X = T(lang), l = junk(doc, lang), wa = junkWorth(doc, 0), wb = junkWorth(doc, 1), sa = 0, sb = 0;
      var lines = l.map(function (x, i) {
        var a = m[0][i], b = m[1][i];
        if (a === b) return fmt(X.aq_none, { o: x, p: a });
        if (a > b) { sa += wa[i] - a; return fmt(X.aq_buy, { o: x, w: X.first, p: a, v: wa[i] }); }
        sb += wb[i] - b; return fmt(X.aq_buy, { o: x, w: X.second, p: b, v: wb[i] });
      });
      return { h: sa === sb ? fmt(X.aq_tie, { a: sa }) : fmt(X.aq_win, { w: sa > sb ? X.first : X.second, a: sa, b: sb }), lines: lines };
    }
  };
  // Socks: each side hides two on a 5x5 field; every turn six taps on the other field answer found, near or far.
  function hidden(m, who) { return m[who][0]; }
  function sockAnswer(socks, c) { var x = c % 5, y = Math.floor(c / 5); return socks.indexOf(c) >= 0 ? 2 : socks.some(function (s) { return Math.max(Math.abs(s % 5 - x), Math.abs(Math.floor(s / 5) - y)) <= 1; }) ? 1 : 0; }
  function sockFound(m, who) {           // the socks of 'who' that the other side has tapped so far
    var mine = hidden(m, who), got = {};
    m.forEach(function (t, i) { if (i < 1 || i % 2 === who) return; var taps = t[t.length - 1]; if (Array.isArray(taps)) taps.forEach(function (c) { if (mine.indexOf(c) >= 0) got[c] = 1; }); });
    return Object.keys(got).length;
  }
  function sockTaps(m, who) { var o = []; m.forEach(function (t, i) { if (i >= 1 && i % 2 !== who) o = o.concat(t[t.length - 1]); }); return o; }
  function sockTurn(t) {
    var p = { w: "probe", l: "sok_probe", n: 6, socks: function (doc, m) { return hidden(m, (t + 1) % 2); }, before: function (doc, m) { return sockTaps(m, (t + 1) % 2); } };
    return t === 1 ? [{ w: "grid", l: "sok_hide", n: 2 }, p] : [p];
  }
  GAMES.socken = {
    turns: [[{ w: "grid", l: "sok_hide", n: 2 }]].concat([1, 2, 3, 4, 5, 6].map(sockTurn)),
    // Only after both sides had the same number of searches: the second side may not win before the first could search.
    ends: function (doc, m) { return m.length >= 3 && m.length % 2 === 1 && (sockFound(m, 0) === 2 || sockFound(m, 1) === 2); },
    result: function (doc, m, lang) {
      var X = T(lang), a = sockFound(m, 1), b = sockFound(m, 0), w = a === b ? null : a > b ? X.first : X.second;
      return { h: w ? fmt(X.sok_win, { w: w }) : X.sok_tie, lines: [fmt(X.sok_score, { w: X.first, n: a }), fmt(X.sok_score, { w: X.second, n: b }), fmt(X.sok_turns, { n: m.length - 1 })] };
    }
  };
  // ---------- 24 doors, and a rap from rhyme cards ----------
  function doorText(m, i, lang) { return m[0][0][i] || pair(DATA.doorFill, i % DATA.doorFill.length, lang); }
  GAMES.advent = {
    stay: true,
    turns: [[{ w: "list", l: "adv_write", n: 24, max: 20, loose: true, bytes: 520 }], [{ w: "doors", l: "adv_open", text: function (doc, m, i, lang) { return doorText(m, i, lang); } }]],
    result: function (doc, m, lang) { return { h: T(lang).adv_h, lines: [doorText(m, 0, lang)] }; }
  };
  var RAPTYPE = [0, 0, 1, 1, 2, 2];
  function rapFam(doc, who) { return mix(doc, "rap", DATA.rap.de.length)[who]; }
  function rapLine(doc, who, i, lang) { return (DATA.rap[lang] || DATA.rap.de)[rapFam(doc, who)][i]; }
  function rapCards(doc, who, k, avoid) { return mix(doc, "karte" + who + k, 6).filter(function (i) { return i !== avoid; }).slice(0, 3); }
  function rapPick(who, k) {
    return { w: "pick", l: "rap_pick", n: 1, auto: true, peek: function (doc, m, now, lang) { return rapSoFar(doc, m, now, lang) || T(lang).rap_start; },
      from: function (doc, m, now, lang) { var X = T(lang), avoid = k ? rapCards(doc, who, 0)[now[0][0]] : -1; return rapCards(doc, who, k, avoid).map(function (i) { return X["rap_t" + RAPTYPE[i]] + ": " + rapLine(doc, who, i, lang); }); } };
  }
  function rapChosen(doc, m, now, lang) {
    var out = [];
    m.concat(now.length ? [now] : []).forEach(function (t, who) {
      var first = rapCards(doc, who, 0)[t[0][0]]; out.push(first);
      if (t[1]) out.push(rapCards(doc, who, 1, first)[t[1][0]]);
    });
    return out;
  }
  function rapSoFar(doc, m, now, lang) { return rapChosen(doc, m, now, lang).map(function (i, at) { return rapLine(doc, at < 2 ? 0 : 1, i, lang); }).join(" / "); }
  GAMES.rap = {
    turns: [[rapPick(0, 0), rapPick(0, 1)], [rapPick(1, 0), rapPick(1, 1)]],
    result: function (doc, m, lang) {
      var X = T(lang), c = rapChosen(doc, m, [], lang), a = (RAPTYPE[c[0]] === 2) + (RAPTYPE[c[1]] === 2), b = (RAPTYPE[c[2]] === 2) + (RAPTYPE[c[3]] === 2);
      return { h: a === b ? fmt(X.rap_tie, { a: a }) : fmt(X.rap_win, { w: a > b ? X.first : X.second, a: a, b: b }), lines: c.map(function (i, at) { return rapLine(doc, at < 2 ? 0 : 1, i, lang); }) };
    }
  };
  // ---------- music stops, and voices in a call ----------
  function statue(doc, r, lang) { return pair(DATA.statues, mix(doc, "statue", DATA.statues.length)[r % DATA.statues.length], lang); }
  function pauseAt(doc, r) { return 4 + mix(doc, "pause" + r, 9)[0]; }          // seconds of music before the next stop, from the seed
  GAMES.disco = {
    local: true,
    turns: [[{ w: "pick", l: "dis_beat", n: 1, auto: true, from: function (doc, m, now, lang) { return DATA.discoBeats.map(function (b) { return alt(b, lang); }); } },
      { w: "freeze", l: "dis_go", auto: true, max: 99, beat: function (i) { return DATA.discoBeats[i][2]; }, statue: statue, pause: pauseAt }]],
    result: function (doc, m, lang) { return { h: fmt(T(lang).dis_h, { n: m[0][1] }), lines: [T(lang).dis_note] }; }
  };
  function figure(doc, r) { return mix(doc, "figur", DATA.figures.length)[r]; }
  function figureCards(doc, r) {
    var ok = figure(doc, r), rest = mix(doc, "fk" + r, DATA.figures.length).filter(function (i) { return i !== ok; }).slice(0, 5).concat([ok]);
    return mix(doc, "fo" + r, 6).map(function (i) { return rest[i]; });
  }
  GAMES.stimme = {
    stay: true,
    turns: [[{ w: "show", l: "stm_call", list: function (doc, m, now, lang) { return [T(lang).stm_share]; } }],
      [{ w: "pick", l: "stm_role", n: 1, auto: true, from: function (doc, m, now, lang) { return [T(lang).stm_speak, T(lang).stm_guess]; } },
       { w: "voices", l: "stm_go", auto: true, rounds: 5, figure: function (doc, r, lang) { return pair(DATA.figures, figure(doc, r), lang); }, cards: function (doc, r, lang) { return figureCards(doc, r).map(function (i) { return pair(DATA.figures, i, lang); }); }, right: function (doc, r) { return figureCards(doc, r).indexOf(figure(doc, r)); } }]],
    result: function (doc, m, lang) { return { h: fmt(T(lang).stm_h, { n: m[1][1] }), lines: [T(lang).stm_note] }; }
  };
  // ---------- voices on one phone: recordings stay in memory on this device and never go into a link ----------
  var FXS = ["chip", "monster", "robot", "echo"];
  GAMES.maus = {
    local: true,
    turns: [[{ w: "text", l: "mau_for", max: 12 }, { w: "pick", l: "mau_fx", n: 1, auto: true, from: function (doc, m, now, lang) { return FXS.map(function (f) { return T(lang)["mau_" + f]; }); } }, { w: "rec", l: "mau_rec", auto: true, ms: 4000, slot: "maus" }],
      [{ w: "once", l: "mau_press", auto: true, slot: "maus", fx: function (m) { return FXS[m[0][1][0]]; }, who: function (m) { return m[0][0]; } }]],
    result: function (doc, m, lang) { return { h: fmt(T(lang).mau_h, { n: m[0][0] }), lines: [T(lang).mau_gone] }; }
  };
  function parrotWords(doc, lang) { return mix(doc, "papagei", DATA.words.length).slice(0, 3).map(function (i) { return pair(DATA.words, i, lang); }); }
  GAMES.papagei = {
    local: true,
    turns: [[{ w: "show", l: "pap_say", list: function (doc, m, now, lang) { return [parrotWords(doc, lang)[mix(doc, "pw", 3)[0]]]; } }, { w: "rec", l: "pap_rec", auto: true, ms: 2500, slot: "pap_a" }],
      [{ w: "parrot", l: "pap_copy", auto: true, from: "pap_a", slot: "pap_b" }, { w: "pick", l: "pap_guess", n: 1, auto: true, from: function (doc, m, now, lang) { return parrotWords(doc, lang); } }]],
    result: function (doc, m, lang) { var X = T(lang), w = parrotWords(doc, lang), ok = mix(doc, "pw", 3)[0]; return { h: m[1][1][0] === ok ? X.pap_right : X.pap_wrong, lines: [fmt(X.pap_was, { w: w[ok] })] }; }
  };
  function animalTurn(i) { return [{ w: "rec", l: "tie_rec", auto: true, ms: 1200, slot: "tier" + i, peek: function (doc, m, now, lang) { return fmt(T(lang).ask_you, { n: m[0][0][i] }); } }]; }
  function animalOrder(doc) { return mix(doc, "tierfolge", 3); }
  function animalGuess(k) {
    return { w: "whose", l: "tie_who", auto: true, slot: function (doc) { return "tier" + animalOrder(doc)[k]; }, fx: function (doc) { return FXS[doc.seed % 4]; }, title: function (doc, lang) { return fmt(T(lang).tie_n, { n: k + 1 }); }, from: function (doc, m) { return m[0][0]; } };
  }
  GAMES.tier = {
    local: true,
    turns: [[{ w: "list", l: "ask_names", n: 3, max: 12 }], animalTurn(0), animalTurn(1), animalTurn(2), [animalGuess(0), animalGuess(1), animalGuess(2)]],
    result: function (doc, m, lang) {
      var X = T(lang), o = animalOrder(doc), names = m[0][0], hit = o.map(function (who, k) { return m[4][k] === who; });
      var lines = names.map(function (n, who) { return fmt(hit[o.indexOf(who)] ? X.tie_known : X.tie_hidden, { n: n }); });
      return { h: fmt(X.tie_h, { n: hit.filter(Boolean).length }), lines: lines };
    }
  };
  // ---------- time and nerves: the phone measures, the targets and pauses come from the seed ----------
  function uhrTargets(doc) { return [0, 1, 2, 3, 4].map(function (r) { return 3000 + mix(doc, "uhr" + r, 6)[0] * 1000; }); }
  GAMES.uhr = {
    local: true, daily: true,
    turns: [[{ w: "inner", l: "uhr_go", auto: true, targets: uhrTargets }]],
    result: function (doc, m, lang) {
      var X = T(lang), d = m[0][0], mean = Math.round(d.reduce(function (a, b) { return a + b; }, 0) / d.length / 100) / 10;
      var h = Math.abs(mean) < 0.1 ? X.uhr_spot : fmt(mean < 0 ? X.uhr_early : X.uhr_late, { n: C.num(Math.abs(mean), null, lang) });
      return { h: h, lines: d.map(function (x, i) { return fmt(X.uhr_line, { i: i + 1, t: C.num(uhrTargets(doc)[i] / 1000, null, lang), n: (x > 0 ? "+" : "") + C.num(x / 1000, 1, lang) }); }) };
    }
  };
  function secs(ms, lang) { return C.num(ms / 1000, 2, lang); }
  GAMES.pokal = {
    turns: [[{ w: "blind", l: "pok_go", auto: true, tries: 3, goal: 10000 }],
      [{ w: "blind", l: "pok_go", auto: true, tries: 3, goal: 10000, peek: function (doc, m, now, lang) { return fmt(T(lang).pok_beat, { n: secs(m[0][0], lang) }); } }]],
    result: function (doc, m, lang) {
      var X = T(lang), a = Math.abs(m[0][0] - 10000), b = Math.abs(m[1][0] - 10000);
      return { h: a === b ? X.pok_tie : fmt(X.pok_win, { w: a < b ? X.first : X.second }), lines: [X.first + ": " + secs(m[0][0], lang) + " s", X.second + ": " + secs(m[1][0], lang) + " s"] };
    }
  };
  // Misère Nim from 3/4/5: the player always starts from a position that can be won, the good bot plays it perfectly.
  function nimMove(heaps, good, r) {
    var big = heaps.filter(function (h) { return h > 1; }).length, x = heaps.reduce(function (a, h) { return a ^ h; }, 0), i, k;
    if (good) {
      if (big === 1) { i = heaps.findIndex(function (h) { return h > 1; }); var ones = heaps.filter(function (h) { return h === 1; }).length; return [i, ones % 2 ? heaps[i] : heaps[i] - 1]; }
      if (big > 1 && x) for (i = 0; i < heaps.length; i++) { k = heaps[i] ^ x; if (k < heaps[i]) return [i, heaps[i] - k]; }
    }
    var live = heaps.map(function (h, n) { return h ? n : -1; }).filter(function (n) { return n >= 0; }); i = live[Math.floor(r() * live.length)];
    return [i, 1 + Math.floor(r() * heaps[i])];
  }
  GAMES.pommes = {
    local: true,
    turns: [[{ w: "pick", l: "pom_bot", n: 1, auto: true, from: function (doc, m, now, lang) { return [T(lang).pom_easy, T(lang).pom_good]; } },
      { w: "nim", l: "pom_go", auto: true, heaps: [3, 4, 5], bot: function (doc, heaps, step, good) { return nimMove(heaps, good, C.mulberry32(C.hash32("nim|" + doc.seed + "|" + step))); } }]],
    result: function (doc, m, lang) { var X = T(lang); return { h: m[0][1] ? X.pom_won : X.pom_lost, lines: [m[0][0][0] ? X.pom_good : X.pom_easy] }; }
  };
  function reactPlan(doc) {            // per round: how many decoys come first and the pauses, the same for both players
    return [0, 1, 2, 3, 4].map(function (r) { return { decoys: mix(doc, "lock" + r, 3)[0], pause: 700 + mix(doc, "pause" + r, 12)[0] * 150 }; });
  }
  GAMES.reaktion = {
    turns: [[{ w: "react", l: "rea_go", auto: true, plan: reactPlan }],
      [{ w: "react", l: "rea_go", auto: true, plan: reactPlan, peek: function (doc, m, now, lang) { return fmt(T(lang).rea_beat, { n: secs(m[0][0], lang) }); } }]],
    result: function (doc, m, lang) {
      var X = T(lang), a = m[0][0], b = m[1][0];
      return { h: a === b ? X.rea_tie : fmt(X.rea_win, { w: a < b ? X.first : X.second }), lines: [X.first + ": " + secs(a, lang) + " s", X.second + ": " + secs(b, lang) + " s", a < b ? X.rea_tease : X.rea_tease2] };
    }
  };
  // ---------- the bouncer: one hidden rule at a time, the beings come from the day's seed ----------
  // being: [animal 0-3, hat 0/1, colour 0-2, socks 0/1]
  var DOOR_RULES = [function (b) { return b[1] === 1; }, function (b) { return b[1] === 0; }, function (b) { return b[3] === 1; }, function (b) { return b[3] === 0; },
    function (b) { return b[2] === 0; }, function (b) { return b[2] === 1; }, function (b) { return b[2] === 2; }, function (b) { return b[0] !== 0; }, function (b) { return b[0] === 1; }, function (b) { return b[0] !== 2; }];
  function doorOrder(doc) { return mix(doc, "tuer", DOOR_RULES.length); }
  // The i-th being under rule r. Every second one is forced to the other side of the rule when the last two agreed,
  // so a rule always shows a "yes" and a "no" early and can be found by looking, not by luck.
  function doorBeing(doc, r, i, prev) {
    var rnd = C.mulberry32(C.hash32("wesen|" + doc.seed + "|" + r + "|" + i)), b = [Math.floor(rnd() * 4), rnd() < 0.5 ? 1 : 0, Math.floor(rnd() * 3), rnd() < 0.5 ? 1 : 0];
    if (prev && prev.length >= 2 && prev[prev.length - 1] === prev[prev.length - 2]) {
      var want = !prev[prev.length - 1];
      for (var k = 0; k < 24 && DOOR_RULES[r](b) !== want; k++) b = [Math.floor(rnd() * 4), rnd() < 0.5 ? 1 : 0, Math.floor(rnd() * 3), rnd() < 0.5 ? 1 : 0];
    }
    return b;
  }
  function doorIn(r, b) { return DOOR_RULES[r](b); }
  GAMES.tuer = {
    local: true, daily: true,
    turns: [[{ w: "door", l: "tue_go", auto: true, secs: 60, streak: 4 }]],
    result: function (doc, m, lang) {
      var X = T(lang), a = m[0][0], k = a[0], order = doorOrder(doc), lines = [];
      for (var i = 0; i <= Math.min(k, DOOR_RULES.length - 1); i++) lines.push((i < k ? "✓ " : "✗ ") + pair(DATA.doorRules, order[i], lang));
      lines.push(fmt(X.tue_right, { n: a[1], m: a[2] }));
      return { h: fmt(X.tue_h, { n: k }), lines: lines };
    }
  };
  // ---------- one phone in the room: nothing leaves the device, the moves only pass from hand to hand ----------
  function offers(doc, lang) { return side(DATA.sets[doc.seed % DATA.sets.length], lang); }
  function struck(doc, m, lang) {
    var left = offers(doc, lang).map(function (x, i) { return i; });
    m.forEach(function (t) { left.splice(t[0][0], 1); });
    return left;
  }
  function strike() { return [{ w: "pick", l: "str_pick", n: 1, auto: true, from: function (doc, m, now, lang) { var o = offers(doc, lang); return struck(doc, m, lang).map(function (i) { return o[i]; }); } }]; }
  GAMES.streichen = {
    local: true, turns: [strike(), strike(), strike(), strike(), strike(), strike()],
    result: function (doc, m, lang) { var X = T(lang); return { h: fmt(X.str_h, { o: offers(doc, lang)[struck(doc, m, lang)[0]] }), lines: [X.str_note] }; }
  };
  GAMES.finger = {
    local: true, turns: [[{ w: "touch", l: "fin_pick", auto: true }]],
    result: function (doc, m, lang) { return { h: T(lang).fin_h, lines: [T(lang).fin_note] }; }
  };
  GAMES.erklaeren = {
    local: true, turns: [[{ w: "explain", l: "exp_go", auto: true, secs: 60, max: 99, list: function (doc, lang) { return mix(doc, "erkl", DATA.words.length).map(function (i) { return pair(DATA.words, i, lang); }); } }]],
    result: function (doc, m, lang) { return { h: fmt(T(lang).exp_h, { n: m[0][0] }), lines: [T(lang).exp_note] }; }
  };
  function sorryAsk(i) { return { w: "pick", l: "sor_" + (i + 1), n: 1, auto: true, from: function (doc, m, now, lang) { return alt(DATA.sorry[i], lang).split("|"); } }; }
  GAMES.sorry = {
    local: true, turns: [[sorryAsk(0), sorryAsk(1), sorryAsk(2)]],
    result: function (doc, m, lang) {
      var text = m[0].map(function (a, i) { return alt(DATA.sorry[i], lang).split("|")[a[0]]; }).join(" ");
      return { h: T(lang).sor_h, lines: [text], copy: text, note: T(lang).sor_note };
    }
  };
  // ---------- collecting money: the card only builds a PayPal.me link, the money never touches us ----------
  // Only the public PayPal.me name travels, and only the characters PayPal allows there. The total is in cents and is
  // split over 1 to 20 people: everyone pays the same whole-cent share, the cents left over (fewer than the people) stay
  // with whoever collects, and the card says so. EUR caps the share per person; a build flavor (adults) may raise it,
  // baked in at build time, a link cannot change it. Links from before the split ([name, what, euros]) still open.
  var PPME = /^[A-Za-z0-9]{1,20}$/, FL = root.DailyFlavor && root.DailyFlavor.eur, PAYERS = 20;
  var EUR = Array.isArray(FL) && FL.length === 2 && Number.isInteger(FL[0]) && Number.isInteger(FL[1]) && FL[0] >= 1 && FL[0] <= FL[1] && FL[1] <= 500 ? FL : [1, 50];
  function payName(v) { return typeof v === "string" && PPME.test(v); }
  function split(c, k) { var e = Math.floor(c / k); return { c: c, k: k, e: e, r: c - e * k }; }
  function moneyOk(c, k) { return intIn(k, 1, PAYERS) && intIn(c, EUR[0] * 100, EUR[1] * 100 * k) && split(c, k).e >= 1; }
  // "37,50", "37.5", "37 €" -> 3750; anything else -> null
  function parseCents(s) {
    var m = String(s == null ? "" : s).trim().match(/^(\d{1,5})(?:[.,](\d{1,2}))?\s*(?:€|eur)?$/i);
    return m ? +m[1] * 100 + (m[2] ? +(m[2] + "0").slice(0, 2) : 0) : null;
  }
  // The amount for a paypal.me link ("9.37"), or money as the language writes it ("9,37 €", "€9.37")
  function euros(c, lang) { return lang === "url" ? (c % 100 ? (c / 100).toFixed(2) : String(c / 100)) : C.money(c, lang); }
  function sam(m) { var a = m[0] || []; return { n: a[0], w: a[1], k: a[2], c: a[3] }; }
  function payLink(m) {
    var x = sam(m);
    return payName(x.n) && moneyOk(x.c, x.k) ? "https://paypal.me/" + x.n + "/" + euros(split(x.c, x.k).e, "url") + "EUR" : "";
  }
  function moneyLine(c, k, lang, bare) {
    var X = T(lang), p = split(c, k), s = bare ? "" : fmt(X.sam_share, { e: euros(p.e, lang) });
    if (k > 1) s = fmt(X.sam_split, { t: euros(c, lang), k: k }) + (s ? " · " + s : "");
    return p.r ? s + " · " + fmt(X.sam_rest, { r: p.r }) : s;
  }
  function payLine(m, lang) { var x = sam(m); return fmt(T(lang).sam_line, { e: euros(split(x.c, x.k).e, lang), w: x.w, n: x.n }); }
  function payLines(m, lang) { var x = sam(m); return x.k > 1 || split(x.c, x.k).r ? [payLine(m, lang), moneyLine(x.c, x.k, lang, true)] : [payLine(m, lang)]; }
  function payShare(m, lang) { var x = sam(m); return euros(split(x.c, x.k).e, lang); }
  GAMES.sammeln = {
    stay: true,
    turns: [
      [{ w: "text", l: "sam_name", max: 20, oneWord: true, hint: "sam_name_hint", adult: true, pref: "pp", bad: function (v) { return !payName(v); } },
       { w: "text", l: "sam_what", max: 30, hint: "sam_what_hint" },
       { w: "slide", l: "sam_who", min: 1, max: PAYERS, def: 1, unit: "👤" },
       { w: "money", l: "sam_eur", hint: "sam_eur_hint", ok: function (v, now) { return moneyOk(v, now[2]); }, line: function (v, now, lang) { return moneyLine(v, now[2], lang); } }],
      [{ w: "pay", l: "sam_pay", end: true, link: function (doc, m) { return payLink(m); }, share: payShare, more: function (m, lang) { return payLines(m, lang)[1] || ""; }, peek: function (doc, m, now, lang) { return payLine(m, lang); } }]
    ],
    // An older app (the store shell updates later) only reads [name, what, euros]: that form whenever it says everything.
    store: function (t, v) { return t === 0 && Array.isArray(v) && v.length === 4 && v[2] === 1 && v[3] % 100 === 0 && intIn(v[3] / 100, EUR[0], EUR[1]) ? [v[0], v[1], v[3] / 100] : v; },
    legacy: function (t, got) { return t === 0 && Array.isArray(got) && got.length === 3 && Number.isInteger(got[2]) && Math.abs(got[2]) < 1e6 ? [got[0], got[1], 1, got[2] * 100] : got; },
    face: function (doc, m, lang) { return m.length ? payLines(m, lang).concat([T(lang).sam_face]) : null; },
    result: function (doc, m, lang) { return { h: T(lang).sam_h, lines: payLines(m, lang), note: T(lang).sam_safe }; }
  };
  // ---------- a shopping list for the group: the whole list travels in the link, and every reply merges into what this phone knows ----------
  // A list is [people, items]. people: [[name, face]], face an index into FACES. items: [[text, t, qty, marks]]; t orders the items
  // (whoever adds puts the item after everything they saw), marks: [[person, x]] with x = version * 3 + s, s 0 nothing, 1 "I'll bring
  // it", 2 "bought". Merging is a union: one item per folded text (smaller t, larger quantity, smaller text on a tie), one mark per
  // item and person, the larger x wins: the later version, on equal versions the stronger state. So it does not matter in which
  // order replies arrive or how often the same one comes back. Nothing is ever deleted once it went out, so nothing comes back
  // from the dead either. Only the caps cut: whatever sorts last does not fit into a link.
  // The same machinery carries the task list from a protocol (todo below): there the number is a due day (0 = none),
  // marks mean "I'll do it" and "done". Every list function takes that config as an optional last argument.
  var SHOP = { items: 20, text: 24, people: 8, min: 1, qty: 99, ver: 999, t: 999, bytes: 560 }, FACES = ["🐸", "🦝", "🐙", "🦖", "🍕", "👽", "🤖", "👻", "🔥", "🌈", "🦄", "🐝"];
  function shopKey(s) { return Q.fold(s); }
  function shopBytes(v) { return new TextEncoder().encode(JSON.stringify(v)).length; }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function shopOk(v, cf) {
    var S = cf || SHOP;
    if (!Array.isArray(v) || v.length !== 2 || !Array.isArray(v[0]) || !Array.isArray(v[1])) return false;
    var P = v[0], I = v[1];
    if (P.length > S.people || !I.length || I.length > S.items || shopBytes(v) > S.bytes) return false;
    var okP = P.every(function (p) { return Array.isArray(p) && p.length === 2 && nameOk(p[0]) && intIn(p[1], 0, FACES.length - 1); });
    var okI = okP && I.every(function (it) {
      if (!Array.isArray(it) || it.length !== 4 || typeof it[0] !== "string" || Q.clean(it[0], S.text) !== it[0] || !shopKey(it[0])) return false;
      if (!intIn(it[1], 0, S.t) || !intIn(it[2], S.min, S.qty) || !Array.isArray(it[3])) return false;
      return it[3].every(function (k) { return Array.isArray(k) && k.length === 2 && intIn(k[0], 0, P.length - 1) && intIn(k[1], 1, S.ver * 3 + 2); }) && distinct(it[3].map(function (k) { return k[0]; }));
    });
    return okI && distinct(P.map(function (p) { return Q.fold(p[0]); })) && distinct(I.map(function (it) { return shopKey(it[0]); }));
  }
  // Into maps keyed by folded text and folded name, and back into the one order every phone builds.
  function shopOpen(list, into) {
    var o = into || { people: {}, items: {} };
    if (!list) return o;
    list[1].forEach(function (it) {
      var k = shopKey(it[0]), x = o.items[k];
      if (!x) x = o.items[k] = { text: it[0], t: it[1], qty: it[2], marks: {} };
      else { if (it[0] < x.text) x.text = it[0]; x.t = Math.min(x.t, it[1]); x.qty = Math.max(x.qty, it[2]); }
      it[3].forEach(function (m) { var pk = Q.fold(list[0][m[0]][0]); x.marks[pk] = Math.max(x.marks[pk] || 0, m[1]); });
    });
    list[0].forEach(function (p) { var pk = Q.fold(p[0]), x = o.people[pk]; if (!x) o.people[pk] = [p[0], p[1]]; else { if (p[0] < x[0]) x[0] = p[0]; x[1] = Math.min(x[1], p[1]); } });
    return o;
  }
  function shopClose(o, cf) {
    var S = cf || SHOP, keys = Object.keys(o.items).sort(function (a, b) { return o.items[a].t - o.items[b].t || cmp(a, b); }).slice(0, S.items);
    for (;;) {
      var used = Object.keys(o.people).filter(function (pk) { return keys.some(function (k) { return o.items[k].marks[pk] > 0; }); }).sort(cmp).slice(0, S.people);
      var v = [used.map(function (pk) { return o.people[pk].slice(); }), keys.map(function (k) {
        var x = o.items[k];
        return [x.text, x.t, x.qty, used.map(function (pk, i) { return [i, x.marks[pk] || 0]; }).filter(function (m) { return m[1] > 0; })];
      })];
      if (shopBytes(v) <= S.bytes || keys.length <= 1) return v;
      keys.pop();
    }
  }
  function shopMerge(a, b, cf) { return shopClose(shopOpen(b, shopOpen(a)), cf); }
  // "2× Milch", "2x Milch", "2 Milch": a count of 1 to 99 in front, the rest is the text.
  function shopParse(s) {
    var raw = String(s == null ? "" : s).trim(), m = raw.match(/^(\d{1,2})\s*[x×*]?\s+(\S.*)$/i) || raw.match(/^(\d{1,2})\s*[x×*]\s*(\S.*)$/i), qty = 1;
    if (m && +m[1] >= 1) { qty = +m[1]; raw = m[2]; }
    var text = Q.clean(raw, SHOP.text);
    return text && shopKey(text) ? { text: text, qty: qty } : null;
  }
  function shopMark(list, name, key) { var at = -1, pk = Q.fold(name); list[0].forEach(function (p, i) { if (Q.fold(p[0]) === pk) at = i; }); var it = list[1].filter(function (x) { return shopKey(x[0]) === key; })[0], m = it && it[3].filter(function (k) { return k[0] === at; })[0]; return m ? m[1] : 0; }
  // One person's changes on top of what they got: new items after everything they saw, then their own marks, each one version
  // above the mark they got, so the change wins against what they saw and loses against what someone else did later.
  function shopApply(base, e, cf) {
    var S = cf || SHOP, o = shopOpen(base), t = 0, pk = nameOk(e.name) ? Q.fold(e.name) : "";
    Object.keys(o.items).forEach(function (k) { t = Math.max(t, o.items[k].t + 1); });
    (e.adds || []).forEach(function (a) { shopOpen([[], [[a.text, Math.min(S.t, t++), a.qty, []]]], o); });
    if (pk) {
      if (!o.people[pk]) o.people[pk] = [e.name, intIn(e.face, 0, FACES.length - 1) ? e.face : 0];
      Object.keys(e.marks || {}).forEach(function (k) {
        var s = e.marks[k], had = base ? shopMark(base, e.name, k) : 0;
        if (!o.items[k] || !intIn(s, 0, 2) || (had ? had % 3 === s : s === 0)) return;
        o.items[k].marks[pk] = Math.min(S.ver, Math.floor(had / 3) + 1) * 3 + s;
      });
    }
    return shopClose(o, S);
  }
  // A task list shows the text alone (its number is the due day, label stays the text); a shopping list "2× Milch".
  function shopRows(list, cf) {
    return list[1].map(function (it) {
      var who = function (s) { return it[3].filter(function (m) { return m[1] % 3 === s; }).map(function (m) { return list[0][m[0]]; }); };
      return { key: shopKey(it[0]), text: it[0], qty: it[2], label: (cf && cf.due) || it[2] <= 1 ? it[0] : it[2] + "× " + it[0], due: cf && cf.due ? it[2] : 0, bought: who(2), bring: who(1) };
    });
  }
  function shopDone(list) { return !!list && list[1].length > 0 && shopRows(list).every(function (r) { return r.bought.length > 0; }); }
  function shopCount(list, lang, cf) {
    var r = shopRows(list, cf);
    return fmt(T(lang)[cf && cf.due ? "tdo_count" : "ein_count"], { n: r.length, b: r.filter(function (x) { return x.bought.length; }).length, c: r.filter(function (x) { return !x.bought.length && x.bring.length; }).length });
  }
  function shopNames(l) { return l.map(function (p) { return p[0]; }).join(", "); }
  GAMES.einkauf = {
    snap: true,           // the link holds the list as it is now, not the way there
    turns: [[{ w: "shop", l: "ein_make", live: true }], [{ w: "shop", l: "ein_go", live: true }]],
    ends: function (doc, m) { return m.length > 0 && shopDone(m[0][0]); },
    words: { you_start: "ein_start", go_first: "ein_go_first", go_play: "ein_go_play", note_turn: "ein_note", note_over: "ein_over", ready: "ein_ready", send: "ein_send", rematch: "ein_again" },
    face: function (doc, m, lang) { return m.length ? [shopCount(m[0][0], lang)] : null; },
    result: function (doc, m, lang) {
      var X = T(lang);
      return { h: X.ein_done_h, lines: shopRows(m[0][0]).map(function (r) { return fmt(X.ein_line, { s: r.label, n: shopNames(r.bought) }); }) };
    }
  };
  GAMES.einkauf.list = SHOP;

  // ---------- a wish list (widget "wish", part turnzwei): the wisher never sees a mark, her own link has the wishes only ----------
  // A mark is the shopping list's "bring" (1): "I give this". The page names no giver, not even to the family.
  var WISH = { items: 10, text: 32, people: 10, min: 1, qty: 1, ver: 999, t: 999, bytes: 600, wish: true };
  function wishBare(v) { return [[], v[1].map(function (it) { return [it[0], it[1], 1, []]; })]; }
  function wishCount(v, lang) { return fmt(C.form(T(lang), "wun_count", v[1].length, lang), { n: v[1].length }); }
  GAMES.wunsch = {
    snap: true, list: WISH,
    turns: [[{ w: "wish", l: "wun_make", live: true, k: "wun", cfg: WISH }], [{ w: "wish", l: "wun_go", live: true, k: "wun", cfg: WISH }]],
    // Over only once the wisher's phone closed it (o: 2, see close), never because every wish has a giver: that would tell her.
    ends: function (doc, m) { return m.length > 0 && doc.o === 2; }, close: 2,
    words: { you_start: "wun_start", go_first: "wun_go_first", go_play: "wun_go_play", note_turn: "wun_note", note_over: "wun_over", ready: "wun_ready", send: "inv_send", rematch: "wun_again" },
    face: function (doc, m, lang) { return m.length ? [wishCount(m[0][0], lang)] : null; },
    result: function (doc, m, lang) { return { h: T(lang).wun_done_h, lines: shopRows(m[0][0], WISH).map(function (r) { return r.label; }) }; },
    wsw: { link: ["text", "name"], tage: 0 }, notes: ["wun_secret"]
  };
  // ---------- gifts in three questions: whom, how much, two likes -> five ideas (widgets "opts", "ideas"), a second vote ----------
  // Lists, labels and the optional AI live in the part turnzwei; the link carries the five texts shown and the one tapped.
  var GIFT = { who: ["kind", "teen", "partner", "eltern", "oma", "freund", "kollege"], likes: ["tee", "pflanze", "lesen", "kochen", "spiel", "musik", "basteln", "sport", "technik", "reisen", "gemuet", "suess"] };
  function upTo(n, lang) { return fmt(T(lang).gf_upto, { n: C.money(n * 100, lang) }); }
  function giftLast(m) { return m[0][m[0].length - 1]; }
  function giftGame(euro, who, extra) {
    var o = who ? 1 : 0, ask = who ? [{ w: "opts", l: "gf_who", n: 1, auto: true, keys: GIFT.who, pre: "gfw_" }] : [];
    ask.push({ w: "pick", l: "gf_budget", n: 1, auto: true, from: function (doc, m, now, lang) { return euro.map(function (n) { return upTo(n, lang); }); } },
      { w: "opts", l: "gf_like", n: 2, keys: GIFT.likes, pre: "gfl_" },
      { w: "ideas", l: "gf_ideas", ask: function (now) { return { who: who ? GIFT.who[now[0][0]] : "kollege", euro: euro[now[o][0]], likes: now[o + 1].map(function (i) { return GIFT.likes[i]; }) }; } });
    return Object.assign({
      turns: [ask, [{ w: "pick", l: "gf_fav", n: 1, auto: true, top: function (doc, m, lang) { var x = giftLast(m); return fmt(T(lang).gf_their, { s: x[0][x[1]] }); }, from: function (doc, m) { return giftLast(m)[0]; } }]],
      words: { you_start: "gf_start", go_first: "gf_go_first", go_play: "gf_go_play", note_turn: "gf_note", note_over: "gf_over", ready: "gf_ready", send: "inv_send", rematch: "gf_again" },
      face: function (doc, m, lang) { if (!m.length) return null; var x = giftLast(m); return [fmt(T(lang).gf_face, { s: x[0][x[1]] }), upTo(euro[m[0][o][0]], lang)]; },
      result: function (doc, m, lang) {
        var X = T(lang), x = giftLast(m), a = x[0][x[1]], b = x[0][m[1][0][0]];
        return { h: a === b ? fmt(X.gf_same, { s: a }) : X.gf_two, lines: (a === b ? [] : [fmt(X.gf_first, { s: a }), fmt(X.gf_second, { s: b })]).concat([upTo(euro[m[0][o][0]], lang)]), open: who ? { i: "zug-sammeln", l: "gf_pool" } : null };
      },
      wsw: { link: ["text"], ki: "opt", tage: 0 }, notes: ["gf_lang"]
    }, extra);
  }
  GAMES.geschenk = giftGame([10, 20, 30, 50], true);

  // ---------- tasks from a meeting (the card itself is in office.js): the shopping list's links and merging, a due
  // day per task. Marks: 1 "I'll do it", 2 "done". A person is only named where the protocol named them for that task.
  var TODO = { items: 12, text: 48, people: 8, min: 0, qty: 99999, ver: 999, t: 999, bytes: 540, due: true };
  function todoNames(l) { return l.map(function (p) { return p[0]; }).join(", "); }
  function dueText(day, lang) { return day ? fmt(T(lang).tdo_due, { d: dayText(day, lang) }) : ""; }
  // The hand-over from the protocol page: { t: title, i: [[what, who, due day]] } -> a list that fits a link, and how
  // many tasks did not make it (filtered text, no room). A name only stands where the protocol gave one.
  // "… bis Freitag" / "… by 14.11." at the very end, when the deadline came as a day anyway: a separate word, then a day the
  // protocol page can read (dueDay). "Lobby", "Ruby" or "Tische 1 bis 5 aufstellen" stay as they are.
  var DUE_DAY = "(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?:s|morgens?|vormittags?|mittags?|nachmittags?|abends?|nachts?)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday" +
    "|übermorgen|morgen|heute|tomorrow|today|eod|woche|week|wochenende|weekend|monatsende|monat|month|kw ?\\d{1,2}|\\d{1,2}\\.\\s?\\d{1,2}\\.?(?:\\s?\\d{2,4})?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)";
  var DUE_TAIL = new RegExp("(?:^|[\\s(,;–-])\\s*[(,;–-]?\\s*(?:bis|by)\\s+(?:(?:spätestens|zum|zur|am|kommenden?|nächsten?|naechsten?|diesen?|next|this|the|end of|ende(?: der| des| dieser)?)\\s+)*" +
    DUE_DAY + "(?:\\s+(?:morgen|früh|mittag|abend|morning|noon|evening|\\d{1,2}(?::\\d{2})?\\s?uhr))?[\\s.)]*$", "iu");
  function todoFrom(o) {
    o = o && typeof o === "object" ? o : {};
    var items = (Array.isArray(o.i) ? o.i : []).slice(0, 20), people = [], adds = [], marks = [], lost = 0;
    items.forEach(function (x, i) {
      x = Array.isArray(x) ? x : [];
      var due = intIn(x[2], 1, TODO.qty) ? x[2] : 0, text = Q.clean(due ? String(x[0] || "").replace(DUE_TAIL, "") : String(x[0] || ""), TODO.text);
      if (!text || !shopKey(text) || adds.some(function (a) { return shopKey(a[0]) === shopKey(text); })) { lost++; return; }
      var full = typeof x[1] === "string" ? x[1].trim() : "", who = nameOk(full) ? full : full.split(/\s+/)[0];   // too long: the first name
      if (who && nameOk(who)) {
        var at = people.map(function (p) { return Q.fold(p[0]); }).indexOf(Q.fold(who));
        if (at < 0 && people.length < TODO.people) { people.push([who, people.length % FACES.length]); at = people.length - 1; }
        if (at >= 0) marks.push([adds.length, at]);
      }
      adds.push([text, adds.length, due, []]);
    });
    if (!adds.length) return { list: null, lost: lost, t: "" };
    marks.forEach(function (m) { adds[m[0]][3].push([m[1], 1]); });
    var v = shopClose(shopOpen([people, adds]), TODO);
    return { list: shopOk(v, TODO) ? v : null, lost: lost + adds.length - (v ? v[1].length : 0), t: Q.clean(o.t, 40) || "" };
  }
  // RFC 5545 3.1: a content line longer than 75 octets goes on in lines that start with a space; never inside a UTF-8 character.
  function icsFold(line) {
    var out = [], cur = "", n = 0, max = 75;
    Array.from(line).forEach(function (ch) {
      var b = new TextEncoder().encode(ch).length;
      if (n + b > max) { out.push(cur); cur = " "; n = 1; max = 75; }
      cur += ch; n += b;
    });
    out.push(cur);
    return out.join("\r\n");
  }
  // .ics with one all-day entry per open task that has a due day; nothing about who else is on the list.
  function todoIcs(list, title, lang, stamp) {
    var X = T(lang), d8 = function (day) { return new Date(day * DAY).toISOString().slice(0, 10).replace(/-/g, ""); };
    var esc = function (v) { return String(v).replace(/[\\;,]/g, function (c) { return "\\" + c; }).replace(/\n/g, "\\n"); };
    var now = new Date(stamp || Date.now()).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z", ev = [];
    shopRows(list, TODO).forEach(function (r, i) {
      if (!r.due || r.bought.length) return;
      ev.push("BEGIN:VEVENT", "UID:todo-" + C.hash32(title + "|" + r.key + "|" + r.due) + "@bunsenbrenner.org", "DTSTAMP:" + now,
        "DTSTART;VALUE=DATE:" + d8(r.due), "DTEND;VALUE=DATE:" + d8(r.due + 1),
        "SUMMARY:" + esc(r.text + (r.bring.length ? " (" + todoNames(r.bring) + ")" : "")), "DESCRIPTION:" + esc(title || X.tdo_title), "END:VEVENT");
    });
    if (!ev.length) return "";
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//My Daily Idea//Aufgaben//DE", "CALSCALE:GREGORIAN"].concat(ev, ["END:VCALENDAR"]).map(icsFold).join("\r\n") + "\r\n";
  }
  // The next meeting's agenda from what is still open, without AI: a look back, the open tasks, room for new points.
  function todoAgenda(list, title, lang) {
    var X = T(lang), rows = shopRows(list, TODO), open = rows.filter(function (r) { return !r.bought.length; }), out = [fmt(X.tdo_agenda_h, { t: title || X.tdo_title })], n = 1;
    out.push(n++ + ". " + fmt(X.tdo_agenda_back, { b: rows.length - open.length, n: rows.length }));
    open.forEach(function (r) {
      var who = r.bring.length ? todoNames(r.bring) : X.tdo_open, due = r.due ? ", " + dueText(r.due, lang) : "";
      out.push(n++ + ". " + fmt(X.tdo_agenda_item, { s: r.text, w: who, d: due }));
    });
    out.push(n + ". " + X.tdo_agenda_new);
    return out.join("\n");
  }

  GAMES.kapsel.gateFrom = 1;
  // Team-Quiz and Typen-Quiz only run with a question pack (quizpack.js, doc.pk); without one no answer is ever valid.
  GAMES.quiz = { needs: true, turns: [[{ w: "pk", l: "pk_need" }]], result: function () { return { h: "", lines: [] }; } };
  GAMES.typen = { needs: true, turns: [[{ w: "pk", l: "pk_need" }]], result: function () { return { h: "", lines: [] }; } };
  // The game as this doc plays it: with a pack that fits, the pack's turns (QuizPack.game), else the card's own.
  function game(doc) { return (doc.pk && P.game(doc)) || GAMES[doc.g]; }
  var IDS = Object.keys(GAMES);
  function dealLine(doc, offer, floor, i, lang) {
    var X = T(lang), w = things(doc, lang);
    return fmt(offer >= floor ? X.deal_ok : X.deal_no, { w: w, o: 10 - offer, f: offer, m: floor, who: i ? X.second : X.first });
  }

  // ---------- the seal: moves in a link are not readable at a glance. Anyone who decodes it can still look; it is a game. ----------
  function stream(seed, n) { var r = C.mulberry32(C.hash32("seal|" + seed)), o = new Uint8Array(n); for (var i = 0; i < n; i++) o[i] = Math.floor(r() * 256); return o; }
  function seal(moves, seed) {
    var b = new TextEncoder().encode(JSON.stringify(moves)), k = stream(seed, b.length), s = "";
    b.forEach(function (x, i) { s += String.fromCharCode(x ^ k[i]); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unseal(blob, seed) {
    if (typeof blob !== "string" || !blob || !BLOB.test(blob)) return [];
    try {
      var bin = atob(blob.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - blob.length % 4) % 4)), k = stream(seed, bin.length);
      var raw = Uint8Array.from(bin, function (c, i) { return c.charCodeAt(0) ^ k[i]; });
      var m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      return Array.isArray(m) ? m : [];
    } catch (e) { return []; }
  }
  // A link can be built by hand: every answer has to be one the screen could have given.
  function intIn(v, a, b) { return Number.isInteger(v) && v >= a && v <= b; }
  function distinct(a) { return new Set(a).size === a.length; }
  function okAnswer(p, v, doc, lang, m, now) {
    if (p.bytes && Array.isArray(v) && new TextEncoder().encode(v.join("")).length > p.bytes) return false;   // the whole game has to fit into the link
    if (p.check) return !!p.check(v, doc, m || [], now || []);   // a prompt of a card from the part turnzwei checks itself (src/feier.js)
    if (p.w === "show" || p.w === "touch" || p.w === "clock" || p.w === "blow") return v === 0;
    if (p.w === "hunt") return intIn(v, 1, p.max);
    if (p.w === "drop") return intIn(v, 0, p.max);
    if (p.w === "doors") return v === 0;
    if (p.w === "freeze") return intIn(v, 0, p.max);
    if (p.w === "rec" || p.w === "once" || p.w === "parrot" || p.w === "pay") return v === 0;
    if (p.w === "slots" || p.w === "vote" || p.w === "bw") return p.ok(v, m);
    if (p.w === "shop" || p.w === "wish") return shopOk(v, p.cfg);
    if (p.w === "opts") return Array.isArray(v) && v.length === p.n && distinct(v) && v.every(function (x) { return intIn(x, 0, p.keys.length - 1); });
    if (p.w === "whose") return intIn(v, 0, 2);
    if (p.w === "inner") return Array.isArray(v) && v.length === 5 && v.every(function (x) { return Number.isInteger(x) && x >= -20000 && x <= 20000; });
    if (p.w === "blind") return intIn(v, 2000, 30000);
    if (p.w === "nim") return v === 0 || v === 1;
    if (p.w === "react") return intIn(v, 0, 60000);
    if (p.w === "door") return Array.isArray(v) && v.length === 3 && intIn(v[0], 0, 10) && intIn(v[2], 0, 999) && intIn(v[1], 0, v[2]);
    if (p.w === "voices") return intIn(v, 0, p.rounds);
    if (p.w === "grid") return Array.isArray(v) && v.length === p.n && distinct(v) && v.every(function (x) { return intIn(x, 0, 24); });
    if (p.w === "probe") { var old = p.before(doc, m); return Array.isArray(v) && v.length >= 1 && v.length <= p.n && distinct(v.concat(old)) && v.every(function (x) { return intIn(x, 0, 24); }); }
    if (p.w === "explain") return intIn(v, 0, p.max);
    if (p.w === "blocks") return Array.isArray(v) && v.length <= p.max && v.every(function (x) { return intIn(x, 0, 63); }) && !!replay(doc, v);
    if (p.w === "slide") return intIn(v, p.min || 0, p.maxOf ? p.maxOf(doc) : p.max);
    if (p.w === "money") return Number.isInteger(v) && p.ok(v, now || []);
    if (p.w === "text") return typeof v === "string" && !!Q.clean(v, p.max) && Q.clean(v, p.max) === v && !(p.oneWord && /\s/.test(v)) && !(p.bad && p.bad(v, doc, lang, m));
    if (p.w === "list" && p.loose) return Array.isArray(v) && v.length === p.n && (!p.least || (v.filter(Boolean).length >= p.least && distinct(v.filter(Boolean).map(Q.fold)))) && v.every(function (x) { return x === "" || (typeof x === "string" && Q.clean(x, p.max) === x); });
    if (p.w === "list") return Array.isArray(v) && v.length === p.n && v.every(function (x) { return typeof x === "string" && !!Q.clean(x, p.max) && Q.clean(x, p.max) === x; }) && (p.same || distinct(v.map(Q.fold)));
    var n = p.from ? p.from(doc, m, now, lang).length : 0;
    if (p.w === "ideas") return Array.isArray(v) && v.length === 2 && Array.isArray(v[0]) && v[0].length >= 1 && v[0].length <= 5 && distinct(v[0].map(Q.fold)) && v[0].every(function (x) { return typeof x === "string" && !!Q.clean(x, 40) && Q.clean(x, 40) === x; }) && intIn(v[1], 0, v[0].length - 1);
    if (p.w === "day") return intIn(v, 20000, 30000);
    if (p.w === "pick") return Array.isArray(v) && v.length === p.n && distinct(v) && v.every(function (x) { return intIn(x, 0, n - 1); });
    if (p.w === "rank") return Array.isArray(v) && v.length === n && distinct(v) && v.every(function (x) { return intIn(x, 0, n - 1); });
    if (p.w === "alloc") return Array.isArray(v) && v.length === n && v.every(function (x) { return intIn(x, 0, p.sum) && x % p.step === 0; }) && v.reduce(function (a, b) { return a + b; }, 0) <= p.sum;
    return false;
  }
  function checked(doc, raw) {
    var g = game(doc), out = [];
    for (var t = 0; t < raw.length && t < g.turns.length && !(g.ends && g.ends(doc, out)); t++) {
      var want = g.turns[t], got = g.legacy ? g.legacy(t, raw[t]) : raw[t];
      if (!Array.isArray(got) || got.length !== want.length) return out;
      for (var i = 0; i < want.length; i++) if (!okAnswer(want[i], got[i], doc, "de", out, got.slice(0, i))) return out;
      out.push(got);
    }
    return out;
  }
  function sanitize(o, d) {
    d.g = IDS.indexOf(o.g) >= 0 ? o.g : IDS[0];
    d.seed = Math.floor(C.clampNum(o.seed, 0, 4294967295, 1));
    d.q = typeof o.q === "string" && BLOB.test(o.q) ? o.q : "";
    d.f = SHAPES.indexOf(o.f) >= 0 ? o.f : SHAPES[0];
    var w = Q.clean(o.w, 14); if (w) d.w = w;
    if (typeof o.o === "number" && intIn(o.o, 0, 99999)) d.o = o.o;
    var pk = P.sanitize(o.pk); if (pk && P.fits(d.g, pk)) d.pk = pk;
    return d;
  }
  function fromIdea(idea, lang, base) { base.g = idea.turn.g; base.seed = C.hash32("turn-" + idea.id); base.q = ""; base.f = idea.turn.f; if (idea.turn.w) base.w = (idea.turn.w[lang] || idea.turn.w.de); return base; }
  function moves(doc) { return checked(doc, unseal(doc.q, doc.seed)); }
  function state(doc) {
    var g = game(doc), m = moves(doc), over = m.length >= g.turns.length || !!(g.ends && g.ends(doc, m));
    return { moves: m, turn: m.length, total: g.turns.length, who: m.length % 2, over: over, prompts: over ? [] : g.turns[m.length] };
  }
  // The next doc, or null if the answers do not fit the turn.
  function play(doc, answers, today) {
    var st = state(doc); if (st.over || answers.length !== st.prompts.length) return null;
    for (var i = 0; i < answers.length; i++) if (!okAnswer(st.prompts[i], answers[i], doc, "de", st.moves, answers.slice(0, i))) return null;
    var d = JSON.parse(JSON.stringify(doc));
    var g = game(d), out = g.snap ? st.moves.slice(0, g.snap === true ? 0 : g.snap).concat([answers]) : st.moves.concat([answers]);
    if (g.list && g.list.wish) delete d.o;   // the wisher's own link (o: 1) never goes on as the family's
    d.q = seal(g.store ? out.map(function (x, t) { return g.store(t, x); }) : out, d.seed);
    if (g.gateFrom && st.turn === 0) d.o = today + answers[1];
    return d;
  }
  function result(doc, lang) { var st = state(doc); return st.over ? game(doc).result(doc, st.moves, lang) : null; }
  function gate(doc, today) {
    var g = game(doc), at = g.gate ? g.gate(doc, moves(doc)) : 0, left = at ? at - today : 0;
    return left > 0 ? left : 0;
  }
  function face(doc, lang) { var g = game(doc); return g.face ? g.face(doc, moves(doc), lang) : null; }
  function whole(doc, lang) { var g = game(doc); return g.peekWhole ? g.peekWhole(doc, moves(doc), lang) : ""; }
  // A game the owner ends by hand (GAMES[g].close): the same list, marked closed outside the moves; null if there is nothing to close.
  function close(doc) { var g = game(doc), st = state(doc); if (!g.close || st.over || !st.turn) return null; var d = JSON.parse(JSON.stringify(doc)); d.o = g.close; return d; }
  function fresh(doc, seed) { var d = JSON.parse(JSON.stringify(doc)); d.seed = seed >>> 0; d.q = ""; delete d.o; return d; }
  function today(date) { return Math.floor((date || new Date()).getTime() / DAY); }
  function strings() {
    var out = [];
    (function walk(v) { if (typeof v === "string") v.split("|").forEach(function (x) { out.push(x); }); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.keys(v).forEach(function (k) { walk(v[k]); }); })(DATA);
    return out;
  }
  var api = { game: game, HOURS: HOURS, dayText: dayText, hourText: hourText, slotText: slotText, termDates: termDates, voted: voted, doorOrder: doorOrder, doorBeing: doorBeing, doorIn: doorIn, nimMove: nimMove, sockAnswer: sockAnswer, glyphs: glyphs, IDS: IDS, SHAPES: SHAPES, GAMES: GAMES, T: T, sanitize: sanitize, fromIdea: fromIdea, seal: seal, unseal: unseal, moves: moves, state: state, play: play, result: result, close: close, gate: gate, face: face, whole: whole, payLink: payLink, parseCents: parseCents, euros: euros, split: split, moneyLine: moneyLine, PAYERS: PAYERS, SHOP: SHOP, WISH: WISH, wishBare: wishBare, GIFT: GIFT, giftGame: giftGame, upTo: upTo, FACES: FACES, nameOk: nameOk, shopOk: shopOk, shopMerge: shopMerge, shopApply: shopApply, shopParse: shopParse, shopRows: shopRows, shopMark: shopMark, shopKey: shopKey, shopDone: shopDone, shopCount: shopCount, TODO: TODO, todoFrom: todoFrom, todoIcs: todoIcs, todoAgenda: todoAgenda, dueText: dueText, fresh: fresh, today: today, SIZE: SIZE, blockAt: blockAt, fits: fits, drop: drop, replay: replay, canMove: canMove, okAnswer: okAnswer, strings: strings };
  if (node) module.exports = api; else root.Turns = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
