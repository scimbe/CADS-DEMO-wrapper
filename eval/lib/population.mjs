// Harness swarm: the population of personas (stratified sampling, seeded) and the task plan (persona x topic), pure.
//
// Strata: age band (7) x language (de/en). Quotas per age band are set so that every band has at least 6 people (the
// young and the old are over-sampled against the census on purpose: the spread matters more than the mean); ~15 % speak
// English. Within a stratum the other traits are drawn so that they fit the age (a pupil is 16-19, a retiree 63+).
// Sources for the marginals (orientation only, the quotas are set by hand): Destatis Bevoelkerung nach Altersgruppen 2023,
// Mikrozensus 2023 (Migrationshintergrund ~29 %), D21-Digital-Index 2023/24 (digital literacy groups).

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const wpick = (r, pairs) => { const sum = pairs.reduce((s, [, w]) => s + w, 0); let x = r() * sum; for (const [v, w] of pairs) { if ((x -= w) < 0) return v; } return pairs[pairs.length - 1][0]; };

export const AGE_BANDS = [
  { id: '16-17', min: 16, max: 17, n: 7 }, { id: '18-24', min: 18, max: 24, n: 11 }, { id: '25-34', min: 25, max: 34, n: 11 },
  { id: '35-49', min: 35, max: 49, n: 12 }, { id: '50-64', min: 50, max: 64, n: 11 }, { id: '65-74', min: 65, max: 74, n: 8 }, { id: '75-85', min: 75, max: 85, n: 6 },
];
// life situations with the ages they fit
const LIFE = [
  ['Schülerin/Schüler (Gymnasium)', 16, 19], ['Schülerin/Schüler (Realschule)', 16, 18], ['Azubi Kfz-Mechatronik', 16, 24], ['Azubi Friseurhandwerk', 16, 23], ['Studentin/Student', 19, 30],
  ['Pflegefachkraft im Schichtdienst', 21, 64], ['Erzieherin/Erzieher', 21, 64], ['Elternteil mit kleinen Kindern', 25, 45], ['Alleinerziehend, Teilzeit im Einzelhandel', 24, 50],
  ['Bürokaufmann/-frau', 22, 64], ['Handwerksmeister/in (Elektro)', 26, 64], ['Fliesenleger/in', 19, 62], ['Lehrkraft Grundschule', 27, 64], ['IT-Entwickler/in', 23, 55],
  ['Kassierer/in im Sportverein (ehrenamtlich)', 30, 80], ['Lkw-Fahrer/in', 25, 64], ['Selbständig mit kleinem Café', 28, 64], ['Arbeitssuchend', 20, 63],
  ['Rentner/in, aktiv im Chor', 63, 85], ['Rentner/in, Großeltern von Enkeln', 60, 85], ['Rentner/in, lebt allein', 66, 85], ['Hausmeister/in', 35, 66],
  ['Teamleitung im Callcenter', 28, 60], ['Altenpflegehelfer/in', 20, 64], ['Landwirt/in', 25, 75], ['Vorsitz Kleingartenverein', 45, 82], ['Pfarrsekretär/in', 40, 66],
];
const REGION_DE = [['Hamburg/Norddeutsch (Platt-Einschlag)', 2], ['Berlin (Berlinerisch)', 2], ['Sachsen (Sächsisch)', 1.5], ['Bayern (Bairisch)', 2], ['Schwaben (Schwäbisch)', 1.5],
  ['Köln/Rheinland (Kölsch-Einschlag)', 1.5], ['Ruhrgebiet (Ruhrdeutsch)', 1.5], ['Hessen (Hessisch)', 1], ['Österreich (Wienerisch)', 1], ['Schweiz (Schweizerdeutsch, schreibt ss statt ß)', 1],
  ['Thüringen', 0.7], ['Mecklenburg-Vorpommern', 0.7], ['Baden (Badisch)', 0.7], ['Hochdeutsch, kein Dialekt beim Schreiben', 4]];
const EDU = [['Hauptschulabschluss', 2], ['Mittlere Reife', 3], ['Abitur', 2.5], ['abgeschlossene Ausbildung', 3], ['Studium', 2.5], ['noch in der Schule', 0]];
// migration background and German as a second language (Deutsch als Zweitsprache, CEFR level)
const MIG = [['keiner', 7], ['türkische Familie, in Deutschland geboren (Deutsch Muttersprache, manchmal Türkisch-Wörter)', 1.2], ['russlanddeutsch, als Kind gekommen', 0.8],
  ['aus Syrien, seit 8 Jahren hier, Deutsch B1', 0.8], ['aus Polen, Deutsch B2', 0.6], ['aus der Ukraine, seit 3 Jahren hier, Deutsch A2-B1', 0.7], ['italienische Familie, zweite Generation', 0.5],
  ['aus Rumänien, Deutsch B1', 0.5], ['aus Vietnam, Deutsch B2', 0.3], ['aus Eritrea, Deutsch A2', 0.3], ['kroatische Familie, zweite Generation', 0.3]];
