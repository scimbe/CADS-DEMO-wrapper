// Schick wem ein Danke (turns.js:591-595) mit den eingeklappten Varianten: Urkunde fuer nix (turns.js:250-253, auf
// einem Geraet), Urkunde fuer nix als Poster (karte-lob) und die zehn Wohlfuehlkarten warm-* (warm.js, ideas.json).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT, PTEXT, posterGame } from "../../engines/zug/spiele.js";

const games = { danke: GAMES.danke, urkunde: GAMES.urkunde };
for (const k of manifest.params.properties.spiel.enum) if (!games[k]) games[k] = posterGame(k);
export default makeZug({ manifest, games, text: { de: { ...TEXT.de, ...PTEXT.de }, en: { ...TEXT.en, ...PTEXT.en } }, variantKey: "spiel" });
