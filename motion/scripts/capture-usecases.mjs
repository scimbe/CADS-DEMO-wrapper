// Echte Bildschirmaufnahmen fuer "So einfach geht's" und die Anwendungsfall-Clips.
// Schreibt PNG nach motion/public/real/uc/ (per .gitignore ausgeschlossen; danach in JPG umwandeln)
// und rects.json (Lage markierter Elemente als Bildanteile 0..1, fuer Ring-Overlays).
//
// Was hier passiert:
// - Galerie und Wetter-Briefing: nur Seiten laden und das Formular im Browser ausfuellen (kein Lauf).
// - Callcenter: eine Beispielfrage stellen (liest nur Deutschlandatlas-Daten).
// - Terminassistent: per Textfeld einen Termin buchen und ihn im selben Lauf wieder absagen.
//   Telefonnummer aus dem fiktiven Bereich der Bundesnetzagentur (040 66969 xxx), Name fiktiv.
//
// - Auktion, Keyforge, Flappy: echte Laeufe ohne Login. Tutor: oeffentliche Seite plus Dokumentations-Screenshots.
// - phototools, temporal-poc, diagram, contractcheck: Login-pflichtig, daher echte Seite + Aufzeichnung (recordings/).
//
// Aufruf: node scripts/capture-usecases.mjs [gallery|newsletter|callcenter|termin|auction|keyforge|flappy|tutor|phototools|temporal-poc|diagram|contractcheck|erklaervideo ...]
import {openBrowser, ensureBrowser} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'real', 'uc');
fs.mkdirSync(out, {recursive: true});
const rectsFile = path.join(out, 'rects.json');
const rects = fs.existsSync(rectsFile) ? JSON.parse(fs.readFileSync(rectsFile, 'utf8')) : {};
const GALLERY = 'https://demos-34a13a96.bunsenbrenner.org';
const CALL = 'https://callcenter-34a13a96.bunsenbrenner.org/';
const CAL = 'https://assistent-cal-f29c55da.bunsenbrenner.org/';
const only = process.argv.slice(2);
const want = (k) => (only.length ? only.includes(k) : k !== 'termin' && k !== 'termin-start'); // Termin bucht wirklich: nur ausdruecklich
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESK = {w: 1440, h: 900};
const MOB = {w: 390, h: 844};

await ensureBrowser();
const browser = await openBrowser('chrome');
async function open(url, {w, h}) {
  const page = await browser.newPage({context: () => null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => undefined});
  await page.setViewport({width: w, height: h, deviceScaleFactor: 2});
  await page.goto({url, timeout: 60000});
  await sleep(3000);
  return page;
}
const ev = async (page, fn, ...args) => (await page.evaluate(fn, ...args));
async function snap(page, name) {
  const r = await page._client().send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(String(r.value.data ?? r.value), 'base64'));
  console.log('ok', name);
}
/** Lage des ersten Blatt-Elements mit Text t (oder Selektor sel) relativ zum Viewport, als Anteil. */
async function mark(page, name, key, {t, sel, up = 0}) {
  const r = await ev(page, (t, sel, up) => {
    let el = sel ? document.querySelector(sel) : [...document.querySelectorAll('body *')].filter((e) => (e.innerText || '').includes(t) && e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().height > 8).sort((a, b) => a.innerText.length - b.innerText.length)[0];
    for (let i = 0; el && i < up; i++) el = el.parentElement;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {x: b.left / innerWidth, y: b.top / innerHeight, w: b.width / innerWidth, h: b.height / innerHeight};
  }, t ?? null, sel ?? null, up);
  if (!r) { const bt = await ev(page, () => document.body.innerText.slice(0, 1500)); throw new Error(`mark ${name}/${key}: not found\n` + bt); }
  (rects[name] ??= {})[key] = r;
}
const scrollToText = (page, t, off = 24) => ev(page, (t, off) => {
  const el = [...document.querySelectorAll('body *')].filter((e) => (e.innerText || '').includes(t) && e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().height > 8).sort((a, b) => a.innerText.length - b.innerText.length)[0];
  el?.scrollIntoView({block: 'start'}); window.scrollBy(0, -off);
}, t, off).then(() => sleep(700));

