// Bild eines Laufs als Canvas-Anzeigeliste (ADR 0001 (b)), aus alt:src/lauf-ui.js draw(). Reine Funktion; Math.sin/cos
// nur fuer die Optik. Logische Groesse 400 x 360 (alt VIEW = 400 px Strecke, H = 360), Kamera folgt dem Laeufer.
// Reduzierte Bewegung: kein Wackeln, kein Blitz, Hintergrund steht, Muenzen drehen sich nicht.
import { H, PH, height } from "./engine.js";
import { animPose } from "../flug/params.js";
import { sinD, cosD } from "../flug/trig.js";
import { dashRing } from "../flug/view.js";

export const VIEW = 400;
// Welt: Himmel oben und unten, Boden, Kante, was unter den Luecken liegt (Wasser, Lava oder nichts), Kulisse
export const WORLD = {
  bruecke: ["#8fd3ff", "#e6f7ff", "#9a6332", "#5a3a1a", "#2a7bd5", "hills"], stadt: ["#ffb88c", "#ffe0c2", "#5b5b66", "#2f2f38", "", "city"],
  wald: ["#a8e6a1", "#e9ffe0", "#6b4f2a", "#3f8f3a", "", "trees"], wueste: ["#ffd27f", "#fff1c9", "#e0b062", "#b07a32", "", "hills"],
  eis: ["#bfe9ff", "#f2fbff", "#e8f6ff", "#7fbfe9", "#3b7fb8", "hills"], nacht: ["#0b1030", "#26305e", "#2b2b3a", "#7ad1ff", "", "stars"],
  lava: ["#2b0a0a", "#7a1d0b", "#1b0f0f", "#ff5a1f", "#ff6a1f", "hills"], candy: ["#ff8fd0", "#ffd0ec", "#ffc0e6", "#d87fbf", "", "hills"]
};

