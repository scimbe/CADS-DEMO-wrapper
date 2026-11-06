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
- `POST /api/duell/config` `{prompt (<=140 Zeichen), lang, device?, key?, proof?, queue?}` -> `{params:{gravity,flapPower,pipeGap,pipeSpeed}, theme, title, emoji, seal}`,
  mit `device` zusaetzlich `{cost, receipt?, meter}` (zaehlt im Topf wie eine KI-Aktion, Cache-Treffer 0).
  Bereiche wie im Flappy-Studio (900-2600, 280-620, 90-200, 90-260), Themes `day|night|sunset|retro|candy`.
  Wortfilter de/en vor und nach dem Modell, Antwort-Cache, Limit je gehashter IP (nur Free), Tagesgrenze, Warteschlange;
  bei Grenze `429`, bei Ausfall `503` (sofort), bei Filtertreffer `422`. Modell: `LITELLM_*` wie die uebrige Galerie, Denken aus.
- Warteschlange (`lib/duell-queue.mjs`): Business vor Pro vor Free (mit Alterung, niemand wartet ewig), hoechstens `DUELL_LLM_PARALLEL`
  Modellaufrufe zugleich. Eine Anfrage wartet bis `DUELL_QUEUE_HOLD_MS` auf ihren Platz; dann `429 {error:"busy", position, etaS}`,
  oder mit `queue:"ticket"` `202 {queued, ticket, position, etaS}` und `POST /api/duell/queue {ticket}` bis zur Antwort.
  Volle Schlange `429 queue-full` (ein hoeher eingestufter Neuzugang verdraengt den am niedrigsten eingestuften wartenden Auftrag, das kann auch Pro sein),
  zu lange gewartet `429 queue-timeout`, zweite Anfrage derselben Person `409 pending` (bei Pro und Business: desselben Geraets).
  Ein fertiges, aber nie abgeholtes Ticket wird beim Verfall abgebucht, ein nie gestartetes kostet nichts.
- `GET /duell` liefert `apps/duell-web/dist/index.html` (Platzhalter bis zum Marketplace-PR; Pfad per `DUELL_WEB_FILE`).
- `GET /duell/parts/<name>.<hash>.js` liefert die Teildateien daneben (`dist/parts/`, selten genutzter Code, den die Seite nachlaedt); beim Ausrollen den ganzen Ordner `dist/` kopieren, nicht nur `index.html`.
- `GET /duell/business/` (auch ohne Schrägstrich) liefert Daily Business, den Business-Build derselben App (`node scripts/build.js --flavor business` -> `dist/business/index.html`), `GET /duell/business/parts/<name>.<hash>.js` seine eigenen Teile aus `dist/business/parts/`. Gleiche Kompression, ETag und Cache-Regeln wie `/duell`; fehlt der Build, antwortet die Route `404 duell: no business build`. Beim Ausrollen `dist/business/` mit `parts/` kopieren.
- `GET /.well-known/assetlinks.json` fuer `org.bunsenbrenner.cads` (wirkt nur auf dem Host des App-Links, siehe unten).

