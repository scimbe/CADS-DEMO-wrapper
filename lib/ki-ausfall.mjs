// Wenn die KI nicht antwortet (Konto-Limit, Guthaben, Rate-Limit, Ueberlast, Ausfall, Schluessel): eine Klasse, eine klare
// Antwort an den Nutzer, eine Warnung an den Betreiber. Anlass: am 17.11.2026 19:49 UTC antwortete die Anthropic-API dem
// Produktionsschluessel mit HTTP 400 "You have reached your specified API usage limits", und niemand merkte es.
//
//   klasseVon(e)  ein Fehler der Modellschicht (lib/duell-llm.mjs, lib/duell.mjs makeLlm) -> Klasse | '' (keine KI-Stoerung,
//                 z. B. eine falsche Anfrage von uns: bleibt der Programmfehler, der er ist)
//     ki-limit        402, billing_error, eine Meldung ueber Nutzungs-/Ausgabenlimit, Guthaben, Abrechnung (auch als 400 oder 429)
//     ki-key          401, 403 (authentication_error, permission_error)
//     ki-ueberlastet  429, 529 (rate_limit_error, overloaded_error)
//     ki-ausfall      5xx, Netzfehler (nur Fehler des Aufrufs selbst, markiert mit e.netz). Laeuft nur unsere eigene Frist ab,
//                     ist das code 'timeout' (lib/duell-llm.mjs), keine KI-Stoerung und keine Betreiber-Warnung
//   kiFehler(klasse, e)  -> Error mit code 'ki-nicht-verfuegbar' und grund = Klasse; der Endpunkt antwortet daraus
//                 503 { error: 'ki-nicht-verfuegbar', grund }, ohne Strike, ohne Abbuchung, ohne Tageskontingent.
//   createKiWaechter({ env, log, now, send })  merkt sich den Zustand fuer /api/status und warnt den Betreiber per Mail
//                 (lib/smtp-mail.mjs): je Klasse hoechstens eine Mail pro Stunde. Ohne OPS_ALERT_MAIL ein WARN-Log beim Start
//                 und bei jedem Ereignis, nie still.
//
// Keine Rueckfallebene: eine Klasse ersetzt nie die Antwort des Modells durch etwas anderes.

import { readFileSync } from 'node:fs';
import { sendMail } from './smtp-mail.mjs';

export const KI_FEHLER = 'ki-nicht-verfuegbar';
export const KLASSEN = ['ki-limit', 'ki-ueberlastet', 'ki-ausfall', 'ki-key'];
export const DROSSEL_MS = 3600000;

// Limit und Guthaben stehen bei Anthropic im Text einer 400 (invalid_request_error) oder als billing_error; OpenAI-artige
// Proxys (LiteLLM) reichen dieselbe Meldung weiter, manchmal als 429.
const LIMIT_RE = /usage limits?|spend(ing)? limits?|credit balance|billing|insufficient[ _-]?(credit|funds|quota|balance)|quota exceeded|exceeded your current quota/i;

/** -> 'ki-limit' | 'ki-ueberlastet' | 'ki-ausfall' | 'ki-key' | '' */
export function klasseVon(e) {
  if (!e || typeof e !== 'object' || e.code) return '';   // Absagen der eigenen Schicht (busy, budget, not-configured) sind keine
  const status = Number(e.status) || 0, typ = String(e.apiTyp || ''), text = String(e.apiText || '');
  if (status) {
    if (status === 402 || typ === 'billing_error' || (status < 500 && LIMIT_RE.test(text))) return 'ki-limit';
    if (status === 401 || status === 403 || typ === 'authentication_error' || typ === 'permission_error') return 'ki-key';
    if (status === 429 || status === 529 || typ === 'rate_limit_error' || typ === 'overloaded_error') return 'ki-ueberlastet';
    if (status >= 500) return 'ki-ausfall';
    return '';
  }
  return e.netz ? 'ki-ausfall' : '';
}

