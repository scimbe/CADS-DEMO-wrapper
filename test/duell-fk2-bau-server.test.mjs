// Integration (Hotfix fix/fk2-bau-ohne-ipheader): der echte server.mjs mit DUELL_BAU=on und LEEREM DUELL_IP_HEADER wie in
// Produktion. Der oeffentliche Port antwortet auf /api/intern/* immer 404, gleich mit welchen Kopfzeilen; /api/intern/fk2/*
// gibt es nur auf DUELL_BAU_PORT, und dort nur aus DUELL_BAU_NETZ (Quell-Adresse des Sockets) mit Token.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'bau-token-1234567890abcdef';
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const procs = [];
after(() => { for (const p of procs) p.kill(); });

async function starte(netz) {
  const dir = mkdtempSync(join(tmpdir(), 'fk2-srv-')), port = await freePort(), bauPort = await freePort();
  writeFileSync(join(dir, 'token'), TOKEN + '\n');
  const env = {
    PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1',
    DUELL_KLAERUNG: 'on', DUELL_KLAERUNG_DIR: join(dir, 'auftraege'),
    DUELL_BAU: 'on', DUELL_BAU_TOKEN_FILE: join(dir, 'token'), DUELL_BAU_PORT: String(bauPort), DUELL_BAU_NETZ: netz,
    DUELL_SPIEL_ORIGIN: 'https://spiel-f29c55da.bunsenbrenner.org', DUELL_SPIEL_MODULE_DIR: join(dir, 'spiele'),
    DUELL_APP_URL: 'https://demos-34a13a96.bunsenbrenner.org/duell', DUELL_IP_HEADER: '',
  };
  const proc = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(proc);
  let out = '';
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start: ' + out)), 10000);
    proc.stdout.on('data', (b) => { out += b; if (out.includes('wrapper on') && out.includes('build queue on')) { clearTimeout(to); resolve(); } });
    proc.on('exit', (c) => reject(new Error('server exited ' + c + ' ' + out)));
  });
  return { pub: `http://127.0.0.1:${port}`, bau: `http://127.0.0.1:${bauPort}`, out: () => out };
}
const KOPF = [{}, { 'x-real-ip': '127.0.0.1' }, { 'x-forwarded-for': '172.31.250.5' }, { 'x-real-ip': '172.31.250.5', forwarded: 'for=172.31.250.5' }, { 'cf-connecting-ip': '10.0.0.1' }];
const holen = (base, h = {}) => fetch(base + '/api/intern/fk2/holen', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: '{}' });

test('oeffentlicher Port: /api/intern/* immer 404, mit und ohne beliebige Kopfzeilen; Bau-Port aus fremdem Netz abgelehnt', async () => {
  const s = await starte('172.31.250.0/28');   // der Test kommt von 127.0.0.1: fremdes Netz
  assert.doesNotMatch(s.out(), /build off/, 'der Bau ist an, obwohl DUELL_IP_HEADER leer ist');
  for (const h of KOPF) {
    for (const auth of [{}, { authorization: 'Bearer ' + TOKEN }]) {
      assert.equal((await holen(s.pub, { ...h, ...auth })).status, 404, 'oeffentlich ' + JSON.stringify({ ...h, ...auth }));
      assert.equal((await fetch(s.pub + '/api/intern/irgendwas', { headers: { ...h, ...auth } })).status, 404);
      assert.equal((await holen(s.bau, { ...h, ...auth })).status, 404, 'Bau-Port aus fremdem Netz ' + JSON.stringify({ ...h, ...auth }));
    }
  }
  assert.notEqual((await fetch(s.pub + '/api/duell/klaerung/an', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404, 'der oeffentliche Port arbeitet sonst normal');
});

test('Bau-Port aus DUELL_BAU_NETZ: ohne Token 401, mit Token 204; der oeffentliche Port antwortet diesem Netz gar nicht', async () => {
  const s = await starte('127.0.0.0/8');   // hier ist 127.0.0.1 das Netz des Workers
  assert.equal((await holen(s.bau)).status, 401, 'ohne Token');
  assert.equal((await holen(s.bau, { authorization: 'Bearer falsch-falsch-falsch-falsch' })).status, 401, 'falsches Token');
  assert.equal((await holen(s.bau, { authorization: 'Bearer ' + TOKEN })).status, 204, 'mit Token: nichts wartet');
  assert.equal((await fetch(s.bau + '/duell')).status, 404, 'der Bau-Port kennt nur /api/intern/fk2/*');
  assert.equal((await holen(s.pub, { authorization: 'Bearer ' + TOKEN })).status, 404);
  assert.equal((await fetch(s.pub + '/api/duell/klaerung/an', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404, 'aus dem Netz des Workers antwortet der oeffentliche Port nichts');
});
