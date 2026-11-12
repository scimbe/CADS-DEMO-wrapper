// Zugkarte zug-kreis: Regeln in game.js (Altcode wörtlich, Herkunft dort), Ablauf und Standardansicht im Zug-Kern (Strang Z1),
// Spezial-Widgets aus src/engines/zug-z2/views.js. fromFree/toFree: Uebergabe an die freie Karte (Strang K).
import manifest from "./manifest.json" with { type: "json" };
import { GAMES } from "./game.js";
import D from "../../engines/zug/turn.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { VIEWS, previewOf } from "../../engines/zug-z2/views.js";
import { freeHooks } from "../../engines/zug-z2/free.js";

const card = makeZug({ manifest, games: GAMES, text: D.text, view: VIEWS, preview: previewOf(manifest), variantKey: "spiel" });
Object.assign(card, freeHooks(manifest, { variants: { "raum-tuer": "tuer" } }));
export default card;
