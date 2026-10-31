// "Draw in your browser" on /d/diagram: Graphviz as WebAssembly (static/vendor/graphviz), no server, no AI.
// The text-to-diagram step (an AI writes the DOT) stays on the server; this part only draws.
import { tr, normLang } from './i18n.mjs';
import { esc, jsonForScript } from './chrome.mjs';
import { BD_MAX_CHARS } from './diagram-browser-core.mjs';

export const BD_CSS = `
.bd{margin:18px 0;border:1px solid var(--border);border-radius:13px;background:var(--card);padding:0}
.bd>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;padding:0 18px;font-family:var(--serif);font-weight:600;font-size:1.1rem}
.bd-in{padding:0 18px 18px;display:grid;gap:10px}
.bd-in p{margin:0;color:var(--muted2);font-size:.9rem}
.bd-in textarea{width:100%;min-height:120px;border:1px solid var(--field);border-radius:8px;padding:.6rem .7rem;font:.88rem/1.5 var(--mono);color:var(--ink);background:var(--card)}
.bd-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.bd-err{border:2px solid var(--terra);border-radius:10px;padding:8px 12px;margin:0;font-weight:600}
.bd-out img{display:block;max-width:100%;background:#fff;border:1px solid var(--border);border-radius:9px}
`;

export function diagramBrowserBlock(lang, ver = '') {
  lang = normLang(lang);
  const t = tr(lang);
  const S = {
    busy: t('Lade Graphviz …', 'Loading Graphviz …'),
    empty: t('Schreibe zuerst etwas hinein.', 'Write something first.'),
    toolong: t(`Der Text ist länger als ${BD_MAX_CHARS} Zeichen.`, `The text is longer than ${BD_MAX_CHARS} characters.`),
    forbidden: t('Diese Angabe ist hier nicht erlaubt (Bild, Link oder Datei).', 'This setting is not allowed here (image, link or file).'),
    fail: t('Das lässt sich nicht zeichnen: {msg}', 'This cannot be drawn: {msg}'),
    load: t('Graphviz konnte nicht geladen werden. Prüfe deine Verbindung.', 'Graphviz could not be loaded. Check your connection.'),
    done: t('Fertig, in deinem Browser gezeichnet.', 'Done, drawn in your browser.'),
  };
  return `<details class="bd" id="bd" data-max="${BD_MAX_CHARS}" data-src="/static/vendor/graphviz/graphviz.js${ver ? `?v=${esc(ver)}` : ''}"><summary>${t('Selbst zeichnen, ohne Konto und ohne KI', 'Draw it yourself, no account and no AI')}</summary>
<div class="bd-in"><p>${t('Eine Zeile pro Kette, zum Beispiel A → B → C. Gezeichnet wird in deinem Browser (Graphviz als WebAssembly). Nichts wird gesendet.', 'One line per chain, for example A → B → C. It is drawn in your browser (Graphviz as WebAssembly). Nothing is sent.')}</p>
<label class="sr-only" for="bd-src">${t('Diagramm als Text', 'Diagram as text')}</label>
<textarea id="bd-src" maxlength="${BD_MAX_CHARS}" spellcheck="false">${t('Besucher -> Marktplatz -> Werkzeug -> Ergebnis\nMarktplatz -> Signatur prüfen', 'Visitor -> Marketplace -> Tool -> Result\nMarketplace -> Check signature')}</textarea>
<div class="bd-row"><button class="btn btn-primary" id="bd-go" type="button">${t('Im Browser zeichnen ▸', 'Draw in browser ▸')}</button><a class="chip" id="bd-dl" href="#" download="diagramm.svg" hidden>${t('SVG herunterladen', 'Download SVG')}</a></div>
<p class="bd-err" id="bd-err" role="alert" hidden></p><p id="bd-ok" role="status" hidden></p>
<div class="bd-out"><img id="bd-img" alt="${t('Diagramm', 'Diagram')}" hidden></div>
<script type="application/json" id="bd-strings">${jsonForScript(S)}</script><script type="module" src="/pb/diagram-browser.js${ver ? `?v=${esc(ver)}` : ''}"></script></div></details>`;
}
