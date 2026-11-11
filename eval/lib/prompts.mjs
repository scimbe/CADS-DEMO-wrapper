// Harness swarm: the texts of the persona agents and the judges, and their output schemas. The persona agents know
// nothing of the app but the screen as the app shows it (labels of apps/duell-web, branch feat/freie-karte-kategorie-genre).

export const SCREEN = {
  de: { cats: ['Karte', 'Meme', 'Spiel', 'Quiz', 'Wie eine Karte'], genres: ['Fliegen', 'Jump & Run'], soon: ['Strategie', 'Zahlen schieben', 'Rennen', 'Karten & Brett', 'Schätzen', 'Wählen & Bluffen', 'Skala'],
    text: `Du siehst auf dem Handy eine App. Oben steht „Deine eigene Karte“. Darunter: „Beschreib in einem Satz, was die Karte sein soll. Die KI baut sie im Stil der Tageskarten.“
Dann die Frage „Was soll es werden?“ mit fünf Knöpfen: 🃏 Karte · 📷 Meme · 🕹 Spiel · ❓ Quiz · 🧩 Wie eine Karte. Keiner ist vorausgewählt.
Tippt man auf „Spiel“, kommt „Welche Art?“ mit ✈️ Fliegen · 🏃 Jump & Run, und grau daneben „Bald:“ ♟️ Strategie · 🔢 Zahlen schieben · 🏎 Rennen · 🎲 Karten & Brett · 📏 Schätzen · 🎭 Wählen & Bluffen · 🎚 Skala.
Darunter ein leeres Textfeld und ein Knopf „Erschaffen“.
Mehr weißt du über die App nicht.` },
  en: { cats: ['Card', 'Meme', 'Game', 'Quiz', 'Like a card'], genres: ['Flying', 'Jump & run'], soon: ['Strategy', 'Sliding numbers', 'Racing', 'Cards & board', 'Estimating', 'Choose & bluff', 'Scale'],
    text: `You see an app on your phone. At the top: "Your own card". Below: "Describe in one sentence what the card should be. The AI builds it in the style of the daily cards."
Then "What should it be?" with five buttons: 🃏 Card · 📷 Meme · 🕹 Game · ❓ Quiz · 🧩 Like a card. None is preselected.
Tapping "Game" shows "What kind?" with ✈️ Flying · 🏃 Jump & run, and greyed out next to it "Soon:" ♟️ Strategy · 🔢 Sliding numbers · 🏎 Racing · 🎲 Cards & board · 📏 Estimating · 🎭 Choose & bluff · 🎚 Scale.
Below an empty text field and a button "Create".
That is all you know about the app.` },
};
/** the UI label -> the request the app sends (art, genre) ; a "Bald" genre sends nothing */
export function artOf(lang, cat, genre) {
  const S = SCREEN[lang === 'en' ? 'en' : 'de'], i = S.cats.indexOf(cat);
  const art = ['card', 'meme', 'game', 'quiz', 'faehigkeit'][i] || '';
  if (art !== 'game') return { art };
  const g = S.genres.indexOf(genre);
  if (g >= 0) return { art, genre: g === 0 ? 'G1' : 'G2' };
  const s = S.soon.indexOf(genre);
  return s >= 0 ? { art, soon: ['strategie', 'schieben', 'rennen', 'brett', 'schaetzen', 'bluff', 'skala'][s] } : { art: '' };
}
// apps/duell-web src/create-ui.js SOON: what a tap on a "Bald" chip offers
export const SOON_NEAR = { strategie: ['zug-bluff', 'zug-steine'], schieben: ['zug-steine'], rennen: [], brett: ['tisch-skat'], schaetzen: ['quiz-preis'], bluff: ['zug-luege', 'zug-bluff'], skala: [] };

