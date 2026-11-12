// Pruefer (Harness, Strang B): automatische Bot-Playtests einer Beschreibung. Nur bestandene Spiele gehen an Menschen.
// Kennzahlen nach 08-forschung/spiel-baukasten.md (S20 Isaksen, S21 RAPP, GAVEL) und generische-bots.md Befund 4:
//   endet       Anteil der Partien, die durch eine Regel/Zeit enden (nicht erst an der Notbremse LIMITS.maxTicks)
//   gewinnbar   der beste Bot gewinnt (Solo) bzw. ein Sieg ist moeglich (zu zweit)
//   trivial     Nichtstun gewinnt nicht; der gute Bot ist messbar besser als der Zufallsbot (Siegquote oder Punkte)
//   dauer       Median der Partiedauer des guten Bots im sinnvollen Bereich
//   fair        zu zweit: gleich starke Bots, keine Seite gewinnt (fast) immer
//   determin.   gleicher Seed + gleiche Eingaben -> gleicher Zustandshash
// Die Schwellen sind eigene Setzungen (Startwerte aus der Literatur, an den Beispielen und dem Gold-Korpus kalibriert,
// siehe SCHWELLEN); jede Ablehnung nennt Kennzahl, Wert und Schwelle. Budget in Interpreter-Schritten, nie in Zeit.
import { stateHash } from "../../contract/sdk.js";
import { check } from "./check.js";
import * as E from "./engine.js";
import * as Z from "./zug.js";
import { botInput, planOf, randomBot } from "./bot.js";

export const SCHWELLEN = Object.freeze({
  endet: 0.95,          // GAVEL: >= 95 % der Partien enden
  nichtsMax: 0.05,      // RAPP: Nichtstun gewinnt in handgemachten Spielen ~0,06; Setzung 0,05
  luecke: 0.2,          // Siegquote gut - zufall (Setzung, RAPP-Abstand 0,39 bei handgemachten Spielen)
  punkteLuecke: 0.25,   // relativer Punkteabstand gut vs. zufall, wenn Siegquoten nicht trennen (Setzung)
  gutMin: 0.3,          // Solo: der gute Bot gewinnt mindestens 30 % (Setzung; Isaksen: Spiele mit sehr geringer Ueberlebensrate frustrieren)
  dauerMin: 4,          // Sekunden, Median gut (kuerzer = Sofort-Ende)
  dauerMax: 300,        // Sekunden (= LIMITS.maxTicks)
  fairMax: 0.85,        // zu zweit: Anteil der entschiedenen Partien, den eine Seite hoechstens gewinnt ...
  fairP: 0.05           // ... und nur, wenn das kein Zufall ist: exakter zweiseitiger Binomialtest gegen 1/2 (p < 0,05)
});
/** Exakter zweiseitiger Binomialtest gegen p = 1/2: P(|X - n/2| >= |k - n/2|), X ~ Bin(n, 1/2). Nur Pruefung, nie Spielzustand. */
export function binomP(k, n) {
  if (n <= 0) return 1;
  const c = [1]; for (let i = 1; i <= n; i++) c[i] = c[i - 1] * (n - i + 1) / i;
  let tot = 0; const d0 = Math.abs(k - n / 2);
  for (let i = 0; i <= n; i++) if (Math.abs(i - n / 2) >= d0 - 1e-9) tot += c[i];
  let pw = 1; for (let i = 0; i < n; i++) pw *= 2;
  return Math.min(1, tot / pw);
}
export const BUDGET = 6_000_000;    // Interpreter-Schritte je Pruefung (Server: ~1-3 s auf einem Kern)

/** Eine Echtzeit-Partie mit Agenten je Sitz: "nichts" | "zufall" | "gut1".."gut3". -> {won, draw, score, ticks, natural, steps} */
function playRt(d, seed, agents, budget) {
  const roles = agents.map((a) => (a ? "bot" : "none"));
  let st = E.init(d, seed, roles), steps = 0;
  const plan = planOf(d), seedNum = parseInt(String(seed).replace(/\D/g, "").slice(0, 8) || "1", 10);
  // jeder Interpreter-Schritt zaehlt, auch die des Rollout-Bots (meter; Review H1: vorher pauschal, zu niedrig)
  const meter = { steps: 0 };
  const act = (a, s, seat) => {
    if (!a || a === "nichts") return { b: 0 };
    if (a === "zufall") return randomBot(d, s, seat, seedNum);
    return botInput(d, s, seat, Number(a.slice(3)), plan, meter);
  };
  const auto = (s, seat) => botInput(d, s, seat, 2, plan, meter);
  while (!st.over && steps + meter.steps < budget) {
    st = E.step(d, st, [act(agents[0], st, 0), act(agents[1], st, 1)], auto).state;
    steps++;
  }
  steps += meter.steps;
  const s = E.status(d, st);
  return { win: st.win, over: !!st.over, natural: !!st.over && !st.cap, score: s.score, ticks: st.t, steps, hash: stateHash(st) };
}

