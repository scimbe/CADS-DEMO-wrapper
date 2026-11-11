// Verdopplung: slide all tiles, equal numbers merge into their sum. Solo or a race of two on the same tile sequence.
const N = 4;
const LIMIT = 3600;
const COLORS = ['#fff6dc', '#ffe680', '#ffd400', '#ffb000', '#ff6a1f', '#ff3b1d', '#ff4fa3', '#c03bd6', '#7a1fff', '#2b4bff', '#00b3c7', '#14c872'];
const DIRS = ['l', 'r', 'u', 'd'];

function cell(d, k, i) {
  if (d === 'l') return [i, k];
  if (d === 'r') return [N - 1 - i, k];
  if (d === 'u') return [k, i];
  return [k, N - 1 - i];
}
function slideLine(line) {
  const vals = line.filter((v) => v !== 0);
  const out = [];
  let gain = 0;
  for (let i = 0; i < vals.length; i++) {
    if (i + 1 < vals.length && vals[i] === vals[i + 1]) { out.push(vals[i] * 2); gain += vals[i] * 2; i++; }
    else out.push(vals[i]);
  }
  while (out.length < N) out.push(0);
  return { line: out, gain };
}
function move(b, d) {
  const nb = SDK.grid(N, N, 0);
  let gain = 0, moved = false;
  for (let k = 0; k < N; k++) {
    const line = [];
    for (let i = 0; i < N; i++) { const [x, y] = cell(d, k, i); line.push(b[y][x]); }
    const r = slideLine(line);
    gain += r.gain;
    for (let i = 0; i < N; i++) { const [x, y] = cell(d, k, i); nb[y][x] = r.line[i]; if (r.line[i] !== b[y][x]) moved = true; }
  }
  return { b: nb, gain, moved };
}
function stuck(b) { return DIRS.every((d) => !move(b, d).moved); }
function biggest(b) { let m = 0; for (const row of b) for (const v of row) m = Math.max(m, v); return m; }
function spawn(p, rng) {
  const free = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (p.b[y][x] === 0) free.push([x, y]);
  if (!free.length) return;
  const [x, y] = free[rng.keyed(free.length, p.spawns, 1)];
  p.b[y][x] = rng.keyed(10, p.spawns, 2) === 0 ? 4 : 2;
  p.spawns += 1;
}
function tileColor(v) { let i = 0, x = v; while (x > 2) { x = x / 2; i++; } return COLORS[Math.min(i + 1, COLORS.length - 1)]; }
function drawBoard(ops, b, x0, y0, size, gap, big) {
  ops.push({ o: 'rect', x: x0 - gap, y: y0 - gap, w: N * (size + gap) + gap, h: N * (size + gap) + gap, c: 0, r: 10 });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = b[y][x], px = x0 + x * (size + gap), py = y0 + y * (size + gap);
    ops.push({ o: 'rect', x: px, y: py, w: size, h: size, c: v ? tileColor(v) : '#3a3a3a', r: big ? 8 : 3 });
    if (v && big) ops.push({ o: 'text', x: px + size / 2, y: py + size / 2 + 10, s: String(v), z: v < 100 ? 32 : v < 1000 ? 26 : 20, b: true, c: v >= 16 ? 11 : 0 });
  }
}

const GAME = {
  meta: { title: 'Verdopplung', players: { min: 1, max: 2 }, mode: 'realtime', inputs: ['swipe', 'tick'] },
  init(rng, params, players) {
    const target = [256, 512, 1024, 2048].includes(params.target) ? params.target : 1024;
    const p = [];
    for (let s = 0; s < players; s++) {
      const one = { b: SDK.grid(N, N, 0), score: 0, spawns: 0, won: false, done: false };
      spawn(one, rng); spawn(one, rng);
      p.push(one);
    }
    return { p, t: 0, target };
  },
  step(s, input, rng) {
    if (GAME.status(s).over) return s;
    if (input.t === 'tick') { s.t += 1; return s; }
    if (input.t !== 'swipe') return s;
    const p = s.p[input.seat];
    if (!p || p.done || p.won) return s;
    const r = move(p.b, input.d);
    if (!r.moved) return s;
    p.b = r.b; p.score += r.gain;
    spawn(p, rng);
    if (biggest(p.b) >= s.target) p.won = true;
    else if (stuck(p.b)) p.done = true;
    return s;
  },
  view(s, seat) {
    const me = s.p[Math.min(seat, s.p.length - 1)];
    const ops = [{ o: 'bg', c: 1 }];
    ops.push({ o: 'text', x: 180, y: 44, s: 'VERDOPPLUNG', z: 32, b: true, c: 0 });
    ops.push({ o: 'text', x: 180, y: 80, s: 'Ziel ' + s.target + '  ·  Punkte ' + me.score, z: 18, c: 0 });
    drawBoard(ops, me.b, 16, 112, 76, 8, true);
    if (s.p.length > 1) {
      const other = s.p[1 - Math.min(seat, 1)];
      ops.push({ o: 'text', x: 180, y: 488, s: 'Gegenüber: ' + other.score + (other.won ? ' · am Ziel' : other.done ? ' · fest' : ''), z: 16, c: 0 });
      drawBoard(ops, other.b, 128, 504, 24, 3, false);
      ops.push({ o: 'text', x: 180, y: 632, s: 'Noch ' + Math.ceil((LIMIT - s.t) / 20) + ' s', z: 14, c: 0 });
    }
    if (me.won) ops.push({ o: 'text', x: 180, y: 470, s: 'Geschafft!', z: 28, b: true, c: 3 });
    else if (me.done) ops.push({ o: 'text', x: 180, y: 470, s: 'Kein Zug mehr', z: 24, b: true, c: 3 });
    else if (s.p.length === 1) ops.push({ o: 'text', x: 180, y: 520, s: 'Wischen: alle Kacheln rutschen', z: 16, c: 0 });
    return ops;
  },
  status(s) {
    const score = s.p.map((p) => p.score);
    if (s.p.length === 1) { const p = s.p[0]; return { over: p.won || p.done, score, winner: p.won ? 0 : null }; }
    const won = s.p.findIndex((p) => p.won);
    const over = won >= 0 || s.p.every((p) => p.done) || s.t >= LIMIT;
    let winner = null;
    if (won >= 0) winner = won;
    else if (over) winner = score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1;
    return { over, score, winner };
  },
  moves(s, seat) {
    const p = s.p[seat];
    if (!p || p.done || p.won) return [];
    return DIRS.filter((d) => move(p.b, d).moved).map((d) => ({ t: 'swipe', d }));
  },
};
