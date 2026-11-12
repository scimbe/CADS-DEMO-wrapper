// Kartenspezifische Bildschirme der Z1-Karten aus Draft-Primitiven (ADR 0001 c). Verhalten wie im Altcode:
// money/pay turn-ui.js:168-196, slots/vote turn-ui.js:510-574, shop turn-ui.js:450-505, wish turn2.js:63-160,
// opts/ideas turn2.js:18-62. Text geht nur als Text in Knoten, nie als HTML.
import { fmt, fold, clean, intIn } from "./alt.js";
import { go, askText, answerInput, ok, ui } from "./widgets.js";
import * as G from "./geld.js";
import * as L from "./merge.js";
import * as S from "./satz.js";
import { ideas as giftIdeas, fromAi } from "./geschenke.js";
import { HOURS, dayText, hourText, slotText, termDates, voted } from "./spiele.js";

function d(c) { return c.draft && typeof c.draft === "object" ? c.draft : {}; }
const txt = (role, text) => ({ t: "text", role, text });
function nick(c) { const n = c.ctx && typeof c.ctx.nick === "string" ? c.ctx.nick : ""; return n && clean(n, 12) === n ? n : ""; }
function adult(c) { return !!(c.ctx && c.ctx.age18 === true); }

// ---------- Geld einsammeln ----------
/** PayPal.me-Name: nur ab 18 (Selbstauskunft im Profil, P1). Ohne Bestaetigung: Hinweis + Knopf zur Bestaetigung. */
export function adultText(p, c, base) {
  if (p.adult && !adult(c)) {
    return { t: "stack", children: [txt("label", askText(p, c)), txt("body", c.X.sam_age), { t: "action", act: "age18", label: c.X.sam_adult }, txt("small", c.X.sam_minor)] };
  }
  return base(p, c);
}
export function money(p, c) {
  const U = ui(c.lang), raw = typeof d(c).v === "string" ? d(c).v : "", cents = G.parseCents(raw);
  const good = cents !== null && ok(p, c, cents);
  const line = good ? p.line(cents, c.now, c.lang) : "";
  return { t: "stack", children: [
    { t: "field", key: "v", label: askText(p, c), value: raw, max: 9, mode: "decimal", hint: p.hint ? c.X[p.hint] : "" },
    ...(line ? [txt("body", line)] : []),
    go(c, p, good ? cents : null, raw ? U.notThis + " " + (c.X.sam_eur_hint || "") : fmt(U.whyOpen, { s: askText(p, c) }))] };
}
export function pay(p, c) {
  const url = p.link(c.doc, c.m), more = p.more ? p.more(c.m, c.lang) : "", kids = [];
  if (p.peek) kids.push(txt("big", p.peek(c.doc, c.m, c.now, c.lang)));
  if (more) kids.push(txt("body", more));
  kids.push(txt("small", c.X.sam_safe));
  if (url) {
    if (!adult(c)) kids.push(txt("body", c.X.sam_age), { t: "action", act: "age18", label: c.X.sam_adult }, txt("small", c.X.sam_minor));
    else kids.push({ t: "link", href: url, label: fmt(c.X.sam_btn, { e: p.share(c.m, c.lang) }) }, txt("small", c.X.sam_after));
  }
  return { t: "stack", children: kids };
}

