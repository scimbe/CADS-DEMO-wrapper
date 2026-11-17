// Beispielbeschreibungen (Strang B): belegen, dass "mdi-bau/1" die bestehenden Spielarten ausdrueckt (Flug/Flappy, Ziegel/
// Breakout, Pong, Kick, Schlange/Snake, Reaktion, Memory, Drei/Vier gewinnt, Wortspiele der Zugkarten), dienen als
// Testvektoren (test/baukasten*.test.js) und als Beispiele im Modell-Prompt des Servers (CADS-DEMO-wrapper, vendored).
// Kurzform: fehlende Felder fuellt spec.normalize mit Standardwerten.

export const FLAPPY = {
  v: 1, title: "Wolkenflug", goal: "Tippe zum Flattern und fliege durch 15 Luecken.", mode: "realtime", players: 1, bg: "sky",
  world: { gravity: 2600, left: "open", right: "open", bottom: "open" },
  things: [
    { id: "vogel", look: "emoji", emoji: "🐤", w: 84, h: 84, gravity: true, control: "flap", power: 880 },
    { id: "rohr", look: "box", color: "violet", w: 150, h: 200, vx: -280 }
  ],
  start: [{ thing: "vogel", x: 300, y: 760, seat: 0 }],
  spawn: [{ thing: "rohr", every: 1650, after: 900, x: 1100, y: 800, yr: 330, gap: 440, max: 8 }],
  rules: [
    { when: "touch", a: "vogel", b: "rohr", do: [{ act: "life", on: "a", n: -1 }] },
    { when: "out", a: "vogel", b: "bottom", do: [{ act: "life", on: "a", n: -1 }] },
    { when: "pass", a: "vogel", b: "rohr", do: [{ act: "score", on: "a", n: 1 }] }
  ],
  end: { score: 15, lives: 1, win: "score" },
  bot: { kind: "flap", thing: "vogel", target: "rohr" }
};

export const BREAKOUT = {
  v: 1, title: "Ziegelbruch", goal: "Lenke den Ball und raeume alle Ziegel ab. Drei Baelle.", mode: "realtime", players: 1, bg: "ink",
  world: { bottom: "open" },
  things: [
    { id: "schlaeger", look: "box", color: "yellow", w: 190, h: 32, control: "drag", power: 1500 },
    { id: "ball", look: "circle", color: "paper", w: 34, h: 34, bounce: "walls", vx: 420, vy: -760, spread: 320 },
    { id: "ziegel", look: "box", color: "red", w: 104, h: 46 }
  ],
  start: [
    { thing: "schlaeger", x: 500, y: 1480, seat: 0 },
    { thing: "ball", x: 500, y: 1300 },
    { thing: "ziegel", x: 140, y: 300, n: 24, cols: 6, dx: 144, dy: 62 }
  ],
  rules: [
    { when: "touch", a: "ball", b: "schlaeger", do: [{ act: "bounce", on: "a", n: 0 }] },
    { when: "touch", a: "ball", b: "ziegel", do: [{ act: "bounce", on: "a", n: 0 }, { act: "destroy", on: "b", n: 0 }, { act: "score", on: "a", n: 1 }] },
    { when: "out", a: "ball", b: "bottom", do: [{ act: "life", on: "a", n: -1 }, { act: "reset", on: "a", n: 0 }] },
    { when: "clear", a: "ziegel", do: [{ act: "win", on: "seat0", n: 0 }] }
  ],
  end: { lives: 3, win: "clear" },
  bot: { kind: "track", thing: "schlaeger", target: "ball" }
};

export const PONG = {
  v: 1, title: "Pingpong", goal: "Halte den Ball im Spiel. Wer zuerst 5 Punkte hat, gewinnt.", mode: "realtime", players: 2, bg: "ink",
  world: { top: "open", bottom: "open", flip: true },
  things: [
    { id: "schlaeger", look: "box", color: "yellow", w: 200, h: 30, control: "drag", power: 1400 },
    { id: "ball", look: "circle", color: "paper", w: 36, h: 36, bounce: "walls", vx: 260, vy: 640, spread: 260 }
  ],
  start: [
    { thing: "schlaeger", x: 500, y: 1500, seat: 0 },
    { thing: "schlaeger", x: 500, y: 100, seat: 1 },
    { thing: "ball", x: 500, y: 800 }
  ],
  rules: [
    { when: "touch", a: "ball", b: "schlaeger", do: [{ act: "bounce", on: "a", n: 0 }, { act: "speed", on: "a", n: 4 }] },
    { when: "out", a: "ball", b: "top", do: [{ act: "score", on: "seat0", n: 1 }, { act: "reset", on: "a", n: 0 }] },
    { when: "out", a: "ball", b: "bottom", do: [{ act: "score", on: "seat1", n: 1 }, { act: "reset", on: "a", n: 0 }] }
  ],
  end: { score: 5, time: 150, win: "score" },
  bot: { kind: "track", thing: "schlaeger", target: "ball" }
};