export const PERSONA_SYSTEM = `You play one real person who uses a phone app for the first time. You are not an assistant and you do not help the app: you behave exactly like this person would, with their age, background, language level, typing habits and patience.
Write in the person's own language (German or English as given), in their own voice: real people type short, lowercase, with typos, missing words, dialect or slang, abbreviations, sometimes too vague, sometimes far too long with private details, sometimes as a question. Never polished, never a list, never "Bitte erstelle eine ansprechende ...". A person with German as a second language makes the mistakes that fit their level. A person who dictates gets misheard words and no punctuation.
You first invent a concrete little situation from this person's own life that fits the topic, then decide what you would tap and type. You also note privately what you imagine will come out (the "Vorstellung"): how it looks or works and what it is for, 1-3 sentences in your own words.
The text field is one line on a phone screen. Most people type a short phrase of about 3 to 12 words there and leave the details out (they assume the app will figure it out); only a person whose habit is to ramble or dictate writes much more. Do not put your whole situation into the field.
Only use the buttons you see. If nothing fits well, pick what seems closest to you, as a real person would.`;
export const PERSONA_SCHEMA = { type: 'object', additionalProperties: false, required: ['situation', 'kategorie', 'spielart', 'getippt', 'vorstellung'],
  properties: { situation: { type: 'string' }, kategorie: { type: 'string', enum: [...new Set([...SCREEN.de.cats, ...SCREEN.en.cats])] },
    spielart: { type: 'string', enum: ['-', ...new Set([...SCREEN.de.genres, ...SCREEN.de.soon, ...SCREEN.en.genres, ...SCREEN.en.soon])] }, getippt: { type: 'string' }, vorstellung: { type: 'string' } } };

export function personaUser(p, task, topic, extra = '') {
  const S = SCREEN[p.lang];
  return `${S.text}

The person: ${p.lang === 'en' ? 'English-speaking' : 'German-speaking'}, ${p.age} years, gender ${p.gender}, ${p.life}; region: ${p.region}; education: ${p.edu}; background: ${p.mig}; phone skills: ${p.digitalText}; typing: ${p.typing.join('; ')}.
Moment: ${task.mood}. Topic of what you want right now: ${topic[p.lang === 'en' ? 'en' : 'de']}.
Use the button labels exactly as shown (${S.cats.join(', ')}; for a game the kind, else "-"). "getippt" is exactly what this person types into the field, nothing else.${extra}`;
}

export const REALISM_SYSTEM = `You judge whether texts were typed by real people into a one-line text field of a phone app ("Describe in one sentence what the card should be"), or whether they read like they were written by an AI pretending to be a person.
Reference: real inputs into such fields (search boxes, chat apps, app prompts) are mostly short (about 3-15 words), often lowercase, without final punctuation, with typos, colloquial or dialect words, vague or with odd private details, sometimes a question or a fragment; few people write full polished sentences, and almost nobody writes lists, stacked adjectives ("eine liebevolle, kreative und personalisierte Karte"), explanations of the purpose to the machine, or over-polite formulas ("Bitte erstelle mir ...", "Könntest du bitte ..."). A text that states the writer's own age or job like a profile ("Als 67-jährige Rentnerin ...") is AI-like. Long rambling inputs exist but read like spoken language, not like a brief.
For each item return: human (1 = clearly AI-written, 2 = probably AI, 3 = plausible, 4 = typical human, 5 = unmistakably human), the flags that apply, and a reason of at most 12 words. Length: more than 25 words is rare in such a field: at most 3 unless it clearly reads like dictated or rambling speech; more than 40 words: at most 2. A text that packs every detail of a situation (names, ages, dates, wishes for tone) into one input is AI-like.
Judge only the text, not whether it is a good idea.`;
export const REALISM_SCHEMA = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'human', 'typos', 'dialect', 'too_polished', 'list', 'over_polite', 'llm_phrasing', 'reason'],
  properties: { id: { type: 'string' }, human: { type: 'integer', enum: [1, 2, 3, 4, 5] }, typos: { type: 'boolean' }, dialect: { type: 'boolean' }, too_polished: { type: 'boolean' }, list: { type: 'boolean' }, over_polite: { type: 'boolean' }, llm_phrasing: { type: 'boolean' }, reason: { type: 'string' } } } } } };