// ---------- Galerie ----------
const LANGS = [['', '?lang=de'], ['-en', '?lang=en']]; // Sprache fest setzen: die Galerie merkt sich die zuletzt gewaehlte
if (want('gallery')) for (const [L, q] of LANGS) for (const [k0, vp] of [['desk', DESK], ['mob', MOB]]) {
  const k = k0 + L;
  const p = await open(GALLERY + '/' + q, vp);
  await snap(p, `gallery-top-${k}`);
  // Desktop: Kartenraster ab erster Reihe; Handy: die Wetter-Briefing-Karte oben im Bild
  await ev(p, (mob) => {
    if (mob) { document.querySelector('a.stretch[href^="/d/newsletter"]').closest('li').scrollIntoView({block: 'start'}); window.scrollBy(0, -260); }
    else { document.getElementById('cards').scrollIntoView({block: 'start'}); window.scrollBy(0, -90); }
  }, k0 === 'mob');
  await sleep(800);
  await snap(p, `gallery-cards-${k}`);
  await mark(p, `gallery-cards-${k}`, 'card', {sel: 'a.stretch[href^="/d/newsletter"]'});
  await mark(p, `gallery-cards-${k}`, 'cardbox', {sel: 'a.stretch[href^="/d/newsletter"]', up: 2});
  await p.close({silent: true});
}

// ---------- Wetter-Briefing: Vorlage und eigene Angaben ----------
if (want('newsletter')) for (const [L, q] of LANGS) for (const [k0, vp] of [['desk', DESK], ['mob', MOB]]) {
  const k = k0 + L;
  const p = await open(GALLERY + '/d/newsletter' + q, vp);
  const okText = L ? 'Signature is fine' : 'Signatur in Ordnung';
  for (let i = 0; i < 40 && !(await ev(p, (t) => document.body.innerText.includes(t), okText)); i++) await sleep(500);
  await scrollToText(p, L ? 'Signature is fine' : 'Prüfung der Vorlage', 220);
  await snap(p, `nl-check-${k}`);
  await mark(p, `nl-check-${k}`, 'ok', {t: L ? 'Signature is fine' : 'Signatur in Ordnung'});
  await ev(p, (hint) => {
    const s = document.getElementById('pb-f-location'); s.value = 'Bremen'; s.dispatchEvent(new Event('change', {bubbles: true}));
    const t = document.getElementById('pb-f-own_context'); t.value = hint; t.dispatchEvent(new Event('input', {bubbles: true}));
    document.querySelector('input[name=pb-r-tone][value=freundlich]').click();
  }, L ? 'Sailing group, highlight wind and rain' : 'Segelgruppe, Wind und Regen hervorheben');
  await ev(p, () => { document.getElementById('pb-f-location').scrollIntoView({block: 'start'}); window.scrollBy(0, -200); });
  await sleep(700);
  await snap(p, `nl-form-top-${k}`);
  await mark(p, `nl-form-top-${k}`, 'ort', {sel: '#pb-f-location'});
  await ev(p, () => { const el = document.getElementById('pb-f-own_context'); el.scrollIntoView({block: 'center'}); });
  await sleep(700);
  await snap(p, `nl-form-hint-${k}`);
  await mark(p, `nl-form-hint-${k}`, 'hint', {sel: '#pb-f-own_context'});
  await p.close({silent: true});
}

// ---------- Callcenter: Frag deine Region ----------
if (want('callcenter')) for (const [k, vp] of [['desk', DESK], ['mob', MOB]]) {
  const p = await open(CALL, vp);
  await snap(p, `cc-start-${k}`);
  await mark(p, `cc-start-${k}`, 'call', {sel: '#mic'});
  await ev(p, () => { const q = document.getElementById('q'); q.value = 'Wie viele Hausärzte gibt es je 100.000 Einwohner in Hannover?'; q.dispatchEvent(new Event('input', {bubbles: true})); document.getElementById('go').click(); });
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev(p, () => /\d/.test(document.getElementById('a').innerText) && !!document.getElementById('srcTxt').innerText)) break; }
  await sleep(1500);
  await ev(p, () => { document.getElementById('qEcho').scrollIntoView({block: 'center'}); });
  await sleep(600);
  await snap(p, `cc-answer-${k}`);
  await mark(p, `cc-answer-${k}`, 'answer', {sel: '#a'});
  await mark(p, `cc-answer-${k}`, 'src', {sel: '#src'});
  const txt = await ev(p, () => ({q: document.getElementById('qEcho').innerText, a: document.getElementById('a').innerText, src: document.getElementById('src').innerText}));
  (rects[`cc-answer-${k}`] ??= {}).text = txt;
  console.log(k, JSON.stringify(txt));
  await p.close({silent: true});
}

