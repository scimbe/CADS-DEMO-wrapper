// Bots fuer Echtzeit-Beschreibungen (Strang B). Heuristiken aus der Beschreibung (bot.kind) und ein generischer
// Rollout-Bot (k Eingaben x h Ticks mit dem Interpreter als Vorwaertsmodell; 08-forschung/generische-bots.md Befund 3).
// Rein und deterministisch: gleiche Eingaben (Zustand, Sitz, Stufe) -> gleiche Ausgabe; Rauschen nur aus Zahlen-Seeds,
// die aus Tick und Sitz entstehen. Derselbe Code ist Gegner im Spiel und Spieler im Pruefer (harness.js).
import { rng as mkRng } from "../../contract/sdk.js";
import { step, fitOf, isGrid, VIEW } from "./engine.js";

const abs = (v) => (v < 0 ? -v : v);
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const NONE = Object.freeze({ b: 0 });

function idxOf(d) { return new Map(d.things.map((t, i) => [t.id, i])); }
/** Welche Dinge eine Regel schaedlich (Leben, verlieren) bzw. nuetzlich (Punkte) fuer a macht. */
function rolesOf(d, aId) {
  const bad = new Set(), good = new Set();
  for (const r of d.rules) {
    if (r.when !== "touch" || r.a !== aId) continue;
    if (r.do.some((f) => (f.act === "life" && f.n < 0) || (f.act === "lose" && (f.on === "a" || f.on === "actor")))) bad.add(r.b);
    if (r.do.some((f) => f.act === "score" && f.n > 0 && (f.on === "a" || f.on === "actor"))) good.add(r.b);
  }
  return { bad, good };
}

/** Bot-Plan aus der Beschreibung; ohne bot.kind wird er aus der Steuerung abgeleitet (nie leer, wenn es eine Steuerung gibt). */
export function planOf(d) {
  if (d.bot.kind !== "none") return d.bot;
  const own = d.start.filter((p) => p.seat >= 0).map((p) => d.things.find((t) => t.id === p.thing)).find((t) => t && t.control !== "none" && t.control !== "tap");
  const tap = d.things.find((t) => t.control === "tap");
  if (!own && tap) return { kind: "tap", thing: "", target: tap.id };
  if (!own) return { kind: "none", thing: "", target: "" };
  const { bad, good } = rolesOf(d, own.id);
  const ball = d.things.find((t) => t.bounce !== "none" && t.id !== own.id);
  if (own.control === "flap") return { kind: "flap", thing: own.id, target: [...bad][0] || "" };
  if (own.control === "jump" && bad.size) return { kind: "jump", thing: own.id, target: [...bad][0] };
  if (own.control === "steer") return { kind: "seek", thing: own.id, target: [...good][0] || "" };
  if (["lr", "ud", "drag", "move"].includes(own.control) && ball) return { kind: "track", thing: own.id, target: ball.id };
  if (own.control === "move" && good.size) return { kind: "seek", thing: own.id, target: [...good][0] };
  if (["lr", "ud", "drag", "move"].includes(own.control) && bad.size) return { kind: "dodge", thing: own.id, target: [...bad][0] };
  return { kind: "rollout", thing: own.id, target: "" };
}

