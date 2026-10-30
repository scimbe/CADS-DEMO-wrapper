// Shared page chrome: design tokens/CSS, header, footer, language switch, doc skeleton.
// Used by the index (lib/index-page.mjs) and by every /d/<slug> page (server.mjs).
//
// Colour tokens meet WCAG 2.2 AA (text 4.5:1, borders of form fields 3:1) in both themes;
// --teal-fill / --field / --focus exist because the decorative --teal / --border do not.
import { tr, makeT, normLang } from './i18n.mjs';

export const BB_CSS = `
:root{--bg:#0c111d;--card:#141b2c;--ink:#eef1f7;--muted:#8a93ad;--muted2:#c3c9db;--teal:#5fb8ab;--teal-ink:#8fd6c9;--terra:#d98a4f;--terra-ink:#e0a458;--border:#2a3450;--panel:#1a2338;--panel2:#212a41;--bg-blur:rgba(12,17,29,.85);--on-accent:#0c111d;--teal-fill:#5fb8ab;--field:#6b7794;--focus:#8fd6c9;color-scheme:dark;--serif:ui-serif,Georgia,"Iowan Old Style","Palatino Linotype",serif;--sans:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme: light){:root{--bg:#F5F7FB;--card:#FFFFFF;--ink:#131A2C;--muted:#5B6478;--muted2:#333D54;--teal:#2F8A7D;--teal-ink:#1F6B60;--terra:#A85B27;--terra-ink:#9A531F;--border:#D7DEEC;--panel:#EEF1F8;--panel2:#E7ECF5;--bg-blur:rgba(245,247,251,.85);--on-accent:#ffffff;--teal-fill:#237A6D;--field:#7C869B;--focus:#1F6B60;color-scheme:light}}
*{box-sizing:border-box}a{color:var(--teal-ink);text-decoration:underline;text-underline-offset:.18em}a:hover{color:var(--ink)}
.brand,.btn,.chip,.dcard a,.langtoggle a,.skip,.appbar a,footer a,.exchip{text-decoration:none}
footer a:hover,.crumb a:hover{text-decoration:underline}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:44px 44px;background-position:-1px -1px}
.appbar{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;background:var(--bg-blur);backdrop-filter:blur(6px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:5}
.appbar .l{display:flex;align-items:center;gap:16px}
.brand{font-weight:700;font-size:1rem;letter-spacing:-.01em;display:flex;align-items:center;gap:.5ch;color:var(--ink);text-decoration:none}.brand:hover{color:var(--ink)}
.brand .dot{color:var(--terra)}.brand .tld{color:var(--muted);font-weight:600}
.crumb{font-family:var(--mono);font-size:.76rem;color:var(--muted);letter-spacing:.04em}.crumb b{color:var(--muted2)}.crumb a{color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:.75rem;color:var(--teal-ink);background:rgba(47,138,125,.09);border:1px solid rgba(47,138,125,.25);border-radius:999px;padding:.28rem .66rem}
.chip .d{width:7px;height:7px;border-radius:50%;background:var(--teal)}
.wrap{max-width:1120px;margin:0 auto;padding:24px 28px 40px}
.eyebrow{font-family:var(--mono);font-size:.75rem;letter-spacing:.14em;text-transform:uppercase;color:var(--teal-ink);font-weight:600;margin:26px 0 12px}
.eyebrow .lead{color:var(--border);margin-right:.6ch}
h1{font-family:var(--serif);font-weight:600;font-size:2.3rem;line-height:1.1;letter-spacing:-.015em;margin:0 0 12px;max-width:20ch;text-wrap:balance}
.lede{font-size:1.1rem;color:var(--muted2);max-width:60ch;margin:0}
.toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;padding-bottom:18px;border-bottom:1px solid var(--border)}
.toolbar h1{font-size:1.7rem;margin:0 0 4px}.toolbar p{margin:0;color:var(--muted2);font-size:.95rem;max-width:60ch}
.controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.setting{display:flex;align-items:center;gap:8px;font-size:.82rem;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.42rem .7rem}
.setting .k{font-family:var(--mono);font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.setting .v{font-weight:600}.setting .v.on{color:var(--teal-ink)}
.btn{min-height:44px;justify-content:center;font:600 .92rem var(--sans);border-radius:9px;padding:.62rem 1.2rem;border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;gap:.5ch}
.btn-primary{background:var(--terra);color:var(--on-accent)}.btn-primary:hover{background:var(--terra-ink)}
.btn-ghost{background:var(--card);color:var(--muted2);border:1px solid var(--border)}.btn-ghost:hover{color:var(--ink)}
.btn:disabled{opacity:.7;cursor:progress}
.io{display:flex;align-items:center;gap:10px;margin:16px 0 4px;font-family:var(--mono);font-size:.78rem;color:var(--muted2);flex-wrap:wrap}
.io .path{background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:.28rem .6rem;color:var(--ink)}.io .ar{color:var(--teal-ink)}
.grid2{display:grid;grid-template-columns:390px 1fr;gap:22px;margin-top:14px;align-items:start}
@media(max-width:860px){.grid2{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--border);border-radius:13px;box-shadow:0 1px 2px rgba(19,26,44,.03);overflow:hidden}
.ph{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)}
.ph h2{font-family:var(--serif);font-weight:600;font-size:1.05rem;margin:0}.ph .count{font-family:var(--mono);font-size:.75rem;color:var(--muted)}
.tray{padding:8px 8px 12px}
.prow{display:flex;align-items:center;gap:12px;padding:8px;border-radius:10px}.prow:hover{background:var(--panel)}
.prow img{width:60px;height:45px;object-fit:cover;border-radius:6px;flex:0 0 auto;box-shadow:inset 0 0 0 1px rgba(19,26,44,.1)}
.pn{font-family:var(--mono);font-size:.8rem}
.pt{display:flex;gap:12px;margin-top:2px;font-size:.75rem;color:var(--muted);flex-wrap:wrap}
.pt .lab{font-family:var(--mono);font-size:.75rem;letter-spacing:.05em;text-transform:uppercase;color:var(--teal-ink);margin-right:4px}
.credit{font-size:.75rem;color:var(--muted);margin-top:1px}
.out{display:flex;flex-direction:column;gap:20px;min-height:120px}
.placeholder{display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);font-size:.9rem;padding:40px 20px;border:1.5px dashed var(--border);border-radius:12px;background:var(--card)}
.tree{padding:8px 10px 12px}
.frow{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:9px;font-family:var(--mono);font-size:.82rem;color:var(--muted2)}
.frow:hover{background:var(--panel)}.frow .car{color:var(--teal-ink);font-size:.75rem}.frow .fold{color:var(--ink);font-weight:600}.frow .yr{color:var(--muted)}
.frow .n{margin-left:auto;font-size:.75rem;color:var(--muted);background:var(--panel2);border-radius:999px;padding:.15rem .55rem}
.sheetwrap{padding:16px}.sheetwrap img{width:100%;border:1px solid var(--border);border-radius:9px;display:block}
.reportframe{width:100%;height:640px;border:1px solid var(--border);border-radius:9px;background:#fff}
.sheetwrap img.resimg{width:auto;max-width:100%;max-height:75vh;height:auto;object-fit:contain;border:1px solid var(--border);border-radius:9px;display:block;background:#fff;margin:0 auto;padding:10px;box-sizing:border-box}
ol.timeline{list-style:none;margin:0;padding:10px 16px 16px}
ol.timeline li.tstep{position:relative;padding:9px 10px 9px 26px;border-left:2px solid var(--border);margin-left:8px;font-size:.9rem}
ol.timeline li.tstep::before{content:"";position:absolute;left:-7px;top:13px;width:11px;height:11px;border-radius:50%;background:var(--teal);border:2px solid var(--card)}
ol.timeline li.tstep.rec{border-left-color:var(--terra)}ol.timeline li.tstep.rec::before{background:var(--terra)}
ol.timeline .ex{color:var(--terra-ink);font-size:.82rem;font-family:var(--mono)}
ol.chapters,ol.scenes{list-style:none;margin:12px 0 0;padding:0;font-size:.88rem}
ol.chapters li,ol.scenes li{padding:8px 10px;border-bottom:1px solid var(--border)}
ol.chapters li{cursor:pointer;border-radius:7px}ol.chapters li:hover{background:var(--panel)}
ol.chapters .ct{font-family:var(--mono);font-size:.76rem;color:var(--teal-ink);margin-right:8px}
details.tx summary{cursor:pointer;font-size:.85rem;color:var(--muted2);font-weight:600}
.txbody{white-space:pre-wrap;font-family:var(--mono);font-size:.75rem;color:var(--muted2);max-height:220px;overflow:auto;background:var(--panel);border-radius:8px;padding:10px 12px;margin-top:8px}
.stepper{display:flex;gap:10px;margin:16px 0 4px;flex-wrap:wrap}
.st{display:flex;align-items:center;gap:9px;font-size:.88rem;color:var(--muted);padding:7px 13px;border:1px solid var(--border);border-radius:999px;background:var(--card)}
.st .n{width:19px;height:19px;border-radius:50%;border:1.5px solid var(--border);display:grid;place-items:center;font:600 .75rem var(--mono);color:var(--muted)}
.st.active{border-color:var(--teal);color:var(--ink);box-shadow:0 0 0 3px rgba(47,138,125,.1)}.st.active .n,.st.done .n{border-color:var(--teal-fill);background:var(--teal-fill);color:var(--on-accent)}
.st.done{color:var(--ink)}.st.error{border-color:var(--terra);color:var(--terra-ink)}.st.error .n{border-color:var(--terra);background:var(--terra);color:var(--on-accent)}
details.tech{margin-top:12px;border:1px solid var(--border);border-radius:10px;background:var(--panel);overflow:hidden}
details.tech summary{cursor:pointer;min-height:44px;padding:11px 15px;font-size:.86rem;color:var(--muted2);font-weight:600;list-style:none;display:flex;align-items:center;gap:8px}
details.tech summary::-webkit-details-marker{display:none}
details.tech summary::before{content:"▸";color:var(--teal)}details.tech[open] summary::before{content:"▾"}
.log{font-family:var(--mono);font-size:.76rem;line-height:1.7;background:#0f1524;color:#c7d2e0;padding:13px 15px;max-height:230px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.log .l{display:block}.log .step{color:#8fb4ff}.log .real{color:#5fd0ad}.log .sim{color:#e0a458}.log .cache{color:#e0a458}.log .run{color:#c7d2e0}.log .ok{color:#9fb0c4}.log .warn{color:#e0a458}.log .fail{color:#f2726b;font-weight:600}
.note{display:flex;gap:12px;align-items:flex-start;margin-top:18px;padding:14px 16px;background:var(--card);border:1px solid var(--border);border-radius:11px;font-size:.88rem;color:var(--muted2)}
.note .t{font-family:var(--mono);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-ink);font-weight:600;padding-top:2px;white-space:nowrap}.note b{color:var(--ink)}
.prov{margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:11px;font-size:.8rem;color:var(--muted2)}
.prov .ok{color:var(--teal-ink);font-weight:600}.prov .sim{color:var(--terra-ink)}.prov .sep{color:var(--muted)}
.capbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0 2px}
.caplabel{color:var(--muted);font-family:var(--mono);font-size:.75rem;text-transform:uppercase;letter-spacing:.09em;margin-right:2px}
.capchip{display:inline-flex;align-items:center;gap:6px;padding:.26rem .62rem;border-radius:999px;border:1px solid var(--border);background:var(--card);font-size:.78rem;color:var(--muted2)}
.capchip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--muted);flex:0 0 auto}
.cap-free::before{background:#2f8a5f}.cap-busy::before{background:var(--terra)}.cap-info::before{background:var(--teal)}.cap-un{color:var(--muted)}
.upcmp{margin:22px 0 4px;padding:16px 18px;border:1px dashed var(--border);border-radius:12px;background:var(--card)}
.upttl{font-family:var(--mono);font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:10px}
.uprow{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.upf{display:flex;flex-direction:column;gap:5px;font-size:.85rem;color:var(--muted2);min-width:0;flex:1 1 220px}
.upf input[type=file]{font:inherit;font-size:.85rem;width:100%;max-width:100%;min-height:44px}
.upmsg{margin-top:10px;font-size:.82rem;color:var(--muted2);min-height:1.1em}
.res-upreport{margin-top:14px}
.cards{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:20px;margin-top:26px}
.dcard{position:relative;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border);border-radius:13px;padding:20px 22px;box-shadow:0 1px 2px rgba(19,26,44,.03);text-decoration:none;color:inherit;transition:border-color .15s,transform .15s}
.dcard:hover,.dcard:focus-within{border-color:var(--teal)}.dcard:hover{transform:translateY(-2px)}
.dcard .k{font-family:var(--mono);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-ink);font-weight:600}
.dcard h3{font-family:var(--serif);font-weight:600;font-size:1.2rem;margin:8px 0 6px}
.dcard h3 a{color:var(--ink)}.dcard h3 a::after{content:"";position:absolute;inset:0;border-radius:13px}.dcard h3 a:focus-visible{outline:none}.dcard h3 a:focus-visible::after{outline:3px solid var(--focus);outline-offset:2px}
.dcard p{margin:0 0 12px;color:var(--muted2);font-size:.92rem;flex:0 0 auto}
.dcard .go{margin-top:auto;font-weight:600;color:var(--terra-ink);font-size:.9rem}
.dcard.soon{border-style:dashed}.dcard.soon:hover{border-color:var(--border);transform:none}.dcard .soonlbl{color:var(--muted2);font-weight:600}
.progress{margin:16px 0 6px}.pbar{height:8px;background:var(--panel2);border-radius:999px;overflow:hidden;border:1px solid var(--border)}.pbar>i{display:block;height:100%;background:var(--teal);width:0;transition:width .5s ease}
.pmeta{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:9px;font-family:var(--mono);font-size:.75rem;color:var(--muted)}
.btn-cancel{min-height:44px;font:600 .85rem var(--sans);color:var(--terra-ink);background:var(--card);border:1px solid var(--border);border-radius:7px;padding:.34rem .8rem;cursor:pointer}.btn-cancel:hover{border-color:var(--terra)}
.langtoggle{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;font-family:var(--mono);font-size:.75rem}
.langtoggle a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 .7rem;color:var(--muted);text-decoration:none;background:var(--card)}.langtoggle a.on{background:var(--teal-fill);color:var(--on-accent)}
.tune{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin:4px 0 18px}
.tune-h{display:flex;flex-direction:column;gap:3px;margin-bottom:12px}
.teyebrow{font-family:var(--mono);font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:var(--teal-ink);font-weight:600}
.tsub{color:var(--muted2);font-size:.88rem;max-width:74ch}
.tune-row{display:flex;gap:10px;flex-wrap:wrap}
.tuneinput{flex:1;min-width:min(240px,100%);min-height:44px;border:1px solid var(--field);border-radius:8px;padding:.6rem .8rem;font:400 .95rem var(--sans);color:var(--ink);background:var(--bg)}

.descfield{display:block;margin:2px 0 14px}.descfield .dl{display:block;font-size:.82rem;color:var(--muted2);margin-bottom:6px}
.descinput{width:100%;box-sizing:border-box;border:1px solid var(--field);border-radius:8px;padding:.6rem .8rem;font:400 .95rem var(--sans);color:var(--ink);background:var(--bg);resize:vertical}

.tune-ex{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.exlbl{font-size:.76rem;color:var(--muted)}
.exchip{min-height:44px;font:500 .8rem var(--sans);color:var(--muted2);background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:.3rem .7rem;cursor:pointer}
.exchip:hover{border-color:var(--teal);color:var(--ink)}
.tunepreview{margin-top:14px;border-top:1px solid var(--border);padding-top:14px}
.pv-h{font-size:.85rem;color:var(--muted2);font-weight:600;margin-bottom:8px}
ul.pv{list-style:none;margin:0 0 12px;padding:0;font-family:var(--mono);font-size:.82rem}
ul.pv li{padding:3px 0}ul.pv li.ok{color:var(--teal-ink)}ul.pv li.ok::before{content:"✓ "}
ul.pv li.rej{color:var(--terra-ink)}ul.pv li.rej::before{content:"✕ "}
ul.pv li.pmuted{color:var(--muted)}
.pmuted{color:var(--muted);font-size:.85rem}.perr{color:var(--terra-ink);font-size:.85rem}
.appliedbadge{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:.75rem;color:var(--teal-ink);background:rgba(47,138,125,.09);border:1px solid rgba(47,138,125,.25);border-radius:999px;padding:.26rem .6rem;margin-left:8px}
footer{margin:34px auto 40px;max-width:1120px;padding:20px 28px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:16px 24px;flex-wrap:wrap;color:var(--muted);font-size:.82rem}
footer{flex-direction:column;align-items:flex-start}
footer .fl{display:flex;gap:18px;flex-wrap:wrap;align-items:center}footer a{color:var(--muted2)}footer .support{color:var(--terra-ink);font-weight:600}footer .fnote{color:var(--muted)}
footer .attrib{color:var(--muted2)}footer .attrib b{color:var(--ink);font-weight:600}footer .attrib a{color:var(--teal-ink)}
.m-toggle{display:none;min-height:44px;margin:16px 0 2px;font:600 .85rem var(--sans);color:var(--muted2);background:var(--card);border:1px solid var(--border);border-radius:9px;padding:.5rem 1rem;cursor:pointer;align-items:center;gap:.5ch}.m-toggle:hover{color:var(--ink);border-color:var(--teal)}@media(max-width:640px){.m-toggle{display:inline-flex}body.tool:not(.m-open) .io,body.tool:not(.m-open) .note,body.tool:not(.m-open) .prov,body.tool:not(.m-open) details.tech,body.tool:not(.m-open) .tune-ex,body.tool:not(.m-open) .grid2>aside{display:none!important}}

.st.done::after{content:"\\2713";font-weight:700;color:var(--teal-ink)}.st.active::after{content:"\\2026";font-weight:700}.st.error::after{content:"\\2715";font-weight:700;color:var(--terra-ink)}
[hidden]{display:none!important}
.cards>li{display:flex;min-width:0}.cards>li>.dcard{flex:1;min-width:0}
/* ---- shared a11y + responsive base ---- */
.sr-only{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.skip{position:absolute;left:12px;top:-60px;z-index:20;background:var(--card);color:var(--ink);border:2px solid var(--focus);border-radius:8px;padding:.6rem 1rem;font-weight:600}.skip:focus{top:8px}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:4px}
.tuneinput:focus-visible,.descinput:focus-visible,.searchbar input:focus-visible{outline-offset:1px}
.ext{font-size:.85em;margin-left:.25ch}
.appbar .r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.crumb a,.brand{display:inline-flex;align-items:center;min-height:44px}.appbar .l{flex-wrap:wrap;gap:0 16px}
footer a{display:inline-flex;align-items:center;min-height:44px}
.noscript-note{margin:16px 0;padding:14px 16px;border:2px solid var(--terra);border-radius:11px;background:var(--card);color:var(--ink);font-size:.92rem}
.runerr{margin:16px 0 4px;padding:16px 18px;border:2px solid var(--terra);border-radius:12px;background:var(--card)}
.runerr h3{margin:0 0 6px;font-family:var(--serif);font-size:1.05rem}.runerr p{margin:0 0 12px;color:var(--muted2);font-size:.92rem}
.runerr .hint{color:var(--muted)}
.ptxt,.placeholder,.note,.prov{overflow-wrap:anywhere}
.note{flex-wrap:wrap}.note .t{white-space:normal}.note>div{min-width:0;flex:1 1 220px}.out{min-width:0}
.io .path,.pv li,.log{overflow-wrap:anywhere}
.tune-row .tuneinput{min-width:0}
@media(max-width:640px){
  .appbar{position:static;padding:6px 16px;flex-direction:column;align-items:stretch}.appbar .r{justify-content:space-between}.chip{border-radius:12px;line-height:1.3;padding:.4rem .7rem}.wrap{padding:16px 16px 32px}footer{padding:16px 16px 0}
  h1{font-size:1.85rem}.toolbar h1{font-size:1.45rem}
  .toolbar{align-items:stretch}.controls .btn,.controls .setting{flex:1 1 auto}
  .reportframe{height:480px}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;

// Honest default: the demo is served by us. (It used to say "served by customer".)
export const SERVED_BY = process.env.SERVED_BY || 'bunsenbrenner.org';

// Persist the language choice (try/catch: storage can be blocked) and honour ?lang=. With no
// ?lang= and a stored English choice the page reloads once with ?lang=en; German is the default.
export const LANG_BOOT = `<script>(function(){try{var q=new URLSearchParams(location.search).get('lang');if(q==='de'||q==='en'){localStorage.setItem('bb-lang',q);}else if(localStorage.getItem('bb-lang')==='en'&&document.documentElement.lang!=='en'){var u=new URL(location.href);u.searchParams.set('lang','en');location.replace(u.toString());}}catch(e){}})();</script>`;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// JSON for an inline <script>: keep "</script>" and U+2028/9 from ending or breaking it.
export const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Visual arrow + screen-reader text ("opens in new tab") for a link that opens a new tab. */
export const newTabMark = (lang) => `<span class="ext" aria-hidden="true">↗</span><span class="sr-only"> (${makeT(lang)('a11y.newtab')})</span>`;
export const extLink = (href, html, lang, attrs = '') =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer"${attrs ? ' ' + attrs : ''}>${html}${newTabMark(lang)}</a>`;

