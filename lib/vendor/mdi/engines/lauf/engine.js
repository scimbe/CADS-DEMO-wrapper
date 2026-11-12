// Engine E3 Lauf (Runner und Plattformer), reine Logik ohne DOM, bitgenau aus alt:src/lauf-engine.js.
// Gleiches Dokument + gleiche Eingaben an denselben Ticks = gleicher Lauf; jedes Stueck Strecke kommt aus dem Seed.
// ev 1: fester Schritt, Eingaben nur am Tick, im Lauf nur + - * / floor sqrt min max (bitgleich auf jeder Engine).
// ev 0 (alte Links ohne ev) behaelt seine alte Sinus-Flugbahn im eingefrorenen Block V0, damit alte Links spielen wie damals;
// statt Math.sin (auf jeder Engine anders in den letzten Bits) rechnet sie mit sinD aus trig.js: auf 6 Stellen gleich dem
// Altcode (Golden-Test), dafuer jetzt bitgleich auf allen Geraeten.
import { draw } from "../flug/rng.js";
import { sinD } from "../flug/trig.js";
import { sanitize } from "./params.js";

export const H = 360, GY = 280, YMIN = 170, YMAX = 310, PW = 26, PH = 40, DH = 22, STEP = 1 / 120, HOLD = 0.24, HOLDG = 0.42, TERM = 1100, COY = 0.09, BUF = 0.12, SAFE = 0.8, AHEAD = 1600;
export function speedAt(p, x) { return Math.min(p.vm, p.v + p.a * Math.max(0, x) / 1000); }
function vert(b, held, g) {
  const m = held && b.ht > 0 && b.vy < 0 ? HOLDG : 1;
  b.ht -= STEP; b.vy = Math.min(b.vy + g * m * STEP, TERM); b.y += b.vy * STEP;
}
function arc(p) {
  const b = { y: 0, vy: -p.j, ht: HOLD }, up = [];
  while (b.y < 500 && up.length < 4000) { vert(b, true, p.g); up.push(-b.y); }
  return up;
}
export function jumps(p) {
  const up = arc(p), top = Math.max.apply(null, up);
  return {
    top,
    air(h) { for (let i = up.length - 1; i >= 0; i--) if (up[i] >= h) return (i + 1) * STEP; return 0; },
    above(h) { let n = 0; for (let i = 0; i < up.length; i++) if (up[i] >= h) n++; return n * STEP; }
  };
}
export const FLY = 192, FAMP = 22;
function fly(it, ticks) {
  const u = (ticks + it.fph) % FLY, tri = u < FLY / 2 ? u : FLY - u;
  return it.base - 64 + Math.floor((4 * tri - FLY) * FAMP * 256 / FLY) / 256;
}
// ---- ev 0, frozen (only here, never in the ev 1 run) ----
const V0 = { fly(it, ticks) { return it.base - 64 + sinD(ticks * STEP * 3.9 + it.ph) * 22; } };
// ---- end ev 0 ----

const JCACHE = new Map();
// Sprungtabelle je (g, j); begrenzt, damit viele verschiedene Links den Speicher nicht fuellen
function jumpsOf(p) { const key = p.g + "|" + p.j; let J = JCACHE.get(key); if (!J) { if (JCACHE.size >= 64) JCACHE.clear(); J = jumps(p); JCACHE.set(key, J); } return J; }

