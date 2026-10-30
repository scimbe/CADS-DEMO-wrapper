// "Sandbox auf deinem Gerät": the one-line command that runs a demo's signed template on the
// visitor's own device with cads-run (CADS-agent-marketplace, crates/cads-run). All checks happen
// there; this file only says how to get it.
//
// Off until CADS_RUN_VERSION names a published release (e.g. cads-run-v0.1.0): no commands that
// cannot work, and the trust badge stays "in preparation".
import { esc } from './chrome.mjs';
import { makeT, normLang } from './i18n.mjs';

// Tools a template expects on the device. Only templates that really ran in the sandbox are listed
// (verified on macOS and Linux). Needing a local server or the network rules the others out.
const NEEDS = {
  contractcheck: { brew: 'python poppler', apt: 'python3 poppler-utils', mac: true },
  phototools: { brew: 'node exiftool imagemagick', apt: 'nodejs libimage-exiftool-perl imagemagick', mac: true },
};

export const localRunConfig = (env = process.env) => ({
  version: /^cads-run-v[0-9A-Za-z.-]+$/.test(env.CADS_RUN_VERSION || '') ? env.CADS_RUN_VERSION : null,
  base: env.CADS_RUN_SCRIPT_BASE || 'https://demos-34a13a96.bunsenbrenner.org',
});

export const hasLocalRun = (slug, cfg) => !!cfg.version && Object.hasOwn(NEEDS, slug);

/** The commands per OS. Exported so a test can run exactly what the page shows. */
export function localRunCommands(slug, cfg) {
  const n = NEEDS[slug];
  const pipe = `curl -fsSL ${cfg.base}/cads-run.sh | sh -s -- ${slug}`;
  return {
    macos: `brew install ${n.brew} && ${pipe}${n.mac ? ' --allow-read "$(brew --prefix)"' : ''}`,
    linux: `sudo apt install bubblewrap ${n.apt} && ${pipe}`,
  };
}

export const LOCAL_RUN_CSS = `
.lr{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:18px 20px;margin:18px 0}
.lr h2{font-family:var(--serif);font-weight:600;font-size:1.3rem;margin:0 0 4px}
.lr h3{font-size:.95rem;margin:14px 0 4px}
.lr p{margin:0 0 6px;color:var(--muted2);font-size:.92rem;max-width:75ch}
.lr pre{white-space:pre-wrap;overflow-wrap:anywhere;font:.82rem/1.6 var(--mono);background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin:0}
`;

export function localRunBlock(slug, lang, cfg) {
  lang = normLang(lang);
  const t = makeT(lang);
  const c = localRunCommands(slug, cfg);
  return `<section class="lr" aria-labelledby="lr-h"><h2 id="lr-h">${t('lr.title')}</h2><p>${t('lr.lede')}</p>
<h3>macOS</h3><pre tabindex="0">${esc(c.macos)}</pre>
<h3>Linux</h3><pre tabindex="0">${esc(c.linux)}</pre>
<h3>Windows</h3><p>${t('lr.windows')}</p>
<h3>Android</h3><p>${t('lr.android')}</p>
<p>${t('lr.note', { url: `<a href="/cads-run.sh">cads-run.sh</a>` })}</p></section>`;
}

/** Downloads the release binary, checks it against the release's SHA256SUMS, installs it, runs it. */
export const installScript = (cfg) => `#!/bin/sh
# Installs cads-run ${cfg.version} into ~/.cads-run/bin and starts it with the given arguments.
# Source and checks: https://github.com/scimbe/CADS-agent-marketplace/tree/main/crates/cads-run
set -eu
base="\${CADS_RUN_RELEASE_URL:-https://github.com/scimbe/CADS-agent-marketplace/releases/download/${cfg.version}}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Darwin-x86_64) target=x86_64-apple-darwin ;;
  Linux-x86_64) target=x86_64-unknown-linux-musl ;;
  Linux-aarch64) target=aarch64-unknown-linux-musl ;;
  *) echo "cads-run: dieses Gerät wird noch nicht unterstützt: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
archive="cads-run-$target.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$base/$archive" -o "$tmp/$archive"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then sum="$(sha256sum "$tmp/$archive")"; else sum="$(shasum -a 256 "$tmp/$archive")"; fi
sum="\${sum%% *}"
grep -q "^$sum  $archive$" "$tmp/SHA256SUMS" || { echo "cads-run: Prüfsumme passt nicht, breche ab" >&2; exit 1; }
mkdir -p "$HOME/.cads-run/bin"
tar -xzf "$tmp/$archive" -C "$HOME/.cads-run/bin" cads-run
"$HOME/.cads-run/bin/cads-run" "$@"
`;
