// Server-rendered shell of the "Eigene Angaben" block on /d/<slug> and its CSS. The form, the trust
// panel and the preview are built in the browser by static/prompt-builder.js, because the signature
// is checked there (WebAssembly) and the form is generated from the signed template's parameters.
import { makeT, normLang } from './i18n.mjs';
import { esc } from './chrome.mjs';

export const PB_CSS = `
.pb{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:18px 20px;margin:18px 0}
.pb h2{font-family:var(--serif);font-weight:600;font-size:1.3rem;margin:0 0 4px}
.pb h3{font-family:var(--serif);font-weight:600;font-size:1.05rem;margin:0 0 8px}
.pb-lede{margin:0 0 14px;color:var(--muted2);font-size:.92rem;max-width:70ch}
.pb-status{margin:0 0 14px;color:var(--muted2);font-size:.9rem}
.pb-trust{border:1px solid var(--border);border-radius:11px;background:var(--panel);padding:14px 16px;margin:0 0 18px}
.pb-trust h3{margin:0 0 4px}
.pb-trust>details>summary.pb-oksum{font-weight:700;color:var(--teal-ink);font-size:.95rem}
.pb-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0 0 12px;font-size:.9rem}
.pb-dl dt{color:var(--muted2);font-weight:600}.pb-dl dd{margin:0;min-width:0;overflow-wrap:anywhere}
.pb-key,.pb-hash{font-family:var(--mono);font-size:.8rem}
.pb-demokey{margin:0 0 12px;padding:8px 12px;border:1px dashed var(--terra);border-radius:8px;color:var(--ink);font-size:.88rem}
.pb-comps{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:10px}
.pb-comp-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.pb-comp-card h4{margin:0 0 6px;font:600 .95rem var(--mono)}
.pb-comp-card p{margin:6px 0 0;font-size:.88rem;color:var(--muted2)}
.pb-comp-card p b{color:var(--ink)}
.pb-more summary,.pb-trust details>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;color:var(--teal-ink);font-weight:600;font-size:.88rem;list-style:none}
.pb-more summary::-webkit-details-marker,.pb-trust details>summary::-webkit-details-marker{display:none}
.pb-more summary::before,.pb-trust details>summary::before{content:"\\25B8"}.pb-more[open]>summary::before,.pb-trust details[open]>summary::before{content:"\\25BE"}
.pb-limits{margin:0;color:var(--muted2);font-size:.88rem;max-width:75ch}
.pb-block{border:2px solid var(--terra);border-radius:11px;background:var(--card);padding:14px 16px;margin:0 0 14px}
.pb-block h3{color:var(--terra-ink)}.pb-block p{margin:0 0 8px;font-size:.92rem}
.pb-form{margin:0}
.pb-form>fieldset{border:0;padding:0;margin:0;min-width:0}
.pb-form legend.pb-legend{font-family:var(--serif);font-weight:600;font-size:1.05rem;padding:0;margin:0 0 10px}
.pb-field{margin:0 0 18px;min-width:0;border:0;padding:0}
.pb-field>label,.pb-field>legend{display:block;font-weight:600;font-size:.92rem;margin:0 0 4px;padding:0}
.pb-opt-tag{font-weight:400;color:var(--muted2)}
.pb-help{margin:0 0 6px;color:var(--muted2);font-size:.85rem;max-width:70ch}
.pb-control{width:100%;max-width:36rem;min-height:44px;border:1px solid var(--field);border-radius:8px;padding:.6rem .8rem;font:400 .95rem var(--sans);color:var(--ink);background:var(--bg)}
textarea.pb-control{resize:vertical;min-height:7.5rem;line-height:1.5}
input.pb-control[type=number]{max-width:9rem}
input.pb-control[type=color]{width:5rem;padding:.2rem;cursor:pointer}
.pb-colorrow{display:flex;align-items:center;gap:12px}.pb-colorrow output{font:.85rem var(--mono);color:var(--muted2)}
.pb-control[aria-invalid=true]{border:2px solid var(--terra)}
.pb-control:focus-visible,.pb-opt input:focus-visible{outline-offset:1px}
.pb-opts{display:flex;flex-wrap:wrap;gap:8px}
.pb-opt{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:.3rem .85rem .3rem .7rem;border:1px solid var(--field);border-radius:8px;background:var(--bg);cursor:pointer;font-size:.92rem}
.pb-opt:hover{border-color:var(--teal)}.pb-opt:has(input:checked){border-color:var(--teal-fill);box-shadow:inset 0 0 0 1px var(--teal-fill)}
.pb-opt input{width:20px;height:20px;margin:0;accent-color:var(--teal-fill);flex:0 0 auto}
.pb-count{margin:4px 0 0;font:.8rem var(--mono);color:var(--muted2)}
.pb-count.near,.pb-count.over{color:var(--terra-ink)}.pb-count.over{font-weight:700}
.pb-err{margin:6px 0 0;color:var(--terra-ink);font-size:.88rem;font-weight:600}
.pb-err::before{content:"\\26A0\\FE0E";margin-right:.5ch}
.pb-summary{margin:0 0 14px;padding:12px 14px;border:2px solid var(--terra);border-radius:10px;background:var(--card)}
.pb-summary p{margin:0 0 6px;font-weight:600}.pb-summary ul{margin:0;padding-left:1.2em}.pb-summary a{color:var(--terra-ink)}
.pb-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:6px}
.pb-stale{margin:12px 0 0;color:var(--terra-ink);font-weight:600;font-size:.9rem}
.pb-preview{margin-top:20px;border-top:1px solid var(--border);padding-top:18px}
.pb-legend{margin:0 0 10px;color:var(--muted2);font-size:.85rem;max-width:75ch}
.pb-prompt{white-space:pre-wrap;overflow-wrap:anywhere;font:.85rem/1.8 var(--mono);background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:0 0 14px;color:var(--ink)}
.pb-in{background:rgba(168,91,39,.14);border:1.5px dashed var(--terra);border-radius:6px;padding:1px 6px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.pb-chip{display:inline-block;margin-right:6px;padding:0 .5rem;border:1px solid var(--terra);border-radius:999px;background:var(--card);color:var(--terra-ink);font:600 .75rem var(--mono);white-space:nowrap;vertical-align:baseline}
.pb-chip.c{border-color:var(--teal-fill);color:var(--teal-ink)}
.pb-compref{border-bottom:2px solid var(--teal-fill);background:rgba(47,138,125,.1);border-radius:4px;padding:0 3px}
.pb-proof{margin:0 0 14px;font-size:.88rem}.pb-proof .pb-help{margin-top:4px}
.pb-startnote{margin:10px 0 0;color:var(--muted2);font-size:.85rem;max-width:70ch}
.pb-cantrun{margin:12px 0 0;padding:10px 14px;border:1px dashed var(--border);border-radius:8px;color:var(--muted2);font-size:.9rem}
.pb-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
@media(max-width:640px){.pb{padding:16px 14px}.pb-dl{grid-template-columns:1fr;gap:2px}.pb-dl dd{margin-bottom:8px}.pb-actions .btn{flex:1 1 100%}.pb-control{max-width:none}}
`;

