// Karte "baukasten" (Strang B): spielt jede gepruefte Echtzeit-Spielbeschreibung "mdi-bau/1" ueber den Echtzeit-Vertrag
// (ADR 0001 b). Die Beschreibung ist der einzige Parameter (params.desc, Kurzform erlaubt); sie steht nach init im Zustand
// (D), weil step/view/bot nur den Zustand bekommen. Bot = Heuristik der Beschreibung (bot.js), Geist = Eingabespur des Hosts.
// Freie Karte (Strang K): Server-Doc {k:"bau", t, b: Beschreibung} -> fromFree; toFree fuer Robot/Verfeinern.
import manifest from "./manifest.json" with { type: "json" };
import { descOf, paramsFromDoc, docFromParams } from "../../engines/baukasten/karte.js";
import * as E from "../../engines/baukasten/engine.js";
import { botInput, planOf } from "../../engines/baukasten/bot.js";

export default {
  manifest,
  init({ params, seed, players }) {
    const d = descOf(params);
    return { ...E.init(d, seed, Array.isArray(players) ? players : ["human", "none"]), D: d };
  },
  step(state, inputs) {
    const d = state.D, plan = planOf(d);
    return E.step(d, state, inputs, (s, seat) => botInput(d, s, seat, 2, plan));
  },
  status(state) {
    const s = E.status(state.D, state), two = state.D.players === 2 || (state.act[0] && state.act[1]);
    return { over: s.over, score: two ? s.score : [s.score[0]], winner: s.winner, say: two ? s.score[0] + " : " + s.score[1] : String(s.score[0]) };
  },
  bot(state, seat, { level }) { return botInput(state.D, state, seat, level, planOf(state.D)); },
  view(state, ctx) { return E.view(state.D, state, ctx); },
  fromFree(doc) { return paramsFromDoc(doc, "realtime"); },
  toFree(params) { return docFromParams(params); }
};
