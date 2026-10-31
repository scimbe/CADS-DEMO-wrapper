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
  phototools: { brew: 'python node exiftool imagemagick', apt: 'python3 nodejs libimage-exiftool-perl imagemagick', mac: true },
};

// What runs in the visitor's browser, per demo. Only what was run for real:
//   full  = untertitel: speech recognition and burn-in as WebAssembly, signature checked in the page
//   draw  = diagram: drawing a typed text with Graphviz as WebAssembly (the AI step stays on the server)
const BROWSER = { untertitel: 'full', diagram: 'draw' };
// Templates that cannot run in the browser, and the concrete reason (shown instead of a promise).
const NO_BROWSER = { contractcheck: 'poppler', phototools: 'imagetools' };

const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

export const localRunConfig = (env = process.env) => {
  const apkUrl = String(env.CADS_ANDROID_APK_URL || '').trim();
  const apkSha = String(env.CADS_ANDROID_APK_SHA256 || '').trim().toLowerCase();
  return {
    version: /^cads-run-v[0-9A-Za-z.-]+$/.test(env.CADS_RUN_VERSION || '') ? env.CADS_RUN_VERSION : null,
    base: env.CADS_RUN_SCRIPT_BASE || 'https://demos-34a13a96.bunsenbrenner.org',
    // A download link without its checksum is not offered: both must be set and valid.
    android: isHttps(apkUrl) && /^[0-9a-f]{64}$/.test(apkSha) ? { url: apkUrl, sha256: apkSha } : null,
  };
};

export const hasLocalRun = (slug, cfg) => !!cfg.version && Object.hasOwn(NEEDS, slug);
/** The block is shown when the sandbox command exists for this demo or something runs in the browser. */
export const hasLocalBlock = (slug, cfg) => hasLocalRun(slug, cfg) || Object.hasOwn(BROWSER, slug) || (!!cfg.version && Object.hasOwn(NO_BROWSER, slug));

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

function browserSection(slug, t) {
  const kind = BROWSER[slug];
  if (kind) {
    const link = kind === 'draw' ? ` <a href="#bd" onclick="var b=document.getElementById('bd');if(b)b.open=true">${t('lr.browser.draw.go')}</a>` : '';
    return `<h3>${t('lr.browser.t')}</h3><p>${t(`lr.browser.${kind}`)}${link}</p>`;
  }
  return `<h3>${t('lr.browser.t')}</h3><p>${t(`lr.browser.no.${NO_BROWSER[slug]}`)}</p>`;
}

function androidSection(t, cfg) {
  if (!cfg.android) return `<h3>Android</h3><p>${t('lr.android')}</p>`;
  return `<h3>Android</h3><p>${t('lr.android.apk', { link: `<a href="${esc(cfg.android.url)}" rel="noopener noreferrer">${t('lr.android.dl')}</a>` })}</p>
<p>${t('lr.android.sha')} <code>${esc(cfg.android.sha256)}</code></p><p>${t('lr.android.unknown')}</p>`;
}

export function localRunBlock(slug, lang, cfg) {
  lang = normLang(lang);
  const t = makeT(lang);
  const run = hasLocalRun(slug, cfg);
  let html = `<section class="lr" aria-labelledby="lr-h"><h2 id="lr-h">${t('lr.title')}</h2>`;
  if (run) html += `<p>${t('lr.lede')}</p>`;
  if (Object.hasOwn(BROWSER, slug) || Object.hasOwn(NO_BROWSER, slug)) html += browserSection(slug, t);
  if (run) {
    const c = localRunCommands(slug, cfg);
    html += `<h3>macOS</h3><pre tabindex="0">${esc(c.macos)}</pre>
<h3>Linux</h3><pre tabindex="0">${esc(c.linux)}</pre>
<h3>Windows</h3><p>${t('lr.windows')}</p>
${androidSection(t, cfg)}
<p>${t('lr.note', { url: `<a href="/cads-run.sh">cads-run.sh</a>` })}</p>`;
  }
  return html + '</section>';
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
