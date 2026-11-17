// Freie Karte 2, Klaerungsdialog (P1): der Vertrag zwischen App und Server, als reine Funktionen ohne DOM, Uhr oder Netz.
// Der Wrapper vendort diese Datei (CADS-DEMO-wrapper bin/vendor-mdi.mjs) und prueft die Antworten des Modells mit genau
// diesem Code; die App prueft damit, was vom Server kommt (wie ein fremder Link: bekannte Felder, feste Laengen, nichts
// wird erfunden). Keine Policy hier: ob ein Satz oder eigene Worte erlaubt sind, entscheidet allein der Server.
//
// Ablauf (Design-Canvas "Freie Karte 2 – Klaerungsdialog"):
//   1 Satz         ein Satz (SATZ_MIN..SATZ_MAX); nichts wird gebaut oder abgebucht
//   2 Fragen       hoechstens FRAGEN_MAX Fragen des Modells, je KACHELN_MIN..KACHELN_MAX Bild-Kacheln (Emoji aus EMOJI);
//                  "Egal, ueberrasch mich" und "Oder sag es selbst" (EIGEN_MAX Zeichen) setzt die App gleichwertig dazu
//   3 Liste        "So bauen wir es": Punkte, die zugleich Bauauftrag und Abnahmemassstab sind (jeder mit pruefung),
//                  eigene Worte stehen woertlich darin; "nicht": was ehrlich nicht dabei ist; Dauer und Kosten fest
//   4 Auftrag      nach "Ja, so bauen" speichert der Server den Bauauftrag (AUFTRAG_V); P3 baut ihn spaeter
//   5 Ergebnis     erfuellt/fehlt je Punkt (checkErgebnis); in P1 nur mit Testdaten. Teilerfolg: nichts abgebucht,
//                  "Nachbessern" kostenlos hoechstens NACHBESSERN_MAX-mal; danach "Melden" (Freitext bis MELDUNG_MAX,
//                  gleiche Moderation), mit Meldung kostet die Karte nichts; "Trotzdem so behalten" bleibt waehlbar

export const SATZ_MIN = 3, SATZ_MAX = 200, EIGEN_MAX = 120;
export const FRAGEN_MAX = 3, KACHELN_MIN = 2, KACHELN_MAX = 4;
export const PUNKTE_MIN = 3, PUNKTE_MAX = 8, NICHT_MAX = 3;
/** Fest, nie vom Modell: bis 15 Minuten, 1 Guthaben und nur bei Erfolg */
export const DAUER_MAX_MIN = 15, KOSTEN = 1;
export const AUFTRAG_V = 1;
/** Nachbessern ist kostenlos, hoechstens so oft je Karte (gezaehlt nur im Server); danach steht "Melden" an seiner Stelle */
export const NACHBESSERN_MAX = 3, MELDUNG_MAX = 500;
/** Hoechstlaengen in Zeichen (Codepunkte) */
export const LEN = { verstehe: 160, titel: 48, frage: 60, hinweis: 90, label: 32, sub: 70, punkt: 160, pruefung: 160, nicht: 180 };
/** Bilder der Kacheln: nur diese Emoji (App-Look, keine Bilder aus dem Netz). Keine Waffen, kein Blut. */
export const EMOJI = ["⛵", "🚤", "🛶", "🚢", "🦆", "🐸", "🐙", "🦝", "🐌", "🦖", "🐶", "🐱", "🦄", "🐝", "🐧", "🦉", "🐳", "🐠", "🐉", "🦋",
  "🐞", "🐢", "🐇", "🍕", "🍩", "🍪", "🎂", "🍉", "🍓", "🥨", "🧁", "🚀", "🛸", "👽", "🪐", "🌟", "☄️", "🌈", "☀️", "🌙", "❄️", "⛄",
  "🌊", "🌸", "🌻", "🍀", "🎈", "🎉", "🎁", "🎮", "🎲", "🧩", "🏆", "⚽", "🏀", "🎯", "🎨", "🎵", "🎸", "🥁", "📚", "✏️", "🗺️",
  "🏰", "🏝️", "🧭", "💧", "🫧", "🎃", "💡", "⏱️", "⚡", "💥", "🙂", "😄", "😎", "🤖", "🧙", "🧚", "🦸", "👵", "👴", "👪", "🗳️", "❓"];
