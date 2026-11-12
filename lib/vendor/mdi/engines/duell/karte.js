// Agenten-Duell als Vertragskarte (Ablauf wie modes.js im Altcode, Zeilen 104-265):
//   Zug 1 (Sitz 0): eigenen Agenten einstellen (Name, Aussehen, Regler) -> Duell gegen den Gegner aus den Parametern
//     (Variante), Runden und Erklaerung; mind: zehn Haende gegen den lernenden Agenten. Danach "Jemanden herausfordern"
//     oder "Agent aendern" (zurueck zum Einstellen).
//   Zug 2 (Sitz 1): die herausgeforderte Person stellt ihren Agenten gegen den von Sitz 0 (alt: incoming, der Agent des
//     Absenders wird zum Gegner); mind: sie spielt zehn Haende gegen den Agenten von Sitz 0.
//   deck: Partydeck mit Uhr, ein Sitz.
// Zustand nur aus Ganzzahlen und Texten; das Duell selbst wird aus Zustand und Seed nachgerechnet (deterministisch).
import * as D from "./duel.js";
import { fmt, hash32, clean } from "../zug/alt.js";
import { ruleOf, variantOf } from "../zug/zug.js";
import { sealParams, sealDoc, badgeNode } from "../frei/seal.js";
import TX from "./texte.json" with { type: "json" };

const HANDS = 10;
function T(lang) { return { ...D.DATA.texts.de, ...TX.de, ...(lang === "en" ? { ...D.DATA.texts.en, ...TX.en } : {}) }; }
function nameOf(a, fb) { return a.n || fb || a.e; }
function rivalOf(p) { return D.agent({ n: p.bn, e: p.be, r: p.br, c: p.bc, p: p.bp }); }
function sliders(m) { return D.SLIDERS[m] || []; }
/** Agent-Eingabe aus dem Formular: { n?, e:[i], r?, c?, p? } -> Agent (fehlende Regler 50 wie alt) */
function agentIn(v, m) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const keys = Object.keys(v), allowed = ["n", "e", ...(m === "mind" ? [] : sliders(m))];
  if (keys.some((k) => !allowed.includes(k))) return null;
  if (!Array.isArray(v.e) || v.e.length !== 1 || !Number.isInteger(v.e[0]) || v.e[0] < 0 || v.e[0] >= D.DATA.emoji.length) return null;
  const a = { n: v.n === undefined ? "" : v.n, e: D.DATA.emoji[v.e[0]], r: v.r === undefined ? 50 : v.r, c: v.c === undefined ? 50 : v.c, p: v.p === undefined ? 50 : v.p };
  return D.agentOk(a) ? a : null;
}
function doc0(pub) { return { m: pub.p.m, seed: pub.seed, w: pub.p.w, a: pub.a0, b: rivalOf(pub.p) }; }
function doc1(pub) { return { m: pub.p.m, seed: pub.seed, w: pub.p.w, a: pub.a1, b: pub.a0 }; }
function result(pub, which, lang) {
  const d = which ? doc1(pub) : doc0(pub);
  return pub.p.m === "mind" ? D.playMind(d, which ? pub.h1 : pub.h0) : D.play(d, lang);
}
function copy(pub) { return JSON.parse(JSON.stringify(pub)); }

