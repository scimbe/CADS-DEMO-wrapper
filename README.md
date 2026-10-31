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


## Signierte Herkunft der Bundles

Vor jeder Installation prüft `installActivate` (server.mjs, Logik in `lib/manifest-trust.mjs`) mit dem
vendorten wasm die ed25519-Signatur des Manifests gegen `manifests/publishers.json`. Der Schlüssel im
Manifest entscheidet nichts: nur diese Datei legt fest, wem die Galerie vertraut. Ein ungültiges,
unsigniertes, abgelaufenes, fremd signiertes oder fremdes Manifest bricht die Installation ab.

Das lokale Manifest ist die Festlegung, seine `manifest_id` wählt den Registry-Eintrag
(`REGISTRY_URL`, Standard `https://registry.bunsenbrenner.org`). Weicht die Antwort der Registry ab,
wird abgelehnt. Ist die Registry nicht erreichbar oder kennt das Manifest noch nicht, gilt die lokale
signierte Kopie, und das Protokoll sagt das.

Ein neu gebautes Bundle macht die Signatur ungültig, `test/manifest-trust.test.mjs` schlägt dann fehl:

```bash
node bin/sign-manifests.mjs --only <slug> --version <neu>   # Schlüssel liegt außerhalb des Repos
node bin/sign-manifests.mjs --verify
REGISTRY_WRITE_TOKEN=... node bin/publish-manifests.mjs <slug>   # Veröffentlichen, Betreiberschritt
```

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

## Route planen (travel)
`/d/travel` ruft die Route-Bridge (signiertes Bundle `manifests/travel`, Dauerdienst auf dem Service-Host)
serverseitig ueber ihre oeffentliche Tunnel-URL auf (`bridgeUrl` in `demos.json`, ueberschreibbar mit
`TRAVEL_BRIDGE_URL`; Timeout `TRAVEL_TIMEOUT_MS`, Default 60000). Hoechstens eine Anfrage pro Sekunde und
Prozess (Nominatim-Limit der Bridge). Ausfuehren laeuft ueber `/api/start` und ist damit wie alle Laeufe
login-pflichtig (`DEMO_AUTH_MODE=gate`). Code: `lib/route.mjs`, Tests: `test/route.test.mjs` (Bridge-Mock).

## Duell (Jugend-App)
Code: `lib/duell.mjs`, Tests: `test/duell.test.mjs`. Alle drei Routen sind oeffentlich (vor dem Login-Gate, eigene Grenzen).
- `POST /api/duell/config` `{prompt (<=140 Zeichen), lang}` -> `{params:{gravity,flapPower,pipeGap,pipeSpeed}, theme, title, emoji}`.
  Bereiche wie im Flappy-Studio (900-2600, 280-620, 90-200, 90-260), Themes `day|night|sunset|retro|candy`.
  Wortfilter de/en vor und nach dem Modell, Antwort-Cache, Limit je gehashter IP, Tagesgrenze, ein Modellaufruf zugleich;
  bei Grenze `429`, bei Ausfall `503` (sofort), bei Filtertreffer `422`. Modell: `LITELLM_*` wie die uebrige Galerie, Denken aus.
- `GET /duell` liefert `apps/duell-web/dist/index.html` (Platzhalter bis zum Marketplace-PR; Pfad per `DUELL_WEB_FILE`).
- `GET /.well-known/assetlinks.json` fuer `org.bunsenbrenner.cads` (wirkt nur auf dem Host des App-Links, siehe unten).

