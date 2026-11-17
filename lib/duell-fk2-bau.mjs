// My Daily Idea, "Freie Karte 2" P3/P4: the build queue between the production wrapper and the build worker, the result of a
// build, the credit and the notification "Karte fertig". The worker (CADS-agent-marketplace apps/mdi/bau/, its own container)
// runs the generated code in Playwright; this process never does. Acceptance and credit are decided only by the worker's
// server run (runGame), never by a report from a browser.
//
//   POST /api/intern/fk2/holen     Bearer <DUELL_BAU_TOKEN_FILE>, {}  -> 200 { auftrag, lease, art } | 204 (nothing waiting)
//   POST /api/intern/fk2/ergebnis  Bearer, { auftrag, lease, art, ok, grund?, alt?, titel?, punkte?, spiel?, plan?, ... } -> 200 { ok }
//   Both answer 404 when the request came through the public tunnel (it carries DUELL_IP_HEADER) and 503 when the build is off.
//
// Queue: orders with bau.status "wartet" (oldest first). holen() leases one for DUELL_BAU_LEASE_MIN (20, more than the 15
// minutes the worker may build); an expired lease goes back into the queue once, the second time the build ends with grund
// "fehler" (nothing charged). The queue is rebuilt from the order files at start.
//
// Result: the worker's verdict per point (erfuellt, notiz in the person's words, geprueft gespielt|gelesen) is checked with the
// app's contract (checkErgebnis), every text again through the S1 word lists; the game module is checked (size, sha256) and
// written once as <DUELL_SPIEL_MODULE_DIR>/<sha256>.js, which the static game service (spiel-f29c55da…, 127.0.0.1:8794)
// serves read-only. Credit (decided 17.11.): 1 credit only on success, i.e. every point met; a partial result charges nothing
// (the person repairs for free, keeps it for 1 credit or reports it). A repair that fails the check keeps the previous version
// (hinweis "nachbessern_nicht_geschafft"). A build without a game says why (grund, closed list) and charges nothing.
//
// Notification (P4), only with the person's opt-in, also for a partial result, honest text: push (lib/duell-push.mjs, the
// device's mark, kinds karte-fertig | karte-fast | karte-nicht) and e-mail (lib/duell-mail.mjs) with a link to
// ?go=fertig&auftrag=<id>, no advertising. The e-mail address is stored with the order only while mail is ticked and deleted
// when the card is settled (kept, reported, fully done) or the order is deleted.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KINDS } from './duell-ai.mjs';
import * as K from './vendor/mdi/features/frei/klaerung.js';

const ID_RE = /^[A-Za-z0-9_-]{22}$/, SHA_RE = /^[0-9a-f]{64}$/;
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : d; };
/** Largest game module (= LIMITS.codeBytes of the app's game API) */
export const CODE_MAX = 65536;
export const LEASE_MIN = 20, VERSUCHE_MAX = 2;
const sha = (s) => createHash('sha256').update(s).digest();
const hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

export function bauConfig(env = process.env) {
  return {
    on: String(env.DUELL_BAU || '') === 'on',
    tokenFile: String(env.DUELL_BAU_TOKEN_FILE || ''),
    spielOrigin: String(env.DUELL_SPIEL_ORIGIN || ''),
    moduleDir: String(env.DUELL_SPIEL_MODULE_DIR || ''),
    appUrl: String(env.DUELL_APP_URL || ''),
    leaseMs: num(env.DUELL_BAU_LEASE_MIN, LEASE_MIN) * 60000,
    ipHeader: String(env.DUELL_IP_HEADER || '').toLowerCase(),
  };
}