// English speakers living in Germany, each with the ages it fits
const EN_ORIGIN = [['British, lives in Berlin, German A2', 22, 70], ['American exchange pupil at a German school', 16, 18], ['Indian software engineer in Stuttgart, no German', 24, 50], ['Nigerian nurse in Hamburg, German B1', 24, 60],
  ['Irish office worker in Cologne, German A2', 25, 55], ['Australian on a working holiday', 18, 30], ['Canadian retiree living near the grandchildren in Germany', 62, 80], ['Filipino caregiver in Frankfurt, German B1', 25, 60],
  ['Ghanaian student in Aachen', 19, 30], ['US military family near Kaiserslautern', 20, 50], ['Scottish teacher at an international school', 26, 64], ['English-speaking teen of an expat family in Munich', 16, 19]];
const DIGITAL = { low: 'unsicher am Handy (tippt langsam, oft Diktierfunktion oder nur kurze Wörter, wenig Erfahrung mit Apps)', mid: 'normal (WhatsApp, Fotos, ein paar Apps)', high: 'sehr sicher (viele Apps, schreibt schnell, Abkürzungen)' };
const TYPING = ['schreibt alles klein, kaum Satzzeichen', 'macht Tippfehler und korrigiert sie nicht', 'nutzt gern Emojis', 'schreibt sehr kurz, Stichworte', 'schreibt lang und erzählt drumherum',
  'schreibt höflich und vollständig', 'nutzt Diktierfunktion (keine Satzzeichen, Wörter falsch erkannt)', 'schreibt wie in WhatsApp an Freunde', 'schreibt in Großbuchstaben, wenn aufgeregt', 'stellt lieber eine Frage als eine Anweisung'];

/** -> [{ id, lang, age, band, life, region, edu, mig, digital, typing:[2], gender }] */
export function makePopulation(seed = 20261111, { enShare = 0.15 } = {}) {
  const r = rng(seed), out = [];
  let n = 0;
  const total = AGE_BANDS.reduce((s, b) => s + b.n, 0), enN = Math.round(total * enShare);
  // English speakers spread over the bands 18-74 (an exchange pupil can be 16-17 too)
  const enSlots = new Set();
  const order = AGE_BANDS.flatMap((b) => Array.from({ length: b.n }, () => b.id));
  for (let i = 0; enSlots.size < enN; i = (i + 7) % order.length) if (!enSlots.has(i) && order[i] !== '75-85') enSlots.add(i);
  order.forEach((band, i) => {
    const b = AGE_BANDS.find((x) => x.id === band), age = b.min + Math.floor(r() * (b.max - b.min + 1));
    const lang = enSlots.has(i) ? 'en' : 'de';
    const lifes = LIFE.filter(([, lo, hi]) => age >= lo && age <= hi);
    const enLife = lang === 'en' ? pick(r, EN_ORIGIN.filter(([, lo, hi]) => age >= lo && age <= hi))[0] : '';
    const life = enLife || pick(r, lifes)[0];
    const edu = age < 18 || /Schüler|pupil|teen/.test(life) ? 'noch in der Schule' : /teacher|engineer/.test(life) ? 'Studium' : /student/.test(life) ? 'Abitur' : /Student|Lehrkraft|IT-/.test(life) ? (/Student/.test(life) ? 'Abitur' : 'Studium') : wpick(r, EDU);
    const digital = age >= 75 ? wpick(r, [['low', 3], ['mid', 2], ['high', 0.3]]) : age >= 60 ? wpick(r, [['low', 1.5], ['mid', 2.5], ['high', 1]]) : age < 30 ? wpick(r, [['low', 0.2], ['mid', 1.5], ['high', 3]]) : wpick(r, [['low', 0.5], ['mid', 2.5], ['high', 1.5]]);
    const t1 = pick(r, TYPING); let t2 = pick(r, TYPING); if (t2 === t1) t2 = TYPING[(TYPING.indexOf(t1) + 3) % TYPING.length];
    out.push({
      id: 'p' + String(++n).padStart(2, '0'), lang, age, band, life, gender: pick(r, ['w', 'm', 'w', 'm', 'd']),
      region: lang === 'en' ? 'lebt in Deutschland' : wpick(r, REGION_DE), edu, mig: lang === 'en' ? 'English native speaker' : wpick(r, MIG),
      digital, digitalText: DIGITAL[digital], typing: [t1, t2],
    });
  });
  return out;
}

