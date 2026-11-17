// Karte "baukasten" (Strang B): spielt jede gepruefte Echtzeit-Spielbeschreibung "mdi-bau/1" ueber den Echtzeit-Vertrag
// (ADR 0001 b). Die Beschreibung ist der einzige Parameter (params.desc, Kurzform erlaubt); sie steht nach init im Zustand
// (D), weil step/view/bot nur den Zustand bekommen. Bot = Heuristik der Beschreibung (bot.js), Geist = Eingabespur des Hosts.
// Freie Karte (Strang K): Server-Doc {k:"bau", t, b: Beschreibung} -> fromFree; toFree fuer Robot/Verfeinern.
import manifest from "./manifest.json" with { type: "json" };
import { descOf, paramsFromDoc, docFromParams, sealed } from "../../engines/baukasten/karte.js";
import { BADGE } from "../../engines/frei/seal.js";
import * as E from "../../engines/baukasten/engine.js";
import { botInput, planOf } from "../../engines/baukasten/bot.js";

export default {
  manifest,
  init({ params, seed, players }) {
    const d = descOf(params);
    // ki: die Partie stammt aus einer gesiegelten freien Karte (Abzeichen "Mit KI erstellt"); reist nur als Parameter
    return { ...E.init(d, seed, Array.isArray(players) ? players : ["human", "none"]), D: d, ki: sealed(params) ? 1 : 0 };
  },
  step(state, inputs) {
    const d = state.D, plan = planOf(d);
    return E.step(d, state, inputs, (s, seat) => botInput(d, s, seat, 2, plan));
  },
  status(state) {
    const s = E.status(state.D, state), two = state.D.players === 2 || (state.act[0] && state.act[1]);
    // Stand immer je Sitz (players.max = 2; Geist-Pruefung M4 verlangt sc.length === n); ein Solo-Spiel zeigt nur say
    return { over: s.over, score: s.score.slice(0, 2), winner: s.winner, say: two ? s.score[0] + " : " + s.score[1] : String(s.score[0]) };
  },
  bot(state, seat, { level }) { return botInput(state.D, state, seat, level, planOf(state.D)); },
  view(state, ctx) {
    const v = E.view(state.D, state, ctx);
    if (state.ki) v.layers[v.layers.length - 1].ops.push({ o: "text", x: 500, y: 1580, text: BADGE[ctx && ctx.lang === "en" ? "en" : "de"], size: 26, font: "body", align: "center", fill: ["ink", "blue", "violet"].includes(state.D.bg) ? "paper" : "ink", alpha: 0.8 });
    return v;
  },
  fromFree(doc) { return paramsFromDoc(doc, "realtime", manifest.params.properties); },
  toFree(params) { return docFromParams(params); }
};
