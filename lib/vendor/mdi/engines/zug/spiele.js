// Altregeln der Z1-Karten, woertlich aus turns.js (Tag pre-legacy-removal) uebertragen. Jeder Eintrag ist ein alter
// GAMES-Eintrag mit derselben Prompt-Signatur (doc, m, now, lang). Zeilenangaben je Spiel beziehen sich auf turns.js.
import DATA from "./turn.json" with { type: "json" };
import GTEXT from "./geschenke.json" with { type: "json" };
import { textsFor, fmt, pair, alt, side, mix, hash32, mulberry32, fold, intIn, money, form, civil, weekday } from "./alt.js";
import * as G from "./geld.js";
import * as L from "./merge.js";
import { ideas as giftIdeas, ok as giftOk } from "./geschenke.js";
import { okAnswer as okBase } from "./check.js";
const okIdeas = (v) => okBase({ w: "ideas" }, v);

export const TEXT = { de: { ...DATA.text.de, ...GTEXT.de }, en: { ...DATA.text.en, ...GTEXT.en } };
export function T(lang) { return textsFor(TEXT, lang); }
export { DATA };
function listOf(k) { return (doc, m, now, lang) => DATA[k].map((x, i) => pair(DATA[k], i, lang)); }
function places(order) { const p = []; order.forEach((o, at) => { p[o] = at; }); return p; }

