# Release Freie Karte 2, P3/P4 auf ssh-united

Bau im Hintergrund (eigener Worker-Container), Spiel-Ursprung `spiel-f29c55da.bunsenbrenner.org` und „Karte fertig“ per
Push/Mail. Die neue App bekommt dafür ihren eigenen Service Worker `/duell/mdi-push-sw.js` (nur Push und Klick); der alte
`/duell/push-sw.js` bleibt unberührt. VAPID wie bisher über `DUELL_VAPID_*`. Dieses Dokument beschreibt nur, was beim Release passieren muss; ausgeführt wird nichts davon in diesem PR.
Skript: `release.sh` daneben (Standard: Trockenlauf, druckt jeden Befehl).

Für jeden Release gilt der übliche Ablauf: Labor grün, Review, Staging, Rollback-Container, Live-Prüfung wie ein Nutzer.
Keycloak, core und labor-setup.com werden nicht angefasst. Neue Produktentscheidungen (unten „offen“) brauchen den User.

## Bausteine

| Container | Image | Zweck | Netz |
|---|---|---|---|
| `demos-wrapper` (bestehend) | `cads-demos-wrapper:<tag>` | App, Klärung, Warteschlange `/api/intern/fk2/*`, Guthaben, Mail | wie bisher, nur über den Tunnel |
| `mdi-bau` (neu) | `mdi-bau:<tag>` aus `apps/mdi/bau/Dockerfile` (App-Repo) | holt Aufträge, Modell-Aufrufe, führt fremden Code in Playwright aus | eigenes Netz `mdi-bau-net` (nur Worker + Wrapper, Ausgang für die API), **kein Port** |
| `mdi-spiel-dienst` (neu) | dasselbe Image, Befehl `node bau/spiel-dienst.mjs` | liefert nur `frame.html/js/css` und `/m/<sha256>.js` | `127.0.0.1:8795`, dahinter der Tunnel `spiel-agent` |

**Ports:** Der Produktions-Wrapper lauscht auf `127.0.0.1:8794`; bisher zeigen **beide** Tunnel dorthin (`demos-34a13a96` und
`spiel-f29c55da`). Das bleibt für den Wrapper so. Neu lauscht nur der Spiel-Dienst auf `127.0.0.1:8795`, und beim Release wird
allein der `spiel-agent` auf 8795 umgestellt. 8794 wird nie freigemacht oder gestoppt.

Getrennt: Der Wrapper führt nie generierten Code aus. Der Worker hat keinen Zugriff auf Volumes des Wrappers außer dem
Token; Module schreibt nur der Wrapper (nach Prüfung von Hash, Größe und Ergebnis) in das Volume `mdi-spiele`, der
Spiel-Dienst liest es read-only.

## Schritte

0. **Nichts an 8794 ändern.** Vorher nur nachsehen: `docker port demos-wrapper` (Container-Port hinter 127.0.0.1:8794),
   `~/workflow-pipelines/tunnels/spiel-agent/.env` (`CT_AGENT_ORIGIN=127.0.0.1:8794`), PID-Datei des spiel-agent, 8795 frei.
1. **Geheimnisse anlegen** (nur Dateien, nie im Repo, nie im Log):
   - `~/demos-wrapper-secrets/fk2-bau.token`: zufällig, mind. 32 Zeichen (`openssl rand -base64 33 > …; chmod 600`).
   - `~/demos-wrapper-secrets/smtp.env` (liegt schon): `SMTP_HOST=smtp.strato.de`, `SMTP_PORT=465`, `SMTP_SECURE=ssl`,
     `SMTP_USER=no-reply@bunsenbrenner.org`, `SMTP_FROM=no-reply@bunsenbrenner.org`, `SMTP_FROM_NAME=bunsenbrenner`.
     Andere Variablennamen in der Datei vorher angleichen.
   - `~/demos-wrapper-secrets/smtp.pass`: legt der User an. Read-only nach `/run/secrets/smtp.pass`.
   - `~/demos-wrapper-secrets/anthropic.key`: derselbe Key-Typ wie `DUELL_ANTHROPIC_KEY_FILE`. Bis zum 01.12. gilt das
     Kontolimit: dann `--double` (Modell-Double, baut immer die Vorlage, bucht nie ab).
2. **Images**: Wrapper wie gewohnt bauen (`cads-demos-wrapper:<tag>`), Worker mit
   `docker build -f apps/mdi/bau/Dockerfile -t mdi-bau:<tag> apps/mdi`. Platte vorher prüfen (am 17.11. 97 %).
