// Alle unterschreiben (turns.js:534-545, 4 Personen, Sitz = Zug) mit der Variante Kerzen auspusten (turns.js:596-599).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";

export default makeZug({ manifest, games: { reihum: GAMES.reihum, kerzen: GAMES.kerzen }, text: TEXT, variantKey: "spiel" });