export const KICK = {
  v: 1, title: "Tischkick", goal: "Schiess den Ball ins obere Tor. Verteidiger laufen hin und her. 3 Tore gewinnen.", mode: "realtime", players: 2, bg: "ink",
  world: { flip: true },
  things: [
    { id: "torwart", look: "box", color: "yellow", w: 170, h: 34, control: "lr", power: 1100 },
    { id: "abwehr", look: "box", color: "red", w: 90, h: 30, ai: "patrol", power: 260, bounce: "walls" },
    { id: "ball", look: "circle", color: "white", w: 40, h: 40, bounce: "walls", vx: 200, vy: 700, spread: 300 },
    { id: "torunten", look: "box", color: "green", w: 300, h: 26 },
    { id: "toroben", look: "box", color: "green", w: 300, h: 26 }
  ],
  start: [
    { thing: "torwart", x: 500, y: 1450, seat: 0 }, { thing: "torwart", x: 500, y: 150, seat: 1 },
    { thing: "abwehr", x: 300, y: 1100 }, { thing: "abwehr", x: 700, y: 500 },
    { thing: "torunten", x: 500, y: 1587 }, { thing: "toroben", x: 500, y: 13 },
    { thing: "ball", x: 500, y: 800 }
  ],
  rules: [
    { when: "touch", a: "ball", b: "torwart", do: [{ act: "bounce", on: "a", n: 0 }] },
    { when: "touch", a: "ball", b: "abwehr", do: [{ act: "bounce", on: "a", n: 0 }] },
    { when: "touch", a: "ball", b: "toroben", do: [{ act: "score", on: "seat0", n: 1 }, { act: "reset", on: "a", n: 0 }] },
    { when: "touch", a: "ball", b: "torunten", do: [{ act: "score", on: "seat1", n: 1 }, { act: "reset", on: "a", n: 0 }] }
  ],
  end: { score: 3, time: 180, win: "score" },
  bot: { kind: "track", thing: "torwart", target: "ball" }
};

export const SNAKE = {
  v: 1, title: "Hungrige Schlange", goal: "Steuere die Schlange zu den Aepfeln. Nicht in den Rand oder dich selbst beissen.", mode: "realtime", players: 1, bg: "ink",
  world: { cols: 16, rows: 24, top: "open", bottom: "open", left: "open", right: "open" },
  things: [
    { id: "schlange", look: "box", color: "lime", control: "steer", power: 7, trail: 3 },
    { id: "apfel", look: "emoji", emoji: "🍎" }
  ],
  start: [{ thing: "schlange", x: 4, y: 12, seat: 0 }, { thing: "apfel", x: 11, y: 12 }],
  spawn: [{ thing: "apfel", every: 400, x: -1, y: -1, max: 1 }],
  rules: [
    { when: "touch", a: "schlange", b: "apfel", do: [{ act: "score", on: "a", n: 1 }, { act: "grow", on: "a", n: 1 }, { act: "destroy", on: "b", n: 0 }] },
    { when: "touch", a: "schlange", b: "schlange", do: [{ act: "life", on: "a", n: -1 }] },
    { when: "out", a: "schlange", b: "any", do: [{ act: "life", on: "a", n: -1 }] }
  ],
  end: { score: 15, lives: 1, win: "score" },
  bot: { kind: "seek", thing: "schlange", target: "apfel" }
};

export const REAKTION = {
  v: 1, title: "Sternfang", goal: "Tippe jeden Stern, bevor er verschwindet. Daneben kostet einen Punkt.", mode: "realtime", players: 1, bg: "violet",
  things: [{ id: "stern", look: "emoji", emoji: "⭐", w: 170, h: 170, control: "tap", life: 1200 }],
  spawn: [{ thing: "stern", every: 1300, after: 700, x: 500, y: 800, xr: 360, yr: 600, max: 1 }],
  rules: [
    { when: "tap", a: "stern", do: [{ act: "score", on: "actor", n: 1 }, { act: "destroy", on: "a", n: 0 }] },
    { when: "miss", do: [{ act: "score", on: "actor", n: -1 }] }
  ],
  end: { time: 30, score: 15, win: "score" },
  bot: { kind: "tap", target: "stern" }
};

