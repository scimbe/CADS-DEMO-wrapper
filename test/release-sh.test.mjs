// deploy/fk2-p34/release.sh (Delta-Review 4): der Rollback ist wiederholbar und nimmt auch einen abgebrochenen Release ganz
// zurueck; der Release prueft vorher, was es schon gibt (Container -> Abbruch, Netze nur passend weiter); ist die PID kein
// ct-agent, bricht er ab, statt start-on-boot.sh aufzurufen. Ohne Docker und ohne Host: docker, ss, curl, sha256sum und kill
// sind Doubles auf PATH, /proc ist ein Ordner (PROC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SKRIPT = resolve('deploy/fk2-p34/release.sh');
const SOLL = readFileSync(resolve('deploy/fk2-p34/chromium-seccomp.sha256'), 'utf8').split(/\s+/)[0];

// docker-Double: Zustand in state.json, jeder Aufruf in calls.log
const DOCKER = `#!/usr/bin/env node
const fs = require('fs'), f = process.env.DOCKER_STATE, st = JSON.parse(fs.readFileSync(f, 'utf8'));
const a = process.argv.slice(2), save = () => fs.writeFileSync(f, JSON.stringify(st));
fs.appendFileSync(process.env.DOCKER_LOG, a.join(' ') + '\\n');
const fmt = a.includes('-f') ? a[a.indexOf('-f') + 1] : '', last = a[a.length - 1];
const out = (s) => { process.stdout.write(s + '\\n'); process.exit(0); };
if (a[0] === 'container' && a[1] === 'inspect') process.exit(st.containers.includes(last) ? 0 : 1);
if (a[0] === 'network' && a[1] === 'inspect') {
  const n = st.networks[last]; if (!n) process.exit(1);
  if (fmt.includes('Internal')) out(String(n.internal));
  if (fmt.includes('Subnet')) out(n.subnet + ' ');
  if (fmt.includes('Containers')) out(n.containers.join(' ') + ' ');
  out('{}');
}
if (a[0] === 'rm') { for (const c of a.slice(2)) { if (!st.containers.includes(c)) process.exit(1); st.containers = st.containers.filter((x) => x !== c); } save(); process.exit(0); }
if (a[0] === 'network' && a[1] === 'rm') { for (const n of a.slice(2)) { if (!st.networks[n]) process.exit(1); delete st.networks[n]; } save(); process.exit(0); }
if (a[0] === 'network' && a[1] === 'disconnect') { const n = st.networks[a[2]]; if (!n || !n.containers.includes(a[3])) process.exit(1); n.containers = n.containers.filter((x) => x !== a[3]); save(); process.exit(0); }
if (a[0] === 'network' && a[1] === 'connect') { const n = st.networks[a[a.length - 2]]; if (!n) process.exit(1); n.containers.push(last); save(); process.exit(0); }
if (a[0] === 'network' && a[1] === 'create') { if (st.networks[last]) process.exit(1); st.networks[last] = { internal: a.includes('--internal'), subnet: a.includes('--subnet') ? a[a.indexOf('--subnet') + 1] : '172.18.0.0/16', containers: [] }; save(); process.exit(0); }
// Einmal-Container (--rm) fuer das Volume des Bau-Workers: chown setzt den Eigentuemer (ausser chownWirkt=false), der
// Schreibtest gelingt nur als dieser Eigentuemer
if (a[0] === 'run' && a.includes('--rm')) {
  if (a.includes('chown')) { if (st.chownWirkt !== false) st.volOwner = a[a.indexOf('chown') + 2]; save(); process.exit(0); }
  if (a.includes('sh')) process.exit(st.volOwner === a[a.indexOf('--user') + 1] ? 0 : 1);
  process.exit(0);
}
if (a[0] === 'run') { const name = a[a.indexOf('--name') + 1]; if (st.containers.includes(name)) process.exit(1); st.containers.push(name); if (a.includes('--network')) st.networks[a[a.indexOf('--network') + 1]].containers.push(name); save(); process.exit(0); }
if (a[0] === 'exec' && a[2] === 'printenv') { const v = st.env[a[3]]; if (v === undefined) process.exit(1); out(v); }
process.exit(0);   // build, volume create
`;