/** Hoechstens so viele Kandidaten (Rollout kostet |K|^2 * h Schritte; Review H1: 140 Tipp-Ziele froren den Tab ein). */
export const MAX_CANDIDATES = 6;
/** Eingabekandidaten einer Steuerung (Aktionsraum fuer Rollout und Zufallsbot), hoechstens MAX_CANDIDATES. */
export function candidates(d, seat, st) {
  const own = st.e.find((e) => e.s === seat && !["none", "tap"].includes(d.things[e.k].control));
  const c = own ? d.things[own.k].control : "none";
  if (c === "flap" || c === "jump") return [{ b: 0 }, { b: 1 }];
  if (c === "lr" || c === "drag") return [{ b: 0 }, { b: 0, ax: -1000 }, { b: 0, ax: 1000 }];
  if (c === "ud") return [{ b: 0 }, { b: 0, ay: -1000 }, { b: 0, ay: 1000 }];
  if (c === "move") return [{ b: 0 }, { b: 0, ax: -1000 }, { b: 0, ax: 1000 }, { b: 0, ay: -1000 }, { b: 0, ay: 1000 }];
  if (c === "steer") return [{ b: 0, ax: 1000 }, { b: 0, ay: 1000 }, { b: 0, ax: -1000 }, { b: 0, ay: -1000 }];
  const tap = d.things.findIndex((t) => t.control === "tap");
  if (tap >= 0) {
    const f = fitOf(d), out = [{ b: 0 }];
    for (const e of st.e) if (e.k === tap && (e.ln < 0 || e.ln === seat) && out.length < MAX_CANDIDATES) out.push(tapAt(d, f, e, 0));
    return out;
  }
  return [{ b: 0 }];
}
function tapAt(d, f, e, id) {
  const grid = isGrid(d), cw = grid ? Math.trunc(d.world.w / d.world.cols) : 0, ch = grid ? Math.trunc(d.world.h / d.world.rows) : 0;
  const wx = grid ? e.x * cw + (cw >> 1) : e.x >> 8, wy = grid ? e.y * ch + (ch >> 1) : e.y >> 8;
  return { b: 0, p: [[id, f.ox + Math.trunc(wx * f.num / f.den), f.oy + Math.trunc(wy * f.num / f.den), 3]] };
}

/** Zufallsbot (Pruefer): wechselt alle 8 Ticks zufaellig zwischen den Kandidaten; Tippspiele tippen auf zufaellige Stellen
 *  (nie auf bekannte Ziele, sonst waere der Zufallsbot ein verkappter guter Bot). */
export function randomBot(d, st, seat, seed) {
  const r = mkRng(((seed >>> 0) ^ Math.imul((st.t >> 3) + 1, 0x9e3779b1) ^ (seat * 7919)) >>> 0);
  const own = st.e.some((e) => e.s === seat && !["none", "tap"].includes(d.things[e.k].control));
  if (!own && d.things.some((t) => t.control === "tap")) return (st.t & 7) === 0 && r.int(2) === 0 ? { b: 0, p: [[0, r.int(VIEW.w), r.int(VIEW.h), 3]] } : { b: 0 };
  const c = candidates(d, seat, st);
  const x = c[r.int(c.length)];
  // Knoepfe nur im ersten Tick des Fensters druecken (wie ein Mensch, der tippt)
  return (x.b || x.p) && (st.t & 7) !== 0 ? { b: 0 } : x;
}

/**
 * Heuristischer Bot. level 1..3 (Reaktion, Genauigkeit). Liefert ein Input fuer den Sitz.
 */