/** Texts of the notification (closed list of kinds; the order's language) */
export const MAIL_TEXT = {
  de: {
    'karte-fertig': { subject: 'Deine Karte ist fertig', text: (o) => `Hallo,\n\ndeine Karte „${o.titel}“ ist fertig. Alle ${o.n} Punkte sind erfüllt. ${o.kosten} Guthaben ist abgebucht.\n\nAnsehen und ausprobieren:\n${o.link}` },
    'karte-fast': { subject: 'Deine Karte ist fast fertig', text: (o) => `Hallo,\n\ndeine Karte „${o.titel}“ ist fast fertig – ${o.fehlt === 1 ? 'ein Punkt fehlt' : o.fehlt + ' Punkte fehlen'} noch. Abgebucht ist nichts.\nDu kannst kostenlos nachbessern lassen oder die Karte so behalten.\n\nAnsehen:\n${o.link}` },
    'karte-nicht': { subject: 'Deine Karte hat nicht geklappt', text: (o) => `Hallo,\n\ndeine Karte „${o.titel}“ hat leider nicht geklappt. Abgebucht ist nichts.\n\nWas passiert ist:\n${o.link}` },
    fuss: '\n\nDiese E-Mail kommt nur, weil du beim Bauen „E-Mail an dein Konto“ angehakt hast. Sie gilt nur für diese Karte.\n\nbunsenbrenner\n',
  },
  en: {
    'karte-fertig': { subject: 'Your card is ready', text: (o) => `Hello,\n\nyour card “${o.titel}” is ready. All ${o.n} points are done. ${o.kosten} credit is charged.\n\nSee and try it:\n${o.link}` },
    'karte-fast': { subject: 'Your card is almost ready', text: (o) => `Hello,\n\nyour card “${o.titel}” is almost ready – ${o.fehlt === 1 ? 'one point is' : o.fehlt + ' points are'} still missing. Nothing is charged.\nYou can have it fixed for free or keep it as it is.\n\nSee it:\n${o.link}` },
    'karte-nicht': { subject: 'Your card did not work out', text: (o) => `Hello,\n\nyour card “${o.titel}” did not work out, sorry. Nothing is charged.\n\nWhat happened:\n${o.link}` },
    fuss: '\n\nYou get this e-mail only because you ticked “E-mail to your account” when building. It is only about this card.\n\nbunsenbrenner\n',
  },
};
export const KARTE_KINDS = ['karte-fertig', 'karte-fast', 'karte-nicht'];

/**
 * @param {{env?:object, store:object, shared?:object, push?:{notify?:Function, on?:Function}, mail?:{on:Function, send:Function}, now?:() => number, log?:(o:object)=>void}} o
 *   store: the order store of lib/duell-klaerung.mjs (get, put, ids); shared.credit: lib/duell-credit.mjs
 */
