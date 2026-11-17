// Prompt -> Anzeigeknoten (eine Frage je Bildschirm). Bedienzustand lebt nur in ctx.draft (Host haelt ihn, Karte rechnet).
// Knotenformen (Absprache mit Strang F, Nachricht vom 2026-11-12): choice (options mit input ODER draft, on, disabled,
// wrap), field (key, value, max, mode, hint), go (der eine Weiter-Knopf, gesperrt mit sichtbarem Grund), link, copy,
// file, action. Verhalten wie turn-ui.js (Altcode), z. B. rank: das letzte Element ordnet sich selbst ein.
import { fmt, clean, fold } from "./alt.js";
import { okAnswer } from "./check.js";
import UI from "./ui.json" with { type: "json" };

export function ui(lang) { return { ...UI.de, ...(UI[lang] || {}) }; }
/** Was ein Schritt fragt, in Worten (turn-ui.js:11). */
export function askText(p, c) {
  if (p.title) return p.title(c.doc, c.lang);
  if (p.top) return p.top(c.doc, c.m, c.lang);
  const s = c.X[p.l] || "";
  return s.replace(": {q}", "").replace(/:\s*$/, "");
}
export function answerInput(c, v) { return c.card.answer(c.pub, c.seat, v, c.today); }
export function ok(p, c, v) { return v !== null && v !== undefined && okAnswer(p, v, c.doc, c.lang, c.m, c.now); }
function d(c) { return c.draft && typeof c.draft === "object" ? c.draft : {}; }
/** Weiter-Knopf: gesperrt mit Grund, sonst mit der fertigen Eingabe. */
export function go(c, p, v, why) {
  const U = ui(c.lang), good = ok(p, c, v);
  return { t: "go", label: U.next, input: good ? answerInput(c, v) : null, disabled: !good, why: good ? "" : why || fmt(U.whyOpen, { s: askText(p, c) }) };
}
function peekOf(p, c) { return p.peek ? [{ t: "text", role: "body", text: p.peek(c.doc, c.m, c.now, c.lang) }] : []; }
function label(p, c) { return { t: "text", role: "label", text: askText(p, c) }; }

