import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { patchParser, patchGuard, germanizeReport, reportConfigPatch, readRunOutcome } from '../lib/newsletter.mjs';

// The two functions of the signed bundle, as they ship (manifests/newsletter/bundle.tar.gz).
const bundle = mkdtempSync(join(tmpdir(), 'nl-'));
execFileSync('tar', ['xzf', new URL('../manifests/newsletter/bundle.tar.gz', import.meta.url).pathname, '-C', bundle, 'src/llm_narrative.py', 'src/narrative_guard.py']);
const PY = spawnSync('python3', ['--version']).status === 0;
const parser = readFileSync(join(bundle, 'src/llm_narrative.py'), 'utf8');
const guard = readFileSync(join(bundle, 'src/narrative_guard.py'), 'utf8');
const body = (src, start) => src.slice(src.indexOf(start));
function py(code) {
  const r = spawnSync('python3', ['-I', '-c', code], { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr };
}
const parseWith = (src, reply) => {
  const fn = body(src, 'def _parse_reply').split('\n\n\n')[0];
  writeFileSync(join(bundle, 'p.py'), `import json\n${fn}\n`);
  return py(`import sys;sys.path.insert(0,${JSON.stringify(bundle)});import p,json;print(json.dumps(p._parse_reply(${JSON.stringify(reply)})))`);
};

test('the model writes "narr"/"narrual" for the key: its text is used instead of the fallback', { skip: !PY }, () => {
  for (const reply of ['{"selected_highlight_ids":["a"],"narr":"Text."}', '{"selected_highlight_ids":["a"],"narrual":"Text."}', '{"selected_highlight_ids":["a"],"narrative":"Text."}']) {
    const r = parseWith(patchParser(parser), reply);
    assert.ok(r.ok, r.err); assert.deepEqual(JSON.parse(r.out), [['a'], 'Text.']);
  }
  assert.equal(parseWith(parser, '{"selected_highlight_ids":["a"],"narr":"Text."}').ok, false, 'unpatched bundle fails on this reply');
  assert.equal(parseWith(patchParser(parser), '{"selected_highlight_ids":["a"]}').ok, false, 'no text at all stays a failure');
});

const guardRun = (src, text) => {
  writeFileSync(join(bundle, 'g.py'), src);
  const facts = { days: [{ date: '2026-10-31', tmax: 12.0, tmin: 8.3, precip_mm: 2.1, wind_max_kmh: 11.8 }], highlights: [] };
  return JSON.parse(py(`import sys,json;sys.path.insert(0,${JSON.stringify(bundle)});import g;print(json.dumps(g.check_narrative(${JSON.stringify(text)},json.loads(${JSON.stringify(JSON.stringify(facts))})).ok))`).out);
};
test('guard reads German decimals: 11,8 is one number, an invented 31,10 is caught', { skip: !PY }, () => {
  const fixed = patchGuard(guard);
  assert.equal(guardRun(fixed, 'Wind bis 11,8 km/h, 12,0 Grad, 2,1 mm.'), true);
  assert.equal(guardRun(fixed, 'Es werden 31,10 Grad.'), false);
  assert.equal(guardRun(guard, 'Es werden 31,10 Grad.'), true, 'unpatched: 31 and 10 pass as day and month');
});

test('unexpected bundle source is reported, not silently skipped', () => {
  assert.equal(patchParser('x'), null); assert.equal(patchGuard('x'), null);
  assert.equal(patchParser(patchParser(parser)), null); assert.equal(patchGuard(patchGuard(guard)), null);
});

const FALLBACK_HTML = `<html lang="en"><h1>Bremen 5-Day Weather Briefing</h1><h2>This Week at a Glance</h2>Coldest night
<p>This week&#39;s briefing highlights the warmest day of 12.0°C and the coldest night of 6.0°C.</p>
the narrative text above was written by
  <code>m (fallback template, guard failed)</code> selecting and phrasing these figures under an enforced facts-only guard
  &mdash; note: the LLM output failed the guard on this run, so the narrative
  above is the deterministic fallback sentence, not model-written prose.`;
test('German report: no English left, and a fallback never claims the model wrote it', () => {
  const h = germanizeReport(FALLBACK_HTML);
  for (const en of ['Coldest', 'This week', 'warmest', 'failed', 'fallback', 'Weather Briefing', 'written by', 'geschrieben von', 'Glance']) assert.ok(!h.includes(en), en);
  assert.match(h, /Wetter-Briefing Bremen \(5 Tage\)/);
  assert.match(h, /Ersatzsatz/); assert.match(h, /wärmster Tag: 12\.0°C/);
});

test('report config: country and period belong to the chosen place and length', () => {
  const y = 'location:\n  name: "Hamburg, DE"\n  latitude: 53.5\n  longitude: 9.9\n  timezone: "Europe/Berlin"\nforecast:\n  days: 7\noutput:\n  report_title: "Hamburg Weekly Weather Briefing"\n';
  const out = reportConfigPatch(y, { location: 'Wien', coords: [48.2, 16.37, 'Europe/Vienna'], days: 5 });
  assert.match(out, /name: "Wien, AT"/); assert.match(out, /days: 5/); assert.match(out, /report_title: "Wien 5-Day Weather Briefing"/);
  assert.match(reportConfigPatch(y, { location: 'Zürich', coords: [47.4, 8.5, 'Europe/Zurich'] }), /name: "Zürich, CH"[\s\S]*Zürich Weekly/);
  assert.match(reportConfigPatch(y, { days: 7 }), /Hamburg Weekly/);
  assert.match(reportConfigPatch(y, { days: 3 }), /Hamburg 3-Day/);
});

test('readRunOutcome tells a model text from the fallback, and a missing manifest from both', () => {
  const d = mkdtempSync(join(tmpdir(), 'nlr-'));
  assert.deepEqual(readRunOutcome(d), { known: false, fallback: false, reason: '' });
  writeFileSync(join(d, 'run-manifest.json'), JSON.stringify({ llm_fallback_used: true, guard_reason: 'x' }));
  assert.deepEqual(readRunOutcome(d), { known: true, fallback: true, reason: 'x' });
  writeFileSync(join(d, 'run-manifest.json'), JSON.stringify({ llm_fallback_used: false, guard_reason: 'ok' }));
  assert.equal(readRunOutcome(d).fallback, false);
  assert.ok(!existsSync(join(d, 'nope')));
});
