// Gutscheine ohne Geld (turns.js:238-242) mit der Variante Rubbellos (turns.js:243-249).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";

export default makeZug({ manifest, games: { gutschein: GAMES.gutschein, rubbellos: GAMES.rubbellos }, text: TEXT, variantKey: "spiel" });
