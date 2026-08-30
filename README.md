# CADS Demo Wrapper

Dependency-free Node server presenting the CADS marketplace demos as a visitable gallery
(bunsenbrenner.org style). Serves the index at `/`, each demo at `/d/<slug>`, and each demo's
outputs at `/d/<slug>/out/...`.

## Run
```
cp .env.template .env   # fill LITELLM_* (shared proxy) on the host
node server.mjs         # listens on 127.0.0.1:8790
```

## Behind demos.bunsenbrenner.org (CADS-Tunnel, Browser Plane)
Onboard a ct-agent with `CT_AGENT_ORIGIN=127.0.0.1:8790` (plain TCP proxy) — see the deploy
notes. No `CT_AGENT_SERVICE_HANDLER` needed (that is the channel path, not plain onboard/serve).

## Notes
- Secrets (`.env`, `.pexels-key`, `.registry-token`) are NOT in this repo — provide out-of-band.
- `work/` is the runtime install dir (demo bundles install on first "Start"); not committed.
- Photos under `pexels/` are Pexels stock (attribution shown in-app + per photo).
