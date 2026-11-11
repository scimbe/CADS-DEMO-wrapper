// Farbfeld: two colours take turns. Claim a free field next to your own; every field of the other colour that touches it
// turns yours. Rocks block (placed mirror-symmetric, so both sides start equal). Most fields at the end wins.
const N = 6, X0 = 18, Y0 = 150, C = 54;
const SIDE = [3, 4];
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function inside(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }
function legal(s, seat) {
  const out = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (s.g[y][x] !== 0) continue;
    if (NB.some(([dx, dy]) => inside(x + dx, y + dy) && s.g[y + dy][x + dx] === seat + 1)) out.push([x, y]);
  }
  return out;
}
function count(s, seat) { let n = 0; for (const row of s.g) for (const v of row) if (v === seat + 1) n++; return n; }
function claim(s, seat, x, y) {
  s.g[y][x] = seat + 1;
  for (const [dx, dy] of NB) if (inside(x + dx, y + dy) && s.g[y + dy][x + dx] === 2 - seat) s.g[y + dy][x + dx] = seat + 1;
}

const GAME = {
  meta: { title: 'Farbfeld', players: { min: 2, max: 2 }, mode: 'turn', inputs: ['tap', 'move'] },
  init(rng, params, players) {
    const g = SDK.grid(N, N, 0);
    g[0][0] = 1; g[N - 1][N - 1] = 2;
    let rocks = 0;
    while (rocks < 3) {
      const x = rng.int(N), y = rng.int(N);
      if ((x + y) % (N - 1) === 0 || g[y][x] !== 0 || (x === N - 1 - x && y === N - 1 - y)) continue;
      g[y][x] = 9; g[N - 1 - y][N - 1 - x] = 9; rocks++;
    }
    return { g, turn: 0, passes: 0, last: null, players };
  },
  step(s, input, rng) {
    if (GAME.status(s).over || input.seat !== s.turn) return s;
    let x = -1, y = -1;
    if (input.t === 'move' && Array.isArray(input.m)) { x = input.m[0]; y = input.m[1]; }
    else if (input.t === 'tap') { x = Math.floor((input.x - X0) / C); y = Math.floor((input.y - Y0) / C); }
    if (!legal(s, s.turn).some(([a, b]) => a === x && b === y)) return s;
    claim(s, s.turn, x, y);
    s.last = [x, y];
    s.turn = 1 - s.turn;
    if (!legal(s, s.turn).length) s.turn = 1 - s.turn;
    return s;
  },
  view(s, seat) {
    const ops = [{ o: 'bg', c: 1 }];
    ops.push({ o: 'text', x: 180, y: 46, s: 'FARBFELD', z: 34, b: true, c: 0 });
    ops.push({ o: 'rect', x: 20, y: 70, w: 150, h: 46, c: SIDE[0], r: 8, a: s.turn === 0 ? 1 : 0.45 });
    ops.push({ o: 'rect', x: 190, y: 70, w: 150, h: 46, c: SIDE[1], r: 8, a: s.turn === 1 ? 1 : 0.45 });
    ops.push({ o: 'text', x: 95, y: 101, s: (seat === 0 ? 'Du ' : 'Rot ') + count(s, 0), z: 20, b: true, c: 11 });
    ops.push({ o: 'text', x: 265, y: 101, s: (seat === 1 ? 'Du ' : 'Blau ') + count(s, 1), z: 20, b: true, c: 11 });
    ops.push({ o: 'rect', x: X0 - 4, y: Y0 - 4, w: N * C + 8, h: N * C + 8, c: 0, r: 8 });
    const mine = s.turn === seat ? legal(s, seat) : [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = s.g[y][x], px = X0 + x * C + 2, py = Y0 + y * C + 2;
      ops.push({ o: 'rect', x: px, y: py, w: C - 4, h: C - 4, r: 6, c: v === 9 ? '#6b6b6b' : v ? SIDE[v - 1] : '#fff6dc' });
      if (v === 9) ops.push({ o: 'emoji', x: px + C / 2 - 2, y: py + C / 2 + 8, e: '🧱', z: 26 });
    }
    for (const [x, y] of mine) ops.push({ o: 'circle', x: X0 + x * C + C / 2, y: Y0 + y * C + C / 2, r: 7, c: SIDE[seat], a: 0.7 });
    if (s.last) ops.push({ o: 'circle', x: X0 + s.last[0] * C + C / 2, y: Y0 + s.last[1] * C + C / 2, r: 5, c: 11 });
    const st = GAME.status(s);
    let line = s.turn === seat ? 'Du bist dran: tippe ein Feld mit Punkt' : 'Die andere Farbe ist dran';
    if (st.over) line = st.winner === -1 ? 'Unentschieden' : st.winner === seat ? 'Gewonnen!' : 'Verloren';
    ops.push({ o: 'text', x: 180, y: 520, s: line, z: st.over ? 30 : 17, b: st.over, c: 0 });
    return ops;
  },
  status(s) {
    const score = [count(s, 0), count(s, 1)];
    const over = !legal(s, 0).length && !legal(s, 1).length;
    return { over, score, winner: over ? (score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1) : null, turn: s.turn };
  },
  moves(s, seat) {
    if (seat !== s.turn || GAME.status(s).over) return [];
    return legal(s, seat).map(([x, y]) => ({ t: 'move', m: [x, y] }));
  },
};
