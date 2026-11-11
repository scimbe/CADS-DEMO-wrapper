// Code-Modus, the static check (lib/code/check.mjs): the reference games pass, everything that reaches outside the game or
// splits two devices is refused before anything runs. The instrumentation keeps the code valid and puts the budgets in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkCode, MAX_BYTES } from '../lib/code/check.mjs';
import { runtime } from '../lib/code/play.mjs';
import { REFERENCE } from '../lib/duell-code.mjs';

const GAME = (body = '', extra = '') => `${extra}
const GAME = {
  meta: { title: 'T', players: { min: 1, max: 1 }, mode: 'turn', inputs: ['tap'] },
  init(rng, params, players) { return { n: 0 }; },
  step(s, input, rng) { ${body} return s; },
  view(s, seat) { return [{ o: 'text', x: 10, y: 10, s: 'x' }]; },
  status(s) { return { over: s.n > 3, score: [s.n], winner: null }; },
};`;
const refused = (src, re) => { const r = checkCode(src); assert.equal(r.ok, false, 'must be refused: ' + src.slice(0, 80)); if (re) assert.match(r.errors.join(' | '), re); return r.errors; };

test('die Referenzspiele bestehen die Prüfung und laufen instrumentiert', () => {
  for (const [name, src] of Object.entries(REFERENCE)) {
    const r = checkCode(src);
    assert.equal(r.ok, true, name + ': ' + (r.errors || []).join('; '));
    assert.match(r.code, /__g\(\);/); assert.match(r.code, /__in\(\);try\{/); assert.match(r.code, /finally\{__out\(\);\}/);
    assert.ok(runtime(r.code).meta.title);
  }
});

test('keine Globals: fetch, eval, Function, import, globalThis, window, document, Timer, Date, console, Proxy, Reflect', () => {
  for (const [code, re] of [
    ["fetch('https://x');", /unknown name "fetch"/], ["eval('1');", /eval|unknown name/], ["Function('return 1')();", /Function|unknown name/],
    ["import('x');", /import|syntax/], ["globalThis.x = 1;", /globalThis|unknown name/], ["window.top;", /window|unknown name/],
    ["document.cookie;", /document|unknown name/], ['setTimeout(() => 1, 1);', /setTimeout/], ['Date.now();', /Date/], ["console.log('x');", /console/],
    ['new Proxy({}, {});', /new|Proxy/], ['Reflect.ownKeys({});', /Reflect/], ['WebAssembly.compile;', /WebAssembly/], ['localStorage.x;', /localStorage/],
    ['postMessage(1);', /postMessage/], ['SharedArrayBuffer;', /SharedArrayBuffer/], ['Atomics.wait;', /Atomics/],
  ]) refused(GAME(code), re);
  refused("import x from 'y';\n" + GAME(), /import|top level/);
  refused(GAME() + '\nexport default GAME;', /export|top level/);
});

test('Prototyp-Tricks: constructor, __proto__, prototype, call/apply/bind, berechnete Schlüssel zur Laufzeit', () => {
  refused(GAME("[].constructor.constructor('return this')();"), /constructor/);
  refused(GAME('s.__proto__.x = 1;'), /__proto__/);
  refused(GAME('Object.prototype.x = 1;'), /prototype|cannot be changed/);
  refused(GAME('const p = s.prototype;'), /prototype/);
  refused(GAME('s.f.call(null);'), /call/);
  refused(GAME('const o = { toString() { return 1; } };'), /toString/);
  refused(GAME('const __x = 1;'), /reserved/);
  refused(GAME('__g = null;'), /reserved|undeclared "__g"/);
  refused(GAME('Object.defineProperty(s, "x", {});'), /defineProperty|Object\.defineProperty/);
  // a computed key is allowed, but goes through __k at run time: the forbidden names throw there
  const ok = checkCode(GAME("const k = 'constr' + 'uctor'; const f = s[k]; s.n += 1;"));
  assert.equal(ok.ok, true);
  assert.match(ok.code, /s\[__k\(k\)\]/);
  const rt = runtime(ok.code);
  rt.start(1, {}, 1);
  assert.throws(() => rt.apply({ seat: 0, t: 'tap', x: 1, y: 1 }), /bad-key/);
  const lit = checkCode(GAME("const o = { ['__proto__']: 1 }; s.n += 1;"));
  assert.equal(lit.ok, true);
  const rt2 = runtime(lit.code); rt2.start(1, {}, 1);
  assert.throws(() => rt2.apply({ seat: 0, t: 'tap', x: 1, y: 1 }), /bad-key/);
});

test('Syntax außerhalb der Liste: this, new, class, with, try/catch, throw, Regex, var, Label, Getter, for-in, in, instanceof, **, async, Generator, BigInt, Tagged Template', () => {
  for (const [code, re] of [
    ['const a = this;', /this/], ['const a = new Array(5);', /new/], ['class A {}', /class/], ['with (s) {}', /with|syntax/],
    ['try { s.n++; } catch (e) {}', /try/], ["throw 'x';", /throw/], ['const r = /a+/;', /regular/], ['var a = 1;', /var/],
    ['l: for (;;) { break l; }', /label/], ['const o = { get x() { return 1; } };', /getter/], ['for (const k in s) {}', /forin|for-in|is not allowed/],
    ["const b = 'n' in s;", /"in"/], ['const b = s instanceof Object;', /instanceof|Object/], ['const b = 2 ** 3;', /\*\*/],
    ['const f = async () => 1;', /async/], ['function* g() {}', /generator/], ['const b = 10n;', /BigInt/], ['const t = String.raw`x`;', /raw|tagged/],
    ['debugger;', /debugger/],
  ]) refused(GAME(code), re);
});

test('Mathe nur exakt und Zufall nur aus rng: Math.random/sin/pow verboten, kein Alias, keine Änderung an Math', () => {
  refused(GAME('const r = Math.random();'), /Math\.random/);
  refused(GAME('const r = Math.sin(1);'), /Math\.sin/);
  refused(GAME('const r = Math.pow(2, 3);'), /Math\.pow/);
  refused(GAME('const M = Math;'), /Math/);
  refused(GAME('Math.floor = (x) => x;'), /cannot be changed/);
  refused(GAME('delete Math.floor;'), /cannot be changed/);
  assert.equal(checkCode(GAME('s.n = Math.floor(s.n + rng.int(3) / 2) + 1;')).ok, true);
});

test('Namen werden lexikalisch aufgelöst: ein Parameter namens fetch macht fetch woanders nicht erlaubt', () => {
  refused(GAME('', "function a(fetch) { return fetch; }\nfunction b() { return fetch('x'); }"), /unknown name "fetch"/);
  assert.equal(checkCode(GAME('', 'function a(fetch) { return fetch; }')).ok, true);
  refused(GAME('', 'function a() { let q = 1; } function b() { return q; }'), /unknown name "q"/);
  refused(GAME('t = 1;'), /undeclared "t"/);
  refused(GAME('', 'const \\u0065val = 1;'), /unicode/);
});

test('Vertrag und Größe: GAME mit init/step/view/status, nichts anderes oben, höchstens 12 KB', () => {
  refused('const X = 1;', /no `const GAME/);
  refused('const GAME = { meta: {}, init() {}, step() {} };', /GAME\.view is missing/);
  refused(GAME().replace('status(s)', 'other(s)'), /GAME\.status is missing|not part of the contract/);
  refused(GAME() + '\ns.n;', /top level/);
  refused(GAME() + '\n// ' + 'x'.repeat(MAX_BYTES), /too long/);
});

test('die Instrumentierung bricht keinen gültigen Code (Pfeil mit Objekt, verschachtelte Schleifen ohne Klammern)', () => {
  const r = checkCode(GAME('for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) s.n += 0; const f = (a) => ({ a }); const g = (a) => (b) => a + b; s.n = g(s.n)(1) + f(0).a;'));
  assert.equal(r.ok, true, (r.errors || []).join());
  const rt = runtime(r.code); rt.start(1, {}, 1);
  assert.equal(rt.apply({ seat: 0, t: 'tap', x: 1, y: 1 }).status.score[0], 1);
});

test('das SDK ist in App und Server dasselbe (SHA-256 gepinnt; apps/duell-web/src/code-sdk.js muss dieselben Bytes haben)', () => {
  const h = createHash('sha256').update(readFileSync(new URL('../lib/code/sdk.js', import.meta.url))).digest('hex');
  const pinned = readFileSync(new URL('./fixtures/code-sdk.sha256', import.meta.url), 'utf8').trim();
  assert.equal(h, pinned, 'lib/code/sdk.js changed: copy it to the app (src/code-sdk.js) and update test/fixtures/code-sdk.sha256');
});
