// Worauf einigen wir uns? (turns.js:54-69) mit der Variante Wer ordnet gleich? (turns.js:514-525).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";

export default makeZug({ manifest, games: { einig: GAMES.einig, rangliste: GAMES.rangliste }, text: TEXT, variantKey: "spiel" });
