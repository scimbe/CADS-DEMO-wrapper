// AI seal (HMAC over kind + content + time) and the pure parts of the pots: periods, keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, makeSealer, SEAL_RE } from '../lib/duell-seal.mjs';
import { loadEntitlements, mintKey, monthOf, weekOf } from '../lib/duell-pots.mjs';

const CARD = { changes: { x: 'Frohe Weihnachten', colors: ['#0f5132', '#ffd400'], stickers: ['🎄', '⭐'] }, note: 'Weihnachtlich' };

test('seal: verifies the exact content, key order does not matter', () => {
  const s = makeSealer('server-secret'), at = Date.parse('2026-11-04T12:00:00Z');
  const seal = s.seal('wish', CARD, at);
  assert.match(seal, SEAL_RE);
  assert.deepEqual(s.verify(seal, CARD), { valid: true, kind: 'wish', at });
  const reordered = { note: 'Weihnachtlich', changes: { stickers: ['🎄', '⭐'], colors: ['#0f5132', '#ffd400'], x: 'Frohe Weihnachten' } };
  assert.equal(s.verify(seal, reordered).valid, true);
  assert.equal(canonical({ b: 1, a: [1, { d: 2, c: undefined }] }), '{"a":[1,{"d":2}],"b":1}');
});

test('seal: forging fails - changed text, colour, kind, time, signature, or another secret', () => {
  const s = makeSealer('server-secret'), at = Date.parse('2026-11-04T12:00:00Z'), seal = s.seal('wish', CARD, at);
  const [, , t36, sig] = seal.split('.');
  assert.equal(s.verify(seal, { ...CARD, note: 'Weihnachtlich!' }).valid, false, 'one character');
  assert.equal(s.verify(seal, { ...CARD, changes: { ...CARD.changes, colors: ['#000000', '#ffd400'] } }).valid, false, 'one colour');
  assert.equal(s.verify(`s1.line.${t36}.${sig}`, CARD).valid, false, 'other kind');
  assert.equal(s.verify(`s1.wish.${(at + 1).toString(36)}.${sig}`, CARD).valid, false, 'other time');
  assert.equal(s.verify(seal.slice(0, -1) + (seal.endsWith('A') ? 'B' : 'A'), CARD).valid, false, 'other signature');
  assert.equal(makeSealer('guessed-secret').verify(seal, CARD).valid, false, 'a seal made without our secret');
  assert.equal(makeSealer('guessed-secret').seal('wish', CARD, at) === seal, false);
  for (const junk of [null, 5, '', 's1.wish', 's2.wish.x.' + 'a'.repeat(32), seal + 'x']) assert.equal(s.verify(junk, CARD).valid, false, String(junk));
  assert.throws(() => s.seal('Wish!', CARD, at));
});

test('periods: ISO weeks start Monday 00:00 UTC (incl. week 53 and the turn of the year), months on the 1st', () => {
  assert.deepEqual(weekOf(Date.parse('2026-11-04T12:00:00Z')), { id: '2026-W45', next: Date.parse('2026-11-09T00:00:00Z') });
  assert.equal(weekOf(Date.parse('2026-11-08T23:59:59Z')).id, '2026-W45');
  assert.equal(weekOf(Date.parse('2026-11-09T00:00:00Z')).id, '2026-W46');
  assert.equal(weekOf(Date.parse('2026-01-01T00:00:00Z')).id, '2026-W01');
  assert.equal(weekOf(Date.parse('2027-01-01T00:00:00Z')).id, '2026-W53');
  assert.equal(weekOf(Date.parse('2024-12-30T00:00:00Z')).id, '2025-W01');
  assert.deepEqual(monthOf(Date.parse('2026-12-31T23:00:00Z')), { id: '2026-12', next: Date.parse('2027-01-01T00:00:00Z') });
});

test('entitlement keys: only signed AND listed keys count; the list revokes', () => {
  const S = 'entitlement-secret';
  const pro = mintKey(S, 'pro', 'familie-mueller'), biz = mintKey(S, 'biz', 'acme-gmbh');
  assert.match(pro, /^mdi1\.pro\.familie-mueller\.[A-Za-z0-9_-]{22}$/);
  const e = loadEntitlements({ DUELL_ENTITLEMENT_SECRET: S, DUELL_ENTITLEMENTS: ` ${pro} ,${biz},mdi1.pro.fake.${'A'.repeat(22)},${mintKey('other', 'pro', 'x-y-z')}` });
  assert.deepEqual([...e.map.values()], [{ tier: 'pro', id: 'familie-mueller' }, { tier: 'business', id: 'acme-gmbh' }]);
  assert.equal(e.bad, 2);
  assert.equal(loadEntitlements({ DUELL_ENTITLEMENTS: pro }).map.size, 0, 'no secret, no keys');
  assert.equal(loadEntitlements({ DUELL_ENTITLEMENT_SECRET: S, DUELL_ENTITLEMENTS: biz }).map.has(pro), false, 'off the list = revoked');
  assert.throws(() => mintKey(S, 'gold', 'x-y-z')); assert.throws(() => mintKey('', 'pro', 'abc')); assert.throws(() => mintKey(S, 'pro', 'A B'));
});
