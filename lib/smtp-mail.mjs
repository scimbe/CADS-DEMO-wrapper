// Eine Mail per SMTP mit TLS ab dem ersten Byte (Port 465, z. B. smtp.strato.de), ohne Abhaengigkeit: EHLO, AUTH PLAIN,
// MAIL FROM, RCPT TO, DATA, QUIT (RFC 5321, RFC 4616, RFC 8314). Das Passwort geht nur in AUTH an den Server und steht nie
// in einer Fehlermeldung. Text und Betreff als UTF-8 (Betreff RFC 2047, Text base64).
//
//   sendMail({ host, port, user, pass, from, to: [..] }, { subject, text }, { connect?, timeoutMs? }) -> Promise<void>
//   connect: (opts, onConnect) -> Socket; Standard tls.connect mit Pruefung des Zertifikats (Tests: net.connect)

import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const zeilen = (s, n = 76) => s.match(new RegExp(`.{1,${n}}`, 'g')) || [''];
const kopf = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const adresse = (a) => { const s = String(a || ''); if (!/^[^\s@<>]+@[^\s@<>]+$/.test(s)) throw new Error('smtp: ungueltige Adresse'); return s; };

/** Die Nachricht als Text (Kopf + base64-Rumpf, CRLF). */
export function nachricht({ from, to, subject, text, date = new Date(), id = randomBytes(12).toString('hex') }) {
  const dom = String(from).split('@')[1] || 'localhost';
  return [
    `From: ${from}`, `To: ${to.join(', ')}`, `Subject: ${kopf(subject)}`, `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@${dom}>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64',
    '', ...zeilen(b64(text)), '',
  ].join('\r\n');
}

export function sendMail(cfg, mail, { connect = (o, cb) => tls.connect({ host: o.host, port: o.port, servername: o.host, minVersion: 'TLSv1.2' }, cb), timeoutMs = 20000 } = {}) {
  const from = adresse(cfg.from), to = (cfg.to || []).map(adresse);
  if (!to.length) return Promise.reject(new Error('smtp: kein Empfaenger'));
  const data = nachricht({ from, to, subject: mail.subject, text: mail.text }).replace(/^\./gm, '..');   // Punkt am Zeilenanfang verdoppeln
  return new Promise((resolve, reject) => {
    let buf = '', warte = null, fertig = false;
    const sock = connect({ host: cfg.host, port: cfg.port }, () => {});
    const ende = (e) => { if (fertig) return; fertig = true; clearTimeout(uhr); try { sock.destroy(); } catch { /* schon zu */ } if (e) reject(e); else resolve(); };
    const uhr = setTimeout(() => ende(new Error('smtp: Zeitueberschreitung')), timeoutMs);
    if (uhr.unref) uhr.unref();
    sock.setEncoding('utf8');
    sock.on('error', (e) => ende(new Error('smtp: ' + (e && e.code ? e.code : 'Verbindungsfehler'))));
    sock.on('close', () => ende(new Error('smtp: Verbindung geschlossen')));
    // eine vollstaendige Antwort: letzte Zeile "NNN " (mehrzeilig "NNN-...")
    sock.on('data', (d) => {
      buf += d;
      const z = buf.split('\r\n'); if (z.length < 2) return;
      const ganz = z.slice(0, -1), letzte = ganz[ganz.length - 1];
      if (!/^\d{3} /.test(letzte) && !/^\d{3}$/.test(letzte)) return;
      buf = z[z.length - 1];
      const w = warte; warte = null;
      if (w) w(Number(letzte.slice(0, 3)));
    });
    const antwort = () => new Promise((ok) => { warte = ok; });
    const schritt = async (zeile, erwartet, name) => {
      if (zeile !== null) sock.write(zeile + '\r\n');
      const code = await antwort();
      if (!erwartet.includes(code)) throw new Error(`smtp: ${name} abgelehnt (${code})`);   // nie die Zeile selbst: AUTH traegt das Passwort
    };
    (async () => {
      await schritt(null, [220], 'Begruessung');
      await schritt('EHLO ' + (from.split('@')[1] || 'localhost'), [250], 'EHLO');
      await schritt('AUTH PLAIN ' + b64('\0' + cfg.user + '\0' + cfg.pass), [235], 'AUTH');
      await schritt(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
      for (const a of to) await schritt(`RCPT TO:<${a}>`, [250, 251], 'RCPT TO');
      await schritt('DATA', [354], 'DATA');
      await schritt(data + '\r\n.', [250], 'Nachricht');
      sock.write('QUIT\r\n');
      ende();
    })().catch(ende);
  });
}
