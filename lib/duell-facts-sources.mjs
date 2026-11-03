// My Daily Idea, data cards: the free web APIs behind /api/duell/ai/fact (lib/duell-facts.mjs).
// Every source here was checked for commercial use, attribution, keys, HTTPS and fitness for 13+ (table in the PR).
// An adapter gets { date, q, lang, seed, get } and returns items { h, v?, c?, a?, r? }: h = the big line on the card,
// v = the strip line, c/a = answer chips and the right one, r = what the strip says after the answer.
// Numbers that change during the day are only ever asked in ranges and carry their time; the cache keeps a day's answer.
const T = (lang, de, en) => (lang === 'en' ? en : de);
const HOUR = 3600000;
const loc = (lang) => (lang === 'en' ? 'en-GB' : 'de-DE');
const fmt = (n, lang, d = 0) => n.toLocaleString(loc(lang), { minimumFractionDigits: d, maximumFractionDigits: d });
const clock = (iso, lang) => new Date(iso).toLocaleTimeString(loc(lang), { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
const dayMonth = (iso, lang) => new Date(iso).toLocaleDateString(loc(lang), { timeZone: 'Europe/Berlin', day: 'numeric', month: 'numeric' });
// Same seed, same order: a tiny PRNG so a day's chips and pairs are the same on every server.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function mix(arr, seed) { const r = rng(seed), o = arr.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; }
// Answer chips in a fixed order per day; a = where the right one ended up.
function quiz(h, right, wrong, seed, r) { const c = mix([right, ...wrong], seed); return { h, c, a: c.indexOf(right), ...(r ? { r } : {}) }; }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', eacute: 'é', ouml: 'ö', uuml: 'ü', auml: 'ä', szlig: 'ß', ntilde: 'ñ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', shy: '' };
export const unhtml = (s) => String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));