function rate(xs, f) { return xs.length ? xs.filter(f).length / xs.length : 0; }
function median(xs) { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; }
function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }

/**
 * Prueft eine Beschreibung (roh oder normalisiert). opt: { games (je Agent), budget, seed, clamp, llm }.
 * -> { ok, stage: "schema"|"spiel"|"budget", errors[], reasons[{code, wert, schwelle, text}], metrics, desc, notes }
 */
export function pruefe(raw, opt = {}) {
  const c = check(raw, { clamp: !!opt.clamp, llm: !!opt.llm });
  if (!c.ok) return { ok: false, stage: "schema", errors: c.errors, reasons: [], metrics: null, desc: c.desc, notes: c.notes };
  const d = c.desc, games = opt.games || 8, budget = opt.budget || BUDGET, base = opt.seed || "pruef";
  return d.mode === "turn" ? turnTest(d, games, base, c.notes) : rtTest(d, games, budget, base, c.notes);
}

function rtTest(d, games, budget, base, notes) {
  let left = budget;
  const run = (agents, n, tag) => {
    const out = [];
    for (let i = 0; i < n && left > 0; i++) { const r = playRt(d, base + "|" + tag + "|" + i, agents, left); left -= r.steps; out.push(r); }
    return out;
  };
  const reasons = [], R = (code, wert, schwelle, text) => reasons.push({ code, wert: Math.round(wert * 100) / 100, schwelle, text });
  const metrics = {};
  // Determinismus: dieselbe Partie zweimal
  const a1 = playRt(d, base + "|det", ["gut2", d.players === 2 ? "gut2" : null], Math.min(left, 40000)), a2 = playRt(d, base + "|det", ["gut2", d.players === 2 ? "gut2" : null], Math.min(left, 40000));
  left -= a1.steps + a2.steps;
  metrics.determinismus = a1.hash === a2.hash;
  if (!metrics.determinismus) R("determinismus", 0, 1, "gleiche Eingaben, verschiedene Zustaende");
  const all = [];
  if (d.players === 1) {
    const gut = run(["gut3", null], games, "g3"), mittel = run(["gut2", null], games, "g2"), zufall = run(["zufall", null], games, "z"), nichts = run(["nichts", null], Math.max(3, games >> 1), "n");
    all.push(...gut, ...mittel, ...zufall, ...nichts);
    const best = rate(gut, (r) => r.win === 0) >= rate(mittel, (r) => r.win === 0) ? gut : mittel;
    metrics.gut = rate(best, (r) => r.win === 0); metrics.zufall = rate(zufall, (r) => r.win === 0); metrics.nichts = rate(nichts, (r) => r.win === 0);
    metrics.punkteGut = mean(best.map((r) => r.score[0])); metrics.punkteZufall = mean(zufall.map((r) => r.score[0]));
    metrics.dauer = median(best.map((r) => r.ticks)) / 60;
    if (metrics.gut < SCHWELLEN.gutMin) R("nicht-gewinnbar", metrics.gut, SCHWELLEN.gutMin, "der beste Bot gewinnt zu selten");
    if (metrics.nichts > SCHWELLEN.nichtsMax) R("trivial", metrics.nichts, SCHWELLEN.nichtsMax, "ohne etwas zu tun gewinnt man");
    const gap = metrics.gut - metrics.zufall, pgap = metrics.punkteGut > 0 ? (metrics.punkteGut - metrics.punkteZufall) / Math.max(1, Math.abs(metrics.punkteGut)) : 0;
    metrics.luecke = gap; metrics.punkteLuecke = pgap;
    if (gap < SCHWELLEN.luecke && pgap < SCHWELLEN.punkteLuecke) R("trivial", gap, SCHWELLEN.luecke, "geschicktes Spielen bringt nichts gegenueber Zufall");
  } else {
    const stark = run(["gut3", "gut1"], games, "31"), staerkeB = run(["gut1", "gut3"], games, "13"), gleich = run(["gut2", "gut2"], games, "22"), gegenNichts = run(["gut2", "nichts"], Math.max(3, games >> 1), "2n");
    all.push(...stark, ...staerkeB, ...gleich, ...gegenNichts);
    metrics.stark = (rate(stark, (r) => r.win === 0) + rate(staerkeB, (r) => r.win === 1)) / 2;
    metrics.schwach = (rate(stark, (r) => r.win === 1) + rate(staerkeB, (r) => r.win === 0)) / 2;
    metrics.gegenNichts = rate(gegenNichts, (r) => r.win === 0);
    const decided = gleich.filter((r) => r.win >= 0);
    metrics.seite0 = decided.length ? rate(decided, (r) => r.win === 0) : 0.5;
    metrics.dauer = median(gleich.map((r) => r.ticks)) / 60;
    metrics.punkte = mean(all.map((r) => r.score[0] + r.score[1]));
    if (metrics.gegenNichts < 1 - SCHWELLEN.nichtsMax * 4) R("trivial", metrics.gegenNichts, 1 - SCHWELLEN.nichtsMax * 4, "wer nichts tut, verliert nicht sicher");
    if (metrics.stark + metrics.schwach === 0 && metrics.punkte === 0) R("nicht-gewinnbar", 0, 0.01, "niemand gewinnt oder punktet je");
    else if (metrics.stark - metrics.schwach < SCHWELLEN.luecke && metrics.gegenNichts < 0.9) R("trivial", metrics.stark - metrics.schwach, SCHWELLEN.luecke, "Koennen entscheidet nicht");
    const k0 = decided.filter((r) => r.win === 0).length;
    metrics.fairP = binomP(k0, decided.length);
    if (Math.max(metrics.seite0, 1 - metrics.seite0) > SCHWELLEN.fairMax && metrics.fairP < SCHWELLEN.fairP) R("unfair", Math.max(metrics.seite0, 1 - metrics.seite0), SCHWELLEN.fairMax, "eine Seite gewinnt fast immer (p = " + (Math.round(metrics.fairP * 1000) / 1000) + ")");
  }
  metrics.endet = rate(all, (r) => r.natural);
  metrics.spiele = all.length;
  metrics.schritte = budget - left;
  if (metrics.endet < SCHWELLEN.endet) R("endet-nicht", metrics.endet, SCHWELLEN.endet, "Partien enden nicht von selbst");
  if (metrics.dauer < SCHWELLEN.dauerMin) R("zu-kurz", metrics.dauer, SCHWELLEN.dauerMin, "Partien sind nach Sekunden vorbei");
  if (reasons.length) { try { metrics.diagnose = diagnose(d); } catch (e) { metrics.diagnose = ""; } }
  if (left <= 0) return { ok: false, stage: "budget", errors: [], reasons: [{ code: "budget", wert: budget, schwelle: budget, text: "Rechenbudget erschoepft" }], metrics, desc: d, notes };
  return { ok: reasons.length === 0, stage: "spiel", errors: [], reasons, metrics, desc: d, notes, diagnose: metrics.diagnose || "" };
}

