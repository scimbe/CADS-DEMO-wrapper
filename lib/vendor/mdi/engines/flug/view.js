// Bild des Flugspiels als Canvas-Anzeigeliste (ADR 0001 (b)), aus alt:src/game.js draw() und alt:src/modes.js drawFly().
// Reine Funktion von Zustand und ctx: keine Uhr, kein Zufall. Gleitkomma und Math.sin nur hier (Anzeige), nie im Zustand.
// Welt: 8 Themen (TH) oder eigener Look (a,b Himmel, d Motiv, e Emoji, p,q Hindernis, f Form, o Emoji, g,h Boden, m Spur),
// je Routen-Abschnitt dessen Welt. Eigene Fotos: Figur und Hintergrund als lokale Slots, nie im Zustand oder Link.
import { W, H, GROUND, BX, R, PIPE_W, STEP } from "./engine.js";
import { animPose } from "./params.js";
import { sinD } from "./trig.js";

export const TH = {
  day: { skyTop: "#ffd9b8", skyBottom: "#fff1dc", pipe: "#3457d5", pipeEdge: "#1c2f7a", ground: "#7a4fd0", groundEdge: "#4b2a96", accent: "#ff3b6b" },
  night: { skyTop: "#0b1030", skyBottom: "#26305e", pipe: "#3a6ea5", pipeEdge: "#20406a", ground: "#2b2b3a", groundEdge: "#4a4a63", accent: "#7ad1ff", stars: 1 },
  sunset: { skyTop: "#ff9e57", skyBottom: "#ffd9a0", pipe: "#c0653a", pipeEdge: "#7d3b1b", ground: "#caa06a", groundEdge: "#a67c48", accent: "#ffef8f" },
  retro: { skyTop: "#f2e3c6", skyBottom: "#e6d0a6", pipe: "#b0413e", pipeEdge: "#6e2422", ground: "#3f3a60", groundEdge: "#26233f", accent: "#2a9d8f" },
  candy: { skyTop: "#ff8fd0", skyBottom: "#ffd0ec", pipe: "#7a5cff", pipeEdge: "#4a2fb0", ground: "#ffc0e6", groundEdge: "#e59ccf", accent: "#fff2b0" },
  neon: { skyTop: "#12002b", skyBottom: "#3a0a6b", pipe: "#00f5d4", pipeEdge: "#00a896", ground: "#1b0036", groundEdge: "#ff2bd6", accent: "#ff2bd6", glow: 1, stars: 1 },
  ocean: { skyTop: "#04476b", skyBottom: "#1aa6b7", pipe: "#ff7f6b", pipeEdge: "#b74a3a", ground: "#0b2f4a", groundEdge: "#1d5f86", accent: "#aef0ff", bubbles: 1 },
  lava: { skyTop: "#2b0a0a", skyBottom: "#7a1d0b", pipe: "#3a3a3a", pipeEdge: "#1b1b1b", ground: "#1b0f0f", groundEdge: "#ff5a1f", accent: "#ffb347", glow: 1 }
};
// Spiel aus einer Karte (skin): deren zwei Farben statt einer benannten Welt (alt Playable.skinTheme, gleiche Idee)
function skinTheme(skin) {
  const [a, b] = skin.c;
  return { skyTop: a, skyBottom: "#fffaf0", pipe: b, pipeEdge: "#111111", ground: "#111111", groundEdge: b, accent: b };
}
/** Welt fuer den aktuellen Abschnitt (alt game.js look()). */
export function themeOf(g, section) {
  if (g.skin) return skinTheme(g.skin);
  if (g.route) return TH[g.route[section || 0].t] || TH[g.theme];
  const l = g.look, base = TH[g.theme];
  if (!l) return base;
  const th = Object.assign({}, base, { skyTop: l.a || base.skyTop, skyBottom: l.b || l.a || base.skyBottom, pipe: l.p || base.pipe, pipeEdge: l.q || base.pipeEdge, ground: l.g || base.ground, groundEdge: l.h || base.groundEdge });
  if (l.d) { th.stars = l.d === "stars"; th.bubbles = l.d === "bubbles"; th.snow = l.d === "snow"; th.rain = l.d === "rain"; th.bare = l.d === "none"; }
  return th;
}
function lookOf(g, section) { if (g.route) return { e: [g.route[section || 0].e] }; return (!g.skin && g.look) || {}; }

