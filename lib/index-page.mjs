// The storefront: hero, "how it works", honest trust badges, searchable demo cards, and a
// collapsed "coming soon" group. Pure function of (demos, lang) so it can be unit-tested without
// starting the server.
import { motionHero, motionRow, motionScript, MOTION_CSS } from './motion.mjs';
import { docOpen, appbar, foot, esc, newTabMark, jsonForScript } from './chrome.mjs';
import { makeT, normLang, di, clientStrings } from './i18n.mjs';
import { buildSearchBlob } from './search.mjs';

const INDEX_CSS = `
.hero{padding-top:8px}
.hero h1{max-width:24ch}
.hero .cta{margin-top:18px}
.hero .cta a{text-decoration:none}
.sec-h{font-family:var(--serif);font-weight:600;font-size:1.4rem;line-height:1.2;margin:40px 0 4px}
.sec-sub{margin:0;color:var(--muted2);font-size:.95rem;max-width:70ch}
.how ol{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));counter-reset:step}
.how li{counter-increment:step;background:var(--card);border:1px solid var(--border);border-radius:13px;padding:16px 18px}
.how li::before{content:counter(step);display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--teal-fill);color:var(--on-accent);font:700 .9rem var(--mono);margin-bottom:10px}
.how h3,.trust h3{font-family:var(--serif);font-weight:600;font-size:1.1rem;margin:0 0 6px}
.how p,.trust li p{margin:0;color:var(--muted2);font-size:.92rem}
.trust ul{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))}
.trust li{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:16px 18px}
.badge{display:inline-flex;align-items:center;gap:6px;margin:0 0 8px;padding:.2rem .6rem;border-radius:999px;border:1px solid var(--border);font:600 .75rem var(--mono);color:var(--ink);background:var(--panel)}
.badge.active{border-color:var(--teal);color:var(--teal-ink)}
.badge.planned{border-style:dashed;color:var(--terra-ink)}
.trust .what{margin:14px 0 0;color:var(--muted2);font-size:.9rem;max-width:75ch}
.searchbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin-top:18px}
.searchbar input{flex:1 1 260px;min-width:0;min-height:44px;background:var(--card);border:1px solid var(--field);border-radius:10px;color:var(--ink);font:inherit;font-size:1rem;padding:.6rem .95rem}
.searchbar input::placeholder{color:var(--muted)}
.searchbar .scount{color:var(--muted);font-size:.85rem;white-space:nowrap}
.noresults{margin-top:22px;color:var(--muted2);font-size:.95rem;padding:18px;border:1.5px dashed var(--border);border-radius:12px;background:var(--card);text-align:center}
.noresults button{margin-left:8px;min-height:44px;background:var(--card);color:var(--teal-ink);border:1px solid var(--border);border-radius:8px;padding:.35rem .9rem;font:inherit;cursor:pointer}
.noresults button:hover{color:var(--ink)}
.cardtech{position:relative;z-index:1;margin:0 0 12px}
.cardtech summary{cursor:pointer;display:flex;align-items:center;min-height:44px;color:var(--muted2);font-size:.85rem;font-weight:600}
.cardtech summary,.soonsec>summary{list-style:none}.cardtech summary::-webkit-details-marker,.soonsec>summary::-webkit-details-marker{display:none}
.cardtech summary::before,.soonsec>summary::before{content:"▸";color:var(--teal-ink);margin-right:8px}.cardtech[open] summary::before,.soonsec[open]>summary::before{content:"▾"}
.cardtech p{margin:0 0 4px;padding:10px 12px;background:var(--panel);border-radius:8px;color:var(--muted2);font-size:.85rem}
.soonsec{margin-top:36px;border:1px solid var(--border);border-radius:13px;background:var(--panel)}
.soonsec>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;padding:6px 18px}
.soonsec>summary h2{margin:0;font-family:var(--serif);font-weight:600;font-size:1.2rem}
.soonsec .soonbody{padding:0 18px 18px}
.soonsec .cards{margin-top:12px}
.capbar .capnote{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0;padding:12px 16px;border:1px solid var(--border);border-radius:11px;background:var(--card);color:var(--muted2);font-size:.9rem}
.capbar .capnote b{color:var(--ink)}
`;

