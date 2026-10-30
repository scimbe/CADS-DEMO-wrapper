// Real provenance check for the bundles this gallery installs: ed25519 over the signed manifest, by
// the same wasm (manifest-core) as the marketplace, against a trust root that lives in THIS repository.
//
//   manifests/publishers.json   trust root: publisher_pubkey -> label. The key inside a manifest only
//                               says who claims to have signed it; it never grants trust by itself.
//
// Order, same idea as inspectTemplate in lib/prompt-core.mjs:
// parseable -> has a signature -> signature verifies -> publisher in OUR trust root -> not expired ->
// is the manifest of this demo. Anything else refuses the install (fail closed).
//
// The local manifest is the pin: its manifest_id selects the registry entry. A registry that answers
// with anything but that same, valid manifest refuses the install. A registry that is down or does
// not know the manifest (yet) cannot weaken the result: the signature proves origin end to end, the
// transport adds nothing, so the local signed copy is used and the run log says so.
import { readFileSync } from 'node:fs';

export const DEFAULT_REGISTRY_URL = 'https://registry.bunsenbrenner.org';

/** Plain-language reason per refusal code (run log). */
export const REFUSAL = {
  invalid: 'Manifest nicht lesbar',
  unsigned: 'Manifest ist nicht signiert',
  'bad-signature': 'Signatur ungültig',
  'untrusted-publisher': 'Herausgeber steht nicht in der Vertrauensliste',
  expired: 'Manifest ist abgelaufen',
  'wrong-manifest': 'Manifest gehört nicht zu dieser Demo',
  'registry-mismatch': 'Registry liefert ein anderes Manifest als das festgelegte',
};

export const readTrustRoot = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function judgeManifest(raw, { api, trusted, now, name }) {
  let manifest;
  try { manifest = JSON.parse(raw); } catch { return { ok: false, code: 'invalid' }; }
  if (!manifest || typeof manifest !== 'object') return { ok: false, code: 'invalid' };
  if (typeof manifest.signature !== 'string' || !manifest.signature) return { ok: false, code: 'unsigned', manifest };
  let authentic;
  try { authentic = api.verifyManifest(raw); } catch { return { ok: false, code: 'invalid', manifest }; }
  if (!authentic) return { ok: false, code: 'bad-signature', manifest };
  if (!Object.hasOwn(trusted, manifest.publisher_pubkey)) return { ok: false, code: 'untrusted-publisher', manifest };
  if (!api.isManifestValid(raw, now)) return { ok: false, code: 'expired', manifest };
  if (name !== undefined && manifest.name !== name) return { ok: false, code: 'wrong-manifest', manifest };
  return { ok: true, manifest, publisher: trusted[manifest.publisher_pubkey] };
}

/** -> { status: 'ok', raw } | { status: 'absent' } (404) | { status: 'unreachable' } */
export async function fetchRegistryManifest(baseUrl, manifestId, { doFetch = fetch, timeoutMs = 4000 } = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(manifestId))) return { status: 'absent' };
  try {
    const r = await doFetch(`${baseUrl}/manifests/${manifestId}`, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 404) return { status: 'absent' };
    if (!r.ok) return { status: 'unreachable' };
    return { status: 'ok', raw: await r.text() };
  } catch { return { status: 'unreachable' }; }
}

/**
 * Judge the local manifest, then the registry's answer for its id.
 * -> { ok:true, manifest, publisher, source: 'registry'|'unpublished'|'offline' } | { ok:false, code }
 */
export async function loadVerifiedManifest(localRaw, { api, trusted, now, name, registryUrl, doFetch, timeoutMs }) {
  const local = judgeManifest(localRaw, { api, trusted, now, name });
  if (!local.ok) return local;
  const got = await fetchRegistryManifest(registryUrl, local.manifest.manifest_id, { doFetch, timeoutMs });
  if (got.status === 'absent') return { ...local, source: 'unpublished' };
  if (got.status === 'unreachable') return { ...local, source: 'offline' };
  const remote = judgeManifest(got.raw, { api, trusted, now, name });
  if (!remote.ok) return remote;
  if (remote.manifest.manifest_id !== local.manifest.manifest_id || remote.manifest.bundle.sha256 !== local.manifest.bundle.sha256) return { ok: false, code: 'registry-mismatch' };
  return { ...remote, source: 'registry' };
}
