// zug-steine "Gleiche Steine" – Altregel turns.js:296-327 (GAMES.steine): beide legen denselben Steinstrom aus dem Seed auf ein
// 8×8-Feld; der Empfaenger spielt die Zuege nach, statt einer Punktzahl zu vertrauen.
import { T, fmt, hash32, mulberry32 } from "../../engines/zug-z2/lib.js";
import { base } from "../../engines/zug-z2/views.js";

export const SIZE = 8, MAX_BLOCKS = 40;
export const BLOCKS = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [1, 1]]];
export function blockAt(doc, i) { const r = mulberry32(hash32("steine|" + doc.seed)); let v = 0; for (let k = 0; k <= i; k++) v = r(); return BLOCKS[Math.floor(v * BLOCKS.length)]; }
export function fits(grid, block, at) {
  const x = at % SIZE, y = Math.floor(at / SIZE);
  return block.every((c) => { const cx = x + c[0], cy = y + c[1]; return cx < SIZE && cy < SIZE && !grid[cy * SIZE + cx]; });
}
export function drop(st, block, at) {
  const x = at % SIZE, y = Math.floor(at / SIZE), g = st.grid.slice(), rows = [], cols = [];
  block.forEach((c) => { g[(y + c[1]) * SIZE + x + c[0]] = 1; });
  for (let i = 0; i < SIZE; i++) {
    let r = true, k = true;
    for (let j = 0; j < SIZE; j++) { if (!g[i * SIZE + j]) r = false; if (!g[j * SIZE + i]) k = false; }
    if (r) rows.push(i); if (k) cols.push(i);
  }
  rows.forEach((r) => { for (let j = 0; j < SIZE; j++) g[r * SIZE + j] = 0; });
  cols.forEach((c) => { for (let j = 0; j < SIZE; j++) g[j * SIZE + c] = 0; });
  const n = rows.length + cols.length;
  return { grid: g, score: st.score + block.length + n * n * 10, lines: n, i: st.i + 1 };
}
export function replay(doc, cells) {
  let st = { grid: new Array(SIZE * SIZE).fill(0), score: 0, lines: 0, i: 0 };
  for (let n = 0; n < cells.length; n++) { const b = blockAt(doc, st.i); if (!fits(st.grid, b, cells[n])) return null; st = drop(st, b, cells[n]); }
  return st;
}
export function canMove(st, doc) { const b = blockAt(doc, st.i); for (let a = 0; a < SIZE * SIZE; a++) if (fits(st.grid, b, a)) return true; return false; }
// Pruefung wie okAnswer "blocks" (turns.js:1157): hoechstens 40 Zellen 0..63, nachspielbar
export function blocksOk(v, doc) { return Array.isArray(v) && v.length <= MAX_BLOCKS && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 63) && !!replay(doc, v); }
function blocksPrompt() { return { w: "blocks", l: "blk_go", max: MAX_BLOCKS, auto: true, check: (v, doc) => blocksOk(v, doc) }; }
export default {
  // Widget blocks (ADR 0001): der Steinstrom aus dem Seed als Daten, beide Seiten bekommen denselben
  // Vorschau aus dem Entwurf (gelegte Zellen) als Daten: Feld, Punkte, aktueller und naechster Stein
  view: {
    blocks(p, c) {
      const id = "w" + c.step, d = c.draft && typeof c.draft === "object" ? c.draft["w:" + id] : null, cells = Array.isArray(d) ? d : [];
      const st = replay(c.doc, cells) || { grid: new Array(SIZE * SIZE).fill(0), score: 0, i: 0 };
      return base(p, c, { size: SIZE, max: p.max, board: { cells: st.grid.map(Boolean), score: st.score, next: blockAt(c.doc, st.i), after: blockAt(c.doc, st.i + 1), over: !canMove(st, c.doc) } });
    }
  },
  turns: [[blocksPrompt()], [blocksPrompt()]],
  result(doc, m, lang) {
    const X = T(lang), a = replay(doc, m[0][0]).score, b = replay(doc, m[1][0]).score;
    return { h: a === b ? X.blk_tie : fmt(X.blk_h, { a, b }), lines: [X.blk_fair] };
  }
};
