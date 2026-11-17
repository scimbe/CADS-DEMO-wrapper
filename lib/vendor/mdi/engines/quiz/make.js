// Ein Fragepaket machen (alt:src/quizmake.js): die Antwort des Servers als Paket, die größten Züge, die ein Paket haben
// kann, und das meiste eines Pakets, das noch in einen Link passt. Rein (kein DOM).
import { MODES, MAX_Q, MIN_Q, CHOICE, sanitize, whole, nums, fits } from "./pack.js";
import { fmt } from "../seed32/seed32.js";

/** Die Option des Servers (kind quiz) als Paket: {modus, titel, fragen, typen?}. Was der Server nicht sagte, bleibt weg. */
export function fromOption(opt) {
  if (!opt || typeof opt !== "object" || !MODES[opt.modus] || !Array.isArray(opt.fragen)) return null;
  const m = MODES[opt.modus], o = { t: opt.titel, m, q: [] };
  if (m === "g") {
    o.y = (Array.isArray(opt.typen) ? opt.typen : []).map((y) => [y && y.name, y && y.staerke]);
    o.q = opt.fragen.map((q) => [q && q.f].concat((q && Array.isArray(q.antworten) ? q.antworten : []).map((a) => [a && a.t, a && a.typ])));
  } else {
    o.q = opt.fragen.map((q) => [q && q.f, q && q.a].concat(q && Array.isArray(q.d) ? q.d.slice(0, 3) : []));
    o.z = opt.fragen.map((q) => (q ? whole(q.a) : 0));
  }
  return sanitize(o);
}

/** Jeder Text eines Pakets, z. B. für eine weitere Prüfung gegen eine Wortliste. */
export function texts(p) {
  const out = [p.t];
  (p.y || []).forEach((y) => { out.push(y[0], y[1]); });
  p.q.forEach((q) => { q.forEach((x) => { out.push(Array.isArray(x) ? x[0] : x); }); });
  return out;
}
export function clean(p, ok) { return texts(p).every((s) => ok(s)); }

/** Das meiste des Pakets, das nach jedem Zug noch in einen Link passt (Altcode fit): erst weniger falsche Antworten
 *  (zwei statt drei), dann weniger Fragen vom Ende. Schätzen behält nur seine Zahlenfragen. Statt der Größe des alten
 *  Dokuments misst size(pk) die Länge des Links mit dem größten möglichen Spielstand (das weiß der Host, nicht die
 *  Engine). g: Spielart (abfragen | quiz | typen | schaetzen ...). -> Paket oder null. */
export function fit(g, pk, size, room) {
  const base = structuredClone(pk);
  if (base.m !== "g" && !CHOICE[g]) base.q = base.q.map((r) => r.slice(0, 2)); // falsche Antworten zeigt dieses Spiel nie
  if (g === "schaetzen" && base.z) {
    const keep = base.q.map((x, i) => base.z[i] > 0);
    base.q = base.q.filter((x, i) => keep[i]); base.z = base.z.filter((x, i) => keep[i]);
  }
  for (let n = Math.min(base.q.length, MAX_Q); n >= MIN_Q; n--) {
    for (let short = 0; short < 2; short++) {
      const p = structuredClone(base); p.q = p.q.slice(0, n); if (p.z) p.z = p.z.slice(0, n);
      // kürzer: zwei falsche Antworten; ein Gruppenpaket behält drei Typen und nur die Antworten, die auf sie zeigen
      if (short && p.m !== "g") p.q = p.q.map((r) => r.slice(0, Math.min(r.length, 4)));
      if (short && p.m === "g") {
        p.y = p.y.slice(0, 3);
        p.q = p.q.map((r) => [r[0]].concat(r.slice(1).filter((a) => a[1] < 3).slice(0, 3))).filter((r) => r.length >= 3);
        if (p.q.length < MIN_Q) continue;
      }
      if (!fits(g, p)) continue;
      if (size(p) <= room) return p;
    }
  }
  return null;
}

/** Schätzen am Ende: ein fester Satz je Person aus dem mittleren Abstand relativ zu jeder Zahl (alles genau, nah, gut,
 *  Luft; nie als Prozent), dann je Frage der Abstand mit Einheit. ds: Abstände je Person, who: Namen. */
export function ende(doc, ds, L, who) {
  const pk = doc.pk, u = pk.u || [], n = nums(doc);
  if (!L.pk_ql) return [];
  return ds.map((d, k) => {
    const r = d.reduce((s, x, j) => s + Math.min(1, x / pk.z[n[j]]), 0) / d.length, t = L["pk_t" + (r ? (r <= 0.1 ? 1 : r <= 0.3 ? 2 : 3) : 0)];
    return who[k] ? fmt(L.pk_near, { w: who[k], s: t }) : t;
  }).concat(n.map((i, j) => {
    const U = u[i] ? " " + u[i] : "";
    return fmt(L.pk_ql, { q: pk.q[i][0], z: pk.z[i] + U, a: ds.map((d) => (d[j] ? fmt(L.pk_dn, { n: d[j] + U }) : L.pk_d0)).join(" / ") });
  }));
}
