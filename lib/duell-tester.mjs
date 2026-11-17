// Tester accounts (DUELL_TESTER_ACCTS): a comma list of e-mail addresses, read once at start, trimmed, lower case and turned
// into the account key exactly as lib/duell-ai.mjs who() builds it ('a' + mac('account:' + mail), acctOf of createDuellAi).
// Only the keys are kept; an address is never logged or returned. Shared by every feature that is on for testers only
// (Freie Karte 2 lib/duell-klaerung.mjs DUELL_KLAERUNG=tester, the tester day limit), so there is one implementation.
//
//   parse(raw) -> [mail]                                 the cleaned list (alias parseTesterMails)
//   createTesters({ env, acctOf }) -> { isTester(acct) -> boolean, size }
// The same small file is planned in branch fix/ki-ausfall-hinweis (tester day limit); when both meet, one copy stays.

const MAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** "a@x.de, B@Y.org ,," -> ['a@x.de', 'b@y.org']; anything that is no address is dropped (counted, never echoed) */
export function parseTesterMails(raw) {
  return [...new Set(String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => MAIL.test(s)))];
}

export const parse = parseTesterMails;

/** acctOf(mail) -> the account key of who(); without it nobody is a tester (fail closed) */
export function createTesters({ env = process.env, acctOf } = {}) {
  const keys = new Set(typeof acctOf === 'function' ? parseTesterMails(env.DUELL_TESTER_ACCTS).map((m) => acctOf(m)).filter(Boolean) : []);
  return { isTester: (acct) => typeof acct === 'string' && acct !== '' && keys.has(acct), size: keys.size };
}
