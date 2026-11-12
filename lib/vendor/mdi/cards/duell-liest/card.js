// Agenten-Duelle (Altkarten duell-liest, duell-ssp, duell-bluff, duell-unlesbar, rap-hoeflich, rap-montag,
// auktion-quatsch, anruf-quiz, anruf-stimme): Logik und Ablauf in src/engines/duell (Port von duel.js/modes.js).
import manifest from "./manifest.json" with { type: "json" };
import { makeDuell } from "../../engines/duell/karte.js";

export default makeDuell({ manifest });