export const FAILURES = ['none', 'wrong_substitute', 'refused_buildable', 'missed_catalog_card', 'wrong_catalog_card', 'wrong_genre', 'generic_text', 'ignores_details', 'misunderstood', 'factual_error',
  'wrong_language', 'cut_or_broken', 'unhelpful_refusal', 'unfit_content', 'error'];
/** The grading rubric with the product facts the judge needs (catalog from lib/duell-karte.mjs CAPS) */
export function judgeSystem(caps) {
  return `You grade the free card ("Erschaffe deine Karte") of the app "My Daily Idea" for one real person's input. You are strict and fair, and you grade what the person gets, not the effort.

What the product can make (and nothing else):
- Karte/Card: a sticker-style card with a title, ONE line of text (max 80 characters), a style and 2-5 emoji stickers. It is a static image to share; it cannot collect replies, votes, dates or money.
- Meme: two captions (top, bottom, max ~26 characters each) on the person's OWN photo, which stays on the device (the app never sees or makes the picture).
- Spiel/Game, kind Fliegen/Flying: a small tap-to-fly game (flappy style) with a figure emoji, a world (day, night, sunset, retro, candy, neon, ocean, lava), a background motif, a difficulty and a 3-part route.
- Spiel/Game, kind Jump & Run: a side-scrolling runner with a figure, world (bridges, city, forest, desert, ice, night, lava, candy), obstacles, coins, enemies, endless or with a goal.
- Other games (strategy, sliding numbers, racing, board/card games, chess, darts as a free game, sports ...) do not exist yet: the honest answer is "not yet" plus the closest catalog card. The greyed "Bald/Soon" chips say so in the app.
- Quiz: 3-5 multiple-choice questions with one right and three wrong answers, a title; the person shares it by link.
- Wie eine Karte/Like a card: one of these existing catalog cards, with the person's own title and subtitle. Each works by link, one move after the other, never live. These are the only ways to find a date, compare schedules, collect money (from 18 only, under 18 the card plans without money), vote, draw names, keep a shopping list, etc.:
${caps.map((c) => `  ${c.id}: ${c.de}${c.adult ? ' [ab 18]' : ''}`).join('\n')}
- The app never sends messages for the person, never orders food or pays, has no sound cards, and cannot show real people, brands or film/game characters. It refuses harmful content; crisis texts get help numbers.
- Under 16 cannot use it; 16-17 count as under 18.

Routing: the person picked a category button BEFORE typing. The server builds in that category; for "Spiel" without a fitting engine and for "Wie eine Karte" it matches the wish against the catalog. A good result uses the category and catalog card that really does what the person wanted. An honest "not yet" (with a useful alternative) for something the product cannot make is GOOD. Building something else silently (a sticker card for "who can come when", a flying game for "chess") is a wrong substitute.

Score each dimension 0-4:
- intent: does the result do what the typed text asked? 4 fully; 3 mostly, a small detail missing; 2 half; 1 barely; 0 not at all or the opposite. For an honest "not yet": 4 if the wish really cannot be made and the alternative fits, 2 if the alternative is weak, 1 if it could have been made.
- vorstellung: does it match what the person privately imagined (given separately; the system never saw it)? Same scale. Missing information in a vague input is not the system's fault if a sensible reading was chosen: then at least 2.
- routing: right category/genre/catalog card or an honest refusal. 4 right; 3 acceptable choice, a better one existed; 2 debatable; 1 poor (e.g. refused although buildable); 0 wrong substitute (built something that only looks like an answer but does not do the core of the wish) or harmful.
- quality: wording, fit and fun for THIS person (age, language, occasion), correct facts, appropriate tone, no awkward or cut texts. 4 great, 2 ok but bland or with a flaw, 0 broken or unfit. For a refusal: is the message clear and kind, with a usable next step?
Also return: buildable ("ja" the product can do the core of the wish in some category, "teilweise", "nein"), expected (what would have been best, at most 20 words), failure (the main failure, or "none"), and reason (at most 30 words, cite the result).
Write expected and reason in German.`;
}
export const JUDGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['intent', 'vorstellung', 'routing', 'quality', 'buildable', 'expected', 'failure', 'reason'],
  properties: { intent: { type: 'integer', enum: [0, 1, 2, 3, 4] }, vorstellung: { type: 'integer', enum: [0, 1, 2, 3, 4] }, routing: { type: 'integer', enum: [0, 1, 2, 3, 4] }, quality: { type: 'integer', enum: [0, 1, 2, 3, 4] },
    buildable: { type: 'string', enum: ['ja', 'teilweise', 'nein'] }, expected: { type: 'string' }, failure: { type: 'string', enum: FAILURES }, reason: { type: 'string' } } };