// ---------- Terminassistent: buchen und wieder absagen ----------
if (want('termin-start')) for (const [k, vp] of [['desk', DESK], ['mob', MOB]]) {
  // Nur die Startseite, ohne Termin
  const p = await open(CAL, vp);
  await ev(p, () => { const d = document.querySelector('details.steps-details'); if (d) d.open = false; });
  await snap(p, `cal-start-${k}`);
  await mark(p, `cal-start-${k}`, 'call', {sel: '#call-btn'});
  await p.close({silent: true});
}
if (want('termin')) {
  const p = await open(CAL, DESK);
  await ev(p, () => { const d = document.querySelector('details.steps-details'); if (d) d.open = false; });
  await snap(p, 'cal-start-desk');
  await mark(p, 'cal-start-desk', 'call', {sel: '#call-btn'});
  const say = async (msg) => {
    const before = await ev(p, () => document.getElementById('transcript').innerText.length);
    await ev(p, (m) => { const i = document.getElementById('text-input'); i.value = m; i.dispatchEvent(new Event('input', {bubbles: true})); document.getElementById('text-form').requestSubmit(); }, msg);
    let last = '', stable = 0;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      const cur = await ev(p, () => document.getElementById('transcript').innerText);
      if (cur.length > before + msg.length + 5) { stable = cur === last ? stable + 1 : 0; last = cur; if (stable >= 4) break; }
    }
    const all = await ev(p, () => document.getElementById('transcript').innerText);
    console.log('>>', msg, '\n<<', all.slice(-400).replace(/\n+/g, ' | '));
    return all;
  };
  const scrollTranscript = () => ev(p, () => { const t = document.getElementById('transcript'); t.scrollTop = t.scrollHeight; document.getElementById('text-form').scrollIntoView({block: 'end'}); window.scrollBy(0, 40); }).then(() => sleep(600));
  const PHONE = '040 66969 123';
  const day = () => ev(p, () => { const c = [...document.querySelectorAll('#calendar > *')].find((e) => e.innerText.includes('03.11.')); return c ? c.innerText.replace(/\n/g, ' ') : '?'; });
  const lastBot = (all) => all.trim().split(/\n+/).at(-1);
  const log = [];
  const cal = {before: await day()};
  // Antworten auf Rueckfragen von Thomas. Fertig ist es erst, wenn der Kalender es zeigt
  // (freie Plaetze am 03.11. sinken beim Buchen und steigen beim Absagen wieder auf den Ausgangswert).
  async function dialog(first, done, confirm) {
    let all = await say(first);
    for (let i = 0; i < 7; i++) {
      const b = lastBot(all);
      log.push(b);
      await sleep(1200);
      if (await done(b)) return true;
      let reply;
      if (/(Soll ich|Passt das|Darf ich|fest buchen|wirklich absagen)[^?]*\?\s*$/i.test(b)) reply = confirm;
      else if (/Telefonnummer|Rufnummer|Nummer/i.test(b)) reply = PHONE;
      else if (/Name/i.test(b)) reply = 'Max Mustermann';
      else if (/Minuten|kurz|lang/i.test(b) && /\?/.test(b)) reply = 'Ein kurzer Haarschnitt.';
      else if (/Uhrzeit|passt Ihnen/i.test(b)) reply = 'Um 10 Uhr, bitte.';
      else reply = confirm;
      all = await say(reply);
    }
    log.push(lastBot(all));
    return done(lastBot(all));
  }
  const booked = await dialog('Hallo, hier ist Max Mustermann. Ich hätte gern einen kurzen Haarschnitt am Dienstag, den 3. November, um 10 Uhr.', async () => (await day()) !== cal.before, 'Ja, bitte so buchen.');
  await sleep(1500);
  cal.booked = await day();
  console.log('BOOKED?', booked, cal);
  await scrollTranscript();
  await snap(p, 'cal-booked-desk');
  await mark(p, 'cal-booked-desk', 'transcript', {sel: '#transcript'});
  await p.setViewport({width: MOB.w, height: MOB.h, deviceScaleFactor: 2});
  await sleep(800);
  await scrollTranscript();
  await snap(p, 'cal-booked-mob');
  await mark(p, 'cal-booked-mob', 'transcript', {sel: '#transcript'});
  await p.setViewport({width: DESK.w, height: DESK.h, deviceScaleFactor: 2});
  await sleep(800);
  // Absagen (Pflicht: im selben Lauf)
  const cancelled = await dialog(`Bitte sagen Sie meinen Termin am Dienstag, den 3. November, um 10 Uhr wieder ab. Meine Nummer ist ${PHONE}.`, async () => (await day()) === cal.before, 'Ja, bitte absagen.');
  await sleep(1500);
  cal.cancelled = await day();
  console.log('CANCELLED?', cancelled, cal);
  await scrollTranscript();
  await snap(p, 'cal-cancel-desk');
  await p.setViewport({width: MOB.w, height: MOB.h, deviceScaleFactor: 2});
  await sleep(800);
  await scrollTranscript();
  await snap(p, 'cal-cancel-mob');
  await p.setViewport({width: DESK.w, height: DESK.h, deviceScaleFactor: 2});
  rects.termin = {log, cal, booked, cancelled};
  await p.close({silent: true});
  const p2 = await open(CAL, MOB);
  await ev(p2, () => { const d = document.querySelector('details.steps-details'); if (d) d.open = false; });
  await snap(p2, 'cal-start-mob');
  await mark(p2, 'cal-start-mob', 'call', {sel: '#call-btn'});
  await p2.close({silent: true});
}

