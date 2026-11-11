// My Daily Idea, Code-Modus: the static check of a game module the model wrote, and its instrumentation.
//
//   checkCode(src) -> { ok: true, code, size, names } | { ok: false, errors: [short German-free English reasons, for the repair turn] }
//
// The code is parsed (acorn, vendored, lib/vendor/acorn) as a strict module and walked against an ALLOWLIST of syntax: plain
// functions, arrows, const/let, if/for/while/switch, literals, arrays, objects, destructuring. Everything that could reach
// outside the game or make two devices disagree is refused: this, new, class, import/export, async/await/yield, generators,
// try/catch (would swallow the budget), throw, labels, regex literals (ReDoS), BigInt, tagged templates, getters/setters,
// for-in, `in`, `instanceof`, `**`, var. Every name must resolve lexically to a declaration of the module itself or to a short
// list of globals, each only in its allowed shape (Math.floor(...) yes, `const M = Math` no; Math.random/sin/pow never:
// their last bit differs between engines, the state hash would split). Property names on the denylist (constructor,
// __proto__, prototype, call, apply, bind, toString, valueOf, toLocale*, then, repeat, pad*, defineProperty ...) are refused
// statically; computed access `a[b]` is wrapped as `a[__k(b)]`, which throws at run time for the same names and for anything
// that is not a number or string. Names starting with "__" belong to the harness.
//
// Instrumentation (the code that is stored, signed and run is the instrumented code, on the server and in the app alike):
//   every loop body starts with __g()        (op budget per host call, the same count everywhere: deterministic)
//   every function body runs inside __in() / try { ... } finally { __out() }   (depth budget: no engine-specific stack limit)
//   every computed key goes through __k()
// Together with the sandbox (no eval: CSP without 'unsafe-eval' in the app, codeGeneration off on the server) this is the
// second wall, not the only one.

import { createRequire } from 'node:module';
import { Parser } from '../vendor/acorn/acorn.mjs';

const SDK = createRequire(import.meta.url)('./sdk.js');

export const MAX_BYTES = 12 * 1024;
export const DENY_PROPS = new Set(SDK.DENY_KEYS);
// global -> where it may stand: member: allowed property names (only as obj.prop), call: may be called directly, value: may be read
export const GLOBALS = {
  Math: { member: ['floor', 'ceil', 'round', 'abs', 'min', 'max', 'sign', 'trunc', 'sqrt', 'imul', 'PI', 'E', 'SQRT2'] },
  Object: { member: ['keys', 'values', 'entries', 'assign', 'freeze'] },
  Array: { member: ['isArray'] },
  JSON: { member: ['stringify', 'parse'] },
  Number: { member: ['isInteger', 'isFinite', 'MAX_SAFE_INTEGER', 'MIN_SAFE_INTEGER'], call: true },
  SDK: { member: ['range', 'grid', 'clamp', 'W', 'H'] },
  String: { call: true }, Boolean: { call: true }, isFinite: { call: true }, isNaN: { call: true }, parseInt: { call: true }, parseFloat: { call: true },
  Infinity: { value: true }, NaN: { value: true }, undefined: { value: true },
};
const CONTRACT = ['meta', 'init', 'step', 'view', 'status'];
const OPTIONAL = ['moves'];

const kOk = (s) => typeof s === 'string' && !DENY_PROPS.has(s) && !s.startsWith('__');

/** The run-time half (lib/code/sdk.js guardSource, wrapGame): the same text runs on the server and in the app. */
export const wrapForRun = (code) => SDK.wrapGame(code);

