// Einkaufszettel (turns.js:896-994, shop turn-ui.js:450-505): eine Liste im Link, jede Antwort wird beim Empfang per
// Vereinigung mit dem eigenen Stand zusammengelegt (merge.js, card.merge/compact, manifest.link.snap).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";
import { shop } from "../../engines/zug/views.js";

export default makeZug({ manifest, games: { einkauf: GAMES.einkauf }, text: TEXT, view: { shop } });
