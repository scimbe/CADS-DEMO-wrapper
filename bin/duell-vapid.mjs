#!/usr/bin/env node
// Makes the VAPID key pair for My Daily Idea's push (lib/duell-push.mjs). Run once on the operator's machine; the three lines
// go into the server's environment. The private key is written to a file readable only by you and never printed.
//
//   node bin/duell-vapid.mjs mailto:betrieb@bunsenbrenner.org [out-file]
//
// Default out-file: ~/.config/cads/duell-vapid.env (refuses to overwrite: a new key pair invalidates every subscription).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { vapidKeys } from '../lib/duell-push.mjs';

const [subject, out = join(homedir(), '.config', 'cads', 'duell-vapid.env')] = process.argv.slice(2);
if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject || '')) {
  console.error('usage: node bin/duell-vapid.mjs mailto:<address>|https://<contact page> [out-file]');
  process.exit(2);
}
if (existsSync(out)) { console.error(`${out} exists; a new key pair would cut off every subscription. Remove it on purpose first.`); process.exit(1); }
const k = vapidKeys();
mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
writeFileSync(out, `DUELL_VAPID_SUBJECT=${subject}\nDUELL_VAPID_PUBLIC=${k.publicKey}\nDUELL_VAPID_PRIVATE=${k.privateKey}\n`, { mode: 0o600, flag: 'wx' });
console.log(`written ${out} (mode 600)\npublic key: ${k.publicKey}`);