// ---------- Termin finden ----------
/** Erst die Uhrzeit, dann die Tage (14 ab heute); hoechstens 5 Termine; Feiertage stehen am Tag (satz.js holidays). */
export function slots(p, c) {
  const U = ui(c.lang), X = c.X, D = d(c), today = Number.isInteger(c.today) ? c.today : null;
  if (today === null) return { t: "stack", children: [txt("body", U.gateUnknown)] };
  const h = intIn(D.h, 0, HOURS.length - 1) ? D.h : 6;
  const picked = Array.isArray(D.picked) ? D.picked.filter((s) => intIn(s, 0, 9999999)).slice(0, 5).sort((a, b) => a - b) : [];
  const name = typeof D.name === "string" ? D.name : nick(c);
  const set = (o) => ({ ...D, h, picked, name, ...o });
  const kids = [];
  kids.push(...satzBlock(c, D, set));
  kids.push({ t: "choice", label: X.ter_time, wrap: true, options: HOURS.map((x, i) => ({ label: hourText(i, c.lang), draft: set({ h: i }), on: i === h })) });
  const days = [];
  for (let k = 0; k < 14; k++) {
    const day = today + k, s = day * 10 + h, on = picked.includes(s), hol = S.holiday(day, c.lang);
    const next = on ? picked.filter((x) => x !== s) : picked.concat([s]);
    days.push({ label: dayText(day, c.lang) + (hol ? " · " + hol : ""), draft: set({ picked: next }), on, disabled: !on && picked.length >= 5 });
  }
  kids.push({ t: "choice", label: X.ter_days_l, wrap: true, options: days });
  if (picked.length >= 5) kids.push(txt("small", X.ter_max));
  kids.push({ t: "choice", label: X.ter_chosen, wrap: true, options: picked.map((s) => ({ label: slotText(s, c.lang) + " ✕", draft: set({ picked: picked.filter((x) => x !== s) }), on: true })) });
  kids.push({ t: "field", key: "name", label: X.ter_name, value: name, max: 12, mode: "name", hint: X.ter_name });
  const v = [name.trim(), picked];
  kids.push(go(c, p, v, !L.nameOk(v[0]) ? fmt(U.whyOpen, { s: X.ter_name }) : X.ter_pick));
  return { t: "stack", children: kids };
}
/** Satz zu Formular (satz-ui.js MODES.termin): ein Satz -> Regeln (KI-Art plan oder Regelleser ohne KI) -> Termine. */
function satzBlock(c, D, set) {
  const T = SATZ[c.lang] || SATZ.de, satz = typeof D.satz === "string" ? D.satz : "", kids = [];
  kids.push({ t: "field", key: "satz", label: T.h, value: satz, max: 200, mode: "text", hint: T.ph });
  if (!satz.trim()) return kids;
  const rule = D.ai && typeof D.ai === "object" ? D.ai : S.localPlan(satz);
  kids.push({ t: "ai", kind: "plan", label: T.ki, input: { satz, art: S.planArt(satz, false) }, into: "ai" });
  if (!rule) { kids.push(txt("small", T.none)); return kids; }
  const named = S.namedDay(satz, c.today), r = S.slots(rule, { today: c.today, nowHour: 24, def: 6, day: named });
  kids.push(txt("small", (D.ai ? "✨ " + T.kiRead : "⚙ " + T.local)));
  if (!r.slots.length) { kids.push(txt("small", r.none ? T.byPref : T.none)); return kids; }
  if (r.skipped.length) kids.push(txt("small", fmt(T.hol, { d: r.skipped.map((x) => dayText(x, c.lang) + " " + S.holiday(x, c.lang)).join(", ") })));
  if (r.rounded) kids.push(txt("small", fmt(T.round, { t: r.rounded, h: hourText(r.slots[0] % 10, c.lang) })));
  kids.push({ t: "choice", label: T.take, options: [{ label: T.take + ": " + r.slots.map((s) => slotText(s, c.lang)).join(" · "), draft: set({ picked: r.slots.slice(0, 5), h: r.slots[0] % 10, satz: "", ai: null, title: rule.titel || "" }) }] });
  return kids;
}
const SATZ = {
  de: { h: "Wann, wie lange, wo? Ein Satz reicht", ph: "Grillen bei mir nächsten Samstagabend", ki: "KI-Vorschlag", kiRead: "KI-Vorschlag", local: "Ohne KI erkannt", take: "Übernehmen", none: "Keine passenden Termine. Tipp die Tage unten selbst an.", byPref: "Deine Vorgaben schließen alle Termine aus.", hol: "Ohne Feiertag: {d}", round: "{t} gibt es im Raster nicht, nächste Zeit: {h}", ics: "Termin in den Kalender (.ics)" },
  en: { h: "When, how long, where? One sentence will do", ph: "Barbecue at mine next Saturday evening", ki: "AI suggestion", kiRead: "AI suggestion", local: "Recognised without AI", take: "Use it", none: "No matching dates. Tap the days below yourself.", byPref: "Your defaults rule out every date.", hol: "Public holiday left out: {d}", round: "{t} is not on the grid, nearest time: {h}", ics: "Add to calendar (.ics)" }
};
export function vote(p, c) {
  const U = ui(c.lang), X = c.X, D = d(c), list = termDates(c.m);
  const name = typeof D.name === "string" ? D.name : nick(c);
  const v = Array.isArray(D.v) && D.v.length === list.length ? D.v.map((x) => (intIn(x, 0, 2) ? x : -1)) : list.map(() => -1);
  const set = (o) => ({ ...D, name, v, ...o });
  const taken = fold(name) && voted(c.m).some((x) => fold(x) === fold(name));
  const kids = [];
  if (p.peek) kids.push(txt("big", p.peek(c.doc, c.m, c.now, c.lang)));
  kids.push({ t: "field", key: "name", label: X.ter_name, value: name, max: 12, mode: "name", hint: X.ter_name });
  if (taken) kids.push(txt("small", X.ter_taken));
  kids.push({ t: "choice", label: "", options: [{ label: X.ter_all_yes, draft: set({ v: list.map(() => 0) }) }] });
  list.forEach((s, i) => {
    kids.push({ t: "choice", label: slotText(s, c.lang), options: [X.ter_yes, X.ter_maybe, X.ter_no].map((w, k) => { const n = v.slice(); n[i] = k; return { label: w, draft: set({ v: n }), on: v[i] === k }; }) });
  });
  kids.push(txt("small", X.ter_hint));
  const a = [name.trim(), v];
  kids.push(go(c, p, v.every((x) => x >= 0) ? a : null, taken ? X.ter_taken : !L.nameOk(a[0]) ? fmt(U.whyOpen, { s: X.ter_name }) : fmt(U.whyOpen, { s: X.ter_vote })));
  return { t: "stack", children: kids };
}
/** .ics fuer den fuehrenden Termin (satz.js ics, schwebende Ortszeit, keine Namen, kein Ort). now = Stempel des Hosts. */
export function icsNode(slot, title, lang, stamp) {
  const T = SATZ[lang] || SATZ.de;
  return { t: "file", name: lang === "en" ? "date.ics" : "termin.ics", mime: "text/calendar", text: S.ics(slot, title, 60, stamp), label: T.ics };
}