| ENV | Default | Bedeutung |
|-----|---------|-----------|
| `DUELL_IP_PER_HOUR` | 12 | Modellaufrufe je gehashter IP und Stunde |
| `DUELL_DAILY_MAX` | 400 | Modellaufrufe pro UTC-Tag insgesamt |
| `DUELL_CACHE_TTL_S` / `DUELL_CACHE_MAX` | 86400 / 500 | Antwort-Cache |
| `DUELL_LLM_TIMEOUT_MS` | 20000 | Zeitlimit des Modellaufrufs |
| `DUELL_LLM_PARALLEL` | 1 | Modellaufrufe zugleich (gemessen: das Modell buendelt nicht, mehr erhoeht nur die Latenz) |
| `DUELL_QUEUE_MAX` / `DUELL_QUEUE_WAIT_MS` | 30 / 45000 | Laenge der Warteschlange / laengste Wartezeit darin |
| `DUELL_QUEUE_HOLD_MS` | 8000 | so lange haelt der Server eine Anfrage offen, bevor `429 busy` bzw. `202` mit Ticket kommt |
| `DUELL_QUEUE_AGING_MS` | 10000 | Alterung: wer so lange wartet, steigt eine Stufe |
| `DUELL_QUEUE_ABANDON_MS` / `DUELL_QUEUE_TICKET_TTL_S` | 15000 / 60 | wartendes Ticket ohne Abfrage verfaellt (kostet nichts) / fertige Antwort wird so lange aufgehoben (danach abgebucht) |
| `DUELL_CONFIG_ANON` | 1 | `0`: Spiel-Konfiguration nur noch mit `device` (sobald alle Apps es senden) |
| `DUELL_SEAL_SECRET` | zufaellig je Start | Schluessel des KI-Siegels; ohne festen Wert sind Siegel nur bis zum Neustart pruefbar |
| `DUELL_IP_HEADER` | leer | Header mit der Client-IP (z. B. `x-forwarded-for`). Leer = Socket-Adresse; ist die privat (Proxy/Tunnel), ist das IP-Limit aus, es bleiben Cache, Tagesgrenze und ein Aufruf zugleich |
| `DUELL_IP_SALT` | zufaellig je Start | Salz fuer den IP-Hash |
| `DUELL_CORS_ORIGINS` | `https://appassets.androidplatform.net` | erlaubte Herkunft (kommagetrennt); andere Browser-Herkuenfte bekommen `403` |
| `DUELL_WEB_FILE` | `apps/duell-web/dist/index.html` | Spieldatei fuer `/duell` |
| `DUELL_BIZ_FILE` | `business/index.html` neben `DUELL_WEB_FILE` | Seite fuer `/duell/business/` |
| `DUELL_ASSETLINKS_SHA256` / `DUELL_ANDROID_PACKAGE` | Release-Fingerabdruck / `org.bunsenbrenner.cads` | Inhalt der assetlinks.json |

### Kurzlinks (`lib/shortlink.mjs`, Tests: `test/shortlink.test.mjs`)
- `POST /api/s` `{f, k, n, l}` -> `201 {id, url, token, exp}`; `f` ist das Fragment (`c=...` oder `i=...`, hoechstens 2 KB) und bleibt fuer den Server undurchsichtig. `p=` (enthaelt einen geheimen Schluessel) wird abgelehnt.
- `GET /s/<id>` kleine Seite mit Open-Graph-Tags, Skript fuehrt nach `/duell#<f>`; abgelaufen oder geloescht `410`, unbekannt `404`, jeweils mit freundlicher Seite. Vorschau enthaelt nie Nutzertext, Bilder fest in `static/share/`.
- `GET /api/s/<id>` -> `{f, exp}` fuer die App-Huellen; `DELETE /api/s/<id>` mit `Authorization: Bearer <token>`.
- Daten: `SHORT_DATA_DIR/links.jsonl`, muss ein Volume sein. Ohne die Variable antwortet `POST /api/s` mit `503` und die App bleibt beim langen Link. Sicherung: `docker run --rm -v demos-shortlinks:/d:ro -v "$PWD":/b alpine tar czf /b/shortlinks.tgz -C /d .`

| Variable | Default | Bedeutung |
|---|---|---|
| `SHORT_DATA_DIR` | leer (aus) | Verzeichnis im Volume |
| `SHORT_TTL_DAYS` | 90 | Lebensdauer |
| `SHORT_IP_PER_HOUR` / `SHORT_DAILY_MAX` | 20 / 2000 | neue Links je gehashter IP und Stunde / pro UTC-Tag |
| `SHORT_MISS_PER_HOUR` | 60 | unbekannte IDs je gehashter IP und Stunde, danach `429` (braucht `DUELL_IP_HEADER`, sonst ist die IP unbekannt) |
| `SHORT_MAX_LIVE` | 100000 | Obergrenze gespeicherter Eintraege |
| `SHORT_BASE` / `SHORT_PUBLIC_BASE` | `https://bunsenbrenner.org` / Galerie-Host | sichtbarer Link / Host fuer Bilder und `og:url` |