/** Ein Fehler mit dem Status und der Fehlermeldung einer Antwort, die nicht ok war (der Text nur fuer die Betreiber-Mail). */
export async function httpFehler(r) {
  const e = new Error('llm-http-' + r.status);
  e.status = r.status;
  let raw = '';
  try { raw = typeof r.text === 'function' ? String(await r.text()).slice(0, 4000) : ''; } catch { raw = ''; }
  try {
    const j = JSON.parse(raw), err = j && typeof j.error === 'object' && j.error ? j.error : j || {};
    e.apiTyp = String(err.type || err.code || '').slice(0, 60);
    e.apiText = String(err.message || '').slice(0, 300);
  } catch { e.apiTyp = ''; e.apiText = raw.slice(0, 300); }
  return e;
}

/** Ein Fehler des Aufrufs selbst (Netz, Abbruch nach Zeit): markiert, damit klasseVon ihn von Programmfehlern trennt. */
export function netzFehler(e) {
  const x = e instanceof Error ? e : new Error(String(e));
  x.netz = true;
  return x;
}

export function kiFehler(klasse, ursache) {
  const e = new Error(KI_FEHLER + ':' + klasse);
  e.code = KI_FEHLER; e.grund = klasse;
  if (ursache) { e.status = Number(ursache.status) || 0; e.apiTyp = ursache.apiTyp || ''; e.apiText = ursache.apiText || ''; }
  return e;
}
export const istKiFehler = (e) => !!e && e.code === KI_FEHLER && KLASSEN.includes(e.grund);
/** Die Antwort eines Endpunkts auf einen KI-Fehler; extra: was der Endpunkt sonst immer mitschickt (z. B. meter). */
export const kiAntwort = (e, extra = {}) => ({ status: 503, body: { error: KI_FEHLER, grund: e.grund, ...extra } });

// Keine Schluessel, Tokens oder Passwoerter in einer Mail: was danach aussieht, wird ersetzt.
const ohneGeheimes = (s) => String(s || '').replace(/sk-[A-Za-z0-9_-]{8,}/g, '[entfernt]').replace(/[A-Za-z0-9_-]{40,}/g, '[entfernt]');

/** SMTP-Konfiguration aus der Umgebung; das Passwort nur aus der Datei SMTP_PASS_FILE. -> { cfg } | { fehlt } */
export function smtpAusEnv(env, lesen = (f) => readFileSync(f, 'utf8')) {
  const an = String(env.OPS_ALERT_MAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!an.length) return { fehlt: 'OPS_ALERT_MAIL' };
  if (an.some((a) => !/^[^\s@<>]+@[^\s@<>]+$/.test(a))) return { fehlt: 'OPS_ALERT_MAIL (keine gueltige Adresse)' };
  if (!env.SMTP_PASS_FILE) return { fehlt: 'SMTP_PASS_FILE' };
  let pass = '';
  try { pass = String(lesen(env.SMTP_PASS_FILE)).replace(/\r?\n$/, ''); } catch { return { fehlt: 'SMTP_PASS_FILE (nicht lesbar)' }; }
  if (!pass) return { fehlt: 'SMTP_PASS_FILE (leer)' };
  const von = String(env.SMTP_FROM || 'no-reply@bunsenbrenner.org');
  return { cfg: { host: String(env.SMTP_HOST || 'smtp.strato.de'), port: Number(env.SMTP_PORT) || 465, user: String(env.SMTP_USER || von), pass, from: von, to: an } };
}

/**
 * Zustand und Betreiber-Warnung. env: OPS_ALERT_MAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_FROM, SMTP_PASS_FILE.
 * send(cfg, { subject, text }) -> Promise (Standard: lib/smtp-mail.mjs). drosselMs: je Klasse (Standard 1 h).
 * -> { melde(klasse, info) -> Promise, ok(), status() -> { ok, klasse, at } }
 */
