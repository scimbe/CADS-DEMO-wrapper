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

## Login-Pflicht (bunsenbrenner-Konto)

Ansehen (Galerie, `/d/<slug>`, Status, Vorlagen-Metadaten) ist frei. Alles unter `/api/` ausser
`/api/status` und `/api/template/<slug>` fuehrt etwas aus und verlangt ein bunsenbrenner-Login
(Default-Deny, also auch kuenftige Routen wie `/api/podcast`). Ohne Login: `401` JSON
`{error:"login-required", login_url}`; die Seiten zeigen eine Leiste "Mit bunsenbrenner-Konto anmelden"
(Rueckkehr auf dieselbe Seite). Gate nicht erreichbar: `503` (fail closed). Mehr als
`DEMO_RUNS_PER_HOUR` (Default 20) Laeufe pro Konto und Stunde: `429`.

**Mechanismus.** Die Browser Plane ist payload-blind: Edge und Agent setzen oder entfernen `X-Gate-Email`
nicht, ein solcher Header ist daher nicht vertrauenswuerdig. `lib/auth.mjs` fragt deshalb selbst
`GET https://bunsenbrenner.org/gate/check` (control-plane `gate.rs`) und reicht nur das Cookie
`ct_gate_session` (Domain `.bunsenbrenner.org`, vom Browser mitgeschickt) plus ein festes
`X-Forwarded-Host` aus der Konfiguration weiter. Die Identitaet kommt aus der Antwort des Gates, nie aus
Request-Headern des Clients. Akzeptiert wird nur `200` + E-Mail mit `@`; leere E-Mail (Host ohne
`require_login`) und `share:<id>` (Share-Link) zaehlen nicht als Konto. Ergebnis 60 s gecacht (negativ 5 s):
Entzug wirkt nach spaetestens 60 s. Logs enthalten nur einen HMAC-Pseudonym-Praefix (12 Hex), keine E-Mail.

**Operator-Schritte (Deploy, nichts davon ist im Repo vorkonfiguriert).**
1. Portal (bunsenbrenner.org, Konto, dem der Tunnel `demos-34a13a96.bunsenbrenner.org` gehoert), Karte des
   Tunnels: **Require login** einschalten UND **Allow any signed-in account** einschalten. Das blockiert den
   Host nicht (der Edge erzwingt nichts; nur `/gate/check` und `/gate/start` lesen das Flag), es macht
   `/gate/start` fuer den Host erst verfuegbar. Ohne "Allow any" gilt die E-Mail-Zugriffsliste.
2. Auf ssh-united.becke.biz in der Umgebung des Containers (127.0.0.1:8794) setzen:
   `DEMO_AUTH_MODE=gate`, `DEMO_GATE_HOST=demos-34a13a96.bunsenbrenner.org`; optional
   `DEMO_GATE_CHECK_URL` (Default `https://bunsenbrenner.org/gate/check`), `DEMO_RUNS_PER_HOUR`,
   `DEMO_AUTH_LOG_SALT` (stabile Log-Pseudonyme ueber Neustarts). Der Container braucht ausgehend HTTPS
   zu bunsenbrenner.org. Container neu starten.
3. Pruefen: `curl -i -X POST https://demos-34a13a96.bunsenbrenner.org/api/start` gibt `401` mit
   `login_url`; `curl -i -H 'X-Gate-Email: a@b.c' ...` ebenfalls `401`; `GET /` gibt `200`.
   Im Browser anmelden und eine Demo starten.
Ohne `DEMO_AUTH_MODE=gate` (Default `off`) bleibt das Verhalten unveraendert (offen). Pfadregeln sind
mit dem Gate-Mechanismus allein nicht moeglich (er gilt je Hostname); sie werden hier im Origin umgesetzt.

## Behind demos.bunsenbrenner.org (CADS-Tunnel, Browser Plane)
Onboard a ct-agent with `CT_AGENT_ORIGIN=127.0.0.1:8790` (plain TCP proxy) — see the deploy
notes. No `CT_AGENT_SERVICE_HANDLER` needed (that is the channel path, not plain onboard/serve).

## Notes
- Secrets (`.env`, `.pexels-key`, `.registry-token`) are NOT in this repo — provide out-of-band.
- `work/` is the runtime install dir (demo bundles install on first "Start"); not committed.
- Photos under `pexels/` are Pexels stock (attribution shown in-app + per photo).