// ---------- gemeinsame Liste (Einkauf) und Wunschzettel ----------
function listDraft(c, p, own) {
  const D = d(c), base = c.m.length ? c.m[0][0] : null, cf = p.cfg;
  const e = { name: own ? "" : typeof D.name === "string" ? D.name.trim() : nick(c), face: intIn(D.face, 0, L.FACES.length - 1) ? D.face : 0,
    adds: Array.isArray(D.adds) ? D.adds.filter((a) => a && typeof a.text === "string" && intIn(a.qty, 1, cf.qty)) : [],
    marks: D.marks && typeof D.marks === "object" && !Array.isArray(D.marks) ? D.marks : {} };
  return { D, base, cf, e, now: L.shopApply(base, e, cf) };
}
function addRow(c, X, k, st, set) {
  const raw = typeof st.D.neu === "string" ? st.D.neu : "";
  // Einkauf: Menge vorn (shopParse); Wunsch: nur Text bis cf.text, Menge 1 (turn2.js:126)
  const parsed = !raw.trim() ? null : st.cf.wish ? ((w) => (w && L.shopKey(w) ? { text: w, qty: 1 } : null))(clean(raw, st.cf.text)) : L.shopParse(raw);
  const kids = [{ t: "field", key: "neu", label: X[k + "_field"], value: raw, max: st.cf.text + 3, mode: "text", hint: X[k + "_ph"] }];
  let why = "";
  if (raw.trim() && !parsed) why = ui(c.lang).filter;
  else if (parsed && st.now[1].some((it) => L.shopKey(it[0]) === L.shopKey(parsed.text))) why = X[k + "_have"];
  else if (parsed) {
    const next = L.shopApply(st.base, { ...st.e, adds: st.e.adds.concat([parsed]) }, st.cf);
    if (!next[1].some((it) => L.shopKey(it[0]) === L.shopKey(parsed.text))) why = X[k + "_full"];
  }
  kids.push({ t: "choice", label: "", options: [{ label: "+ " + X[k + "_add"], draft: set({ adds: parsed && !why ? st.e.adds.concat([parsed]) : st.e.adds, neu: parsed && !why ? "" : raw }), disabled: !parsed || !!why }] });
  if (why) kids.push(txt("small", why));
  return kids;
}
export function shop(p, c) {
  const X = c.X, st = listDraft(c, p, false), named = L.nameOk(st.e.name);
  const set = (o) => ({ ...st.D, name: st.e.name, face: st.e.face, adds: st.e.adds, marks: st.e.marks, ...o });
  const kids = [txt("label", askText(p, c)), ...addRow(c, X, "ein", st, set)];
  const rows = L.shopRows(st.now, st.cf);
  if (!rows.length) kids.push(txt("small", X.ein_empty));
  for (const r of rows) {
    const mine = named ? L.shopMark(st.now, st.e.name, r.key) % 3 : 0;
    const who = r.bought.length ? fmt(X.ein_got, { n: L.shopNames(r.bought) }) : r.bring.length ? fmt(X.ein_brings, { n: L.shopNames(r.bring) }) : "";
    const sent = !!st.base && st.base[1].some((it) => L.shopKey(it[0]) === r.key);
    const opts = [
      { label: X.ein_bring, draft: set({ marks: { ...st.e.marks, [r.key]: mine === 1 ? 0 : 1 } }), on: mine === 1, disabled: !named },
      { label: X.ein_bought, draft: set({ marks: { ...st.e.marks, [r.key]: mine === 2 ? 0 : 2 } }), on: mine === 2, disabled: !named }];
    if (!sent) opts.push({ label: X.ein_drop, draft: set({ adds: st.e.adds.filter((a) => L.shopKey(a.text) !== r.key) }) });
    kids.push({ t: "choice", label: r.label + (who ? " · " + who : ""), options: opts });
  }
  kids.push({ t: "field", key: "name", label: X.ein_name, value: st.e.name, max: 12, mode: "name", hint: X.ter_name });
  if (!named && rows.length) kids.push(txt("small", X.ein_need_name));
  kids.push(txt("small", X.ein_hint));
  const good = ok(p, c, st.now);
  kids.push({ t: "go", label: X.ein_send, input: good ? answerInput(c, st.now) : null, disabled: !good, why: good ? "" : X.ein_empty });
  return { t: "stack", children: kids };
}
/** Wunschzettel: Das Geraet der Wuenschenden zeigt nur die Wuensche, nie eine Marke und nie wer schenkt (turn2.js:63). */
export function wish(p, c) {
  const X = c.X, D = d(c);
  // Wer ist das? Das Geraet merkt es sich je Partie (ctx.memo, Host-Merkzettel, nie im Link; alt K.store.wown,
  // turn2.js:68-78): wer den Zettel hier anlegt (k = 0), ist die Wuenschende; ein fremdes Geraet fragt genau einmal.
  const memo = c.ctx && c.ctx.memo && typeof c.ctx.memo === "object" ? c.ctx.memo : {};
  const own = typeof memo.own === "boolean" ? memo.own : c.pub.k === 0 ? true : null;
  if (own === null) {
    return { t: "stack", children: [txt("label", X.wun_who),
      { t: "choice", label: X.wun_who, options: [{ label: X.wun_iam, memo: { own: true } }, { label: X.wun_igive, memo: { own: false } }] },
      txt("small", X.wun_who_why)] };
  }
  const st = listDraft(c, p, own), named = L.nameOk(st.e.name);
  const set = (o) => ({ ...D, name: st.e.name, face: st.e.face, adds: st.e.adds, marks: st.e.marks, ...o });
  const kids = [txt("label", own ? X.wun_make : askText(p, c))];
  if (own) kids.push(...addRow(c, X, "wun", st, set));
  const rows = L.shopRows(st.now, st.cf);
  if (!rows.length) kids.push(txt("small", X.wun_empty));
  for (const r of rows) {
    if (own) {
      const sent = !!st.base && st.base[1].some((it) => L.shopKey(it[0]) === r.key);
      kids.push({ t: "choice", label: r.label, options: sent ? [] : [{ label: X.wun_drop, draft: set({ adds: st.e.adds.filter((a) => L.shopKey(a.text) !== r.key) }) }] });
      continue;
    }
    const me = named && L.shopMark(st.now, st.e.name, r.key) % 3 === 1;
    const others = r.bring.filter((x) => !named || fold(x[0]) !== fold(st.e.name)).length;
    const line = me ? (others ? X.wun_both : X.wun_yours) : others ? X.wun_taken : "";
    kids.push({ t: "choice", label: r.label + (line ? " · " + line : ""), options: [{ label: "🎁 " + X.wun_bring, draft: set({ marks: { ...st.e.marks, [r.key]: me ? 0 : 1 } }), on: me, disabled: !named || (others > 0 && !me) }] });
  }
  if (!own) { kids.push({ t: "field", key: "name", label: X.wun_name, value: st.e.name, max: 12, mode: "name", hint: X.ter_name }); if (!named) kids.push(txt("small", X.ein_need_name)); }
  kids.push(txt("small", own ? X.wun_own_hint : X.wun_hint));
  // Ihre Antwort fuehrt die Marken der Familie unsichtbar weiter (alt now() = shopApply(base, …)); sie sieht sie nie.
  const out = st.now;
  const good = ok(p, c, out);
  // beim Anlegen merkt sich dieses Geraet "mein Zettel" (memo), damit ein spaeteres Oeffnen keine Marke zeigt
  kids.push({ t: "go", label: X.inv_send || ui(c.lang).next, input: good ? answerInput(c, out) : null, disabled: !good, why: good ? "" : X.wun_empty, ...(own && typeof memo.own !== "boolean" ? { memo: { own: true } } : {}) });
  if (own && c.m.length) kids.push({ t: "choice", label: X.wun_close_q, options: [{ label: "🔒 " + X.wun_close_yes, input: { t: "close", seat: c.seat } }] });
  return { t: "stack", children: kids };
}

