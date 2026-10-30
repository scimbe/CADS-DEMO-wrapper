// Embeds of the Claude Motion videos (static/motion). No autoplay: poster, controls, click to play;
// not muted -- the German cuts carry Thomas' narration, which plays because the visitor pressed play.
// preload="none" so nothing is downloaded before the visitor presses play. The narrow-screen cut
// (9:16) and the language (.en files, default caption track) are chosen here / by the small script.
import { esc, extLink } from './chrome.mjs';
import { tr } from './i18n.mjs';

const BASE = '/static/motion';

/** caption: plain text (escaped); link: optional {href, text} rendered after it as an external link.
 *  lazy: for videos inside a closed <details>: no poster until the visitor opens it. */
export function motionFigure(slug, lang, caption, link, lazy = false) {
  const en = lang === 'en';
  const sfx = en ? '.en' : '';
  const f = (shape, ext) => `${BASE}/${slug}-${shape}${sfx}.${ext}`;
  const track = (l, label) => `<track kind="captions" srclang="${l}" label="${label}"${l === lang ? ' default' : ''} src="${BASE}/captions/${slug}.${l}.vtt">`;
  return `<figure class="motion"><video controls playsinline preload="none"${lazy ? '' : ` poster="${f('16x9', 'jpg')}"`} data-motion
    data-wide="${f('16x9', 'mp4')}" data-tall="${f('9x16', 'mp4')}" data-poster-wide="${f('16x9', 'jpg')}" data-poster-tall="${f('9x16', 'jpg')}">
    ${track('de', 'Deutsch')}${track('en', 'English')}</video>${caption || link ? `<figcaption>${esc(caption || '')}${link ? `${caption ? ' – ' : ''}${extLink(esc(link.href), esc(link.text), lang)}` : ''}</figcaption>` : ''}</figure>`;
}

export const MOTION_CSS = `.motion{margin:18px 0;max-width:46rem}.motion video{width:100%;height:auto;border-radius:12px;border:1px solid var(--border);background:#000;display:block}.motion figcaption{margin-top:6px;font-size:.85rem;color:var(--muted2)}.motion-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px}.motion-row .motion{margin:0;max-width:none}details.motion-d{margin:14px 0}.cardvid{position:relative;z-index:1;margin:0 0 12px}.cardvid summary{cursor:pointer;display:flex;align-items:center;gap:6px;min-height:44px;color:var(--teal-ink);font-size:.85rem;font-weight:600;list-style:none}.cardvid summary::-webkit-details-marker{display:none}.cardvid .motion{margin:6px 0 4px}details.motion-d>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;color:var(--teal-ink);font-weight:600;font-size:.92rem}`;

/** Picks the 9:16 cut on portrait screens; nothing starts by itself (reduced-motion safe by design). */
export const MOTION_JS = `(function(){var tall=matchMedia('(max-aspect-ratio: 1/1)').matches;document.querySelectorAll('video[data-motion]').forEach(function(v){var load=function(){if(v.dataset.ready)return;v.dataset.ready='1';v.poster=tall?v.dataset.posterTall:v.dataset.posterWide;v.src=tall?v.dataset.tall:v.dataset.wide;};var d=v.closest('details');if(d){d.addEventListener('toggle',function(){if(d.open)load();else v.pause();});if(d.open)load();}else load();});})();`;
export const motionScript = () => `<script>${MOTION_JS}</script>`;

// The appointment assistant has no gallery card of its own, so its clip stays below the cards.
const TERMIN_URL = 'https://assistent-cal-f29c55da.bunsenbrenner.org/';

/** Own clip of a demo card, collapsed: nothing loads until the visitor opens it. */
export const motionCard = (slug, lang) => `<details class="cardvid"><summary><span aria-hidden="true">▶</span> ${tr(lang)('Video ansehen', 'Watch the video')}</summary>${motionFigure(slug, lang, '', null, true)}</details>`;

export const motionRow = (lang) => {
  const t = tr(lang);
  return `<section class="motionrow" aria-labelledby="h-look"><h2 class="sec-h" id="h-look">${t('Noch ein Beispiel aus dem Alltag', 'One more everyday example')}</h2>${
    motionFigure('termin-per-anruf', lang, t('Termin per Anruf buchen', 'Book an appointment by phone'), { href: TERMIN_URL, text: t('Salon Schnittwerk ausprobieren', 'Try Salon Schnittwerk') })}</section>`;
};
/** Main video in the hero: one everyday use case, the three steps, what to click next. */
export const motionHero = (lang) => motionFigure('so-einfach', lang, tr(lang)('So einfach geht’s: Vorlage wählen, Angaben eintragen, Ergebnis bekommen.', 'That’s how simple it is: pick a template, enter your details, get the result.'));
export const motionTrust = (lang) => {
  const t = tr(lang);
  return `<details class="motion-d"><summary>${t('Wie funktioniert die Prüfung?', 'How does the check work?')}</summary>${motionFigure('herkunft', lang, '')}</details>`;
};