export function botInput(d, st, seat, level = 2, plan = planOf(d), meter = null) {
  if (st.over || st.out[seat]) return NONE;
  const idx = idxOf(d), W = d.world.w * 256, H = d.world.h * 256;
  const me = st.e.find((e) => e.s === seat && plan.thing && e.k === idx.get(plan.thing));
  const tk = plan.target ? idx.get(plan.target) : -1;
  // Rauschen aus Zeitfenster, Sitz, Stufe UND dem Zufallszustand der Partie: verschiedene Seeds ergeben verschiedene Bot-Partien
  // (vorher war das Rauschen vom Seed unabhaengig; jede Prueferpartie spielte gleich -> Scheinbefunde wie "unfair")
  const salt = st.r ? st.r[0] : 0;
  const noise = mkRng(((st.t >> 5) * 2654435761 + seat * 97 + level + salt) >>> 0);
  switch (plan.kind) {
    case "track": {
      if (!me) return NONE;
      const ctl = d.things[me.k].control, axisY = ctl === "ud";
      let best = null;
      for (const e of st.e) if (e.k === tk) { const toward = axisY ? sgn(me.x - e.x) === sgn(e.vx) : sgn(me.y - e.y) === sgn(e.vy); const dist = axisY ? abs(me.x - e.x) : abs(me.y - e.y); if (!best || (toward && !best.toward) || (toward === best.toward && dist < best.dist)) best = { e, toward, dist }; }
      let aim = axisY ? H >> 1 : W >> 1;
      if (best && best.toward) {
        const e = best.e, v = axisY ? e.vx : e.vy, ticks = v ? Math.trunc(best.dist / abs(v)) : 0;
        let p = axisY ? e.y + e.vy * ticks : e.x + e.vx * ticks;
        const lo = 0, hi = axisY ? H : W;
        for (let i = 0; i < 6 && (p < lo || p > hi); i++) p = p < lo ? 2 * lo - p : 2 * hi - p;   // Bande spiegeln
        aim = p;
        if (level < 3) aim += (noise.int(2001) - 1000) * (axisY ? me.hh : me.hw) * (3 - level) / 1000;
      } else if (best) aim = axisY ? best.e.y : best.e.x;
      const pos = axisY ? me.y : me.x, dead = (axisY ? me.hh : me.hw) >> 2;
      const go = aim > pos + dead ? 1000 : aim < pos - dead ? -1000 : 0;
      return axisY ? { b: 0, ay: go } : { b: 0, ax: go };
    }
    case "flap": {
      if (!me) return NONE;
      let minX = Infinity;
      for (const e of st.e) if (e.k === tk && e.x + e.hw > me.x - me.hw && e.x < minX) minX = e.x;
      let top = 0, bot = H;
      if (minX !== Infinity) for (const e of st.e) if (e.k === tk && e.x === minX) { if (e.y - e.hh <= 256 * 4) top = Math.max(top, e.y + e.hh); else if (e.y + e.hh >= H - 256 * 4) bot = Math.min(bot, e.y - e.hh); else { if (e.y < me.y) top = Math.max(top, e.y + e.hh); else bot = Math.min(bot, e.y - e.hh); } }
      // so spaet wie moeglich flattern: nur wenn der Vogel in ~8 Ticks unter die Unterkante der Luecke faellt
      // (der Scheitel nach einem Flattern bleibt dann in der Luecke); ohne Roehre: Bildmitte halten
      if (minX === Infinity) bot = (H >> 1) + me.hh * 2;
      const g = Math.trunc(d.world.gravity * 256 / 3600), k = 8, fall = me.y + me.vy * k + ((g * k * k) >> 1) + me.hh;
      const margin = (level === 3 ? 24 : level === 2 ? 48 : 90) * 256 + noise.int(20) * 256 * (3 - level);
      // Scheitel nach einem Flattern (v^2 / 2g): darf die Oberkante der Luecke nicht erreichen, ausser der Absturz droht sofort
      const pw = Math.trunc(d.things[me.k].power * 256 / 60), rise = g > 0 ? Math.trunc(pw * pw / (2 * g)) : 0;
      const apexTop = me.y - me.hh - rise, urgent = me.y + me.hh + me.vy * 3 + g * 5 > bot - 8 * 256;
      if (fall > bot - margin && (apexTop > top + 16 * 256 || urgent) && me.vy >= -g * 4) return { b: 1 };
      return NONE;
    }
    case "jump": {
      // springen, wenn das naechste schaedliche Ding in etwa einer halben Flugzeit ankommt (Flugzeit = 2v/g)
      if (!me || !me.g) return NONE;
      const g = Math.max(1, Math.trunc(d.world.gravity * 256 / 3600)), pw = Math.trunc(d.things[me.k].power * 256 / 60), air = Math.trunc(2 * pw / g);
      let ttc = Infinity;
      for (const e of st.e) {
        if (e.k !== tk) continue;
        const rel = e.vx - me.vx, dx = e.x - me.x, gap = abs(dx) - me.hw - e.hw;
        if (abs(e.y - me.y) > me.hh + e.hh + 256 * 40) continue;
        if (gap > 0 && rel !== 0 && sgn(rel) === -sgn(dx)) ttc = Math.min(ttc, Math.trunc(gap / abs(rel)));
      }
      const win = Math.trunc(air * (level === 3 ? 40 : level === 2 ? 34 : 22) / 100);
      return ttc <= win ? { b: 1 } : NONE;
    }
    case "dodge": {
      if (!me) return NONE;
      if (!isGrid(d)) return predict(d, st, me, tk, -1, level);
      if (d.things[me.k].control === "ud") {
        // Bedrohung kommt waagerecht: die naechste auf Kollisionskurs bestimmt, ob nach oben oder unten ausgewichen wird
        let th = null;
        for (const e of st.e) if (e.k === tk && sgn(me.x - e.x) === sgn(e.vx) && abs(e.y - me.y) < (me.hh + e.hh) * 2) { if (!th || abs(e.x - me.x) < abs(th.x - me.x)) th = e; }
        if (!th) return { b: 0, ay: me.y < (H >> 1) - me.hh ? 1000 : me.y > (H >> 1) + me.hh ? -1000 : 0 };
        const away = th.y >= me.y ? -1000 : 1000;
        return { b: 0, ay: (me.y < me.hh * 2 && away < 0) || (me.y > H - me.hh * 2 && away > 0) ? -away : away };
      }
      let threat = null;
      for (const e of st.e) if (e.k === tk && abs(e.x - me.x) < (me.hw + e.hw) * 2 && (e.y < me.y ? e.vy >= 0 : true) && abs(e.y - me.y) < 256 * 600) { if (!threat || abs(e.y - me.y) < abs(threat.y - me.y)) threat = e; }
      if (!threat) return { b: 0, ax: me.x < (W >> 1) - me.hw ? 1000 : me.x > (W >> 1) + me.hw ? -1000 : 0 };
      const away = threat.x >= me.x ? -1000 : 1000;
      return { b: 0, ax: (me.x < me.hw * 2 && away < 0) || (me.x > W - me.hw * 2 && away > 0) ? -away : away };
    }
    case "seek": return isGrid(d) ? seek(d, st, seat, me, tk, level) : steerFree(d, st, me, tk, level);
    case "tap": {
      const react = level === 3 ? 14 : level === 2 ? 24 : 38, f = fitOf(d);
      // menschliches Tempo (Isaksen et al.: Aktionsrate): hoechstens ein Tippen je Reaktionszeit, erst nach der Reaktionszeit
      // Phase aus dem Seed je Sitz und Zeitfenster: beide Seiten im Mittel gleich schnell (vorher feste Phase je Sitz -> Schieflage)
      const phase = mkRng(((st.t / react | 0) * 2654435761 + seat * 40503 + 17 + salt) >>> 0).int(react);
      if (st.t % react !== phase) return NONE;
      for (const e of st.e) if (e.k === tk && st.t - e.b >= react) return tapAt(d, f, e, 0);
      return NONE;
    }
    case "rollout": return rollout(d, st, seat, level, meter);
    default: return NONE;
  }
}

