// Interpreter des Baukastens (Strang B): spielt jede gepruefte Beschreibung (check.js) deterministisch ab.
// Echtzeit: init/step/status/view nach ADR 0001 (b), 60 Hz, nur Ganzzahlen (Positionen Q8 = 1/256 Einheit, Tempo Q8 je Tick),
// Zufall nur aus dem Seed-RNG im Zustand. Zug: init/step/observe/status/moves nach dem Zugvertrag (zug.js).
// Kein DOM, keine Uhr, keine approximierte Mathematik (scripts/harness.js prueft diese Datei mit).
// Ablauf eines Ticks (Reihenfolge ist Teil des Vertrags, Tests frieren sie ein):
//   1 Erzeuger  2 Steuerung  3 Gegner-KI  4 Schwerkraft + Bewegung (Raster: Schritt)  5 Raender  6 feste Dinge
//   7 Regeln: tap/miss, touch, pass, out, every, clear  8 Lebensdauer  9 Aufraeumen  10 Ende pruefen
import { rng as mkRng } from "../../contract/sdk.js";
import { TICK, HEX } from "./spec.js";
import { LIMITS } from "./check.js";

export const VIEW = { w: 1000, h: 1600 };               // logische Buehne der Karte (manifest.rt.view)
const Q = 256, VMAX = Math.trunc(3000 * Q / TICK);
const velQ = (v) => Math.trunc(v * Q / TICK);
const accQ = (a) => Math.trunc(a * Q / (TICK * TICK));
export const ticksOf = (ms) => Math.max(1, Math.trunc(ms * TICK / 1000));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const abs = (v) => (v < 0 ? -v : v);
export const isGrid = (d) => d.world.cols > 0 && d.world.rows > 0;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];          // rechts, unten, links, oben

/** Buehnen-Abbildung Welt -> Ansicht (contain) als Bruch, damit Zeiger exakt und ganzzahlig zurueckgerechnet werden. */
export function fitOf(d) {
  const W = d.world.w, H = d.world.h;
  if (W * VIEW.h <= H * VIEW.w) return { num: VIEW.h, den: H, ox: Math.trunc((VIEW.w - Math.trunc(W * VIEW.h / H)) / 2), oy: 0 };
  return { num: VIEW.w, den: W, ox: 0, oy: Math.trunc((VIEW.h - Math.trunc(H * VIEW.w / W)) / 2) };
}
/** Zeiger (Ansicht) -> Welt in Einheiten (Raster: Zellen bleiben Einheiten; die Zelle rechnet der Aufrufer). */
export function toWorld(d, f, px, py) { return [Math.trunc((px - f.ox) * f.den / f.num), Math.trunc((py - f.oy) * f.den / f.num)]; }

// ---- Echtzeit: Zustand --------------------------------------------------------------------------------------------
function cellSize(d) { return [Math.trunc(d.world.w / d.world.cols), Math.trunc(d.world.h / d.world.rows)]; }

function makeEnt(d, st, k, seat, x, y, r, ln = -1) {
  const t = d.things[k], grid = isGrid(d);
  let vx = velQ(t.vx), vy = velQ(t.vy);
  if (t.spread > 0) { const s = velQ(t.spread); vx += r.int(2 * s + 1) - s; if (d.players === 2 && r.int(2) === 1) vy = -vy; }
  if (t.ai === "patrol" && vx === 0 && vy === 0) vx = velQ(t.power);
  const e = { i: st.n++, k, s: seat, x: grid ? x : x * Q, y: grid ? y : y * Q, vx, vy, hw: t.w * (Q >> 1), hh: t.h * (Q >> 1), l: t.life ? ticksOf(t.life) : 0, g: 0, p: 0, x0: 0, y0: 0, b: st.t, ln };
  e.x0 = e.x; e.y0 = e.y;
  if (grid) { e.d = 0; e.m = 0; e.tl = t.trail; e.tr = []; }
  return e;
}

/**
 * @param d       gepruefte Beschreibung (check(...).desc)
 * @param seed    Zeichenkette
 * @param roles   je Sitz "human" | "bot" | "ghost" | "remote" | "none" (Host); "none" = Sitz spielt nicht
 */