// ---------- Weitere Anwendungsfaelle: echte Laeufe ohne Login ----------
const stamp = (name, data) => { (rects.runs ??= {})[name] = data; };
const bothCuts = async (p, shots) => { for (const [k0, vp] of [['desk', DESK], ['mob', MOB]]) { await p.setViewport({width: vp.w, height: vp.h, deviceScaleFactor: 2}); await sleep(900); await shots(k0); } };

if (want('auction')) for (const [L, lang] of [['', 'de'], ['-en', 'en']]) {
  const p = await open('https://auction-demo.bunsenbrenner.org/', DESK);
  await ev(p, (l) => document.querySelector(`button[data-l=${l}]`).click(), lang);
  await sleep(800);
  await bothCuts(p, async (k0) => { await ev(p, () => { document.getElementById('form').scrollIntoView({block: 'start'}); window.scrollBy(0, -24); }); await sleep(400); await snap(p, `au-form-${k0}${L}`); await mark(p, `au-form-${k0}${L}`, 'go', {sel: '#go'}); await mark(p, `au-form-${k0}${L}`, 'form', {sel: '#form'}); });
  await p.setViewport({width: DESK.w, height: DESK.h, deviceScaleFactor: 2});
  await ev(p, () => document.getElementById('go').click());
  for (let i = 0; i < 60; i++) { await sleep(1000); if (await ev(p, () => document.querySelectorAll('section.step .sig').length >= 2)) break; }
  await sleep(2500);
  await bothCuts(p, async (k0) => {
    const k = `${k0}${L}`;
    await ev(p, () => { document.getElementById('h-writer').scrollIntoView({block: 'start'}); window.scrollBy(0, -16); }); await sleep(500);
    await snap(p, `au-bids-${k}`); await mark(p, `au-bids-${k}`, 'bids', {sel: '#out .bids'}); await mark(p, `au-bids-${k}`, 'why', {sel: '#out .why'});
    await ev(p, () => { document.querySelector('#out .exec').scrollIntoView({block: 'start'}); window.scrollBy(0, -16); }); await sleep(500);
    await snap(p, `au-short-${k}`); await mark(p, `au-short-${k}`, 'exec', {sel: '#out .exec'});
  });
  stamp(`auction-${lang}`, await ev(p, () => document.getElementById('out').innerText.slice(0, 900)));
  await p.close({silent: true});
}