3. **Wrapper neu anlegen** mit den bisherigen Parametern, alter Container als `demos-wrapper-pre-fk2-<zeit>` behalten.
   Zusätzlich:
   - Env: `DUELL_BAU=on`, `DUELL_BAU_TOKEN_FILE=/run/secrets/fk2-bau.token`,
     `DUELL_SPIEL_ORIGIN=https://spiel-f29c55da.bunsenbrenner.org`, `DUELL_SPIEL_MODULE_DIR=/data/spiele`,
     `DUELL_APP_URL=https://demos-34a13a96.bunsenbrenner.org/duell`, `--env-file ~/demos-wrapper-secrets/smtp.env`,
     `SMTP_PASS_FILE=/run/secrets/smtp.pass`. `DUELL_IP_HEADER` muss gesetzt sein (wie bisher): daran erkennt der Wrapper
     Anfragen aus dem Tunnel, für die `/api/intern/fk2/*` nicht existiert.
   - Mounts: `fk2-bau.token` und `smtp.pass` read-only, Volume `mdi-spiele` nach `/data/spiele` (schreibend).
   - Schalter: `DUELL_KLAERUNG` bleibt wie entschieden (Standard aus; für den Tester-Durchlauf nach A2). Ohne `DUELL_BAU=on`
     verhält sich alles wie P1 (kein Bau, keine Abbuchung).
4. **Spiel-Dienst und Worker starten** (`release.sh`, Schritte 2 und 4): Spiel-Dienst mit `--read-only --cap-drop ALL`,
   `-p 127.0.0.1:8795:8795`, `APP_ORIGINS=https://demos-34a13a96.bunsenbrenner.org,https://bunsenbrenner.org`.
   Netz `mdi-bau-net` anlegen und den Wrapper mit `docker network connect --alias demos-wrapper` anhängen (ohne Neustart).
   Worker nur in `mdi-bau-net`, ohne Port, `--read-only --tmpfs /tmp --cap-drop ALL --memory 2g --cpus 1.5`, Kostenbuch im
   Volume `mdi-bau-state`, `MDI_BAU_QUEUE_URL=http://demos-wrapper:<Container-Port>`. Modelle je Rolle per
   `MDI_BAU_MODELL_PLANER|BAUER|ABNAHME` (Standard Haiku 5.5, Variante A).
5. **Spiel-Ursprung umstellen:** nur in `~/workflow-pipelines/tunnels/spiel-agent/.env` `CT_AGENT_ORIGIN=127.0.0.1:8795`
   setzen (Sicherung `.env.bak-<zeit>`), den spiel-agent über seine PID-Datei beenden und mit `start-on-boot.sh` neu starten.
   Kein `pkill`. Der Tunnel `demos-34a13a96` bleibt unberührt auf 8794.
6. **Live-Prüfung wie ein Nutzer** (Tester-Konto): Satz → Fragen → Liste → „Ja, so bauen“ → E-Mail anhaken → Mail kommt
   mit Link `?go=fertig&auftrag=…` → Ergebnis mit „ausprobiert“/„nicht automatisch prüfbar“ → „Probe spielen“ startet das
   Spiel im Rahmen vom Spiel-Ursprung → Nachbessern mit eigenem Text → neues Ergebnis. Dazu
   `curl -sI https://spiel-f29c55da.bunsenbrenner.org/frame.html` (genau die Kopfzeilen aus `frameCsp()`), `docker logs mdi-bau`.
   Erfolg heißt: Ausgabe passt inhaltlich zur Eingabe, nicht nur HTTP 200.

## Rollback

`./release.sh <tag> --rollback --ausfuehren`: stellt zuerst `CT_AGENT_ORIGIN` des spiel-agent auf `127.0.0.1:8794` zurück
und startet ihn über PID-Datei und `start-on-boot.sh` neu, entfernt `mdi-bau`, `mdi-spiel-dienst` und das Netz `mdi-bau-net`,
benennt `demos-wrapper-pre-fk2-*` zurück und startet ihn. Die Auftragsdateien bleiben; Aufträge im Zustand `wartet` werden
beim nächsten Release wieder gebaut. Vorgemerktes Guthaben bleibt vorgemerkt, bis der Bau endet (dann gebucht oder
freigegeben); ein Rollback bucht nichts zurück und nichts ab.

## Kosten und Grenzen (Konstanten im Worker, `apps/mdi/bau/konfig.mjs`)

- je Lauf (Bau oder Nachbesserung) höchstens 0,25 $ (Reserve vor jedem Aufruf), je UTC-Tag höchstens 5 $; darüber holt der
  Worker nichts mehr bis zum nächsten Tag.
- Guthaben: 1 bei der Bestellung vorgemerkt, gebucht bei Erfolg oder „So behalten“, freigegeben ohne Spiel, nach einer
  Meldung, beim Löschen oder nach 30 Tagen ohne Entscheidung (`VORMERK_TAGE`).
- Bauzeit hart 15 Minuten (AbortSignal), Lease im Wrapper 20 Minuten; eine verlorene Lease kommt einmal zurück in die
  Warteschlange, beim zweiten Mal endet der Bau ehrlich mit „fehler“ (nichts abgebucht).
