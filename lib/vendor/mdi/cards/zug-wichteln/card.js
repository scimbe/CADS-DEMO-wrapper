// Wichteln (turns.js:493-512): Namen eintragen, jede Person tippt ihren Namen und sieht nur ihren Zettel. Das Ergebnis
// bleibt auf dem Geraet (stay -> status.local), der Link geht unveraendert an die naechste Person.
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";

export default makeZug({ manifest, games: { wichteln: GAMES.wichteln }, text: TEXT });
