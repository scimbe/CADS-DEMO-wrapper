// Terminumfrage (turns.js:546-590, slots/vote turn-ui.js:510-574): bis zu 10 Personen im selben Link, Sitz = Zug.
// "Satz zu Formular" (satz.js/satz-ui.js): KI-Art plan oder Regelleser ohne KI -> Termine; Feiertage bleiben aussen vor.
// Der fuehrende Termin als .ics (satz.js ics), sobald jemand abgestimmt hat (turn-ui.js:690) und im Ergebnis (:675).
import manifest from "./manifest.json" with { type: "json" };
import { makeZug } from "../../engines/zug/zug.js";
import { GAMES, TEXT, leading } from "../../engines/zug/spiele.js";
import { slots, vote, icsNode } from "../../engines/zug/views.js";

const DAY = 86400000;
// DTSTAMP aus dem Tag des Geraets (ctx.today): die Ansicht bleibt eine reine Funktion ihrer Eingaben
const stamp = (today) => (Number.isInteger(today) ? today : 0) * DAY;
const termin = { ...GAMES.termin, after: (card, pub, lang, ctx) => [icsNode(leading(pub.m), pub.p.titel, lang, stamp(ctx.today))] };
export default makeZug({
  manifest, games: { termin }, text: TEXT, seating: "chain",
  view: { slots, vote: (p, c) => ({ t: "stack", children: [vote(p, c), icsNode(leading(c.m), c.pub.p.titel, c.lang, stamp(c.today))] }) }
});
