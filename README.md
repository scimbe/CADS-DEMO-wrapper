# CADS Demo Wrapper

Dependency-free Node server presenting the CADS marketplace demos as a visitable gallery
(bunsenbrenner.org style). Serves the index at `/`, each demo at `/d/<slug>`, and each demo's
outputs at `/d/<slug>/out/...`.

## Run
```
cp .env.template .env   # fill LITELLM_* (shared proxy) on the host
node server.mjs         # listens on 127.0.0.1:8790
```

## Test
```
node --test test/    # dependency-free (node:test); boots the server without LLM credentials
```
Layout: `server.mjs` (routes, demo pages, run client), `lib/` (page chrome + CSS, index page,
search blob, DE/EN dictionary), `demos.json` (per-demo copy: `title`/`blurb`/`tech`/`category`,
each with an `_en` variant).

## Eigene Angaben (signed prompt templates)
Demos with a template (`templates/<slug>.json`: newsletter, diagram, podcast) show a form on `/d/<slug>`.
The browser verifies the signature with the vendored wasm (`static/vendor/manifest-core-wasm/`,
rebuild with `bin/vendor-wasm.sh <CADS-agent-marketplace checkout>`), renders a preview, and
`POST /api/start` takes **values only**: the server re-verifies and renders itself, then hands the
prompt to the pipeline (`TEMPLATES_DIR` overrides the template directory).
Re-sign templates with `node bin/sign-templates.mjs` (key outside the repo, see the header of that
script; `--init-key` creates a demo key, `--verify` needs none). Trusted publishers:
`templates/publishers.json`. CI: `.github/workflows/ci.yml`.

## Behind demos.bunsenbrenner.org (CADS-Tunnel, Browser Plane)
Onboard a ct-agent with `CT_AGENT_ORIGIN=127.0.0.1:8790` (plain TCP proxy) — see the deploy
notes. No `CT_AGENT_SERVICE_HANDLER` needed (that is the channel path, not plain onboard/serve).

## Notes
- Secrets (`.env`, `.pexels-key`, `.registry-token`) are NOT in this repo — provide out-of-band.
- `work/` is the runtime install dir (demo bundles install on first "Start"); not committed.
- Photos under `pexels/` are Pexels stock (attribution shown in-app + per photo).
