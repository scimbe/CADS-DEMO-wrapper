#!/usr/bin/env bash
# Freie Karte 2, P3/P4: Release-Schritte auf ssh-united (README.md daneben). Standard ist ein Trockenlauf: das Skript prueft
# die Voraussetzungen und druckt jeden Befehl. Ausgefuehrt wird nur mit --ausfuehren. Es fasst weder Keycloak noch core noch
# labor-setup.com an und gibt kein Geheimnis aus (nur Pfade und ob die Datei da ist).
#
# Den Produktions-Wrapper tauscht dieses Skript NICHT aus (Review B1): das macht der Integrator mit seinem Deploy-Muster
# (wrapper-zusatz.env, wrapper-mounts.txt). Hier nur, was dazukommt und ohne Neustart des Wrappers geht:
#   Netze, den LAUFENDEN Wrapper per "docker network connect" anhaengen, Spiel-Dienst (127.0.0.1:8795), Pruef-Dienst (Chromium,
#   ohne Geheimnisse, ohne Netz), Bau-Worker (Key + Token, Ausgang nur zur Modell-API und zum internen Port des Wrappers),
#   Firewall (DOCKER-USER), Umstellung des spiel-agent. --rollback nimmt genau diese Teile zurueck.
#
#   ./release.sh <tag> [--ausfuehren] [--double]
#   ./release.sh <tag> --rollback [--ausfuehren]
#   --double  Bau-Worker mit Modell-Double (MDI_BAU_MODELL_DOUBLE=1): Rauchtest ohne Modellaufrufe
set -euo pipefail
TAG="${1:?Tag fehlt, z. B. fk2-20261119}"; shift
RUN=0; DOUBLE=0; ROLLBACK=0
for a in "$@"; do case "$a" in --ausfuehren) RUN=1;; --double) DOUBLE=1;; --rollback) ROLLBACK=1;; *) echo "unbekannt: $a" >&2; exit 2;; esac; done

SECRETS="${SECRETS:-$HOME/demos-wrapper-secrets}"
APP_SRC="${APP_SRC:-$HOME/src/CADS-agent-marketplace}"            # Checkout der App auf dem Release-Commit
WRAPPER="${WRAPPER:-demos-wrapper}"                                # laufender Produktions-Container (bleibt, wie er ist)
SPIEL_AGENT="${SPIEL_AGENT:-$HOME/workflow-pipelines/tunnels/spiel-agent}"
SPIEL_AGENT_PID="${SPIEL_AGENT_PID:-$SPIEL_AGENT/state/ct-agent.pid}"
# seccomp-Profil fuer die Chromium-Sandbox: das Profil aus dem Playwright-Repository (utils/docker/seccomp_profile.json) zur
# Version 1.56.1, vorher geprueft abgelegt (README, Voraussetzungen). Ohne es startet der Pruef-Dienst nicht.
SECCOMP="${SECCOMP:-$SECRETS/../mdi-bau/chromium-seccomp.json}"
SPIEL_ORIGIN="https://spiel-f29c55da.bunsenbrenner.org"
APP_ORIGINS="https://demos-34a13a96.bunsenbrenner.org,https://bunsenbrenner.org"
BAU_NET="mdi-bau-net"; BAU_SUBNET="172.31.250.0/29"; IP_WRAPPER="172.31.250.2"; IP_BAU="172.31.250.3"
PRUEF_NET="mdi-pruef-net"
INTERN_PORT=8791                                                   # DUELL_BAU_PORT im Wrapper (wrapper-zusatz.env)
FW_TAG="mdi-bau"                                                   # Kommentar aller Firewall-Regeln (fuer den Rollback)
STAMP="$(date -u +%Y%m%d%H%M)"

say() { printf '%s\n' "$*"; }
do_() { say "+ $*"; if [ "$RUN" = 1 ]; then "$@"; fi; }
MISSING=0
need() { if [ -s "$1" ]; then say "ok   $1"; else say "FEHLT $1"; MISSING=1; fi; }