if (want('keyforge')) {
  const p = await open('https://keyforge-34a13a96.bunsenbrenner.org', DESK);
  await ev(p, () => { document.getElementById('fetch-registry').scrollIntoView({block: 'center'}); });
  await sleep(500);
  await bothCuts(p, async (k0) => { await ev(p, () => { document.getElementById('fetch-registry').scrollIntoView({block: 'center'}); }); await sleep(400); await snap(p, `kf-fetch-${k0}`); await mark(p, `kf-fetch-${k0}`, 'fetch', {sel: '#fetch-registry'}); });
  await ev(p, () => document.getElementById('fetch-registry').click());
  for (let i = 0; i < 30 && !(await ev(p, () => document.getElementById('verify-input').value.length > 50)); i++) await sleep(500);
  await sleep(800);
  await ev(p, () => document.getElementById('verify-manifest').click());
  for (let i = 0; i < 30 && !(await ev(p, () => document.body.innerText.includes('Signature is valid'))); i++) await sleep(500);
  await sleep(500);
  await bothCuts(p, async (k0) => {
    await scrollToText(p, 'Signature is valid', 300);
    await snap(p, `kf-ok-${k0}`);
    await mark(p, `kf-ok-${k0}`, 'ok', {t: 'Signature is valid'});
    await mark(p, `kf-ok-${k0}`, 'btn', {sel: '#verify-manifest'});
  });
  stamp('keyforge', await ev(p, () => ({manifest: document.getElementById('manifest-picker').selectedOptions[0]?.text, msg: [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && (e.textContent || '').includes('Signature is valid')).map((e) => e.textContent)[0]})));
  await p.close({silent: true});
}

if (want('flappy')) for (const [L, prompt] of [['', 'Ein Traktor-Spiel auf dem Bauernmarkt'], ['-en', 'harvester market']]) {
  // Echter Crew-Lauf: Wunsch eintippen, bauen lassen, das geaenderte Spiel spielen.
  const p = await open('https://flappy-demo.bunsenbrenner.org/', MOB);
  await ev(p, (t) => { const i = document.getElementById('prompt'); i.value = t; i.dispatchEvent(new Event('input', {bubbles: true})); }, prompt);
  await ev(p, () => document.getElementById('prompt').scrollIntoView({block: 'center'})); await sleep(500);
  await snap(p, `fl-prompt-mob${L}`); await mark(p, `fl-prompt-mob${L}`, 'prompt', {sel: '#prompt'}); await mark(p, `fl-prompt-mob${L}`, 'build', {sel: '#buildBtn'});
  const t0 = Date.now();
  await ev(p, () => document.getElementById('buildBtn').click());
  for (let i = 0; i < 120 && !(await ev(p, () => document.body.innerText.includes('Built live'))); i++) await sleep(500);
  const secs = Math.round((Date.now() - t0) / 1000);
  await sleep(1500);
  await ev(p, () => document.getElementById('buildBtn').scrollIntoView({block: 'center'})); await sleep(500);
  await snap(p, `fl-built-mob${L}`); await mark(p, `fl-built-mob${L}`, 'done', {t: 'Built live'});
  await p.setViewport({width: DESK.w, height: DESK.h, deviceScaleFactor: 2}); await sleep(900);
  await ev(p, () => document.getElementById('playBtn').click());
  await ev(p, () => { document.querySelector('canvas')?.scrollIntoView({block: 'center'}); }); await sleep(500);
  const tap = () => ev(p, () => { const c = document.querySelector('canvas'); if (!c) return; const b = c.getBoundingClientRect(); for (const n of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) c.dispatchEvent(new MouseEvent(n, {bubbles: true, clientX: b.left + 20, clientY: b.top + 20})); document.dispatchEvent(new KeyboardEvent('keydown', {code: 'Space', key: ' ', bubbles: true})); });
  for (let i = 0; i < 10; i++) { await tap(); await sleep(330); }
  await snap(p, `fl-game-desk${L}`); await mark(p, `fl-game-desk${L}`, 'game', {sel: 'canvas'});
  stamp(`flappy${L}`, {prompt, secs, result: await ev(p, () => ({title: document.getElementById('title').value, msg: [...document.querySelectorAll('body *')].filter((e) => !e.children.length && (e.textContent || '').includes('Built live')).map((e) => e.textContent)[0]}))});
  await p.close({silent: true});
}

