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
| Netze, Spiel-Dienst, Pruef-Dienst, Egress-Proxy, Bau-Worker, spiel-agent | `release.sh` (Trockenlauf, `--ausfuehren`, `--rollback`) | ersetzt den Wrapper **nicht** und startet ihn nicht neu; ändert nichts am Host (keine Firewall, kein sudo) |

## Container

| Container | Image | Geheimnisse | Netz |
|---|---|---|---|
| `demos-wrapper` (bestehend) | `cads-demos-wrapper:<tag>` | Token, smtp.pass (read-only) | wie bisher; zusätzlich per `network connect` in `mdi-bau-net`; interner Listener `DUELL_BAU_PORT=8791` **ohne** veröffentlichten Port; aus `DUELL_BAU_NETZ` beantwortet der öffentliche Port nichts |
| `mdi-bau` (neu) | `mdi-bau:<tag>` (`apps/mdi/bau/Dockerfile`) | API-Key, Token (read-only) | nur `mdi-bau-net` und `mdi-pruef-net`, beide `--internal` (kein Ausgang, kein externes DNS); zur Modell-API nur über `HTTPS_PROXY=http://mdi-egress:3128` |
| `mdi-egress` (neu) | dasselbe Image, `node bau/egress-proxy.mjs` | keine | `mdi-egress-net` (normal) und `mdi-bau-net`; lässt nur `CONNECT api.anthropic.com:443` durch, löst DNS auf, sonst 403/405 |
| `mdi-pruef` (neu) | dasselbe Image, `node bau/pruef-dienst.mjs` | **keine** | nur `mdi-pruef-net` (`--internal`, kein Ausgang); Chromium mit Sandbox (`MDI_CHROMIUM_SANDBOX=1`, seccomp-Profil, `--cap-drop ALL --cap-add SYS_CHROOT`), ohne WebRTC |
| `mdi-spiel-dienst` (neu) | dasselbe Image, `node bau/spiel-dienst.mjs` | keine | `127.0.0.1:8795`, dahinter der Tunnel `spiel-agent` |

Getrennt: Fremder Code läuft nur in `mdi-pruef`, der weder Key noch Token sieht und kein Netz nach außen hat. Der Worker
kommt nur über den Egress-Proxy hinaus, und der nur zu `api.anthropic.com:443`. Vom Wrapper erreicht der Worker nur den
internen Listener (`/api/intern/fk2/*`); der öffentliche Port antwortet auf Anfragen aus `mdi-bau-net` (`DUELL_BAU_NETZ`) und auf
`/api/intern/*` immer 404. Ohne `DUELL_IP_HEADER` oder `DUELL_BAU_NETZ` bleibt der Bau aus (fail closed).

**Ports:** Der Produktions-Wrapper lauscht auf `127.0.0.1:8794`; bisher zeigen **beide** Tunnel dorthin (`demos-34a13a96` und
`spiel-f29c55da`). Das bleibt für den Wrapper so. Neu lauscht nur der Spiel-Dienst auf `127.0.0.1:8795`, und beim Release wird
allein der `spiel-agent` auf 8795 umgestellt. 8794 wird nie freigemacht oder gestoppt.

## Voraussetzungen

- `~/demos-wrapper-secrets/fk2-bau.token`: zufällig, mindestens 32 Zeichen, `chmod 600`.
- `~/demos-wrapper-secrets/smtp.env` (liegt schon): `SMTP_HOST=smtp.strato.de`, `SMTP_PORT=465`, `SMTP_SECURE=ssl`,
  `SMTP_USER=no-reply@bunsenbrenner.org`, `SMTP_FROM=no-reply@bunsenbrenner.org`, `SMTP_FROM_NAME=bunsenbrenner`.
  `~/demos-wrapper-secrets/smtp.pass` legt der User an.
- `~/demos-wrapper-secrets/anthropic.key` (oder `--double` für den Rauchtest ohne Modellaufrufe).
- seccomp-Profil für die Chromium-Sandbox: `release.sh` lädt es von
  `https://raw.githubusercontent.com/microsoft/playwright/v1.56.1/utils/docker/seccomp_profile.json` und prüft die sha256 aus
  `chromium-seccomp.sha256` (hier im Ordner) vor der Verwendung; bei Abweichung bricht es ab. Ohne Profil startet `mdi-pruef`
  nicht (kein Rückfall auf „ohne Sandbox“).