# spiel-agent: Origin in .env umstellen, den Agent ueber seine PID-Datei beenden (nur wenn die PID wirklich ct-agent ist),
# auf das Ende warten und mit start-on-boot.sh neu starten (kein pkill; Review S6)
agent_origin() {
  local ziel="$1"
  say "+ sed -i 's#^CT_AGENT_ORIGIN=.*#CT_AGENT_ORIGIN=$ziel#' $SPIEL_AGENT/.env   (Sicherung .env.bak-$STAMP)"
  say "+ kill \$(cat $SPIEL_AGENT_PID)  (nur wenn /proc/<pid>/cmdline ct-agent enthaelt), warten, $SPIEL_AGENT/start-on-boot.sh"
  [ "$RUN" = 1 ] || return 0
  cp "$SPIEL_AGENT/.env" "$SPIEL_AGENT/.env.bak-$STAMP"
  sed -i "s#^CT_AGENT_ORIGIN=.*#CT_AGENT_ORIGIN=$ziel#" "$SPIEL_AGENT/.env"
  local pid; pid="$(cat "$SPIEL_AGENT_PID")"
  if [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q 'ct-agent'; then
    kill "$pid"
    for _ in $(seq 1 40); do [ -d "/proc/$pid" ] || break; sleep 0.5; done
    if [ -d "/proc/$pid" ]; then say "ABBRUCH: ct-agent ($pid) endet nicht; nichts neu gestartet"; exit 1; fi
  else
    say "HINWEIS: PID $pid ist kein laufender ct-agent; es wird nichts beendet"
  fi
  "$SPIEL_AGENT/start-on-boot.sh"
}

# Firewall: der Bau-Worker darf nur zum internen Port des Wrappers, per HTTPS zur Modell-API und DNS; sonst nichts.
# DOCKER-USER sieht auch den Verkehr zwischen Containern einer Bridge (br_netfilter). Alle Regeln tragen den Kommentar FW_TAG.
fw_regeln() {
  local api_ips; api_ips="$(getent ahostsv4 api.anthropic.com | awk '{print $1}' | sort -u)"
  [ -n "$api_ips" ] || { say "FEHLT DNS fuer api.anthropic.com"; exit 1; }
  say "   api.anthropic.com -> $(echo $api_ips)"
  # Reihenfolge mit -I 1: zuletzt eingefuegt steht oben; darum DROP zuerst einfuegen
  do_ sudo iptables -I DOCKER-USER 1 -s "$IP_BAU" -j DROP -m comment --comment "$FW_TAG"
  for ip in $api_ips; do do_ sudo iptables -I DOCKER-USER 1 -s "$IP_BAU" -d "$ip" -p tcp --dport 443 -j RETURN -m comment --comment "$FW_TAG"; done
  do_ sudo iptables -I DOCKER-USER 1 -s "$IP_BAU" -p udp --dport 53 -j RETURN -m comment --comment "$FW_TAG"
  do_ sudo iptables -I DOCKER-USER 1 -s "$IP_BAU" -p tcp --dport 53 -j RETURN -m comment --comment "$FW_TAG"
  do_ sudo iptables -I DOCKER-USER 1 -s "$IP_BAU" -d "$IP_WRAPPER" -p tcp --dport "$INTERN_PORT" -j RETURN -m comment --comment "$FW_TAG"
  do_ sudo iptables -I DOCKER-USER 1 -s "$IP_BAU" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN -m comment --comment "$FW_TAG"
}
fw_weg() {
  say "+ sudo iptables -S DOCKER-USER | grep -- '--comment $FW_TAG' | sed 's/^-A/-D/' | xargs -L1 sudo iptables"
  [ "$RUN" = 1 ] || return 0
  sudo iptables -S DOCKER-USER | grep -- "--comment $FW_TAG" | sed 's/^-A /-D /' | while read -r r; do sudo iptables $r; done
}

if [ "$ROLLBACK" = 1 ]; then
  say "== Rollback Freie Karte 2 P3/P4 (nur die Teile dieses Skripts; den Wrapper rollt der Integrator zurueck) =="
  need "$SPIEL_AGENT/.env"; need "$SPIEL_AGENT/start-on-boot.sh"; need "$SPIEL_AGENT_PID"
  [ "$MISSING" = 0 ] || { say "Abbruch: Voraussetzungen fuer den Rollback fehlen."; exit 1; }
  agent_origin "127.0.0.1:8794"            # Spiel-Ursprung wieder wie vorher auf den Wrapper
  fw_weg
  do_ docker rm -f mdi-bau mdi-pruef mdi-spiel-dienst
  do_ docker network disconnect "$BAU_NET" "$WRAPPER"
  do_ docker network rm "$BAU_NET" "$PRUEF_NET"
  exit 0
fi

say "== Pruefen =="
need "$SECRETS/fk2-bau.token"; need "$SECCOMP"
[ "$DOUBLE" = 1 ] || need "$SECRETS/anthropic.key"
need "$SPIEL_AGENT/.env"; need "$SPIEL_AGENT/start-on-boot.sh"; need "$SPIEL_AGENT_PID"
if docker exec "$WRAPPER" printenv DUELL_BAU 2>/dev/null | grep -qx on; then say "ok   $WRAPPER laeuft mit DUELL_BAU=on (Integrator)"; else say "FEHLT $WRAPPER mit DUELL_BAU=on (erst den Wrapper per Deploy-Muster tauschen)"; MISSING=1; fi
if docker exec "$WRAPPER" printenv DUELL_IP_HEADER 2>/dev/null | grep -q .; then say "ok   DUELL_IP_HEADER gesetzt"; else say "FEHLT DUELL_IP_HEADER im Wrapper (ohne ihn bleibt der Bau aus)"; MISSING=1; fi
if ss -ltn 2>/dev/null | grep -q '127.0.0.1:8795 '; then say "FEHLT 127.0.0.1:8795 ist schon belegt"; MISSING=1; else say "ok   127.0.0.1:8795 frei; 8794 bleibt der Wrapper"; fi
df -h / | tail -1 | awk '{ if ($5+0 >= 95) print "WARNUNG Platte zu " $5 " voll: alte Images entfernen"; else print "ok   Platte " $5 }'
[ "$MISSING" = 0 ] || { say "Abbruch: Voraussetzungen fehlen."; exit 1; }

say "== 1 Image fuer Bau-Worker, Pruef-Dienst und Spiel-Dienst =="
do_ docker build -f "$APP_SRC/apps/mdi/bau/Dockerfile" -t "mdi-bau:$TAG" "$APP_SRC/apps/mdi"
do_ docker volume create mdi-bau-state

say "== 2 Netze; den laufenden Wrapper anhaengen (ohne Neustart) =="
do_ docker network create --subnet "$BAU_SUBNET" "$BAU_NET"          # Worker <-> Wrapper (intern 8791), Ausgang per Firewall begrenzt
do_ docker network create --internal "$PRUEF_NET"                     # Worker <-> Pruef-Dienst, kein Ausgang
do_ docker network connect --ip "$IP_WRAPPER" --alias demos-wrapper "$BAU_NET" "$WRAPPER"

say "== 3 Statischer Spiel-Dienst auf 127.0.0.1:8795 (nur Rahmen und Module, read-only) =="
do_ docker run -d --name mdi-spiel-dienst --restart unless-stopped \
  -p 127.0.0.1:8795:8795 --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m --cpus 0.5 \
  -v mdi-spiele:/data/spiele:ro \
  -e SPIEL_ORIGIN="$SPIEL_ORIGIN" -e APP_ORIGINS="$APP_ORIGINS" -e SPIEL_MODULE_DIR=/data/spiele -e SPIEL_PORT=8795 \
  "mdi-bau:$TAG" node bau/spiel-dienst.mjs

say "== 4 Pruef-Dienst: Chromium mit Sandbox, ohne Geheimnisse, nur im internen Netz =="
do_ docker run -d --name mdi-pruef --restart unless-stopped --network "$PRUEF_NET" \
  --security-opt "seccomp=$SECCOMP" --security-opt no-new-privileges --cap-drop ALL --pids-limit 512 --memory 2g --cpus 1.5 \
  --shm-size 512m --read-only --tmpfs /tmp:size=512m \
  -e MDI_CHROMIUM_SANDBOX=1 -e PRUEF_PORT=8796 \
  "mdi-bau:$TAG" node bau/pruef-dienst.mjs

say "== 5 Bau-Worker: Key und Token, kein Browser, kein Port =="
KEY_ARGS=(-v "$SECRETS/anthropic.key:/run/secrets/anthropic.key:ro" -e MDI_ANTHROPIC_KEY_FILE=/run/secrets/anthropic.key)
[ "$DOUBLE" = 1 ] && KEY_ARGS=(-e MDI_BAU_MODELL_DOUBLE=1)
do_ docker run -d --name mdi-bau --restart unless-stopped --network "$BAU_NET" --ip "$IP_BAU" \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 512m --cpus 1 --read-only --tmpfs /tmp:size=64m \
  -v mdi-bau-state:/var/lib/mdi-bau \
  -v "$SECRETS/fk2-bau.token:/run/secrets/fk2-bau.token:ro" "${KEY_ARGS[@]}" \
  -e MDI_BAU_QUEUE_URL="http://demos-wrapper:$INTERN_PORT" -e MDI_BAU_PRUEF_URL="http://mdi-pruef:8796" \
  -e MDI_BAU_TOKEN_FILE=/run/secrets/fk2-bau.token -e MDI_BAU_STATE_DIR=/var/lib/mdi-bau \
  -e MDI_BAU_MODELL_PLANER=claude-haiku-5-5 -e MDI_BAU_MODELL_BAUER=claude-haiku-5-5 -e MDI_BAU_MODELL_ABNAHME=claude-haiku-5-5 \
  "mdi-bau:$TAG"
do_ docker network connect "$PRUEF_NET" mdi-bau

say "== 6 Firewall: Ausgang des Bau-Workers nur zur Modell-API und zu $IP_WRAPPER:$INTERN_PORT =="
fw_regeln

say "== 7 Spiel-Ursprung auf den Spiel-Dienst umstellen (nur der spiel-agent; demos-34a13a96 bleibt auf 8794) =="
agent_origin "127.0.0.1:8795"

say "== 8 Pruefen (wie ein Nutzer, siehe README) =="
say "+ curl -sI $SPIEL_ORIGIN/frame.html   (Content-Security-Policy mit sandbox allow-scripts, frame-ancestors der App)"
say "+ docker exec mdi-bau node -e \"fetch('http://demos-wrapper:8790/').then(()=>console.log('OFFEN'),()=>console.log('zu'))\"   (muss: zu)"
say "+ docker logs --tail 20 mdi-bau; docker logs --tail 20 mdi-pruef"
[ "$RUN" = 1 ] || say "Trockenlauf: nichts ausgefuehrt. Mit --ausfuehren wirklich."
