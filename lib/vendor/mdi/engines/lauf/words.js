// Wunsch ohne KI: feste Wortregeln auf dem Geraet (alt:src/lauf-ui.js fromWords), unveraendert.
// Welt, Modus, Level, gewuenschte Dinge, Figur; Figur und Dinge bleiben, wenn der Satz keine anderen nennt; der Seed bleibt.
import { build } from "./params.js";
import { animWords, sanitizeAnim } from "../flug/params.js";

const WORDS = [["w", "bruecke", /br(ü|ue|u)ck|bridge/], ["w", "stadt", /stadt|city|d(ä|a)ch|roof|stra(ß|ss)e/], ["w", "wald", /wald|forest|dschungel|jungle|baum|b(ä|a)ume/],
  ["w", "wueste", /w(ü|ue)ste|desert|sand/], ["w", "eis", /eis\b|schnee|winter|ice|snow/], ["w", "nacht", /nacht|night|sterne|weltall|space/], ["w", "lava", /lava|vulkan|volcano/],
  ["w", "candy", /candy|s(ü|ue)(ß|ss)|bonbon|zucker|sweet/], ["m", "ziel", /ziel|level|goal|finish|plattform|platform|jump.?n.?run/],
  ["level", "easy", /leicht|easy|kind|ruhig|gem(ü|ue)tlich/], ["level", "hard", /schwer|hard|schnell|fast|krass/],
  ["h", "gegner", /gegner|monster|feind|enem|k(ä|a)fer|tier/], ["h", "ducken", /duck/], ["h", "von_oben", /von oben|f(ä|a)llt|fallen|regen|meteor|from above|falling|ausweich/],
  ["h", "luecken", /l(ü|ue)cke|gap|abgrund|br(ü|ue)ck|bridge/]];
const FIGW = { "🐸": /frosch|frog/, "🦊": /fuchs|fox/, "🐱": /katze|cat/, "🐶": /hund|dog/, "🦖": /dino/, "🐧": /pinguin|penguin/, "🐰": /hase|bunny|rabbit/, "🤖": /robot/, "🦄": /einhorn|unicorn/, "🐢": /schildkr|turtle/, "🐼": /panda/, "🐵": /affe|monkey/ };
export function fromWords(text, base) {
  const s = String(text).toLowerCase(), o = { mode: "endlos", level: "normal", has: ["hindernisse", "muenzen"], foes: ["geh"], figure: base.e, obstacle: base.o, coin: base.c, foe: base.f };
  for (const w of WORDS) if (w[2].test(s)) { if (w[0] === "h") { if (o.has.indexOf(w[1]) < 0) o.has.push(w[1]); } else if (w[0] === "w") o.world = o.world || w[1]; else o[w[0] === "m" ? "mode" : w[0]] = w[1]; }
  for (const e in FIGW) if (FIGW[e].test(s)) { o.figure = e; break; }
  if (o.has.indexOf("gegner") >= 0) o.foes = ["geh", "huepf"];
  if (o.has.indexOf("von_oben") >= 0 && /nur|only/.test(s)) o.has = ["von_oben", "muenzen"];
  const l = build(o, base.seed), an = animWords(text);
  if (an ? an.art !== "keine" : base.anim) l.anim = sanitizeAnim(an || base.anim);
  return l;
}