const W = {
  pick(p, c) {
    const items = p.from(c.doc, c.m, c.now, c.lang), top = p.top ? [{ t: "text", role: "body", text: p.top(c.doc, c.m, c.lang) }] : [];
    const lab = p.top && p.auto ? (c.X[p.l] || "").replace(": {q}", "") : askText(p, c);
    if (p.n === 1) return { t: "stack", children: [...peekOf(p, c), ...top, { t: "choice", label: lab, options: items.map((s, i) => ({ label: s, input: answerInput(c, [i]) })) }] };
    const sel = Array.isArray(d(c).sel) ? d(c).sel.filter((i) => Number.isInteger(i) && i >= 0 && i < items.length) : [];
    const U = ui(c.lang);
    const toggle = (i) => { const s = sel.slice(), at = s.indexOf(i); if (at >= 0) s.splice(at, 1); else { if (s.length >= p.n) s.shift(); s.push(i); } return { sel: s }; };
    return { t: "stack", children: [...peekOf(p, c), ...top,
      { t: "choice", label: lab, wrap: true, options: items.map((s, i) => ({ label: s, draft: toggle(i), on: sel.includes(i) })) },
      go(c, p, sel.length === p.n ? sel : null, fmt(U.pickMore, { n: p.n - sel.length }))] };
  },
  text(p, c) {
    const U = ui(c.lang), v = typeof d(c).v === "string" ? d(c).v.trim() : (p.pref && c.ctx.pref && c.ctx.pref[p.pref]) || "";
    const why = !v ? fmt(U.whyOpen, { s: askText(p, c) }) : !clean(v, p.max) || clean(v, p.max) !== v ? U.filter : (p.oneWord && /\s/.test(v)) ? U.oneWord : U.notThis;
    return { t: "stack", children: [...peekOf(p, c), ...(p.top ? [{ t: "text", role: "body", text: p.top(c.doc, c.m, c.lang) }] : []),
      { t: "field", key: "v", label: askText(p, c), value: v, max: p.max, mode: p.oneWord ? "name" : "text", hint: p.hint ? c.X[p.hint] : "" },
      go(c, p, v, why)] };
  },
  list(p, c) {
    // Felder schreiben flach (field.key = "l.<i>", ADR 0001 c)
    const U = ui(c.lang), D = d(c);
    const vals = []; for (let i = 0; i < p.n; i++) vals.push(typeof D["l." + i] === "string" ? D["l." + i] : "");
    const cleaned = vals.map((x) => clean(x, p.max)), hints = p.hints ? p.hints(c.lang) : null;
    const v = p.loose ? vals.map((x, i) => (x.trim() ? cleaned[i] : "")) : cleaned;
    const title = p.title ? p.title(c.doc, c.lang) : askText(p, c);
    const fields = vals.map((x, i) => ({ t: "field", key: "l." + i, label: title + " " + (i + 1), value: x, max: p.max, mode: "text", hint: hints ? hints[i] || "" : "" }));
    const have = v.filter(Boolean);
    const why = p.least && have.length < p.least ? fmt(U.listLeast, { n: p.least }) : have.length < (p.loose ? 0 : p.n) ? fmt(U.listAll, { n: p.n }) : new Set(have.map(fold)).size < have.length ? U.listSame : U.filter;
    return { t: "stack", children: [...peekOf(p, c), label(p, c), ...fields, go(c, p, v, why)] };
  },
  slide(p, c) {
    const lo = p.min || 0, hi = p.maxOf ? p.maxOf(c.doc) : p.max, def = p.def !== undefined ? p.def : lo;
    const v = Number.isInteger(d(c).v) && d(c).v >= lo && d(c).v <= hi ? d(c).v : def;
    const unit = p.unit ? " " + p.unit : "";
    const kids = [...peekOf(p, c), label(p, c)];
    if (hi - lo <= 30 && !p.step) {
      const opts = []; for (let n = lo; n <= hi; n++) opts.push({ label: String(n) + unit, draft: { v: n }, on: n === v });
      kids.push({ t: "choice", label: askText(p, c), wrap: true, options: opts });
    } else {
      const st = p.step || Math.max(1, Math.round((hi - lo) / 20)), U = ui(c.lang);
      kids.push({ t: "text", role: "big", text: (p.show ? p.show(v, c.lang) : String(v)) + unit });
      kids.push({ t: "choice", label: askText(p, c), options: [
        { label: "−", aria: U.less, draft: { v: Math.max(lo, v - st) }, disabled: v <= lo },
        { label: "+", aria: U.more, draft: { v: Math.min(hi, v + st) }, disabled: v >= hi }] });
    }
    kids.push(go(c, p, v));
    return { t: "stack", children: kids };
  },
  rank(p, c) {
    const items = p.from(c.doc, c.m, c.now, c.lang), U = ui(c.lang);
    let order = Array.isArray(d(c).order) ? d(c).order.filter((i, k, a) => Number.isInteger(i) && i >= 0 && i < items.length && a.indexOf(i) === k) : [];
    if (order.length === items.length - 1) order = order.concat([items.findIndex((x, n) => order.indexOf(n) < 0)]);
    const tap = (i) => { const o = order.slice(), at = o.indexOf(i); if (at >= 0) o.splice(at, 1); else o.push(i); return { order: o }; };
    return { t: "stack", children: [...peekOf(p, c), { t: "choice", label: askText(p, c), wrap: true,
      options: items.map((s, i) => { const w = order.indexOf(i); return { label: (w >= 0 ? w + 1 + ". " : "") + s, draft: tap(i), on: w >= 0 }; }) },
      ...(order.length ? [{ t: "choice", label: "", options: [{ label: U.reset, draft: { order: [] } }] }] : []),
      go(c, p, order.length === items.length ? order : null, fmt(U.rankMore, { n: items.length - order.length }))] };
  },
  alloc(p, c) {
    const items = p.from(c.doc, c.m, c.now, c.lang), vals = p.vals ? p.vals(c.doc) : null, U = ui(c.lang);
    const bids = items.map((x, i) => (Array.isArray(d(c).b) && Number.isInteger(d(c).b[i]) ? d(c).b[i] : 0));
    const sum = bids.reduce((a, b) => a + b, 0), kids = [...peekOf(p, c), label(p, c)];
    items.forEach((s, i) => {
      const less = bids.slice(); less[i] = Math.max(0, bids[i] - p.step);
      const more = bids.slice(); more[i] = bids[i] + p.step;
      kids.push({ t: "choice", label: (vals ? s + " · " + vals[i] : s) + ": " + bids[i], options: [
        { label: "−", aria: fmt(c.X.a_less || U.less, { s }), draft: { b: less }, disabled: bids[i] < p.step },
        { label: "+", aria: fmt(c.X.a_more || U.more, { s }), draft: { b: more }, disabled: sum + p.step > p.sum }] });
    });
    kids.push({ t: "text", role: "small", text: fmt(c.X.left || U.left, { n: p.sum - sum }) });
    kids.push(go(c, p, bids));
    return { t: "stack", children: kids };
  },
  show(p, c) {
    const kids = [...peekOf(p, c), label(p, c), ...p.list(c.doc, c.m, c.now, c.lang).map((s) => ({ t: "text", role: "big", text: s }))];
    if (p.notes) for (const s of p.notes(c.doc, c.m, c.now, c.lang).filter(Boolean)) kids.push({ t: "text", role: "small", text: s });
    if (p.later) kids.push({ t: "text", role: "small", text: c.X[p.later] });
    kids.push(go(c, p, 0));
    return { t: "stack", children: kids };
  },
  // Kerzen auspusten: jede Kerze ein Knopf (Tippen statt Pusten, alt mit Mikrofon als Zusatz)
  blow(p, c) {
    const out = Number.isInteger(d(c).out) ? d(c).out : 0, U = ui(c.lang), opts = [];
    for (let i = 0; i < p.n; i++) opts.push({ label: i < out ? "·" : "🕯️", aria: fmt(U.candle, { n: i + 1 }), draft: { out: out + 1 }, disabled: i < out || i !== out });
    return { t: "stack", children: [...peekOf(p, c), label(p, c), { t: "choice", label: askText(p, c), options: opts },
      ...(out >= p.n ? [{ t: "go", label: U.next, input: answerInput(c, 0), disabled: false, why: "" }] : [{ t: "text", role: "small", text: fmt(U.candlesLeft, { n: p.n - out }) }])] };
  }
};

export function widget(p, c) {
  const f = W[p.w];
  if (!f) throw new Error("zug: kein Widget fuer " + p.w + " (Karte muss game.view." + p.w + " liefern)");
  return f(p, c);
}
export const WIDGETS = Object.keys(W);
