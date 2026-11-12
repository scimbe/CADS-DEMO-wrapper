// Der erste Satz (turns.js:841-848, auf einem Geraet, Ergebnis zum Kopieren) mit der Variante Tut mir leid (warm-sorry).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT, PTEXT, posterGame } from "../../engines/zug/spiele.js";

export default makeZug({ manifest, games: { sorry: GAMES.sorry, "warm-sorry": posterGame("warm-sorry") }, text: { de: { ...TEXT.de, ...PTEXT.de }, en: { ...TEXT.en, ...PTEXT.en } }, variantKey: "spiel" });
