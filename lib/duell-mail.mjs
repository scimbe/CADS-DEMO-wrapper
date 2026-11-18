// My Daily Idea, "Freie Karte 2" P4: e-mail "Karte fertig" over SMTP with implicit TLS (SMTPS, port 465). Only for an order
// whose person ticked "E-Mail an dein Konto" on the build screen (lib/duell-fk2-bau.mjs decides when; this module only sends).
//
// Configuration (environment; on ssh-united from ~/demos-wrapper-secrets/smtp.env via --env-file):
//   SMTP_HOST        smtp.strato.de
//   SMTP_PORT        465 (implicit TLS; nothing else is supported: no STARTTLS, no plain text)
//   SMTP_SECURE      ssl
//   SMTP_USER        the login (no-reply@bunsenbrenner.org)
//   SMTP_FROM        no-reply@bunsenbrenner.org          SMTP_FROM_NAME  bunsenbrenner
//   SMTP_PASS_FILE   /run/secrets/smtp.pass (read-only mount); read at each send, never logged, never in an error text
// Missing or invalid values switch mail off (on() false); the build screen then does not offer it (nothing is offered that
// does not exist). The log has outcome and SMTP reply code only, never an address, a subject or the password.
//
// The client is minimal and strict: EHLO, AUTH PLAIN (LOGIN as fallback when the server offers only that), MAIL FROM,
// RCPT TO, DATA with a dot-stuffed UTF-8 text body (quoted-printable), QUIT. Every reply is checked; a wrong code ends the
// session with an error that carries the code. connect() is injectable (tests use an SMTP double over plain TCP).
import { readFileSync } from 'node:fs';
import { connect as tlsConnect } from 'node:tls';
import { randomBytes } from 'node:crypto';

const MAIL_RE = /^[^\s@<>"(),;:\\]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;
export const SMTP_TIMEOUT_MS = 20000;

export function mailConfig(env = process.env) {
  return {
    host: String(env.SMTP_HOST || ''), port: Number(env.SMTP_PORT || 0), secure: String(env.SMTP_SECURE || '').toLowerCase(),
    user: String(env.SMTP_USER || ''), from: String(env.SMTP_FROM || ''), fromName: String(env.SMTP_FROM_NAME || ''), passFile: String(env.SMTP_PASS_FILE || ''),
  };
}
/** problems with the configuration (empty = usable) */
export function mailProblems(c) {
  const out = [];
  if (!/^[A-Za-z0-9.-]+$/.test(c.host)) out.push('SMTP_HOST');
  if (c.port !== 465) out.push('SMTP_PORT (only 465)');
  if (c.secure !== 'ssl' && c.secure !== 'tls') out.push('SMTP_SECURE (ssl)');
  if (!c.user) out.push('SMTP_USER');
  if (!MAIL_RE.test(c.from)) out.push('SMTP_FROM');
  if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(c.fromName)) out.push('SMTP_FROM_NAME');
  if (!c.passFile) out.push('SMTP_PASS_FILE');
  return out;
}
export const isMail = (s) => typeof s === 'string' && s.length <= 254 && MAIL_RE.test(s);

