#!/usr/bin/env bash
# Freie Karte 2, P3/P4: Release-Schritte auf ssh-united (siehe README.md daneben). Standard ist ein Trockenlauf: das Skript
# prueft die Voraussetzungen und druckt jeden Befehl. Ausgefuehrt wird nur mit --ausfuehren. Es fasst weder Keycloak noch
# core noch labor-setup.com an und gibt kein Geheimnis aus (nur Pfade und ob die Datei da ist).
#
#   ./release.sh <tag> [--ausfuehren] [--double]      z. B. ./release.sh fk2-20261119 --double
#   --double  Bau-Worker mit Modell-Double (MDI_BAU_MODELL_DOUBLE=1): Rauchtest ohne API, solange das Kontolimit gilt
#   ./release.sh <tag> --rollback [--ausfuehren]      neue Container weg, Wrapper zurueck auf den Container vor dem Release
set -euo pipefail
TAG="${1:?Tag fehlt, z. B. fk2-20261119}"; shift
RUN=0; DOUBLE=0; ROLLBACK=0
for a in "$@"; do case "$a" in --ausfuehren) RUN=1;; --double) DOUBLE=1;; --rollback) ROLLBACK=1;; *) echo "unbekannt: $a" >&2; exit 2;; esac; done

SECRETS="${SECRETS:-$HOME/demos-wrapper-secrets}"
APP_SRC="${APP_SRC:-$HOME/src/CADS-agent-marketplace}"          # Checkout der App auf dem Release-Commit
WRAPPER="${WRAPPER:-demos-wrapper}"                              # Produktions-Container des Wrappers
NET="${NET:-$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$WRAPPER" 2>/dev/null | awk '{print $1}')}"
SPIEL_ORIGIN="https://spiel-f29c55da.bunsenbrenner.org"
APP_ORIGINS="https://demos-34a13a96.bunsenbrenner.org,https://bunsenbrenner.org"
STAMP="$(date -u +%Y%m%d%H%M)"

say() { printf '%s\n' "$*"; }
do_() { say "+ $*"; if [ "$RUN" = 1 ]; then "$@"; fi; }
need() { if [ -s "$1" ]; then say "ok   $1"; else say "FEHLT $1"; MISSING=1; fi; }

if [ "$ROLLBACK" = 1 ]; then
  say "== Rollback Freie Karte 2 P3/P4 =="
  do_ docker rm -f mdi-bau mdi-spiel-dienst
  PRE="$(docker ps -a --format '{{.Names}}' | grep "^${WRAPPER}-pre-fk2-" | sort | tail -1 || true)"
  if [ -n "$PRE" ]; then do_ docker rm -f "$WRAPPER"; do_ docker rename "$PRE" "$WRAPPER"; do_ docker start "$WRAPPER"; else say "kein ${WRAPPER}-pre-fk2-* gefunden: Wrapper bleibt"; fi
  say "Danach: frueheren Dienst auf 127.0.0.1:8794 wieder starten, falls vorher einer lief (siehe README, Schritt 0)."
  exit 0
fi

say "== Pruefen =="
MISSING=0
need "$SECRETS/smtp.env"; need "$SECRETS/smtp.pass"; need "$SECRETS/fk2-bau.token"
[ "$DOUBLE" = 1 ] || need "$SECRETS/anthropic.key"
[ -n "$NET" ] && say "ok   Netz des Wrappers: $NET" || { say "FEHLT Netz des Wrappers ($WRAPPER laeuft?)"; MISSING=1; }
if ss -ltn 2>/dev/null | grep -q '127.0.0.1:8794 '; then say "HINWEIS 127.0.0.1:8794 ist belegt (bisher die ganze App, siehe README Schritt 0): vorher beenden"; fi
df -h / | tail -1 | awk '{ if ($5+0 >= 95) print "WARNUNG Platte zu " $5 " voll: alte Images entfernen"; else print "ok   Platte " $5 }'
[ "$MISSING" = 0 ] || { say "Abbruch: Voraussetzungen fehlen."; exit 1; }