function column(out, x, y, h, cap, th, form, emoji) {   // eine Haelfte eines Hindernisses; die Hitbox ist immer dasselbe Rechteck
  const w = PIPE_W;
  if (h <= 0) return;
  if (form === "emoji") {
    const ops = [{ o: "rect", x, y, w, h, fill: th.pipe, alpha: 0.25 }];
    for (let ey = y + h - 20; ey > y - 40; ey -= 40) ops.push({ o: "sprite", emoji, x: x + w / 2 - 17, y: ey - 17, w: 34, h: 34 });
    out.push({ o: "group", clip: { x: x - 5, y, w: w + 10, h }, ops });
    return;
  }
  if (form === "block") {
    out.push({ o: "rect", x, y, w, h, fill: th.pipe, stroke: th.pipeEdge, lw: 2 });
    for (let by = y + (h % 26); by < y + h; by += 26) out.push({ o: "line", x1: x, y1: by, x2: x + w, y2: by, lw: 2, stroke: th.pipeEdge });
  } else if (form === "round") {
    out.push({ o: "rect", x, y, w, h, r: 18, fill: th.pipe, stroke: th.pipeEdge, lw: 2 });
  } else {
    out.push({ o: "rect", x, y, w, h, fill: th.pipe, stroke: th.pipeEdge, lw: 2 });
    const cy = cap ? y + h - 14 : y;
    out.push({ o: "rect", x: x - 5, y: cy, w: w + 10, h: 14, fill: th.pipe, stroke: th.pipeEdge, lw: 2 });
  }
  if (form !== "block") out.push({ o: "rect", x: x + 6, y: y + (cap ? 0 : 14), w: 5, h: Math.max(0, h - 14), fill: "#ffffff38" });
}

function backdrop(out, th, lk, clock, still) {
  const c = still ? 0 : clock;
  if (th.bare) return;
  if (th.snow) { for (let i = 0; i < 30; i++) out.push({ o: "circle", x: (i * 89 + sinD(c + i) * 12 + W) % W, y: (c * (18 + i % 9) + i * 61) % (H - GROUND), r: 1.5 + i % 3, fill: "#ffffffd9" }); }
  else if (th.rain) { for (let i = 0; i < 34; i++) { const x = (i * 83) % W, y = (c * (240 + i % 7 * 20) + i * 47) % (H - GROUND); out.push({ o: "line", x1: x, y1: y, x2: x - 2, y2: y + 11, lw: 1, stroke: "#ffffff66" }); } }
  else if (th.stars) { for (let i = 0; i < 28; i++) out.push({ o: "rect", x: (i * 97 + 13) % W, y: (i * 53 + 7) % (H - GROUND - 80), w: 2, h: 2, fill: "#ffffffcc", alpha: still ? 0.8 : 0.4 + 0.6 * Math.abs(sinD(c * 1.5 + i)) }); }
  else if (th.bubbles) { for (let i = 0; i < 14; i++) out.push({ o: "circle", x: (i * 71 + 20) % W, y: H - GROUND - ((c * (14 + i * 3) + i * 80) % (H - GROUND)), r: 3 + (i % 4), stroke: "#ffffff59", lw: 1 }); }
  else { for (let i = 0; i < 4; i++) { const x = ((i * 130 - c * (6 + i * 3)) % (W + 120) + (W + 120)) % (W + 120) - 60, y = 70 + i * 62; out.push({ o: "ellipse", x, y, rx: 34, ry: 11, fill: "#ffffff59" }, { o: "ellipse", x: x + 20, y: y - 8, rx: 22, ry: 10, fill: "#ffffff59" }); } }
  if (lk.e) for (let i = 0; i < 6; i++) { const x = ((i * 67 - c * (9 + i * 4)) % (W + 40) + W + 40) % (W + 40) - 20; out.push({ o: "sprite", emoji: lk.e[i % lk.e.length], x: x - 11, y: 44 + (i * 73) % (H - GROUND - 90) - 11, w: 22, h: 22, alpha: 0.75 }); }
}