function umgebung({ alsRoot = false, chownWirkt = true, containers = [], networks = {}, origin = '127.0.0.1:8794', agentLaeuft = true, cmdline = 'node /opt/ct-agent/index.js' } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'release-sh-')), bin = join(d, 'bin'), proc = join(d, 'proc'), agent = join(d, 'spiel-agent'), secrets = join(d, 'secrets');
  for (const x of [bin, proc, join(agent, 'state'), secrets]) mkdirSync(x, { recursive: true });
  const stub = (n, body) => { writeFileSync(join(bin, n), body); chmodSync(join(bin, n), 0o755); };
  stub('docker', DOCKER);
  stub('ss', '#!/bin/sh\nexit 0\n');
  if (alsRoot) stub('id', '#!/bin/sh\necho 0\n');
  stub('curl', '#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = -o ]; then echo "{}" > "$2"; fi; shift; done\n');
  stub('sha256sum', `#!/bin/sh\necho "${SOLL}  $1"\n`);
  // kill-Double: der Prozess endet (sein /proc-Ordner verschwindet)
  stub('kill', `#!/bin/sh\nrm -rf "${proc}/$1"\necho "$1" >> "${d}/killed"\n`);
  writeFileSync(join(agent, '.env'), `CT_AGENT_TOKEN=x\nCT_AGENT_ORIGIN=${origin}\n`);
  writeFileSync(join(agent, 'start-on-boot.sh'), `#!/bin/sh\necho gestartet >> "${d}/started"\nmkdir -p "${proc}/4242" && printf 'node\\0/opt/ct-agent/index.js' > "${proc}/4242/cmdline"\necho 4242 > "${agent}/state/ct-agent.pid"\n`);
  chmodSync(join(agent, 'start-on-boot.sh'), 0o755);
  writeFileSync(join(agent, 'state', 'ct-agent.pid'), '1111\n');
  if (agentLaeuft) { mkdirSync(join(proc, '1111')); writeFileSync(join(proc, '1111', 'cmdline'), cmdline.replace(/ /g, '\0')); }
  writeFileSync(join(secrets, 'fk2-bau.token'), 'token\n');
  const state = join(d, 'state.json');
  // DUELL_IP_HEADER wie in Produktion nicht gesetzt
  writeFileSync(state, JSON.stringify({ chownWirkt, volOwner: '0:0', containers, networks, env: { DUELL_BAU: 'on', DUELL_BAU_NETZ: '172.31.250.0/28' } }));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_STATE: state, DOCKER_LOG: join(d, 'calls.log'), PROC: proc, KILL: join(bin, 'kill'),
    SECRETS: secrets, SPIEL_AGENT: agent, SECCOMP: join(d, 'mdi-bau', 'seccomp.json'), APP_SRC: d, HOME: d };
  const run = (...args) => {
    writeFileSync(env.DOCKER_LOG, '');
    const r = spawnSync('bash', [SKRIPT, 'fk2-test', ...args], { env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr, calls: readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n').filter(Boolean) };
  };
  const zustand = () => JSON.parse(readFileSync(state, 'utf8'));
  const origin_ = () => /CT_AGENT_ORIGIN=(.*)/.exec(readFileSync(join(agent, '.env'), 'utf8'))[1];
  return { run, zustand, origin: origin_, gestartet: () => existsSync(join(d, 'started')) };
}
const veraendert = (calls) => calls.filter((c) => /^(rm |network (rm|disconnect|create|connect) |run )/.test(c));

test('Rollback: ohne etwas Vorhandenes und ein zweites Mal hintereinander laeuft er sauber durch und aendert nichts', () => {
  const u = umgebung();
  for (let i = 0; i < 2; i++) {
    const r = u.run('--rollback', '--ausfuehren');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(veraendert(r.calls), []);
    assert.match(r.out, /spiel-agent steht schon auf 127\.0\.0\.1:8794/);
  }
  assert.equal(u.gestartet(), false);
});

test('Rollback nach abgebrochenem Release: nimmt genau das Vorhandene zurueck, danach ist er wiederholbar', () => {
  const u = umgebung({ containers: ['mdi-bau', 'mdi-spiel-dienst', 'demos-wrapper'], origin: '127.0.0.1:8795',
    networks: { 'mdi-bau-net': { internal: true, subnet: '172.31.250.0/28', containers: ['demos-wrapper', 'mdi-bau'] } } });
  let r = u.run('--rollback', '--ausfuehren');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(veraendert(r.calls), ['rm -f mdi-bau', 'rm -f mdi-spiel-dienst', 'network disconnect mdi-bau-net demos-wrapper', 'network rm mdi-bau-net']);
  assert.deepEqual(u.zustand().containers, ['demos-wrapper']);
  assert.deepEqual(u.zustand().networks, {});
  assert.equal(u.origin(), '127.0.0.1:8794'); assert.equal(u.gestartet(), true);
  r = u.run('--rollback', '--ausfuehren');
  assert.equal(r.code, 0, r.out); assert.deepEqual(veraendert(r.calls), []);
});

test('Release: auf leerem Stand legt er alles an; ein zweiter Release bricht klar ab, weil die Container schon da sind', () => {
  const u = umgebung({ containers: ['demos-wrapper'] });
  let r = u.run('--ausfuehren', '--double');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(Object.keys(u.zustand().networks).sort(), ['mdi-bau-net', 'mdi-egress-net', 'mdi-pruef-net']);
  assert.ok(u.zustand().networks['mdi-bau-net'].containers.includes('demos-wrapper'));
  assert.equal(u.origin(), '127.0.0.1:8795');
  assert.doesNotMatch(r.out, /DUELL_IP_HEADER/, 'kein Check mehr auf DUELL_IP_HEADER (Hotfix)');
  r = u.run('--ausfuehren', '--double');
  assert.equal(r.code, 1);
  assert.match(r.out, /Container mdi-bau gibt es schon \(erst .*--rollback/);
  assert.deepEqual(veraendert(r.calls), [], 'nichts angelegt');
});

test('Release: ein vorhandenes Netz wird nur passend weiterverwendet, sonst Abbruch; ein schon angehaengter Wrapper bleibt', () => {
  const falsch = umgebung({ containers: ['demos-wrapper'], networks: { 'mdi-bau-net': { internal: false, subnet: '172.31.250.0/28', containers: [] } } });
  let r = falsch.run('--ausfuehren', '--double');
  assert.equal(r.code, 1);
  assert.match(r.out, /ABBRUCH: Netz mdi-bau-net gibt es schon mit internal=false/);
  assert.ok(!r.calls.some((c) => c.startsWith('run -d ')), 'kein Dienst gestartet (nur die Einmal-Container fuer das Volume)');
  const passt = umgebung({ containers: ['demos-wrapper'], networks: { 'mdi-bau-net': { internal: true, subnet: '172.31.250.0/28', containers: ['demos-wrapper'] } } });
  r = passt.run('--ausfuehren', '--double');
  assert.equal(r.code, 0, r.out);
  assert.ok(!r.calls.some((c) => c.startsWith('network create') && c.endsWith('mdi-bau-net')));
  assert.ok(!r.calls.some((c) => c.startsWith('network connect') && c.endsWith('demos-wrapper')));
  assert.match(r.out, /demos-wrapper haengt schon an mdi-bau-net/);
});

test('PID ist kein ct-agent: Release bricht ab statt start-on-boot.sh aufzurufen; .env bleibt; Rollback raeumt trotzdem auf', () => {
  for (const fall of [{ cmdline: 'sleep 1000' }, { agentLaeuft: false }]) {
    const u = umgebung({ containers: ['demos-wrapper'], ...fall });
    const r = u.run('--ausfuehren', '--double');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ABBRUCH: PID '1111' .* ist kein laufender ct-agent/);
    assert.equal(u.gestartet(), false, 'nichts gestartet');
    assert.equal(u.origin(), '127.0.0.1:8794', '.env unveraendert');
    const rb = u.run('--rollback', '--ausfuehren');
    assert.equal(rb.code, 1, 'der Agent braucht Handarbeit, das sagt der Rollback');
    assert.match(rb.out, /Container und Netze sind weg/);
    assert.deepEqual(u.zustand().containers, ['demos-wrapper']); assert.deepEqual(u.zustand().networks, {});
    assert.equal(u.gestartet(), false);
  }
});

test('Trockenlauf: aendert nichts', () => {
  const u = umgebung({ containers: ['demos-wrapper'] });
  const r = u.run('--double');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(veraendert(r.calls), []);
  assert.match(r.out, /Trockenlauf: nichts ausgefuehrt/);
});

const ICH = `${process.getuid()}:${process.getgid()}`;
test('B1 Volume: der Release setzt den Eigentuemer von mdi-bau-state auf den User des Workers und prueft per Schreibtest, bevor ein Dienst laeuft', () => {
  const u = umgebung({ containers: ['demos-wrapper'] });
  const r = u.run('--ausfuehren', '--double');
  assert.equal(r.code, 0, r.out);
  const chown = r.calls.findIndex((c) => c.startsWith('run --rm') && c.includes('--user 0:0') && c.includes(`chown -R ${ICH} /var/lib/mdi-bau`));
  const schreib = r.calls.findIndex((c) => c.startsWith('run --rm') && c.includes(`--user ${ICH}`) && c.includes('sh -c'));
  const ersterDienst = r.calls.findIndex((c) => /^run -d |^network create /.test(c));
  assert.ok(chown >= 0 && schreib > chown && ersterDienst > schreib, r.calls.join('\n'));
  for (const i of [chown, schreib]) for (const f of ['--network none', '--cap-drop ALL', '--read-only', '--security-opt no-new-privileges', '--pids-limit 16', '-v mdi-bau-state:/var/lib/mdi-bau']) assert.ok(r.calls[i].includes(f), f + ' in ' + r.calls[i]);
  const worker = r.calls.find((c) => c.startsWith('run -d --name mdi-bau '));
  assert.ok(worker.includes(`-u ${ICH}`) && worker.includes('-v mdi-bau-state:/var/lib/mdi-bau'), 'the worker runs as the owner of the volume');
  assert.match(r.out, new RegExp(`ok   mdi-bau-state ist fuer ${ICH} beschreibbar`));
  assert.equal(u.zustand().volOwner, ICH);
});

test('B1 Volume: bleibt es root (Schreibtest scheitert), bricht der Release ab: kein Netz, kein Dienst, spiel-agent unveraendert', () => {
  const u = umgebung({ containers: ['demos-wrapper'], chownWirkt: false });
  const r = u.run('--ausfuehren', '--double');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`ABBRUCH: mdi-bau-state ist fuer ${ICH} nicht beschreibbar; kein Dienst gestartet`));
  assert.ok(!r.calls.some((c) => /^run -d |^network (create|connect) /.test(c)), r.calls.join('\n'));
  assert.deepEqual(u.zustand().networks, {}); assert.deepEqual(u.zustand().containers, ['demos-wrapper']);
  assert.equal(u.origin(), '127.0.0.1:8794'); assert.equal(u.gestartet(), false);
});

test('B1 Volume: der Trockenlauf zeigt chown und Schreibtest, fuehrt aber nichts aus', () => {
  const u = umgebung({ containers: ['demos-wrapper'] });
  const r = u.run('--double');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`\\+ docker run --rm --network none --user 0:0 .*chown -R ${ICH} /var/lib/mdi-bau`));
  assert.match(r.out, new RegExp(`\\+ Schreibtest als ${ICH} in mdi-bau-state`));
  assert.ok(!r.calls.some((c) => c.startsWith('run ')));
});

test('B1 Volume: als root bricht der Release vor allem anderen ab (Worker und Volume nie als root)', () => {
  const u = umgebung({ containers: ['demos-wrapper'], alsRoot: true });
  const r = u.run('--ausfuehren', '--double');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FEHLT release\.sh nicht als root ausfuehren/);
  assert.ok(!r.calls.some((c) => /^(run|build|volume|network (create|connect)) /.test(c)), r.calls.join('\n'));
  assert.equal(u.zustand().volOwner, '0:0');
});
