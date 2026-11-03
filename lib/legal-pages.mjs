// Legal pages of My Daily Idea (legal notice, privacy, terms, accessibility, licences).
//
//   GET /duell/<page>      German      page = impressum | datenschutz | agb | barrierefreiheit | lizenzen
//   GET /duell/en/<page>   English
//
// The pages are built in the marketplace repo (apps/duell-web, `npm run build` -> dist/legal/) and copied here like
// dist/index.html. They are public on purpose: stores, the short link pages and the app link to them.
// A page that still holds a placeholder (⟦…⟧, the operator's details not filled in yet) is never served: the answer is
// 503 with a neutral note, so a half-finished legal notice cannot go live. test/legal-pages.test.mjs also fails the build
// while a committed page has one.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LEGAL_PAGES = ['impressum', 'datenschutz', 'agb', 'barrierefreiheit', 'lizenzen'];
export const PLACEHOLDER = '⟦';
const PATH = new RegExp(`^/duell/(?:(en)/)?(${LEGAL_PAGES.join('|')})/?$`);
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const WAIT = {
  de: ['Diese Seite wird gerade vorbereitet', 'Bitte versuch es später noch einmal.', 'Zur App'],
  en: ['This page is being prepared', 'Please try again later.', 'To the app'],
};

export function createLegalPages({ env = process.env, root, log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const dir = env.DUELL_LEGAL_DIR || (root ? join(root, 'apps', 'duell-web', 'dist', 'legal') : '');
  const fileOf = (lang, page) => (dir ? join(dir, lang === 'en' ? 'en' : '', `${page}.html`) : '');

  /** The page as it may go live, or null when it is missing or still holds a placeholder. */
  function load(lang, page) {
    const f = fileOf(lang, page);
    if (!f || !existsSync(f) || !statSync(f).isFile()) return null;
    const html = readFileSync(f, 'utf8');
    if (html.includes(PLACEHOLDER)) { log({ event: 'legal-placeholder', page, lang }); return null; }
    return html;
  }

  function send(req, res, status, html) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP });
    res.end(req.method === 'HEAD' ? undefined : html);
  }

  /** Returns true when the request was ours. Called before the login gate: these pages are public by design. */
  async function route(req, res, url) {
    const m = url.pathname.match(PATH);
    if (!m) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { req.resume(); res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return true; }
    const lang = m[1] === 'en' ? 'en' : 'de', html = load(lang, m[2]);
    if (html) { send(req, res, 200, html); return true; }
    const [t, d, back] = WAIT[lang];
    send(req, res, 503, `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${t}</title>`
      + '<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;box-sizing:border-box;background:#ffd400;color:#111;font:600 17px/1.4 system-ui,sans-serif;text-align:center}a{padding:13px 20px;background:#111;color:#ffd400;font-weight:800;text-decoration:none;border-radius:4px}</style>'
      + `</head><body><h1>${t}</h1><p>${d}</p><a href="/duell">${back}</a></body></html>`);
    return true;
  }

  return { route, load, dir };
}
