import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { extractDot, renderDot, generateDiagram } from '../lib/diagram.mjs';

const HAVE_DOT = spawnSync('dot', ['-V']).status === 0;
const GOOD = 'digraph { rankdir=LR; "Besucher" -> "Marktplatz" -> "Ergebnis" }';

test('extractDot strips fences and prose', () => {
  assert.equal(extractDot('Hier:\n```dot\n' + GOOD + '\n```\nViel Spaß'), GOOD);
  assert.equal(extractDot('Bitte sehr ' + GOOD), GOOD);
});

test('renderDot: valid DOT -> svg in well under a second', { skip: !HAVE_DOT }, async () => {
  const t = Date.now();
  const r = await renderDot(GOOD);
  assert.ok(r.ok && r.svg.startsWith('<svg'));
  assert.ok(Date.now() - t < 1500);
});

test('renderDot: syntax error -> readable message; file-reading attributes are refused', { skip: !HAVE_DOT }, async () => {
  const bad = await renderDot('digraph { a -> }');
  assert.equal(bad.ok, false); assert.match(bad.error, /syntax/i);
  for (const code of ['digraph { a [image="/etc/passwd"] }', 'digraph { a [URL="javascript:alert(1)"] }', 'digraph { a [shapefile="/etc/hosts"] }']) {
    assert.equal((await renderDot(code)).ok, false, code);
  }
});

test('generateDiagram feeds the dot error back to the LLM and stops after 2 corrections', { skip: !HAVE_DOT }, async () => {
  const prompts = [];
  const llm = async (_s, u) => { prompts.push(u); return prompts.length === 1 ? 'digraph { a -> }' : GOOD; };
  const r = await generateDiagram({ description: 'x', llm });
  assert.ok(r.ok); assert.equal(r.attempts, 2);
  assert.match(prompts[1], /Graphviz meldet/); assert.match(prompts[1], /digraph \{ a -> \}/);

  let calls = 0;
  const r2 = await generateDiagram({ description: 'x', llm: async () => { calls++; return 'digraph { a -> }'; } });
  assert.equal(r2.ok, false); assert.equal(calls, 3);
});

test('generateDiagram stops at once when dot itself is missing (no wasted LLM calls)', async () => {
  let calls = 0;
  const r = await generateDiagram({ description: 'x', llm: async () => { calls++; return GOOD; }, render: async () => ({ ok: false, error: 'dot nicht verfügbar', fatal: true }) });
  assert.equal(r.ok, false); assert.equal(calls, 1);
});

test('words in labels are not attributes: a diagram about URLs, images or targets renders', { skip: !HAVE_DOT }, async () => {
  for (const code of [
    'digraph { a [label="Browser lädt eine URL"]; b [label="Image"]; a -> b [label="Target = Tooltip"] }',
    'digraph { "image" -> "URL" }',
  ]) assert.equal((await renderDot(code)).ok, true, code);
});

test('file-reading and link attributes stay refused in every spelling', { skip: !HAVE_DOT }, async () => {
  for (const code of [
    'digraph { a ["image"="/etc/passwd"] }', 'digraph { a [ image = "/etc/passwd" ] }', 'digraph { graph [imagepath="/etc"]; a }',
    'digraph { a -> b [edgeURL="javascript:alert(1)"] }', 'digraph { a [labelhref="x"] }',
    'digraph { a [label=<<TABLE><TR><TD><IMG SRC="/etc/passwd"/></TD></TR></TABLE>>] }',
  ]) assert.equal((await renderDot(code)).ok, false, code);
});

test('labels follow the page language', async () => {
  let sys = '';
  await generateDiagram({ description: 'x', lang: 'en', llm: async (s) => { sys = s; return GOOD; }, render: async () => ({ ok: true, svg: '<svg/>' }) });
  assert.match(sys, /English/); assert.doesNotMatch(sys, /deutsche/);
});
