// Code-Modus, the automated playtest (lib/code/play.mjs): endless loops, deep recursion, exceptions, hidden state, games
// that never end or ignore their inputs, nondeterminism, and two players that drift apart are all caught before a game is
// signed. The reference games pass, including two-player lockstep over a lossy, reordering channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { checkCode } from '../lib/code/check.mjs';
import { playtest, playInWorker, runtime } from '../lib/code/play.mjs';
import { REFERENCE } from '../lib/duell-code.mjs';

const SDK = createRequire(import.meta.url)('../lib/code/sdk.js');
// a small solo game; pieces of it replaced per test
const SOLO = (o = {}) => `
${o.top || ''}
const GAME = {
  meta: { title: 'Probe', players: { min: 1, max: ${o.max || 1} }, mode: 'turn', inputs: ['tap'] },
  init(rng, params, players) { return { n: 0, score: [0, 0], t: 0 }; },
  step(s, input, rng) { ${o.step || 's.n += 1; s.score[input.seat] += input.x > 180 ? 2 : 1 + rng.int(2); s.t = 1 - s.t;'} return s; },
  view(s, seat) { ${o.view || ''} return [{ o: 'text', x: 180, y: 100, s: 'Zug ' + s.n }]; },
  status(s) { return { over: ${o.over || 's.n >= 12'}, score: s.score.slice(0, ${o.max || 1}), winner: null${o.max ? ', turn: s.t' : ''} }; },
};`;
const checked = (src) => { const c = checkCode(src); assert.equal(c.ok, true, (c.errors || []).join('; ')); return c.code; };

test('Referenzspiele: alle Prüfungen grün, zwei Spieler im Lockstep mit gleichem Hash', async () => {
  for (const [name, src] of Object.entries(REFERENCE)) {
    const r = await playInWorker(checked(src), {}, { wallMs: 30000 });
    assert.equal(r.ok, true, name + ': ' + r.errors.join('; '));
    assert.ok(r.stats.over >= 1 && r.stats.scoreMoved && r.stats.idleDiffers);
    if (r.meta.players.max >= 2) { assert.equal(r.stats.lockstep.ok, true, name); assert.equal(r.stats.lockstep.hashA, r.stats.lockstep.hashB); assert.ok(r.stats.lockstep.dups > 0, 'the channel duplicated messages'); }
    assert.ok(r.frames.length >= 1 && r.texts.length >= 1);
  }
});

test('Endlosschleife und tiefe Rekursion: das Budget beendet den Aufruf, deterministisch (kein Zeitlimit des Geräts)', () => {
  const loop = playtest(checked(SOLO({ step: 'while (s.n >= 0) { s.t = s.t; }' })));
  assert.equal(loop.ok, false); assert.match(loop.errors.join(' '), /budget-ops/);
  const deep = playtest(checked(SOLO({ top: 'function down(k) { return k <= 0 ? 0 : 1 + down(k - 1); }', step: 's.n += down(1000);' })));
  assert.equal(deep.ok, false); assert.match(deep.errors.join(' '), /budget-depth/);
  const thrown = playtest(checked(SOLO({ step: 'const z = null; s.n = z.x;' })));
  assert.equal(thrown.ok, false); assert.match(thrown.errors.join(' '), /step\(\)/);
});

test('ein Spiel, das nie endet, dessen Eingaben nichts tun oder dessen Punkte stehen, wird nicht signiert', () => {
  const never = playtest(checked(SOLO({ over: 'false' })), { maxTurnSteps: 60 });
  assert.match(never.errors.join(' '), /no bot game ended/);
  const inert = playtest(checked(SOLO({ step: 's.n += 1;' })));
  assert.match(inert.errors.join(' '), /score never changed|exactly the same/);
});