if (want('tutor')) for (const [L, q] of LANGS) for (const [k0, vp] of [['desk', DESK], ['mob', MOB]]) {
  const k = k0 + L; const p = await open(GALLERY + '/d/cads-tutor' + q, vp);
  await scrollToText(p, 'Firmware (STM32)', 120);
  await snap(p, `tu-tracks-${k}`);
  await mark(p, `tu-tracks-${k}`, 'track', {t: 'Firmware (STM32)', up: 1});
  await p.close({silent: true});
}

// ---------- Login-pflichtige Demos: echte Seite, Ergebnis aus aufgezeichnetem echtem Lauf ----------
// Die Seite kommt live aus der Galerie; es geht keine Anfrage an /api/start oder /api/upload-compare.
// Stattdessen spielt der Browser die Aufzeichnung aus motion/recordings/ ein, und der echte Seitencode
// stellt sie dar. Im Video steht dazu sichtbar "Aufgezeichneter echter Lauf".
const REC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'recordings');
const rec = (f, enc = 'utf8') => fs.readFileSync(path.join(REC, f), enc);
async function replayInstall(p, sse) {
  // Der Seitencode holt den Lauf per fetch('/api/start...'): Antwort kommt aus der Aufzeichnung, nichts geht ans Netz.
  await ev(p, (sse) => {
    const real = window.fetch;
    window.fetch = (u, o) => String(u).includes('/api/start') ? Promise.resolve(new Response(sse, {headers: {'content-type': 'text/event-stream'}})) : real(u, o);
  }, sse);
}
const runAndWait = async (p, sel) => { await ev(p, () => document.querySelector('button.run').click()); for (let i = 0; i < 40 && !(await ev(p, (s) => { const e = document.querySelector(s); return e && !e.hidden && e.getBoundingClientRect().height > 10; }, sel)); i++) await sleep(250); await sleep(900); };

for (const [name, slug, sse, res] of [['ph', 'phototools', 'phototools.sse', '.res-tree'], ['te', 'temporal-poc', 'temporal-poc.sse', '.res-timeline'], ['dg', 'diagram', 'diagram.sse', '.res-diagram']]) if (want(slug)) for (const [L, q] of LANGS) {
  const p = await open(GALLERY + '/d/' + slug + q, DESK);
  await bothCuts(p, async (k0) => {
    const k = k0 + L;
    if (slug === 'diagram') await ev(p, () => { const d = document.getElementById('desc'); d.value = 'Ein Besucher stellt eine Frage, der Server fragt das Sprachmodell, die Antwort kommt zurück'; d.dispatchEvent(new Event('input', {bubbles: true})); });
    await ev(p, () => { document.querySelector('button.run').scrollIntoView({block: 'center'}); }); await sleep(400);
    await snap(p, `${name}-start-${k}`); await mark(p, `${name}-start-${k}`, 'run', {sel: 'button.run'});
    if (slug === 'diagram') await mark(p, `${name}-start-${k}`, 'desc', {sel: '#desc'});
  });
  await p.setViewport({width: DESK.w, height: DESK.h, deviceScaleFactor: 2}); await sleep(500);
  await replayInstall(p, rec(sse));
  await runAndWait(p, res);
  await ev(p, () => { const s = document.querySelector('.res-sheet'); if (s) s.hidden = true; }); // Kontaktbogen ist nicht mit aufgezeichnet
  await bothCuts(p, async (k0) => {
    const k = k0 + L;
    await ev(p, (s) => { document.querySelector(s).scrollIntoView({block: 'center'}); }, res); await sleep(500);
    await snap(p, `${name}-result-${k}`); await mark(p, `${name}-result-${k}`, 'res', {sel: res});
    if (slug === 'diagram') await mark(p, `${name}-result-${k}`, 'img', {sel: '.res-diagram .resimg'});
  });
  await p.close({silent: true});
}

