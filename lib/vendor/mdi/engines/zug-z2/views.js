// Ansichten fuer Prompt-Arten der Z2-Karten, die nicht im Zug-Kern liegen (src/engines/zug/widgets.js). Jede Funktion
// uebersetzt einen Alt-Prompt in ein Widget von Strang F (ADR 0001, Inventar) und gibt ihm nur Daten mit: die Uhr,
// das Mikrofon und das Zeichnen haelt das Widget, die Karte bekommt am Ende den Wert (Wertform wie okAnswer).
// Kartenspezifische Widgets (probe, blocks, tuer) liefert die Karte selbst als game.view; hier nur, was allein aus dem
// Prompt folgt, und base() als gemeinsame Huelle.
import { askText } from "../zug/widgets.js";

/** Vorlage der Eingabe: der Host setzt den Wert ein (Format laut Absprache Z1/F). */
export function submitOf(c) { return { t: "ans", seat: c.seat }; }
export function base(p, c, extra) {
  const node = { t: p.w, id: "w" + c.step, label: askText(p, c), submit: submitOf(c), ...extra };
  if (p.peek) node.peek = p.peek(c.doc, c.m, c.now, c.lang);
  if (p.top) node.top = p.top(c.doc, c.m, c.lang);
  if (p.auto) node.auto = true;
  return node;
}
export const ints = (n) => Array.from({ length: n }, (x, i) => i);

export const VIEWS = {
  grid: (p, c) => base(p, c, { rows: 5, cols: 5, n: p.n }),
  hunt: (p, c) => base(p, c, { words: p.list(c.doc, c.m, c.lang), max: p.max }),
  clock: (p, c) => base(p, c, { secs: p.secs, text: p.text ? p.text(c.doc, c.m, c.lang) : "" }),
  explain: (p, c) => base(p, c, { secs: p.secs, max: p.max, words: p.list(c.doc, c.lang).slice(0, p.max) }),
  drop: (p, c) => base(p, c, { max: p.max, item: p.item(c.doc, c.lang), worth: p.worth(c.doc), msPerStep: 80 }),
  inner: (p, c) => base(p, c, { targets: p.targets(c.doc) }),
  blind: (p, c) => base(p, c, { tries: p.tries, goal: p.goal }),
  react: (p, c) => base(p, c, { plan: p.plan(c.doc) }),
  freeze: (p, c) => {
    const beat = c.now[0] ? c.now[0][0] : 0;
    return base(p, c, { beat: p.beat(beat), pauses: ints(p.max).map((r) => p.pause(c.doc, r)), statues: ints(p.max).map((r) => p.statue(c.doc, r, c.lang)), max: p.max });
  },
  touch: (p, c) => base(p, c, { max: 5 }),
  rec: (p, c) => base(p, c, { ms: p.ms, slot: p.slot }),
  once: (p, c) => base(p, c, { slot: p.slot, fx: p.fx(c.m), who: p.who(c.m) }),
  parrot: (p, c) => base(p, c, { from: p.from, slot: p.slot }),
  whose: (p, c) => base(p, c, { slot: p.slot(c.doc), fx: p.fx(c.doc), options: p.from(c.doc, c.m) })
};

/**
 * Vorschau einer Z2-Karte (Kartenansicht und Anpassen): Karte in der gewaehlten Farbe mit Titel, Variante und Regelsatz.
 * Jeder Teil traegt sein data-part, damit der Host die Blasen (Spiel, Titel, Farbe) daran heftet.
 */
export function previewOf(manifest) {
  return (card, pub, lang) => {
    const p = pub.p || {}, L = (o) => (o ? o[lang] || o.de : "");
    const ink = p.accent === "ink" ? "paper" : "ink", kids = [];
    kids.push({ t: "text", role: "title", text: p.title || L(manifest.title), fill: ink, x: 8, y: 10, w: 84, part: "titel" });
    const sp = manifest.params.properties.spiel;
    if (sp && p.spiel) kids.push({ t: "text", role: "label", text: L(sp["x-names"] && sp["x-names"][p.spiel]) || p.spiel, fill: ink, x: 8, y: 40, w: 84, part: "spiel" });
    if (p.w) kids.push({ t: "text", role: "small", text: p.w, fill: ink, x: 8, y: 50, w: 84, part: "titel" });
    kids.push({ t: "text", role: "body", text: L(manifest.rule || manifest.howto), fill: ink, x: 8, y: 60, w: 84 });
    return { t: "frame", fill: p.accent || "yellow", ratio: "3:4", part: "farbe", a11y: (p.title || L(manifest.title)) + ". " + L(manifest.rule || manifest.howto), children: kids };
  };
}
