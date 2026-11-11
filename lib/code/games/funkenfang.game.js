// Funkenfang: stars fall, catch them with your bowl; a flame costs a life. Tap where the bowl should go, or swipe.
// Two players share the sky, each with an own bowl. 45 seconds.
const LIMIT = 900, BOWL = 64, FLOOR = 560;
const COL = [2, 4];

const GAME = {
  meta: { title: 'Funkenfang', players: { min: 1, max: 2 }, mode: 'realtime', inputs: ['tap', 'swipe', 'tick'] },
  init(rng, params, players) {
    const p = [];
    for (let s = 0; s < players; s++) p.push({ x: players === 1 ? 180 : 110 + s * 140, to: players === 1 ? 180 : 110 + s * 140, score: 0, lives: 3 });
    return { p, items: [], t: 0, next: 10 };
  },
  step(s, input, rng) {
    if (GAME.status(s).over) return s;
    if (input.t === 'tap') { const p = s.p[input.seat]; if (p) p.to = SDK.clamp(input.x, BOWL / 2, 360 - BOWL / 2); return s; }
    if (input.t === 'swipe') { const p = s.p[input.seat]; if (p && (input.d === 'l' || input.d === 'r')) p.to = SDK.clamp(p.to + (input.d === 'l' ? -90 : 90), BOWL / 2, 360 - BOWL / 2); return s; }
    if (input.t !== 'tick') return s;
    s.t += 1;
    for (const p of s.p) { if (p.lives <= 0) continue; const d = p.to - p.x; p.x += Math.abs(d) <= 12 ? d : Math.sign(d) * 12; }
    s.next -= 1;
    if (s.next <= 0) {
      const bad = rng.chance(0.22);
      s.items.push({ x: 20 + rng.int(320), y: 120, v: 3 + rng.int(3) + Math.floor(s.t / 300), bad });
      s.next = Math.max(6, 16 - Math.floor(s.t / 120));
    }
    const keep = [];
    for (const it of s.items) {
      it.y += it.v;
      let hit = false;
      if (it.y >= FLOOR - 18 && it.y <= FLOOR + 6) {
        for (let k = 0; k < s.p.length && !hit; k++) {
          const p = s.p[k];
          if (p.lives > 0 && Math.abs(it.x - p.x) <= BOWL / 2) { hit = true; if (it.bad) p.lives -= 1; else p.score += 1; }
        }
      }
      if (!hit && it.y < 640) keep.push(it);
    }
    s.items = keep;
    return s;
  },
  view(s, seat) {
    const ops = [{ o: 'bg', c: 0 }];
    ops.push({ o: 'text', x: 180, y: 44, s: 'FUNKENFANG', z: 32, b: true, c: 2 });
    const me = s.p[Math.min(seat, s.p.length - 1)];
    ops.push({ o: 'text', x: 180, y: 80, s: 'Sterne ' + me.score + '  ·  Leben ' + me.lives + '  ·  ' + Math.max(0, Math.ceil((LIMIT - s.t) / 20)) + ' s', z: 17, c: 1 });
    if (s.p.length > 1) ops.push({ o: 'text', x: 180, y: 104, s: 'Gegenüber: ' + s.p[1 - Math.min(seat, 1)].score, z: 15, c: 1 });
    for (const it of s.items) ops.push({ o: 'emoji', x: it.x, y: it.y, e: it.bad ? '🔥' : '🌟', z: 30 });
    s.p.forEach((p, k) => {
      if (p.lives <= 0) return;
      ops.push({ o: 'rect', x: p.x - BOWL / 2, y: FLOOR, w: BOWL, h: 16, c: COL[k], r: 8, a: k === seat ? 1 : 0.6 });
    });
    ops.push({ o: 'line', x1: 0, y1: FLOOR + 22, x2: 360, y2: FLOOR + 22, c: 1, w: 2 });
    const st = GAME.status(s);
    if (st.over) ops.push({ o: 'text', x: 180, y: 320, s: s.p.length === 1 ? me.score + ' Sterne!' : st.winner === -1 ? 'Unentschieden' : st.winner === seat ? 'Gewonnen!' : 'Verloren', z: 40, b: true, c: 2 });
    else if (s.t < 60) ops.push({ o: 'text', x: 180, y: 610, s: 'Tippe, wohin die Schale soll', z: 16, c: 1 });
    return ops;
  },
  status(s) {
    const score = s.p.map((p) => p.score);
    const over = s.t >= LIMIT || s.p.every((p) => p.lives <= 0);
    let winner = null;
    if (over) winner = s.p.length === 1 ? (s.p[0].lives > 0 ? 0 : null) : score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1;
    return { over, score, winner };
  },
};