export const AUSWEICHEN = {
  v: 1, title: "Steinregen", goal: "Weiche den fallenden Steinen 40 Sekunden lang aus. Drei Leben.", mode: "realtime", players: 1, bg: "paper",
  world: { gravity: 900, top: "open", bottom: "open" },
  things: [
    { id: "igel", look: "emoji", emoji: "🦔", w: 110, h: 90, control: "lr", power: 1100 },
    { id: "stein", look: "circle", color: "ink", w: 70, h: 70, gravity: true }
  ],
  start: [{ thing: "igel", x: 500, y: 1500, seat: 0 }],
  spawn: [{ thing: "stein", every: 700, x: 500, y: -40, xr: 460, max: 12 }],
  rules: [
    { when: "touch", a: "igel", b: "stein", do: [{ act: "life", on: "a", n: -1 }, { act: "destroy", on: "b", n: 0 }] },
    { when: "every", n: 1000, do: [{ act: "score", on: "all", n: 1 }] }
  ],
  end: { time: 40, lives: 3, win: "survive" },
  bot: { kind: "dodge", thing: "igel", target: "stein" }
};

export const HUEPFER = {
  v: 1, title: "Kistenhuepfer", goal: "Springe ueber die Kisten. 20 Kisten schaffen gewinnt.", mode: "realtime", players: 1, bg: "yellow",
  world: { gravity: 3200, left: "open", right: "open" },
  things: [
    { id: "fuchs", look: "emoji", emoji: "🦊", w: 100, h: 100, gravity: true, control: "jump", power: 1500 },
    { id: "kiste", look: "box", color: "ink", w: 90, h: 90, vx: -420 }
  ],
  start: [{ thing: "fuchs", x: 250, y: 1500, seat: 0 }],
  spawn: [{ thing: "kiste", every: 1500, after: 1000, x: 1060, y: 1555, max: 4 }],
  rules: [
    { when: "touch", a: "fuchs", b: "kiste", do: [{ act: "life", on: "a", n: -1 }, { act: "destroy", on: "b", n: 0 }] },
    { when: "pass", a: "fuchs", b: "kiste", do: [{ act: "score", on: "a", n: 1 }] }
  ],
  end: { score: 20, lives: 3, win: "score" },
  bot: { kind: "jump", thing: "fuchs", target: "kiste" }
};

export const MEMORY = {
  v: 1, title: "Tier-Memory", goal: "Finde alle Paare. Wer mehr Paare hat, gewinnt.", mode: "turn", players: 2, bg: "paper",
  turn: { kind: "flip", cols: 4, rows: 4, pairs: ["🐶", "🐱", "🦊", "🐸", "🐼", "🐨", "🦁", "🐷"], again: true }
};

export const DREI = {
  v: 1, title: "Drei in einer Reihe", goal: "Setze abwechselnd. Drei in einer Reihe gewinnen.", mode: "turn", players: 2, bg: "paper",
  things: [{ id: "kreuz", look: "emoji", emoji: "❌" }, { id: "kreis", look: "emoji", emoji: "⭕" }],
  turn: { kind: "place", cols: 3, rows: 3, line: 3, pieces: ["kreuz", "kreis"] }
};

export const VIER = {
  v: 1, title: "Vier fallen", goal: "Wirf deine Steine in eine Spalte. Vier in einer Reihe gewinnen.", mode: "turn", players: 2, bg: "blue",
  things: [{ id: "gelb", look: "emoji", emoji: "🟡" }, { id: "rot", look: "emoji", emoji: "🔴" }],
  turn: { kind: "place", cols: 7, rows: 6, line: 4, drop: true, pieces: ["gelb", "rot"] }
};

export const WORTSALAT = {
  v: 1, title: "Buchstabensalat Winter", goal: "Ordne die Buchstaben zum richtigen Wort.", mode: "turn", players: 2, bg: "paper",
  turn: { kind: "answer", ask: "type", form: "scramble", items: [
    { q: "Faellt im Winter vom Himmel", a: "Schnee", wrong: [] }, { q: "Hält die Haende warm", a: "Handschuh", wrong: [] },
    { q: "Rodeln geht damit", a: "Schlitten", wrong: [] }, { q: "Der Mann aus Schnee hat eine", a: "Karotte", wrong: [] },
    { q: "Gefrorenes Wasser", a: "Eis", wrong: [] }, { q: "Warm um den Hals", a: "Schal", wrong: [] }
  ] }
};