// ---------- Geschenk in drei Fragen ----------
export function opts(p, c) {
  const D = d(c), U = ui(c.lang), on = Array.isArray(D.on) ? D.on.filter((i) => intIn(i, 0, p.keys.length - 1)) : [];
  const tap = (i) => { const s = on.slice(), at = s.indexOf(i); if (at >= 0) s.splice(at, 1); else { if (s.length >= p.n) s.shift(); s.push(i); } return { on: s }; };
  if (p.n === 1 && p.auto) return { t: "stack", children: [{ t: "choice", label: askText(p, c), wrap: true, options: p.keys.map((k, i) => ({ label: c.X[p.pre + k], input: answerInput(c, [i]) })) }] };
  return { t: "stack", children: [{ t: "choice", label: askText(p, c), wrap: true, options: p.keys.map((k, i) => ({ label: c.X[p.pre + k], draft: tap(i), on: on.includes(i) })) },
    go(c, p, on.length === p.n ? on : null, fmt(U.pickMore, { n: p.n - on.length }))] };
}
export function ideas(p, c) {
  const D = d(c), ask = p.ask(c.now), std = giftIdeas(c.doc.seed, ask, c.lang);
  const fromKi = D.kiRaw ? fromAi(D.kiRaw) : [], list = fromKi.length ? fromKi : std;
  const on = intIn(D.i, 0, list.length - 1) ? D.i : -1;
  const kids = [txt("small", fromKi.length ? c.X.gf_kinote : D.kiRaw ? c.X.gf_none : c.X.gf_std),
    { t: "choice", label: askText(p, c), wrap: true, options: list.map((s, i) => ({ label: s, draft: { ...D, i }, on: i === on })) },
    { t: "ai", kind: "liste", label: c.X.gf_ki, input: { art: "einkauf", satz: fmt(c.X.gf_satz, { w: c.X["gfw_" + ask.who], b: ask.euro + " €", l: ask.likes.map((k) => c.X["gfl_" + k]).join(", ") }) }, into: "kiRaw" }];
  if (D.kiRaw) kids.push({ t: "choice", label: "", options: [{ label: c.X.gf_back, draft: { ...D, kiRaw: null, i: -1 } }] });
  kids.push(go(c, p, on >= 0 ? [list.slice(), on] : null));
  return { t: "stack", children: kids };
}
