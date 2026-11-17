// Sinus und Kosinus nur aus + - * / und Math.floor (IEEE-754 exakt gerundet): bitgleich in V8, JavaScriptCore und
// SpiderMonkey, anders als Math.sin (08-forschung/determinismus.md, Befund 2). Fehler < 2e-15 im Bereich |x| < 300.
// Gebraucht fuer die Optik (Wippen, Schweben, Animation) und den eingefrorenen Flugweg alter Lauf-Links (ev 0).
const PI = 3.141592653589793, TWO_PI = 6.283185307179586, HALF_PI = 1.5707963267948966;
// Cody-Waite: 2*pi = HI + LO, HI mit wenigen Mantissenbits, damit k*HI exakt ist -> r in [-pi, pi]
function reduce(x) { const k = Math.floor(x / TWO_PI + 0.5); return (x - k * 6.28125) - k * 0.0019353071795864769; }
function sinR(r) {
  if (r > HALF_PI) r = PI - r; else if (r < -HALF_PI) r = -PI - r;   // [-pi/2, pi/2]
  const r2 = r * r;
  let term = r, sum = r;
  for (let n = 1; n < 12; n++) { term = -term * r2 / ((2 * n) * (2 * n + 1)); sum = sum + term; }
  return sum;
}
function ok(x) { return x === x && x !== Infinity && x !== -Infinity; }
export function sinD(x) { return ok(x) ? sinR(reduce(x)) : NaN; }
export function cosD(x) { if (!ok(x)) return NaN; let r = reduce(x) + HALF_PI; if (r > PI) r -= TWO_PI; return sinR(r); }
