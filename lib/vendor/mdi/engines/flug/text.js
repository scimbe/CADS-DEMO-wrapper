// Text-Regeln des Flugspiels (alt:src/core.js "word filter" und "text sanitizing"), unveraendert portiert.
// Ein Titel, Name oder Satz, der den Wortfilter nicht besteht, faellt weg; der Aufrufer zeigt das ehrlich an.

export const MAX_NAME = 16, MAX_TITLE = 28, MAX_PROMPT = 80;
export const DEFAULT_EMOJI = "🪁";

const STEMS = [
  "fuck", "shit", "bitch", "asshole", "nigger", "nigga", "faggot", "whore", "slut", "rapist", "hitler", "nazi",
  "scheiss", "arschloch", "fotze", "hurensohn", "wichser", "ficken", "schlampe", "missgeburt", "vergewaltig", "kanake", "behindert", "neger", "mongo", "judensau", "kinderfick", "pornhub"
];
const WORDS = ["cunt", "pedo", "dick", "cock", "porn", "rape", "fag", "fick", "nutte", "hure", "spast", "kkk", "isis", "nsdap"];
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "+": "t" };

export function foldText(s) {
  s = String(s == null ? "" : s).toLowerCase();
  try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch { /* alte Engine */ }
  return s.replace(/ß/g, "ss");
}
// Saetze, die Wort fuer Wort sauber sind und trotzdem verletzen (Altcode HURT)
const HURT = /\b(du|ihr)\s+(bist|seid)\s+((so|voll|echt|total|richtig|einfach)\s+)*(h(ä|ae)sslich|fett|dumm|bl(ö|oe)d|peinlich|eklig|wertlos|nichts|ein\s+opfer|ein\s+loser)|(niemand|keiner)\s+mag\s+(dich|euch)|lachen\s+(alle\s+)?(ü|ue)ber\s+(dich|euch)|hasse\s+dich|geh\s+sterben|bring\s+dich\s+um|solltest\s+(sterben|verschwinden)|\byou\s+are\s+((so|really|just)\s+)*(ugly|fat|stupid|worthless|nothing|a\s+loser)|\byou'?re\s+((so|really|just)\s+)*(ugly|fat|stupid|worthless|nothing|a\s+loser)|nobody\s+likes\s+you|laugh(s|ing)?\s+at\s+you\b|i\s+hate\s+you|kill\s+yourself/;

function words(input) {
  if (HURT.test(String(input == null ? "" : input).toLowerCase().replace(/\s+/g, " "))) return false;
  const base = foldText(input);
  const leet = base.replace(/[0134578@$!+]/g, (c) => LEET[c] || c);
  for (const v of [base, leet]) {
    const joined = v.replace(/[^a-z]/g, ""), squeezed = joined.replace(/(.)\1+/g, "$1");
    for (const stem of STEMS) if (joined.indexOf(stem) >= 0 || squeezed.indexOf(stem.replace(/(.)\1+/g, "$1")) >= 0) return false;
    for (const t of v.split(/[^a-z]+/)) if (t && WORDS.indexOf(t) >= 0) return false;
  }
  return true;
}
export function isClean(input) { return words(input); }

function cpSlice(s, max) { return Array.from(s).slice(0, max).join(""); }
export function stripText(s) {
  s = String(s == null ? "" : s);
  s = s.replace(/[^\p{L}\p{N}\p{Extended_Pictographic}‍️ _\-.!?'’:,&+#]/gu, "");
  return s.replace(/\s+/g, " ").trim();
}
export function sanitizeName(s) { const n = cpSlice(stripText(s), MAX_NAME).trim(); return n && isClean(n) ? n : ""; }
export function sanitizeTitle(s, fallback) { const t = cpSlice(stripText(s), MAX_TITLE).trim(); return t && isClean(t) ? t : (fallback || "Duell"); }
export const EMOJI_RE = /^\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*/u;
export function sanitizeEmoji(s) {
  if (typeof s !== "string") return DEFAULT_EMOJI;
  const m = s.trim().match(EMOJI_RE);
  return m && m[0].length <= 12 ? m[0] : DEFAULT_EMOJI;
}
export function emo(v) { const m = typeof v === "string" && v.trim().match(EMOJI_RE); return m && m[0].length <= 12 ? m[0] : ""; }
export function sanitizePrompt(s) {
  return cpSlice(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim(), MAX_PROMPT);
}
/** Eingabe des Nutzers (alt:src/daily.js cleanInput): Steuerzeichen raus, gekuerzt, Wortfilter. */
export function cleanInput(s, max) {
  const t = Array.from(String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max || 140).join("").trim();
  return t && isClean(t) ? t : "";
}
export function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m)); }
