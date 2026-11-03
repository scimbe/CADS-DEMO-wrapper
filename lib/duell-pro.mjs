// My Daily Idea: sponsor cards, AdSense on the web page, and the Pro subscription (no ads, more AI). Everything is off
// until its switch is set, because accounts and contracts come from the owner, never from this code.
//
//   POST /api/duell/ai/ad         { lang, kind } -> { ad | null }      (routed by duell-ai.mjs; context only, no device id)
//   GET  /api/duell/pro/buy       ?adult=1, login needed -> 302 to the Stripe Payment Link
//   POST /api/duell/pro/stripe    Stripe webhook (signed) -> Pro on / off
//   GET  /duell/kuendigen         § 312k BGB: "Verträge hier kündigen", no login needed
//   POST /duell/kuendigen         "jetzt kündigen" -> Stripe: cancel at the end of the paid month
//
// Switches (env):
//   DUELL_ADS_ENABLED=1 + DUELL_ADS_FILE         sponsor cards from a JSON file the owner writes (images inlined as data: URLs)
//   DUELL_ADSENSE_ENABLED=1 + _CLIENT + _SLOT     AdSense on /duell only: the page gets a nonce CSP that lets Google's script in
//   DUELL_PRO_ENABLED=1 + DUELL_PRO_PAYMENT_LINK + DUELL_STRIPE_WEBHOOK_SECRET + DUELL_STRIPE_SECRET_KEY   selling Pro
// Pro is kept as an HMAC of the account e-mail (and of the receipt e-mail) -> Stripe subscription id. No e-mail, name or card data is stored here.
// Ads are never chosen by person: the same day and kind give everybody the same card.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

const on = (v) => String(v ?? '') === '1';
const HASH = /^[a-f0-9]{32}$/, SUB = /^sub_[A-Za-z0-9]{6,64}$/, ID = /^[a-z0-9-]{1,40}$/;
const MAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const IMG_MAX = 100 * 1024, BODY_MAX = 64 * 1024, TOLERANCE_S = 300;
const clip = (v, n) => (typeof v === 'string' ? [...v.replace(/[\u0000-\u001f\u007f<>]/g, '')].slice(0, n).join('').trim() : '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Owner's ad file -> checked list. Bad entries are dropped and logged, never half shown.
export function loadAds(file, log = () => {}) {
  if (!file || !existsSync(file)) return [];
  let raw; try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { log({ event: 'duell-ads', ok: false, why: 'bad-json' }); return []; }
  const out = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    const by = clip(a && a.by, 40), url = (() => { try { const u = new URL(a.url); return u.protocol === 'https:' && !u.username ? u.href : ''; } catch { return ''; } })();
    const text = (L) => ({ t: clip(a[L] && a[L].t, 60), s: clip(a[L] && a[L].s, 90) });
    if (!a || !ID.test(a.id || '') || !by || !text('de').t) { log({ event: 'duell-ads', ok: false, why: 'bad-entry' }); continue; }
    let img = '';
    if (typeof a.img === 'string' && IMG[extname(a.img).toLowerCase()] && !a.img.includes('..')) {
      const p = join(dirname(file), a.img);
      try { const b = readFileSync(p); if (b.length <= IMG_MAX) img = `data:${IMG[extname(p).toLowerCase()]};base64,${b.toString('base64')}`; } catch {}
    }
    out.push({ id: a.id, by, kinds: Array.isArray(a.kinds) ? a.kinds.filter((k) => typeof k === 'string') : [], de: text('de'), en: text('en').t ? text('en') : text('de'), img, url });
  }
  return out;
}

// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.body">. Only v1 counts; old timestamps are refused (replay).
export function verifyStripe(raw, header, secret, nowS) {
  if (!secret || typeof header !== 'string') return false;
  let t = ''; const sigs = [];
  for (const kv of header.split(',')) { const [k, v] = kv.split('=', 2); if (k === 't') t = v; else if (k === 'v1' && /^[a-f0-9]{64}$/.test(v || '')) sigs.push(v); }
  if (!/^\d{1,12}$/.test(t) || Math.abs(nowS - Number(t)) > TOLERANCE_S || !sigs.length) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex'));
  return sigs.some((s) => timingSafeEqual(Buffer.from(s), want));
}

// AdSense on the web page: one nonce for every script, Google's recommended strict CSP, and the slot for ads.js.
export function adsensePage(html, { client, slot }, nonce) {
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https:; style-src 'unsafe-inline'; font-src data:; img-src data: blob: https:; media-src blob:; connect-src https: wss:; frame-src https:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const conf = `<script nonce="${nonce}">window.DUELL_ADSENSE=${JSON.stringify({ client, slot })};</script>`;
  return html
    .replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace(/<script>/g, `<script nonce="${nonce}">`)
    .replace(`<script nonce="${nonce}">`, conf + `<script nonce="${nonce}">`);
}