if (want('contractcheck')) for (const [L, q] of LANGS) {
  const p = await open(GALLERY + '/d/contractcheck' + q, DESK);
  await ev(p, (a, b, res) => {
    const file = (b64, n) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], n, {type: 'application/pdf'});
    const set = (id, f) => { const dt = new DataTransfer(); dt.items.add(f); document.getElementById(id).files = dt.files; };
    set('pdfa', file(a, 'Mietvertrag-alt.pdf')); set('pdfb', file(b, 'Mietvertrag-neu.pdf'));
    const real = window.fetch; window.fetch = (u, o) => String(u).includes('/api/upload-compare') ? Promise.resolve(new Response(res, {headers: {'content-type': 'application/json'}})) : real(u, o);
  }, rec('mietvertrag-alt.pdf', 'base64'), rec('mietvertrag-neu.pdf', 'base64'), rec('contractcheck-mietvertrag.json'));
  await bothCuts(p, async (k0) => { const k = k0 + L; await ev(p, () => { document.getElementById('upbtn').scrollIntoView({block: 'center'}); }); await sleep(400); await snap(p, `cc-form-${k}`); await mark(p, `cc-form-${k}`, 'a', {sel: '#pdfa'}); await mark(p, `cc-form-${k}`, 'b', {sel: '#pdfb'}); await mark(p, `cc-form-${k}`, 'go', {sel: '#upbtn'}); });
  await p.setViewport({width: DESK.w, height: DESK.h, deviceScaleFactor: 2}); await sleep(500);
  await ev(p, () => document.getElementById('upbtn').click());
  for (let i = 0; i < 40 && (await ev(p, () => document.querySelector('.res-upreport').hidden)); i++) await sleep(250);
  await sleep(1500);
  // Der Bericht aus der Aufzeichnung in voller Breite (auf der Seite steht er in einem kleinen Rahmen)
  await ev(p, () => { const h = document.querySelector('.upframe').srcdoc; document.open(); document.write(h); document.close(); });
  await sleep(600);
  await bothCuts(p, async (k0) => {
    const k = k0 + L;
    await scrollToText(p, 'Tool-computed diff', 40);
    await snap(p, `cc-result-${k}`);
    await mark(p, `cc-result-${k}`, 'diff', {t: 'Die Miete betraegt 950', up: 1});
  });
  await p.close({silent: true});
}