const EMOJI_SET = new Set(EMOJI);

const len = (s) => [...s].length;
/** Eine Zeile Text: Steuer- und Formatzeichen und spitze Klammern raus, Leerraum zusammen; "" wenn kein Text */
export function line(v) {
  return typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}<>]/gu, " ").replace(/\s+/g, " ").trim() : "";
}
function str(errs, path, v, max, min = 1) {
  const t = line(v);
  if (typeof v !== "string") errs.push(path + ": kein Text");
  else if (len(t) < min) errs.push(path + ": leer");
  else if (len(t) > max) errs.push(path + ": laenger als " + max);
  return t;
}
function obj(errs, path, v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v)) { errs.push(path + ": kein Objekt"); return null; }
  for (const k of Object.keys(v)) if (!keys.includes(k)) errs.push(path + ": unbekannt " + k);
  return v;
}
function arr(errs, path, v, min, max) {
  if (!Array.isArray(v)) { errs.push(path + ": keine Liste"); return []; }
  if (v.length < min || v.length > max) errs.push(path + ": " + v.length + " statt " + min + ".." + max);
  return v.slice(0, max);
}

/** JSON-Schema der Fragen fuer das Modell (strukturierte Ausgabe); geprueft wird zusaetzlich mit checkFragen */
export const FRAGEN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["ok", "verstehe", "fragen"],
  properties: {
    ok: { type: "boolean" },
    verstehe: { type: "string" },
    fragen: { type: "array", items: { type: "object", additionalProperties: false, required: ["frage", "hinweis", "kacheln"], properties: {
      frage: { type: "string" }, hinweis: { type: "string" },
      kacheln: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "sub", "emoji"], properties: { label: { type: "string" }, sub: { type: "string" }, emoji: { type: "string", enum: EMOJI } } } } } } }
  }
};
/** JSON-Schema der Haekchenliste fuer das Modell; geprueft wird zusaetzlich mit checkListe */
export const LISTE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["ok", "titel", "verstehe", "punkte", "nicht"],
  properties: {
    ok: { type: "boolean" }, titel: { type: "string" }, verstehe: { type: "string" },
    punkte: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "pruefung"], properties: { text: { type: "string" }, pruefung: { type: "string" } } } },
    nicht: { type: "array", items: { type: "string" } }
  }
};

/**
 * Fragen des Modells (oder des Servers) pruefen -> { ok: true, value: { verstehe, fragen } } | { ok: false, errors }.
 * Streng: jede Abweichung ist ein Fehler, nichts wird gekuerzt oder ergaenzt. ok:false des Modells ist eine Absage (refusal).
 */
export function checkFragen(o) {
  const errs = [];
  if (!obj(errs, "", o, ["ok", "verstehe", "fragen"])) return { ok: false, errors: errs };
  if (o.ok !== true) return { ok: false, refusal: o.ok === false, errors: errs.concat(o.ok === false ? ["ok: false"] : ["ok: fehlt"]) };
  const verstehe = str(errs, "verstehe", o.verstehe, LEN.verstehe);
  const fragen = arr(errs, "fragen", o.fragen, 1, FRAGEN_MAX).map((f, i) => {
    const p = "fragen[" + i + "]";
    if (!obj(errs, p, f, ["frage", "hinweis", "kacheln"])) return null;
    const seen = new Set();
    const kacheln = arr(errs, p + ".kacheln", f.kacheln, KACHELN_MIN, KACHELN_MAX).map((k, j) => {
      const q = p + ".kacheln[" + j + "]";
      if (!obj(errs, q, k, ["label", "sub", "emoji"])) return null;
      const label = str(errs, q + ".label", k.label, LEN.label), sub = str(errs, q + ".sub", k.sub, LEN.sub, 0);
      if (!EMOJI_SET.has(k.emoji)) errs.push(q + ".emoji: nicht erlaubt");
      if (seen.has(label.toLowerCase())) errs.push(q + ".label: doppelt");
      seen.add(label.toLowerCase());
      return { label, sub, emoji: k.emoji };
    });
    return { frage: str(errs, p + ".frage", f.frage, LEN.frage), hinweis: str(errs, p + ".hinweis", f.hinweis, LEN.hinweis, 0), kacheln };
  });
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: { verstehe, fragen } };
}

