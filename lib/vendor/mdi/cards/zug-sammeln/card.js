// Geld einsammeln (Altregel turns.js:850-902, Widgets money/pay turn-ui.js:168-196). Geld ganzzahlig in Cent
// (src/engines/zug/geld.js); PayPal.me-Name und -Knopf nur mit bestaetigtem 18+ aus dem Profil (P1, ctx.age18).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT } from "../../engines/zug/spiele.js";
import { widget } from "../../engines/zug/widgets.js";
import { adultText, money, pay } from "../../engines/zug/views.js";

export default makeZug({
  manifest, games: { sammeln: GAMES.sammeln }, text: TEXT,
  view: { text: (p, c) => adultText(p, c, widget), money, pay }
});