function pipes(out, sim, th, lk) {
  const P = PIPE_W, cap = 14;
  for (const pp of sim.pipes) {
    const by = pp.top + pp.gap;
    if ((lk.f && lk.f !== "tube") || lk.o) { const form = lk.o && !lk.f ? "emoji" : lk.f; column(out, pp.x, 0, pp.top, true, th, form, lk.o); column(out, pp.x, by, H - GROUND - by, false, th, form, lk.o); continue; }
    const sh = th.glow ? { color: th.pipe, blur: 12, dx: 0, dy: 0 } : undefined;
    out.push({ o: "poly", pts: [pp.x, 0, pp.x, pp.top - cap, pp.x + P / 2, pp.top, pp.x + P, pp.top - cap, pp.x + P, 0], closed: true, fill: th.pipe, stroke: th.pipeEdge, lw: 2, shadow: sh });
    out.push({ o: "poly", pts: [pp.x, H - GROUND, pp.x, by + cap, pp.x + P / 2, by, pp.x + P, by + cap, pp.x + P, H - GROUND], closed: true, fill: th.pipe, stroke: th.pipeEdge, lw: 2, shadow: sh });
    for (let bar = 24; bar < pp.top - cap; bar += 24) out.push({ o: "rect", x: pp.x, y: pp.top - cap - bar, w: P, h: 6, fill: "#ffffff38" });
    for (let bar = 24; by + cap + bar < H - GROUND; bar += 24) out.push({ o: "rect", x: pp.x, y: by + cap + bar, w: P, h: 6, fill: "#ffffff38" });
  }
}

/**
 * Ebenen eines Laufs. g: Spielwerte (seed, params, theme, look, route, emoji, anim, skin), sims: [ich, Geist?],
 * ctx: { t (Sekunden, nur Optik), reduced, assets: {figur?, hintergrund?} (lokale Slots vorhanden), fx: Effekte aus dem Zustand }.
 */
