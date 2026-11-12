// Das sag ich dir voraus (turns.js:120-131) mit der Variante Post an mich in 30 Tagen (turns.js:618-627). Das Tor
// oeffnet am Tag aus input.d + Tage (alt d.o = today + Tage); die Uhr liest nur die Ansicht (ctx.today).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";

export default makeZug({ manifest, games: { kapsel: GAMES.kapsel, post: GAMES.post }, text: TEXT, variantKey: "spiel" });