function renderCard(slug, d, lang, t) {
  const title = di(d, 'title', lang);
  const blurb = di(d, 'blurb', lang);
  const tech = di(d, 'tech', lang);
  const category = di(d, 'category', lang) || '';
  const search = esc(buildSearchBlob(slug, d, category));
  const id = `t-${slug}`;
  const techBlock = tech ? `<details class="cardtech"><summary>${t('card.tech')}</summary><p>${esc(tech)}</p></details>` : '';
  if (!d.live) {
    // Not startable yet: no link, announced as disabled, no "live" wording.
    return `<li><div class="dcard soon" role="group" aria-disabled="true" aria-labelledby="${id}" data-search="${search}"><span class="k">${category}</span><h3 id="${id}">${title}</h3><p>${blurb}</p>${techBlock}<span class="go soonlbl">◔ ${t('card.soon')}</span></div></li>`;
  }
  const external = d.type === 'external' && d.externalUrl;
  const href = external ? d.externalUrl : `/d/${slug}${lang === 'en' ? '?lang=en' : ''}`;
  const link = external
    ? `<a class="stretch" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${title}${newTabMark(lang)}</a>`
    : `<a class="stretch" href="${esc(href)}">${title}</a>`;
  return `<li><div class="dcard" data-search="${search}"><span class="k">${category}</span><h3>${link}</h3><p>${blurb}</p>${techBlock}<span class="go" aria-hidden="true">${external ? t('card.open.ext') : t('card.open')}</span></div></li>`;
}

// Live cards first (by demos.json "order", then file order); not-yet-startable ones go to "Demnächst".
export function partitionDemos(demos) {
  const entries = Object.entries(demos).filter(([, d]) => !d.hidden).map(([slug, d], i) => ({ slug, d, i }));
  const byOrder = (a, b) => (a.d.order ?? 999) - (b.d.order ?? 999) || a.i - b.i;
  return { live: entries.filter((e) => e.d.live).sort(byOrder), soon: entries.filter((e) => !e.d.live).sort(byOrder) };
}