// Vorausschau ohne Interpreter (billig): fuer jede Richtung der Steuerung die Figur h Ticks geradeaus fahren, alle anderen
// Dinge mit ihrem Tempo (und Schwerkraft) fortschreiben; Wert = kleinster Abstand zu schaedlichen Dingen (Sicherheit),
// beim Sammeln minus Abstand zum naechsten Ziel am Ende. Stufe = Horizont. Gleichstand: stehen bleiben.
function predict(d, st, me, badK, goodK, level) {
  const t = d.things[me.k], c = t.control, pw = Math.trunc(t.power * 256 / 60), W = d.world.w * 256, H = d.world.h * 256;
  const g = Math.trunc(d.world.gravity * 256 / 3600), h = level === 3 ? 48 : level === 2 ? 32 : 16;
  const { bad } = rolesOf(d, t.id), idx = idxOf(d);
  const badSet = new Set([...bad].map((b) => idx.get(b))); if (badK >= 0) badSet.add(badK);
  const dirs = c === "lr" || c === "drag" ? [[0, 0], [-1, 0], [1, 0]] : c === "ud" ? [[0, 0], [0, -1], [0, 1]]
    : [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const others = st.e.filter((e) => e !== me && same(e, me) && (badSet.has(e.k) || e.k === goodK));
  let best = dirs[0], bs = -Infinity;
  for (const [dx, dy] of dirs) {
    let x = me.x, y = me.y, safe = Infinity, nd = Infinity, at = h;
    for (let i = 1; i <= h; i += 2) {
      x = clampI(x + dx * pw * 2, me.hw, W - me.hw); y = clampI(y + dy * pw * 2, me.hh, H - me.hh);
      // naechste Annaeherung an ein Ziel entlang des Wegs (nicht am Ende: sonst schiesst die Figur ueber das Ziel hinaus und pendelt)
      if (goodK >= 0) for (const o of others) if (o.k === goodK) { const dd = abs(o.x - x) + abs(o.y - y); if (dd < nd) { nd = dd; at = i; } }
      for (const o of others) {
        if (!badSet.has(o.k)) continue;
        const ox = o.x + o.vx * i, oy = o.y + o.vy * i + (d.things[o.k].gravity ? (g * i * i) >> 1 : 0);
        const gap = Math.max(abs(ox - x) - me.hw - o.hw, abs(oy - y) - me.hh - o.hh);
        if (gap < safe) safe = gap;
      }
    }
    // Sicherheit zuerst: innerhalb von drei Koerperlaengen zaehlt jeder Abstand achtfach, darueber nur bis zur Grenze
    const margin = (me.hw + me.hh) * 5;
    let v = Math.min(safe, margin) * 8 + Math.min(Math.max(safe - margin, 0), 256 * 200);
    if (goodK >= 0 && nd < Infinity) v -= (nd >> 1) + at * 64;
    // offene Flaeche ist sicherer als eine Ecke (sonst treibt ein Verfolger die Figur in die Ecke): Wandabstand zaehlt,
    // solange ein schaedliches Ding naeher als die Sicherheitsgrenze ist
    if (others.some((o) => badSet.has(o.k))) { const wall = Math.min(x - me.hw, W - me.hw - x, y - me.hh, H - me.hh - y); v += Math.min(wall, margin) * 4; }
    // Traegheit: die Richtung, in die die Figur schon faehrt (Tempo im Zustand), bekommt einen Vorsprung -> kein Pendeln
    // zwischen zwei fast gleich guten Richtungen, waehrend ein Verfolger aufholt (Gold-Dev "Pinguin", Beispiel Sammeln)
    if (dx === sgn(me.vx) && dy === sgn(me.vy)) v += margin;
    if (dx === 0 && dy === 0) v += 1;
    if (v > bs) { bs = v; best = [dx, dy]; }
  }
  return { b: 0, ax: best[0] * 1000, ay: best[1] * 1000 };
}
const clampI = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Lenkverhalten (C. Reynolds, "Steering Behaviors for Autonomous Characters", GDC 1999: seek/flee): Anziehung zum
// naechsten Ziel (Einheitsvektor), Abstossung von schaedlichen Dingen innerhalb des Radius R (staerker, je naeher, mit
// Vorhersage ihrer Bewegung) und von Waenden. Stetige Richtung statt Auswahl -> kein Pendeln. Nur Ganzzahlen.
function steerFree(d, st, me, tk, level) {
  if (!me) return NONE;
  const W = d.world.w * 256, H = d.world.h * 256, body = me.hw + me.hh, R = body * (level === 3 ? 7 : level === 2 ? 5 : 3);
  const { bad } = rolesOf(d, d.things[me.k].id), idx = idxOf(d), badK = new Set([...bad].map((b) => idx.get(b)));
  const unit = (x, y, k) => { const m = Math.max(abs(x), abs(y), 1); return [Math.trunc(x * k / m), Math.trunc(y * k / m)]; };
  let fx = 0, fy = 0, target = null, bd = 0;
  for (const e of st.e) if (e.k === tk && same(e, me)) { const dd = abs(e.x - me.x) + abs(e.y - me.y); if (!target || dd < bd) { target = e; bd = dd; } }
  if (target) [fx, fy] = unit(target.x - me.x, target.y - me.y, 1000);
  for (const e of st.e) {
    if (!badK.has(e.k) || !same(e, me)) continue;
    const px = e.x + e.vx * 12, py = e.y + e.vy * 12, dx = me.x - px, dy = me.y - py, dd = Math.max(abs(dx), abs(dy));
    if (dd >= R) continue;
    const [ux, uy] = unit(dx, dy, Math.trunc(3000 * (R - dd) / R));
    fx += ux; fy += uy;
  }
  const wall = body * 2;
  if (me.x < wall) fx += Math.trunc(2000 * (wall - me.x) / wall); if (W - me.x < wall) fx -= Math.trunc(2000 * (wall - (W - me.x)) / wall);
  if (me.y < wall) fy += Math.trunc(2000 * (wall - me.y) / wall); if (H - me.y < wall) fy -= Math.trunc(2000 * (wall - (H - me.y)) / wall);
  const [ax, ay] = unit(fx, fy, 1000);
  return { b: 0, ax: d.things[me.k].control === "ud" ? 0 : ax, ay: d.things[me.k].control === "lr" ? 0 : ay };
}

const same = (a, b) => a.ln < 0 || b.ln < 0 || a.ln === b.ln;

// Raster: gierig zum naechsten Ziel, nie in eine toedliche Zelle; Stufe 3 prueft zusaetzlich den freien Raum (Flutfuellung)
function seek(d, st, seat, me, tk, level) {
  if (!me) return NONE;
  const C = d.world.cols, R = d.world.rows, block = new Set();
  for (const e of st.e) { for (const [cx, cy] of (e.tr || [])) block.add(cy * 64 + cx); if (e !== me && d.things[e.k].id !== d.bot.target && e.k !== tk) block.add(e.y * 64 + e.x); }
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const wrapOk = (side) => d.world[side] === "wrap";
  const cell = (x, y) => {
    if (x < 0 || x >= C || y < 0 || y >= R) {
      const side = x < 0 ? "left" : x >= C ? "right" : y < 0 ? "top" : "bottom";
      if (!wrapOk(side)) return null;
      x = (x + C) % C; y = (y + R) % R;
    }
    return block.has(y * 64 + x) ? null : [x, y];
  };
  const room = (x, y) => { const seen = new Set([y * 64 + x]), q = [[x, y]]; while (q.length && seen.size < 40) { const [a, b] = q.shift(); for (const [dx, dy] of DIRS) { const c = cell(a + dx, b + dy); if (c && !seen.has(c[1] * 64 + c[0])) { seen.add(c[1] * 64 + c[0]); q.push(c); } } } return seen.size; };
  let target = null, bd = 0;
  for (const e of st.e) if (e.k === tk) { const dd = abs(e.x - me.x) + abs(e.y - me.y); if (!target || dd < bd) { target = e; bd = dd; } }
  let best = -1, bs = -Infinity;
  for (let dir = 0; dir < 4; dir++) {
    if (me.tr.length && (dir + 2) % 4 === me.d) continue;
    const c = cell(me.x + DIRS[dir][0], me.y + DIRS[dir][1]);
    if (!c) continue;
    let s = target ? -(abs(target.x - c[0]) + abs(target.y - c[1])) : 0;
    if (level >= 2) s += Math.min(room(c[0], c[1]), me.tr.length + 4) * (level === 3 ? 3 : 1);
    if (dir === me.d) s += 0.5;
    if (s > bs) { bs = s; best = dir; }
  }
  if (best < 0) return NONE;
  return best === 0 ? { b: 0, ax: 1000 } : best === 1 ? { b: 0, ay: 1000 } : best === 2 ? { b: 0, ax: -1000 } : { b: 0, ay: -1000 };
}

// Generisch (Rollout, zweistufig): erste Eingabe x, nach h/2 Ticks zweite Eingabe y, dazwischen gehalten (Knoepfe nur als
// Druck); Wert = Ueberleben (Ticks), Sieg/Niederlage, Punkte, Leben. Der Wert von x ist das Beste ueber alle y.
// Gleichstand: der erste Kandidat (neutral). Budget: |K|^2 * h Interpreter-Schritte je Entscheidung (Stufe 3: 4*30).
function rollout(d, st, seat, level, meter) {
  const c = candidates(d, seat, st), h = level === 3 ? 30 : level === 2 ? 18 : 8, m = h >> 1;
  if (meter) meter.steps += c.length * c.length * h;
  const hold = (x, first) => (x.b || x.p ? (first ? x : NONE) : x);
  let best = c[0], bs = -Infinity;
  for (const x of c) {
    let vx = -Infinity;
    for (const y of c) {
      let s = st, i = 0;
      for (; i < h && !s.over && !s.out[seat]; i++) {
        const ins = [NONE, NONE]; ins[seat] = i < m ? hold(x, i === 0) : hold(y, i === m);
        s = step(d, s, ins, null).state;
      }
      const v = i * 10 + (s.out[seat] ? -10000 : 0) + (s.over && s.win === seat ? 5000 : 0) + (s.over && s.win === 1 - seat ? -5000 : 0) + s.sc[seat] * 100 - s.sc[1 - seat] * 100 + s.lv[seat] * 1000;
      if (v > vx) vx = v;
    }
    if (vx > bs) { bs = vx; best = x; }
  }
  return best;
}
export { VIEW };