export function checkCode(src) {
  const errors = [];
  const err = (node, msg) => { if (errors.length < 12) errors.push(msg + (node && node.start !== undefined ? ` (at ${lineOf(src, node.start)})` : '')); };
  if (typeof src !== 'string' || !src.trim()) return { ok: false, errors: ['empty code'] };
  const size = Buffer.byteLength(src, 'utf8');
  if (size > MAX_BYTES) return { ok: false, errors: [`code too long: ${size} bytes, at most ${MAX_BYTES}`] };
  if (/\\u\{?[0-9a-fA-F]/.test(src.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""'))) return { ok: false, errors: ['unicode escapes outside strings are not allowed'] };
  let ast;
  try { ast = Parser.parse(src, { ecmaVersion: 2022, sourceType: 'module', allowHashBang: false, preserveParens: true }); }
  catch (e) { return { ok: false, errors: ['syntax error: ' + String(e.message).slice(0, 120)] }; }

  const edits = [];   // { pos, text, end: bool, depth }
  const ins = (pos, text, depth, end) => edits.push({ pos, text, depth, end });

  // ---- scopes ---------------------------------------------------------------------------------------------------------
  const scopes = [];
  const declared = (name) => scopes.some((s) => s.has(name));
  function declarePattern(p, scope) {
    if (!p) return;
    if (p.type === 'Identifier') { if (p.name.startsWith('__') || GLOBALS[p.name] || p.name === 'eval' || p.name === 'arguments') err(p, `name "${p.name}" is reserved`); scope.add(p.name); }
    else if (p.type === 'ArrayPattern') p.elements.forEach((e) => declarePattern(e, scope));
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => declarePattern(q.type === 'RestElement' ? q.argument : q.value, scope));
    else if (p.type === 'AssignmentPattern') declarePattern(p.left, scope);
    else if (p.type === 'RestElement') declarePattern(p.argument, scope);
    else err(p, `pattern ${p.type} is not allowed`);
  }
  function hoist(stmts, scope) {
    for (const s of stmts) {
      if (s.type === 'VariableDeclaration') s.declarations.forEach((d) => declarePattern(d.id, scope));
      else if (s.type === 'FunctionDeclaration' && s.id) declarePattern(s.id, scope);
    }
  }

  // ---- the walk ---------------------------------------------------------------------------------------------------------
  let depth = 0;
  function fn(node) {
    if (node.async || node.generator) err(node, 'async functions and generators are not allowed');
    const scope = new Set();
    scopes.push(scope);
    if (node.type === 'FunctionExpression' && node.id) declarePattern(node.id, scope);
    node.params.forEach((p) => declarePattern(p, scope));
    node.params.forEach((p) => walkPattern(p));
    depth++;
    if (node.body.type === 'BlockStatement') {
      ins(node.body.start + 1, '__in();try{', depth, false);
      ins(node.body.end - 1, '}finally{__out();}', depth, true);
      block(node.body.body);
    } else {
      ins(node.body.start, '{__in();try{return (', depth, false);
      ins(node.body.end, ');}finally{__out();}}', depth, true);
      expr(node.body);
    }
    depth--;
    scopes.pop();
  }
  function block(stmts) { const scope = new Set(); scopes.push(scope); hoist(stmts, scope); stmts.forEach(stmt); scopes.pop(); }
  function loopBody(body) {
    depth++;
    if (body.type === 'BlockStatement') { ins(body.start + 1, '__g();', depth, false); stmt(body); }
    else { ins(body.start, '{__g();', depth, false); ins(body.end, '}', depth, true); stmt(body); }
    depth--;
  }
  function walkPattern(p) {
    if (!p) return;
    if (p.type === 'AssignmentPattern') { walkPattern(p.left); expr(p.right); }
    else if (p.type === 'ArrayPattern') p.elements.forEach(walkPattern);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => { if (q.type === 'RestElement') walkPattern(q.argument); else { propKey(q); walkPattern(q.value); } });
    else if (p.type === 'RestElement') walkPattern(p.argument);
  }
  function propKey(q) {
    if (q.computed) { ins(q.key.start, '__k(', depth + 1, false); ins(q.key.end, ')', depth + 1, true); expr(q.key); return; }
    const name = q.key.type === 'Identifier' ? q.key.name : String(q.key.value);
    if (!kOk(name)) err(q.key, `property name "${name}" is not allowed`);
  }
  function stmt(s) {
    switch (s.type) {
      case 'VariableDeclaration':
        if (s.kind === 'var') err(s, 'use const or let, not var');
        s.declarations.forEach((d) => { walkPattern(d.id); if (d.init) expr(d.init); });
        return;
      case 'FunctionDeclaration': fn(s); return;
      case 'ExpressionStatement': if (s.directive && s.directive !== 'use strict') err(s, 'directive not allowed'); expr(s.expression); return;
      case 'ReturnStatement': if (s.argument) expr(s.argument); return;
      case 'IfStatement': expr(s.test); stmt(s.consequent); if (s.alternate) stmt(s.alternate); return;
      case 'BlockStatement': block(s.body); return;
      case 'EmptyStatement': return;
      case 'BreakStatement': case 'ContinueStatement': if (s.label) err(s, 'labels are not allowed'); return;
      case 'ForStatement': {
        const scope = new Set(); scopes.push(scope);
        if (s.init) { if (s.init.type === 'VariableDeclaration') { hoist([s.init], scope); stmt(s.init); } else expr(s.init); }
        if (s.test) expr(s.test); if (s.update) expr(s.update);
        loopBody(s.body); scopes.pop(); return;
      }
      case 'ForOfStatement': {
        if (s.await) err(s, 'for await is not allowed');
        const scope = new Set(); scopes.push(scope);
        if (s.left.type === 'VariableDeclaration') { hoist([s.left], scope); stmt(s.left); } else expr(s.left);
        expr(s.right); loopBody(s.body); scopes.pop(); return;
      }
      case 'WhileStatement': expr(s.test); loopBody(s.body); return;
      case 'DoWhileStatement': loopBody(s.body); expr(s.test); return;
      case 'SwitchStatement': expr(s.discriminant); { const scope = new Set(); scopes.push(scope); s.cases.forEach((c) => hoist(c.consequent, scope)); s.cases.forEach((c) => { if (c.test) expr(c.test); c.consequent.forEach(stmt); }); scopes.pop(); } return;
      default: err(s, `${s.type.replace(/Statement|Declaration/, '').toLowerCase() || s.type} is not allowed`);
    }
  }
  function ident(node, how) {
    const n = node.name;
    if (n.startsWith('__')) return err(node, `name "${n}" is reserved`);
    if (declared(n)) return;
    const g = GLOBALS[n];
    if (!g) return err(node, `unknown name "${n}" (no globals: no window, document, fetch, timers, eval, Function)`);
    if (how === 'member' && g.member) return;
    if (how === 'call' && g.call) return;
    if (how === 'value' && g.value) return;
    err(node, `"${n}" may only be used as ${g.member ? n + '.<allowed>' : g.call ? n + '(...)' : 'a value'}`);
  }
  function member(e, how) {
    if (e.object.type === 'Super') return err(e, 'super is not allowed');
    if (e.computed) {
      if (e.object.type === 'Identifier' && !declared(e.object.name)) return err(e, `computed access on "${e.object.name}" is not allowed`);
      ins(e.property.start, '__k(', depth + 1, false); ins(e.property.end, ')', depth + 1, true);
      expr(e.object); expr(e.property); return;
    }
    const p = e.property.type === 'PrivateIdentifier' ? '#' : e.property.name;
    if (!kOk(p)) return err(e.property, `property "${p}" is not allowed`);
    if (e.object.type === 'Identifier' && !declared(e.object.name) && GLOBALS[e.object.name]) {
      const g = GLOBALS[e.object.name];
      if (how === 'assign') return err(e, `${e.object.name}.${p} cannot be changed`);
      if (!g.member || !g.member.includes(p)) return err(e, `${e.object.name}.${p} is not allowed${e.object.name === 'Math' ? ' (only floor, ceil, round, abs, min, max, sign, trunc, sqrt, imul; randomness comes from rng)' : ''}`);
      return;
    }
    if (how === 'assign' && e.object.type === 'MemberExpression' && e.object.object.type === 'Identifier' && GLOBALS[e.object.object.name] && !declared(e.object.object.name)) return err(e, `${e.object.object.name} cannot be changed`);
    expr(e.object);
  }
  function expr(e) {
    if (!e) return;
    switch (e.type) {
      case 'Identifier': ident(e, 'value'); return;
      case 'Literal':
        if (e.regex) err(e, 'regular expressions are not allowed');
        if (e.bigint !== undefined) err(e, 'BigInt is not allowed');
        return;
      case 'TemplateLiteral': e.expressions.forEach(expr); return;
      case 'ArrayExpression': e.elements.forEach((x) => x && expr(x)); return;
      case 'ObjectExpression':
        e.properties.forEach((q) => {
          if (q.type === 'SpreadElement') return expr(q.argument);
          if (q.kind !== 'init') return err(q, 'getters and setters are not allowed');
          propKey(q);
          if (q.method || q.value.type === 'FunctionExpression' || q.value.type === 'ArrowFunctionExpression') fn(q.value);
          else if (q.shorthand) ident(q.value, 'value');
          else expr(q.value);
        });
        return;
      case 'SpreadElement': expr(e.argument); return;
      case 'FunctionExpression': case 'ArrowFunctionExpression': fn(e); return;
      case 'UnaryExpression': case 'UpdateExpression':
        if (e.argument.type === 'MemberExpression' && (e.type === 'UpdateExpression' || e.operator === 'delete')) member(e.argument, 'assign');
        else if (e.type === 'UpdateExpression' && e.argument.type === 'Identifier' && !declared(e.argument.name)) err(e.argument, `assignment to undeclared "${e.argument.name}"`);
        else expr(e.argument);
        return;
      case 'BinaryExpression':
        if (e.operator === '**' || e.operator === 'in' || e.operator === 'instanceof') err(e, `operator "${e.operator}" is not allowed`);
        expr(e.left); expr(e.right); return;
      case 'LogicalExpression': expr(e.left); expr(e.right); return;
      case 'AssignmentExpression':
        if (e.operator === '**=') err(e, 'operator "**=" is not allowed');
        if (e.left.type === 'Identifier') { if (!declared(e.left.name)) err(e.left, `assignment to undeclared "${e.left.name}"`); }
        else if (e.left.type === 'MemberExpression') member(e.left, 'assign');
        else walkPattern(e.left);
        expr(e.right); return;
      case 'ConditionalExpression': expr(e.test); expr(e.consequent); expr(e.alternate); return;
      case 'CallExpression':
        if (e.callee.type === 'Identifier') ident(e.callee, 'call');
        else if (e.callee.type === 'MemberExpression') member(e.callee, 'call');
        else expr(e.callee);
        e.arguments.forEach(expr); return;
      case 'MemberExpression': member(e, 'value'); return;
      case 'ChainExpression': expr(e.expression); return;
      case 'SequenceExpression': e.expressions.forEach(expr); return;
      case 'ParenthesizedExpression': expr(e.expression); return;
      default: err(e, `${e.type.replace(/Expression$/, '').toLowerCase()} is not allowed`);
    }
  }

  // ---- top level: declarations only, and const GAME = { meta, init, step, view, status, moves? } -------------------------
  const top = new Set(); scopes.push(top);
  hoist(ast.body, top);
  let game = null;
  for (const s of ast.body) {
    if (s.type === 'ExpressionStatement' && s.directive === 'use strict') continue;
    if (s.type !== 'VariableDeclaration' && s.type !== 'FunctionDeclaration') { err(s, 'top level may only declare const/let/function'); continue; }
    if (s.type === 'VariableDeclaration') for (const d of s.declarations) if (d.id.type === 'Identifier' && d.id.name === 'GAME') { if (s.kind !== 'const' || !d.init || d.init.type !== 'ObjectExpression') err(d, 'GAME must be `const GAME = { ... }`'); else game = d.init; }
    stmt(s);
  }
  if (!game) err(null, 'no `const GAME = { meta, init, step, view, status }`');
  else {
    const keys = game.properties.filter((q) => q.type === 'Property' && !q.computed).map((q) => (q.key.type === 'Identifier' ? q.key.name : String(q.key.value)));
    for (const k of CONTRACT) if (!keys.includes(k)) err(game, `GAME.${k} is missing`);
    for (const k of keys) if (!CONTRACT.includes(k) && !OPTIONAL.includes(k)) err(game, `GAME.${k} is not part of the contract`);
  }
  if (errors.length) return { ok: false, errors };

  // apply the edits from the end; at the same place: closing texts of inner nodes first, opening texts of outer nodes first
  edits.sort((a, b) => b.pos - a.pos || (a.end === b.end ? (a.end ? a.depth - b.depth : b.depth - a.depth) : a.end ? 1 : -1));
  let out = src;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  // the instrumented code must still parse (a bug here must never ship code)
  try { Parser.parse(out, { ecmaVersion: 2022, sourceType: "module" }); } catch (e) { return { ok: false, errors: ["internal: instrumentation broke the code (" + String(e.message).slice(0, 80) + ")"], code: out }; }
  return { ok: true, code: out, size };
}

function lineOf(src, pos) { return 'line ' + (src.slice(0, pos).split('\n').length); }