function turnTest(d, games, base, notes) {
  const reasons = [], metrics = {};
  const R = (code, wert, schwelle, text) => reasons.push({ code, wert: Math.round(wert * 100) / 100, schwelle, text });
  const play = (lv0, lv1, seed) => {
    let s = Z.init(d, seed, d.players), n = 0;
    while (!s.pub.over && n++ < 400) {
      const seat = s.pub.tu, lv = seat === 0 ? lv0 : lv1;
      const ms = Z.moves(d, s.pub, seat);
      const m = lv === 0 ? ms[(n * 7 + seat) % ms.length] : Z.botMove(d, s.pub, seat, lv, seed + "|" + seat);
      s = Z.step(d, s, m);
    }
    return { over: !!s.pub.over, win: s.pub.win, moves: s.pub.moves, sc: s.pub.sc.slice() };
  };
  const two = d.players === 2;
  const gut = [], zufall = [];
  for (let i = 0; i < games; i++) { gut.push(play(3, two ? 0 : 3, base + "|g" + i)); zufall.push(play(0, two ? 3 : 0, base + "|z" + i)); }
  const all = gut.concat(zufall);
  metrics.endet = rate(all, (r) => r.over);
  metrics.zuege = median(all.map((r) => r.moves));
  if (metrics.endet < 1) R("endet-nicht", metrics.endet, 1, "Partien enden nicht");
  if (d.turn.kind === "place" && two) {
    metrics.gut = (rate(gut, (r) => r.win === 0) + rate(zufall, (r) => r.win === 1)) / 2;
    metrics.zufall = (rate(gut, (r) => r.win === 1) + rate(zufall, (r) => r.win === 0)) / 2;
    if (metrics.gut - metrics.zufall < SCHWELLEN.luecke) R("trivial", metrics.gut - metrics.zufall, SCHWELLEN.luecke, "Koennen entscheidet nicht");
  }
  if (metrics.zuege < 3) R("zu-kurz", metrics.zuege, 3, "nach wenigen Zuegen vorbei");
  return { ok: reasons.length === 0, stage: "spiel", errors: [], reasons, metrics, desc: d, notes };
}