function cancelPage(lang, state) {
  const de = lang !== 'en';
  const T = de
    ? { title: 'Verträge hier kündigen', lead: 'Hier kündigst du dein Pro-Abo von My Daily Idea. Du brauchst kein Konto und kein Passwort.', mail: 'E-Mail-Adresse deines Kontos oder aus der Zahlungsbestätigung', when: 'Das Abo endet zum Ende des bezahlten Monats. Bis dahin bleibt Pro an.', go: 'jetzt kündigen',
      done: 'Deine Kündigung ist eingegangen. Wenn zu dieser Adresse ein Pro-Abo besteht, endet es zum Ende des bezahlten Monats. Die Bestätigung kommt per E-Mail.', bad: 'Bitte eine gültige E-Mail-Adresse eintragen.', down: 'Das hat gerade nicht geklappt. Bitte gleich nochmal versuchen.', off: 'Es gibt gerade kein Pro-Abo zu kaufen, also auch nichts zu kündigen.' }
    : { title: 'Cancel contracts here', lead: 'Cancel your My Daily Idea Pro subscription here. No account or password needed.', mail: 'E-mail address of your account or from the payment receipt', when: 'The subscription ends at the end of the paid month. Pro stays on until then.', go: 'cancel now',
      done: 'Your cancellation has arrived. If there is a Pro subscription for this address, it ends at the end of the paid month. The confirmation comes by e-mail.', bad: 'Please enter a valid e-mail address.', down: 'That did not work just now. Please try again in a moment.', off: 'There is no Pro subscription on sale right now, so nothing to cancel.' };
  const form = state === 'done' || state === 'off' ? '' : `<form method="post" action="/duell/kuendigen${de ? '' : '?lang=en'}"><label for="m">${T.mail}</label><input id="m" name="email" type="email" required maxlength="254" autocomplete="email"><p>${T.when}</p><button type="submit">${T.go}</button></form>`;
  const msg = state ? `<p role="status"><b>${esc(T[state])}</b></p>` : '';
  return `<!doctype html><html lang="${de ? 'de' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${T.title}</title>` +
    `<style>body{font:16px/1.4 system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fffaf0}input,button{font:inherit;width:100%;box-sizing:border-box;min-height:44px;margin:.4rem 0}button{background:#111;color:#fff;border:0;border-radius:6px;font-weight:800}</style></head>` +
    `<body><h1>${T.title}</h1><p>${T.lead}</p>${msg}${form}<p><a href="/duell">My Daily Idea</a></p></body></html>`;
}