export function judgeUser(row, shown) {
  return `Person: ${row.personaLine}
Category tapped: ${row.kategorie}${row.spielart && row.spielart !== '-' ? ' / kind: ' + row.spielart : ''}
Typed text: <typed>${JSON.stringify(row.getippt)}</typed>
Private Vorstellung (never seen by the system): <vorstellung>${JSON.stringify(row.vorstellung)}</vorstellung>
What the app showed:
<result>
${shown}
</result>`;
}

// ---- correction -------------------------------------------------------------------------------------------------------
export const CORR_SCHEMA = { type: 'object', additionalProperties: false, required: ['zufrieden', 'weg', 'text'],
  properties: { zufrieden: { type: 'boolean' }, weg: { type: 'string', enum: ['fertig', 'wunsch', 'neu', 'selbst'] }, text: { type: 'string' } } };
export function corrUser(p, row, shown, ways, round) {
  return `${SCREEN[p.lang].text}

The person: ${p.lang === 'en' ? 'English-speaking' : 'German-speaking'}, ${p.age} years, ${p.life}; background: ${p.mig}; phone skills: ${p.digitalText}; typing: ${p.typing.join('; ')}.
You tapped ${row.kategorie}${row.spielart && row.spielart !== '-' ? ' / ' + row.spielart : ''} and typed: ${JSON.stringify(row.typedNow)}
What you privately imagined: ${JSON.stringify(row.vorstellung)}
${round > 1 ? 'This is your attempt number ' + round + ' to fix it.\n' : ''}The app now shows:
${shown}

What you can do now: ${ways}
Look at the result as this person. If it is good enough for you, say so ("zufrieden": true, "weg": "fertig", "text": ""). Otherwise write ONE natural correction in your own voice and typing style, as you would really type it (e.g. "nee eher lustiger", "der titel soll omas name haben", "langsamer bitte"), and choose the way: "wunsch" (type it into the wish field on the card), "neu" (throw it away and type a new sentence: then "text" is the whole new sentence), or "selbst" (change it by hand in the editor: then "text" says what you change).`;
}
export const CORR_JUDGE_SYSTEM = `You check whether a person's correction to a generated card landed. You get the card before, the correction (and the way it was made: a wish to the AI on the card, a new sentence, or a change by hand), and the card after.
Score "landed" 0-4: 4 the change is exactly what was asked and nothing got worse; 3 mostly; 2 partly, or it landed but broke something else; 1 barely; 0 not at all, or no result. For a change by hand ("selbst"), judge whether the editor can plausibly do it by hand: texts, title, stickers, style and colours can be edited directly; questions of a quiz, the game world, the catalog card's function or a new category cannot. Return "reason" in German, at most 20 words.`;
export const CORR_JUDGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['landed', 'reason'], properties: { landed: { type: 'integer', enum: [0, 1, 2, 3, 4] }, reason: { type: 'string' } } };
