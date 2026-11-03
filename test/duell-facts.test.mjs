// Data cards: fixed shape, same answer for everyone on a day, cache, limits, filter, honest errors, keys only from env.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFacts, shape } from '../lib/duell-facts.mjs';
import { SOURCES, unhtml } from '../lib/duell-facts-sources.mjs';
import { createDuell } from '../lib/duell.mjs';
import { createDuellAi } from '../lib/duell-ai.mjs';

const NOW = Date.parse('2027-01-04T10:00:00Z');
const fake = (over = {}) => ({
  credit: 'Beispiel · CC0', ttlMs: 3600000,
  async fetch({ get, seed }) { const j = await get('https://example.test/x'); return j.items.map((x) => ({ h: x, v: 'seed ' + (seed > 0) })); },
  ...over,
});
const ok = (j) => ({ ok: true, json: async () => j });
const mk = (src, fetchImpl, env = {}) => createFacts({ env, now: () => NOW, sources: { demo: src }, fetchImpl });

test('Antwort hat feste Felder, Quelle vom Server, zweite Anfrage aus dem Cache', async () => {
  const calls = [], f = mk(fake(), async (u, o) => { calls.push([u, o.headers['User-Agent']]); return ok({ items: ['Eins', 'Zwei', 'Drei'] }); });
  const r = await f.get({ api: 'demo', date: '2027-01-04' }, 'k');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['api', 'date', 'h', 'src', 'v']);
  assert.equal(r.body.src, 'Beispiel · CC0');
  assert.match(calls[0][1], /^MyDailyIdea\//);
  const again = await f.get({ api: 'demo', date: '2027-01-04' }, 'k');
  assert.deepEqual(again.body, r.body); assert.equal(calls.length, 1);
});
test('Gleicher Tag, gleiche Auswahl auf jedem Server; anderer Tag kann anders sein', async () => {
  const svc = async () => ok({ items: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
  const a = await mk(fake(), svc).get({ api: 'demo', date: '2027-01-04' }), b = await mk(fake(), svc).get({ api: 'demo', date: '2027-01-04' });
  assert.equal(a.body.h, b.body.h);
  const seen = new Set();
  for (const d of ['2027-01-03', '2027-01-04', '2027-01-05']) seen.add((await createFacts({ now: () => Date.parse(d + 'T10:00:00Z'), sources: { demo: fake() }, fetchImpl: svc }).get({ api: 'demo', date: d })).body.h);
  assert.ok(seen.size > 1, 'Tage unterscheiden sich');
});
test('Ausfall, Zeitueberschreitung, kaputte Antwort: Fehler statt Inhalt', async () => {
  assert.equal((await mk(fake(), async () => { throw new Error('down'); }).get({ api: 'demo', date: '2027-01-04' })).status, 503);
  assert.equal((await mk(fake(), async () => ({ ok: false, status: 500 })).get({ api: 'demo', date: '2027-01-04' })).status, 503);
  assert.equal((await mk(fake(), async () => ({ ok: false, status: 404 })).get({ api: 'demo', date: '2027-01-04' })).status, 404);
  assert.equal((await mk(fake(), async () => ok({ nope: 1 })).get({ api: 'demo', date: '2027-01-04' })).status, 503);
  assert.equal((await mk(fake(), async () => ok({ items: [] })).get({ api: 'demo', date: '2027-01-04' })).status, 404);
  const slow = createFacts({ now: () => NOW, timeoutMs: 20, sources: { demo: fake() }, fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('timeout')))) });
  assert.equal((await slow.get({ api: 'demo', date: '2027-01-04' })).status, 503);
});
test('Filter: unpassende Eintraege werden uebersprungen, nur unpassende ergeben einen Fehler', async () => {
  const r = await mk(fake({ ordered: true }), async () => ok({ items: ['Mehr unter www.beispiel.de', 'Blut und Waffe', 'Ein Krake hat drei Herzen'] })).get({ api: 'demo', date: '2027-01-04' });
  assert.equal(r.body.h, 'Ein Krake hat drei Herzen');
  assert.equal((await mk(fake(), async () => ok({ items: ['Waffe'] })).get({ api: 'demo', date: '2027-01-04' })).status, 503);
});
test('Eingabe: unbekannte API, falsches Datum, Muster, Filter; nichts davon fragt den Dienst', async () => {
  const calls = [], src = fake({ input: { max: 20, re: /^[\p{L} -]+$/u } }), f = mk(src, async () => { calls.push(1); return ok({ items: ['x'] }); });
  for (const b of [{ api: 'nope', date: '2027-01-04' }, { api: '__proto__', date: '2027-01-04' }, { api: 'demo', date: 'heute', q: 'Haus' }, { api: 'demo', date: '2027-01-04' }, { api: 'demo', date: '2027-01-04', q: 'Haus!1' }])
    assert.equal((await f.get(b)).status, 400, JSON.stringify(b));
  assert.equal((await f.get({ api: 'demo', date: '2027-01-07', q: 'Haus' })).status, 422);
  assert.equal((await f.get({ api: 'demo', date: '2027-01-04', q: 'fuck' })).status, 422);
  assert.equal(calls.length, 0);
  assert.equal((await f.get({ api: 'demo', date: '2027-01-03', q: 'Haus' })).status, 200, 'gestern in einer anderen Zeitzone ist ok');
});
test('Grenzen: je Person und Stunde, je API und Tag', async () => {
  const svc = async () => ok({ items: ['x'] });
  const per = mk(fake({ input: { max: 9, re: /^\w+$/ } }), svc, { DUELL_FACTS_IP_PER_HOUR: '1' });
  assert.equal((await per.get({ api: 'demo', date: '2027-01-04', q: 'a' }, 'k')).status, 200);
  assert.equal((await per.get({ api: 'demo', date: '2027-01-04', q: 'b' }, 'k')).status, 429);
  assert.equal((await per.get({ api: 'demo', date: '2027-01-04', q: 'b' }, 'j')).status, 200);
  const day = mk(fake({ input: { max: 9, re: /^\w+$/ } }), svc, { DUELL_FACTS_DAILY_MAX: '1' });
  assert.equal((await day.get({ api: 'demo', date: '2027-01-04', q: 'a' })).status, 200);
  assert.equal((await day.get({ api: 'demo', date: '2027-01-04', q: 'b' })).status, 429);
  assert.equal((await day.get({ api: 'demo', date: '2027-01-04', q: 'a' })).status, 200, 'Cache zaehlt nicht');
});
test('Schluessel nur aus der Umgebung, nie in der Antwort; ohne Schluessel ehrlich nicht eingerichtet', async () => {
  let used = '';
  const src = fake({ key: 'DEMO_KEY_ENV', async fetch({ key }) { used = key; return [{ h: 'Bild des Tages' }]; } });
  assert.deepEqual((await mk(src, async () => ok({})).get({ api: 'demo', date: '2027-01-04' })).body, { error: 'not-configured' });
  const r = await mk(src, async () => ok({}), { DEMO_KEY_ENV: 's3cret' }).get({ api: 'demo', date: '2027-01-04' });
  assert.equal(used, 's3cret'); assert.equal(r.status, 200); assert.ok(!JSON.stringify(r.body).includes('s3cret'));
});
test('Quizform: 2 bis 4 verschiedene Antworten, gueltiger Index, sonst verworfen', () => {
  assert.deepEqual(shape({ h: 'Frage?', c: ['A', 'B'], a: 1 }), { h: 'Frage?', c: ['A', 'B'], a: 1 });
  for (const it of [{ h: 'F', c: ['A'], a: 0 }, { h: 'F', c: ['A', 'a'], a: 0 }, { h: 'F', c: ['A', 'B'], a: 2 }, { h: 'F', c: ['A', ''], a: 0 }, { h: '', c: ['A', 'B'], a: 0 }, null])
    assert.equal(shape(it), null, JSON.stringify(it));
  assert.equal(shape({ h: 'x'.repeat(200) }).h.length, 90);
  assert.ok(shape({ h: 'F', c: ['A', 'B'], a: 0, r: 'Eichhörnchen 1.659.000 · Uhu 848.000 Meldungen' }), 'grosse Zahlen im Streifen sind keine Telefonnummer');
  assert.equal(shape({ h: 'Ruf an: 0171 2345678' }), null, 'in der Hauptzeile bleibt die Pruefung streng');
});
test('Ausfall: der letzte echte Stand der Woche kommt mit seinem Datum und stale, nie ein erfundener', async () => {
  let up = true, t = NOW;
  const f = createFacts({ now: () => t, sources: { demo: fake({ ttlMs: 1 }) }, fetchImpl: async () => { if (!up) throw new Error('down'); return ok({ items: ['Gestern echt'] }); } });
  const first = await f.get({ api: 'demo', date: '2027-01-04' });
  up = false; t = NOW + 86400000;
  const r = await f.get({ api: 'demo', date: '2027-01-05' });
  assert.equal(r.status, 200); assert.equal(r.body.stale, true); assert.equal(r.body.date, '2027-01-04'); assert.equal(r.body.h, first.body.h);
  t = NOW + 9 * 86400000;
  assert.equal((await f.get({ api: 'demo', date: '2027-01-13' })).status, 503, 'aelter als eine Woche: ehrlich nichts');
});
test('HTTP: /api/duell/ai/fact laeuft ueber denselben Weg wie das Wetter, ohne Kontingent', async () => {
  const d = createDuell({ env: {}, salt: 's', log: () => {}, llm: async () => '{}' });
  const facts = createFacts({ now: () => Date.now(), sources: { demo: fake() }, fetchImpl: async () => ok({ items: ['Ein Fakt'] }) });
  const ai = createDuellAi({ env: { DUELL_AI_SALT: 'x' }, llm: async () => '{}', shared: d.shared, facts, log: () => {} });
  const srv = http.createServer(async (q, s) => { if (!(await ai.route(q, s, new URL(q.url, 'http://x')))) s.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/api/duell/ai/fact`, today = new Date().toISOString().slice(0, 10);
  const post = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const r = await post({ api: 'demo', date: today });
    assert.equal(r.status, 200); assert.equal((await r.json()).h, 'Ein Fakt');
    assert.equal((await post({ api: 'demo', date: today }, { Origin: 'https://boese.example' })).status, 403);
    assert.equal((await post({ api: 'gibtsnicht', date: today })).status, 400);
  } finally { srv.close(); }
});

// ---- every real adapter with a recorded answer of its API: shape, credit, filters --------------------------------
const run1 = (api, body, input = {}, date = '2027-01-04') => createFacts({ now: () => Date.parse(date + 'T10:00:00Z'), fetchImpl: async (u) => ok(typeof body === 'function' ? body(u) : body) }).get({ api, date, ...input });
const isQuiz = (b) => Array.isArray(b.c) && b.c.length >= 2 && Number.isInteger(b.a) && b.c[b.a];
test('Adapter: jede Quelle hat eine Quellzeile, Eingaben nur aus festen Listen', () => {
  for (const [id, s] of Object.entries(SOURCES)) {
    assert.ok(s.credit && s.credit.length <= 60, id);
    assert.equal(typeof s.fetch, 'function', id);
    if (s.input) assert.ok(s.input.re.source.startsWith('^('), id + ' nimmt nur Werte aus einer Liste');
  }
  assert.equal(Object.keys(SOURCES).length, 14);
  assert.equal(unhtml('Who&#039;s &quot;there&quot; &amp; why?'), 'Who\'s "there" & why?');
});
test('Adapter quiz (Open Trivia DB): HTML-Zeichen weg, vier Antworten, die richtige ist dabei', async () => {
  const r = await run1('quiz', { response_code: 0, results: [{ question: 'Which planet is called the &quot;Red Planet&quot;?', correct_answer: 'Mars', incorrect_answers: ['Venus', 'Jupiter', 'Saturn'] }] });
  assert.equal(r.status, 200); assert.equal(r.body.h, 'Which planet is called the "Red Planet"?'); assert.equal(r.body.c[r.body.a], 'Mars'); assert.equal(r.body.c.length, 4);
  assert.equal((await run1('quiz', { response_code: 5, results: [] })).status, 503);
});
test('Adapter hauptstadt (Wikidata): Laender mit mehreren Hauptstaedten fallen weg, Antworten aus der Region', async () => {
  const b = (c, cl, kl, ct) => ({ c: { value: c }, cl: { value: cl }, kl: { value: kl }, ct: { value: ct } });
  const rows = [b('Q1', 'Peru', 'Lima', 'SA'), b('Q2', 'Chile', 'Santiago de Chile', 'SA'), b('Q3', 'Bolivien', 'Sucre', 'SA'), b('Q3', 'Bolivien', 'La Paz', 'SA'), b('Q4', 'Ecuador', 'Quito', 'SA'), b('Q5', 'Kolumbien', 'Bogotá', 'SA'), b('Q6', 'Frankreich', 'Paris', 'EU')];
  const r = await run1('hauptstadt', { results: { bindings: rows } });
  assert.equal(r.status, 200); assert.ok(isQuiz(r.body));
  assert.ok(!r.body.h.includes('Bolivien'), 'zwei Hauptstaedte: keine eindeutige Antwort');
  if (!r.body.h.includes('Frankreich')) assert.ok(!r.body.c.includes('Paris'), 'falsche Antworten aus derselben Region');
});
test('Adapter waermste (Bright Sky): genau eine waermste Stadt, Messzeit im Streifen; Gleichstand ohne Frage', async () => {
  let n = 0;
  const r = await run1('waermste', () => ({ weather: { temperature: [4, 9.4, 2, 7, 1, 3][n++ % 6], timestamp: '2027-01-04T09:00:00+00:00' } }));
  assert.ok(isQuiz(r.body)); assert.equal(r.body.c.length, 4); assert.match(r.body.r, /9,4 °C · Stand 10:00$/);
  assert.equal((await run1('waermste', { weather: { temperature: 5, timestamp: '2027-01-04T09:00:00+00:00' } })).status, 404);
});
test('Adapter tiere (GBIF): zwei Tiere, Zahlen der Meldungen im Streifen', async () => {
  const sum = (s) => [...s].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const r = await run1('tiere', (u) => (u.includes('/match') ? { usageKey: sum(decodeURIComponent(u.split('name=')[1])), matchType: 'EXACT' } : { count: 1000 * Number(u.split('taxonKey=')[1]) }));
  assert.equal(r.status, 200); assert.equal(r.body.c.length, 2); assert.match(r.body.r, /Meldungen$/);
  assert.equal((await run1('tiere', { usageKey: 1, matchType: 'FUZZY' })).status, 503);
});
test('Adapter band (MusicBrainz): nur Gruppen der festen Liste, aelteres Gruendungsjahr gewinnt', async () => {
  const r = await run1('band', (u) => { const name = decodeURIComponent(u).match(/artist:"([^"]+)"/)[1]; return { artists: [{ name, type: 'Group', 'life-span': { begin: String(1900 + [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 120) } }] }; });
  assert.equal(r.status, 200); assert.ok(isQuiz(r.body)); assert.match(r.body.r, /^\D+ \d{4} · \D+ \d{4}$/);
  assert.equal((await run1('band', { artists: [{ name: 'Fremd', type: 'Person', 'life-span': { begin: '1990' } }] })).status, 503);
});
test('Adapter geld (EZB via Frankfurter): vier weit auseinanderliegende Antworten, Kursdatum im Streifen', async () => {
  const r = await run1('geld', (u) => { const code = u.split('symbols=')[1]; return { date: '2027-01-03', rates: { [code]: 1.5 } }; });
  assert.ok(isQuiz(r.body)); assert.equal(r.body.c.length, 4); assert.equal(r.body.c[r.body.a], '15,00'); assert.match(r.body.r, /Kurs vom 3\.1\.$/);
});
test('Adapter strom (Energy-Charts): Bereich statt genauer Zahl, letzter Messwert mit Uhrzeit', async () => {
  const r = await run1('strom', { unix_seconds: [1799056800, 1799057700, 1799058600], production_types: [{ name: 'Renewable share of load', data: [40.2, 61.4, null] }] });
  assert.deepEqual(r.body.c, ['unter 25 %', '25 bis 50 %', '50 bis 75 %', 'über 75 %']); assert.equal(r.body.a, 2); assert.match(r.body.r, /^61 % erneuerbar · Stand \d\d:\d\d$/);
});
test('Adapter ferien (OpenHolidays): Countdown fuer das gewaehlte Land, nur bekannte Kuerzel', async () => {
  const hol = [{ startDate: '2027-01-29', endDate: '2027-01-29', name: [{ text: 'Halbjahrespause' }] }, { startDate: '2027-03-01', endDate: '2027-03-12', name: [{ text: 'Frühjahrsferien' }] }];
  const r = await run1('ferien', hol, { q: 'HH' });
  assert.equal(r.body.h, 'Noch 25 Tage bis zu den Halbjahrespause'); assert.match(r.body.v, /^Hamburg · /);
  assert.equal((await run1('ferien', hol, { q: 'XX' })).status, 400);
  assert.match((await run1('ferien', [{ startDate: '2027-01-02', endDate: '2027-01-06', name: [{ text: 'Weihnachtsferien' }] }], { q: 'BY' })).body.h, /^Ferien! Weihnachtsferien bis 6\.1\.$/);
});
test('Adapter zucker (Open Food Facts): Mitte vieler Produkte, ohne Marke, Alkohol faellt raus, zu wenig Daten = nichts', async () => {
  const products = [5, 8, 10.6, 10.6, 11, 12, 30].map((s, i) => ({ nutriments: { sugars_100g: s }, categories_tags: i === 6 ? ['en:alcoholic-beverages'] : [] }));
  const r = await run1('zucker', { products }, { q: 'cola' });
  assert.equal(r.body.h, 'Cola: 10,6 g Zucker pro 100 ml'); assert.match(r.body.v, /^≈ 4 Zuckerwürfel · Mitte von 6 Produkten$/);
  assert.equal((await run1('zucker', { products: products.slice(0, 3) }, { q: 'cola' })).status, 404);
  assert.equal((await run1('zucker', { products }, { q: 'bier' })).status, 400);
});
test('Adapter beben (USGS): staerkstes Beben, ruhiger Tag ist ehrlich ruhig', async () => {
  const r = await run1('beben', { features: [{ properties: { mag: 4.6, place: 'Fiji region', time: 1799056800000 } }, { properties: { mag: 5.4, place: '24 km NNW of Rioblanco, Colombia', time: 1799056800000 } }] });
  assert.equal(r.body.h, 'Stärke 5,4: Colombia');
  assert.match((await run1('beben', { features: [] })).body.h, /^Heute ruhig/);
});
test('Adapter damals (Wikipedia): nichts mit Krieg oder Tod, nur ganze Satzteile bis 90 Zeichen', async () => {
  const sel = [{ year: 1914, text: 'Beginn der Schlacht an der Marne.' }, { year: 1956, text: 'Im deutschen Fernsehen wird zum ersten Mal Werbung ausgestrahlt; danach mehr.' }, { year: 1926, text: 'Annie Oakley stirbt in Greenville.' }];
  const r = await run1('damals', { selected: sel });
  assert.equal(r.body.h, '1956: Im deutschen Fernsehen wird zum ersten Mal Werbung ausgestrahlt'); assert.equal(r.body.v, 'Heute vor 71 Jahren');
  const r2 = await run1('damals', (u) => (u.includes('/selected/') ? { selected: [sel[0]] } : { events: [{ year: 1969, text: 'Die erste Folge der Sesamstraße läuft.' }] }));
  assert.equal(r2.body.h, '1969: Die erste Folge der Sesamstraße läuft.');
  assert.equal((await run1('damals', { selected: [sel[0], sel[2]], events: [] })).status, 404);
});
test('Adapter liga (OpenLigaDB): nur Vereine und Zahlen, geteilter erster Platz wird nicht gefragt', async () => {
  const t = (n, p, g, o) => ({ teamName: n, points: p, goals: g, opponentGoals: o, matches: 8 });
  const table = [t('FC A', 20, 30, 5), t('FC B', 18, 25, 9), t('FC C', 16, 20, 10), t('FC D', 15, 18, 11), t('FC E', 14, 17, 12), t('FC F', 13, 16, 13)];
  const r = await run1('liga', table);
  assert.ok(isQuiz(r.body)); assert.equal(r.body.c[r.body.a], 'FC A'); assert.equal(r.body.c.length, 4);
  assert.equal((await run1('liga', table.map((x) => ({ ...x, matches: 0 })))).status, 404, 'vor dem ersten Spieltag keine Frage');
});
test('Adapter polarlicht (NOAA): hoechster Kp der Nacht, ehrliche Einordnung fuer Deutschland', async () => {
  const kp = [['2027-01-04T15:00:00', 7], ['2027-01-04T21:00:00', 3.33], ['2027-01-05T03:00:00', 4]].map(([time_tag, k]) => ({ time_tag, kp: k, observed: 'predicted' }));
  const r = await run1('polarlicht', kp);
  assert.equal(r.body.h, 'Polarlicht heute Nacht in Deutschland: sehr gering'); assert.match(r.body.v, /^Kp 4,0 /);
});
test('Adapter pollen (DWD): staerkste zwei Pollen der Region, sonst ehrlich kaum etwas', async () => {
  const content = [{ region_id: 10, region_name: 'Schleswig-Holstein und Hamburg', Pollen: { Hasel: { today: '2' }, Erle: { today: '1' }, Birke: { today: '0' } } }];
  assert.equal((await run1('pollen', { content }, { q: '10' })).body.h, 'Hasel: mittel · Erle: gering');
  assert.equal((await run1('pollen', { content: [{ ...content[0], Pollen: {} }] }, { q: '10' })).body.h, 'Heute fliegen kaum Pollen.');
  assert.equal((await run1('pollen', { content }, { q: '999' })).status, 400);
});