// Strecke: Abschnitt fuer Abschnitt vor dem Laeufer erzeugt, alles aus dem Seed (s.r) und dem Generatorzustand s.gen.
function put(s, it) { s.items.push(it); return it; }
function fill(s, sp) {
  const p = s.p, l = s.l, J = jumpsOf(p), r = () => draw(s);
  const v = speedAt(p, sp.x0), gapS = v * J.air(0) * 1.15 + 70, stop = sp.x1 - 130 - v * 0.25;
  const hz = [p.hi, p.du, p.ge, p.fa], sum = hz.reduce((a, b) => a + b, 0);
  for (let x = sp.x0 + (s.gen.n === 1 ? 900 : 150); x < stop; x += gapS * (1 + r() * 0.6)) {
    const u = r() * Math.max(100, sum); let k = -1;
    for (let i = 0, c = 0; i < 4; i++) { c += hz[i]; if (u < c) { k = i; break; } }
    const w = 28 + r() * 14; let h = 18 + r() * (Math.min(60, J.top * 0.55) - 18);
    while (h > 10 && J.above(h + 4) * speedAt(p, x) < w + PW + 24) h -= 4;
    if (k === 0 && h > 10) put(s, { t: "o", x, y: sp.y - h, w, h });
    else if (k === 1) put(s, { t: "d", x, y: sp.y - 420, w: 50 + r() * 50, h: 420 - 28 });
    else if (k === 2) {
      const f = l.fp[Math.floor(r() * l.fp.length)], ph = r() * 6.28;
      put(s, { t: "f", k: f, x, x0: sp.x0 + 10, x1: sp.x1 - 10, y: f === "flug" ? sp.y - 64 : sp.y - 26, base: sp.y, w: 26, h: 26, vx: -40, vy: 0, ph, fph: Math.floor(ph * FLY / 6.28), live: true });
    } else if (k === 3 && h > 10) put(s, { t: "x", x, y: -60, to: sp.y - Math.min(30, h), w: Math.min(30, h), h: Math.min(30, h), vy: 0, at: x - speedAt(p, x) * 1.2, go: false });
    if (r() * 100 < p.mu) {
      const cy = sp.y - 24 - r() * Math.min(100, J.top * 0.7), cn = 3 + Math.floor(r() * 3);
      for (let j = 0; j < cn; j++) put(s, { t: "c", x: x + gapS * 0.5 + j * 30 - cn * 15, y: cy - 10, w: 20, h: 20, live: true });
    }
  }
}
function more(s) {
  const p = s.p, g = s.gen, J = jumpsOf(p), r = () => draw(s);
  let sp;
  if (s.end) return;
  if (g.n === 0) sp = { x0: -400, x1: 700, y: GY };
  else {
    const v = speedAt(p, g.x); let gap = 0, ty = Math.max(YMIN, Math.min(YMAX, g.y + (r() * 2 - 1) * p.hv * 1.1));
    if (r() * 100 < p.lu) {
      ty = Math.max(ty, g.y - J.top * 0.7);
      const reach = v * J.air(g.y - ty) * SAFE;
      gap = Math.min(reach, 40 + r() * Math.max(0, reach - 40) * p.lw / 100);
      if (reach < 40) { gap = 0; ty = g.y; }
    } else ty = Math.max(ty, g.y - J.top * 0.5);
    const len = (300 + r() * 500) * Math.max(1, v / 220);
    sp = { x0: g.x + gap, x1: g.x + gap + len, y: ty };
    if (s.goal && sp.x1 >= s.goal) { sp.x1 = Math.max(sp.x0 + 900, s.goal + 900); s.end = true; s.gx = put(s, { t: "g", x: Math.max(s.goal, sp.x0 + 200), y: sp.y - 90, w: 20, h: 90 }).x; }
  }
  g.n++; s.spans.push(sp); g.x = sp.x1; g.y = sp.y;
  if (!s.end) fill(s, sp);
}
function grow(s) {
  while (s.gen.x < s.me.x + AHEAD && !s.end) more(s);
  if (s.ticks % 30) return;
  while (s.spans.length > 2 && s.spans[0].x1 < s.me.x - 600) s.spans.shift();
  s.items = s.items.filter((it) => it.x + (it.w || 0) > s.me.x - 600 || it.t === "g");
}
function hit(a, b) { return a.x0 < b.x + b.w && a.x1 > b.x && a.y0 < b.y + b.h && a.y1 > b.y; }

