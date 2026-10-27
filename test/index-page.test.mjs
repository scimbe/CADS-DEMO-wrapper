import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexPage, partitionDemos } from '../lib/index-page.mjs';

const DEMOS = JSON.parse(readFileSync(new URL('../demos.json', import.meta.url), 'utf8'));
const decode = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Engineering terms that must not appear in the *visible* card text (title, category, teaser).
// They may appear in the collapsed "Technical details".
const JARGON = [/studio/i, /tunnel/i, /payload/i, /pipeline/i, /wasm/i, /holder/i, /manifest/i, /durable/i, /heartbeat/i, /channel/i, /grounded/i, /`/, /\[object/i];

function cards(html) {
  return [...html.matchAll(/<li><div class="dcard( soon)?"([^>]*)>([\s\S]*?)<\/div><\/li>/g)].map((m) => {
    const body = m[3];
    return {
      soon: !!m[1],
      attrs: m[2],
      html: m[0],
      title: decode((body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || ''),
      category: decode((body.match(/<span class="k">([\s\S]*?)<\/span>/) || [])[1] || ''),
      teaser: decode((body.match(/<\/h3><p>([\s\S]*?)<\/p>/) || [])[1] || ''),
      search: (m[2].match(/data-search="([^"]*)"/) || [])[1] || '',
    };
  });
}

for (const lang of ['de', 'en']) {
  const html = indexPage(DEMOS, lang);
  const all = cards(html);

  test(`[${lang}] renders every demo as a card, none contain "[object Object]"`, () => {
    assert.equal(all.length, Object.keys(DEMOS).length);
    assert.ok(!html.includes('[object Object]'));
    for (const c of all) assert.ok(c.search.length > 20 && !c.search.includes('[object'), c.title);
  });

  test(`[${lang}] visible card text has no engineering jargon`, () => {
    for (const c of all) {
      const visible = `${c.title} ${c.category} ${c.teaser}`;
      for (const re of JARGON) assert.ok(!re.test(visible), `${c.title}: "${visible}" matches ${re}`);
    }
  });

  test(`[${lang}] language toggle: both options, current one marked, html lang set`, () => {
    assert.match(html, new RegExp(`<html lang="${lang}"`));
    assert.match(html, /<a href="\?lang=de" hreflang="de"/);
    assert.match(html, /<a href="\?lang=en" hreflang="en"/);
    assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
    assert.match(html, new RegExp(`hreflang="${lang}"[^>]*class="on" aria-current="true"|class="on" aria-current="true">${lang.toUpperCase()}<`));
  });

  test(`[${lang}] page structure: skip link, one h1, main landmark, noscript fallback, how-it-works 3 steps`, () => {
    assert.match(html, /<a class="skip" href="#main">/);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    assert.equal((html.match(/<main /g) || []).length, 1);
    assert.match(html, /<noscript>.*?<\/noscript>/s);
    assert.equal((html.match(/<section class="how"[\s\S]*?<\/section>/)[0].match(/<li>/g) || []).length, 3);
  });

  test(`[${lang}] external links announce the new tab visually and for screen readers`, () => {
    const ext = [...html.matchAll(/<a [^>]*target="_blank"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
    assert.ok(ext.length >= 8);
    for (const a of ext) {
      assert.match(a, /rel="noopener noreferrer"/);
      assert.match(a, /<span class="sr-only"> \((öffnet neuen Tab|opens in new tab)\)<\/span>/, a.slice(0, 120));
      assert.match(a, /aria-hidden="true">↗</);
    }
  });
}

test('de and en pages differ in content, de is the default', () => {
  const de = indexPage(DEMOS, 'de'), en = indexPage(DEMOS, 'en'), dflt = indexPage(DEMOS, undefined);
  assert.equal(dflt, de);
  assert.match(de, /So funktioniert’s/);
  assert.match(en, /How it works/);
  assert.match(en, /href="\/d\/phototools\?lang=en"/);
  assert.match(de, /href="\/d\/phototools"/);
});

test('not-yet-startable demos live in a separate collapsed "Demnächst" group, disabled, no links', () => {
  const { live, soon } = partitionDemos(DEMOS);
  assert.ok(soon.length >= 3);
  assert.equal(live.length + soon.length, Object.keys(DEMOS).length);
  const html = indexPage(DEMOS, 'de');
  const section = html.match(/<details class="soonsec"[\s\S]*?<\/details>\s*<\/section>/)[0];
  assert.ok(!/<details class="soonsec"[^>]* open/.test(section), 'collapsed by default');
  const sc = cards(section);
  assert.equal(sc.length, soon.length);
  for (const c of sc) {
    assert.ok(c.soon);
    assert.match(c.attrs, /data-search/);
    assert.match(c.html, /role="group" aria-disabled="true"/);
    assert.ok(!/<a /.test(c.html), `${c.title}: a disabled card must not link`);
    assert.ok(!/live/i.test(c.html.replace(/data-search="[^"]*"/, '')), `${c.title}: must not say "live"`);
    assert.match(c.html, /In Vorbereitung/);
  }
  // and none of the live cards sits in that group
  const main = html.replace(section, '');
  assert.equal(cards(main).filter((c) => c.soon).length, 0);
});

test('hero states the truth: demo runs on our server; planned features are marked in preparation', () => {
  const html = indexPage(DEMOS, 'de');
  assert.match(html, /Demo auf unserem Server/);
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/data-search="[^"]*"/g, '');
  assert.ok(!/lokal aktiv|offline|served by customer|auf diesem Rechner/i.test(visible));
  const trust = html.match(/<section class="trust"[\s\S]*?<\/section>/)[0];
  assert.equal((trust.match(/Aktiv in der Demo/g) || []).length, 1);
  assert.equal((trust.match(/In Vorbereitung/g) || []).length, 3);
  assert.match(trust, /Sandbox/);
});
