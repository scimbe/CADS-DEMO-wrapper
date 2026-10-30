#!/usr/bin/env node
// Operator step: publish manifests/<slug> into the marketplace registry (POST /manifests).
//
//   REGISTRY_WRITE_TOKEN=... [REGISTRY_URL=https://registry.bunsenbrenner.org] \
//     node bin/publish-manifests.mjs contractcheck phototools erklaervideo
//
// The token comes from the environment only and is never printed. A manifest the registry already
// holds is reported and skipped; the registry itself re-checks signature and bundle sha256.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REGISTRY_URL } from '../lib/manifest-trust.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.REGISTRY_WRITE_TOKEN;
const base = process.env.REGISTRY_URL || DEFAULT_REGISTRY_URL;
const slugs = process.argv.slice(2);
if (!token || !slugs.length) { console.error('usage: REGISTRY_WRITE_TOKEN=... node bin/publish-manifests.mjs <slug>...'); process.exit(2); }
let failed = 0;
for (const slug of slugs) {
  const dir = join(ROOT, 'manifests', slug);
  const raw = readFileSync(join(dir, 'manifest.json'), 'utf8');
  const { manifest_id: id } = JSON.parse(raw);
  const known = await fetch(`${base}/manifests/${id}`);
  if (known.ok) { console.log(`already published  ${slug}  ${id}`); continue; }
  const form = new FormData();
  form.set('manifest', raw);
  form.set('bundle', new Blob([readFileSync(join(dir, 'bundle.tar.gz'))]), 'bundle.tar.gz');
  const r = await fetch(`${base}/manifests`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const text = await r.text();
  console.log(`${r.ok ? 'published' : 'REFUSED ' + r.status}  ${slug}  ${id}  ${text.slice(0, 200)}`);
  if (!r.ok) failed++;
}
process.exit(failed ? 1 : 0);
