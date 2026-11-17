// Security-Review (Wrapper #130-#134) M4 und L4: der Guthaben-Pfad der freien Karte.
//   M4: parallele Anfragen, die nur noch Guthaben haben, reservieren es wie eine Topf-Einheit; nur so viele erreichen das
//       Modell, wie Guthaben da ist (sonst Modellkosten ohne Bezahlung).
//   L4: ein Beleg, der aus Guthaben bezahlt wurde, sagt das selbst (signiert, per CREDIT); Verwerfen nach einem Neustart
//       (frozen ist nur im Speicher) geht zurueck ins Guthaben, nie in den Topf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';
import { MOD_SYSTEM } from '../lib/duell-karte.mjs';

const DEV = '0123456789abcdef0123456789abcdef';
function slowLlm(ms = 30) {
  const calls = [];
  return { calls, configured: true, async generate(req) {
    calls.push(req.system === MOD_SYSTEM ? 'mod' : 'card');
    await new Promise((ok) => setTimeout(ok, ms));
    if (req.system === MOD_SYSTEM) return { json: { risk: 0, cats: [], drink: 'none' }, stop: 'end_turn', usage: { out: 8 } };
    return { json: { ok: true, title: 'Sonnenblumen-Tag', x: 'Alles Gute! Du bringst Sonne in jeden Tag.', st: 'herz', palette: 0, stickers: ['🌻'] }, stop: 'end_turn', usage: { out: 60 } };
  } };
}
/** Guthaben wie lib/duell-credit.mjs (available/spend/refund), im Speicher, ueber Neustarts geteilt */
function memCredit(start) {
  const book = new Map();
  return { book, available: (k) => (book.has(k) ? book.get(k) : start), spend(k, n = 1) { const a = this.available(k); if (a < n) return false; book.set(k, a - n); return true; }, refund(k, n = 1) { book.set(k, this.available(k) + n); return true; } };
}
function mk({ credit, file, llm = slowLlm() }) {
  const d = createDuell({ env: { DUELL_DAILY_MAX: '200', DUELL_SEAL_SECRET: 'seal', DUELL_LLM_PARALLEL: '8' }, salt: 's', log: () => {}, llm: async () => '{}' });
  d.shared.age16 = () => true; d.shared.age18 = () => false; d.shared.credit = credit;
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x', DUELL_AI_PROOF_BITS: '0', DUELL_CREATE_FREE: '0', DUELL_AI_STATE_FILE: file }, llm: async () => '{}', cardLlm: llm, shared: d.shared, auth: { mode: 'gate', identify: async () => ({ email: 'lea@example.org' }) }, log: () => {} });
  return { ai, llm };
}
const body = (text) => ({ kind: 'karte', input: { text, art: 'card' }, device: DEV, lang: 'de' });
const run = async (ai, b) => ai.act(b, await ai.who({}, b), null);

test('M4: Guthaben 1, fuenf parallele Anfragen -> genau eine erreicht das Modell, vier sofort quota ohne Modellaufruf', async () => {
  const credit = memCredit(1), { ai, llm } = mk({ credit, file: join(mkdtempSync(join(tmpdir(), 'ai-m4-')), 'ai.json') });
  const rs = await Promise.all(['Sonnenblumen', 'Frosch im All', 'Danke Team', 'Gute Besserung', 'Viel Glueck'].map((t) => run(ai, body('Geburtstagskarte ' + t))));
  const ok = rs.filter((r) => r.status === 200 && r.body.options && r.body.options.length), quota = rs.filter((r) => r.status === 429 && r.body.error === 'quota');
  assert.equal(ok.length, 1, rs.map((r) => r.status + ':' + (r.body.error || 'ok')).join(' '));
  assert.equal(quota.length, 4);
  assert.equal(llm.calls.filter((c) => c === 'card').length, 1, 'nur eine Karte wurde beim Modell bestellt');
  assert.equal(ok[0].body.credit, true);
  // nach der Antwort ist die Reservierung weg: verwerfen gibt das Guthaben zurueck, dann geht wieder genau eine
  const p = await ai.who({}, body('x'));
  assert.equal(ai.close(p, ok[0].body.receipt, 'discard').body.refunded, 1);
  const again = await Promise.all(['Eins', 'Zwei'].map((t) => run(ai, body('Geburtstagskarte ' + t))));
  assert.deepEqual(again.map((r) => r.status).sort(), [200, 429]);
});

test('L4: aus Guthaben bezahlt, Neustart (frozen leer), Verwerfen -> zurueck ins Guthaben, der Topf bleibt unberuehrt', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ai-l4-')), 'ai.json'), credit = memCredit(2);
  const a = mk({ credit, file });
  const r = await run(a.ai, body('Geburtstagskarte mit Sonnenblumen'));
  assert.equal(r.status, 200); assert.equal(r.body.credit, true);
  assert.match(r.body.receipt, /\.0000-CR\./, 'der Beleg sagt selbst, dass er aus Guthaben bezahlt ist');
  const p = await a.ai.who({}, body('x')), key = p.key, before = credit.available(key), potBefore = a.ai.meter(await a.ai.who({}, body('x'))).remaining;
  // Neustart: neue Instanz mit demselben Salz und derselben Datei, frozen ist leer
  const b = mk({ credit, file });
  const pb = await b.ai.who({}, body('x'));
  const d = b.ai.close(pb, r.body.receipt, 'discard');
  assert.equal(d.status, 200); assert.equal(d.body.credit, true); assert.equal(d.body.refunded, 1);
  assert.equal(credit.available(key), before + 1, 'Guthaben zurueck');
  assert.equal(b.ai.meter(pb).remaining, potBefore, 'kein Topf-Rueckbuchen');
  assert.equal(b.ai.close(pb, r.body.receipt, 'discard').body.already, true, 'nie zweimal');
  // ein gefaelschter CR-Beleg (falsche Signatur) wird abgelehnt
  const forged = r.body.receipt.replace(/\.[A-Za-z0-9_-]{22}$/, '.' + 'A'.repeat(22));
  assert.equal(b.ai.close(pb, forged, 'discard').status, 400);
});