/** Lesbare Rueckmeldung fuer eine Reparaturrunde des Modells (nur Pruefergebnis, nie Selbstkritik). */
export function feedback(v) {
  if (v.stage === "schema") return "Die Beschreibung ist ungueltig: " + v.errors.slice(0, 8).join("; ") + ".";
  return "Die Bot-Playtests sind nicht bestanden: " + v.reasons.map((r) => r.text + " (" + r.code + ": " + r.wert + ", Schwelle " + r.schwelle + ")").join("; ") + ". " + ((v.diagnose || (v.metrics && v.metrics.diagnose)) ? (v.diagnose || v.metrics.diagnose) + " " : "") + hintOf(v);
}
/**
 * Diagnose (ScriptDoctor-Muster, S34: genaue Rueckmeldung wirkt): eine Partie ohne Eingabe; was kostet das erste Leben, nach
 * wie vielen Sekunden, und steht die Figur auf etwas? -> Satz oder "".
 */
export function diagnose(d) {
  if (d.mode !== "realtime") return "";
  let st = E.init(d, "diag", ["bot", d.players === 2 ? "bot" : "none"]);
  for (let i = 0; i < 60 * 20 && !st.over; i++) {
    const r = E.step(d, st, [{ b: 0 }, { b: 0 }], null);
    st = r.state;
    const hurt = r.ev.find((e) => e.k === "hurt" || e.k === "lose");
    if (hurt) {
      const ru = d.rules[hurt.r], secs = Math.round(st.t / 6) / 10;
      const what = ru ? "Regel " + (hurt.r + 1) + " (" + ru.when + " " + ru.a + (ru.b ? " " + ru.b : "") + ")" : "eine Regel";
      const fall = ru && ru.when === "out" && ru.b === "bottom" ? " Die Figur faellt nach unten heraus: gib ihr Boden (ein Ding mit solid true unter ihr oder world.bottom = wall) oder weniger Schwerkraft." : "";
      return "Ohne jede Eingabe kostet " + what + " nach " + secs + " s das erste Leben." + fall;
    }
  }
  return st.over && st.win === 0 && d.players === 1 ? "Ohne jede Eingabe wird das Spiel gewonnen: es fehlt eine echte Gefahr." : "";
}
/** Konkreter Hinweis je Befund (fuer Reparatur und Gegenvorschlag). */
export function hintOf(v) {
  const codes = new Set(v.reasons.map((r) => r.code));
  const h = [];
  if (codes.has("nicht-gewinnbar")) h.push("Mach es leichter: langsamere Gegner/Hindernisse, groessere Luecken, mehr Leben oder ein niedrigeres Punkteziel.");
  if (codes.has("trivial")) h.push("Es braucht eine echte Gefahr oder ein Ziel, das nur mit Geschick erreichbar ist (Leben verlieren bei Beruehrung, Zeitlimit, Gegner).");
  if (codes.has("endet-nicht")) h.push("Gib ein Ende: end.time in Sekunden, end.score oder Leben.");
  if (codes.has("zu-kurz")) h.push("Die Partie endet sofort: Startpositionen nicht auf Hindernisse legen, Gefahr erst nach einer Weile erzeugen (spawn.after).");
  if (codes.has("unfair")) h.push("Beide Seiten brauchen dieselben Bedingungen (gespiegelte Startpositionen).");
  return h.join(" ");
}