// Germany's states and the DWD pollen regions: the chips the page offers; nothing else is accepted.
export const STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'];
const STATE_NAME = { BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen' };
export const POLLEN_REGIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
const POLLEN = { Hasel: ['Hasel', 'Hazel'], Erle: ['Erle', 'Alder'], Esche: ['Esche', 'Ash'], Birke: ['Birke', 'Birch'], Graeser: ['Gräser', 'Grass'], Roggen: ['Roggen', 'Rye'], Beifuss: ['Beifuß', 'Mugwort'], Ambrosia: ['Ambrosia', 'Ragweed'] };
const LEVEL = { '0': 0, '0-1': 1, '1': 2, '1-2': 3, '2': 4, '2-3': 5, '3': 6 };
const LEVEL_WORD = [['keine', 'none'], ['kaum', 'hardly any'], ['gering', 'low'], ['gering bis mittel', 'low to medium'], ['mittel', 'medium'], ['mittel bis hoch', 'medium to high'], ['hoch', 'high']];
export const SNACKS = { cola: ['colas', 'Cola', 'Cola', 'ml'], schoko: ['milk-chocolates', 'Milchschokolade', 'Milk chocolate', 'g'], ketchup: ['tomato-ketchup', 'Ketchup', 'Ketchup', 'g'], eistee: ['iced-teas', 'Eistee', 'Iced tea', 'ml'], cornflakes: ['corn-flakes', 'Cornflakes', 'Cornflakes', 'g'], aufstrich: ['cocoa-and-hazelnuts-spreads', 'Schoko-Aufstrich', 'Chocolate spread', 'g'] };
const CITIES = [['Hamburg', 53.55, 9.99], ['Berlin', 52.52, 13.4], ['Köln', 50.94, 6.96], ['München', 48.14, 11.58], ['Dresden', 51.05, 13.74], ['Frankfurt', 50.11, 8.68], ['Stuttgart', 48.78, 9.18], ['Leipzig', 51.34, 12.37], ['Kiel', 54.32, 10.14], ['Freiburg', 47.99, 7.85], ['Rostock', 54.09, 12.1], ['Nürnberg', 49.45, 11.08]];
const ANIMALS = [['Fuchs', 'Fox', 'Vulpes vulpes'], ['Dachs', 'Badger', 'Meles meles'], ['Igel', 'Hedgehog', 'Erinaceus europaeus'], ['Eichhörnchen', 'Red squirrel', 'Sciurus vulgaris'], ['Reh', 'Roe deer', 'Capreolus capreolus'], ['Wildschwein', 'Wild boar', 'Sus scrofa'], ['Feldhase', 'Brown hare', 'Lepus europaeus'], ['Biber', 'Beaver', 'Castor fiber'], ['Waschbär', 'Raccoon', 'Procyon lotor'], ['Rotkehlchen', 'Robin', 'Erithacus rubecula'], ['Uhu', 'Eagle owl', 'Bubo bubo'], ['Feuersalamander', 'Fire salamander', 'Salamandra salamandra']];
const BANDS = ['Coldplay', 'Imagine Dragons', 'Linkin Park', 'Die Ärzte', 'Die Toten Hosen', 'Queen', 'ABBA', 'Maroon 5', 'OneRepublic', 'Kraftklub', 'AnnenMayKantereit', 'Twenty One Pilots', 'Arctic Monkeys', 'Green Day', 'The Beatles', 'Tokio Hotel', 'Seeed', 'BTS', 'Måneskin', 'Silbermond', 'Juli', 'Wir sind Helden', 'Revolverheld', 'Sportfreunde Stiller'];
const MONEY = [['USD', 'US-Dollar', 'US dollars'], ['JPY', 'Yen', 'yen'], ['GBP', 'britische Pfund', 'pounds'], ['CHF', 'Schweizer Franken', 'Swiss francs'], ['TRY', 'türkische Lira', 'Turkish lira'], ['SEK', 'schwedische Kronen', 'Swedish kronor'], ['PLN', 'Złoty', 'złoty'], ['CZK', 'tschechische Kronen', 'Czech koruna'], ['DKK', 'dänische Kronen', 'Danish kroner'], ['NOK', 'norwegische Kronen', 'Norwegian kroner'], ['KRW', 'Won', 'won'], ['THB', 'Baht', 'baht'], ['AUD', 'australische Dollar', 'Australian dollars'], ['MXN', 'mexikanische Pesos', 'Mexican pesos']];
// History of the day, but no war, death or crime: whatever touches one of these stems is skipped.
const GRIM = /krieg|schlacht|anschlag|attentat|mord|morde|ermord|töt|tote|todes|stirbt|starb|gestorben|hinricht|massaker|terror|bombe|explosion|absturz|abgestürzt|unglück|katastroph|erdbeben|pogrom|völkermord|holocaust|konzentrationslager|\bkz\b|putsch|invasion|besetz|gefecht|militär|armee|soldat|truppe|waffe|hitler|nsdap|\bnazi|diktat|verbrech|gefängnis|haft|selbstmord|suizid|epidemie|pandemie|seuche|\bpest\b|opfer|unfall|brand|flut|sturm|hurrikan|geisel|entführ|\bwar\b|battle|attack|murder|kill|dies\b|died|death|dead|execut|massacre|bomb|crash|disaster|army|troops|military|terror|hostage|prison|shot|assassin|invade|invasion|riot/i;

export const SOURCES = {
  quiz: {   // Open Trivia DB, CC BY-SA 4.0; questions are English only
    credit: 'opentdb.com · CC BY-SA 4.0', ttlMs: 24 * HOUR,
    async fetch({ seed, get }) {
      const cat = [9, 17, 22, 27][seed % 4], j = await get(`https://opentdb.com/api.php?amount=10&type=multiple&difficulty=easy&category=${cat}`);
      if (!j || j.response_code !== 0 || !Array.isArray(j.results)) throw new Error('shape');
      return j.results.filter((q) => q && Array.isArray(q.incorrect_answers) && q.incorrect_answers.length === 3)
        .map((q, i) => quiz(unhtml(q.question), unhtml(q.correct_answer), q.incorrect_answers.map(unhtml), seed + i));
    },
  },
  hauptstadt: {   // Wikidata, CC0
    credit: 'Wikidata · CC0', ttlMs: 24 * HOUR,
    async fetch({ seed, lang, get }) {
      const l = lang === 'en' ? 'en' : 'de';
      const q = `SELECT ?c ?cl ?kl ?ct WHERE { ?c wdt:P31 wd:Q3624078; wdt:P36 ?k; wdt:P30 ?ct. FILTER NOT EXISTS { ?c wdt:P576 [] } ?c rdfs:label ?cl FILTER(lang(?cl)="${l}") ?k rdfs:label ?kl FILTER(lang(?kl)="${l}") }`;
      const j = await get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { Accept: 'application/sparql-results+json' });
      const rows = j && j.results && Array.isArray(j.results.bindings) ? j.results.bindings : null;
      if (!rows) throw new Error('shape');
      const by = new Map();   // country -> { name, caps:Set, parts:Set }
      for (const b of rows) {
        const id = b.c && b.c.value, n = b.cl && b.cl.value, k = b.kl && b.kl.value, ct = b.ct && b.ct.value;
        if (!id || !n || !k || /^Q\d+$/.test(n) || /^Q\d+$/.test(k)) continue;
        const e = by.get(id) || { n, caps: new Set(), parts: new Set() }; e.caps.add(k); if (ct) e.parts.add(ct); by.set(id, e);
      }
      const list = [...by.entries()].filter(([, e]) => e.caps.size === 1).sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => ({ n: e.n, k: [...e.caps][0], parts: e.parts }));
      return list.map((e, i) => {
        const near = list.filter((o) => o !== e && o.k !== e.k && [...o.parts].some((p) => e.parts.has(p)));
        const pool = near.length >= 3 ? near : list.filter((o) => o !== e && o.k !== e.k);
        return quiz(T(lang, `Was ist die Hauptstadt von ${e.n}?`, `What is the capital of ${e.n}?`), e.k, mix(pool, seed + i).slice(0, 3).map((o) => o.k), seed + i);
      });
    },
  },
  waermste: {   // Bright Sky, DWD data CC BY 4.0
    credit: 'Deutscher Wetterdienst · CC BY 4.0 · via Bright Sky', ttlMs: 3 * HOUR, ordered: true,
    async fetch({ seed, lang, get }) {
      const six = mix(CITIES, seed).slice(0, 6), seen = [];
      for (const [name, lat, lon] of six) {
        const j = await get(`https://api.brightsky.dev/current_weather?lat=${lat}&lon=${lon}`), w = j && j.weather, t = w && num(w.temperature);
        if (t === null || !w.timestamp) throw new Error('shape');
        seen.push({ name, t, at: w.timestamp });
      }
      // Four chips with exactly one warmest: the warmest city, then three that are really colder.
      seen.sort((x, y) => y.t - x.t);
      const w = seen[0], colder = seen.filter((s) => s.t < w.t).slice(0, 3);
      if (colder.length < 3) return [];
      return [quiz(T(lang, 'Wo ist es gerade am wärmsten?', 'Where is it warmest right now?'), w.name, colder.map((s) => s.name), seed,
        `${w.name} ${fmt(w.t, lang, 1)} °C · ${T(lang, 'Stand', 'at')} ${clock(w.at, lang)}`)];
    },
  },
  tiere: {   // GBIF occurrence counts for Germany
    credit: 'GBIF.org · Meldungen in Deutschland', ttlMs: 24 * HOUR, ordered: true,
    async fetch({ seed, lang, get }) {
      const pair = mix(ANIMALS, seed).slice(0, 2), seen = [];
      for (const [de, en, sci] of pair) {
        const m = await get(`https://api.gbif.org/v1/species/match?rank=SPECIES&name=${encodeURIComponent(sci)}`);
        if (!m || !Number.isInteger(m.usageKey) || m.matchType !== 'EXACT') throw new Error('shape');
        const o = await get(`https://api.gbif.org/v1/occurrence/search?country=DE&limit=0&taxonKey=${m.usageKey}`);
        if (!o || !Number.isInteger(o.count)) throw new Error('shape');
        seen.push({ n: T(lang, de, en), c: o.count });
      }
      if (seen[0].c === seen[1].c) return [];
      const [a, b] = seen, win = a.c > b.c ? a : b;
      return [quiz(T(lang, 'Wer wurde in Deutschland öfter gemeldet?', 'Which was reported more often in Germany?'), win.n, [(win === a ? b : a).n], seed,
        `${a.n} ${fmt(a.c, lang)} · ${b.n} ${fmt(b.c, lang)} ${T(lang, 'Meldungen', 'records')}`)];
    },
  },
  band: {   // MusicBrainz core data, CC0; only the fixed list of groups below, never people
    credit: 'MusicBrainz · CC0', ttlMs: 24 * HOUR, ordered: true,
    async fetch({ seed, lang, get }) {
      const pair = mix(BANDS, seed).slice(0, 2), seen = [];
      for (const name of pair) {
        if (seen.length) await new Promise((r) => setTimeout(r, 1100));   // MusicBrainz: one request a second
        const j = await get(`https://musicbrainz.org/ws/2/artist?fmt=json&limit=5&query=${encodeURIComponent(`artist:"${name}" AND type:group`)}`);
        const hit = j && Array.isArray(j.artists) ? j.artists.find((x) => x && x.name === name && x.type === 'Group' && x['life-span'] && /^\d{4}/.test(x['life-span'].begin || '')) : null;
        if (!hit) throw new Error('shape');
        seen.push({ n: name, y: Number(hit['life-span'].begin.slice(0, 4)) });
      }
      if (seen[0].y === seen[1].y) return [];
      const [a, b] = seen, old = a.y < b.y ? a : b;
      return [quiz(T(lang, 'Welche Band gibt es schon länger?', 'Which band has been around longer?'), old.n, [(old === a ? b : a).n], seed, `${a.n} ${a.y} · ${b.n} ${b.y}`)];
    },
  },
  geld: {   // ECB reference rates via Frankfurter
    credit: 'Kurse: Europäische Zentralbank · via frankfurter.dev', ttlMs: 12 * HOUR, ordered: true,
    async fetch({ seed, lang, get }) {
      const [code, de, en] = MONEY[seed % MONEY.length], j = await get(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${code}`);
      const rate = j && j.rates && num(j.rates[code]);
      if (!rate || !j.date) throw new Error('shape');
      const v = 10 * rate, d = v < 100 ? 2 : 0, show = (x) => fmt(x, lang, d), name = T(lang, de, en);
      return [quiz(T(lang, `10 € sind heute wie viele ${name}?`, `How many ${name} do you get for 10 €?`), show(v), [show(v / 3), show(v * 2.5), show(v * 6)], seed,
        `10 € = ${show(v)} ${name} · ${T(lang, 'Kurs vom', 'rate of')} ${dayMonth(j.date + 'T12:00:00Z', lang)}`)];
    },
  },
  strom: {   // Energy-Charts (Fraunhofer ISE), CC BY 4.0
    credit: 'Energy-Charts.info (Fraunhofer ISE) · CC BY 4.0', ttlMs: 3 * HOUR, ordered: true,
    async fetch({ seed, lang, get }) {
      const j = await get('https://api.energy-charts.info/public_power?country=de'), ts = j && j.unix_seconds;
      const row = j && Array.isArray(j.production_types) ? j.production_types.find((p) => p && p.name === 'Renewable share of load') : null;
      if (!Array.isArray(ts) || !row || !Array.isArray(row.data)) throw new Error('shape');
      let i = row.data.length - 1; while (i >= 0 && num(row.data[i]) === null) i--;
      if (i < 0 || !num(ts[i])) throw new Error('shape');
      const p = Math.max(0, Math.min(100, Math.round(row.data[i]))), bins = T(lang, ['unter 25 %', '25 bis 50 %', '50 bis 75 %', 'über 75 %'], ['under 25 %', '25 to 50 %', '50 to 75 %', 'over 75 %']);
      return [{ h: T(lang, 'Wie viel Strom kommt gerade aus Sonne, Wind und Co.?', 'How much power comes from sun, wind and co. right now?'), c: bins, a: Math.min(3, Math.floor(p / 25)),
        r: `${p} % ${T(lang, 'erneuerbar', 'renewable')} · ${T(lang, 'Stand', 'at')} ${clock(ts[i] * 1000, lang)}` }];
    },
  },
  ferien: {   // OpenHolidays API, ODbL
    credit: 'OpenHolidays API · ODbL', ttlMs: 12 * HOUR, ordered: true, input: { max: 2, re: new RegExp(`^(${STATES.join('|')})$`) },
    async fetch({ date, q, lang, get }) {
      const to = new Date(Date.parse(date) + 400 * 86400000).toISOString().slice(0, 10);
      const j = await get(`https://openholidaysapi.org/SchoolHolidays?countryIsoCode=DE&languageIsoCode=${lang === 'en' ? 'EN' : 'DE'}&subdivisionCode=DE-${q}&validFrom=${date}&validTo=${to}`);
      if (!Array.isArray(j)) throw new Error('shape');
      const next = j.filter((h) => h && /^\d{4}-\d{2}-\d{2}$/.test(h.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(h.endDate) && h.endDate >= date && Array.isArray(h.name) && h.name[0] && h.name[0].text)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
      if (!next) return [];
      const name = next.name[0].text, days = Math.round((Date.parse(next.startDate) - Date.parse(date)) / 86400000), end = dayMonth(next.endDate + 'T12:00:00Z', lang);
      const h = days <= 0 ? T(lang, `Ferien! ${name} bis ${end}`, `Holidays! ${name} until ${end}`)
        : days === 1 ? T(lang, `Morgen fangen die ${name} an!`, `${name} start tomorrow!`)
          : T(lang, `Noch ${days} Tage bis zu den ${name}`, `${days} days to go until ${name}`);
      return [{ h, v: `${STATE_NAME[q]} · ${dayMonth(next.startDate + 'T12:00:00Z', lang)} – ${end}` }];
    },
  },
  zucker: {   // Open Food Facts, ODbL: the middle of the most scanned products of a kind, no brand on the card
    credit: 'Open Food Facts · ODbL', ttlMs: 24 * HOUR, ordered: true, input: { max: 12, re: new RegExp(`^(${Object.keys(SNACKS).join('|')})$`) },
    async fetch({ q, lang, get }) {
      const [tag, de, en, unit] = SNACKS[q];
      const j = await get(`https://world.openfoodfacts.org/api/v2/search?categories_tags_en=${tag}&countries_tags_en=germany&fields=nutriments,categories_tags&sort_by=unique_scans_n&page_size=20`);
      if (!j || !Array.isArray(j.products)) throw new Error('shape');
      const vals = j.products.filter((p) => p && !(p.categories_tags || []).some((c) => /alcohol/.test(c))).map((p) => p.nutriments && num(p.nutriments.sugars_100g))
        .filter((v) => v !== null && v >= 0 && v <= 100).sort((a, b) => a - b);
      if (vals.length < 5) return [];
      const mid = vals[Math.floor(vals.length / 2)], cubes = Math.round(mid / 3);
      return [{ h: T(lang, `${de}: ${fmt(mid, lang, 1)} g Zucker pro 100 ${unit}`, `${en}: ${fmt(mid, lang, 1)} g sugar per 100 ${unit}`),
        v: T(lang, `≈ ${cubes} Zuckerwürfel · Mitte von ${vals.length} Produkten`, `≈ ${cubes} sugar cubes · middle of ${vals.length} products`) }];
    },
  },
  beben: {   // USGS, public domain
    credit: 'U.S. Geological Survey · Public Domain', ttlMs: 3 * HOUR, ordered: true,
    async fetch({ lang, get }) {
      const j = await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
      if (!j || !Array.isArray(j.features)) throw new Error('shape');
      const q = j.features.map((f) => f && f.properties).filter((p) => p && num(p.mag) !== null && typeof p.place === 'string' && num(p.time) !== null).sort((a, b) => b.mag - a.mag)[0];
      if (!q) return [{ h: T(lang, 'Heute ruhig: kein Beben ab Stärke 4,5', 'Quiet today: no quake of 4.5 or more'), v: T(lang, 'letzte 24 Stunden, weltweit', 'last 24 hours, worldwide') }];
      const where = q.place.includes(', ') ? q.place.slice(q.place.lastIndexOf(', ') + 2) : q.place;
      return [{ h: T(lang, `Stärke ${fmt(q.mag, lang, 1)}: ${where}`, `Magnitude ${fmt(q.mag, lang, 1)}: ${where}`), v: `${q.place} · ${clock(q.time, lang)}` }];
    },
  },
  damals: {   // Wikipedia "on this day", CC BY-SA 4.0, without war, death or crime
    credit: 'Wikipedia · CC BY-SA 4.0', ttlMs: 24 * HOUR,
    async fetch({ date, lang, get }) {
      // The editors' selection first, the long list only if nothing there fits. A line is one whole sentence part, never cut.
      const now = Number(date.slice(0, 4)), md = `${date.slice(5, 7)}/${date.slice(8, 10)}`, base = `https://api.wikimedia.org/feed/v1/wikipedia/${lang === 'en' ? 'en' : 'de'}/onthisday/`;
      const fit = (list) => (Array.isArray(list) ? list : []).filter((e) => e && Number.isInteger(e.year) && e.year < now && typeof e.text === 'string' && !GRIM.test(e.text))
        .map((e) => ({ s: `${e.year}: ${e.text.replace(/\u00ad/g, '').split('; ')[0].replace(/[;,:]$/, '')}`, y: e.year })).filter((e) => [...e.s].length <= 90)
        .map((e) => ({ h: e.s, v: T(lang, `Heute vor ${now - e.y} Jahren`, `${now - e.y} years ago today`) }));
      const j = await get(base + 'selected/' + md);
      if (!j || !Array.isArray(j.selected)) throw new Error('shape');
      const picked = fit(j.selected);
      if (picked.length) return picked;
      const more = await get(base + 'events/' + md);
      return fit(more && more.events);
    },
  },
  liga: {   // OpenLigaDB, ODbL: only the Bundesliga table (club names and numbers, never players)
    credit: 'OpenLigaDB.de · ODbL', ttlMs: 6 * HOUR, ordered: true,
    async fetch({ date, seed, lang, get }) {
      const season = Number(date.slice(5, 7)) >= 7 ? Number(date.slice(0, 4)) : Number(date.slice(0, 4)) - 1;
      const j = await get(`https://api.openligadb.de/getbltable/bl1/${season}`);
      if (!Array.isArray(j)) throw new Error('shape');
      const rows = j.filter((x) => x && typeof x.teamName === 'string' && [x.points, x.goals, x.opponentGoals, x.matches].every((v) => Number.isInteger(v)));
      if (rows.length < 6 || !rows[0].matches) return [];
      const ask = [
        { h: T(lang, 'Wer steht gerade auf Platz 1 der Bundesliga?', 'Who is top of the Bundesliga right now?'), list: rows.slice(0, 6), best: rows[0], r: (x) => `1. ${x.teamName} · ${x.points} ${T(lang, 'Punkte', 'points')}` },
        { h: T(lang, 'Wer hat in der Bundesliga die meisten Tore geschossen?', 'Who has scored the most Bundesliga goals?'), list: rows.slice().sort((a, b) => b.goals - a.goals), r: (x) => `${x.teamName} · ${x.goals} ${T(lang, 'Tore', 'goals')}` },
        { h: T(lang, 'Wer hat in der Bundesliga die wenigsten Gegentore?', 'Who has conceded the fewest Bundesliga goals?'), list: rows.slice().sort((a, b) => a.opponentGoals - b.opponentGoals), r: (x) => `${x.teamName} · ${x.opponentGoals} ${T(lang, 'Gegentore', 'conceded')}` },
      ];
      const val = [null, (x) => x.goals, (x) => x.opponentGoals];
      for (let i = 0; i < 3; i++) {
        const k = (seed + i) % 3, q = ask[k], best = q.best || q.list[0];
        const others = k === 0 ? q.list.slice(1, 6) : q.list.filter((x) => val[k](x) !== val[k](best)).slice(0, 5);
        if (k && q.list.filter((x) => val[k](x) === val[k](best)).length > 1) continue;   // a shared first place has no single answer
        if (others.length < 3) continue;
        return [quiz(q.h, best.teamName, mix(others, seed).slice(0, 3).map((x) => x.teamName), seed, q.r(best))];
      }
      return [];
    },
  },
  polarlicht: {   // NOAA SWPC planetary K-index forecast, US government work
    credit: 'NOAA Space Weather Prediction Center · Public Domain', ttlMs: 6 * HOUR, ordered: true,
    async fetch({ date, lang, get }) {
      const j = await get('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json');
      if (!Array.isArray(j)) throw new Error('shape');
      const from = Date.parse(date + 'T18:00:00Z'), to = from + 12 * HOUR;
      const kp = j.filter((x) => x && typeof x.time_tag === 'string' && num(Number(x.kp)) !== null).filter((x) => { const t = Date.parse(x.time_tag + 'Z'); return t >= from && t < to; }).map((x) => Number(x.kp));
      if (!kp.length) throw new Error('shape');
      const k = Math.max(...kp), word = k >= 7 ? T(lang, 'gut, auch weiter im Süden', 'good, even further south') : k >= 6 ? T(lang, 'möglich im Norden', 'possible in the north')
        : k >= 5 ? T(lang, 'nur ganz im Norden, mit Glück', 'only far north, with luck') : T(lang, 'sehr gering', 'very low');
      return [{ h: T(lang, `Polarlicht heute Nacht in Deutschland: ${word}`, `Northern lights over Germany tonight: ${word}`),
        v: T(lang, `Kp ${fmt(k, lang, 1)} · bei uns meist erst ab Kp 6 zu sehen`, `Kp ${fmt(k, lang, 1)} · usually visible here from Kp 6`) }];
    },
  },
  pollen: {   // Deutscher Wetterdienst pollen index, CC BY 4.0
    credit: 'Deutscher Wetterdienst · CC BY 4.0', ttlMs: 6 * HOUR, ordered: true, input: { max: 3, re: new RegExp(`^(${POLLEN_REGIONS.join('|')})$`) },
    async fetch({ q, lang, get }) {
      const j = await get('https://opendata.dwd.de/climate_environment/health/alerts/s31fg.json');
      const parts = j && Array.isArray(j.content) ? j.content.filter((x) => x && x.region_id === Number(q) && x.Pollen) : [];
      if (!parts.length) throw new Error('shape');
      const worst = Object.keys(POLLEN).map((k) => ({ k, l: Math.max(...parts.map((p) => LEVEL[p.Pollen[k] && p.Pollen[k].today] ?? 0)) })).filter((x) => x.l > 0).sort((a, b) => b.l - a.l).slice(0, 2);
      const region = parts[0].region_name;
      if (!worst.length) return [{ h: T(lang, 'Heute fliegen kaum Pollen.', 'Hardly any pollen today.'), v: region }];
      return [{ h: worst.map((x) => `${T(lang, ...POLLEN[x.k])}: ${T(lang, ...LEVEL_WORD[x.l])}`).join(' · '), v: region }];
    },
  },
};
