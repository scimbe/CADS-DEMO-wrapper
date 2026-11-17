# Release Freie Karte 2, P3/P4 auf ssh-united

Bau im Hintergrund, Spiel-Ursprung `spiel-f29c55da.bunsenbrenner.org`, „Karte fertig“ per Mail und Push. Die neue App bringt
ihren eigenen Service Worker `/duell/mdi-push-sw.js` (nur Push und Klick; er übernimmt den Scope `/duell` und zeigt auch die
alten Arten weiter). VAPID wie bisher über `DUELL_VAPID_*`. Dieses Dokument beschreibt nur, was beim Release passieren muss;
in diesem PR wird nichts davon ausgeführt.

Für jeden Release gilt der übliche Ablauf: Labor grün, Review, Staging, Rollback, Live-Prüfung wie ein Nutzer. Keycloak, core
und labor-setup.com werden nicht angefasst.

## Aufteilung

| Teil | Wer | Was |
|---|---|---|
| Produktions-Wrapper `demos-wrapper` | **Integrator**, eigenes Deploy-Muster (neues Image, gleiche Env plus Zusätze, deploy-check, automatischer Rollback) | Zusätze: `wrapper-zusatz.env` und `wrapper-mounts.txt` hier im Ordner |
| Netze, Spiel-Dienst, Pruef-Dienst, Bau-Worker, Firewall, spiel-agent | `release.sh` (Trockenlauf, `--ausfuehren`, `--rollback`) | ersetzt den Wrapper **nicht** und startet ihn nicht neu |

## Container

| Container | Image | Geheimnisse | Netz |
|---|---|---|---|
| `demos-wrapper` (bestehend) | `cads-demos-wrapper:<tag>` | Token, smtp.pass (read-only) | wie bisher; zusätzlich per `network connect` in `mdi-bau-net` (172.31.250.2), interner Listener `DUELL_BAU_PORT=8791` **ohne** veröffentlichten Port |
| `mdi-bau` (neu) | `mdi-bau:<tag>` (`apps/mdi/bau/Dockerfile`) | API-Key, Token (read-only) | `mdi-bau-net` (172.31.250.3) und `mdi-pruef-net`; Ausgang per Firewall nur zu `api.anthropic.com:443`, DNS und `172.31.250.2:8791` |
| `mdi-pruef` (neu) | dasselbe Image, `node bau/pruef-dienst.mjs` | **keine** | nur `mdi-pruef-net` (`--internal`, kein Ausgang); Chromium mit Sandbox (`MDI_CHROMIUM_SANDBOX=1`, seccomp-Profil), ohne WebRTC |
| `mdi-spiel-dienst` (neu) | dasselbe Image, `node bau/spiel-dienst.mjs` | keine | `127.0.0.1:8795`, dahinter der Tunnel `spiel-agent` |

Getrennt: Fremder Code läuft nur in `mdi-pruef`, der weder Key noch Token sieht und kein Netz nach außen hat. Der Worker
erreicht vom Wrapper nur den internen Listener, und der kennt nur `/api/intern/fk2/*`. Der öffentliche Port des Wrappers
antwortet auf `/api/intern/*` immer 404. Ohne `DUELL_IP_HEADER` bleibt der Bau aus (fail closed).

**Ports:** Der Produktions-Wrapper lauscht auf `127.0.0.1:8794`; bisher zeigen **beide** Tunnel dorthin (`demos-34a13a96` und
`spiel-f29c55da`). Das bleibt für den Wrapper so. Neu lauscht nur der Spiel-Dienst auf `127.0.0.1:8795`, und beim Release wird
allein der `spiel-agent` auf 8795 umgestellt. 8794 wird nie freigemacht oder gestoppt.

## Voraussetzungen

- `~/demos-wrapper-secrets/fk2-bau.token`: zufällig, mindestens 32 Zeichen, `chmod 600`.
- `~/demos-wrapper-secrets/smtp.env` (liegt schon): `SMTP_HOST=smtp.strato.de`, `SMTP_PORT=465`, `SMTP_SECURE=ssl`,
  `SMTP_USER=no-reply@bunsenbrenner.org`, `SMTP_FROM=no-reply@bunsenbrenner.org`, `SMTP_FROM_NAME=bunsenbrenner`.
  `~/demos-wrapper-secrets/smtp.pass` legt der User an.
- `~/demos-wrapper-secrets/anthropic.key` (oder `--double` für den Rauchtest ohne Modellaufrufe).
- seccomp-Profil für die Chromium-Sandbox: `utils/docker/seccomp_profile.json` aus dem Playwright-Repository, Tag `v1.56.1`,
  geprüft abgelegt unter `~/mdi-bau/chromium-seccomp.json` (oder `SECCOMP=…`). Es erlaubt Chromium die Namensräume seiner
  Sandbox; ohne es startet `mdi-pruef` nicht (kein Rückfall auf „ohne Sandbox“).
- `sudo` für `iptables` (Kette `DOCKER-USER`).
- spiel-agent: `~/workflow-pipelines/tunnels/spiel-agent/.env`, `start-on-boot.sh` und die PID-Datei
  `state/ct-agent.pid` (oder `SPIEL_AGENT_PID=…`).