export function createBau({ env = process.env, store, shared = {}, push = null, mail = null, now = () => Date.now(), log = (x) => console.log(JSON.stringify(x)) } = {}) {
  const cfg = bauConfig(env);
  const problems = [];
  if (cfg.on) {
    if (!cfg.tokenFile) problems.push('DUELL_BAU_TOKEN_FILE');
    if (!/^https:\/\/[a-z0-9.-]+$/.test(cfg.spielOrigin)) problems.push('DUELL_SPIEL_ORIGIN');
    if (!cfg.moduleDir) problems.push('DUELL_SPIEL_MODULE_DIR');
    if (!/^https?:\/\/[^?#]+$/.test(cfg.appUrl)) problems.push('DUELL_APP_URL');
    if (!store || !store.ids) problems.push('order store');
    if (problems.length) log({ event: 'duell-bau-config', note: 'build off, check ' + problems.join(', ') });
  }
  const on = () => cfg.on && problems.length === 0;
  const metric = (outcome, ms = 0) => { if (shared.metric) try { shared.metric('fk2-bau', outcome, ms); } catch { /* optional */ } };
  const queue = [];                 // order ids waiting, oldest first
  const leases = new Map();         // order id -> { lease, until }

  if (on()) {
    const waiting = [];
    for (const id of store.ids()) { const o = store.get(id); if (o && o.bau && (o.bau.status === 'wartet' || o.bau.status === 'laeuft')) waiting.push(o); }
    // a build that was running when the wrapper stopped is waiting again (its worker reports to a lease that no longer exists)
    for (const o of waiting.sort((a, b) => (a.bau.at < b.bau.at ? -1 : 1))) { if (o.bau.status === 'laeuft') { o.bau.status = 'wartet'; save(o); } queue.push(o.id); }
    if (queue.length) log({ event: 'duell-bau-queue', waiting: queue.length });
  }
  function save(o) { store.put(o); }

  /** P1 hands a confirmed order (art neu) or a repair (art nachbessern) to the build */
  function einreihen(o, art, kundentext = '') {
    o.bau = { status: 'wartet', art, at: new Date(now()).toISOString(), versuch: 0, ...(kundentext ? { kundentext } : {}) };
    save(o);
    if (!queue.includes(o.id)) queue.push(o.id);
    metric('eingereiht-' + art);
  }

  function expire() {
    const t = now();
    for (const [id, l] of leases) {
      if (l.until > t) continue;
      leases.delete(id);
      const o = store.get(id);
      if (!o || !o.bau || o.bau.status !== 'laeuft') continue;
      if (o.bau.versuch >= VERSUCHE_MAX) { abschliessen(o, { ok: false, grund: 'fehler', art: o.bau.art }); log({ event: 'duell-bau', ok: false, why: 'lease-expired' }); continue; }
      o.bau.status = 'wartet'; save(o); queue.push(id);
      log({ event: 'duell-bau', note: 'lease expired, queued again' });
    }
  }

  /** what the worker needs, nothing else (no owner, no address, no opt-in) */
  function jobOf(o) {
    const a = { id: o.id, lang: o.lang, satz: o.satz, titel: o.titel, verstehe: o.verstehe, punkte: o.punkte, nicht: o.nicht,
      fragen: (o.fragen || []).map((f) => ({ frage: f.frage, antwort: f.antwort.art === 'eigen' ? f.antwort.text : f.antwort.art === 'kachel' ? f.antwort.label : 'egal' })) };
    if (o.bau.art === 'nachbessern') {
      const vorher = o.ergebnisse && o.ergebnisse[o.ergebnisse.length - 1];
      const code = o.spiel ? readModule(o.spiel.sha256) : null;
      if (!vorher || !code || !o.bauPlan) return null;
      a.nachbessern = { code, plan: o.bauPlan, punkte: vorher.punkte.map((p) => ({ id: p.id, erfuellt: p.erfuellt, notiz: p.notiz })), kundentext: o.bau.kundentext || '' };
    }
    return a;
  }
  function holen() {
    expire();
    while (queue.length) {
      const id = queue.shift(), o = store.get(id);
      if (!o || !o.bau || o.bau.status !== 'wartet') continue;
      const job = jobOf(o);
      if (!job) { abschliessen(o, { ok: false, grund: 'fehler', art: o.bau.art }); log({ event: 'duell-bau', ok: false, why: 'no-previous-version' }); continue; }
      const lease = randomBytes(16).toString('base64url');
      o.bau.status = 'laeuft'; o.bau.versuch += 1;
      save(o);
      leases.set(id, { lease, until: now() + cfg.leaseMs });
      metric('geholt-' + o.bau.art);
      return { status: 200, body: { auftrag: job, lease, art: o.bau.art } };
    }
    return { status: 204, body: null };
  }

  // ---- result ------------------------------------------------------------------------------------------------------
  const moduleFile = (h) => join(cfg.moduleDir, `${h}.js`);
  function readModule(h) { try { return SHA_RE.test(h) ? readFileSync(moduleFile(h), 'utf8') : null; } catch { return null; } }
  function writeModule(code, h) {
    if (!existsSync(cfg.moduleDir)) mkdirSync(cfg.moduleDir, { recursive: true });
    const f = moduleFile(h);
    if (existsSync(f)) return;
    writeFileSync(f + '.tmp', code, { mode: 0o644 }); renameSync(f + '.tmp', f);
  }
  /** checks of a successful result -> { ergebnis, spiel } | { bad } */
  function pruefe(o, b) {
    const e = K.checkErgebnis({ titel: o.titel, punkte: b.punkte }, o.punkte);
    if (!e) return { bad: 'ergebnis' };
    for (const p of e.punkte) if (p.notiz && KINDS.karte.s1w(p.notiz, false)) return { bad: 'notiz-s1' };
    const s = b.spiel;
    if (!s || typeof s.code !== 'string' || !s.code || Buffer.byteLength(s.code) > CODE_MAX || !SHA_RE.test(String(s.sha256)) || hex(s.code) !== s.sha256) return { bad: 'spiel' };
    if (!b.plan || typeof b.plan !== 'object' || JSON.stringify(b.plan).length > 65536) return { bad: 'plan' };
    return { ergebnis: { titel: e.titel, punkte: e.punkte.map((p) => ({ id: p.id, erfuellt: p.erfuellt, notiz: p.notiz, geprueft: p.geprueft })) }, spiel: { sha256: s.sha256 } };
  }

  /** settles a build (also used for an expired lease); charges and notifies */
  function abschliessen(o, b, checked = null) {
    const art = o.bau.art, t = new Date(now()).toISOString();
    leases.delete(o.id);
    let kind;
    if (checked) {
      writeModule(b.spiel.code, checked.spiel.sha256);
      o.ergebnis = checked.ergebnis; o.spiel = checked.spiel; o.bauPlan = b.plan; o.status = 'fertig'; delete o.hinweis;
      const fehlt = checked.ergebnis.punkte.filter((p) => !p.erfuellt).length;
      o.bau = { status: 'fertig', art, at: t, ms: b.ms, usd: b.usd };
      if (fehlt === 0) charge(o);
      kind = fehlt === 0 ? 'karte-fertig' : 'karte-fast';
      metric(fehlt === 0 ? 'erfolg' : 'teilerfolg', b.ms);
    } else if (art === 'nachbessern') {
      // the repair failed the check (or the time or cost limit): the previous version stays, the counter stays used
      const vorher = o.ergebnisse && o.ergebnisse[o.ergebnisse.length - 1];
      o.ergebnis = vorher || null; o.status = 'fertig'; o.hinweis = 'nachbessern_nicht_geschafft';
      o.bau = { status: 'fertig', art, at: t, grund: K.BAU_GRUENDE.includes(b.grund) ? b.grund : 'fehler' };
      kind = 'karte-fast';
      metric('nachbessern-' + o.bau.grund);
    } else {
      o.bau = { status: 'gescheitert', art, at: t, grund: K.BAU_GRUENDE.includes(b.grund) ? b.grund : 'fehler' };
      kind = 'karte-nicht';
      metric('gescheitert-' + o.bau.grund);
    }
    save(o);
    return kind;
  }
  /** 1 credit, only on success; a card without credit left stays delivered and says so (kosten.offen) */
  function charge(o) {
    if (o.kosten && (o.kosten.abgebucht || o.kosten.erlassen)) return;
    const n = o.kosten && Number.isInteger(o.kosten.guthaben) ? o.kosten.guthaben : K.KOSTEN;
    const credit = shared.credit;
    const ok = !!(credit && credit.spend && credit.spend(o.owner, n));
    o.kosten = { ...o.kosten, abgebucht: ok, ...(ok ? { abgebuchtAm: new Date(now()).toISOString() } : { offen: true }) };
    metric(ok ? 'abgebucht' : 'abbuchen-fehlt');
    if (!ok) log({ event: 'duell-bau', ok: false, why: 'credit-missing' });
  }

  async function ergebnis(b) {
    if (!b || typeof b !== 'object' || !ID_RE.test(String(b.auftrag)) || typeof b.lease !== 'string' || typeof b.ok !== 'boolean') return { status: 400, body: { error: 'bad-request' } };
    const o = store.get(b.auftrag), l = leases.get(b.auftrag);
    if (!o || !o.bau || o.bau.status !== 'laeuft' || !l || !safeEq(l.lease, b.lease)) return { status: 409, body: { error: 'lease' } };
    if (b.art !== o.bau.art) return { status: 400, body: { error: 'art' } };
    let checked = null;
    if (b.ok) {
      checked = pruefe(o, b);
      if (checked.bad) { log({ event: 'duell-bau', ok: false, why: 'result-' + checked.bad }); b = { ok: false, grund: 'fehler' }; checked = null; }
    } else if (!K.BAU_GRUENDE.includes(b.grund)) return { status: 400, body: { error: 'grund' } };
    const kind = abschliessen(o, { ...b, art: o.bau.art }, checked);
    await benachrichtigen(o, kind);
    return { status: 200, body: { ok: true } };
  }

  // ---- notification (P4) ---------------------------------------------------------------------------------------------
  async function benachrichtigen(o, kind) {
    const optin = o.optin || {};
    const link = `${cfg.appUrl}?go=fertig&auftrag=${o.id}`;
    if (optin.push && push && push.notify && optin.mark) {
      try { await push.notify(optin.mark, kind); } catch { log({ event: 'duell-bau-push', ok: false }); }
    }
    if (optin.mail && optin.adresse && mail && mail.on()) {
      const L = MAIL_TEXT[o.lang === 'en' ? 'en' : 'de'], e = o.ergebnis;
      const r = await mail.send({ to: optin.adresse, subject: L[kind].subject,
        text: L[kind].text({ titel: o.titel, link, n: e ? e.punkte.length : 0, fehlt: e ? e.punkte.filter((p) => !p.erfuellt).length : 0, kosten: o.kosten && o.kosten.guthaben || K.KOSTEN }) + L.fuss });
      metric(r.ok ? 'mail' : 'mail-' + r.why);
    }
    // the address is kept only while it can still be needed (a repair sends again); a settled card does not need it
    if (kind === 'karte-fertig' || kind === 'karte-nicht') vergessen(o);
  }
  /** deletes the e-mail address and the push mark of an order (settled, kept, reported) */
  function vergessen(o) {
    if (!o.optin || (!o.optin.adresse && !o.optin.mark)) return;
    const { adresse, mark, ...rest } = o.optin; void adresse; void mark;
    o.optin = rest; save(o);
  }

  // ---- internal routes -----------------------------------------------------------------------------------------------
  function authorized(req) {
    let token = '';
    try { token = readFileSync(cfg.tokenFile, 'utf8').trim(); } catch { return false; }
    const m = String(req.headers.authorization || '').match(/^Bearer (\S{16,200})$/);
    return token.length >= 16 && !!m && timingSafeEqual(sha(m[1]), sha(token));
  }
  async function readBody(req, max) {
    let size = 0; const parts = [];
    for await (const c of req) { size += c.length; if (size > max) return undefined; parts.push(c); }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { return undefined; }
  }
  const send = (res, status, body) => { if (body === null) { res.writeHead(status, { 'Cache-Control': 'no-store' }).end(); return; } const s = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(s) }).end(s); };
  async function route(req, res, url) {
    if (!url.pathname.startsWith('/api/intern/fk2/')) return false;
    const sub = url.pathname.slice('/api/intern/fk2/'.length);
    // only from inside: whatever the public tunnel forwards carries the client-IP header
    if (cfg.ipHeader && req.headers[cfg.ipHeader] !== undefined) { req.resume(); send(res, 404, { error: 'not-found' }); return true; }
    if (sub !== 'holen' && sub !== 'ergebnis') { req.resume(); send(res, 404, { error: 'not-found' }); return true; }
    if (req.method !== 'POST') { req.resume(); res.writeHead(405, { Allow: 'POST' }).end(); return true; }
    if (!on()) { req.resume(); send(res, 503, { error: 'off' }); return true; }
    if (!authorized(req)) { req.resume(); res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end(); return true; }
    const json = await readBody(req, sub === 'ergebnis' ? 256 * 1024 : 1024);
    if (json === undefined) { send(res, 400, { error: 'bad-request' }); return true; }
    const r = sub === 'holen' ? holen() : await ergebnis(json);
    send(res, r.status, r.body);
    return true;
  }

  /** what the person may tick on the build screen: only channels that can really deliver */
  const kanaele = () => ({ push: !!(push && push.on && push.on()), mail: !!(mail && mail.on()) });
  /** the spiel reference of an order for the app (null without a game) */
  const spielRef = (o) => (o && o.spiel && SHA_RE.test(o.spiel.sha256) ? { rahmen: cfg.spielOrigin + '/frame.html', modul: `${cfg.spielOrigin}/m/${o.spiel.sha256}.js`, sha256: o.spiel.sha256 } : null);
  return { on, route, einreihen, holen, ergebnis, charge, vergessen, kanaele, spielRef, cfg, _queue: queue, _leases: leases };
}

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
