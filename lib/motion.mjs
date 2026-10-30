// Embeds of the Claude Motion videos (static/motion). No autoplay: poster, controls, click to play;
// not muted -- the German cuts carry Thomas' narration, which plays because the visitor pressed play.
// preload="none" so nothing is downloaded before the visitor presses play. The narrow-screen cut
// (9:16) and the language (.en files, default caption track) are chosen here / by the small script.
import { esc, extLink } from './chrome.mjs';
import { tr } from './i18n.mjs';

const BASE = '/static/motion';

/** caption: plain text (escaped); link: optional {href, text} rendered after it as an external link. */
export function motionFigure(slug, lang, caption, link) {
  const en = lang === 'en';
  const sfx = en ? '.en' : '';
  const f = (shape, ext) => `${BASE}/${slug}-${shape}${sfx}.${ext}`;
  const track = (l, label) => `<track kind="captions" srclang="${l}" label="${label}"${l === lang ? ' default' : ''} src="${BASE}/captions/${slug}.${l}.vtt">`;
  return `<figure class="motion"><video controls playsinline preload="none" poster="${f('16x9', 'jpg')}" data-motion
    data-wide="${f('16x9', 'mp4')}" data-tall="${f('9x16', 'mp4')}" data-poster-wide="${f('16x9', 'jpg')}" data-poster-tall="${f('9x16', 'jpg')}">
    ${track('de', 'Deutsch')}${track('en', 'English')}</video>${caption || link ? `<figcaption>${esc(caption || '')}${link ? `${caption ? ' – ' : ''}${extLink(esc(link.href), esc(link.text), lang)}` : ''}</figcaption>` : ''}</figure>`;
}

export const MOTION_CSS = `.motion{margin:18px 0;max-width:46rem}.motion video{width:100%;height:auto;border-radius:12px;border:1px solid var(--border);background:#000;display:block}.motion figcaption{margin-top:6px;font-size:.85rem;color:var(--muted2)}.motion-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px}.motion-row .motion{margin:0;max-width:none}details.motion-d{margin:14px 0}details.motion-d>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;color:var(--teal-ink);font-weight:600;font-size:.92rem}`;

/** Picks the 9:16 cut on portrait screens; nothing starts by itself (reduced-motion safe by design). */
export const MOTION_JS = `(function(){var tall=matchMedia('(max-aspect-ratio: 1/1)').matches;document.querySelectorAll('video[data-motion]').forEach(function(v){v.poster=tall?v.dataset.posterTall:v.dataset.posterWide;v.src=tall?v.dataset.tall:v.dataset.wide;});})();`;
export const motionScript = () => `<script>${MOTION_JS}</script>`;

// Live apps the two use-case clips show (the appointment assistant has no gallery card of its own).
const TERMIN_URL = 'https://assistent-cal-f29c55da.bunsenbrenner.org/';
const REGION_URL = 'https://callcenter-34a13a96.bunsenbrenner.org/';

/** Two short use-case clips (each under 25 s) below the cards, each with a link to the live app. */
export const motionRow = (lang) => {
  const t = tr(lang);
  return `<section class="motionrow" aria-labelledby="h-look"><h2 class="sec-h" id="h-look">${t('Zwei Beispiele aus dem Alltag', 'Two everyday examples')}</h2><div class="motion-row">${
    motionFigure('termin-per-anruf', lang, t('Termin per Anruf buchen', 'Book an appointment by phone'), { href: TERMIN_URL, text: t('Salon Schnittwerk ausprobieren', 'Try Salon Schnittwerk') })}${
    motionFigure('frag-deine-region', lang, t('Frag deine Region', 'Ask about your region'), { href: REGION_URL, text: t('Sprachassistent ausprobieren', 'Try the voice assistant') })}</div></section>`;
};
/** Main video in the hero: one everyday use case, the three steps, what to click next. */
export const motionHero = (lang) => motionFigure('so-einfach', lang, tr(lang)('So einfach geht’s: Vorlage wählen, Angaben eintragen, Ergebnis bekommen.', 'That’s how simple it is: pick a template, enter your details, get the result.'));
export const motionTrust = (lang) => {
  const t = tr(lang);
  return `<details class="motion-d"><summary>${t('Wie funktioniert die Prüfung?', 'How does the check work?')}</summary>${motionFigure('herkunft', lang, '')}</details>`;
};