/** RFC 2047 for a header word that is not plain ASCII */
const word = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
/** quoted-printable (RFC 2045), lines <= 76, CRLF */
export function qp(text) {
  const out = [];
  for (const raw of String(text).replace(/\r?\n/g, '\n').split('\n')) {
    let enc = '';
    for (const b of Buffer.from(raw, 'utf8')) enc += (b >= 33 && b <= 126 && b !== 61) || b === 32 ? String.fromCharCode(b) : '=' + b.toString(16).toUpperCase().padStart(2, '0');
    enc = enc.replace(/ $/, '=20');
    let line = '';
    for (let i = 0; i < enc.length;) {
      const step = enc[i] === '=' ? 3 : 1;
      if (line.length + step > 75) { out.push(line + '='); line = ''; }
      line += enc.slice(i, i + step); i += step;
    }
    out.push(line);
  }
  return out.join('\r\n');
}
/** the full message (headers + body), dot-stuffed for DATA */
export function message({ fromName, from, to, subject, text, now = Date.now(), id = randomBytes(12).toString('hex') }) {
  const domain = from.split('@')[1];
  const head = [
    `From: ${word(fromName)} <${from}>`, `To: <${to}>`, `Subject: ${word(subject)}`, `Date: ${new Date(now).toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@${domain}>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable',
    'Auto-Submitted: auto-generated',
  ];
  return (head.join('\r\n') + '\r\n\r\n' + qp(text)).split('\r\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
}

/** one SMTP conversation over a connected socket */
async function converse(socket, steps, timeoutMs) {
  let buf = '';
  const waiters = [];
  const fail = (e) => { while (waiters.length) waiters.shift().no(e); };
  socket.setEncoding('utf8');
  socket.on('data', (d) => {
    buf += d;
    // a reply is complete with a line "ddd " (the last line of a multi-line reply has a space after the code)
    for (;;) {
      const m = buf.match(/^((?:\d{3}-[^\r\n]*\r\n)*\d{3} [^\r\n]*\r\n)/);
      if (!m) break;
      buf = buf.slice(m[1].length);
      const lines = m[1].trim().split('\r\n');
      const w = waiters.shift();
      if (w) w.ok({ code: Number(lines[lines.length - 1].slice(0, 3)), lines });
    }
  });
  socket.on('error', fail);
  socket.on('close', () => fail(Object.assign(new Error('smtp: connection closed'), { code: 'closed' })));
  const reply = () => new Promise((ok, no) => {
    const t = setTimeout(() => no(Object.assign(new Error('smtp: timeout'), { code: 'timeout' })), timeoutMs);
    waiters.push({ ok: (r) => { clearTimeout(t); ok(r); }, no: (e) => { clearTimeout(t); no(e); } });
  });
  const expect = async (want, what) => {
    const r = await reply();
    if (!want.includes(r.code)) throw Object.assign(new Error(`smtp: ${what} answered ${r.code}`), { code: 'smtp-' + r.code });
    return r;
  };
  return steps({ send: (line) => socket.write(line + '\r\n'), expect, reply });
}

/**
 * @param {{env?:object, connect?:(o:{host:string,port:number,servername:string}) => import('node:net').Socket, log?:(o:object)=>void, now?:() => number, timeoutMs?:number}} o
 */
export function createMail({ env = process.env, connect, log = (x) => console.log(JSON.stringify(x)), now = () => Date.now(), timeoutMs = SMTP_TIMEOUT_MS } = {}) {
  const cfg = mailConfig(env);
  const problems = mailProblems(cfg);
  if (problems.length && (cfg.host || cfg.user || cfg.passFile)) log({ event: 'duell-mail-config', note: 'mail off, check ' + problems.join(', ') });
  const open = connect || ((o) => tlsConnect({ host: o.host, port: o.port, servername: o.servername, minVersion: 'TLSv1.2' }));
  const on = () => problems.length === 0;

  /** -> { ok: true } | { ok: false, why } ; never throws, never logs the address */
  async function send({ to, subject, text }) {
    if (!on()) return { ok: false, why: 'off' };
    if (!isMail(to)) return { ok: false, why: 'address' };
    let pass;
    try { pass = readFileSync(cfg.passFile, 'utf8').replace(/\r?\n$/, ''); } catch { log({ event: 'duell-mail', ok: false, why: 'pass-file' }); return { ok: false, why: 'pass-file' }; }
    if (!pass) { log({ event: 'duell-mail', ok: false, why: 'pass-file' }); return { ok: false, why: 'pass-file' }; }
    const t0 = now();
    let socket;
    try {
      socket = open({ host: cfg.host, port: cfg.port, servername: cfg.host });
      await converse(socket, async ({ send: line, expect }) => {
        await expect([220], 'greeting');
        line(`EHLO ${cfg.from.split('@')[1]}`);
        const ehlo = await expect([250], 'EHLO');
        const auth = ehlo.lines.find((l) => /^250[ -]AUTH\b/i.test(l)) || '';
        if (/\bPLAIN\b/i.test(auth)) {
          line('AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${pass}`, 'utf8').toString('base64'));
          await expect([235], 'AUTH');
        } else if (/\bLOGIN\b/i.test(auth)) {
          line('AUTH LOGIN'); await expect([334], 'AUTH');
          line(Buffer.from(cfg.user, 'utf8').toString('base64')); await expect([334], 'AUTH user');
          line(Buffer.from(pass, 'utf8').toString('base64')); await expect([235], 'AUTH');
        } else throw Object.assign(new Error('smtp: no AUTH PLAIN or LOGIN offered'), { code: 'no-auth' });
        line(`MAIL FROM:<${cfg.from}>`); await expect([250], 'MAIL FROM');
        line(`RCPT TO:<${to}>`); await expect([250, 251], 'RCPT TO');
        line('DATA'); await expect([354], 'DATA');
        line(message({ fromName: cfg.fromName, from: cfg.from, to, subject, text, now: now() }) + '\r\n.');
        await expect([250], 'end of DATA');
        line('QUIT');
      }, timeoutMs);
      log({ event: 'duell-mail', ok: true, ms: now() - t0 });
      return { ok: true };
    } catch (e) {
      const why = String(e && e.code || 'error').slice(0, 20);
      log({ event: 'duell-mail', ok: false, why, ms: now() - t0 });
      return { ok: false, why };
    } finally { pass = ''; if (socket) socket.end(); }
  }
  return { on, send, cfg: { host: cfg.host, port: cfg.port, from: cfg.from, fromName: cfg.fromName } };
}