/** Doc skeleton up to and including the skip link. The caller closes </body></html>. */
export function docOpen({ lang, title, description = '', extraCss = '', bodyClass = '' }) {
  lang = normLang(lang);
  const t = makeT(lang);
  const desc = description ? `<meta name="description" content="${esc(description)}">` : '';
  const cls = bodyClass ? ` class="${bodyClass}"` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">${desc}
<title>${title}</title>${LANG_BOOT}<style>${BB_CSS}${extraCss}</style></head><body${cls}>
<a class="skip" href="#main">${t('a11y.skip')}</a>`;
}

export function langToggle(lang) {
  const t = makeT(lang);
  const a = (code) => `<a href="?lang=${code}" hreflang="${code}" lang="${code}"${lang === code ? ' class="on" aria-current="true"' : ''}>${code.toUpperCase()}</a>`;
  return `<span class="langtoggle" role="group" aria-label="${t('lang.switch')}">${a('de')}${a('en')}</span>`;
}

/** crumb is trusted HTML built by the caller. The chip says where the demo really runs. */
export function appbar(crumb, lang, chip = null) {
  lang = normLang(lang);
  const t = makeT(lang);
  return `<header class="appbar"><div class="l"><a class="brand" href="https://bunsenbrenner.org"><span class="dot" aria-hidden="true">◆</span>Bunsenbrenner<span class="tld">.org</span></a>
    <nav class="crumb" aria-label="${t('crumb.nav')}">${crumb}</nav></div>
    <div class="r">${langToggle(lang)}<span class="chip" title="${esc(chip ? chip.title : t('chip.demo.title'))}"><span class="d" aria-hidden="true"></span>${chip ? esc(chip.text) : t('chip.demo')}</span></div></header>`;
}

export function support(lang) {
  const t = tr(lang);
  return [
    extLink('https://steady.page/plans/77a32d9c-c399-4ca1-9515-7a628c7a9413', t('Als Mitglied unterstützen', 'Support as a member'), lang, 'class="support"'),
    extLink('https://buymeacoffee.com/bunsenbrenner', 'Buy me a coffee', lang, 'class="support"'),
    extLink('https://github.com/scimbe/CADS-Tunnel', 'GitHub', lang),
    extLink('https://bunsenbrenner.org/legal-notice', t('Impressum', 'Legal notice'), lang),
    extLink('https://bunsenbrenner.org/privacy-policy', t('Datenschutz', 'Privacy policy'), lang),
    extLink('https://bunsenbrenner.org/terms-of-use', t('Nutzungsbedingungen', 'Terms of use'), lang),
  ].join('');
}

export function foot(lang) {
  lang = normLang(lang);
  const t = makeT(lang);
  return `<footer><div class="fl">${support(lang)}</div>
<div class="attrib"><b>Supported by ${extLink('https://bunsenbrenner.org', 'bunsenbrenner.org', lang)}</b>${SERVED_BY === 'bunsenbrenner.org' ? '' : ` · ${t('foot.hosted')} ${esc(SERVED_BY)}`}</div>
<div class="fnote">${t('foot.demo')} ${t('foot.llm')} · ${t('foot.photos')} ${extLink('https://www.pexels.com', 'Pexels', lang)}</div></footer>`;
}
