// /d/diagram, "draw it yourself": Graphviz (WebAssembly, from this origin) turns the typed text into an SVG.
// Nothing is sent anywhere; there is no fetch to an API in this file.
import { toDot, isForbiddenDot } from './diagram-browser-core.mjs';

const box = document.getElementById('bd');
const S = JSON.parse(document.getElementById('bd-strings').textContent);
const $ = (id) => document.getElementById(id);
const max = Number(box.dataset.max);
let gv = null;

function show(kind, msg) {
  $('bd-err').hidden = kind !== 'err'; $('bd-ok').hidden = kind !== 'ok';
  if (kind === 'err') $('bd-err').textContent = msg;
  if (kind === 'ok') $('bd-ok').textContent = msg;
}

async function draw() {
  const code = toDot($('bd-src').value);
  $('bd-img').hidden = true; $('bd-dl').hidden = true;
  if (!code) return show('err', S.empty);
  if (code.length > max) return show('err', S.toolong);
  if (isForbiddenDot(code)) return show('err', S.forbidden);
  show('ok', S.busy);
  try {
    if (!gv) gv = await (await import(box.dataset.src)).Graphviz.load();
  } catch { return show('err', S.load); }
  let svg;
  try { svg = gv.dot(code); } catch (e) { return show('err', S.fail.replace('{msg}', String(e && e.message || e).split('\n')[0])); }
  svg = svg.slice(svg.indexOf('<svg')).replace(/<a\b[^>]*>|<\/a>/g, '');
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  $('bd-img').src = url; $('bd-img').hidden = false;
  $('bd-dl').href = url; $('bd-dl').hidden = false;
  show('ok', S.done);
}
$('bd-go').addEventListener('click', draw);