| ENV | Default | Bedeutung |
|-----|---------|-----------|
| `DUELL_IP_PER_HOUR` | 12 | Modellaufrufe je gehashter IP und Stunde |
| `DUELL_DAILY_MAX` | 400 | Modellaufrufe pro UTC-Tag insgesamt |
| `DUELL_CACHE_TTL_S` / `DUELL_CACHE_MAX` | 86400 / 500 | Antwort-Cache |
| `DUELL_LLM_TIMEOUT_MS` | 20000 | Zeitlimit des Modellaufrufs |
| `DUELL_IP_HEADER` | leer | Header mit der Client-IP (z. B. `x-forwarded-for`). Leer = Socket-Adresse; ist die privat (Proxy/Tunnel), ist das IP-Limit aus, es bleiben Cache, Tagesgrenze und ein Aufruf zugleich |
| `DUELL_IP_SALT` | zufaellig je Start | Salz fuer den IP-Hash |
| `DUELL_CORS_ORIGINS` | `https://appassets.androidplatform.net` | erlaubte Herkunft (kommagetrennt); andere Browser-Herkuenfte bekommen `403` |
| `DUELL_WEB_FILE` | `apps/duell-web/dist/index.html` | Spieldatei fuer `/duell` |
| `DUELL_ASSETLINKS_SHA256` / `DUELL_ANDROID_PACKAGE` | Release-Fingerabdruck / `org.bunsenbrenner.cads` | Inhalt der assetlinks.json |

### KI-Aktionen und Kontingent (My Daily Idea)
Code: `lib/duell-ai.mjs`, Tests: `test/duell-ai.test.mjs`. Gleiches Modell und gleiche Grenzen wie `/api/duell/config` (ein Aufruf zugleich, Tagesgrenze, Limit je gehashter IP).
- `POST /api/duell/ai` `{kind: line|meme|lyrics, input, device, lang}` -> `{kind, options, meter}`; `POST /api/duell/ai/status` und `/interest` `{device}` -> `{meter}`.
- Antworten: `429 quota` (Kontingent verbraucht), `429 busy|daily-limit|rate-limited`, `422 blocked`, `503 llm-unavailable|ai-off`. Die Seite faellt dann sofort auf lokale Vorschlaege zurueck. Nur erfolgreiche Aktionen zaehlen.
- Grenzen ehrlich: Ohne Konto zaehlt ein HMAC einer zufaelligen Geraete-ID. Wer die App-Daten loescht, hat ein neues Kontingent; das ist gewollt und nur ueber IP-Limit und Tagesgrenze gedeckelt. Mit Anmeldung (Cookie, nur gleiche Herkunft) zaehlt das Konto; die App-Huellen senden kein Cookie.
- Gespeichert werden nur HMACs und Zaehler, keine IP, keine E-Mail, keine Eingaben. Fotos bleiben auf dem Geraet; es geht nur getippter Text an den Server.
- Abo: Es gibt keinen Zahlungsweg. `DUELL_AI_ABO_ALLOWLIST` schaltet Konten zum Testen frei.

| ENV | Default | Bedeutung |
|-----|---------|-----------|
| `DUELL_AI_ENABLED` | 1 | `0` schaltet die KI-Aktionen ab, die Seite bleibt lokal |
| `DUELL_AI_FREE` | 3 | kostenlose Aktionen je Person |
| `DUELL_AI_SALT` | leer | Schluessel der HMACs. Ohne ihn wird nichts gespeichert und das Kontingent gilt nur bis zum Neustart |
| `DUELL_AI_STATE_FILE` | leer (Compose: `/var/lib/duell-ai/state.json`) | Zaehlerdatei auf dem Volume `duell-ai` |
| `DUELL_AI_ABO_ALLOWLIST` | leer | E-Mails mit Abo-Flag (kommagetrennt), nur zum Testen |
| `DUELL_AI_ABO_PER_DAY` | 30 | Aktionen je Abo-Konto und UTC-Tag |
| `DUELL_AI_KEYS_MAX` | 100000 | groesste Zaehlerdatei; die aeltesten Eintraege fallen zuerst heraus |
| `DUELL_AI_CACHE_TTL_S` / `DUELL_AI_CACHE_MAX` | 86400 / 300 | Antwort-Cache |

## Notes
- Secrets (`.env`, `.pexels-key`, `.registry-token`) are NOT in this repo — provide out-of-band.
- `work/` is the runtime install dir (demo bundles install on first "Start"); not committed.
- Photos under `pexels/` are Pexels stock (attribution shown in-app + per photo).