### Profil unter „Mein Stil“ (My Daily Idea)
Code: `lib/duell-profile.mjs`, Tests: `test/duell-profile.test.mjs`. Freiwillig; ohne Anmeldung bleibt alles auf dem Gerät.
- `POST /api/duell/profile/get|put|delete` `{via: account|code, code?, rev, profile, age16?, fresh?}`. `put` mit veralteter `rev` -> `409`.
- `via: account`: bunsenbrenner-Login (Gate-Cookie, nur gleiche Herkunft). Das erste Speichern verlangt `age16: true`
  (Selbstauskunft „16 oder älter“, Art. 8 DSGVO); der Tag der Angabe wird gespeichert. Unter 16 gibt es den Sync-Code.
- `via: code`: 128-Bit-Zufallscode, auf dem Gerät erzeugt; kein Konto, keine E-Mail. Wer den Code hat, hat das Profil.
- Gespeichert: Spitzname, Emoji, Farben, Sticker-Set, Wandbilder außer Fotowerken (`k: photo` wird verworfen), gemerkte Karten,
  beim Code die KI-Geräte-ID. Dateiname ist ein HMAC; keine E-Mail, keine IP, kein Code auf der Platte.
- Löschen entfernt die Daten sofort und lässt nur `{r, gone: true}` zurück, damit ein zweites Gerät das Profil nicht neu hochlädt.
  Ungenutzte Profile werden nach `DUELL_PROFILE_TTL_DAYS` gelöscht.

| Variable | Default | Bedeutung |
|---|---|---|
| `DUELL_PROFILE_DIR` | leer (aus, `503`) | Verzeichnis im Volume |
| `DUELL_PROFILE_SALT` | zufällig je Start | HMAC-Salz für die Dateinamen; ohne festen Wert sind Profile nach einem Neustart unerreichbar |
| `DUELL_PROFILE_TTL_DAYS` | 400 | Löschfrist für ungenutzte Profile |
| `DUELL_PROFILE_MAX` / `DUELL_PROFILE_NEW_PER_HOUR` / `DUELL_PROFILE_IP_NEW_PER_HOUR` / `DUELL_PROFILE_WRITES_PER_HOUR` | 20000 / 60 / 5 / 240 | Grenzen |

### KI-Aktionen, Toepfe, Siegel und Melden (My Daily Idea)
Code: `lib/duell-ai.mjs`, `lib/duell-pots.mjs`, `lib/duell-seal.mjs`, `lib/duell-report.mjs`; Tests: `test/duell-ai.test.mjs`, `test/duell-ai-kinds.test.mjs`, `test/duell-queue.test.mjs`, `test/duell-seal.test.mjs`, `test/duell-report.test.mjs`. Gleiches Modell und gleiche Warteschlange wie `/api/duell/config`.
- `POST /api/duell/ai` `{kind: wish|line|meme|lyrics|protokoll|plan|liste|quiz|welt|text, input, device, key?, proof?, lang, queue?}` -> `{kind, options, seals, hashes, cost, receipt?, meter}`;
  `POST /api/duell/ai/accept` bzw. `/discard` `{device, key?, receipt}` -> `{final|refunded, meter}`; `POST /api/duell/ai/status` `{device, key?}` -> `{meter}`.
- Einheit "KI-Aktion" nach Ausgabe-Token: bis 300 = 1, bis 900 = 2, darueber 3, Protokoll immer 3; Cache-Treffer 0. Abgebucht wird bei der Ausgabe (fertig, aber nie abgeholt: beim Verfall des Tickets),
  bei fast leerem Topf wird die Ausgabe des Modells auf das begrenzt, was der Topf noch traegt,
  "Verwerfen" schreibt innerhalb von `DUELL_AI_RECEIPT_TTL_S` gut, hoechstens halb so oft wie der Topf gross ist, "Uebernehmen" macht es endgueltig.