- Kein `sudo`, keine Änderung an der Host-Firewall.
- spiel-agent: `~/workflow-pipelines/tunnels/spiel-agent/.env`, `start-on-boot.sh` und die PID-Datei
  `state/ct-agent.pid` (oder `SPIEL_AGENT_PID=…`).

## Schritte

1. **Integrator:** Wrapper mit neuem Image austauschen, gleiche Env plus `wrapper-zusatz.env`, Mounts aus
   `wrapper-mounts.txt` (Token und `smtp.pass` read-only, Volume `mdi-spiele` schreibend, `--env-file smtp.env`).
   `DUELL_IP_HEADER` bleibt gesetzt. deploy-check wie immer; bei Fehler automatischer Rollback.
2. `./release.sh <tag>` (Trockenlauf) und prüfen, dann `./release.sh <tag> --ausfuehren`:
   1. Image `mdi-bau:<tag>` bauen.
   2. seccomp-Profil laden, sha256 prüfen.
   3. Netze `mdi-bau-net` (`--internal`, 172.31.250.0/28 = `DUELL_BAU_NETZ`), `mdi-pruef-net` (`--internal`) und
      `mdi-egress-net` (normal) anlegen, den laufenden Wrapper mit `docker network connect --alias demos-wrapper` anhängen
      (kein Neustart).
   4. Spiel-Dienst auf `127.0.0.1:8795`, read-only.
   5. Pruef-Dienst nur in `mdi-pruef-net`, seccomp-Profil, `--cap-drop ALL`, read-only.
   6. Egress-Proxy in `mdi-egress-net`, dann zusätzlich in `mdi-bau-net` (Alias `mdi-egress`), Allowlist
      `api.anthropic.com:443`.
   7. Bau-Worker in `mdi-bau-net`, dann zusätzlich in `mdi-pruef-net`; `HTTPS_PROXY=http://mdi-egress:3128`.
   8. spiel-agent: `CT_AGENT_ORIGIN=127.0.0.1:8795` in `.env` (Sicherung `.env.bak-<zeit>`), den Prozess aus der PID-Datei
      beenden, nur wenn `/proc/<pid>/cmdline` `ct-agent` enthält, auf sein Ende warten, `start-on-boot.sh`. Kein `pkill`.
      Ist die PID kein laufender ct-agent, bricht das Skript ab (`.env` unverändert, nichts gestartet).
   Vor Schritt 1 prüft das Skript den Bestand: Gibt es einen der vier Container schon, bricht es ab (erst `--rollback`);
   ein vorhandenes Netz wird nur weiterverwendet, wenn `internal` (und bei `mdi-bau-net` das Subnetz) passt; ein schon
   angehängter Wrapper bleibt angehängt.
3. **Live-Prüfung wie ein Nutzer** (Tester-Konto): Satz → Fragen → Liste → „Ja, so bauen“ (1 Guthaben vorgemerkt) →
   E-Mail bzw. Mitteilung anhaken (Mitteilung erst nach Erlaubnis des Browsers) → Mail mit Link `?go=fertig&auftrag=…` →
   Ergebnis mit „ausprobiert“/„nicht automatisch prüfbar“ → „Probe spielen“ → Nachbessern mit eigenem Text → neues Ergebnis.
   Dazu `curl -sI https://spiel-f29c55da.bunsenbrenner.org/frame.html` (Kopfzeilen aus `frameCsp()`), `docker logs mdi-bau`,
   `docker logs mdi-pruef`, `docker logs mdi-egress` und die Proben am Ende des Skripts (vom Worker: kein Ausgang ohne
   Proxy, öffentlicher Port des Wrappers 404).
   Erfolg heißt: Ausgabe passt inhaltlich zur Eingabe, nicht nur HTTP 200.

## Rollback

- `./release.sh <tag> --rollback --ausfuehren` (prüft vorher `.env`, `start-on-boot.sh` und die PID-Datei):
  - stellt `CT_AGENT_ORIGIN` des spiel-agent auf `127.0.0.1:8794` zurück (gleicher Neustart wie oben),
  - entfernt `mdi-bau`, `mdi-pruef`, `mdi-egress` und `mdi-spiel-dienst`,
  - trennt den Wrapper von `mdi-bau-net` und entfernt alle drei Netze.
  - Jeder Schritt läuft nur, wenn es das Teil noch gibt: ein abgebrochener Release lässt sich so vollständig und beliebig oft
    zurücknehmen. Scheitert nur der spiel-agent (PID kein ct-agent), räumt der Rollback trotzdem Container und Netze ab und
    endet mit Fehler, damit der Agent von Hand geprüft wird.
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