/** Cache-busting version strings for the three browser assets (content hashes computed by the caller). */
export function builderBlock(slug, lang, ver = {}, save = false) {
  lang = normLang(lang);
  const t = makeT(lang);
  const q = (v) => (v ? `?v=${esc(v)}` : '');
  return `<section class="pb" id="pb" aria-labelledby="pb-h" data-slug="${esc(slug)}" data-lang="${lang}"${save ? ' data-save="1"' : ''} data-api="/api/template/${esc(slug)}" data-core="/pb/prompt-core.mjs" data-wasm-js="/pb/wasm/manifest_core_wasm.js${q(ver.wasm)}" data-wasm-bin="/pb/wasm/manifest_core_wasm_bg.wasm${q(ver.wasm)}">
  <h2 id="pb-h">${t('pb.title')}</h2>
  <p class="pb-lede">${t('pb.lede')}${save ? ` <a href="/installationen${lang === 'en' ? '?lang=en' : ''}">${t('inst.title')}</a>` : ''}</p>
  <p class="pb-status" id="pb-status" role="status">${t('pb.loading')}</p>
  <div id="pb-body"></div>
  <p class="pb-live" id="pb-live" role="status" aria-live="polite"></p>
  <noscript><div class="noscript-note" role="note">${t('pb.noscript')}</div></noscript>
  <script type="module" src="/pb/prompt-builder.js${q(ver.js)}"></script>
</section>`;
}