## Schritte

1. **Integrator:** Wrapper mit neuem Image austauschen, gleiche Env plus `wrapper-zusatz.env`, Mounts aus
   `wrapper-mounts.txt` (Token und `smtp.pass` read-only, Volume `mdi-spiele` schreibend, `--env-file smtp.env`).
   `DUELL_IP_HEADER` bleibt gesetzt. deploy-check wie immer; bei Fehler automatischer Rollback.
2. `./release.sh <tag>` (Trockenlauf) und prüfen, dann `./release.sh <tag> --ausfuehren`:
   1. Image `mdi-bau:<tag>` bauen.
   2. Netze `mdi-bau-net` (172.31.250.0/29) und `mdi-pruef-net` (`--internal`) anlegen, den laufenden Wrapper mit
      `docker network connect --ip 172.31.250.2 --alias demos-wrapper` anhängen (kein Neustart).
   3. Spiel-Dienst auf `127.0.0.1:8795`, read-only.
   4. Pruef-Dienst nur in `mdi-pruef-net`, seccomp-Profil, `--cap-drop ALL`, read-only.
   5. Bau-Worker in `mdi-bau-net` (172.31.250.3), dann zusätzlich in `mdi-pruef-net`.
   6. Firewall in `DOCKER-USER` (Kommentar `mdi-bau`): vom Worker nur bestehende Verbindungen, `172.31.250.2:8791`, DNS und
      `api.anthropic.com:443` (zum Zeitpunkt des Release aufgelöst; ändern sich die Adressen, das Skript erneut laufen lassen
      bzw. die Regeln erneuern), alles andere verworfen.
   7. spiel-agent: `CT_AGENT_ORIGIN=127.0.0.1:8795` in `.env` (Sicherung `.env.bak-<zeit>`), den Prozess aus der PID-Datei
      beenden, nur wenn `/proc/<pid>/cmdline` `ct-agent` enthält, auf sein Ende warten, `start-on-boot.sh`. Kein `pkill`.
3. **Live-Prüfung wie ein Nutzer** (Tester-Konto): Satz → Fragen → Liste → „Ja, so bauen“ (1 Guthaben vorgemerkt) →
   E-Mail bzw. Mitteilung anhaken (Mitteilung erst nach Erlaubnis des Browsers) → Mail mit Link `?go=fertig&auftrag=…` →
   Ergebnis mit „ausprobiert“/„nicht automatisch prüfbar“ → „Probe spielen“ → Nachbessern mit eigenem Text → neues Ergebnis.
   Dazu `curl -sI https://spiel-f29c55da.bunsenbrenner.org/frame.html` (Kopfzeilen aus `frameCsp()`), `docker logs mdi-bau`,
   `docker logs mdi-pruef` und die Probe aus Schritt 8 des Skripts (der öffentliche Port des Wrappers ist vom Worker aus zu).
   Erfolg heißt: Ausgabe passt inhaltlich zur Eingabe, nicht nur HTTP 200.

## Rollback

- `./release.sh <tag> --rollback --ausfuehren` (prüft vorher `.env`, `start-on-boot.sh` und die PID-Datei):
  - stellt `CT_AGENT_ORIGIN` des spiel-agent auf `127.0.0.1:8794` zurück (gleicher Neustart wie oben),
  - entfernt die Firewall-Regeln mit dem Kommentar `mdi-bau`,
  - entfernt `mdi-bau`, `mdi-pruef` und `mdi-spiel-dienst`,
  - trennt den Wrapper von `mdi-bau-net` und entfernt beide Netze.
- Den Wrapper selbst rollt der Integrator mit seinem Muster zurück.
- Die Auftragsdateien bleiben; Aufträge im Zustand `wartet` werden beim nächsten Release gebaut. Vorgemerktes Guthaben bleibt
  vorgemerkt, bis der Bau endet; ein Rollback bucht nichts ab und nichts zurück.

## Kosten und Grenzen

- Worker (`apps/mdi/bau/konfig.mjs`): je Lauf höchstens 0,25 $ (Reserve vor jedem Aufruf), je UTC-Tag höchstens 5 $;
  Bauzeit hart 15 Minuten; Lease im Wrapper 20 Minuten, eine verlorene Lease kommt einmal zurück, beim zweiten Mal endet der
  Bau ehrlich mit „fehler“.
- Guthaben: 1 bei der Bestellung vorgemerkt; gebucht bei Erfolg oder „So behalten“; freigegeben ohne Spiel, nach einer
  Meldung, beim Löschen oder nach 30 Tagen ohne Entscheidung (`VORMERK_TAGE`). Wird danach eine Nachbesserung ein voller
  Erfolg, wird erneut vorgemerkt und gebucht; ohne Guthaben bleibt die vorige Version (Hinweis „guthaben_fehlt“).
- Push „Karte fertig“ hat ein eigenes Budget (`DUELL_PUSH_KARTE_MARK_PER_DAY`, `DUELL_PUSH_KARTE_DAILY_MAX`), getrennt von
  `/wake`.