export const QUIZ = {
  v: 1, title: "Weltraum-Quiz", goal: "Waehle die richtige Antwort. Mehr Treffer gewinnen.", mode: "turn", players: 2, bg: "ink",
  turn: { kind: "answer", ask: "pick", form: "plain", items: [
    { q: "Welcher Planet ist der Sonne am naechsten?", a: "Merkur", wrong: ["Venus", "Mars"] },
    { q: "Wie heisst der rote Planet?", a: "Mars", wrong: ["Jupiter", "Saturn"] },
    { q: "Was umkreist die Erde?", a: "Der Mond", wrong: ["Die Sonne", "Der Mars"] },
    { q: "Welcher Planet hat die auffaelligsten Ringe?", a: "Saturn", wrong: ["Merkur", "Erde"] }
  ] }
};

export const LUECKE = {
  v: 1, title: "Tier-Luecken", goal: "Ergaenze das Tier. Jede zweite Buchstabe fehlt.", mode: "turn", players: 1, bg: "yellow",
  turn: { kind: "answer", ask: "pick", form: "gap", items: [
    { q: "Hat einen Ruessel", a: "Elefant", wrong: ["Giraffe", "Nashorn"] },
    { q: "Springt mit einem Beutel", a: "Kaenguru", wrong: ["Koala", "Lemur"] },
    { q: "Hat schwarze und weisse Streifen", a: "Zebra", wrong: ["Tiger", "Panda"] }
  ] }
};

// ---- weitere Echtzeit-Muster (Strang B, Quote der Erzeugung): je ein haeufiger Wunsch, den das Modell ohne Vorbild oft falsch
// baute (Gold-Korpus Dev: Auffangen mit guten und schlechten Dingen, Einsammeln mit Verfolger, Hoch-runter-Ausweichen,
// Tipp-Wettlauf zu zweit, Springen mit festem Boden)
export const AUFFANGEN = {
  v: 1, title: "Apfelernte", goal: "Fang die roten Aepfel mit dem Korb, die braunen nicht. Drei Leben.", mode: "realtime", players: 1, bg: "sky",
  world: { gravity: 700, top: "open", bottom: "open" },
  things: [
    { id: "korb", look: "emoji", emoji: "🧺", w: 150, h: 90, control: "drag", power: 1600 },
    { id: "apfel", look: "emoji", emoji: "🍎", w: 80, h: 80, gravity: true },
    { id: "faul", look: "emoji", emoji: "🟤", w: 70, h: 70, gravity: true }
  ],
  start: [{ thing: "korb", x: 500, y: 1500, seat: 0 }],
  spawn: [{ thing: "apfel", every: 900, after: 600, x: 500, y: -40, xr: 440, max: 6 }, { thing: "faul", every: 1700, after: 2500, x: 500, y: -40, xr: 440, max: 3 }],
  rules: [
    { when: "touch", a: "korb", b: "apfel", do: [{ act: "score", on: "a", n: 1 }, { act: "destroy", on: "b", n: 0 }] },
    { when: "touch", a: "korb", b: "faul", do: [{ act: "life", on: "a", n: -1 }, { act: "destroy", on: "b", n: 0 }] },
    { when: "out", a: "apfel", b: "bottom", do: [{ act: "life", on: "all", n: -1 }, { act: "destroy", on: "a", n: 0 }] }
  ],
  end: { score: 20, lives: 3, win: "score" },
  bot: { kind: "track", thing: "korb", target: "apfel" }
};

export const SAMMELN = {
  v: 1, title: "Nusssammler", goal: "Sammle 12 Nuesse. Der Fuchs jagt dich, beruehrt er dich, kostet es ein Leben.", mode: "realtime", players: 1, bg: "green",
  things: [
    { id: "hoernchen", look: "emoji", emoji: "🐿️", w: 90, h: 90, control: "move", power: 700 },
    { id: "nuss", look: "emoji", emoji: "🌰", w: 70, h: 70 },
    { id: "fuchs", look: "emoji", emoji: "🦊", w: 100, h: 100, ai: "chase", power: 280 }
  ],
  start: [{ thing: "hoernchen", x: 500, y: 1300, seat: 0 }, { thing: "fuchs", x: 500, y: 200 }, { thing: "nuss", x: 250, y: 700 }],
  spawn: [{ thing: "nuss", every: 1500, x: 500, y: 800, xr: 400, yr: 650, max: 3 }],
  rules: [
    { when: "touch", a: "hoernchen", b: "nuss", do: [{ act: "score", on: "a", n: 1 }, { act: "destroy", on: "b", n: 0 }] },
    { when: "touch", a: "hoernchen", b: "fuchs", do: [{ act: "life", on: "a", n: -1 }, { act: "reset", on: "b", n: 0 }] }
  ],
  end: { score: 12, lives: 3, time: 90, win: "score" },
  bot: { kind: "seek", thing: "hoernchen", target: "nuss" }
};