export function init(d, seed, roles) {
  const r = mkRng(seed + "|bau");
  const active = [0, 1].map((s) => (roles[s] && roles[s] !== "none" ? 1 : 0));
  // Ein Spiel fuer zwei mit nur einer Person: die andere Seite steuert die eingebaute Heuristik (auto), nie leer
  const auto = [0, 1].map((s) => (d.players === 2 && !active[s] ? 1 : 0));
  const st = { t: 0, n: 1, r: null, e: [], sc: [0, 0], lv: [0, 0], out: [0, 0], over: 0, win: -1, sp: d.spawn.map((s) => ticksOf(s.after || s.every)), fired: 0, gr: [0, 0], act: active, auto, solo: d.players === 1 ? 1 : 0, race: d.players === 1 && active[0] && active[1] ? 1 : 0, ever: d.things.map(() => 0) };
  const lives = Math.max(1, d.end.lives);
  for (let s = 0; s < 2; s++) { st.lv[s] = (active[s] || auto[s]) ? lives : 0; st.out[s] = (active[s] || auto[s]) ? 0 : 1; }
  const idx = new Map(d.things.map((t, i) => [t.id, i]));
  for (const p of d.start) {
    const k = idx.get(p.thing);
    // Solo-Spiel mit zwei Sitzen (Geist/Duell): jede Seite spielt auf ihrer eigenen Bahn (ln) - alle Startdinge gibt es je
    // Bahn einmal, Erzeugtes ist geteilt (gleiche Roehren, gleiches Futter); Dinge verschiedener Bahnen beruehren sich nie
    const lanes = st.race ? [0, 1] : [-1];
    for (const ln of lanes) for (let j = 0; j < p.n; j++) {
      if (st.e.length >= LIMITS.alive) break;
      const seat = p.seat < 0 ? -1 : ln >= 0 ? ln : st.solo ? 0 : p.seat;
      const e = makeEnt(d, st, k, seat, p.x + (j % p.cols) * p.dx, p.y + Math.floor(j / p.cols) * p.dy, r, ln);
      st.e.push(e); st.ever[k] = 1;
    }
  }
  st.r = r.state();
  return st;
}

function clone(st) {
  return { ...st, e: st.e.map((e) => (e.tr ? { ...e, tr: e.tr.map((c) => c.slice()) } : { ...e })), sc: st.sc.slice(), lv: st.lv.slice(), out: st.out.slice(), sp: st.sp.slice(), gr: st.gr.slice(), act: st.act, auto: st.auto, ever: st.ever.slice() };
}
const overlap = (a, b) => abs(a.x - b.x) < a.hw + b.hw && abs(a.y - b.y) < a.hh + b.hh;
/** Bahnen: geteilte Dinge (ln -1) treffen alle, sonst nur dieselbe Bahn. */
const same = (a, b) => a.ln < 0 || b.ln < 0 || a.ln === b.ln;
/** Sitz, dem ein Ding zaehlt: Besitzer, sonst seine Bahn. */
const laneSeat = (e) => (e ? (e.s >= 0 ? e.s : e.ln >= 0 ? e.ln : -1) : -1);
function cellsOf(e) { return [[e.x, e.y], ...(e.tr || [])]; }

/** Eingabe von Geraet, Partner oder Bot einmal saeubern (Review M1: {p:5} oder {ax:"x"} von einem Partner): nur Ganzzahlen
 *  in Grenzen, hoechstens 4 Zeiger mit je 4 Ganzzahlen. Was nicht passt, faellt weg; der Zustand bleibt ganzzahlig. */
function cleanInput(x) {
  if (!x || typeof x !== "object") return { b: 0 };
  const n = (v, lo, hi) => (Number.isInteger(v) ? clamp(v, lo, hi) : 0);
  const out = { b: n(x.b, 0, 255), ax: n(x.ax, -1000, 1000), ay: n(x.ay, -1000, 1000) };
  if (Array.isArray(x.p)) {
    const p = x.p.slice(0, 4).filter((q) => Array.isArray(q) && q.length === 4 && q.every(Number.isInteger)).map((q) => [q[0], clamp(q[1], -4000, 8000), clamp(q[2], -4000, 8000), q[3] & 7]);
    if (p.length) out.p = p;
  }
  return out;
}
/** Gegnerische Seite eines Sitzes (-1 ohne Gegner). */
const other = (s) => (s === 0 ? 1 : s === 1 ? 0 : -1);

// ---- Echtzeit: ein Tick -------------------------------------------------------------------------------------------
/**
 * @param d       Beschreibung
 * @param state   Zustand
 * @param inputs  je Sitz {b, ax, ay, p}
 * @param botOf   (st, seat) -> Input fuer Seiten mit auto (eingebaute Heuristik; bot.js)
 * @returns {{state, ev}}
 */