// ---------- einig (turns.js:54-69) ----------
const einig = {
  turns: [
    [{ w: "list", l: "einig_list", n: 5, max: 16 }, { w: "rank", l: "einig_rank", from: (doc, m, now) => now[0] }],
    [{ w: "rank", l: "einig_rank", from: (doc, m) => m[0][0] }]
  ],
  result(doc, m, lang) {
    const X = T(lang), opts = m[0][0], pa = places(m[0][1]), pb = places(m[1][0]), tie = mix(doc.seed, "einig", 5);
    let best = -1, score = null;
    opts.forEach((o, i) => { const worst = Math.max(pa[i], pb[i]), sum = pa[i] + pb[i], s = worst * 100 + sum * 10 + tie.indexOf(i); if (score === null || s < score) { score = s; best = i; } });
    let fight = 0, far = -1;
    opts.forEach((o, i) => { const d = Math.abs(pa[i] - pb[i]); if (d > far) { far = d; fight = i; } });
    return { h: fmt(X.einig_win, { o: opts[best] }), lines: far > 0 ? [fmt(X.einig_fight, { o: opts[fight] })] : [X.einig_same] };
  }
};
// ---------- rangliste (turns.js:514-525) ----------
function tiers(doc, lang) { return side(DATA.tiers[doc.seed % DATA.tiers.length], lang); }
const rangliste = {
  turns: [
    [{ w: "rank", l: "ran_go", from: (doc, m, now, lang) => tiers(doc, lang) }],
    [{ w: "rank", l: "ran_go", from: (doc, m, now, lang) => tiers(doc, lang) }]
  ],
  result(doc, m, lang) {
    const X = T(lang), l = tiers(doc, lang), a = places(m[0][0]), b = places(m[1][0]);
    let far = 0, sum = 0;
    l.forEach((x, i) => { const d = Math.abs(a[i] - b[i]); sum += d; if (d > Math.abs(a[far] - b[far])) far = i; });
    const n = Math.round((1 - sum / 32) * 100);
    return { h: fmt(X.ran_h, { n }), lines: [fmt(X.ran_top, { w: X.first, o: l[m[0][0][0]] }), fmt(X.ran_top, { w: X.second, o: l[m[1][0][0]] }), sum ? fmt(X.ran_far, { o: l[far] }) : X.ran_same] };
  }
};
// ---------- kapsel (turns.js:120-131, gateFrom turns.js:1104) ----------
const kapsel = {
  gateFrom: 1,
  turns: [
    [{ w: "pick", l: "kap_pick", n: 1, from: (doc, m, now, lang) => DATA.fates.map((x, i) => pair(DATA.fates, i, lang)) }, { w: "slide", l: "kap_days", min: 1, max: 30, def: 7 }],
    [{ w: "pick", l: "kap_true", n: 1, from: (doc, m, now, lang) => [T(lang).yes, T(lang).no] }]
  ],
  gate: (doc, m) => (m.length === 1 ? doc.o : 0),
  peekWhole: (doc, m, lang) => (m.length === 1 ? pair(DATA.fates, m[0][0][0], lang) : ""),
  result(doc, m, lang) { const X = T(lang); return { h: m[1][0][0] === 0 ? X.kap_right : X.kap_wrong, lines: [pair(DATA.fates, m[0][0][0], lang)] }; }
};
// ---------- post (turns.js:618-627) ----------
const post = {
  gateFrom: 1,
  turns: [[{ w: "list", l: "pst_say", n: 3, max: 40, hints: (lang) => DATA.postStarts.map((x, i) => pair(DATA.postStarts, i, lang)) }, { w: "slide", l: "pst_days", min: 7, max: 30, def: 30 }],
    [0, 1, 2].map((i) => ({ w: "pick", l: "pst_true", n: 1, auto: true, top: (doc, m) => m[0][0][i], from: (doc, m, now, lang) => [T(lang).pst_yes, T(lang).pst_no] }))],
  gate: (doc, m) => (m.length === 1 ? doc.o : 0),
  result(doc, m, lang) {
    const X = T(lang), n = m[1].filter((a) => a[0] === 0).length;
    return { h: fmt(X.pst_h, { n }), lines: m[0][0].map((s, i) => (m[1][i][0] === 0 ? "✓ " : "✗ ") + s) };
  }
};
// ---------- gutschein, rubbellos, urkunde (turns.js:238-255) ----------
const gutschein = {
  turns: [[{ w: "pick", n: 3, l: "gut_pick", from: listOf("vouchers") }],
    [{ w: "pick", n: 1, l: "gut_take", from: (doc, m, now, lang) => m[0][0].map((i) => pair(DATA.vouchers, i, lang)) }]],
  result(doc, m, lang) { const X = T(lang), l = m[0][0].map((i) => pair(DATA.vouchers, i, lang)); return { h: X.gut_h, lines: [fmt(X.gut_used, { w: l[m[1][0][0]] })] }; }
};
function fields(doc, m, now, lang) { return [1, 2, 3, 4, 5, 6].map((n) => fmt(T(lang).rub_field, { n })); }
const rubbellos = {
  turns: [[{ w: "pick", n: 1, l: "rub_prize", from: listOf("prizes") }, { w: "pick", n: 1, l: "rub_hide", from: fields }], [{ w: "pick", n: 3, l: "rub_try", from: fields }]],
  result(doc, m, lang) {
    const X = T(lang), at = m[0][1][0];
    return m[1][0].indexOf(at) >= 0 ? { h: fmt(X.rub_win, { w: pair(DATA.prizes, m[0][0][0], lang) }), lines: [fmt(X.rub_was, { n: at + 1 })] } : { h: X.rub_lose, lines: [fmt(X.rub_was, { n: at + 1 })] };
  }
};
const urkunde = {
  local: true, turns: [[{ w: "pick", n: 1, l: "urk_what", from: listOf("awards") }, { w: "slide", l: "urk_a", min: 0, max: 10, def: 5 }, { w: "slide", l: "urk_b", min: 0, max: 10, def: 5 }, { w: "slide", l: "urk_c", min: 0, max: 10, def: 5 }]],
  result(doc, m, lang) { const X = T(lang), sum = m[0][1] + m[0][2] + m[0][3]; return { h: fmt(X.urk_h, { r: X["urk_" + (sum >= 24 ? 3 : sum >= 16 ? 2 : sum >= 8 ? 1 : 0)] }), lines: [pair(DATA.awards, m[0][0][0], lang)] }; }
};
// ---------- morgen, umschlag (turns.js:270-285) ----------
const morgen = {
  gateFrom: 1,
  turns: [[{ w: "pick", n: 1, l: "mor_pick", from: listOf("lifts") }, { w: "slide", l: "mor_days", min: 1, max: 7, def: 1 }], [{ w: "show", l: "mor_open", list: (doc, m, now, lang) => [pair(DATA.lifts, m[0][0][0], lang)] }]],
  gate: (doc, m) => (m.length === 1 ? doc.o : 0),
  result(doc, m, lang) { return { h: T(lang).mor_h, lines: [pair(DATA.lifts, m[0][0][0], lang)] }; }
};
function envs(lang) { return side(DATA.envs[0], lang); }
const umschlag = {
  turns: [[{ w: "text", l: "env_a", max: 44 }, { w: "text", l: "env_b", max: 44 }, { w: "text", l: "env_c", max: 44 }],
    [{ w: "pick", n: 1, l: "env_pick", from: (doc, m, now, lang) => envs(lang) }]],
  result(doc, m, lang) { const i = m[1][0][0]; return { h: envs(lang)[i], lines: [m[0][i]] }; }
};
// ---------- wichteln (turns.js:493-512) ----------
function drawNames(m) { return m[0][0].filter(Boolean); }
function drawn(doc, n) {
  const r = mulberry32(hash32("wichtel|" + doc.seed)), a = [], to = [];
  for (let i = 0; i < n; i++) a.push(i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * i); const x = a[i]; a[i] = a[j]; a[j] = x; }
  a.forEach((v, at) => { to[v] = a[(at + 1) % n]; });
  return to;
}
const wichteln = {
  stay: true,
  turns: [
    [{ w: "list", l: "wic_names", n: 12, max: 12, loose: true, least: 3 }],
    [{ w: "pick", l: "wic_me", n: 1, auto: true, from: (doc, m) => drawNames(m) },
      { w: "show", l: "wic_you", list: (doc, m, now) => { const n = drawNames(m); return [n[drawn(doc, n.length)[now[0][0]]]]; } }]
  ],
  result(doc, m, lang) { return { h: T(lang).wic_h, lines: [T(lang).wic_note] }; }
};
// ---------- reihum, kerzen (turns.js:534-599) ----------
function signedLine(x, lang) { return pair(DATA.starts, x[0][0], lang) + " " + x[1] + " (" + x[2] + ")"; }
function signedSoFar(m, lang) { return m.map((x) => signedLine(x, lang)).join(" · "); }
function signTurn() {
  return [
    { w: "pick", l: "rei_start", n: 1, auto: true, peek: (doc, m, now, lang) => signedSoFar(m, lang) || T(lang).rei_first, from: (doc, m, now, lang) => DATA.starts.map((x, i) => pair(DATA.starts, i, lang)) },
    { w: "text", l: "rei_line", max: 34 }, { w: "text", l: "rei_name", max: 12 }
  ];
}
const reihum = {
  seating: "chain",
  turns: [signTurn(), signTurn(), signTurn(), signTurn()],
  result(doc, m, lang) { return { h: T(lang).rei_h, lines: m.map((x) => signedLine(x, lang)) }; }
};
const kerzen = {
  seating: "pair",
  turns: [[{ w: "text", l: "ker_text", max: 60 }], [{ w: "blow", l: "ker_blow", auto: true, n: 5 }]],
  result(doc, m, lang) { return { h: m[0][0], lines: [T(lang).ker_h] }; }
};
// ---------- termin (turns.js:546-590) ----------
export const HOURS = [10, 12, 14, 15, 16, 17, 18, 19, 20], VOTERS = 10;
export function dayText(day, lang) { const X = T(lang), c = civil(day); return fmt(X.ter_day, { w: X.ter_days.split("|")[weekday(day)], d: c[2], m: c[1] }); }
export function hourText(i, lang) { const h = HOURS[i]; return lang === "en" ? (h > 12 ? h - 12 : h) + (h < 12 ? " am" : " pm") : fmt(T(lang).ter_hour, { h }); }
export function slotText(s, lang) { return dayText(Math.floor(s / 10), lang) + ", " + hourText(s % 10, lang); }
export function termDates(m) { return m[0][0][1]; }
export function voted(m) { return m.map((t) => t[0][0]); }
function tally(m) {
  return termDates(m).map((s, i) => {
    const c = { s, yes: 1, maybe: 0, who: [m[0][0][0]] };
    m.slice(1).forEach((t) => { const v = t[0][1][i]; if (v === 0) { c.yes++; c.who.push(t[0][0]); } else if (v === 1) c.maybe++; });
    c.pts = (c.yes * 2 + c.maybe) * 100 + c.yes;
    return c;
  }).sort((a, b) => b.pts - a.pts || a.s - b.s);
}
export function leading(m) { return tally(m)[0].s; }
function few(names) { return names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : ""); }
export function termHead(m, lang) {
  const X = T(lang), l = tally(m), top = l.filter((c) => c.pts === l[0].pts);
  if (m.length === 1) return fmt(X.ter_open, { s: termDates(m).map((s) => slotText(s, lang)).join(" · ") });
  if (top.length > 1) return fmt(X.ter_tie, { s: top.map((c) => slotText(c.s, lang)).join(" · ") });
  return fmt(l[0].yes === m.length ? X.ter_all : X.ter_most, { s: slotText(l[0].s, lang) });
}
function ballot() {
  return { w: "vote", l: "ter_vote", peek: (doc, m, now, lang) => termHead(m, lang), ok: (v, m) =>
    Array.isArray(v) && v.length === 2 && L.nameOk(v[0]) && voted(m).every((n) => fold(n) !== fold(v[0])) &&
    Array.isArray(v[1]) && v[1].length === termDates(m).length && v[1].every((x) => intIn(x, 0, 2)) };
}
const termin = {
  seating: "chain",
  turns: [[{ w: "slots", l: "ter_pick", ok: (v) => {
    const s = Array.isArray(v) && v.length === 2 && v[1];
    return !!s && L.nameOk(v[0]) && Array.isArray(s) && s.length >= 2 && s.length <= 5 && s.every((x, i) => intIn(x, 0, 9999999) && x % 10 < HOURS.length && (!i || x > s[i - 1]));
  } }]].concat(Array.from({ length: VOTERS - 1 }, () => [ballot()])),
  words: { you_start: "ter_start", go_first: "ter_go_first", go_play: "ter_go", note_turn: "ter_note", note_over: "ter_over", ready: "ter_ready", send: "ter_send", rematch: "ter_again" },
  face: (doc, m, lang) => (m.length ? [termHead(m, lang), fmt(T(lang).ter_count, { n: m.length }), T(lang).ter_you] : null),
  result(doc, m, lang) {
    const X = T(lang), l = tally(m);
    return { h: termHead(m, lang), lines: l.slice(0, 2).map((c) => fmt(X.ter_line, { s: slotText(c.s, lang), y: c.yes, v: c.maybe })).concat([fmt(X.ter_can, { w: few(l[0].who) })]) };
  }
};
// ---------- danke (turns.js:591-595) ----------
const danke = {
  turns: [[{ w: "text", l: "dan_why", max: 44 }, { w: "text", l: "dan_from", max: 12 }], [{ w: "show", l: "dan_got", list: (doc, m, now, lang) => [fmt(T(lang).dan_h, { s: m[0][0] }), m[0][1]] }]],
  peekWhole: (doc, m, lang) => (m.length === 1 ? fmt(T(lang).dan_h, { s: m[0][0] }) : ""),
  result(doc, m, lang) { return { h: fmt(T(lang).dan_h, { s: m[0][0] }), lines: [fmt(T(lang).dan_sig, { n: m[0][1] }), T(lang).dan_ok] }; }
};
// ---------- sorry (turns.js:841-848) ----------
function sorryAsk(i) { return { w: "pick", l: "sor_" + (i + 1), n: 1, auto: true, from: (doc, m, now, lang) => alt(DATA.sorry[i], lang).split("|") }; }
const sorry = {
  local: true, turns: [[sorryAsk(0), sorryAsk(1), sorryAsk(2)]],
  result(doc, m, lang) {
    const text = m[0].map((a, i) => alt(DATA.sorry[i], lang).split("|")[a[0]]).join(" ");
    return { h: T(lang).sor_h, lines: [text], copy: text, note: T(lang).sor_note };
  }
};
// ---------- sammeln (turns.js:879-901) ----------
const sammeln = {
  stay: true,
  turns: [
    [{ w: "text", l: "sam_name", max: 20, oneWord: true, hint: "sam_name_hint", adult: true, pref: "pp", bad: (v) => !G.payName(v) },
      { w: "text", l: "sam_what", max: 30, hint: "sam_what_hint" },
      { w: "slide", l: "sam_who", min: 1, max: G.PAYERS, def: 1, unit: "👤" },
      { w: "money", l: "sam_eur", hint: "sam_eur_hint", ok: (v, now) => G.moneyOk(v, now[2]), line: (v, now, lang) => G.moneyLine(T(lang), v, now[2], lang) }],
    [{ w: "pay", l: "sam_pay", end: true, link: (doc, m) => G.payLink(m), share: G.payShare, more: (m, lang) => G.payLines(T(lang), m, lang)[1] || "", peek: (doc, m, now, lang) => G.payLine(T(lang), m, lang) }]
  ],
  face: (doc, m, lang) => (m.length ? G.payLines(T(lang), m, lang).concat([T(lang).sam_face]) : null),
  result(doc, m, lang) { return { h: T(lang).sam_h, lines: G.payLines(T(lang), m, lang), note: T(lang).sam_safe }; }
};
// ---------- einkauf (turns.js:983-994) ----------
function shopCount(list, lang, cf) {
  const r = L.shopRows(list, cf);
  return fmt(T(lang)[cf && cf.due ? "tdo_count" : "ein_count"], { n: r.length, b: r.filter((x) => x.bought.length).length, c: r.filter((x) => !x.bought.length && x.bring.length).length });
}
// Beispielzuege (nur Treiber/Hinweise): Einkauf endet, sobald alles gekauft ist; Wunschzettel endet durch close
function shopExample(base) { return base ? L.shopApply(base, { name: "Ana", face: 0, marks: Object.fromEntries(L.shopRows(base).map((r) => [r.key, 2])) }) : L.shopApply(null, { name: "", adds: [{ text: "Brot", qty: 1 }, { text: "Milch", qty: 2 }] }); }
function wishExample(base) { return base || L.shopApply(null, { name: "", adds: [{ text: "Buch", qty: 1 }, { text: "Schal", qty: 1 }] }, L.WISH); }
const einkauf = {
  snap: true, list: L.SHOP,
  turns: [[{ w: "shop", l: "ein_make", live: true, cfg: L.SHOP, example: shopExample }], [{ w: "shop", l: "ein_go", live: true, cfg: L.SHOP, example: shopExample }]],
  ends: (doc, m) => m.length > 0 && L.shopDone(m[0][0]),
  words: { you_start: "ein_start", go_first: "ein_go_first", go_play: "ein_go_play", note_turn: "ein_note", note_over: "ein_over", ready: "ein_ready", send: "ein_send", rematch: "ein_again" },
  face: (doc, m, lang) => (m.length ? [shopCount(m[0][0], lang)] : null),
  result(doc, m, lang) { const X = T(lang); return { h: X.ein_done_h, lines: L.shopRows(m[0][0]).map((r) => fmt(X.ein_line, { s: r.label, n: L.shopNames(r.bought) })) }; }
};
// ---------- wunsch (turns.js:998-1010) ----------
function wishCount(v, lang) { return fmt(form(T(lang), "wun_count", v[1].length, lang), { n: v[1].length }); }
const wunsch = {
  snap: true, list: L.WISH,
  turns: [[{ w: "wish", l: "wun_make", live: true, k: "wun", cfg: L.WISH, example: wishExample }], [{ w: "wish", l: "wun_go", live: true, k: "wun", cfg: L.WISH, example: wishExample }]],
  // vorbei erst, wenn das Handy der Wuenschenden schliesst (o = 2), nie weil jeder Wunsch vergeben ist: das verriete es
  ends: (doc, m) => m.length > 0 && doc.o === 2, close: 2,
  words: { you_start: "wun_start", go_first: "wun_go_first", go_play: "wun_go_play", note_turn: "wun_note", note_over: "wun_over", ready: "wun_ready", send: "inv_send", rematch: "wun_again" },
  face: (doc, m, lang) => (m.length ? [wishCount(m[0][0], lang)] : null),
  result(doc, m, lang) { return { h: T(lang).wun_done_h, lines: L.shopRows(m[0][0], L.WISH).map((r) => r.label) }; },
  notes: ["wun_secret"]
};
// ---------- geschenk (turns.js:1013-1032) ----------
export const GIFT = { who: ["kind", "teen", "partner", "eltern", "oma", "freund", "kollege"], likes: ["tee", "pflanze", "lesen", "kochen", "spiel", "musik", "basteln", "sport", "technik", "reisen", "gemuet", "suess"] };
export function upTo(n, lang) { return fmt(T(lang).gf_upto, { n: money(n * 100, lang) }); }
function giftLast(m) { return m[0][m[0].length - 1]; }
export function giftGame(euro, who, extra) {
  const o = who ? 1 : 0, ask = who ? [{ w: "opts", l: "gf_who", n: 1, auto: true, keys: GIFT.who, pre: "gfw_" }] : [];
  ask.push({ w: "pick", l: "gf_budget", n: 1, auto: true, from: (doc, m, now, lang) => euro.map((n) => upTo(n, lang)) },
    { w: "opts", l: "gf_like", n: 2, keys: GIFT.likes, pre: "gfl_" },
    // Pruefung wie alt (okAnswer ideas) plus der Geschenkfilter auch fuer Ideen aus einem Link (Review L2): kein Alkohol,
    // Rauchen, Gluecksspiel, Diaet, Intimes, egal woher der Text kommt
    { w: "ideas", l: "gf_ideas", check: (v) => okIdeas(v) && v[0].every(giftOk), ask: (now) => ({ who: who ? GIFT.who[now[0][0]] : "kollege", euro: euro[now[o][0]], likes: now[o + 1].map((i) => GIFT.likes[i]) }) });
  return Object.assign({
    turns: [ask, [{ w: "pick", l: "gf_fav", n: 1, auto: true, top: (doc, m, lang) => { const x = giftLast(m); return fmt(T(lang).gf_their, { s: x[0][x[1]] }); }, from: (doc, m) => giftLast(m)[0] }]],
    words: { you_start: "gf_start", go_first: "gf_go_first", go_play: "gf_go_play", note_turn: "gf_note", note_over: "gf_over", ready: "gf_ready", send: "inv_send", rematch: "gf_again" },
    face: (doc, m, lang) => { if (!m.length) return null; const x = giftLast(m); return [fmt(T(lang).gf_face, { s: x[0][x[1]] }), upTo(euro[m[0][o][0]], lang)]; },
    result(doc, m, lang) {
      const X = T(lang), x = giftLast(m), a = x[0][x[1]], b = x[0][m[1][0][0]];
      return { h: a === b ? fmt(X.gf_same, { s: a }) : X.gf_two, lines: (a === b ? [] : [fmt(X.gf_first, { s: a }), fmt(X.gf_second, { s: b })]).concat([upTo(euro[m[0][o][0]], lang)]), open: who ? { i: "zug-sammeln", l: "gf_pool" } : null };
    },
    giftIdeas, notes: ["gf_lang"],
    example: (p, doc, m, now) => (p.w === "ideas" ? [giftIdeas(doc.seed, p.ask(now), "de"), 0] : undefined)
  }, extra);
}
const geschenk = giftGame([10, 20, 30, 50], true);

