// Wunschzettel mit Geheimnis (turns.js:996-1010, wish turn2.js:63-160): Die Wuenschende sieht nie eine Marke und nie,
// wer schenkt; schliessen kann nur sie (close). Vereinigung wie beim Einkauf (snap, merge).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";
import { wish } from "../../engines/zug/views.js";

export default makeZug({ manifest, games: { wunsch: GAMES.wunsch }, text: TEXT, view: { wish } });