export function step(d, state, inputs, botOf) {
  const st = clone(state), ev = [];
  if (st.over) return { state: st, ev };
  const r = mkRng(st.r), grid = isGrid(d), W = d.world.w, H = d.world.h;
  const idx = new Map(d.things.map((t, i) => [t.id, i]));
  const live = (e) => !e.dead;
  const inp = [0, 1].map((s) => cleanInput(st.auto[s] && botOf ? botOf(state, s) : inputs && inputs[s]));
  const seatOk = (s) => s < 0 || (!st.out[s] && st.gr[s] === 0);
  const fit = fitOf(d);
  const [cw, ch] = grid ? cellSize(d) : [1, 1];

  // 1 Erzeuger
  d.spawn.forEach((sp, i) => {
    if (st.t < st.sp[i]) return;
    st.sp[i] = st.t + ticksOf(sp.every);
    const k = idx.get(sp.thing), alive = st.e.filter((e) => live(e) && e.k === k).length;
    if (alive >= sp.max || st.e.length >= LIMITS.alive - 2) return;
    let x = sp.x + (sp.xr ? r.int(2 * sp.xr + 1) - sp.xr : 0), y = sp.y + (sp.yr ? r.int(2 * sp.yr + 1) - sp.yr : 0);
    if (grid) {
      // Raster: freie Zelle aus dem Seed (x/y < 0 = irgendwo)
      const busy = new Set(); for (const e of st.e) if (live(e)) for (const [cx, cy] of cellsOf(e)) busy.add(cy * 64 + cx);
      if (sp.x < 0 || sp.y < 0) {
        const free = []; for (let cy = 0; cy < d.world.rows; cy++) for (let cx = 0; cx < d.world.cols; cx++) if (!busy.has(cy * 64 + cx)) free.push([cx, cy]);
        if (!free.length) return; [x, y] = free[r.int(free.length)];
      } else { x = clamp(x, 0, d.world.cols - 1); y = clamp(y, 0, d.world.rows - 1); if (busy.has(y * 64 + x)) return; }
      st.e.push(makeEnt(d, st, k, -1, x, y, r));
    } else if (sp.gap > 0) {
      // Paar ueber/unter einer Luecke (Roehren): beide Teile reichen bis zum Rand
      const t = d.things[k], top = y - (sp.gap >> 1), bot = y + (sp.gap >> 1);
      if (top > 8) { const e = makeEnt(d, st, k, -1, x, top >> 1, r); e.hh = (top >> 1) * Q; st.e.push(e); }
      if (bot < H - 8) { const e = makeEnt(d, st, k, -1, x, (bot + H) >> 1, r); e.hh = ((H - bot) >> 1) * Q; st.e.push(e); }
      void t;
    } else st.e.push(makeEnt(d, st, k, -1, x, y, r));
    st.ever[k] = 1;
    ev.push({ k: "spawn" });
  });

  // Bahn eines ausgeschiedenen Sitzes steht still (Wettlauf)
  const frozen = (e) => st.race && e.ln >= 0 && st.out[e.ln] === 1;
  // 2 Steuerung
  for (const e of st.e) {
    if (!live(e) || e.s < 0 || frozen(e)) continue;
    const t = d.things[e.k], x = inp[e.s] || { b: 0 }, pw = velQ(t.power);
    if (!seatOk(e.s) && t.control !== "none") { if (!grid) { e.vx = t.control === "flap" || t.control === "jump" ? e.vx : 0; } continue; }
    const down = x.p && x.p.find((q) => q[3] & 1), fresh = (x.b & 1) === 1 || !!(x.p && x.p.some((q) => q[3] & 2));
    switch (t.control) {
      case "flap": if (fresh) { e.vy = -pw; ev.push({ k: "flap", seat: e.s }); } break;
      case "jump": if (fresh && e.g) { e.vy = -pw; e.g = 0; ev.push({ k: "jump", seat: e.s }); } break;
      case "lr": case "ud": case "move": {
        let ax = x.ax || 0, ay = x.ay || 0;
        if (down) { const [wx, wy] = toWorld(d, fit, down[1], down[2]); ax = clamp(Math.trunc((wx * Q - e.x) / 8), -1000, 1000); ay = clamp(Math.trunc((wy * Q - e.y) / 8), -1000, 1000); }
        if (t.control !== "ud") e.vx = Math.trunc(pw * clamp(ax, -1000, 1000) / 1000);
        if (t.control !== "lr") e.vy = Math.trunc(pw * clamp(ay, -1000, 1000) / 1000);
        break;
      }
      case "drag": {
        if (down) { const [wx] = toWorld(d, fit, down[1], down[2]); const lim = pw > 0 ? pw * 3 : W * Q; e.vx = clamp(wx * Q - e.x, -lim, lim); }
        else e.vx = Math.trunc((pw || velQ(900)) * clamp(x.ax || 0, -1000, 1000) / 1000);
        break;
      }
      case "steer": {
        let dir = -1;
        if (abs(x.ax || 0) > 300 || abs(x.ay || 0) > 300) dir = abs(x.ax || 0) >= abs(x.ay || 0) ? (x.ax > 0 ? 0 : 2) : (x.ay > 0 ? 1 : 3);
        const tap = x.p && x.p.find((q) => q[3] & 2);
        if (tap) {
          const [wx, wy] = toWorld(d, fit, tap[1], tap[2]), dx = Math.trunc(wx / cw) - e.x, dy = Math.trunc(wy / ch) - e.y;
          if (dx || dy) dir = abs(dx) >= abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
        }
        // nie direkt umkehren, wenn ein Schwanz da ist
        if (dir >= 0 && !(e.tr.length && (dir + 2) % 4 === e.d)) e.d = dir;
        break;
      }
      default: break;
    }
  }

  // 3 Gegner-KI
  for (const e of st.e) {
    if (!live(e)) continue;
    const t = d.things[e.k];
    if (t.ai === "none" || grid) continue;
    const sp = velQ(t.power || 200);
    if (t.ai === "chase" || t.ai === "flee") {
      let best = null, bd = 0;
      for (const o of st.e) if (live(o) && o.s >= 0 && !st.out[o.s] && same(o, e) && d.things[o.k].control !== "none") { const dd = abs(o.x - e.x) + abs(o.y - e.y); if (!best || dd < bd) { best = o; bd = dd; } }
      if (best) {
        const dx = best.x - e.x, dy = best.y - e.y, m = Math.max(abs(dx), abs(dy), 1), f = t.ai === "flee" ? -1 : 1;
        e.vx = Math.trunc(f * sp * dx / m); if (!t.gravity) e.vy = Math.trunc(f * sp * dy / m);
      }
    } else if (t.ai === "zigzag") { if ((st.t - e.b) % 40 === 0) e.vx = (e.vx === 0 ? sp : -e.vx); }
  }

  // 4 Bewegung
  const g = accQ(d.world.gravity);
  for (const e of st.e) {
    if (!live(e) || frozen(e)) continue;
    const t = d.things[e.k];
    if (grid) {
      if (t.control !== "steer" && t.power <= 0) continue;
      if (e.s >= 0 && !seatOk(e.s)) continue;
      if (e.m > 0) { e.m--; continue; }
      e.m = Math.max(0, ticksOf(Math.trunc(1000 / Math.max(1, t.power))) - 1);
      const [dx, dy] = DIRS[e.d];
      let nx = e.x + dx, ny = e.y + dy;
      const C = d.world.cols, R = d.world.rows;
      const edge = nx < 0 ? "left" : nx >= C ? "right" : ny < 0 ? "top" : ny >= R ? "bottom" : "";
      if (edge && d.world[edge] === "wall") continue;
      if (edge && d.world[edge] === "wrap") { nx = (nx + C) % C; ny = (ny + R) % R; }
      e.tr.unshift([e.x, e.y]);
      while (e.tr.length > Math.min(e.tl, LIMITS.trail)) e.tr.pop();
      e.x = nx; e.y = ny;
      continue;
    }
    if (t.gravity) e.vy += g;
    // kein Ding bewegt sich je Tick weiter als seine halbe kleinste Seite: so ueberspringt nichts ein Kontaktfenster
    // (Tunneln; gefunden im Pong-Playtest bei VMAX). Gilt auch fuer erzeugte Paare (hw bleibt die Breite).
    const vm = Math.min(VMAX, Math.max(Q, Math.min(e.hw, e.hh)));
    e.vx = clamp(e.vx, -vm, vm); e.vy = clamp(e.vy, -vm, vm);
    e.x += e.vx; e.y += e.vy;
  }

  // 5 Raender (nur ausserhalb des Rasters; im Raster entscheidet Schritt 4)
  if (!grid) for (const e of st.e) {
    if (!live(e)) continue;
    const t = d.things[e.k], moving = e.vx !== 0 || e.vy !== 0 || t.gravity || t.control !== "none";
    if (!moving) continue;
    const bnc = t.bounce !== "none" || t.ai === "patrol";
    const side = (name, lo, hi, pos, half, vkey) => {
      const mode = d.world[name];
      if (mode === "open") return;
      if (mode === "wrap") { const span = hi - lo; if (e[pos] < lo - half) e[pos] += span + 2 * half; else if (e[pos] > hi + half) e[pos] -= span + 2 * half; return; }
      if (name === "left" || name === "top") { if (e[pos] - half < lo) { e[pos] = lo + half + (bnc ? lo + half - e[pos] : 0); if (bnc) { e[vkey] = abs(e[vkey]); ev.push({ k: "wall" }); } else e[vkey] = 0; } }
      else if (e[pos] + half > hi) { e[pos] = hi - half - (bnc ? e[pos] + half - hi : 0); if (bnc) { e[vkey] = -abs(e[vkey]); ev.push({ k: "wall" }); } else { e[vkey] = 0; if (name === "bottom") e.g = 1; } }
    };
    side("left", 0, W * Q, "x", e.hw, "vx"); side("right", 0, W * Q, "x", e.hw, "vx");
    side("top", 0, H * Q, "y", e.hh, "vy"); side("bottom", 0, H * Q, "y", e.hh, "vy");
  }

  // 6 feste Dinge: Bewegliches wird herausgeschoben (Springen auf Plattformen) bzw. prallt ab (bounce all)
  if (!grid) {
    const solids = st.e.filter((o) => live(o) && d.things[o.k].solid);
    if (solids.length) for (const e of st.e) {
      if (!live(e) || d.things[e.k].solid) continue;
      const t = d.things[e.k];
      if (e.vx === 0 && e.vy === 0 && !t.gravity) continue;
      for (const o of solids) {
        if (o === e || !same(e, o) || !overlap(e, o)) continue;
        const px = e.hw + o.hw - abs(e.x - o.x), py = e.hh + o.hh - abs(e.y - o.y);
        if (px < py) { e.x += e.x < o.x ? -px : px; e.vx = t.bounce === "all" ? -e.vx : 0; }
        else { const up = e.y < o.y; e.y += up ? -py : py; if (t.bounce === "all") e.vy = -e.vy; else { if (up && e.vy > 0) e.g = 1; e.vy = 0; } }
        if (t.bounce === "all") ev.push({ k: "hit", x: e.x >> 8, y: e.y >> 8 });
      }
    }
  }

  // 7 Regeln
  const ctxSeat = laneSeat;
  const apply = (rule0, a, b, actor) => {
    const rule = { ...rule0, i: d.rules.indexOf(rule0) };
    for (const fx of rule.do) {
      const tgt = fx.on === "b" ? b : a;
      const seatOf = () => {
        switch (fx.on) {
          case "a": return ctxSeat(a) >= 0 ? [ctxSeat(a)] : actor >= 0 ? [actor] : st.solo ? [0, 1].filter((s) => st.act[s]) : [];
          case "b": return ctxSeat(b) >= 0 ? [ctxSeat(b)] : [];
          case "actor": return actor >= 0 ? [actor] : ctxSeat(a) >= 0 ? [ctxSeat(a)] : [];
          case "other": { const s = actor >= 0 ? actor : ctxSeat(a); return s >= 0 && !st.solo ? [other(s)] : []; }
          case "seat0": return [0];
          case "seat1": return st.solo ? [] : [1];
          default: return [0, 1].filter((s) => st.act[s] || st.auto[s]);
        }
      };
      switch (fx.act) {
        case "score": for (const s of seatOf()) if (!st.out[s]) { st.sc[s] = clamp(st.sc[s] + fx.n, -9999, 99999); ev.push({ k: fx.n >= 0 ? "score" : "minus", seat: s }); } break;
        case "life": for (const s of seatOf()) if (!st.out[s] && st.gr[s] === 0) {
          st.lv[s] = clamp(st.lv[s] + fx.n, 0, 9);
          if (fx.n < 0) { st.gr[s] = TICK; ev.push({ k: "hurt", seat: s, r: rule.i }); }
          if (st.lv[s] <= 0) { st.out[s] = 1; ev.push({ k: "lose", seat: s }); }
        } break;
        case "destroy": if (tgt && !tgt.dead) { tgt.dead = 1; ev.push({ k: "pop", x: grid ? tgt.x : tgt.x >> 8, y: grid ? tgt.y : tgt.y >> 8 }); } break;
        case "spawn": {
          const k = idx.get(fx.thing);
          if (k === undefined || st.e.length >= LIMITS.alive - 1) break;
          const n = Math.max(1, Math.min(5, fx.n));
          for (let j = 0; j < n; j++) {
            let x, y;
            if (grid) { x = r.int(d.world.cols); y = r.int(d.world.rows); }
            else if (a && !a.dead) { x = a.x >> 8; y = a.y >> 8; } else { x = r.int(W); y = r.int(H); }
            st.e.push(makeEnt(d, st, k, -1, x, y, r, a ? a.ln : -1)); st.ever[k] = 1;
          }
          break;
        }
        case "bounce": if (a && b && !grid) {
          const px = a.hw + b.hw - abs(a.x - b.x), py = a.hh + b.hh - abs(a.y - b.y);
          if (px < py) { a.vx = a.x < b.x ? -abs(a.vx) : abs(a.vx); a.x += a.x < b.x ? -px : px; }
          else {
            a.vy = a.y < b.y ? -abs(a.vy) : abs(a.vy); a.y += a.y < b.y ? -py : py;
            // gesteuerter Schlaeger: Treffpunkt lenkt (Breakout/Pong), Tempo bleibt begrenzt
            if (d.things[b.k].control !== "none") { const sp = Math.max(abs(a.vx), abs(a.vy)); a.vx = clamp(a.vx + Math.trunc((a.x - b.x) * sp / Math.max(b.hw, 1) / 2), -sp, sp); }
          }
          ev.push({ k: "hit", seat: ctxSeat(b), x: a.x >> 8, y: a.y >> 8 });
        } break;
        case "grow": if (tgt && tgt.tr) tgt.tl = clamp(tgt.tl + fx.n, 0, LIMITS.trail); break;
        case "speed": if (tgt && !grid) { tgt.vx = clamp(Math.trunc(tgt.vx * (100 + fx.n) / 100), -VMAX, VMAX); tgt.vy = clamp(Math.trunc(tgt.vy * (100 + fx.n) / 100), -VMAX, VMAX); } break;
        case "reset": if (tgt) {
          const t = d.things[tgt.k];
          tgt.x = tgt.x0; tgt.y = tgt.y0; tgt.g = 0; tgt.p = 0;
          tgt.vx = velQ(t.vx); tgt.vy = velQ(t.vy);
          // zu zweit wechselt der Aufschlag zufaellig aus dem Seed (sonst bekaeme eine Seite jeden Ball zuerst: Pong-Playtest)
          if (t.spread > 0) { const s = velQ(t.spread); tgt.vx += r.int(2 * s + 1) - s; if (d.players === 2 && r.int(2) === 1) tgt.vy = -tgt.vy; }
          if (tgt.tr) { tgt.tr = []; tgt.tl = t.trail; tgt.d = 0; }
          tgt.out = 0;
        } break;
        case "win": case "lose": {
          const ss = seatOf();
          if (!ss.length) break;
          const s = ss[0], winner = fx.act === "win" ? s : (st.solo ? -1 : other(s));
          st.over = 1; st.win = winner; ev.push({ k: winner >= 0 ? "win" : "lose", seat: winner });
          break;
        }
      }
      if (st.over) return;
    }
  };
  // tap / miss: neue Zeigerdruecke je Sitz
  const tapRules = d.rules.filter((ru) => ru.when === "tap"), missRules = d.rules.filter((ru) => ru.when === "miss");
  if (tapRules.length || missRules.length) for (let s = 0; s < 2 && !st.over; s++) {
    const x = inp[s];
    if (!x || !x.p || st.out[s]) continue;
    for (const q of x.p) {
      if (!(q[3] & 2)) continue;
      const [wx, wy] = toWorld(d, fit, q[1], q[2]);
      let hit = null;
      for (let j = st.e.length - 1; j >= 0; j--) {
        const e = st.e[j];
        if (!live(e) || d.things[e.k].control !== "tap" || (e.ln >= 0 && e.ln !== s)) continue;
        const inside = grid ? Math.trunc(wx / cw) === e.x && Math.trunc(wy / ch) === e.y : abs(wx * Q - e.x) <= e.hw + 24 * Q && abs(wy * Q - e.y) <= e.hh + 24 * Q;
        if (inside) { hit = e; break; }
      }
      if (hit) { for (const ru of tapRules) if (idx.get(ru.a) === hit.k) apply(ru, hit, null, s); }
      else for (const ru of missRules) apply(ru, null, null, s);
      if (st.over) break;
    }
  }
  // touch
  for (const ru of d.rules) {
    if (st.over) break;
    if (ru.when !== "touch") continue;
    const ka = idx.get(ru.a), kb = idx.get(ru.b);
    const As = st.e.filter((e) => live(e) && e.k === ka), Bs = st.e.filter((e) => live(e) && e.k === kb);
    for (const a of As) {
      if (a.dead || st.over) continue;
      if (a.s >= 0 && (st.out[a.s] || st.gr[a.s] > 0) && ru.do.some((f) => f.act === "life" || f.act === "lose")) continue;
      for (const b of Bs) {
        if (a.dead || b.dead || st.over) break;
        if (!same(a, b) || frozen(a) || frozen(b)) continue;
        let hit;
        if (grid) {
          const body = b === a ? b.tr : cellsOf(b);
          hit = body.some(([cx, cy]) => cx === a.x && cy === a.y);
        } else hit = a !== b && overlap(a, b);
        if (hit) apply(ru, a, b, ctxSeat(a) >= 0 ? ctxSeat(a) : ctxSeat(b));
      }
    }
  }
  // pass: a ist rechts an b vorbei (Flappy zaehlt Roehren), je Sitz einmal
  for (const ru of d.rules) {
    if (st.over || ru.when !== "pass" || grid) continue;
    const ka = idx.get(ru.a), kb = idx.get(ru.b);
    for (const a of st.e) {
      if (!live(a) || a.k !== ka || (laneSeat(a) >= 0 && st.out[laneSeat(a)])) continue;
      const bit = 1 << (laneSeat(a) >= 0 ? laneSeat(a) : 2);
      for (const b of st.e) {
        if (!live(b) || b.k !== kb || (b.p & bit) || !same(a, b)) continue;
        if (a.x - a.hw > b.x + b.hw) {
          // ein Roehrenpaar zaehlt einmal: der Partner gleicher x-Lage wird mit markiert
          for (const o of st.e) if (live(o) && o.k === kb && o.x === b.x) o.p |= bit;
          apply(ru, a, b, laneSeat(a));
          if (st.over) break;
        }
      }
    }
  }
  // out: ganz ueber einen offenen Rand
  for (const ru of d.rules) {
    if (st.over || ru.when !== "out") continue;
    const ka = idx.get(ru.a);
    for (const e of st.e) {
      if (!live(e) || e.k !== ka || e.out || frozen(e)) continue;
      let side = "";
      if (grid) {
        const [dx, dy] = DIRS[e.d], nx = e.x + dx, ny = e.y + dy;
        // im Raster: der naechste Schritt ginge ueber einen offenen Rand -> jetzt (Kopf steht auf der letzten Zelle)
        const willStep = d.things[e.k].control === "steer" && e.m === 0;
        if (willStep) side = nx < 0 ? "left" : nx >= d.world.cols ? "right" : ny < 0 ? "top" : ny >= d.world.rows ? "bottom" : "";
        if (side && d.world[side] !== "open") side = "";
      } else {
        if (e.x + e.hw < 0) side = "left"; else if (e.x - e.hw > W * Q) side = "right"; else if (e.y + e.hh < 0) side = "top"; else if (e.y - e.hh > H * Q) side = "bottom";
        if (side && d.world[side] !== "open") side = "";
      }
      if (!side || (ru.b !== "any" && ru.b !== side)) continue;
      const before = e.x + "," + e.y;
      apply(ru, e, null, laneSeat(e));
      if (!e.dead && e.x + "," + e.y === before && !grid) e.out = 1;     // nicht zurueckgesetzt: zaehlt nur einmal
      if (st.over) break;
    }
  }
  // every
  for (const ru of d.rules) { if (st.over) break; if (ru.when === "every" && st.t > 0 && st.t % ticksOf(ru.n) === 0) apply(ru, null, null, -1); }
  // clear: es gab a, jetzt keins mehr (einmal je Regel und Bahn; im Wettlauf zaehlt die Bahn als Ausloeser)
  d.rules.forEach((ru, i) => {
    if (st.over || ru.when !== "clear") return;
    const ka = idx.get(ru.a);
    for (const ln of st.race ? [0, 1] : [-1]) {
      const bit = 1 << (i * 2 + (ln < 0 ? 0 : ln));
      if (st.over || (st.fired & bit) || !st.ever[ka] || (ln >= 0 && st.out[ln])) continue;
      if (!st.e.some((e) => live(e) && e.k === ka && (ln < 0 || e.ln === ln))) { st.fired |= bit; apply(ru, null, null, ln); }
    }
  });

  // 8 Lebensdauer, 9 Aufraeumen (weit draussen hinter offenem Rand, tot)
  for (const e of st.e) if (live(e) && e.l > 0 && !frozen(e)) { e.l--; if (e.l === 0) e.dead = 1; }
  if (!grid) for (const e of st.e) {
    if (!live(e)) continue;
    const m = 400 * Q;
    if (e.x + e.hw < -m || e.x - e.hw > W * Q + m || e.y + e.hh < -m || e.y - e.hh > H * Q + m) e.dead = 1;
  }
  st.e = st.e.filter((e) => !e.dead);
  for (let s = 0; s < 2; s++) if (st.gr[s] > 0) st.gr[s]--;
  st.t++;

  // 10 Ende
  if (!st.over) endCheck(d, st, ev);
  st.r = r.state();
  return { state: st, ev };
}