- Toepfe: Free 7 je Woche (Montag 00:00 UTC) je Geraet oder Konto; Pro und Business nur ueber einen Schluessel aus `DUELL_ENTITLEMENTS` (signiert mit `DUELL_ENTITLEMENT_SECRET`,
  erzeugt mit `node bin/duell-key.mjs pro|biz <id>`; von der Liste nehmen = widerrufen). Es gibt keinen Kaufweg. Pro: Monats-Topf fuer hoechstens 6 Geraete.
  Business: Team-Topf je Monat und, sobald ein Business-Schluessel existiert, ein reservierter Anteil der Tagesgrenze (hoechstens die Haelfte), den Free und Pro nicht nutzen.
  Protokolle zaehlen nie im Jugend-Zaehler: Business-Topf, sonst ein kleiner Protokoll-Probetopf je Geraet. `meter.resetAt` sagt immer, wann der Topf wieder voll ist.
- Strukturierte Arten (KI-Konzept Abschnitt 2, "Satz rein, gepruefte Struktur-JSON raus"; Daten, Mengen und Summen rechnet die App):
  `plan {art: termin|einladung|wichteln, satz<=200, ctx?}` -> Regeln (wochentage, tageszeiten, uhrzeit, dauer_min, zeitraum relativ, ort-Typ, mitbringen, budget_eur, thema, ideen, regeltext), temperature 0.1;
  `liste {art: einkauf|mitbring|aufgaben, satz<=300, ctx?}` -> posten `{n, kat, m: pro_person|fix|nach_bedarf, e, veg}` bzw. aufgaben `{was, frist relativ, wer: ""}`, personen/vegetarisch nur wie angegeben (zwei Gruppen wie "4 Erwachsene und 4 Kinder" -> personen 0, die App summiert); `liste {art: feedback, notizen[5..8, je <=60]}` -> `themen[3] (je <=30), vorschlag (<=120)`, kein Thema und kein Vorschlag wiederholt eine Notiz woertlich (`quotes`), Notizen nie im Cache; ehrliche Kritik sperrt nicht (eigene Eingangspruefung ohne `isMean`, nur ungeeignete Woerter und Kontaktdaten), eine Notiz "Ich kann nicht mehr" fuer sich zaehlt als Krise (`isSpent`), Namen nach Frau/Herr werden wie Vornamen ersetzt;
  `quiz {modus: lernen|gruppe|firma, thema<=80 | text<=3000, n 3-8, ctx?}` -> fragen `{f, a, d[3], quelle_im_text}` (vom Code gegen den Text geprueft) bzw. Gruppe: typen (nur Staerken) + fragen; kostet mindestens 2;
  `welt {satz<=140}` -> Config wie `/api/duell/config` plus `abschnitte[3] {physik, delta, thema, emoji}` aus festen Listen;
  `text {art: worte|spruch|song, anlass (feste Liste), insider<=80?, name?: true, ctx?}` -> 3 Varianten (worte <=80 Zeichen, spruch, song: hook + beat in einem Aufruf), Name nur als `{name}`.
  Jede Art: `kind_ok` im selben Aufruf (`false` -> `422 {error: blocked, why: kind_ok}`, kostenlos), Selbstgefaehrdung -> `422 {why: crisis, help}` ohne Modell (nur diese fuenf Arten),
  Jugendschutz (Alkohol mit Sorten, Mixgetraenken und Slang, Drogen/Rauchen mit Slang, Gluecksspiel, Waffen, Sexualitaet; mehrdeutige Woerter wie Radler, Korn, Gras nur im Trink- bzw. Konsumkontext) -> `422 blocked` vor dem Modell, in der Ausgabe faellt ein solcher Text weg (Lern-Quiz darf "Blut" sagen),
  Adressen/PLZ/Kontakt -> Platzhalter. Namen: die App ersetzt den Namen durch `{name}`; der Server ersetzt zusaetzlich nur haeufige Vornamen (Liste) durch `[Name]`
  bzw. `{name}` bei `name:true` - ein Name ausserhalb der Liste erreicht das Modell. Das Quiz-Thema bleibt unveraendert (Allgemeinwissen wie "Big Ben",
  "Sophie Scholl"); ein Text der Ausgabe mit einem Platzhalter (`[Name]`, `[Adresse]` ...) faellt weg. Eine Ablehnung (`kind_ok`) oder `bad-output` kostet nichts, obwohl die GPU arbeitet;
  dagegen schuetzen die Limits je IP und Geraet.
  Zahlen (Personen, Budget, Uhrzeit) nur, wenn sie in der Eingabe stehen, Cache nach normalisierter Eingabe (nie fuer eigenen Text, Name oder Insider). `ctx`: Profil-Kontext der App (<= 240 Zeichen).
  Qualitaetstor: `test/fixtures/duell-golden.json` (je Art 30 Faelle + Red-Teaming), Lauf gegen das Modell: `LITELLM_BASE_URL=... LITELLM_KEY_FILE=~/.config/cads/litellm-test.key node bin/duell-golden.mjs [--kind plan] [--redteam]`.
