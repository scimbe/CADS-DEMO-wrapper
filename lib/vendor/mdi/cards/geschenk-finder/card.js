// Geschenk in drei Fragen (turns.js:1011-1032, geschenke.js, opts/ideas turn2.js:18-62): fuenf Ideen aus fester
// Liste im Budget, ohne KI; KI-Ideen (Art liste) nur auf Wunsch. Ergebnis fuehrt weiter zu "Geld einsammeln".
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";
import { opts, ideas } from "../../engines/zug/views.js";

export default makeZug({ manifest, games: { geschenk: GAMES.geschenk }, text: TEXT, view: { opts, ideas } });