test('versteckter Zustand außerhalb des States: Snapshot-Prüfung und Lockstep fallen', () => {
  // a counter outside the state that view() moves: two devices call view() differently often
  const src = SOLO({ top: 'const hidden = { k: 0 };', view: 'hidden.k += 1;', step: 's.n += 1; s.score[input.seat] += (hidden.k % 3) + 1; s.t = 1 - s.t;', max: 2 });
  const r = playtest(checked(src));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /not deterministic|not plain data|drifted apart|different states/);
});

test('Nichtdeterminismus wird erkannt (hier am Check vorbei mit Math.random eingeschleust)', () => {
  // the static check refuses Math.random; this test hands the playtest instrumented code that uses it anyway
  const code = checked(SOLO({ step: 's.n += 1; s.score[0] += 1 + rng.int(2);' })).replace('rng.int(2)', 'Math.floor(Math.random() * 1000)');
  const r = playtest(code);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /not deterministic|not plain data|exactly the same/);
});

test('der Worker: Speicherbombe und Endloslauf am Budget vorbei enden als Fehler, nie als Hänger des Servers', async () => {
  const bomb = checked(SOLO({ step: 'let a = [1]; for (let i = 0; i < 40; i++) a = a.concat(a); s.n = a.length;' }));
  const r = await playInWorker(bomb, {}, { wallMs: 8000 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /memory|budget|longer|crash|stopped|step\(\)/);
  const slow = await playInWorker(checked(SOLO()), {}, { wallMs: 1 });
  assert.equal(slow.ok, false); assert.match(slow.errors.join(' '), /longer than 1 ms/);
});

test('Lockstep allein: Verspätung, Doppelte, Umordnung; ein Zug außer der Reihe wird verworfen; zwei verschiedene Züge n sind ein Desync', () => {
  const a = SDK.Lockstep({ seat: 0, seats: 2, mode: 'turn' }), b = SDK.Lockstep({ seat: 1, seats: 2, mode: 'turn' });
  a.local({ seat: 0, t: 'tap', x: 1, y: 2 });
  const m = a.out()[0];
  b.receive(m); b.receive(m);   // twice
  const st = b.ready(() => 0);
  assert.equal(st.length, 1); assert.deepEqual(st[0].inputs, [{ seat: 0, t: 'tap', x: 1, y: 2 }]);
  // seat 1 sends move 1 although it is seat 0's turn: dropped on both sides alike
  b.local({ seat: 1, t: 'tap', x: 5, y: 5 });
  assert.deepEqual(b.ready(() => 0)[0].inputs, []);
  const c = SDK.Lockstep({ seat: 0, seats: 2, mode: 'turn' });
  c.local({ seat: 0, t: 'tap', x: 1, y: 1 }); c.receive({ t: 'cg-m', n: 0, s: 1, i: '9,9' });
  assert.ok(c.desync());
  // realtime: a tick is released only when every seat's packet is there, in any order
  const r0 = SDK.Lockstep({ seat: 0, seats: 2, mode: 'realtime', delay: 2 });
  r0.pump(); r0.out();
  assert.equal(r0.ready().length, 0);
  r0.receive({ t: 'cg-i', k: 1, s: 1, i: ['l'] }); assert.equal(r0.ready().length, 0);
  r0.receive({ t: 'cg-i', k: 0, s: 1, i: [] });
  const two = r0.ready();
  assert.equal(two.length, 2); assert.deepEqual(two[1].inputs.map((i) => i.t), ['swipe', 'tick']);
  // hash mismatch
  r0.applied(20, 'aaaa'); r0.receive({ t: 'cg-h', k: 20, h: 'bbbb' });
  assert.ok(r0.desync());
});

test('nach dem Ende ändert nichts mehr den Zustand (auch keine späte Eingabe): beide Geräte frieren gleich ein', () => {
  const rt = runtime(checked(SOLO({ over: 's.n >= 1' })));
  rt.start(3, {}, 1);
  rt.apply({ seat: 0, t: 'tap', x: 1, y: 1 });
  const h = rt.hash();
  assert.equal(rt.apply({ seat: 0, t: 'tap', x: 300, y: 1 }).skipped, true);
  assert.equal(rt.hash(), h);
});
