// Freie Karte (Strang K): eine Karte, die die KI aus einem Satz gebaut hat (Art card oder meme), mit KI-Siegel. Statisch wie
// "gruss"; Blasen, Teilen und Live leitet der Host ab. Das Siegel (seal/hash/owner/root) reist im Link, damit der Empfaenger
// das Status-Gate des Decks fragen kann (GET /api/duell/deck/status). Es ist kein Teil zum Bearbeiten.
// Die Farbpaare der alten App werden auf die Tokens der Designsprache abgebildet (src/contract/tokens.js kennt keine Hex-Werte).
import manifest from "./manifest.json" with { type: "json" };
import { onFill } from "../../contract/tokens.js";
import { PAIRS, PAIR_NAMES, fillOf, freiParams, freiDoc, sanitizeDoc } from "../../engines/frei/doc.js";

const SLOTS = [[13, 12], [87, 12], [13, 88], [87, 88], [8, 50], [92, 50]];
const BADGE = { de: "Mit KI erstellt", en: "Made with AI" };
const PHOTO = { de: "📷 Hier kommt dein Foto hin. Es bleibt auf deinem Gerät.", en: "📷 Your photo goes here. It stays on your device." };

export default {
  manifest,
  init({ params }) { return { pub: { ...params, stickers: params.stickers.slice(0, 6) }, priv: [null] }; },
  step() { throw new Error("statisch: keine Zuege"); },
  observe(state) { return { pub: state.pub, mine: null }; },
  status() { return { over: true, turn: -1, reveal: false, score: [], winner: -1 }; },
  moves() { return []; },
  view(obs, seat, opts = {}) {
    const p = obs.pub, lang = opts.lang === "en" ? "en" : "de";
    const fill = fillOf(PAIRS[Math.max(0, PAIR_NAMES.indexOf(p.palette))]), ink = onFill(fill);
    const meme = p.kind === "meme";
    const a11y = [p.title, meme ? p.top + " … " + p.bottom : p.text, p.seal ? BADGE[lang] : ""].filter(Boolean).join(". ");
    const kids = p.stickers.map((e, i) => ({ t: "text", role: "big", text: e, x: SLOTS[i][0] - 6, y: SLOTS[i][1] - 6, w: 12, part: "sticker" }));
    if (p.title) kids.push({ t: "text", role: "title", text: p.title, fill: ink, x: 8, y: meme ? 8 : 30, w: 84, part: "titel" });
    if (meme) {
      kids.push({ t: "text", role: "body", text: p.top, fill: ink, x: 8, y: 26, w: 84, part: "meme" });
      kids.push({ t: "text", role: "small", text: PHOTO[lang], fill: ink, x: 12, y: 44, w: 76, part: "meme" });
      kids.push({ t: "text", role: "body", text: p.bottom, fill: ink, x: 8, y: 70, w: 84, part: "meme" });
    } else kids.push({ t: "text", role: "body", text: p.text, fill: ink, x: 8, y: 58, w: 84, part: "text" });
    if (p.seal) kids.push({ t: "text", role: "label", text: BADGE[lang], fill: ink, x: 56, y: 92, w: 42 });
    return { t: "frame", fill, ratio: "3:4", part: "farbe", a11y, children: kids };
  },
  /** Adapter der freien Karte (src/features/frei/doc.js targetOf): Server-Doc -> Parameter und zurueck */
  fromFree(doc) { const d = sanitizeDoc(doc); return d && (d.k === "card" || d.k === "photo") ? freiParams(d) : null; },
  toFree(params) { return freiDoc(params); }
};
