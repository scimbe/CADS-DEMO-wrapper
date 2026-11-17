// Tester-Konten (DUELL_TESTER_ACCTS), gemeinsam fuer lib/duell-ai.mjs (Tagesgrenze, fix/ki-ausfall-hinweis) und den
// Klaerungsdialog (feat/fk2-klaerung).
//
// Ein Konto ist seine Login-E-Mail, nicht das Keycloak-Subjekt: who() in lib/duell-ai.mjs bildet es als
// 'a' + mac('account:' + email.toLowerCase()), und Guthaben, Gutscheine, Tagesgrenze und Strikes haengen an diesem Schluessel.
// Wer sich mit einer anderen Adresse anmeldet (z. B. ueber HAW-GitLab mit der Hochschul-Mail), ist ein anderes Konto und
// braucht einen eigenen Eintrag. Die Adressen werden hier getrimmt, kleingeschrieben und sofort in Schluessel umgewandelt;
// behalten und verglichen werden nur die Schluessel. Diese Datei loggt nichts: der Aufrufer loggt nur count und bad.
//
//   parse(raw, keyOf) -> { count, bad, given, isTester(acct) }
//     raw    der Wert von DUELL_TESTER_ACCTS (Kommaliste von E-Mail-Adressen; undefined = nicht gesetzt)
//     keyOf  (mail) => Konto-Schluessel, in lib/duell-ai.mjs: (m) => 'a' + mac('account:' + m)
//     count  Anzahl gueltiger Tester-Konten; bad: ungueltige Eintraege (ignoriert); given: die Variable ist gesetzt
//     isTester(acct)  ist dieser Konto-Schluessel (p.acct bzw. p.key der freien Karte) ein Tester?
//   Gesetzt, aber leer oder mit ungueltigen Eintraegen: der Aufrufer warnt (given && (bad || !count)), nie still.

const MAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function parse(raw, keyOf) {
  const items = String(raw ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const keys = new Set(items.filter((m) => MAIL.test(m)).map((m) => keyOf(m)));
  return { count: keys.size, bad: items.filter((m) => !MAIL.test(m)).length, given: raw !== undefined, isTester: (acct) => typeof acct === 'string' && keys.has(acct) };
}
