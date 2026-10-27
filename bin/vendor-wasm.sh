#!/usr/bin/env bash
# Rebuild static/vendor/manifest-core-wasm/ from a CADS-agent-marketplace checkout.
#
#   bin/vendor-wasm.sh /path/to/CADS-agent-marketplace      # or MARKETPLACE_DIR=...
#
# What it does (no Docker needed; everything lands in a throw-away tool dir, never in your shell):
#   1. installs a pinned Rust toolchain via rustup (rustup-init is downloaded from static.rust-lang.org
#      and checked against the published sha256) unless the tool dir already has it,
#   2. installs the wasm-bindgen CLI at EXACTLY the version pinned in the checkout's Cargo.lock,
#   3. builds crates/manifest-core-wasm for wasm32-unknown-unknown (--locked, --release),
#   4. runs `wasm-bindgen --target web`,
#   5. copies the result into static/vendor/manifest-core-wasm/ and writes PROVENANCE.json
#      (source repo + commit, toolchain, per-file sha256).
# test/vendor-wasm.test.mjs fails if the vendored files and PROVENANCE.json ever disagree.
#
# Env: MARKETPLACE_DIR   source checkout (or first argument)
#      VENDOR_WASM_TOOLS reuse/keep the toolchain here (default: a fresh temp dir)
#      ALLOW_DIRTY=1     vendor from a checkout with uncommitted changes (recorded as dirty; do not ship)
set -euo pipefail

TOOLCHAIN="1.98.1"   # pin; bump deliberately and re-run so PROVENANCE.json records it
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$(cd "${1:-${MARKETPLACE_DIR:-}}" 2>/dev/null && pwd)" || { echo "usage: $0 /path/to/CADS-agent-marketplace" >&2; exit 2; }
OUT="$HERE/static/vendor/manifest-core-wasm"
CRATE=manifest-core-wasm
ARTIFACT=manifest_core_wasm

[ -f "$SRC/Cargo.lock" ] && [ -d "$SRC/crates/$CRATE" ] || { echo "$SRC is not a CADS-agent-marketplace checkout" >&2; exit 2; }
DIRTY=0
if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
  [ "${ALLOW_DIRTY:-0}" = 1 ] || { echo "refusing: $SRC has uncommitted changes (ALLOW_DIRTY=1 to override)" >&2; exit 2; }
  DIRTY=1
fi
COMMIT="$(git -C "$SRC" rev-parse HEAD)"
REMOTE="$(git -C "$SRC" remote get-url origin 2>/dev/null || echo unknown)"
BRANCH="$(git -C "$SRC" branch --show-current 2>/dev/null || true)"

TOOLS="${VENDOR_WASM_TOOLS:-$(mktemp -d)}"
export RUSTUP_HOME="$TOOLS/rustup" CARGO_HOME="$TOOLS/cargo"
export PATH="$CARGO_HOME/bin:$PATH"
mkdir -p "$TOOLS"

if ! "$CARGO_HOME/bin/rustc" --version 2>/dev/null | grep -q "^rustc $TOOLCHAIN "; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  TRIPLE=aarch64-apple-darwin ;;
    Darwin-x86_64) TRIPLE=x86_64-apple-darwin ;;
    Linux-x86_64)  TRIPLE=x86_64-unknown-linux-gnu ;;
    Linux-aarch64) TRIPLE=aarch64-unknown-linux-gnu ;;
    *) echo "unsupported host $(uname -sm)" >&2; exit 2 ;;
  esac
  DL="$TOOLS/rustup-dl"; mkdir -p "$DL"
  curl -fsSL -o "$DL/rustup-init" "https://static.rust-lang.org/rustup/dist/$TRIPLE/rustup-init"
  WANT="$(curl -fsSL "https://static.rust-lang.org/rustup/dist/$TRIPLE/rustup-init.sha256" | cut -d' ' -f1)"
  GOT="$(shasum -a 256 "$DL/rustup-init" | cut -d' ' -f1)"
  [ "$WANT" = "$GOT" ] || { echo "rustup-init checksum mismatch ($GOT != $WANT)" >&2; exit 1; }
  chmod +x "$DL/rustup-init"
  "$DL/rustup-init" -y --no-modify-path --profile minimal --default-toolchain "$TOOLCHAIN" -t wasm32-unknown-unknown >/dev/null
fi

BINDGEN_VER="$(awk '/^name = "wasm-bindgen"$/{getline; gsub(/[^0-9.]/,"",$0); print; exit}' "$SRC/Cargo.lock")"
[ -n "$BINDGEN_VER" ] || { echo "no wasm-bindgen in Cargo.lock" >&2; exit 1; }
if ! "$CARGO_HOME/bin/wasm-bindgen" --version 2>/dev/null | grep -q " $BINDGEN_VER\$"; then
  cargo install wasm-bindgen-cli --version "$BINDGEN_VER" --locked --force
fi

BUILD="$TOOLS/build"; rm -rf "$BUILD"; mkdir -p "$BUILD"
# Remap absolute paths so the .wasm does not embed the machine it was built on.
export RUSTFLAGS="--remap-path-prefix=$SRC=/src --remap-path-prefix=$CARGO_HOME=/cargo --remap-path-prefix=$RUSTUP_HOME=/rustup"
(cd "$SRC" && CARGO_TARGET_DIR="$BUILD/target" cargo build --locked -p "$CRATE" --target wasm32-unknown-unknown --release)
wasm-bindgen --target web --out-dir "$BUILD/pkg" --out-name "$ARTIFACT" "$BUILD/target/wasm32-unknown-unknown/release/$ARTIFACT.wasm"

mkdir -p "$OUT"; rm -f "$OUT"/*
cp "$BUILD/pkg/$ARTIFACT.js" "$BUILD/pkg/$ARTIFACT.d.ts" "$BUILD/pkg/${ARTIFACT}_bg.wasm" "$OUT/"

CRATE_VER="$(awk -v n="$CRATE" '$0=="name = \""n"\""{getline; gsub(/[^0-9.]/,"",$0); print; exit}' "$SRC/Cargo.lock")"
RUSTC_V="$(rustc --version)"
node --input-type=module - "$OUT" "$SRC" "$REMOTE" "$COMMIT" "$BRANCH" "$DIRTY" "$CRATE" "$CRATE_VER" "$RUSTC_V" "$BINDGEN_VER" <<'JS'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const [out, , remote, commit, branch, dirty, crate, crateVer, rustc, bindgen] = process.argv.slice(2);
const files = {};
for (const f of readdirSync(out).filter((n) => n !== 'PROVENANCE.json').sort()) {
  const b = readFileSync(join(out, f));
  files[f] = { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length };
}
const prov = {
  what: 'Browser/Node binding for PromptTemplate and ServiceManifest sign/verify/render (wasm-bindgen --target web)',
  source: { repo: remote, commit, branch: branch || null, crate, crate_version: crateVer, dirty: dirty === '1' },
  toolchain: { rustc, target: 'wasm32-unknown-unknown', profile: 'release', wasm_bindgen_cli: bindgen },
  build: [
    'cargo build --locked -p ' + crate + ' --target wasm32-unknown-unknown --release',
    'wasm-bindgen --target web --out-name manifest_core_wasm',
  ],
  reproduce: 'bin/vendor-wasm.sh <checkout of source.repo at source.commit>',
  files,
};
writeFileSync(join(out, 'PROVENANCE.json'), JSON.stringify(prov, null, 2) + '\n');
JS
echo "vendored into $OUT (source $COMMIT$([ "$DIRTY" = 1 ] && echo ' DIRTY'))"
