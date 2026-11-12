// Beispielzug je Prompt-Art (Vorschlag Strang Z2, uebernommen): ein gueltiger Beispielzug je Prompt-Art, deterministisch (keine Uhr, kein Zufall).
// Nutzen: moves() liefert fuer jeden Schritt mindestens einen Zug -> Modus-Treiber (test/modes.test.js), Bot-Haken,
// Hinweise. Freie Eingaben bleiben ueber accepts() offen; das Beispiel ist nur EIN gueltiger Wert.
const WORDS = ["Apfel", "Kuchen", "Wolke", "Lampe", "Garten", "Banane", "Kerze", "Fisch", "Gabel", "Nudel", "Stern", "Eimer", "Fahne", "Glocke", "Tisch", "Hose", "Brille", "Daumen", "Dach", "Bus", "Mond", "Keks", "Tasse", "Ball"];
const ints = (n) => Array.from({ length: n }, (x, i) => i);
/** @returns ein Wert, den okAnswer(p, v, doc, "de", m, now) annimmt, oder undefined */
export function example(p, doc, m, now, ok) {
  const from = () => (typeof p.from === "function" ? p.from(doc, m, now, "de") : []);
  const tryAll = (list) => list.find((v) => ok(v));
  switch (p.w) {
    case "pick": return ints(p.n);
    case "rank": return ints(from().length);
    case "alloc": return from().map(() => 0);
    case "slide": return p.def !== undefined ? p.def : (p.min || 0);
    case "text": return tryAll(WORDS.map((w) => w.slice(0, p.max)));
    case "list": { const w = WORDS.map((x) => x.slice(0, p.max)); return tryAll(ints(WORDS.length - p.n).map((k) => w.slice(k, k + p.n))); }
    case "show": case "clock": case "touch": case "blow": case "doors": case "rec": case "once": case "parrot": case "pay": return 0;
    case "hunt": return 1;
    case "drop": case "freeze": case "explain": case "whose": case "react": case "nim": return 0;
    case "inner": return [0, 0, 0, 0, 0];
    case "blind": return 10000;
    case "door": return [0, 0, 0];
    case "grid": return ints(p.n);
    case "probe": { const old = p.before(doc, m); return [ints(25).find((c) => !old.includes(c))]; }
    case "blocks": return [];
    case "money": return 100 * (now[2] || 1);
    case "opts": return ints(p.n);
    case "slots": return ["Ana", [207716, 207726]];
    case "vote": { const used = m.map((t) => String(t[0][0]).toLowerCase()); const n = ["Ben", "Cem", "Dana", "Emil", "Fee", "Gül", "Hans", "Ida", "Jonas", "Kim"].find((x) => !used.includes(x.toLowerCase())); return [n, m[0][0][1].map(() => 0)]; }
    case "shop": case "wish": {
      // Treiber sollen enden: der erste Zug schreibt zwei Dinge, jeder weitere hakt alles als gekauft ab (Einkauf)
      const base = m.length ? m[0][0] : null;
      if (!base) return p.example ? p.example(null) : undefined;
      return p.example ? p.example(base) : base;
    }
    default: return undefined; // weitere Arten: Karte liefert game.example(p, doc, m, now)
  }
}
