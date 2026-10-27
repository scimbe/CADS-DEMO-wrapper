// Holt echte Screenshots der Live-Demo (keine Workflow-Runs: nur Seiten laden,
// Formular fuellen und die browserseitige Vorschau oeffnen).
import {openBrowser, ensureBrowser} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'real');
const BASE = 'https://demos-34a13a96.bunsenbrenner.org';
await ensureBrowser();
const browser = await openBrowser('chrome');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(name, url, {w, h, dsf = 2, prep, full = false}) {
  const page = await browser.newPage({context: () => null, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => undefined});
  await page.setViewport({width: w, height: h, deviceScaleFactor: dsf});
  await page.goto({url, timeout: 60000});
  await sleep(2500);
  if (prep) await prep(page);
  const r = await page._client().send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
  fs.writeFileSync(path.join(out, name), Buffer.from(String(r.value.data ?? r.value), 'base64'));
  console.log('ok', name);
  await page.close({silent: true});
}
const fill = async (page) => {
  await page.evaluate(() => {
    const s = document.getElementById('pb-f-location'); s.value = 'Bremen'; s.dispatchEvent(new Event('change', {bubbles: true}));
    const t = document.getElementById('pb-f-own_context'); t.value = 'Segelgruppe, Wind und Regen hervorheben'; t.dispatchEvent(new Event('input', {bubbles: true}));
    document.querySelector('input[name=pb-r-tone][value=freundlich]').click();
  });
};
const preview = async (page) => {
  await fill(page);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Vorschau anzeigen')).click());
  await sleep(2000);
};
const scrollTo = (txt) => async (page) => {
  await page.evaluate((t) => { const el = [...document.querySelectorAll('h1,h2,h3,strong,div,span')].find((e) => e.children.length === 0 && e.innerText?.includes(t)); el?.scrollIntoView({block: 'start'}); window.scrollBy(0, -24); }, txt);
  await sleep(800);
};
await shot('gallery-desktop.png', BASE + '/', {w: 1440, h: 900});
await shot('template-top-desktop.png', BASE + '/d/newsletter', {w: 1440, h: 900});
await shot('signature-desktop.png', BASE + '/d/newsletter', {w: 1440, h: 900, prep: scrollTo('Prüfung der Vorlage')});
await shot('preview-desktop.png', BASE + '/d/newsletter', {w: 1440, h: 900, prep: async (p) => { await preview(p); await scrollTo('Nachweis')(p); }});
await shot('form-mobile.png', BASE + '/d/newsletter', {w: 390, h: 1500, prep: async (p) => { await fill(p); await scrollTo('Eigene Angaben')(p); }});
await shot('report-desktop.png', BASE + '/d/newsletter/out/report.html', {w: 1100, h: 800});
await shot('report-mobile.png', BASE + '/d/newsletter/out/report.html', {w: 390, h: 844});
await shot('report-mobile-brief.png', BASE + '/d/newsletter/out/report.html', {w: 390, h: 844, prep: async (p) => { await p.evaluate(() => { const h=[...document.querySelectorAll('h2')].find(e=>e.innerText.trim()==='Briefing'); h.scrollIntoView({block:'start'}); window.scrollBy(0,-16); }); await sleep(600); }});
await browser.close({silent: true});
