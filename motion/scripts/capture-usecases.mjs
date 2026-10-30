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
// Aufruf: node scripts/capture-usecases.mjs [gallery|newsletter|callcenter|termin ...]
import {openBrowser, ensureBrowser} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'real', 'uc');
fs.mkdirSync(out, {recursive: true});
const rectsFile = path.join(out, 'rects.json');
const rects = fs.existsSync(rectsFile) ? JSON.parse(fs.readFileSync(rectsFile, 'utf8')) : {};
const GALLERY = 'https://demos-34a13a96.bunsenbrenner.org';
const CALL = 'https://callcenter-34a13a96.bunsenbrenner.org/';
const CAL = 'https://assistent-cal-f29c55da.bunsenbrenner.org/';
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);
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
const LANGS = [['', ''], ['-en', '?lang=en']];
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
fs.writeFileSync(rectsFile, JSON.stringify(rects, null, 1));
await browser.close({silent: true});