// Neuer Zustand (reines Datenobjekt) aus einem Dokument l (wird bereinigt).
export function initState(input) {
  const l = sanitize(input);
  const s = { l, p: l.p, H, PW, state: "ready", ticks: 0, coins: 0, stomps: 0, held: false, duck: false,
    me: { x: 0, y: GY, vy: 0, ht: 0, on: true, coy: 0, want: 0 }, spans: [], items: [], goal: l.m === "ziel" ? l.p.len * 10 : 0, end: false,
    r: l.seed >>> 0, gen: { x: -300, y: GY, n: 0 }, inq: { jump: false, held: false, duck: false } };
  grow(s);
  return s;
}
// Eingaben zwischen zwei Ticks: Druecken, Loslassen und Ducken schreiben nur hierhin, der naechste Schritt uebernimmt sie.
export function press(s) { if (s.state === "ready") { s.state = "run"; return ["start"]; } if (s.state === "run") { s.inq.jump = true; s.inq.held = true; } return []; }
export function release(s) { s.inq.held = false; }
export function setDuck(s, on) { s.inq.duck = !!on; }
export function speed(s) { return speedAt(s.p, s.me.x); }
export function meters(s) { return Math.floor(Math.max(0, s.me.x) / 10); }
export function points(s) { return meters(s) + s.coins * 5 + s.stomps * 10; }
export function height(s) { return s.duck && s.me.on ? DH : PH; }
export function stepState(s) {
  const ev = [], m = s.me, dt = STEP, p = s.p, inq = s.inq, path = (s.l.ev || 0) >= 1 ? fly : V0.fly, v1 = (s.l.ev || 0) >= 1;
  if (s.state !== "run") return ev;
  if (inq.jump) { m.want = BUF; inq.jump = false; }
  s.held = inq.held; s.duck = inq.duck;
  s.ticks++;
  const px = m.x, py = m.y;
  m.x += speedAt(p, m.x) * dt;
  m.want -= dt; m.coy -= dt;
  if (m.want > 0 && (m.on || m.coy > 0)) { m.vy = -p.j; m.ht = HOLD; m.on = false; m.coy = 0; m.want = 0; ev.push("jump"); }
  vert(m, s.held, p.g);
  const was = m.on; let under = null;
  m.on = false;
  for (const sp of s.spans) {
    if (m.x + PW / 2 <= sp.x0 || m.x - PW / 2 >= sp.x1) continue;
    if (px + PW / 2 <= sp.x0 && m.y > sp.y + 4) { s.state = "over"; ev.push("dead"); return ev; }
    if (m.vy >= 0 && py <= sp.y + 0.5 && m.y >= sp.y && (!under || sp.y < under.y)) under = sp;
  }
  if (under) { m.y = under.y; m.vy = 0; m.on = true; if (!was) ev.push("land"); } else if (was) m.coy = COY;
  const hh = height(s), me = { x0: m.x - PW / 2 + 3, x1: m.x + PW / 2 - 3, y0: m.y - hh + 3, y1: m.y };
  for (const it of s.items) {
    if (it.t === "f" && it.live) {
      if (it.k === "flug") { it.x += it.vx * dt; it.y = path(it, s.ticks); }
      else {
        it.x += it.vx * dt; if (it.x < it.x0 || it.x > it.x1 - it.w) it.vx = -it.vx;
        if (it.k === "huepf") { it.vy += 1400 * dt; it.y += it.vy * dt; if (it.y >= it.base - it.h) { it.y = it.base - it.h; it.vy = -460; } }
      }
    } else if (it.t === "x") {
      if (!it.go && m.x >= it.at) it.go = true;
      if (it.go && it.y < it.to) { it.vy += 1200 * dt; it.y = Math.min(it.to, it.y + it.vy * dt); }
    }
    if (it.live === false || !hit(me, it)) continue;
    if (it.t === "c") { it.live = false; s.coins++; ev.push("coin"); }
    else if (it.t === "g") { s.state = "goal"; ev.push("goal"); return ev; }
    else if (it.t === "f" && m.vy > 0 && py - 2 <= it.y + 6) { it.live = false; s.stomps++; m.vy = -p.j * 0.6; m.ht = 0; ev.push("stomp"); }
    else { s.state = "over"; ev.push("dead"); return ev; }
  }
  if (v1 && s.gx != null && me.x1 >= s.gx) { s.state = "goal"; ev.push("goal"); return ev; }
  if (m.y > H + 80) { s.state = "over"; ev.push("dead"); return ev; }
  grow(s);
  return ev;
}
// Tiefe Kopie des Datenzustands (float64 bleibt exakt).
export function copyState(s) {
  return { ...s, me: { ...s.me }, spans: s.spans.map((x) => ({ ...x })), items: s.items.map((x) => ({ ...x })), gen: { ...s.gen }, inq: { ...s.inq } };
}
const API = { press, release, setDuck, speed, meters, points, height, step: stepState };
// Objekt-API wie alt createSim (s.press(), s.step(), s.points() ...), fuer Bot, Standbild und Tests.
export function createSim(input) { return withApi(initState(input)); }
export function withApi(s) {
  for (const k of Object.keys(API)) Object.defineProperty(s, k, { value: (a) => API[k](s, a), enumerable: false, configurable: true });
  s.J = jumpsOf(s.p);
  return s;
}

// Einfacher Spieler (alt:src/lauf-ui.js bot): springt vor Luecken, Stufen und Bloecken; vor einer Luecke erst an der Kante.
export function bot(s) {
  const m = s.me, v = s.speed(), near = m.x + v * 0.22, edge = m.x + v * 0.04 + 14; let want = false;
  for (let i = 0; i < s.spans.length; i++) { const sp = s.spans[i], nx = s.spans[i + 1], lim = nx && nx.x0 > sp.x1 ? edge : near + 20; if ((sp.x1 > m.x && sp.x1 < lim) || (sp.x0 > m.x && sp.x0 < near && sp.y < m.y - 2)) want = true; }
  for (const it of s.items) if (it.t !== "c" && it.t !== "d" && it.live !== false && it.x > m.x && it.x < near) want = true;
  if (want && m.on) s.press(); else if (!want && m.vy > -100) s.release();
}
// Standbild der Karte: die Strecke einen Moment nach dem Start (300 Ticks Bot).
export function still(l) {
  const s = createSim(l); s.press();
  for (let i = 0; i < 300 && s.state === "run"; i++) { bot(s); s.step(); }
  s.state = "run"; return s;
}