// Untertitel: echter Lauf im Browser mit eigenem Clip (recordings/untertitel-clip-*.mp4). Es wird nichts hochgeladen;
// das fertige Video kommt aus der Seite selbst und liegt danach in recordings/.
if (want('untertitel')) for (const [L, lang] of [['', 'de'], ['-en', 'en']]) {
  const model = process.env.UT_MODEL || 'schnell';
  const fix = JSON.parse(process.env.UT_FIX || '{}');
  const p = await open(`${GALLERY}/d/untertitel?lang=${lang}`, MOB);
  await ev(p, (b64, n) => { const f = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], n, {type: 'video/mp4'}); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('ut-file'); i.files = dt.files; i.dispatchEvent(new Event('change', {bubbles: true})); }, rec(`untertitel-clip-${lang}.mp4`, 'base64'), `clip-${lang}.mp4`);
  await sleep(1500);
  console.log('opts', JSON.stringify(await ev(p, () => Object.fromEntries(['ut-language', 'ut-model', 'ut-look', 'ut-position'].map((id) => { const s = document.getElementById(id); return [id, {v: s.value, o: [...s.options].map((o) => o.value)}]; })))));
  await ev(p, (l, m) => { for (const [id, v] of [['ut-language', l], ['ut-model', m]]) { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); } }, lang, model);
  for (let i = 0; i < 40 && (await ev(p, () => document.getElementById('ut-go').disabled)); i++) await sleep(250);
  await ev(p, () => document.getElementById('ut-drop').scrollIntoView({block: 'start'})); await ev(p, () => window.scrollBy(0, -60)); await sleep(400);
  await snap(p, `ut-pick-mob${L}`); await mark(p, `ut-pick-mob${L}`, 'drop', {sel: '#ut-drop'}); await mark(p, `ut-pick-mob${L}`, 'go', {sel: '#ut-go'});
  const t0 = Date.now();
  await ev(p, () => document.getElementById('ut-go').click());
  for (let i = 0; i < 600 && (await ev(p, () => document.getElementById('ut-edit').hidden && document.getElementById('ut-error').hidden)); i++) await sleep(500);
  const err = await ev(p, () => (document.getElementById('ut-error').hidden ? '' : document.getElementById('ut-error').innerText));
  if (err) throw new Error('untertitel: ' + err);
  await sleep(600);
  const cues = () => ev(p, () => [...document.querySelectorAll('#ut-cues input, #ut-cues textarea')].map((e) => e.value));
  const heard = await cues(); console.log('heard', lang, JSON.stringify(heard), Math.round((Date.now() - t0) / 1000) + 's');
  await ev(p, () => { document.getElementById('ut-edit').scrollIntoView({block: 'start'}); window.scrollBy(0, -70); }); await sleep(400);
  await snap(p, `ut-text-mob${L}`); await mark(p, `ut-text-mob${L}`, 'cues', {sel: '#ut-cues'});
  if (Object.keys(fix).length) {
    // Korrektur wie ein Nutzer: Wort im Eingabefeld ersetzen
    await ev(p, (fix) => { document.querySelectorAll('#ut-cues input, #ut-cues textarea').forEach((e) => { let v = e.value; for (const [a, b] of Object.entries(fix)) v = v.replaceAll(a, b); if (v !== e.value) { e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); } }); }, fix);
    await sleep(400); await snap(p, `ut-fixed-mob${L}`); await mark(p, `ut-fixed-mob${L}`, 'cues', {sel: '#ut-cues'});
  }
  await ev(p, () => document.getElementById('ut-burn').click());
  for (let i = 0; i < 600 && (await ev(p, () => document.getElementById('ut-result').hidden && document.getElementById('ut-error').hidden)); i++) await sleep(500);
  const err2 = await ev(p, () => (document.getElementById('ut-error').hidden ? '' : document.getElementById('ut-error').innerText));
  if (err2) throw new Error('untertitel: ' + err2);
  const secs = Math.round((Date.now() - t0) / 1000);
  await sleep(1500);
  await ev(p, () => { document.getElementById('ut-result').scrollIntoView({block: 'start'}); window.scrollBy(0, -70); }); await sleep(600);
  await snap(p, `ut-done-mob${L}`); await mark(p, `ut-done-mob${L}`, 'save', {sel: '#ut-dl-mp4'});
  const b64 = await ev(p, async () => { const b = await (await fetch(document.getElementById('ut-dl-mp4').href)).blob(); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(path.join(REC, `untertitel-ergebnis-${lang}.mp4`), Buffer.from(b64, 'base64'));
  for (const [k, at] of [['a', '0.9'], ['b', '3.0']]) { execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', at, '-i', path.join(REC, `untertitel-ergebnis-${lang}.mp4`), '-frames:v', '1', '-q:v', '2', path.join(out, `ut-frame-${k}-mob${L}.jpg`)]); rects[`ut-frame-${k}-mob${L}`] = {}; }
  stamp(`untertitel-${lang}`, {model, heard, final: await cues(), secs, times: await ev(p, () => document.getElementById('ut-times').innerText), note: await ev(p, () => document.querySelector('.ut-note').innerText)});
  console.log('run', JSON.stringify(rects.runs[`untertitel-${lang}`]));
  await p.close({silent: true});
}

if (want('erklaervideo')) for (const [L, q] of LANGS) for (const [k0, vp] of [['desk', DESK], ['mob', MOB]]) {
  const k = k0 + L; const p = await open(GALLERY + '/d/erklaervideo' + q, vp);
  await ev(p, () => { document.getElementById('tvtext').scrollIntoView({block: 'center'}); }); await sleep(400);
  await snap(p, `ev-form-${k}`); await mark(p, `ev-form-${k}`, 'text', {sel: '#tvtext'}); await mark(p, `ev-form-${k}`, 'run', {sel: 'button.run'});
  await p.close({silent: true});
}
fs.writeFileSync(rectsFile, JSON.stringify(rects, null, 1));
await browser.close({silent: true});