// The topics of the user's brief. hint: the situation in neutral words, never the app's own words (no "Termin finden").
export const TOPICS = [
  { id: 'gesundheit', group: 'Karte', de: 'etwas rund um Gesundheit (gute Besserung, Vorsorge, Bewegung, Medikamente, Arzttermin, mentale Gesundheit, Pflege)', en: 'something around health (get well, check-ups, exercise, medication, mental health, caring for someone)' },
  { id: 'goodfeeling', group: 'Karte', de: 'jemandem ein gutes Gefühl geben (Danke, Mut machen, Geburtstag, Trost, einfach so, Lob)', en: 'making someone feel good (thanks, encouragement, birthday, comfort, just because, praise)' },
  { id: 'orga-termin', group: 'Orga', de: 'mehrere Leute müssen sich auf einen Tag oder eine Uhrzeit einigen, an dem alle können', en: 'several people need to agree on a day or time when everyone can make it' },
  { id: 'orga-geld', group: 'Orga', de: 'von mehreren Leuten Geld bekommen (für ein Geschenk, einen Ausflug, die Vereinskasse, eine Rechnung)', en: 'getting money from several people (for a gift, a trip, a club fee, a shared bill)' },
  { id: 'orga-essen', group: 'Orga', de: 'eine Gruppe will zusammen Essen bestellen oder entscheiden, was es zu essen gibt', en: 'a group wants to order food together or decide what to eat' },
  { id: 'orga-abgleich', group: 'Orga', de: 'Termine von mehreren Leuten nebeneinanderlegen und schauen, wann es passt (Schichtplan, Kalender, Fahrgemeinschaft)', en: 'comparing several people\'s schedules to see when it fits (shift plan, calendars, car pool)' },
  { id: 'spiel', group: 'Spiel', de: 'ein kleines Spiel, das man spielen oder mit anderen teilen will', en: 'a small game to play or to share with others' },
  { id: 'meme', group: 'Meme', de: 'ein lustiges Bild mit Spruch über etwas aus dem eigenen Alltag', en: 'a funny picture with a caption about something from daily life' },
  { id: 'quiz', group: 'Quiz', de: 'ein Quiz (zum Lernen, für die Familie, für Freunde, für den Verein)', en: 'a quiz (for learning, for family, friends or a club)' },
  { id: 'eigene', group: 'Eigene', de: 'irgendeine eigene Idee, was du dir von so einer App wünschen würdest', en: 'any own idea of what you would want from such an app' },
];
// Per persona 16 tasks: every topic once, then 6 more drawn with weights (games, orga and cards most often)
const EXTRA_W = [['spiel', 2.2], ['goodfeeling', 1.5], ['gesundheit', 1], ['orga-termin', 1], ['orga-geld', 1], ['orga-essen', 1], ['orga-abgleich', 0.6], ['meme', 1.2], ['quiz', 1.2], ['eigene', 1]];
const MOODS = ['an einem Sonntagabend', 'in der Mittagspause', 'kurz vor einem Geburtstag', 'nach einem anstrengenden Tag', 'im Bus', 'mit den Kindern neben sich', 'aus Langeweile',
  'weil ein Freund die App empfohlen hat', 'kurz vor Weihnachten', 'im Sommer', 'vor einem Vereinstreffen', 'spät nachts', 'in der Schulpause', 'nach einem Streit', 'im Wartezimmer'];

/** -> [{ id, persona, topic, mood, k }] ; ids "p03-t07" */
export function makeTasks(pop, seed = 7, perPersona = 16) {
  const r = rng(seed), out = [];
  for (const p of pop) {
    const list = TOPICS.map((t) => t.id);
    while (list.length < perPersona) list.push(wpick(r, EXTRA_W));
    // shuffle (Fisher-Yates)
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    list.forEach((topic, k) => out.push({ id: `${p.id}-t${String(k + 1).padStart(2, '0')}`, persona: p.id, topic, mood: pick(r, MOODS), k }));
  }
  return out;
}

/** Split by persona, stratified by age band and language (~50/25/25): no persona in two splits. -> { train:[ids], val:[ids], test:[ids] } */
export function splitPersonas(pop, seed = 3) {
  const r = rng(seed), out = { train: [], val: [], test: [] };
  const groups = {};
  for (const p of pop) (groups[p.band + '/' + p.lang] = groups[p.band + '/' + p.lang] || []).push(p.id);
  let carry = 0;
  for (const g of Object.keys(groups).sort()) {
    const ids = groups[g].slice();
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    ids.forEach((id) => {
      // round robin over a 4-slot wheel (train, train, val, test), carried across the groups so small groups balance out
      const slot = ['train', 'val', 'train', 'test'][carry++ % 4];
      out[slot].push(id);
    });
  }
  return out;
}