say "== 1 Image des Bau-Workers und Spiel-Dienstes =="
do_ docker build -f "$APP_SRC/apps/mdi/bau/Dockerfile" -t "mdi-bau:$TAG" "$APP_SRC/apps/mdi"
do_ docker volume create mdi-spiele
do_ docker volume create mdi-bau-state

say "== 2 Statischer Spiel-Dienst auf 127.0.0.1:8794 (nur Rahmen und Module, read-only) =="
do_ docker run -d --name mdi-spiel-dienst --restart unless-stopped \
  -p 127.0.0.1:8794:8794 --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m --cpus 0.5 \
  -v mdi-spiele:/data/spiele:ro \
  -e SPIEL_ORIGIN="$SPIEL_ORIGIN" -e APP_ORIGINS="$APP_ORIGINS" -e SPIEL_MODULE_DIR=/data/spiele -e SPIEL_PORT=8794 \
  "mdi-bau:$TAG" node bau/spiel-dienst.mjs

say "== 3 Wrapper neu mit Bau-Schnittstelle, Modul-Volume und Mail (Rollback-Container bleibt) =="
say "   Der Wrapper-Container wird mit seinen BISHERIGEN Parametern neu angelegt (Image cads-demos-wrapper:$TAG), dazu:"
cat <<FLAGS
     -e DUELL_BAU=on -e DUELL_BAU_TOKEN_FILE=/run/secrets/fk2-bau.token
     -e DUELL_SPIEL_ORIGIN=$SPIEL_ORIGIN -e DUELL_SPIEL_MODULE_DIR=/data/spiele
     -e DUELL_APP_URL=https://demos-34a13a96.bunsenbrenner.org/duell
     --env-file $SECRETS/smtp.env -e SMTP_PASS_FILE=/run/secrets/smtp.pass
     -v $SECRETS/fk2-bau.token:/run/secrets/fk2-bau.token:ro
     -v $SECRETS/smtp.pass:/run/secrets/smtp.pass:ro
     -v mdi-spiele:/data/spiele
FLAGS
do_ docker stop "$WRAPPER"
do_ docker rename "$WRAPPER" "$WRAPPER-pre-fk2-$STAMP"
say "+ docker run -d --name $WRAPPER <bisherige Parameter> <Zusaetze oben> cads-demos-wrapper:$TAG   (von Hand, siehe README Schritt 3)"

say "== 4 Bau-Worker (eigener Container, kein Port, getrennt vom Wrapper) =="
KEY_ARGS=(-v "$SECRETS/anthropic.key:/run/secrets/anthropic.key:ro" -e MDI_ANTHROPIC_KEY_FILE=/run/secrets/anthropic.key)
[ "$DOUBLE" = 1 ] && KEY_ARGS=(-e MDI_BAU_MODELL_DOUBLE=1)
do_ docker run -d --name mdi-bau --restart unless-stopped --network "$NET" \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 2g --cpus 1.5 --shm-size 512m --read-only --tmpfs /tmp:size=512m \
  -v mdi-bau-state:/var/lib/mdi-bau \
  -v "$SECRETS/fk2-bau.token:/run/secrets/fk2-bau.token:ro" "${KEY_ARGS[@]}" \
  -e MDI_BAU_QUEUE_URL="http://$WRAPPER:8790" -e MDI_BAU_TOKEN_FILE=/run/secrets/fk2-bau.token -e MDI_BAU_STATE_DIR=/var/lib/mdi-bau \
  -e MDI_BAU_MODELL_PLANER=claude-haiku-5-5 -e MDI_BAU_MODELL_BAUER=claude-haiku-5-5 -e MDI_BAU_MODELL_ABNAHME=claude-haiku-5-5 \
  "mdi-bau:$TAG"

say "== 5 Pruefen (wie ein Nutzer, siehe README Schritt 5) =="
say "+ curl -sI $SPIEL_ORIGIN/frame.html   (Content-Security-Policy mit sandbox allow-scripts, frame-ancestors der App)"
say "+ docker logs --tail 20 mdi-bau        (fk2-bau-start, keine Fehler)"
[ "$RUN" = 1 ] || say "Trockenlauf: nichts ausgefuehrt. Mit --ausfuehren wirklich."
