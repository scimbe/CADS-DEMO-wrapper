// Freie Karte 2, P4 (lib/duell-mail.mjs): SMTP against a double (plain TCP in place of TLS on 465): AUTH PLAIN/LOGIN,
// envelope, headers (sender name, UTF-8), quoted-printable body, dot-stuffing; the password comes only from the file and
// never shows up in the log; an unusable configuration switches mail off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMail, mailConfig, mailProblems, message, qp } from '../lib/duell-mail.mjs';

const PASS = 'geheim-Passwort-123';
function smtpDouble({ auth = 'PLAIN LOGIN', rcptCode = 250 } = {}) {
  const sessions = [];
  const server = net.createServer((sock) => {
    const s = { lines: [], data: '' }; sessions.push(s);
    let inData = false, buf = '', step = 0;
    sock.write('220 smtp.double ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else s.data += line + '\r\n'; continue; }
        s.lines.push(line);
        if (/^EHLO /.test(line)) sock.write(`250-smtp.double\r\n250-AUTH ${auth}\r\n250 8BITMIME\r\n`);
        else if (/^AUTH PLAIN /.test(line)) sock.write(Buffer.from(line.slice(11), 'base64').toString() === `\0no-reply@bunsenbrenner.org\0${PASS}` ? '235 ok\r\n' : '535 no\r\n');
        else if (line === 'AUTH LOGIN') { step = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (step === 1) { step = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
        else if (step === 2) { step = 0; sock.write(Buffer.from(line, 'base64').toString() === PASS ? '235 ok\r\n' : '535 no\r\n'); }
        else if (/^MAIL FROM:/.test(line)) sock.write('250 ok\r\n');
        else if (/^RCPT TO:/.test(line)) sock.write(`${rcptCode} ${rcptCode === 250 ? 'ok' : 'no such user'}\r\n`);
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      }
    });
  });
  return { server, sessions };
}
function env(dir, over = {}) {
  writeFileSync(join(dir, 'smtp.pass'), PASS + '\n');
  return { SMTP_HOST: 'smtp.strato.de', SMTP_PORT: '465', SMTP_SECURE: 'ssl', SMTP_USER: 'no-reply@bunsenbrenner.org', SMTP_FROM: 'no-reply@bunsenbrenner.org', SMTP_FROM_NAME: 'bunsenbrenner', SMTP_PASS_FILE: join(dir, 'smtp.pass'), ...over };
}

test('SMTP: AUTH PLAIN und LOGIN, Umschlag, Kopfzeilen, Text; Passwort nur aus der Datei und nie im Log', async () => {
  for (const auth of ['PLAIN LOGIN', 'LOGIN']) {
    const { server, sessions } = smtpDouble({ auth });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const dir = mkdtempSync(join(tmpdir(), 'mail-')), logs = [], opened = [];
    const mail = createMail({ env: env(dir), log: (o) => logs.push(o), connect: (o) => { opened.push(o); return net.connect(server.address().port, '127.0.0.1'); } });
    try {
      assert.equal(mail.on(), true);
      const r = await mail.send({ to: 'lea@example.org', subject: 'Deine Karte ist fast fertig', text: 'Hallo,\n\n„Boot“ – ein Punkt fehlt.\n.\nLink: https://x.example/duell?go=fertig&auftrag=AAA' });
      assert.deepEqual(r, { ok: true });
      assert.deepEqual(opened, [{ host: 'smtp.strato.de', port: 465, servername: 'smtp.strato.de' }]);
      const s = sessions[0];
      assert.ok(s.lines.includes('MAIL FROM:<no-reply@bunsenbrenner.org>') && s.lines.includes('RCPT TO:<lea@example.org>'));
      assert.match(s.data, /^From: bunsenbrenner <no-reply@bunsenbrenner\.org>\r\n/m);
      assert.match(s.data, /^Subject: Deine Karte ist fast fertig\r\n/m);
      assert.match(s.data, /^Content-Type: text\/plain; charset=UTF-8\r\n/m);
      assert.match(s.data, /^Auto-Submitted: auto-generated\r\n/m);
      assert.match(s.data, /=E2=80=9EBoot=E2=80=9C/, 'quoted-printable UTF-8');
      assert.match(s.data, /\r\n\.\.\r\n/, 'a line with a single dot is stuffed');
      assert.ok(!JSON.stringify(logs).includes(PASS) && !JSON.stringify(logs).includes('lea@example.org'), 'no password, no address in the log');
      assert.deepEqual(logs.map((l) => l.ok), [true]);
    } finally { server.close(); }
  }
});

test('SMTP: Ablehnung ehrlich mit Code, Konfiguration streng (nur 465/SSL), fehlende Passwortdatei, keine Adresse ohne @', async () => {
  const { server } = smtpDouble({ rcptCode: 550 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'mail-')), logs = [];
  try {
    const mail = createMail({ env: env(dir), log: (o) => logs.push(o), connect: () => net.connect(server.address().port, '127.0.0.1') });
    assert.deepEqual(await mail.send({ to: 'weg@example.org', subject: 'x', text: 'y' }), { ok: false, why: 'smtp-550' });
    assert.deepEqual(await mail.send({ to: 'keine-adresse', subject: 'x', text: 'y' }), { ok: false, why: 'address' });
    const ohne = createMail({ env: { ...env(dir), SMTP_PASS_FILE: join(dir, 'fehlt.pass') }, log: (o) => logs.push(o), connect: () => net.connect(server.address().port, '127.0.0.1') });
    assert.deepEqual(await ohne.send({ to: 'lea@example.org', subject: 'x', text: 'y' }), { ok: false, why: 'pass-file' });
  } finally { server.close(); }
  assert.deepEqual(mailProblems(mailConfig(env(dir, { SMTP_PORT: '587' }))), ['SMTP_PORT (only 465)']);
  assert.deepEqual(mailProblems(mailConfig(env(dir, { SMTP_SECURE: 'starttls' }))), ['SMTP_SECURE (ssl)']);
  const off = createMail({ env: {}, log: () => {} });
  assert.equal(off.on(), false);
  assert.deepEqual(await off.send({ to: 'lea@example.org', subject: 'x', text: 'y' }), { ok: false, why: 'off' });
  assert.ok(qp('x'.repeat(200)).split('\r\n').every((l) => l.length <= 76));
  assert.match(message({ fromName: 'bunsenbrenner', from: 'no-reply@bunsenbrenner.org', to: 'a@b.de', subject: 'Größe', text: 't', now: 0, id: 'i' }), /Subject: =\?UTF-8\?B\?R3LDtsOfZQ==\?=/);
});