export const TAUCHEN = {
  v: 1, title: "Quallenslalom", goal: "Schwimm hoch und runter, weich den Quallen aus. 45 Sekunden durchhalten.", mode: "realtime", players: 1, bg: "blue",
  world: { left: "open", right: "open" },
  things: [
    { id: "fisch", look: "emoji", emoji: "🐟", w: 90, h: 70, control: "ud", power: 900 },
    { id: "qualle", look: "emoji", emoji: "🪼", w: 90, h: 90, vx: -380 }
  ],
  start: [{ thing: "fisch", x: 200, y: 800, seat: 0 }],
  spawn: [{ thing: "qualle", every: 550, after: 1200, x: 1080, y: 800, yr: 700, max: 10 }],
  rules: [
    { when: "touch", a: "fisch", b: "qualle", do: [{ act: "life", on: "a", n: -1 }, { act: "destroy", on: "b", n: 0 }] },
    { when: "every", n: 1000, do: [{ act: "score", on: "all", n: 1 }] }
  ],
  end: { time: 45, lives: 2, win: "survive" },
  bot: { kind: "dodge", thing: "fisch", target: "qualle" }
};

export const TIPPDUELL = {
  v: 1, title: "Kuerbisduell", goal: "Zu zweit: Wer zuerst 15 Kuerbisse antippt, gewinnt. Daneben tippen kostet einen Punkt.", mode: "realtime", players: 2, bg: "ink",
  things: [{ id: "kuerbis", look: "emoji", emoji: "🎃", w: 150, h: 150, control: "tap", life: 1300 }],
  spawn: [{ thing: "kuerbis", every: 700, after: 800, x: 500, y: 800, xr: 380, yr: 620, max: 2 }],
  rules: [
    { when: "tap", a: "kuerbis", do: [{ act: "score", on: "actor", n: 1 }, { act: "destroy", on: "a", n: 0 }] },
    { when: "miss", do: [{ act: "score", on: "actor", n: -1 }] }
  ],
  end: { score: 15, time: 60, win: "score" },
  bot: { kind: "tap", target: "kuerbis" }
};

export const PLATTFORM = {
  v: 1, title: "Steinbruecke", goal: "Spring ueber die Steine auf dem festen Boden. 15 geschafft gewinnt.", mode: "realtime", players: 1, bg: "paper",
  world: { gravity: 3000, left: "open", right: "open", bottom: "open" },
  things: [
    { id: "frosch", look: "emoji", emoji: "🐸", w: 90, h: 90, gravity: true, control: "jump", power: 1450 },
    { id: "boden", look: "box", color: "muted", w: 1000, h: 80, solid: true },
    { id: "stein", look: "box", color: "red", w: 80, h: 80, vx: -400 }
  ],
  start: [{ thing: "frosch", x: 250, y: 1400, seat: 0 }, { thing: "boden", x: 500, y: 1560 }],
  spawn: [{ thing: "stein", every: 1600, after: 1000, x: 1060, y: 1480, max: 4 }],
  rules: [
    { when: "touch", a: "frosch", b: "stein", do: [{ act: "life", on: "a", n: -1 }, { act: "destroy", on: "b", n: 0 }] },
    { when: "pass", a: "frosch", b: "stein", do: [{ act: "score", on: "a", n: 1 }] },
    { when: "out", a: "frosch", b: "bottom", do: [{ act: "lose", on: "a", n: 0 }] }
  ],
  end: { score: 15, lives: 3, win: "score" },
  bot: { kind: "jump", thing: "frosch", target: "stein" }
};

/** Zusaetzliche Echtzeit-Beispiele fuer den Prompt (Beispielsatz "mehr"). */
export const MEHR = { auffangen: AUFFANGEN, sammeln: SAMMELN, tauchen: TAUCHEN, tippduell: TIPPDUELL, plattform: PLATTFORM };

/** Alle Beispiele mit ihrer Art aus dem Altcode/Katalog (Nachweis der Ausdrucksstaerke). */
export const BEISPIELE = { auffangen: AUFFANGEN, sammeln: SAMMELN, tauchen: TAUCHEN, tippduell: TIPPDUELL, plattform: PLATTFORM, flappy: FLAPPY, breakout: BREAKOUT, pong: PONG, kick: KICK, snake: SNAKE, reaktion: REAKTION, ausweichen: AUSWEICHEN, huepfer: HUEPFER, memory: MEMORY, drei: DREI, vier: VIER, wortsalat: WORTSALAT, quiz: QUIZ, luecke: LUECKE };
