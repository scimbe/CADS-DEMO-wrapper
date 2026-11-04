#!/usr/bin/env node
// Mint a Pro or Business key for My Daily Idea (lib/duell-pots.mjs). There is no purchase: the owner mints a key, adds it to
// DUELL_ENTITLEMENTS on the server and hands it to the family or team. Taking it off the list revokes it.
//
//   node bin/duell-key.mjs pro familie-mueller
//   node bin/duell-key.mjs biz acme-gmbh
//
// The secret is read from the file in DUELL_ENTITLEMENT_SECRET_FILE (default ~/.config/cads/duell-entitlement.key), the same
// value the server has in DUELL_ENTITLEMENT_SECRET. It is never printed. Only the key goes to stdout.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mintKey } from '../lib/duell-pots.mjs';

const [tier, id] = process.argv.slice(2);
if (!/^(pro|biz)$/.test(tier || '') || !/^[a-z0-9-]{3,32}$/.test(id || '')) {
  console.error('usage: node bin/duell-key.mjs pro|biz <id: a-z 0-9 -, 3-32 characters>');
  process.exit(2);
}
const file = process.env.DUELL_ENTITLEMENT_SECRET_FILE || join(homedir(), '.config', 'cads', 'duell-entitlement.key');
let secret = '';
try { secret = readFileSync(file, 'utf8').trim(); } catch { console.error(`no secret in ${file}`); process.exit(1); }
if (secret.length < 16) { console.error('secret too short (at least 16 characters)'); process.exit(1); }
console.log(mintKey(secret, tier, id));
