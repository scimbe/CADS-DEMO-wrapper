// Altkern der Zug-Engine, bitgleich zum Altcode (Tag pre-legacy-removal, Altbaum src/):
//   hash32/mulberry32 = core.js:309-324, mix = turns.js:19-24, clean/fold = quest.js:11-17,
//   Wortfilter = core.js:45-90 + kontakt.js:1-45, Texte "de|en" = core.js:433-440.
// Alles ist eine reine Funktion der Eingabe. mulberry32 rechnet mit Math.imul und einer Division durch 2^32; beides
// ist in IEEE-754 exakt gerundet (ECMA-262 6.1.6.1), also auf jeder Engine bitgleich (08-forschung/determinismus.md).
// Daraus entstehen nur Ganzzahlen (Reihenfolgen); im Zustand stehen nie Gleitkommazahlen.

export function hash32(str) {
  let h = 0x811c9dc5;
  str = String(str);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Dieselbe Reihenfolge auf beiden Handys, aus dem Seed im Link (turns.js:19). */
export function mix(seed, tag, n) {
  const r = mulberry32(hash32("turn|" + seed + "|" + tag)), a = [];
  for (let i = 0; i < n; i++) a.push(i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// ---------- Wortfilter (de/en), core.js:45-90 ----------
const STEMS = [
  "fuck", "shit", "bitch", "asshole", "nigger", "nigga", "faggot", "whore", "slut", "rapist", "hitler", "nazi",
  "scheiss", "arschloch", "fotze", "hurensohn", "wichser", "ficken", "schlampe", "missgeburt", "vergewaltig", "kanake", "behindert", "neger", "mongo", "judensau", "kinderfick", "pornhub"
];
const WORDS = ["cunt", "pedo", "dick", "cock", "porn", "rape", "fag", "fick", "nutte", "hure", "spast", "kkk", "isis", "nsdap"];
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "+": "t" };
export function foldText(s) {
  s = String(s == null ? "" : s).toLowerCase();
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s.replace(/ß/g, "ss");
}
const HURT = /\b(du|ihr)\s+(bist|seid)\s+((so|voll|echt|total|richtig|einfach)\s+)*(h(ä|ae)sslich|fett|dumm|bl(ö|oe)d|peinlich|eklig|wertlos|nichts|ein\s+opfer|ein\s+loser)|(niemand|keiner)\s+mag\s+(dich|euch)|lachen\s+(alle\s+)?(ü|ue)ber\s+(dich|euch)|hasse\s+dich|geh\s+sterben|bring\s+dich\s+um|solltest\s+(sterben|verschwinden)|\byou\s+are\s+((so|really|just)\s+)*(ugly|fat|stupid|worthless|nothing|a\s+loser)|\byou'?re\s+((so|really|just)\s+)*(ugly|fat|stupid|worthless|nothing|a\s+loser)|nobody\s+likes\s+you|laugh(s|ing)?\s+at\s+you\b|i\s+hate\s+you|kill\s+yourself/;
function words(input) {
  if (HURT.test(String(input == null ? "" : input).toLowerCase().replace(/\s+/g, " "))) return false;
  const base = foldText(input);
  const leet = base.replace(/[0134578@$!+]/g, (c) => LEET[c] || c);
  for (const v of [base, leet]) {
    const joined = v.replace(/[^a-z]/g, "");
    const squeezed = joined.replace(/(.)\1+/g, "$1");
    for (const stem of STEMS) if (joined.indexOf(stem) >= 0 || squeezed.indexOf(stem.replace(/(.)\1+/g, "$1")) >= 0) return false;
    for (const t of v.split(/[^a-z]+/)) if (t && WORDS.indexOf(t) >= 0) return false;
  }
  return true;
}

// ---------- zweite Haelfte des Filters: Kontaktdaten, Beleidigung als Befehl (kontakt.js:12-41) ----------
const MEAN = /\b(verpiss|verzieh)\s+dich\b|\bhalt\s+((doch|mal)\s+)?(die|deine?)\s+(fresse|klappe|schnauze|maul)|\b(fresse|schnauze|maul)\s+halten|\bhalt'?s\s+maul|\bleck\s+mich\b|\b(stirb|verreck)\b|\bhae?ng\s+dich\s+auf|\bdu\s+((kleine|dumme)[rs]?\s+)?(opfer|lappen|penner|spacko|spasti|idiot|vollidiot|depp|trottel|loser|versager|assi|freak)\b|\b(piss\s+off|go\s+die|go\s+to\s+hell|drop\s+dead|screw\s+you|kys)\b|\byou\s+((stupid|little)\s+)?(idiot|loser|moron|retard|dumbass|freak)\b|(^|[.!?,;:]\s*)(?!(das|es|dies|alles|that|it|this)\s)[\p{L}'-]+(\s+aus\s+der\s+\S+)?\s+(ist|is)\s+((so|voll|echt|total|richtig|really)\s+)*(hae?sslich|fett|eklig|wertlos|dumm|bloe?d|ein\s+(opfer|loser|versager|idiot|spast)|eine\s+(kuh|sau|schlampe)|ugly|fat|stupid|worthless|disgusting|a\s+(loser|freak))\b/u;
const CONTACT_K = [
  /[^\s@]+@[^\s@]+\.\p{L}{2,}/u,
  /\S\s*[([]\s*(at|ät)\s*[)\]]\s*\S|\S\s+(at|ät)\s+\S+\s+(dot|punkt)\s+\p{L}{2}/iu,
  /(^|[^\p{L}\d._@-])@[\p{L}_][\p{L}\d_.]/u,
  /\bhttps?:|\bwww\.|:\/\/|\b(t|wa)\.me\/|\bbit\.ly\b|\b[a-z\d][a-z\d-]*\.(de|com|net|org|io|gg|tv|info|eu|app|shop|ch|at|ru)(?![\p{L}\d-])/iu,
  /\b(insta(gram)?|snapchat|whats\s*app|telegram|discord|tiktok|threema|(auf|bei|per|on|via)\s+(snap|signal))\b/i,
  /\b((handy|telefon|tel)\s*-?\s*(nr|nummer)|handynummer|telefonnummer|meine\s+nummer|my\s+(phone\s+)?number|phone\s+number|schreib\s+mir\s+(auf|bei|per|unter|an)|add\s+me\s+on|dm\s+me|adde?\s+mich|folg(e|t)?\s+mir\s+(auf|bei)|follow\s+me\s+on)\b/i
];
// A phone number: 6 digits or more, also with spaces, dots, slashes, dashes or brackets. What only looks like one stays:
// a date, years ("2025-2026"), a big number in groups ("1.000.000"), short groups ("1 2 3 4 5 6"), a count with its unit
// ("250000 Punkte"); a time or a score ("17:30", "12:7") never joins up (":" is no separator).
const RUN = /\+?\(?\d(?:[\d()]|[ .\/–-]{1,3}(?=\(?\d))*/g;
const UNIT = /^\s*(punkte?|pkt|points?|euro|€|\$|km|m|kg|leute|people|jahre|years?|tage|days?|mal|schritte|steps|likes|%)(?!\p{L})/iu;
function phone(run, after) {
  var g = run.split(/\D+/).filter(Boolean), b = run.replace(/[()]/g, "");
  if (g.join("").length < 6) return false;
  if (run[0] === "+") return true;
  if (/^\d\d?[.\/-]\d\d?[.\/-](\d\d|\d{4})$|^\d{4}-\d\d?(-\d\d?)?$/.test(b) || g.every(function (x) { return /^(1[5-9]|20)\d\d$/.test(x); })) return false;
  if (/^\(?0/.test(run)) return true;
  return !(/^[1-9]\d{0,2}([. ]\d{3})+$/.test(b) || (g.length > 1 && g.every(function (x) { return x.length < 3; })) || UNIT.test(after));
}
function hasContact(input) {
  let s = String(input == null ? "" : input).replace(/\s+/g, " ");
  let m; const re = new RegExp(RUN.source, "g");
  if (CONTACT_K.some(function (r) { return r.test(s); })) return true;
  // a colour "#306230" or part of a word "x1234567" is no number to call
  while ((m = re.exec(s))) if (!/[#\p{L}\d_]/u.test(s.charAt(m.index - 1)) && phone(m[0].replace(/[ .\/–()-]+$/, ""), s.slice(m.index + m[0].length))) return true;
  return false;
}
function kontakt(input) { return hasContact(input) ? "contact" : MEAN.test(foldText(input).replace(/\s+/g, " ")) ? "word" : ""; }
/** Grund, warum ein Text draussen bleibt ("contact" | "word") oder "" (core.js:64-68 mit kontakt.js als CHECKS[0]). */
export function whyNot(input) { return kontakt(input) || (words(input) ? "" : "word"); }
export function isClean(input) { return !whyNot(input); }

// ---------- Freitext saeubern (quest.js:9-17) ----------
const CONTACT_Q = /https?:|www\.|\.(de|com|org|net)\b|@|\d[\d\s/-]{4,}\d|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*uhr\b|stra(ß|ss)e|\bstr\.|(markt|sport|spiel|park|schul)platz|treffpunkt|treffen\b|\btreff\b|adresse|standort|bahnhof|haltestelle|komm (zu|allein|\w* ?vorbei)|allein|hausnummer|handynummer|telefon|snap|insta|tiktok|whatsapp|discord|\bstreet\b|\bmeet\b|address|location|\bcome (to|alone|over)|\balone\b|phone number/i;
export function clean(s, max) {
  const t = Array.from(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
  return t && isClean(t) && !CONTACT_Q.test(t) ? t : "";
}
export function fold(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/ß/g, "ss").replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
}

// ---------- Texte (core.js:433-446) ----------
export function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, (m, k) => String(o[k])); }
/** Spalte einer Sprache in "de|en"-Paaren; Deutsch, wo es keine gibt. */
export function column(lang) { return lang === "en" ? 1 : 0; }
export function pk(s, lang) { const p = String(s).split("|"), i = column(lang); return p[i] != null && p[i] !== "" ? p[i] : p[0]; }
export function alt(a, lang) { const x = a[column(lang)]; return x != null ? x : a[0]; }
export function pair(list, i, lang) { return pk(list[i], lang); }
/** "a|b||c|d" -> Liste der Sprache (turns.js:133). */
export function side(s, lang) { return alt(s.split("||"), lang).split("|"); }
/** Textblock einer Sprache; was fehlt, kommt aus dem deutschen Block (core.js:433, ohne den Prototyp zu veraendern). */
export function textsFor(tab, lang) { const de = tab.de || {}, b = tab[lang]; return b && b !== de ? { ...de, ...b } : de; }
// Ohne Intl (Harness, determinismus.md Befund 3): die Ausgaben sind gegen Intl de-DE/en-GB als Orakel geprueft
// (test/z1-format.test.js). Nur de und en kommen vor; andere Sprachen lesen Deutsch.
export function locale(l) { return l === "en" ? "en-GB" : "de-DE"; }
function group(n, sep) { const s = String(n); let out = ""; for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) out += sep; out += s[i]; } return out; }
/** Cent als Geld: "7 €" / "9,37 €" / "1.000 €", "€7" / "€9.37" / "€1,000" (core.js:451). Reine Anzeige, nie im Zustand. */
export function money(c, l) {
  const neg = c < 0, a = Math.abs(Math.trunc(c)), e = Math.floor(a / 100), r = a % 100, en = l === "en";
  const body = group(e, en ? "," : ".") + (r ? (en ? "." : ",") + String(r).padStart(2, "0") : "");
  return (neg ? "-" : "") + (en ? "€" + body : body + " €");
}
/** Pluralform fuer de/en: "one" nur fuer 1, sonst "other" (wie Intl.PluralRules fuer de und en bei Ganzzahlen). */
export function plural(l, n) { return n === 1 ? "one" : "other"; }
/** "k" mit n = 1 liest "k_one", wo der Block es hat (core.js:443). */
export function form(block, k, n, l) { const s = typeof n === "number" ? block[k + "_" + plural(l, n)] : null; return s != null ? s : block[k]; }
export function intIn(v, a, b) { return Number.isInteger(v) && v >= a && v <= b; }
export function distinct(a) { return new Set(a).size === a.length; }
/** Zahl mit d Nachkommastellen in der Schreibweise der Sprache ("1,23" / "1.23"), ohne Tausendertrennung; d null: bis 3
 *  Stellen ohne Endnullen (core.js:446). Wie Intl in V8 gerundet: auf der kuerzesten Dezimaldarstellung des Doubles
 *  (Number::toString, ECMA-262 6.1.6.1.20, exakt spezifiziert), halbe Stelle von der Null weg; kein toFixed (Harness).
 *  Gegen toLocaleString als Orakel geprueft (test/z1-format.test.js). Nur Anzeige. */
function plainDigits(a) {
  const s = String(a), m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(s);
  if (!m) return { ip: "0", fp: "" };
  let ip = m[1], fp = m[2] || "";
  const e = m[3] ? Number(m[3]) : 0;
  if (e > 0) { fp = fp.padEnd(e, "0"); ip = (ip + fp.slice(0, e)).replace(/^0+(?=\d)/, ""); fp = fp.slice(e); }
  else if (e < 0) { fp = "0".repeat(-e - 1) + ip + fp; ip = "0"; }
  return { ip, fp };
}
function incDigits(s) { const a = s.split(""); let i = a.length - 1; while (i >= 0) { if (a[i] === "9") { a[i] = "0"; i--; } else { a[i] = String(Number(a[i]) + 1); return a.join(""); } } return "1" + a.join(""); }
export function num(x, d, l) {
  x = Number(x);
  const max = d == null ? 3 : d, min = d == null ? 0 : d, neg = x < 0 || Object.is(x, -0);
  let { ip, fp } = plainDigits(Math.abs(x));
  if (fp.length > max) {
    const up = fp.charCodeAt(max) >= 53; // "5".."9"
    fp = fp.slice(0, max);
    if (up) { const r = incDigits(ip + fp); ip = r.slice(0, r.length - max) || "0"; fp = max ? r.slice(r.length - max) : ""; }
  }
  if (d == null) fp = fp.replace(/0+$/, "");
  while (fp.length < min) fp += "0";
  // Vorzeichen wie Intl (signDisplay auto): auch "-0", wenn eine negative Zahl auf null rundet
  return (neg ? "-" : "") + ip + (fp ? (l === "en" ? "." : ",") + fp : "");
}
// ---------- Kalender ohne Date (Harness): Tage seit 1970-01-01 <-> (Jahr, Monat, Tag), H. Hinnant, chrono-compatible ----------
export function civil(z) {
  z += 719468;
  const era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}
export function daysOf(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
/** Wochentag 0 = Sonntag (wie Date#getUTCDay). */
export function weekday(z) { return ((z % 7) + 11) % 7; }