export function flightOps(g, sims, ctx, fx) {
  const me = sims[0], th = themeOf(g, me.section), lk = lookOf(g, me.section), still = !!ctx.reduced, clock = ctx.t || 0;
  const bg = [{ o: "rect", x: -20, y: -20, w: W + 40, h: H + 40, fill: { lin: [0, 0, 0, H], stops: [[0, th.skyTop], [1, th.skyBottom]] } }];
  if (ctx.assets && ctx.assets.hintergrund) bg.push({ o: "image", src: { kind: "local", slot: "hintergrund" }, x: 0, y: 0, w: W, h: H - GROUND, fit: "cover", alpha: 0.45 });
  backdrop(bg, th, lk, clock, still);
  const world = [];
  pipes(world, me, th, lk);
  const off = me.state === "run" ? (me.ticks * me.params.speed * STEP) % 24 : 0;
  world.push({ o: "rect", x: 0, y: H - GROUND, w: W, h: GROUND + 40, fill: th.ground }, { o: "rect", x: 0, y: H - GROUND, w: W, h: 4, fill: th.groundEdge });
  for (let x = -off; x < W; x += 24) world.push({ o: "rect", x, y: H - GROUND + 14, w: 12, h: 4, fill: th.groundEdge });
  // Spur (Trail) aus den letzten Positionen im Zustand
  const tr = me.trail || [];
  for (let i = 0; i < tr.length; i++) {
    const a = (i + 1) / (tr.length + 1), x = BX - (tr.length - i) * 3 * me.params.speed * STEP;
    if (lk.m) world.push({ o: "sprite", emoji: lk.m, x: x - 6 - 4 * a, y: tr[i] - 6 - 4 * a, w: 12 + 8 * a, h: 12 + 8 * a, alpha: a * 0.5 });
    else world.push({ o: "circle", x, y: tr[i], r: 7 * a, fill: th.accent, alpha: a * 0.5 });
  }
  // Geist (Sitz 1): halb durchsichtig, versetzt wie im Altcode-Duellbild
  for (let s = 1; s < sims.length; s++) if (sims[s]) world.push(bird(sims[s], g, ctx, 0.45, -0, fx));
  world.push(bird(me, g, ctx, 1, 0, fx));
  const ops = [{ id: "bg", ops: bg }, { id: "world", ops: world }];
  if (fx && fx.flash > 0 && !still) ops.push({ id: "fx", ops: [{ o: "flash", color: "#ff3c50", alpha: fx.flash * 0.5 }] });
  if (fx && fx.shake > 0 && !still) ops[1].ops.unshift({ o: "shake", amt: fx.shake });
  return ops;
}
function bird(sim, g, ctx, alpha, dx, fx) {
  const by = sim.state === "ready" && !ctx.reduced ? sim.bird.y + sinD((ctx.t || 0) * 4) * 6 : sim.bird.y;
  const an = g.anim && !ctx.reduced ? animPose(g.anim, ctx.t || 0, g.anim.bei ? (fx && fx.since && fx.since[g.anim.bei] != null ? fx.since[g.anim.bei] : 1e9) : 0, g.seed, 36) : null;
  const inner = ctx.assets && ctx.assets.figur
    ? { o: "image", src: { kind: "local", slot: "figur" }, x: -18, y: -18, w: 36, h: 36, fit: "cover", clip: "circle" }
    : { o: "sprite", emoji: g.emoji, x: -18, y: -16, w: 36, h: 36 };
  const pose = an ? { o: "group", tx: an.x, ty: an.y, rot: an.r, sx: an.sx, sy: an.sy, alpha: an.a, ops: [inner] } : inner;
  return { o: "group", tx: BX + dx, ty: by, rot: sim.state === "over" ? 1.4 : sim.bird.rot, alpha, ops: [pose] };
}

/** Agenten-Duell: beide Flieger auf einer Strecke, Farben der Karte (alt modes.js drawFly). */
export function duelOps(col, a, b, sa, sb) {
  const ops = [{ o: "rect", x: 0, y: 0, w: W, h: H, fill: "#14233f" }];
  for (const p of sa.pipes) { ops.push({ o: "rect", x: p.x, y: 0, w: PIPE_W, h: p.top, fill: col[0] }, { o: "rect", x: p.x, y: p.top + sa.params.gap, w: PIPE_W, h: H - (p.top + sa.params.gap), fill: col[0] }); }
  ops.push({ o: "rect", x: 0, y: H - GROUND, w: W, h: GROUND, fill: col[1] });
  ops.push({ o: "sprite", emoji: b.e, x: BX - 34 - 18, y: sb.bird.y - 18, w: 36, h: 36 }, { o: "sprite", emoji: a.e, x: BX - 18, y: sa.bird.y - 18, w: 36, h: 36 });
  ops.push({ o: "text", x: W * 0.3, y: H * 0.1, text: String(sa.score), size: 29, font: "brand", align: "center", base: "middle", fill: "#ffffff" });
  ops.push({ o: "text", x: W * 0.7, y: H * 0.1, text: String(sb.score), size: 29, font: "brand", align: "center", base: "middle", fill: "#ffffff" });
  return [{ id: "duel", ops }];
}
export { R };
