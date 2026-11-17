// Mach auf, wenn … (turns.js:281-285) mit den Varianten Erst morgen aufmachen (turns.js:270-275, Tor ueber input.d)
// und Happy Halloween (Poster aus ideas.json).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT, PTEXT, posterGame } from "../../engines/zug/spiele.js";

export default makeZug({ manifest, games: { umschlag: GAMES.umschlag, morgen: GAMES.morgen, halloween: posterGame("halloween") }, text: { de: { ...TEXT.de, ...PTEXT.de }, en: { ...TEXT.en, ...PTEXT.en } }, variantKey: "spiel" });
