// "Installationen speichern": the visitor's saved template values, stored in their platform account
// (control plane, /me/installations), reached through this server.
//
// A browser cannot call that API from a tunnel origin (no CORS, its CSRF guard refuses same-site),
// and the gallery knows its visitor only by ct_gate_session. So this server calls it as the one
// configured delegate: INSTALLATIONS_DELEGATE_TOKEN proves "the gallery", the visitor's own session
// proves "this visitor is here"; the control plane needs both (CADS-Tunnel, installations.rs).
//
// What gets stored is built here, never taken from the client: the template comes from disk and is
// re-verified, values are validated by the same code as a run, digests come from the wasm. The
// control plane refuses credential-looking values with 422; that message reaches the visitor.
// The token is never logged and never sent to the browser.
import { docOpen, appbar, foot, esc, jsonForScript } from './chrome.mjs';
import { makeT, normLang, clientStrings } from './i18n.mjs';

const ID = /^[0-9a-f-]{36}$/;
const NAME_MAX = 120;
export const isInstallationId = (id) => typeof id === 'string' && ID.test(id);

export function createInstallations(opts = {}) {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetchImpl ?? fetch;
  const token = env.INSTALLATIONS_DELEGATE_TOKEN || '';
  const base = env.INSTALLATIONS_API_URL || new URL(env.DEMO_GATE_CHECK_URL || 'https://bunsenbrenner.org/gate/check').origin;
  const enabled = !!token && String(env.DEMO_AUTH_MODE || 'off').toLowerCase() === 'gate';

  async function call(session, method, path, body) {
    const r = await doFetch(`${base}/me/installations${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      headers: { 'x-ct-installations-delegate': token, 'x-ct-gate-session': session, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* the control plane's errors are plain text */ }
    return { status: r.status, json, text };
  }
  return {
    enabled,
    list: (s) => call(s, 'GET', '?limit=50'),
    get: (s, id) => call(s, 'GET', `/${id}`),
    create: (s, record) => call(s, 'POST', '', record),
    remove: (s, id) => call(s, 'DELETE', `/${id}`),
  };
}

/** The record for a template run that passed prepareRun. Everything but `values` and `name` is derived. */
export function recordFor({ template, rendered, values, name, lang }) {
  const label = String(name || '').trim().slice(0, NAME_MAX) || template.name;
  return {
    name: label,
    template_id: rendered.template_id,
    template_digest: rendered.template_digest,
    values,
    values_digest: rendered.values_digest,
    components: template.components.map((c) => ({ name: c.name, sha256: c.sha256 })),
    manifest_ids: template.components.map((c) => c.manifest_id).filter(Boolean),
    target: { os: 'web', device_label: lang === 'en' ? 'Gallery' : 'Galerie' },
    status: 'installed',
  };
}

/** Only what the page needs. slug is null when the template of a record is no longer offered here. */
export const publicRecord = (rec, slugOf) => ({ id: rec.id, name: rec.name, slug: slugOf(rec.template_id), values: rec.values, updated_at: rec.updated_at });

const PAGE_CSS = `
.inst{list-style:none;margin:18px 0;padding:0;display:grid;gap:10px}
.inst li{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:12px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.inst h2{font-family:var(--serif);font-weight:600;font-size:1.05rem;margin:0;flex:1 1 14rem;overflow-wrap:anywhere}
.inst time{color:var(--muted2);font-size:.85rem}
`;
const CLIENT = `(function(){var S=window.__S,box=document.getElementById('inst-list'),st=document.getElementById('inst-status'),lang=document.documentElement.lang;
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function load(){fetch('/api/installations',{cache:'no-store'}).then(function(r){return r.json().then(function(j){return{r:r,j:j};});}).then(function(o){
 if(o.r.status===401){st.textContent=S['inst.login'];if(o.j.login_url){var a=el('a',null,S['inst.login.go']);a.href=o.j.login_url;st.append(' ',a);}return;}
 if(!o.r.ok){st.textContent=o.j.message||S['inst.err'];return;}
 box.replaceChildren();st.textContent=o.j.items.length?'':S['inst.empty'];
 o.j.items.forEach(function(it){var li=el('li'),h=el('h2',null,it.name),when=el('time',null,new Date(it.updated_at*1000).toLocaleDateString(lang));li.append(h,when);
  if(it.slug){var a=el('a','btn btn-ghost',S['inst.open']);a.href='/d/'+encodeURIComponent(it.slug)+'?installation='+encodeURIComponent(it.id)+(lang==='en'?'&lang=en':'');li.append(a);}else li.append(el('span',null,S['inst.gone']));
  var d=el('button','btn btn-ghost',S['inst.delete']);d.type='button';d.setAttribute('aria-label',S['inst.delete']+': '+it.name);d.addEventListener('click',function(){if(!confirm(S['inst.delete.ask']))return;fetch('/api/installations/'+encodeURIComponent(it.id),{method:'DELETE'}).then(function(r){if(r.ok)load();else st.textContent=S['inst.err'];});});li.append(d);box.append(li);});
}).catch(function(){st.textContent=S['inst.err'];});}
load();})();`;

export function installationsPage(lang, enabled) {
  lang = normLang(lang);
  const t = makeT(lang);
  const main = enabled
    ? `<p id="inst-status" role="status">${t('pb.loading')}</p><ul class="inst" id="inst-list"></ul>`
    : `<p>${t('inst.off')}</p>`;
  return `${docOpen({ lang, title: t('inst.title'), extraCss: PAGE_CSS })}${appbar(esc(t('inst.title')), lang)}<main id="main" class="wrap"><h1>${t('inst.title')}</h1><p>${t('inst.lede')}</p>${main}</main>${foot(lang)}<script>window.__S=${jsonForScript(clientStrings(lang))};</script>${enabled ? `<script>${CLIENT}</script>` : ''}</body></html>`;
}