/** Ebenen eines Laufs. sims: [ich, Geist?]; ctx: { t, reduced, still, media: {figur, hintergrund} (Foto-ids), flash, shake, dead, pose? } */
export function runOps(sims, ctx) {
  const s = sims[0], w = WORLD[s.l.w], vw = VIEW, cam = s.me.x - vw * 0.28, still = !!(ctx.reduced || ctx.still), cl = ctx.t || 0;
  const sky = [{ o: "rect", x: 0, y: 0, w: vw, h: H, fill: { lin: [0, 0, 0, H], stops: [[0, w[0]], [1, w[1]]] } }];
  if (ctx.media && ctx.media.hintergrund) sky.push({ o: "image", src: { kind: "local", id: ctx.media.hintergrund }, x: 0, y: 0, w: vw, h: H, fit: "cover", alpha: 0.45 });
  const par = still ? 0 : cam * 0.25, back = [];
  if (w[5] === "stars") for (let i = 0; i < 40; i++) back.push({ o: "rect", x: ((i * 97 - par * 0.3) % vw + vw) % vw, y: (i * 53) % 200, w: 2, h: 2, fill: "#ffffffcc" });
  else {
    for (let i = 0; i < 5; i++) { const cs = 25, x = (((i * 211 - (still ? 0 : s.me.x * 0.08)) % (vw + 4 * cs)) + vw + 4 * cs) % (vw + 4 * cs) - 2 * cs, y = 20 + i * 17; back.push({ o: "ellipse", x, y, rx: cs * 1.6, ry: cs * 0.55, fill: "#ffffff8c" }, { o: "ellipse", x: x + cs, y: y - cs * 0.3, rx: cs, ry: cs * 0.5, fill: "#ffffff8c" }); }
    for (let i = -1; i < vw / 120 + 2; i++) {
      const x = i * 120 - (par % 120), hgt = 40 + ((Math.floor((par / 120) + i) * 7919) % 50 + 50) % 50;
      if (w[5] === "city") back.push({ o: "rect", x, y: 230 - hgt * 1.6, w: 70, h: 200, fill: "#ffffff59" });
      else if (w[5] === "trees") back.push({ o: "poly", pts: [x, 240, x + 40, 150 - hgt * 0.6, x + 80, 240], closed: true, fill: "#ffffff59" });
      else back.push({ o: "ellipse", x: x + 60, y: 250, rx: 90, ry: hgt + 20, fill: "#ffffff59" });
    }
  }
  const track = [];
  track.push({ o: "rect", x: cam - 20, y: H - 34, w: vw + 40, h: 400, fill: w[4] || "#0000004d" });
  if (w[4]) for (let x = Math.floor(cam / 40) * 40; x < cam + vw + 40; x += 40) track.push({ o: "rect", x: x + (still ? 0 : (cl * 30) % 40), y: H - 30, w: 18, h: 3, fill: "#ffffff59" });
  const bridge = s.l.w === "bruecke";
  for (const sp of s.spans) {
    if (sp.x1 < cam - 10 || sp.x0 > cam + vw + 10) continue;
    const x0 = Math.max(sp.x0, cam - 10), x1 = Math.min(sp.x1, cam + vw + 10);
    if (bridge) {
      for (let x = Math.ceil(sp.x0 / 150) * 150 + 30; x < sp.x1 - 20; x += 150) if (x > cam - 30 && x < cam + vw + 30) track.push({ o: "rect", x, y: sp.y + 12, w: 16, h: 400, fill: w[3] });
      track.push({ o: "rect", x: x0, y: sp.y, w: x1 - x0, h: 14, fill: w[2] }, { o: "rect", x: x0, y: sp.y + 12, w: x1 - x0, h: 3, fill: w[3] }, { o: "rect", x: x0, y: sp.y - 20, w: x1 - x0, h: 3, fill: w[3] });
      for (let x = Math.ceil(sp.x0 / 36) * 36; x < sp.x1; x += 36) if (x > cam - 10 && x < cam + vw + 10) track.push({ o: "rect", x, y: sp.y - 20, w: 3, h: 20, fill: w[3] });
    } else track.push({ o: "rect", x: x0, y: sp.y, w: x1 - x0, h: 400, fill: w[2] }, { o: "rect", x: x0, y: sp.y, w: x1 - x0, h: 6, fill: w[3] });
  }
  for (const it of s.items) {
    if (it.live === false || it.x > cam + vw + 40 || it.x + (it.w || 0) < cam - 40) continue;
    if (it.t === "d") { track.push({ o: "rect", x: it.x, y: it.y, w: it.w, h: it.h, fill: w[3] }); for (let x = 0; x < it.w; x += 20) track.push({ o: "rect", x: it.x + x, y: it.y + it.h - 12, w: 10, h: 12, fill: "#ffd400" }); continue; }
    if (it.t === "g") { track.push({ o: "rect", x: it.x, y: it.y, w: 4, h: it.h, fill: "#111111" }, { o: "sprite", emoji: "🏁", x: it.x - 2, y: it.y - 6, w: 50, h: 50 }); continue; }
    const e = it.t === "c" ? s.l.c : it.t === "f" ? s.l.f : s.l.o, sz = Math.max(it.w, it.h) * 1.25;
    const sx = (it.t === "f" && it.vx > 0 ? -1 : 1) * (it.t === "c" && !still ? Math.abs(cosD(cl * 4 + it.x)) : 1);
    track.push({ o: "group", tx: it.x + it.w / 2, ty: it.y + it.h / 2, sx, sy: 1, ops: [{ o: "sprite", emoji: e, x: -sz / 2, y: -sz / 2, w: sz, h: sz }] });
  }
  for (let g = sims.length - 1; g >= 0; g--) if (sims[g]) track.push(runner(sims[g], ctx, g ? 0.45 : 1, still));
  const layers = [{ id: "sky", ops: sky }, { id: "back", ops: back }, { id: "track", camera: { x: cam, y: 0, zoom: 1 }, ops: track }];
  if (ctx.shake && !still) track.unshift({ o: "shake", amt: ctx.shake });
  if (ctx.flash && !still) layers.push({ id: "fx", ops: [{ o: "flash", color: "#ff3c50", alpha: ctx.flash * 0.4 }] });
  return layers;
}
function runner(s, ctx, alpha, still) {
  const m = s.me, hh = height(s), bob = m.on && s.state === "run" && !still ? Math.abs(sinD((ctx.t || 0) * 14)) * 3 : 0;
  const inner = ctx.media && ctx.media.figur ? { o: "image", src: { kind: "local", id: ctx.media.figur }, x: -30, y: -54, w: 60, h: 60, fit: "cover", clip: "circle" } : { o: "sprite", emoji: s.l.e, x: -30, y: -54, w: 60, h: 60 };
  const an = ctx.pose;
  const posed = an ? { o: "group", tx: an.x, ty: an.y - 24, rot: an.r, sx: an.sx, sy: an.sy, alpha: an.a, ops: [{ o: "group", tx: 0, ty: 24, ops: [inner] }] } : inner;
  // Gegner (Computer oder Aufnahme): gestrichelter Ring und durchsichtig (Gate C, Reihe Dach-Lauf)
  return { o: "group", tx: m.x, ty: m.y - bob, sx: -1, sy: hh / PH, rot: s.state === "over" ? -1.2 : 0, alpha, ops: [posed].concat(alpha < 1 ? dashRing(0, -24, 34, "#ffffff") : []) };
}
/** Pose der Figur (l.anim) zur Zeit t, ausgeloest seit since[bei] Sekunden. */
export function poseOf(l, t, since, reduced) {
  const a = l.anim; if (!a || reduced) return null;
  return animPose(a, t, a.bei ? (since && since[a.bei] != null ? since[a.bei] : 1e9) : 0, l.seed, 60);
}