function endCheck(d, st, ev) {
  const seats = [0, 1].filter((s) => st.act[s] || st.auto[s]);
  const finish = (w) => { st.over = 1; st.win = w; ev.push({ k: w >= 0 ? "win" : "lose", seat: w }); };
  const best = () => { if (seats.length === 1) return st.sc[seats[0]] >= Math.max(1, d.end.score) || d.end.score === 0 && d.end.win === "survive" && !st.out[seats[0]] ? seats[0] : -1; return st.sc[0] > st.sc[1] ? 0 : st.sc[1] > st.sc[0] ? 1 : -1; };
  // Ziel erreicht: erreichen es beide im selben Tick, entscheidet der hoehere Stand, Gleichstand = unentschieden
  // (vorher gewann stets Sitz 0: Gold-Korpus g15, Tipp-Wettlauf)
  if (d.end.score > 0) {
    const hit = seats.filter((s) => st.sc[s] >= d.end.score);
    if (hit.length === 1) return finish(hit[0]);
    if (hit.length === 2) return finish(st.sc[0] > st.sc[1] ? 0 : st.sc[1] > st.sc[0] ? 1 : -1);
  }
  const alive = seats.filter((s) => !st.out[s]);
  if (!alive.length) {
    // alle raus: Solo verloren (ausser Ziel ist "ueberleben bis Zeitende" - dann ebenfalls verloren); zu zweit entscheidet der Stand
    if (seats.length === 1) return finish(-1);
    return finish(d.end.win === "survive" ? -1 : best());
  }
  if (!st.solo && seats.length === 2 && alive.length === 1 && (d.end.win === "survive" || d.end.lives > 0)) return finish(alive[0]);
  if (d.end.time > 0 && st.t >= d.end.time * TICK) {
    if (d.end.win === "survive") return finish(alive.length === 1 ? alive[0] : seats.length === 1 ? seats[0] : best());
    if (seats.length === 1) return finish(d.end.score > 0 ? (st.sc[seats[0]] >= d.end.score ? seats[0] : -1) : (d.end.win === "clear" ? -1 : seats[0]));
    return finish(best());
  }
  // Notbremse: zaehlt im Pruefer als "endet nicht von selbst" (cap)
  if (st.t >= LIMITS.maxTicks) { st.cap = 1; finish(seats.length === 1 ? -1 : best()); }
}