export const GAMES = { einig, rangliste, kapsel, post, gutschein, rubbellos, urkunde, morgen, umschlag, wichteln, reihum, kerzen, termin, danke, sorry, sammeln, einkauf, wunsch, geschenk };

// ---------- Poster-Varianten: Wohlfuehlkarten (warm.js:10-56), karte-lob, halloween, warm-sorry ----------
// Alt waren das statische Karten (kind card) mit Satzauswahl, Vorname vorn ("Lea, du bist toll.") und einer passenden
// Antwortkarte (re). Hier als Zwei-Schritt-Zug: Satz + Namen waehlen, Empfang zeigt die Karte. Kein Zaehler, kein
// "schick es weiter": Antworten darf man, muss nie (warm.js:1-3).
import POSTER from "./poster.json" with { type: "json" };
export const PTEXT = { de: { ...POSTER.text.de }, en: { ...POSTER.text.en } };
export const POSTERS = POSTER.posters;
const NAME_RE = /^[\p{L}][\p{L} .'-]*$/u, MAX_NAME = 14;
/** Nur ein schlichter Vorname; "" = kein Name, null = keiner, der auf eine Karte darf (warm.js:24-29). */
export function warmName(raw) {
  const s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (!s) return "";
  const n = cleanName(s);
  return n && n === s && NAME_RE.test(n) ? n : null;
}
import { clean as qclean } from "./alt.js";
function cleanName(s) { return qclean(s, MAX_NAME); }
/** "Lea" + "Du bist toll." -> "Lea, du bist toll." Englisch behaelt sein grosses I (warm.js:31-36). */
export function named(line, who) {
  const n = warmName(who);
  if (!n) return line;
  const rest = /^I\b/.test(line) ? line : line.charAt(0).toLowerCase() + line.slice(1);
  return qclean(n + ", " + rest, 90) || line;
}
function PT(lang) { return textsFor(PTEXT, lang); }
function lines(id, lang) { const p = POSTERS[id]; return (p[lang] || p.de).lines; }
export function posterGame(id) {
  const opt = (l) => ({ w: "text", l, max: MAX_NAME, check: (v) => typeof v === "string" && (v === "" || warmName(v) === v) });
  return {
    poster: id,
    turns: [[{ w: "pick", n: 1, auto: true, l: "pos_line", from: (doc, m, now, lang) => lines(id, lang) }, opt("pos_to"), opt("pos_from")],
      [{ w: "show", l: "pos_got", list: (doc, m, now, lang) => [named(lines(id, lang)[m[0][0][0]], m[0][1])].concat(m[0][2] ? [fmt(PT(lang).pos_sig, { n: m[0][2] })] : []) }]],
    peekWhole: (doc, m, lang) => (m.length === 1 ? named(lines(id, lang)[m[0][0][0]], m[0][1]) : ""),
    result(doc, m, lang) {
      const p = POSTERS[id], X = PT(lang), re = (p.re || []).filter((r) => POSTERS[r] && r !== id)[0];
      const out = { h: named(lines(id, lang)[m[0][0][0]], m[0][1]), lines: m[0][2] ? [fmt(X.pos_sig, { n: m[0][2] })] : [] };
      if (re) out.lines.push(fmt(X.pos_reply, { t: (POSTERS[re][lang] || POSTERS[re].de).t.replace("|", " ") }));
      return out;
    }
  };
}