/** Eine Antwort auf Frage i: { art: "kachel", kachel } | { art: "egal" } | { art: "eigen", text } -> normalisiert oder null */
export function antwortOf(a, frage) {
  if (!a || typeof a !== "object" || !frage) return null;
  if (a.art === "kachel" && Number.isInteger(a.kachel) && a.kachel >= 0 && a.kachel < frage.kacheln.length) return { art: "kachel", kachel: a.kachel };
  if (a.art === "egal") return { art: "egal" };
  if (a.art === "eigen") { const t = line(a.text); return t && len(t) <= EIGEN_MAX ? { art: "eigen", text: t } : null; }
  return null;
}
/** Was eine Antwort sagt, als Text fuer Liste und Zusammenfassung (eigene Worte woertlich) */
export function antwortText(a, frage) {
  return a.art === "kachel" ? frage.kacheln[a.kachel].label : a.art === "eigen" ? a.text : "";
}

/**
 * Haekchenliste pruefen -> { ok: true, value: { titel, verstehe, punkte, nicht } } | { ok: false, errors }.
 * eigene: die angenommenen eigenen Worte; jedes muss woertlich in einem Punkt stehen (Bauauftrag = Abnahmemassstab).
 */
export function checkListe(o, eigene = []) {
  const errs = [];
  if (!obj(errs, "", o, ["ok", "titel", "verstehe", "punkte", "nicht"])) return { ok: false, errors: errs };
  if (o.ok !== true) return { ok: false, refusal: o.ok === false, errors: errs.concat(o.ok === false ? ["ok: false"] : ["ok: fehlt"]) };
  const titel = str(errs, "titel", o.titel, LEN.titel), verstehe = str(errs, "verstehe", o.verstehe, LEN.verstehe);
  const punkte = arr(errs, "punkte", o.punkte, PUNKTE_MIN, PUNKTE_MAX).map((p, i) => {
    const q = "punkte[" + i + "]";
    if (!obj(errs, q, p, ["text", "pruefung"])) return null;
    return { id: "p" + (i + 1), text: str(errs, q + ".text", p.text, LEN.punkt), pruefung: str(errs, q + ".pruefung", p.pruefung, LEN.pruefung) };
  });
  const nicht = arr(errs, "nicht", o.nicht, 0, NICHT_MAX).map((n, i) => str(errs, "nicht[" + i + "]", n, LEN.nicht));
  for (const e of eigene) if (!punkte.some((p) => p && p.text.includes(e))) errs.push("eigene Worte fehlen woertlich: " + e);
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: { titel, verstehe, punkte, nicht } };
}

/**
 * Ergebnis eines Baus (P3) gegen die Liste: je Punkt erfuellt oder nicht, mit kurzer Notiz -> normalisiert oder null.
 * Ein Ergebnis, das nicht genau die Punkte des Auftrags bewertet, gibt es nicht (null).
 */
export function checkErgebnis(o, punkte) {
  if (!o || typeof o !== "object" || !Array.isArray(o.punkte) || !Array.isArray(punkte) || o.punkte.length !== punkte.length) return null;
  const titel = line(o.titel);
  if (!titel || len(titel) > LEN.titel) return null;
  const out = [];
  for (let i = 0; i < punkte.length; i++) {
    const r = o.punkte[i];
    if (!r || r.id !== punkte[i].id || typeof r.erfuellt !== "boolean") return null;
    const notiz = line(r.notiz);
    if (len(notiz) > LEN.punkt) return null;
    out.push({ id: r.id, text: punkte[i].text, erfuellt: r.erfuellt, notiz });
  }
  return { titel, punkte: out, fehlt: out.filter((p) => !p.erfuellt).length };
}