export function createDuellPro({ env = process.env, auth, fetchFn = fetch, now = () => Date.now(), log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const cfg = {
    ads: on(env.DUELL_ADS_ENABLED), adsFile: env.DUELL_ADS_FILE || '',
    adsense: on(env.DUELL_ADSENSE_ENABLED) && /^ca-pub-\d{10,20}$/.test(env.DUELL_ADSENSE_CLIENT || '') && /^\d{5,15}$/.test(env.DUELL_ADSENSE_SLOT || ''),
    client: env.DUELL_ADSENSE_CLIENT || '', slot: env.DUELL_ADSENSE_SLOT || '',
    pro: on(env.DUELL_PRO_ENABLED), price: env.DUELL_PRO_PRICE || '2,99 €',
    link: /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_/-]{4,120}$/.test(env.DUELL_PRO_PAYMENT_LINK || '') ? env.DUELL_PRO_PAYMENT_LINK : '',
    whsec: env.DUELL_STRIPE_WEBHOOK_SECRET || '', sk: env.DUELL_STRIPE_SECRET_KEY || '',
    file: env.DUELL_PRO_STATE_FILE || '', cancelPerHour: Number(env.DUELL_PRO_CANCEL_PER_HOUR) || 60,
  };
  const selling = cfg.pro && !!cfg.link && !!cfg.whsec && !!cfg.sk && !!env.DUELL_AI_SALT;
  if (cfg.pro && !selling) log({ event: 'duell-pro-config', note: 'DUELL_PRO_ENABLED without payment link, webhook secret, secret key or DUELL_AI_SALT: not selling' });
  const salt = env.DUELL_AI_SALT || randomBytes(16).toString('hex');
  const mac = (email) => createHmac('sha256', salt).update('pro:' + String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
  const ads = cfg.ads ? loadAds(cfg.adsFile, log) : [];

  // Pro store: hash -> { s: subscription id, t: day }. Written atomically, like the AI allowance.
  const subs = new Map();
  if (cfg.file && existsSync(cfg.file)) { try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(cfg.file, 'utf8')))) if (HASH.test(k) && v && SUB.test(v.s)) subs.set(k, { s: v.s, t: v.t }); } catch { log({ event: 'duell-pro-store', ok: false, why: 'unreadable' }); } }
  function save() {
    if (!cfg.file) return;
    try { mkdirSync(dirname(cfg.file), { recursive: true }); const tmp = cfg.file + '.tmp'; writeFileSync(tmp, JSON.stringify(Object.fromEntries(subs))); renameSync(tmp, cfg.file); }
    catch { log({ event: 'duell-pro-store', ok: false, why: 'unwritable' }); }
  }
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const has = (email) => cfg.pro && !!email && subs.has(mac(email));
  const shop = (perDay) => (selling ? { buy: true, price: cfg.price, perDay } : undefined);

  // Same day + same kind -> same card for everybody.
  function ad(json, isPro) {
    if (!cfg.ads || isPro || !ads.length) return { ad: null };
    const kind = typeof json.kind === 'string' ? json.kind : '', lang = json.lang === 'en' ? 'en' : 'de';
    const fit = ads.filter((a) => !a.kinds.length || a.kinds.includes(kind)), list = fit.length ? fit : ads;
    const a = list[Math.floor(now() / 86400000) % list.length];
    return { ad: { id: a.id, by: a.by, t: a[lang].t, s: a[lang].s, img: a.img, url: a.url } };
  }
  function page(html) { return cfg.adsense ? adsensePage(html, cfg, randomBytes(16).toString('base64')) : html; }

  function event(ev) {
    const o = ev && ev.data && ev.data.object || {};
    if (ev.type === 'checkout.session.completed') {
      if (!HASH.test(o.client_reference_id || '') || !SUB.test(o.subscription || '')) return 'ignored';
      const e = { s: o.subscription, t: day() }, paid = o.customer_details && typeof o.customer_details.email === 'string' ? o.customer_details.email : '';
      subs.set(o.client_reference_id, e);
      if (MAIL.test(paid)) subs.set(mac(paid), e);   // the receipt address may differ from the account: both can cancel
      save(); return 'on';
    }
    const ended = ev.type === 'customer.subscription.deleted' || (ev.type === 'customer.subscription.updated' && ['canceled', 'unpaid', 'incomplete_expired'].includes(o.status));
    if (ended && SUB.test(o.id || '')) { let n = 0; for (const [k, v] of subs) if (v.s === o.id) { subs.delete(k); n++; } if (n) save(); return n ? 'off' : 'ignored'; }
    return 'ignored';
  }
  const cancels = { hour: -1, n: 0 };
  async function cancel(email) {
    const e = subs.get(mac(email));
    if (!e) return 'done';             // same answer whether or not the address has Pro: nobody can probe who pays
    const r = await fetchFn(`https://api.stripe.com/v1/subscriptions/${e.s}`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.sk}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cancel_at_period_end=true' });
    log({ event: 'duell-pro-cancel', ok: r.ok, status: r.status });
    return r.ok ? 'done' : 'down';
  }
  function body(req) {
    return new Promise((resolve) => {
      let n = 0; const parts = [];
      req.on('data', (c) => { n += c.length; if (n <= BODY_MAX) parts.push(c); });
      req.on('end', () => resolve(n > BODY_MAX ? null : Buffer.concat(parts).toString('utf8')));
      req.on('error', () => resolve(null));
    });
  }
  const html = (res, status, text) => res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }).end(text);

  async function route(req, res, url) {
    const p = url.pathname, lang = url.searchParams.get('lang') === 'en' ? 'en' : 'de';
    if (p === '/duell/kuendigen') {
      if (req.method === 'GET' || req.method === 'HEAD') { html(res, 200, cancelPage(lang, selling || subs.size ? '' : 'off')); return true; }
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, HEAD, POST' }).end(); return true; }
      const raw = await body(req), email = raw === null ? '' : String(new URLSearchParams(raw).get('email') || '').trim();
      if (!MAIL.test(email)) { html(res, 400, cancelPage(lang, 'bad')); return true; }
      const hour = Math.floor(now() / 3600000); if (cancels.hour !== hour) { cancels.hour = hour; cancels.n = 0; }
      if (++cancels.n > cfg.cancelPerHour) { html(res, 429, cancelPage(lang, 'down')); return true; }
      let state; try { state = await cancel(email); } catch { state = 'down'; }
      html(res, state === 'done' ? 200 : 503, cancelPage(lang, state)); return true;
    }
    if (p === '/api/duell/pro/buy') {
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end(); return true; }
      if (!selling) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('pro: not on sale'); return true; }
      if (url.searchParams.get('adult') !== '1') { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('pro: adults only'); return true; }
      const id = auth && auth.mode === 'gate' ? await auth.identify(req) : {};
      if (!id.email) { res.writeHead(302, { Location: '/auth/login?return=' + encodeURIComponent('/duell') }).end(); return true; }
      const to = new URL(cfg.link); to.searchParams.set('client_reference_id', mac(id.email));   // the hash, never the address: nothing personal in a URL
      res.writeHead(302, { Location: to.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end(); return true;
    }
    if (p === '/api/duell/pro/stripe') {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return true; }
      const raw = await body(req);
      if (raw === null || !cfg.pro || !verifyStripe(raw, req.headers['stripe-signature'], cfg.whsec, Math.floor(now() / 1000))) { res.writeHead(400).end(); return true; }
      let ev; try { ev = JSON.parse(raw); } catch { res.writeHead(400).end(); return true; }
      log({ event: 'duell-pro-webhook', type: String(ev.type).slice(0, 60), what: event(ev) });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); return true;
    }
    return false;
  }
  return { route, ad, page, has, shop, cfg, selling, mac, _subs: subs, _event: event };
}