export function indexPage(demos, lang, { sandboxLive = false } = {}) {
  lang = normLang(lang);
  const t = makeT(lang);
  const { live, soon } = partitionDemos(demos);
  const cards = live.map((e) => renderCard(e.slug, e.d, lang, t)).join('');
  const soonCards = soon.map((e) => renderCard(e.slug, e.d, lang, t)).join('');
  const badge = (state) => `<p class="badge ${state}"><span aria-hidden="true">${state === 'active' ? '✓' : '◔'}</span>${t('trust.status.' + (state === 'active' ? 'active' : 'planned'))}</p>`;
  const sandbox = sandboxLive ? ['sandbox', 'active', 'trust.sandbox.live'] : ['sandbox', 'planned']; // live = a cads-run release is configured
  const trust = [['unchanged', 'active'], ['signed', 'planned'], sandbox, ['saved', 'planned']]
    .map(([k, state, d]) => `<li>${badge(state)}<h3>${t(`trust.${k}.t`)}</h3><p>${t(d || `trust.${k}.d`)}</p></li>`).join('');
  const how = [1, 2, 3].map((n) => `<li><h3>${t(`how.${n}.t`)}</h3><p>${t(`how.${n}.d`)}</p></li>`).join('');

  return `${docOpen({ lang, title: t('index.title'), description: t('index.description'), extraCss: INDEX_CSS + MOTION_CSS })}
${appbar(`${t('crumb.market')} / <b>${t('crumb.demos')}</b>`, lang)}
<main class="wrap" id="main" tabindex="-1">
  <noscript><div class="noscript-note" role="note">${t('noscript.index')}</div></noscript>
  <section class="hero" aria-labelledby="h-hero">
    <div class="eyebrow"><span class="lead" aria-hidden="true">—</span>${t('hero.eyebrow')}</div>
    <h1 id="h-hero">${t('hero.h1')}</h1>
    <p class="lede">${t('hero.lede')}</p>
    <p class="cta"><a class="btn btn-primary" href="#demos">${t('hero.cta')}</a></p>
    ${motionHero(lang)}
  </section>
  <section class="how" aria-labelledby="h-how"><h2 class="sec-h" id="h-how">${t('how.title')}</h2><ol>${how}</ol></section>
  <section class="trust" aria-labelledby="h-trust"><h2 class="sec-h" id="h-trust">${t('trust.title')}</h2><ul>${trust}</ul><p class="what">${t('trust.what')}</p></section>
  <section id="demos" aria-labelledby="h-demos">
    <h2 class="sec-h" id="h-demos">${t('demos.title')}</h2>
    <div id="capbar" class="capbar" role="status" aria-live="polite" hidden></div>
    <div class="searchbar" id="searchbar" hidden><label class="sr-only" for="demoSearch">${t('search.label')}</label><input type="search" id="demoSearch" placeholder="${esc(t('search.placeholder'))}" autocomplete="off" spellcheck="false"><span class="scount" id="scount" role="status"></span></div>
    <ul class="cards" id="cards">${cards}</ul>
    <div class="noresults" id="noresults" role="status" hidden><span id="nrmsg"></span><button type="button" id="nrclear">${t('search.reset')}</button></div>
    ${soon.length ? `<details class="soonsec" id="soonsec"><summary><h2>${t('soon.title')} (${soon.length})</h2></summary><div class="soonbody"><p class="sec-sub">${t('soon.hint')}</p><ul class="cards" id="soonCards">${soonCards}</ul></div></details>` : ''}
  </section>
  ${motionRow(lang)}
</main>${foot(lang)}${motionScript()}
<script>
(function(){
  var S=${jsonForScript(clientStrings(lang))};
  function f(k,v){var s=S[k]||k;if(v)for(var n in v)s=s.split('{'+n+'}').join(v[n]);return s;}
  function esc(x){return String(x).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

  // ---- search (progressive enhancement: the search box only appears when JS runs) ----
  var inp=document.getElementById('demoSearch');
  if(inp){
    document.getElementById('searchbar').hidden=false;
    var cards=[].slice.call(document.querySelectorAll('.dcard'));
    var soon=document.getElementById('soonsec'), soonOpenedBySearch=false;
    var nr=document.getElementById('noresults'), nrmsg=document.getElementById('nrmsg'), clr=document.getElementById('nrclear'), sc=document.getElementById('scount');
    var apply=function(){
      var q=inp.value.trim().toLowerCase(), toks=q.split(/\\s+/).filter(Boolean), shown=0, soonShown=0;
      cards.forEach(function(c){
        var hay=c.getAttribute('data-search')||'';
        var ok=!toks.length||toks.every(function(t){return hay.indexOf(t)!==-1;});
        c.parentNode.hidden=!ok; if(ok){shown++; if(soon&&soon.contains(c))soonShown++;}
      });
      if(soon){
        soon.hidden=!!q&&soonShown===0;
        if(q&&soonShown>0&&!soon.open){soon.open=true;soonOpenedBySearch=true;}
        if(!q&&soonOpenedBySearch){soon.open=false;soonOpenedBySearch=false;}
      }
      sc.textContent=q?f('search.count',{shown:shown,total:cards.length}):'';
      if(q&&shown===0){nr.hidden=false;nrmsg.textContent=f('search.none',{q:inp.value.trim()});}else nr.hidden=true;
    };
    inp.addEventListener('input',apply);
    clr.addEventListener('click',function(){inp.value='';apply();inp.focus();});
  }

  // ---- live load of the AI services: friendly, specific states, retry button ----
  var bar=document.getElementById('capbar'); if(!bar) return;
  var last='';
  function show(html){ if(html===last) return; last=html; bar.innerHTML=html; bar.hidden=!html; var b=bar.querySelector('button'); if(b) b.addEventListener('click',function(){poll(true);}); }
  function chip(label,txt){return '<span class="capchip">'+esc(label)+': '+esc(txt)+'</span>';}
  function note(title,body){return '<p class="capnote"><span><b>'+esc(title)+'</b> '+esc(body)+'</span><button type="button" class="btn btn-ghost">'+esc(f('status.retry'))+'</button></p>';}
  var polling=false;
  async function poll(manual){
    if(polling) return; polling=true;
    if(manual) show('<p class="capnote">'+esc(f('status.checking'))+'</p>');
    try{
      var r=await fetch('/api/status',{cache:'no-store'});
      var j=await r.json();
      if(!j||!j.ok){ show(''); return; } // upstream unreachable: no dead widget
      var s=j.svc||{}, parts=[], tts=s['audio_generation.primary'], ol=s.ollama;
      if(tts){ var busy=(tts.active+tts.queued)>0; parts.push('<span class="capchip '+(busy?'cap-busy':'cap-free')+'">'+esc(f('status.tts'))+': '+esc(busy?f('status.busy',{q:tts.queued}):f('status.free'))+((tts.p50||tts.p50===0)?' · ~'+Number(tts.p50).toFixed(1)+' s':'')+'</span>'); }
      if(ol){ parts.push(chip(f('status.llm'),((ol.models&&ol.models.length)?ol.models.join(', '):f('status.loaded'))+(ol.parallel?' · '+f('status.parallel',{n:ol.parallel}):''))); }
      show(parts.length?'<span class="caplabel">'+esc(f('status.label'))+'</span>'+parts.join(''):'');
    }catch(e){ show(''); }
    finally{ polling=false; }
  }
  poll(false); setInterval(function(){poll(false);},15000);
})();
</script>
</body></html>`;
}