/** {over, score[], winner, say, lives[]} */
export function status(d, st) {
  const lives = st.lv.slice();
  const tl = d.end.time > 0 ? Math.max(0, d.end.time - Math.floor(st.t / TICK)) : -1;
  return { over: !!st.over, score: st.sc.slice(), winner: st.over ? st.win : -1, lives, timeLeft: tl };
}

// ---- Echtzeit: Anzeige ----------------------------------------------------------------------------------------------
const colorOf = (c) => HEX[c] || c;

/** Anzeigeliste {t:"canvas"} (ADR 0001 b). Gleitkomma nur hier (Interpolation, Skalierung). */
export function view(d, st, ctx = {}) {
  const f = fitOf(d), k = f.num / f.den, grid = isGrid(d);
  const [cw, ch] = grid ? cellSize(d) : [1, 1];
  const prev = ctx.prev && ctx.alpha ? new Map(ctx.prev.e.map((e) => [e.i, e])) : null, a = ctx.alpha || 0;
  const flip = d.world.flip && ctx.seat === 1;
  const X = (wx) => f.ox + wx * k, Y = (wy) => f.oy + (flip ? d.world.h - wy : wy) * k;
  const ops = [];
  const mine = ctx.seat === 1 ? 1 : 0;
  for (const e of st.e) {
    const t = d.things[e.k];
    // Wettlauf: die andere Bahn erscheint nur als Geist ihrer Figur
    const ghost = st.race && e.ln >= 0 && e.ln !== mine;
    if (ghost && (e.s < 0 || t.control === "none")) continue;
    let x, y, w, h;
    if (grid) {
      for (const [cx, cy] of (e.tr || [])) ops.push({ o: "rect", x: X(cx * cw + 2), y: Y(cy * ch + (flip ? ch - 2 : 2)), w: (cw - 4) * k, h: (ch - 4) * k, r: 6, fill: colorOf(t.color), alpha: 0.75 });
      x = (e.x + 0.5) * cw; y = (e.y + 0.5) * ch; w = cw; h = ch;
    } else {
      const p = prev && prev.get(e.i);
      x = (p ? p.x + (e.x - p.x) * a : e.x) / Q; y = (p ? p.y + (e.y - p.y) * a : e.y) / Q; w = (e.hw * 2) / Q; h = (e.hh * 2) / Q;
    }
    const cx = X(x), cy = Y(y), blink = e.s >= 0 && st.gr[e.s] > 0 && !ctx.reduced && (st.t >> 3) % 2 === 0;
    const alpha = ghost ? 0.3 : blink ? 0.35 : (e.s >= 0 && st.out[e.s] ? 0.25 : 1);
    if (t.look === "circle") ops.push({ o: "ellipse", x: cx, y: cy, rx: w * k / 2, ry: h * k / 2, fill: colorOf(t.color), alpha });
    else if (t.look === "emoji") ops.push({ o: "sprite", x: cx - w * k / 2, y: cy - h * k / 2, w: w * k, h: h * k, emoji: t.emoji, alpha });
    else if (t.look === "text") { ops.push({ o: "rect", x: cx - w * k / 2, y: cy - h * k / 2, w: w * k, h: h * k, r: 8, fill: colorOf(t.color), alpha }); ops.push({ o: "text", x: cx, y: cy, text: t.text, size: Math.max(12, Math.min(h * k * 0.6, 64)), font: "brand", align: "center", base: "middle", fill: d.bg === "ink" ? "ink" : "paper", maxW: w * k }); }
    else ops.push({ o: "rect", x: cx - w * k / 2, y: cy - h * k / 2, w: w * k, h: h * k, r: grid ? 6 : 4, fill: colorOf(t.color), alpha });
    if (ghost && !ctx.reduced) ops.push({ o: "text", x: cx, y: cy - h * k / 2 - 14, text: "👻", size: 28, font: "body", align: "center", fill: d.bg === "ink" ? "paper" : "ink" });
  }
  const s = status(d, st), ink = d.bg === "ink" || d.bg === "blue" || d.bg === "violet" ? "paper" : "ink";
  const hud = [];
  const two = d.players === 2 || (st.act[0] && st.act[1]);
  hud.push({ o: "text", x: VIEW.w / 2, y: 70, text: two ? s.score[0] + " : " + s.score[1] : String(s.score[0]), size: 64, font: "brand", align: "center", fill: ink });
  if (d.end.lives > 1) hud.push({ o: "text", x: 40, y: 70, text: "♥".repeat(st.lv[ctx.seat === 1 ? 1 : 0]), size: 40, font: "body", align: "left", fill: ink });
  if (s.timeLeft >= 0) hud.push({ o: "text", x: VIEW.w - 40, y: 70, text: String(s.timeLeft), size: 48, font: "brand", align: "right", fill: ink });
  if (d.end.score > 0) hud.push({ o: "text", x: VIEW.w / 2, y: 120, text: "/ " + d.end.score, size: 28, font: "body", align: "center", fill: ink, alpha: 0.7 });
  return {
    t: "canvas", w: VIEW.w, h: VIEW.h, a11y: d.title + ". " + d.goal + " Stand " + (two ? s.score[0] + " zu " + s.score[1] : s.score[0]),
    layers: [
      { id: "bg", key: "bau|" + d.bg + "|" + d.world.w + "x" + d.world.h, ops: [{ o: "rect", x: 0, y: 0, w: VIEW.w, h: VIEW.h, fill: "surface" }, { o: "rect", x: f.ox, y: f.oy, w: d.world.w * k, h: d.world.h * k, fill: colorOf(d.bg) }] },
      { id: "world", ops },
      { id: "hud", ops: hud }
    ]
  };
}