export function createKiWaechter({ env = process.env, log = (o) => console.log(JSON.stringify(o)), now = () => Date.now(), send = sendMail, drosselMs = DROSSEL_MS, lesen, dienst = 'My Daily Idea' } = {}) {
  const smtp = smtpAusEnv(env, lesen);
  const gesendet = new Map();   // Klasse -> Zeitpunkt der letzten Mail (oder des letzten Versuchs, siehe unten)
  let letzte = null, offen = false;
  if (smtp.fehlt) log({ level: 'WARN', event: 'ki-alarm-config', note: `Betreiber-Warnung per Mail aus: ${smtp.fehlt} fehlt. Ein KI-Ausfall steht dann nur im Log und in /api/status.` });

  /** Ein KI-Fehler der Klasse. info: { provider, model, status, apiTyp, apiText } (der Text nur in die Mail, nie ins Log). */
  async function melde(klasse, info = {}) {
    if (!KLASSEN.includes(klasse)) return { mail: 'keine-klasse' };
    const t = now();
    letzte = { klasse, at: new Date(t).toISOString() }; offen = true;
    const zuletzt = gesendet.get(klasse);
    const gedrosselt = zuletzt !== undefined && t - zuletzt < drosselMs;
    const ereignis = { event: 'ki-ausfall', klasse, provider: info.provider || '', model: info.model || '', status: Number(info.status) || 0, typ: String(info.apiTyp || '').slice(0, 60) };
    if (smtp.fehlt) { log({ level: 'WARN', ...ereignis, mail: 'aus', note: `keine Mail an den Betreiber: ${smtp.fehlt} fehlt` }); return { mail: 'aus' }; }
    if (gedrosselt) { log({ level: 'WARN', ...ereignis, mail: 'gedrosselt' }); return { mail: 'gedrosselt' }; }
    gesendet.set(klasse, t);
    log({ level: 'WARN', ...ereignis, mail: 'senden' });
    const subject = `[${dienst}] KI nicht verfügbar: ${klasse}`;
    const text = [
      `${dienst}: die KI antwortet nicht. Nutzer sehen "Die KI ist gerade nicht erreichbar"; nichts wird abgebucht.`,
      '',
      `Klasse:   ${klasse}`,
      `Zeit:     ${letzte.at}`,
      `Anbieter: ${info.provider || '-'} / ${info.model || '-'}`,
      `HTTP:     ${Number(info.status) || '- (Netz oder Zeitueberschreitung)'}`,
      `Typ:      ${String(info.apiTyp || '-').slice(0, 60)}`,
      `Meldung:  ${ohneGeheimes(info.apiText).slice(0, 300) || '-'}`,
      '',
      `Weitere Fehler dieser Klasse melden sich fruehestens in ${Math.round(drosselMs / 60000)} Minuten wieder per Mail; jeder steht im Log (event ki-ausfall).`,
      'Zustand: GET /api/status, Feld ki.',
    ].join('\n');
    try { await send(smtp.cfg, { subject, text }); log({ event: 'ki-alarm-mail', klasse, ok: true }); return { mail: 'gesendet' }; }
    catch (e) {
      // die Mail ist nicht raus: der naechste Fehler dieser Klasse versucht es nach 10 Minuten wieder, nicht erst nach einer Stunde
      gesendet.set(klasse, t - drosselMs + Math.min(drosselMs, 600000));
      log({ level: 'WARN', event: 'ki-alarm-mail', klasse, ok: false, why: String(e && e.message || e).slice(0, 120) });
      return { mail: 'fehler' };
    }
  }
  /** Eine Antwort des Modells kam an: der Zustand ist wieder ok (die letzte Stoerung bleibt mit Klasse und Zeit sichtbar). */
  function ok() { offen = false; }
  /** Fuer /api/status: nur Klasse und Zeitpunkt, keine Details. */
  function status() { return { ok: !offen, klasse: letzte ? letzte.klasse : null, at: letzte ? letzte.at : null }; }
  return { melde, ok, status, mailAn: !smtp.fehlt };
}
