// "Eigene Angaben": the browser half of the signed prompt-template builder (ES module, no build step).
//
//  1. fetch the template exactly as the server stores it,
//  2. verify its signature HERE with the vendored wasm (the same code the server re-runs),
//  3. show who signed it, until when, and which components (with digests) it may use,
//  4. build the form from the signed parameters, validate in plain language,
//  5. render a preview with the wasm and mark what the customer typed,
//  6. on "start", send VALUES ONLY; the server re-verifies and renders by itself.
//
// All text coming from the template or from the customer is put into the page with textContent /
// createTextNode, never as HTML.
const root = document.getElementById('pb');
const lang = root.dataset.lang === 'en' ? 'en' : 'de';
const S = window.__S || {};
const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);
const t = (k, v) => fill(S[k] ?? k, v);

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

const statusEl = document.getElementById('pb-status');
const body = document.getElementById('pb-body');
const live = document.getElementById('pb-live');
const say = (msg) => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };

// ?installation=<id>: reopen saved values. Only values for this template's parameters are used; the
// form then validates them like anything typed.
async function savedValues() {
  const id = new URLSearchParams(location.search).get('installation');
  if (!id || !root.dataset.save) return null;
  try {
    const r = await fetch('/api/installations/' + encodeURIComponent(id), { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const rec = await r.json();
    return rec.slug === root.dataset.slug ? rec : null;
  } catch (e) { say(t('inst.err')); return null; }
}

async function boot() {
  let data, core, api = null;
  try {
    const [res, c] = await Promise.all([fetch(root.dataset.api, { cache: 'no-store' }), import(root.dataset.core)]);
    if (!res.ok) throw new Error('template ' + res.status);
    data = await res.json();
    core = c;
  } catch (e) {
    statusEl.textContent = '';
    body.replaceChildren(h('div', { class: 'pb-block', role: 'alert' }, h('p', { text: t('pb.load.err') }), h('button', { type: 'button', class: 'btn btn-ghost', text: t('pb.retry'), onclick: () => location.reload() })));
    return;
  }
  try {
    const wasm = await import(root.dataset.wasmJs);
    await wasm.default({ module_or_path: root.dataset.wasmBin });
    api = core.makeApi(wasm);
  } catch (e) { api = null; }

  const now = Math.floor(Date.now() / 1000);
  const verdict = core.inspectTemplate(data.raw, { api, publishers: data.publishers, now });
  statusEl.textContent = '';
  if (!verdict.ok) { body.replaceChildren(blocked(verdict, core)); return; }
  const template = verdict.template;
  const saved = await savedValues();
  body.replaceChildren(trustPanel(verdict, core), form(template, data, core, api, saved));
  say(t('pb.trust.ok'));
}

// ---- trust panel -----------------------------------------------------------------------------

function blocked(verdict, core) {
  const code = verdict.code;
  const msg = code === 'expired' && verdict.template ? t('pb.block.expired', { date: core.formatDate(verdict.template.expires_at, lang) }) : t('pb.block.' + code);
  say(t('pb.block.title') + '. ' + msg);
  return h('div', { class: 'pb-block', role: 'alert' }, h('h3', { text: t('pb.block.title') }), h('p', { text: msg }), h('p', { text: t('pb.block.locked') }));
}

function hashCell(core, hex) {
  return h('span', {}, h('code', { class: 'pb-hash', text: core.shortDigest(hex, 16) }), ' ',
    h('details', { class: 'pb-more' }, h('summary', { text: t('pb.trust.comp.full') }), h('code', { class: 'pb-hash', text: hex })));
}

function trustPanel(verdict, core) {
  const tpl = verdict.template, pub = verdict.publisher;
  const label = (pub.label && (pub.label[lang] || pub.label.de)) || tpl.publisher_pubkey;
  const comps = tpl.components.map((c) => h('li', { class: 'pb-comp-card' },
    h('h4', { text: c.name }),
    h('dl', { class: 'pb-dl' },
      h('dt', { text: t('pb.trust.comp.digest') }), h('dd', {}, hashCell(core, c.sha256)),
      c.manifest_id ? [h('dt', { text: t('pb.trust.comp.manifest') }), h('dd', {}, hashCell(core, c.manifest_id))] : null),
    h('p', {}, h('b', { text: t('pb.trust.comp.usage') + ': ' }), c.usage)));
  // The verdict stays visible as the summary line; on a phone the details start collapsed so the form is not pushed off screen.
  const compact = matchMedia('(max-width:640px)').matches;
  return h('section', { class: 'pb-trust', 'aria-labelledby': 'pb-trust-h' },
    h('h3', { id: 'pb-trust-h', text: t('pb.trust.title') }),
    h('details', { class: 'pb-trustwrap', open: !compact },
      h('summary', { class: 'pb-oksum' }, h('span', { 'aria-hidden': 'true', text: '\u2713 ' }), t('pb.trust.ok')),
      h('dl', { class: 'pb-dl' },
        h('dt', { text: t('pb.trust.name') }), h('dd', { text: tpl.name + ' ' + tpl.version }),
        h('dt', { text: t('pb.trust.publisher') }), h('dd', {}, label, ' ', h('span', { class: 'pb-key' }, '(', core.shortDigest(tpl.publisher_pubkey, 16), ')')),
        h('dt', { text: t('pb.trust.valid') }), h('dd', { text: core.formatDate(tpl.expires_at, lang) }),
        h('dt', { text: t('pb.trust.sig') }), h('dd', { text: t('pb.trust.sig.ok') })),
      pub.kind === 'demo' ? h('p', { class: 'pb-demokey', text: t('pb.trust.demokey') }) : null,
      h('h4', { text: t('pb.trust.components') }),
      h('ul', { class: 'pb-comps' }, comps),
      h('details', {}, h('summary', { text: t('pb.trust.limits.h') }), h('p', { class: 'pb-limits', text: t('pb.trust.limits') }))));
}

// ---- form ------------------------------------------------------------------------------------

function form(template, data, core, api, saved) {
  const ui = data.meta.params || {};
  const lbl = (n) => (ui[n] && ui[n].label && (ui[n].label[lang] || ui[n].label.de)) || n;
  const helpOf = (n) => ui[n] && ui[n].help && (ui[n].help[lang] || ui[n].help.de);
  const optLabel = (n, v) => (ui[n] && ui[n].options && ui[n].options[v] && (ui[n].options[v][lang] || ui[n].options[v].de)) || v;
  const isRequired = (n) => !!(ui[n] && ui[n].required);
  const defaults = core.defaultValues(template, Object.fromEntries(Object.entries(ui).filter(([, v]) => 'default' in v).map(([k, v]) => [k, v.default])));
  if (saved) for (const p of template.parameters) if (saved.values && p.name in saved.values) defaults[p.name] = saved.values[p.name];
  const ctx = { t, label: lbl, required: isRequired };
  const touched = new Set();
  const readers = {}; // name -> () => value
  const counters = {}; // name -> update()
  const errEls = {};
  const state = { preview: null };
  let summary, previewBox, submitBtn, staleMsg, formEl;

  const fieldId = (n) => 'pb-f-' + n;
  const describe = (n, extra = []) => [helpOf(n) ? 'pb-help-' + n : null, ...extra, 'pb-err-' + n].filter(Boolean).join(' ');

  function field(p) {
    const n = p.name;
    const labelText = lbl(n);
    const optTag = p.type === 'text' && !isRequired(n) ? [' ', h('span', { class: 'pb-opt-tag', text: t('pb.optional') })] : null;
    const help = helpOf(n) ? h('p', { class: 'pb-help', id: 'pb-help-' + n, text: helpOf(n) }) : null;
    const err = h('p', { class: 'pb-err', id: 'pb-err-' + n, hidden: true });
    errEls[n] = err;
    const wrapGroup = (legend, control) => h('fieldset', { class: 'pb-field', 'aria-describedby': describe(n) }, h('legend', {}, legend, optTag), help, control, err);

    if (p.type === 'enum' && p.options.length <= 4) {
      const name = 'pb-r-' + n;
      const opts = p.options.map((o) => h('label', { class: 'pb-opt' }, h('input', { type: 'radio', name, value: o, checked: o === defaults[n] }), optLabel(n, o)));
      readers[n] = () => { const c = root.querySelector(`input[name="${name}"]:checked`); return c ? c.value : ''; };
      return wrapGroup(labelText, h('div', { class: 'pb-opts' }, opts));
    }
    if (p.type === 'multiselect') {
      const name = 'pb-c-' + n;
      const sel = new Set(defaults[n]);
      const opts = p.options.map((o) => h('label', { class: 'pb-opt' }, h('input', { type: 'checkbox', name, value: o, checked: sel.has(o) }), optLabel(n, o)));
      readers[n] = () => p.options.filter((o) => root.querySelector(`input[name="${name}"][value="${CSS.escape(o)}"]`).checked);
      const note = p.note ? h('p', { class: 'pb-help', text: p.note }) : null;
      return wrapGroup(labelText, [note, h('div', { class: 'pb-opts' }, opts)]);
    }
    let control;
    if (p.type === 'enum') {
      control = h('select', { class: 'pb-control', id: fieldId(n), 'aria-describedby': describe(n) }, p.options.map((o) => h('option', { value: o, selected: o === defaults[n] }, optLabel(n, o))));
      readers[n] = () => control.value;
    } else if (p.type === 'int') {
      control = h('input', { class: 'pb-control', id: fieldId(n), type: 'number', min: p.min, max: p.max, step: 1, inputmode: 'numeric', value: defaults[n], 'aria-describedby': describe(n, ['pb-range-' + n]) });
      readers[n] = () => { const r = control.value.trim(); return r === '' ? null : Number(r); };
    } else if (p.type === 'color') {
      const out = h('output', { for: fieldId(n), text: defaults[n] });
      control = h('input', { class: 'pb-control', id: fieldId(n), type: 'color', value: defaults[n], 'aria-describedby': describe(n) });
      control.addEventListener('input', () => { out.textContent = control.value; });
      readers[n] = () => control.value;
      return h('div', { class: 'pb-field' }, h('label', { for: fieldId(n), text: labelText }), help, h('div', { class: 'pb-colorrow' }, control, out), err);
    } else {
      const multi = !!p.multiline;
      const counter = h('p', { class: 'pb-count', id: 'pb-count-' + n });
      control = multi
        ? h('textarea', { class: 'pb-control', id: fieldId(n), rows: Math.min(5, (p.max_lines || 5)), 'aria-describedby': describe(n, ['pb-count-' + n]), spellcheck: true }, defaults[n])
        : h('input', { class: 'pb-control', id: fieldId(n), type: 'text', value: defaults[n], autocomplete: 'off', 'aria-describedby': describe(n, ['pb-count-' + n]) });
      readers[n] = () => control.value;
      let lastState = '';
      counters[n] = () => {
        const st = core.textStats(control.value);
        const parts = [t('pb.counter.chars', { n: st.chars, max: p.max_len })];
        if (multi && p.max_lines != null) parts.push(t('pb.counter.lines', { n: st.lines, max: p.max_lines }));
        const over = st.chars > p.max_len || (p.max_lines != null && st.lines > p.max_lines);
        const near = !over && st.chars >= p.max_len * 0.9;
        counter.className = 'pb-count' + (over ? ' over' : near ? ' near' : '');
        counter.textContent = parts.join(' · ') + (over ? ' · ' + t('pb.counter.over') : near ? ' · ' + t('pb.counter.near') : '');
        const s = over ? 'over' : near ? 'near' : '';
        if (s !== lastState) { lastState = s; if (s) say(labelText + ': ' + t(s === 'over' ? 'pb.counter.over' : 'pb.counter.near')); }
      };
      return h('div', { class: 'pb-field' }, h('label', { for: fieldId(n) }, labelText, optTag), help, control, counter, err);
    }
    const range = p.type === 'int' ? h('p', { class: 'pb-help', id: 'pb-range-' + n, text: t('pb.range', { min: p.min, max: p.max }) }) : null;
    return h('div', { class: 'pb-field' }, h('label', { for: fieldId(n), text: labelText }), help, control, range, err);
  }

  const values = () => Object.fromEntries(template.parameters.map((p) => [p.name, readers[p.name]()]));
  const check = () => core.validateValues(template, values(), ctx);

  function paintErrors(res) {
    const byParam = new Map(res.errors.map((e) => [e.param, e]));
    for (const p of template.parameters) {
      const e = byParam.get(p.name), show = e && touched.has(p.name), el = errEls[p.name];
      el.hidden = !show;
      el.textContent = show ? e.message : '';
      const input = root.querySelector('#' + fieldId(p.name));
      if (input) { if (show) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    }
  }

  function markStale() {
    if (!state.preview) return;
    state.preview = null;
    previewBox.classList.add('is-stale');
    previewBox.hidden = true;
    staleMsg.hidden = false;
    submitBtn.textContent = t('pb.btn.preview.update');
  }

  function onChange(ev) {
    const n = ev.target && (ev.target.id ? ev.target.id.replace('pb-f-', '') : null);
    if (n && counters[n]) counters[n]();
    markStale();
    if (touched.size) paintErrors(check());
  }

  function onSubmit(ev) {
    ev.preventDefault();
    template.parameters.forEach((p) => touched.add(p.name));
    const res = check();
    paintErrors(res);
    summary.replaceChildren();
    summary.hidden = res.ok;
    if (!res.ok) {
      summary.append(h('p', { text: t('pb.errsummary') }), h('ul', {}, res.errors.map((e) => h('li', {}, e.param ? h('a', { href: '#' + fieldId(e.param), text: e.message, onclick: (x) => { x.preventDefault(); focusField(e.param); } }) : e.message))));
      summary.focus();
      return;
    }
    let rendered;
    try { rendered = api.renderPromptTemplate(JSON.stringify(template), JSON.stringify(values()), Math.floor(Date.now() / 1000)); }
    catch (e) {
      const f = core.friendlyRenderError(e && e.message, template, ctx);
      summary.hidden = false;
      summary.append(h('p', { text: t('pb.errsummary') }), h('ul', {}, h('li', { text: f.message })));
      summary.focus();
      return;
    }
    showPreview(rendered);
  }

  function focusField(n) {
    const target = root.querySelector('#' + fieldId(n)) || root.querySelector(`[name="pb-r-${n}"], [name="pb-c-${n}"]`);
    if (target) target.focus();
  }

  function showPreview(rendered) {
    const vals = values();
    state.preview = { values: vals, rendered };
    staleMsg.hidden = true;
    submitBtn.textContent = t('pb.btn.preview.update');
    const pre = h('pre', { class: 'pb-prompt', tabindex: 0, role: 'region', 'aria-label': t('pb.prev.label') });
    for (const seg of core.segmentRendered(rendered.text, template)) {
      if (seg.kind === 'input') {
        pre.append(h('mark', { class: 'pb-in' }, h('span', { class: 'pb-chip', text: t('pb.prev.in', { label: lbl(seg.name) }) }), seg.text === '' ? h('i', { text: t('pb.prev.empty') }) : seg.text));
      } else if (seg.kind === 'component') {
        pre.append(h('span', { class: 'pb-compref' }, h('span', { class: 'pb-chip c', text: t('pb.prev.comp') }), seg.text));
      } else pre.append(seg.text);
    }
    const proof = h('div', { class: 'pb-proof' },
      h('h4', { text: t('pb.prev.proof') }),
      h('dl', { class: 'pb-dl' },
        h('dt', { text: t('pb.prev.id') }), h('dd', {}, hashCell(core, rendered.template_id)),
        h('dt', { text: t('pb.prev.tdigest') }), h('dd', {}, hashCell(core, rendered.template_digest)),
        h('dt', { text: t('pb.prev.vdigest') }), h('dd', {}, hashCell(core, rendered.values_digest))),
      h('p', { class: 'pb-help', text: t('pb.prev.proof.hint') }));
    const heading = h('h3', { tabindex: -1, text: t('pb.prev.title') });
    const copyBtn = h('button', { type: 'button', class: 'btn btn-ghost', text: t('pb.btn.copy'), onclick: () => copy(rendered.text) });
    const actions = h('div', { class: 'pb-actions' }, copyBtn);
    let tail;
    if (data.meta.canRun) {
      const start = h('button', { type: 'button', class: 'btn btn-primary pb-start', 'data-fresh': '0', 'data-runlock': '1', text: t('pb.btn.start'), onclick: () => startRun(start, rendered) });
      actions.append(start);
      tail = h('p', { class: 'pb-startnote', text: t('pb.start.note') });
    } else {
      const why = data.meta.why_no_run && (data.meta.why_no_run[lang] || data.meta.why_no_run.de);
      tail = h('p', { class: 'pb-cantrun', text: why || t('pb.start.unavailable') });
    }
    previewBox.replaceChildren(heading, h('p', { class: 'pb-legend', text: t('pb.prev.legend') }), pre, proof, actions, tail, root.dataset.save ? saveBox() : null);
    previewBox.hidden = false;
    previewBox.classList.remove('is-stale');
    heading.focus();
    say(t('pb.prev.title'));
  }

  function saveBox() {
    const input = h('input', { class: 'pb-control', id: 'pb-save-name', type: 'text', maxlength: 120, autocomplete: 'off', value: saved ? saved.name : template.name });
    const msg = h('p', { class: 'pb-help', role: 'status' });
    const btn = h('button', { type: 'button', class: 'btn btn-ghost', text: t('inst.save'), onclick: async () => {
      btn.disabled = true;
      try {
        const r = await fetch('/api/installations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: root.dataset.slug, lang, name: input.value, values: state.preview.values }) });
        const j = await r.json().catch(() => ({}));
        msg.textContent = r.ok ? t('inst.saved') : (j.message || t('inst.err'));
      } catch (e) { msg.textContent = t('inst.err'); }
      btn.disabled = false;
    } });
    return h('div', { class: 'pb-field' }, h('label', { for: 'pb-save-name', text: t('inst.name') }), input, h('div', { class: 'pb-actions' }, btn), msg);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); say(t('pb.copy.done')); return; } catch (e) { /* fall through */ }
    try {
      const ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0' }, text);
      document.body.append(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      say(ok ? t('pb.copy.done') : t('pb.copy.fail'));
    } catch (e) { say(t('pb.copy.fail')); }
  }

  function startRun(btn, rendered) {
    if (typeof window.startRun !== 'function') return;
    window.__pbRun = { demo: root.dataset.slug, lang, values: state.preview.values, expect: { template_digest: rendered.template_digest, values_digest: rendered.values_digest } };
    const out = document.querySelector('.out');
    window.startRun(btn);
    if (out) out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  summary = h('div', { class: 'pb-summary', role: 'alert', tabindex: -1, hidden: true });
  previewBox = h('div', { class: 'pb-preview', hidden: true });
  staleMsg = h('p', { class: 'pb-stale', role: 'status', text: t('pb.stale'), hidden: true });
  submitBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: t('pb.btn.preview') });
  formEl = h('form', { class: 'pb-form', novalidate: true, onsubmit: onSubmit },
    h('fieldset', {}, h('legend', { class: 'pb-legend', text: data.meta.title ? (data.meta.title[lang] || data.meta.title.de) : t('pb.form.legend') }),
      data.meta.intro ? h('p', { class: 'pb-lede', text: data.meta.intro[lang] || data.meta.intro.de }) : null,
      summary,
      template.parameters.map(field),
      h('div', { class: 'pb-actions' }, submitBtn),
      staleMsg));
  formEl.addEventListener('input', onChange);
  formEl.addEventListener('change', onChange);
  formEl.addEventListener('focusout', (ev) => {
    const n = ev.target && ev.target.id && ev.target.id.startsWith('pb-f-') ? ev.target.id.slice(5) : null;
    if (n) { touched.add(n); paintErrors(check()); }
  });
  Object.values(counters).forEach((u) => u());
  return h('div', {}, formEl, previewBox);
}

boot();