- Siegel: jede Option traegt `seals[i]` = `s2.<kind>.<zeit>.<HMAC ueber kind, Zeit und hashes[i]>` mit `hashes[i]` = base64url(SHA-256(kanonisches JSON der Option)), 43 Zeichen;
  pruefen mit `POST /api/duell/seal {seal, content}` oder `{seal, optionHash}` -> `{valid, kind, at}`. Aeltere `s1`-Siegel bleiben gueltig, pruefbar nur mit `content`.
- Melden: `POST /api/duell/report {reason: harm|sex|hate|private|wrong|other, kind?, link?, seal?, option? | optionHash?, consent?, content?}` -> `202 {id}`. Inhalt nur mit `consent:true`,
  keine IP, kein Geraet. `option` ist genau das, was das Siegel deckt (`options[i]` bzw. die Config ohne seal/meter/cost/receipt); dagegen wird das Siegel
  geprueft (`sealOk`), gespeichert wird `option` nie. Ein geprueftes `optionHash` steht im Datensatz, mit Inhalt dazu `contentOk` (passt der Inhalt zum Hash). Ein gueltiges Siegel bestimmt das `kind` der Meldung. Ablage `DUELL_REPORT_DIR/reports.jsonl` (Volume). Review mit `Authorization: Bearer <DUELL_ADMIN_TOKEN>`: `GET /api/duell/report`,
  `POST /api/duell/report/<id> {action: dismiss|block}` (`block` sperrt den Kurzlink, `410 blocked`), Inhalt wird mit der Entscheidung geloescht,
  spaetestens nach `DUELL_REPORT_KEEP_DAYS` (geprueft auch ohne Verkehr alle `DUELL_REPORT_EXPIRE_MS`, Standard 1 h). Ist es laut Client oder Siegel
  ein Protokoll, wird nie Inhalt gespeichert (Namen Dritter), nur das Siegel geprueft. `GET /api/duell/metrics`: nur kind, outcome, ms.
- `POST /api/duell/ai/weather` `{place, date}` -> `{place, date, hi, lo, rain, code, source}`: echte Werte von Open-Meteo fuer heute bis in 7 Tagen, ohne Modell und ohne Kontingent (`lib/duell-weather.mjs`). Grenzen: `DUELL_WEATHER_IP_PER_HOUR` (30), `DUELL_WEATHER_DAILY_MAX` (1000).
- Antworten: `429 quota` (Topf leer), `429 busy|queue-full|queue-timeout|daily-limit|rate-limited`, `202` (Ticket), `403 proof|devices|bad-key`, `409 pending`, `422 blocked`, `503 llm-unavailable|ai-off`.
  Die Seite faellt dann sofort auf ihren Weg ohne KI zurueck. Nur ausgegebene Ergebnisse zaehlen (und fertige, deren Ticket verfaellt).
- Ohne Konto zaehlt ein HMAC einer zufaelligen Geraete-ID; wer die App-Daten loescht, hat einen neuen Free-Topf, gedeckelt ueber IP-Limit, Tagesgrenze und neue Geraete je Stunde.
  Gespeichert werden nur HMACs und Zaehler, keine IP, keine E-Mail, keine Eingaben. Fotos und Audio bleiben auf dem Geraet.