export function makeDuell({ manifest }) {
  function seatOf(ph) { return ph === "a1" || ph === "h1" ? 1 : ph === "over" ? -1 : 0; }
  function status(state) {
    const pub = state.pub, over = pub.ph === "over";
    let winner = -1, score = [];
    if (over && pub.p.m !== "deck") {
      const r = result(pub, 1, "de");
      score = [r.sb, r.sa]; // Sitz 0 = Agent b im Duell 2, Sitz 1 = Agent a
      winner = pub.p.m === "mind" ? (r.sa >= r.sb ? 1 : 0) : D.winner(r) > 0 ? 1 : D.winner(r) < 0 ? 0 : -1;
    }
    return { over, turn: seatOf(pub.ph), reveal: false, score, winner, turnNo: seatOf(pub.ph) === 1 || over ? 2 : 1, turns: pub.p.m === "deck" ? 1 : 2 };
  }
  function accepts(obs, seat, x) {
    const pub = obs.pub, st = status({ pub });
    if (st.over || seat !== st.turn || !x || x.seat !== seat) return false;
    switch (pub.ph) {
      case "a0": case "a1": return x.t === "agent" && !!agentIn(x.a, pub.p.m);
      case "h0": case "h1": return x.t === "hand" && Number.isInteger(x.a) && x.a >= 0 && x.a <= 2;
      case "s0": return x.t === "ok" || x.t === "again";
      case "d0": return x.t === "done" && Number.isInteger(x.a) && x.a >= 0 && x.a <= 99;
      default: return false;
    }
  }
  function step(state, x) {
    const pub = copy(state.pub);
    if (!accepts({ pub }, x.seat, x)) throw new Error("ungueltig: " + x.t);
    const m = pub.p.m;
    if (x.t === "agent") {
      const a = agentIn(x.a, m);
      if (pub.ph === "a0") { pub.a0 = a; pub.h0 = []; pub.ph = m === "mind" ? "h0" : "s0"; }
      else { pub.a1 = a; pub.h1 = []; pub.ph = m === "mind" ? "h1" : "over"; }
    } else if (x.t === "hand") {
      const h = pub.ph === "h0" ? pub.h0 : pub.h1; h.push(x.a);
      if (h.length >= HANDS) pub.ph = pub.ph === "h0" ? "s0" : "over";
    } else if (x.t === "ok") pub.ph = "a1";
    else if (x.t === "again") { pub.ph = "a0"; pub.a0 = null; pub.h0 = []; }
    else if (x.t === "done") { pub.k = x.a; pub.ph = "over"; }
    return { pub, priv: state.priv.slice() };
  }
  function moves(obs, seat) {
    const pub = obs.pub, st = status({ pub });
    if (st.over || seat !== st.turn) return [];
    if (pub.ph === "h0" || pub.ph === "h1") return [0, 1, 2].map((a) => ({ t: "hand", seat, a }));
    if (pub.ph === "s0") return [{ t: "again", seat }, { t: "ok", seat }];
    if (pub.ph === "d0") return [{ t: "done", seat, a: 0 }];
    // Agent: wie "Gegner wuerfeln" (alt), aus dem Seed und dem Zug
    const r = D.rival(pub.seed, seat + 1, D.DATA.rivals.de, D.DATA.emoji), m = pub.p.m, a = { e: [Math.max(0, D.DATA.emoji.indexOf(r.e))] };
    for (const k of m === "mind" ? [] : sliders(m)) a[k] = r[k];
    return [{ t: "agent", seat, a }];
  }

  function face(pub, i) { return D.DATA.sets[pub.p.set][i]; }
  function agentLine(a, m, X) {
    const parts = [(a.e + " " + (a.n || "")).trim()];
    if (m === "mind") parts.push(X.ag_sharp + " " + a.c);
    else for (const k of sliders(m)) parts.push(X["ag_" + k] + " " + a[k]);
    return parts.join(" · ");
  }
  function form(pub, seat, X, lang, preset) {
    const m = pub.p.m, init = preset || {};
    const fields = [
      { t: "input", id: "n", label: X.agName, max: 16, optional: true, value: init.n || "" },
      { t: "pick", id: "e", label: X.agLook, n: 1, wrap: true, options: D.DATA.emoji.map((e) => ({ label: e })), value: [Math.max(0, D.DATA.emoji.indexOf(init.e || "🤖"))] }
    ];
    if (m !== "mind") for (const k of sliders(m)) fields.push({ t: "slide", id: k, label: X["ag_" + k], min: 0, max: 100, step: 5, value: init[k] === undefined ? 50 : init[k] });
    return { t: "form", id: "agent" + seat, label: X.tabAgent, fields, submit: { t: "agent", seat }, confirm: m === "mind" ? X.mindGo : X.duelGo };
  }
  function line(pub, d, r, i, X) {
    const a = nameOf(d.a, X.you), b = nameOf(d.b, X.duel);
    if (pub.p.m === "rps" || pub.p.m === "mind") return fmt(X.duelRps, { n: i + 1 }) + ": " + face(pub, r.x) + " " + face(pub, r.y) + "   " + r.sa + ":" + r.sb;
    if (pub.p.m === "rap") return a + ": " + r.x.text + " (" + r.x.pts + ") / " + b + ": " + r.y.text + " (" + r.y.pts + ")";
    return r.item + ": " + fmt(X.duelBid, { a: r.ba, b: r.bb }) + ". " + (r.o === 0 ? X.duelNoSale : fmt(X.duelSold, { n: r.o > 0 ? (d.a.n || X.youTo) : b }));
  }
  function verdict(pub, d, res, X) {
    if (pub.p.m === "mind") return res.sa >= res.sb ? X.mindBeat : X.mindRead;
    const w = D.winner(res);
    if (w === 0) return X.duelDraw;
    return w > 0 && !d.a.n ? X.duelWinYou : fmt(X.duelWin, { n: nameOf(w > 0 ? d.a : d.b, X.duel) });
  }
  function report(pub, which, X, lang) {
    const d = which ? doc1(pub) : doc0(pub), res = result(pub, which, lang), out = [];
    out.push({ t: "text", role: "big", text: verdict(pub, d, res, X) });
    out.push({ t: "text", role: "body", text: fmt(X.pts, { a: res.sa, b: res.sb }) + " · " + nameOf(d.a, X.you) + " – " + nameOf(d.b, X.duel) });
    res.rounds.forEach((r, i) => out.push({ t: "text", role: "small", text: line(pub, d, r, i, X) }));
    if (pub.p.m !== "mind") {
      const w = D.explain(d, res);
      if (w) {
        const who = (k) => (d[k].e + " " + (d[k].n || "")).trim(), v = { ...w.v, w: w.w ? who(w.w) : "", l: w.w ? who(w.w === "a" ? "b" : "a") : "" };
        if (v.h != null) v.h = face(pub, v.h);
        out.push({ t: "text", role: "body", text: "❓ " + fmt(X["why_" + w.k], v) });
        if (w.tip && w.w === "b") out.push({ t: "text", role: "body", text: fmt(X["tip_" + w.tip], v) });
      }
    }
    return out;
  }
  function view(obs, seat, ctx) {
    const v = viewInner(obs, seat, ctx), b = ctx && ctx.preview ? null : badgeNode(obs.pub.p, (ctx && ctx.lang) || "de");
    return b && v.t === "stack" ? { ...v, children: [...v.children, b] } : v;   // "Mit KI erstellt" (Siegel)
  }
  function viewInner(obs, seat, ctx) {
    const pub = obs.pub, lang = ctx.lang || "de", X = T(lang), m = pub.p.m, st = status({ pub });
    const head = { who: st.turn, turn: st.turnNo, total: st.turns, rule: ruleOf(manifest, pub.p, lang) }, badge = badgeNode(pub.p, lang);
    const kids = [];
    if (ctx.preview) {
      // Karte in der gewaehlten Farbe; jeder Teil mit data-part, damit die Anpassen-Blasen daran haengen
      const P = pub.p, ink = P.accent === "ink" ? "paper" : "ink", mp = manifest.params.properties.m["x-names"] || {};
      const mine = { e: "🤖", n: X.tabAgent, r: P.ar, c: P.ac, p: P.ap };
      return { t: "frame", fill: P.accent || "ink", ratio: "3:4", part: "farbe", a11y: (P.title || manifest.title[lang] || manifest.title.de) + ". " + head.rule, children: [
        { t: "text", role: "title", text: P.title || manifest.title[lang] || manifest.title.de, fill: ink, x: 8, y: 8, w: 84, part: "titel" },
        { t: "text", role: "label", text: (mp[m] && (mp[m][lang] || mp[m].de)) || m, fill: ink, x: 8, y: 34, w: 84, part: "arena" },
        { t: "text", role: "small", text: X.rivalIs + " " + agentLine(rivalOf(P), m, X), fill: ink, x: 8, y: 46, w: 84, part: "gegner" },
        ...(m === "deck" || m === "mind" ? [] : [{ t: "text", role: "small", text: agentLine(mine, m, X), fill: ink, x: 8, y: 58, w: 84, part: "agent" }]),
        { t: "text", role: "body", text: head.rule, fill: ink, x: 8, y: 72, w: 84 },
        ...(badge ? [{ ...badge, fill: ink, x: 8, y: 92, w: 84 }] : [])] };
    }
    if (pub.ph === "over") {
      if (m === "deck") return { t: "stack", head, result: true, children: [{ t: "text", role: "big", text: X.deckEnd }, { t: "text", role: "body", text: fmt(X.deckCount, { n: pub.k }) }] };
      return { t: "stack", head, result: true, children: report(pub, 1, X, lang) };
    }
    if (seat !== st.turn) return { t: "stack", head, children: [] };
    if (pub.ph === "d0") {
      const list = (pub.p.w ? [pub.p.w] : []).concat(D.DATA.deck[lang] || D.DATA.deck.de);
      kids.push({ t: "explain", id: "deck", label: X.deckGo, secs: 60, max: 99, words: list, submit: { t: "done", seat } });
    } else if (pub.ph === "a0") {
      kids.push({ t: "text", role: "label", text: X.rivalIs + " " + agentLine(rivalOf(pub.p), m, X) });
      kids.push(form(pub, seat, X, lang, { r: pub.p.ar, c: pub.p.ac, p: pub.p.ap }));
      kids.push({ t: "text", role: "small", text: X.agLocal });
    } else if (pub.ph === "a1") {
      kids.push({ t: "text", role: "label", text: fmt(X.duelInvite, { n: nameOf(pub.a0, X.friend) }) });
      kids.push({ t: "text", role: "body", text: X.rivalIs + " " + agentLine(pub.a0, m, X) });
      kids.push(form(pub, seat, X, lang, null));
      kids.push({ t: "text", role: "small", text: X.agLocal });
    } else if (pub.ph === "h0" || pub.ph === "h1") {
      const h = pub.ph === "h0" ? pub.h0 : pub.h1, d = pub.ph === "h0" ? doc0(pub) : doc1(pub), r = D.playMind(d, h);
      if (r.rounds.length) { const l = r.rounds[r.rounds.length - 1]; kids.push({ t: "text", role: "body", text: fmt(X.mindLast, { a: face(pub, l.x), b: face(pub, l.y), s: r.sa, t: r.sb }) }); }
      kids.push({ t: "choice", label: X.mindPick + " " + fmt(X.mindLeft, { n: HANDS - h.length }), options: [0, 1, 2].map((i) => ({ label: face(pub, i), input: { t: "hand", seat, a: i } })) });
    } else if (pub.ph === "s0") {
      for (const n of report(pub, 0, X, lang)) kids.push(n);
      kids.push({ t: "choice", label: X.next, options: [{ label: X.challenge, input: { t: "ok", seat } }, { label: X.duelAgain, input: { t: "again", seat } }] });
    }
    return { t: "stack", head, children: kids };
  }
  return {
    manifest,
    init({ rng, params }) {
      return { pub: { p: params, seed: rng.u32(), ph: params.m === "deck" ? "d0" : "a0", a0: null, h0: [], a1: null, h1: [], k: 0 }, priv: new Array(manifest.players.max).fill(null) };
    },
    step, accepts, moves, status, view,
    // eigener Bot (ADR 0001 f): Gegner-Agent wie "Gegner wuerfeln", Haende und Wahl aus dem Seed (deterministisch)
    bot(obs, seat, { seed }) {
      const mv = moves(obs, seat);
      if (!mv.length) return null;
      if (obs.pub.ph === "s0") return mv.find((x) => x.t === "ok");
      return mv[hash32(String(seed)) % mv.length];
    },
    observe(state) { return { pub: copy(state.pub), mine: null }; },
    // Freie Karte (Strang K): Doc {k:"duel", i:<Katalog-id>, t?, w?, ki?, fr?} <-> Parameter; Unbekanntes -> null
    fromFree(doc) {
      if (!doc || doc.k !== "duel" || typeof doc.i !== "string") return null;
      const props = manifest.params.properties, out = {};
      for (const [k, p] of Object.entries(props)) out[k] = JSON.parse(JSON.stringify(p.default));
      const v = (manifest.variants || []).find((x) => x.id === doc.i || (x.legacy || []).includes(doc.i));
      if (v) Object.assign(out, v.params); else if (doc.i !== manifest.id) return null;
      if (doc.t !== undefined) { const t = clean(doc.t, props.title.maxLength); if (doc.t && !t) return null; out.title = t; }
      if (doc.w !== undefined) { const w = clean(doc.w, props.w.maxLength); if (doc.w && !w) return null; out.w = w; }
      return { ...out, ...sealParams(doc, props) };
    },
    toFree(params) {
      const v = variantOf(manifest, params);
      return { k: "duel", i: v ? v.id : manifest.id, ...(params.title ? { t: params.title } : {}), ...(params.w ? { w: params.w } : {}), ...sealDoc(params) };
    },
    // fuer Tests und Host
    result: (pub, which, lang) => result(pub, which, lang), agentIn
  };
}