- Durchsatz messen: `LITELLM_BASE_URL=... LITELLM_KEY_FILE=~/.config/cads/litellm-test.key node bin/duell-bench.mjs --par 1,2,3,4 --n 8`.

| ENV | Default | Bedeutung |
|-----|---------|-----------|
| `DUELL_AI_ENABLED` | 1 | `0` schaltet die KI-Aktionen ab, die Seite bleibt lokal |
| `DUELL_AI_FREE_PER_WEEK` | 7 | Free-Topf je Geraet bzw. Konto und Woche |
| `DUELL_AI_PRO_PER_MONTH` / `DUELL_AI_PRO_DEVICES` | 300 / 6 | Pro-Topf je Schluessel und Monat / Geraete je Schluessel |
| `DUELL_AI_BIZ_PER_MONTH` / `DUELL_AI_BIZ_RESERVED_PER_DAY` | 300 / 120 | Business-Topf je Team und Monat / reservierte Modellaufrufe je Tag |
| `DUELL_PROTOKOLL_TRIAL_PER_MONTH` | 3 | Protokoll ohne Team-Schluessel (ein Protokoll) je Geraet und Monat |
| `DUELL_AI_REFUND_SHARE` / `DUELL_AI_RECEIPT_TTL_S` | 0.5 / 1800 | Anteil des Topfs, der je Zeitraum gutgeschrieben werden kann / Gueltigkeit des Belegs |
| `DUELL_ENTITLEMENT_SECRET` / `DUELL_ENTITLEMENTS` | leer | Schluessel zum Signieren / Liste gueltiger Pro- und Business-Schluessel (kommagetrennt) |
| `DUELL_AI_SALT` | leer | Schluessel der HMACs. Ohne ihn wird nichts gespeichert und die Toepfe gelten nur bis zum Neustart |
| `DUELL_AI_STATE_FILE` | leer (Compose: `/var/lib/duell-ai/state.json`) | Zaehlerdatei auf dem Volume `duell-ai` |
| `DUELL_REPORT_DIR` | leer (Compose: `/var/lib/duell-ai/reports`) | Meldungen; ohne Verzeichnis `503` |
| `DUELL_REPORT_PER_HOUR` / `DUELL_REPORT_DAILY_MAX` | 5 / 300 | Meldungen je gehashter IP und Stunde / pro UTC-Tag |
| `DUELL_REPORT_KEEP_DAYS` | 30 | Loeschfrist: Inhalt offener Meldungen und entschiedene Datensaetze; offene Datensaetze nach dem Doppelten |
| `DUELL_REPORT_EXPIRE_MS` | 3600000 | wie oft die Loeschfrist auch ohne Verkehr angewandt wird (0 = nur bei Zugriff) |
| `DUELL_ADMIN_TOKEN` | leer (aus) | Token fuer Review und Messung (mindestens 16 Zeichen) |
| `DUELL_AI_KEYS_MAX` | 100000 | groesste Zaehlerdatei; die aeltesten Eintraege fallen zuerst heraus |
| `DUELL_AI_CACHE_TTL_S` / `DUELL_AI_CACHE_MAX` | 86400 / 300 | Antwort-Cache |
| `DUELL_WEATHER_IP_PER_HOUR` / `DUELL_WEATHER_DAILY_MAX` | 30 / 1000 | Wetteranfragen je gehashter IP und Stunde / pro UTC-Tag |
| `DUELL_IP_HEADER` / `DUELL_IP_SALT` | leer / zufaellig je Prozess | Kopfzeile mit der echten Client-IP, leer heisst keine Grenzen je IP hinter dem Tunnel; Salz der IP-Hashes |

## Notes

- Secrets (`.env`, `.pexels-key`, `.registry-token`) are NOT in this repo — provide out-of-band.
- `work/` is the runtime install dir (demo bundles install on first "Start"); not committed.
- Photos under `pexels/` are Pexels stock (attribution shown in-app + per photo).
