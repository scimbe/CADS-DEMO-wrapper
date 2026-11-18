#!/usr/bin/env bash
# Freie Karte 2, P3/P4: Release-Schritte auf ssh-united (README.md daneben). Standard ist ein Trockenlauf: das Skript prueft
# die Voraussetzungen und druckt jeden Befehl. Ausgefuehrt wird nur mit --ausfuehren. Es fasst weder Keycloak noch core noch
# labor-setup.com an und gibt kein Geheimnis aus (nur Pfade und ob die Datei da ist).
#
# Den Produktions-Wrapper tauscht dieses Skript NICHT aus (Review B1): das macht der Integrator mit seinem Deploy-Muster
# (wrapper-zusatz.env, wrapper-mounts.txt). Hier nur, was dazukommt und ohne Neustart des Wrappers geht:
#   Netze, den LAUFENDEN Wrapper per "docker network connect" anhaengen, Spiel-Dienst (127.0.0.1:8795), Pruef-Dienst (Chromium,
#   ohne Geheimnisse, ohne Netz), Egress-Proxy (nur CONNECT api.anthropic.com:443), Bau-Worker (Key + Token, nur an Netzen mit
#   --internal), Umstellung des spiel-agent. --rollback nimmt genau diese Teile zurueck. Am Host-System (Firewall, sudo) wird
#   nichts veraendert.
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
# seccomp-Profil fuer die Chromium-Sandbox: beim Release aus dem offiziellen Playwright-Repository geladen und gegen die
# sha256 in chromium-seccomp.sha256 (hier im Ordner) geprueft; bei Abweichung Abbruch, ohne Profil kein Pruef-Dienst.
HIER="$(cd "$(dirname "$0")" && pwd)"
SECCOMP_URL="https://raw.githubusercontent.com/microsoft/playwright/v1.56.1/utils/docker/seccomp_profile.json"
SECCOMP="${SECCOMP:-$HOME/mdi-bau/chromium-seccomp.json}"
SPIEL_ORIGIN="https://spiel-f29c55da.bunsenbrenner.org"
APP_ORIGINS="https://demos-34a13a96.bunsenbrenner.org,https://bunsenbrenner.org"
BAU_NET="mdi-bau-net"        # --internal: Worker, Wrapper (interner Listener), Egress-Proxy
BAU_SUBNET="172.31.250.0/28" # = DUELL_BAU_NETZ im Wrapper (wrapper-zusatz.env): von hier nur der interne Listener
PRUEF_NET="mdi-pruef-net"    # --internal: Worker, Pruef-Dienst
EGRESS_NET="mdi-egress-net"  # normales Netz: nur der Egress-Proxy
INTERN_PORT=8791                                                   # DUELL_BAU_PORT im Wrapper (wrapper-zusatz.env)
STAMP="$(date -u +%Y%m%d%H%M)"

say() { printf '%s\n' "$*"; }
do_() { say "+ $*"; if [ "$RUN" = 1 ]; then "$@"; fi; }
MISSING=0
need() { if [ -s "$1" ]; then say "ok   $1"; else say "FEHLT $1"; MISSING=1; fi; }

# spiel-agent: Origin in .env umstellen, den Agent ueber seine PID-Datei beenden (nur wenn die PID wirklich ct-agent ist),
# auf das Ende warten und mit start-on-boot.sh neu starten (kein pkill; Review S6). Ist die PID kein laufender ct-agent, bricht
# es ab, ohne etwas zu starten (Delta-Review 4): ein zweiter Agent neben einem unbekannten Prozess waere schlimmer. Steht der
# Origin schon auf dem Ziel und laeuft der Agent, ist nichts zu tun (wiederholbar). Rueckgabe 1 statt exit, damit ein Rollback
# die uebrigen Schritte trotzdem macht.
PROC="${PROC:-/proc}"
ist_agent() { [ -r "$PROC/$1/cmdline" ] && tr '\0' ' ' < "$PROC/$1/cmdline" | grep -q 'ct-agent'; }
agent_origin() {
  local ziel="$1" pid
  pid="$(cat "$SPIEL_AGENT_PID" 2>/dev/null || true)"
  if grep -qx "CT_AGENT_ORIGIN=$ziel" "$SPIEL_AGENT/.env" && [ -n "$pid" ] && ist_agent "$pid"; then say "ok   spiel-agent steht schon auf $ziel und laeuft"; return 0; fi
  say "+ CT_AGENT_ORIGIN=$ziel in $SPIEL_AGENT/.env   (Sicherung .env.bak-$STAMP)"
  say "+ kill \$(cat $SPIEL_AGENT_PID)  (nur wenn $PROC/<pid>/cmdline ct-agent enthaelt, sonst Abbruch), warten, $SPIEL_AGENT/start-on-boot.sh"
  [ "$RUN" = 1 ] || return 0
  if [ -z "$pid" ] || ! ist_agent "$pid"; then say "ABBRUCH: PID '${pid}' aus $SPIEL_AGENT_PID ist kein laufender ct-agent; .env unveraendert, nichts beendet, nichts gestartet"; return 1; fi
  cp "$SPIEL_AGENT/.env" "$SPIEL_AGENT/.env.bak-$STAMP"
  sed "s#^CT_AGENT_ORIGIN=.*#CT_AGENT_ORIGIN=$ziel#" "$SPIEL_AGENT/.env.bak-$STAMP" > "$SPIEL_AGENT/.env"
  "${KILL:-kill}" "$pid"
  for _ in $(seq 1 40); do [ -d "$PROC/$pid" ] || break; sleep 0.5; done
  if [ -d "$PROC/$pid" ]; then say "ABBRUCH: ct-agent ($pid) endet nicht; nichts neu gestartet"; return 1; fi
  "$SPIEL_AGENT/start-on-boot.sh"
}

# Docker-Bestand: was es schon gibt (nur lesen)
gibt_container() { docker container inspect "$1" >/dev/null 2>&1; }
gibt_netz() { docker network inspect "$1" >/dev/null 2>&1; }
netz_intern() { docker network inspect -f '{{.Internal}}' "$1" 2>/dev/null; }
netz_subnetz() { docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$1" 2>/dev/null | tr -s ' ' | sed 's/ $//'; }
haengt_an() { docker network inspect -f '{{range .Containers}}{{.Name}} {{end}}' "$1" 2>/dev/null | tr ' ' '\n' | grep -qx "$2"; }
# Rollback-Schritte: jeder nur, wenn es das Teil noch gibt; so laesst sich ein abgebrochener Release vollstaendig und beliebig
# oft zuruecknehmen (Delta-Review 4)
weg_container() { if gibt_container "$1"; then do_ docker rm -f "$1"; else say "ok   Container $1 gibt es nicht (mehr)"; fi; }
weg_anhang() { if gibt_netz "$1" && haengt_an "$1" "$2"; then do_ docker network disconnect "$1" "$2"; else say "ok   $2 haengt nicht an $1"; fi; }
weg_netz() { if gibt_netz "$1"; then do_ docker network rm "$1"; else say "ok   Netz $1 gibt es nicht (mehr)"; fi; }
# Release: ein Netz, das es schon gibt, wird nur weiterverwendet, wenn es passt; sonst klarer Abbruch
netz_anlegen() {   # name intern(true|false) subnetz(leer = von Docker) -- Argumente fuer docker network create
  local name="$1" intern="$2" subnetz="$3"; shift 3
  if gibt_netz "$name"; then
    local i s; i="$(netz_intern "$name")"; s="$(netz_subnetz "$name")"
    if [ "$i" = "$intern" ] && { [ -z "$subnetz" ] || [ "$s" = "$subnetz" ]; }; then say "ok   Netz $name gibt es schon (internal=$i ${s}), wird weiterverwendet"; return 0; fi
    say "ABBRUCH: Netz $name gibt es schon mit internal=$i ${s} statt internal=$intern ${subnetz} (erst --rollback)"; exit 1
  fi
  do_ docker network create "$@" "$name"
}

# seccomp-Profil laden und pruefen (nur diese URL, nur mit passender sha256)
seccomp_holen() {
  local soll; soll="$(awk 'NR==1 {print $1}' "$HIER/chromium-seccomp.sha256")"
  say "+ curl -fsSL --proto '=https' $SECCOMP_URL -o $SECCOMP.neu && sha256 = $soll ?"
  [ "$RUN" = 1 ] || return 0
  mkdir -p "$(dirname "$SECCOMP")"
  curl -fsSL --proto '=https' "$SECCOMP_URL" -o "$SECCOMP.neu"
  local ist; ist="$(sha256sum "$SECCOMP.neu" | awk '{print $1}')"
  if [ "$ist" != "$soll" ]; then rm -f "$SECCOMP.neu"; say "ABBRUCH: seccomp-Profil hat sha256 $ist statt $soll"; exit 1; fi
  mv "$SECCOMP.neu" "$SECCOMP"; say "ok   seccomp-Profil geprueft ($soll)"
}

if [ "$ROLLBACK" = 1 ]; then
  say "== Rollback Freie Karte 2 P3/P4 (nur die Teile dieses Skripts; den Wrapper rollt der Integrator zurueck) =="
  need "$SPIEL_AGENT/.env"; need "$SPIEL_AGENT/start-on-boot.sh"; need "$SPIEL_AGENT_PID"
  [ "$MISSING" = 0 ] || { say "Abbruch: Voraussetzungen fuer den Rollback fehlen."; exit 1; }
  AGENT=0
  agent_origin "127.0.0.1:8794" || AGENT=1   # Spiel-Ursprung wieder wie vorher auf den Wrapper
  for c in mdi-bau mdi-pruef mdi-egress mdi-spiel-dienst; do weg_container "$c"; done
  weg_anhang "$BAU_NET" "$WRAPPER"
  for n in "$BAU_NET" "$PRUEF_NET" "$EGRESS_NET"; do weg_netz "$n"; done
  if [ "$AGENT" = 1 ]; then say "Rollback ohne spiel-agent: Container und Netze sind weg, den Agent bitte von Hand pruefen."; exit 1; fi
  exit 0
fi

say "== Pruefen =="
need "$SECRETS/fk2-bau.token"; need "$HIER/chromium-seccomp.sha256"
[ "$DOUBLE" = 1 ] || need "$SECRETS/anthropic.key"
need "$SPIEL_AGENT/.env"; need "$SPIEL_AGENT/start-on-boot.sh"; need "$SPIEL_AGENT_PID"
if docker exec "$WRAPPER" printenv DUELL_BAU 2>/dev/null | grep -qx on; then say "ok   $WRAPPER laeuft mit DUELL_BAU=on (Integrator)"; else say "FEHLT $WRAPPER mit DUELL_BAU=on (erst den Wrapper per Deploy-Muster tauschen)"; MISSING=1; fi
if docker exec "$WRAPPER" printenv DUELL_BAU_NETZ 2>/dev/null | grep -qx "172.31.250.0/28"; then say "ok   DUELL_BAU_NETZ passt zu mdi-bau-net"; else say "FEHLT DUELL_BAU_NETZ=172.31.250.0/28 im Wrapper"; MISSING=1; fi
if docker exec "$WRAPPER" printenv DUELL_IP_HEADER 2>/dev/null | grep -q .; then say "ok   DUELL_IP_HEADER gesetzt"; else say "FEHLT DUELL_IP_HEADER im Wrapper (ohne ihn bleibt der Bau aus)"; MISSING=1; fi
if ss -ltn 2>/dev/null | grep -q '127.0.0.1:8795 '; then say "FEHLT 127.0.0.1:8795 ist schon belegt"; MISSING=1; else say "ok   127.0.0.1:8795 frei; 8794 bleibt der Wrapper"; fi
# was es schon gibt: Container dieses Skripts -> Abbruch (Zustand unbekannt, erst --rollback); Netze werden nur passend
# weiterverwendet (netz_anlegen)
for c in mdi-bau mdi-pruef mdi-egress mdi-spiel-dienst; do
  if gibt_container "$c"; then say "FEHLT Container $c gibt es schon (erst ./release.sh $TAG --rollback --ausfuehren)"; MISSING=1; fi
done
df -h / | tail -1 | awk '{ if ($5+0 >= 95) print "WARNUNG Platte zu " $5 " voll: alte Images entfernen"; else print "ok   Platte " $5 }'
[ "$MISSING" = 0 ] || { say "Abbruch: Voraussetzungen fehlen."; exit 1; }

say "== 1 Image fuer Bau-Worker, Pruef-Dienst und Spiel-Dienst =="
do_ docker build -f "$APP_SRC/apps/mdi/bau/Dockerfile" -t "mdi-bau:$TAG" "$APP_SRC/apps/mdi"
do_ docker volume create mdi-bau-state

seccomp_holen

say "== 2 Netze; den laufenden Wrapper anhaengen (ohne Neustart) =="
netz_anlegen "$BAU_NET" true "$BAU_SUBNET" --internal --subnet "$BAU_SUBNET"   # Worker <-> Wrapper (intern 8791) und Egress-Proxy, kein Ausgang
netz_anlegen "$PRUEF_NET" true "" --internal                                 # Worker <-> Pruef-Dienst, kein Ausgang
netz_anlegen "$EGRESS_NET" false ""                                          # nur der Egress-Proxy kommt hinaus
if gibt_netz "$BAU_NET" && haengt_an "$BAU_NET" "$WRAPPER"; then say "ok   $WRAPPER haengt schon an $BAU_NET"; else do_ docker network connect --alias demos-wrapper "$BAU_NET" "$WRAPPER"; fi

say "== 3 Statischer Spiel-Dienst auf 127.0.0.1:8795 (nur Rahmen und Module, read-only) =="
do_ docker run -d --name mdi-spiel-dienst --restart unless-stopped \
  -p 127.0.0.1:8795:8795 --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m --cpus 0.5 \
  -v mdi-spiele:/data/spiele:ro \
  -e SPIEL_ORIGIN="$SPIEL_ORIGIN" -e APP_ORIGINS="$APP_ORIGINS" -e SPIEL_MODULE_DIR=/data/spiele -e SPIEL_PORT=8795 \
  "mdi-bau:$TAG" node bau/spiel-dienst.mjs

say "== 4 Pruef-Dienst: Chromium mit Sandbox, ohne Geheimnisse, nur im internen Netz =="
# Die Sandbox von Chromium braucht im Begrenzungs-Set SYS_CHROOT (gemessen auf ssh-united am 18.11.: mit --cap-drop ALL allein
# "Check failed: sys_chroot"); pwuser selbst hat keine wirksamen Rechte.
do_ docker run -d --name mdi-pruef --restart unless-stopped --network "$PRUEF_NET" \
  --security-opt "seccomp=$SECCOMP" --security-opt no-new-privileges --cap-drop ALL --cap-add SYS_CHROOT --pids-limit 512 --memory 2g --cpus 1.5 \
  --shm-size 512m --read-only --tmpfs /tmp:size=512m \
  -e MDI_CHROMIUM_SANDBOX=1 -e PRUEF_PORT=8796 \
  "mdi-bau:$TAG" node bau/pruef-dienst.mjs

say "== 5 Egress-Proxy: einziger Ausgang des Bau-Workers, nur CONNECT api.anthropic.com:443 =="
do_ docker run -d --name mdi-egress --restart unless-stopped --network "$EGRESS_NET" \
  --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 128m --cpus 0.5 \
  -e EGRESS_ALLOW=api.anthropic.com:443 -e EGRESS_PORT=3128 \
  "mdi-bau:$TAG" node bau/egress-proxy.mjs
do_ docker network connect --alias mdi-egress "$BAU_NET" mdi-egress

say "== 6 Bau-Worker: Key und Token, kein Browser, kein Port, nur --internal-Netze =="
KEY_ARGS=(-v "$SECRETS/anthropic.key:/run/secrets/anthropic.key:ro" -e MDI_ANTHROPIC_KEY_FILE=/run/secrets/anthropic.key)
[ "$DOUBLE" = 1 ] && KEY_ARGS=(-e MDI_BAU_MODELL_DOUBLE=1)
# als Eigentuemer der Geheimnis-Dateien (Modus 600), nicht als pwuser des Images
do_ docker run -d --name mdi-bau --restart unless-stopped -u "$(id -u):$(id -g)" --network "$BAU_NET" \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 512m --cpus 1 --read-only --tmpfs /tmp:size=64m \
  -v mdi-bau-state:/var/lib/mdi-bau \
  -v "$SECRETS/fk2-bau.token:/run/secrets/fk2-bau.token:ro" "${KEY_ARGS[@]}" \
  -e MDI_BAU_QUEUE_URL="http://demos-wrapper:$INTERN_PORT" -e MDI_BAU_PRUEF_URL="http://mdi-pruef:8796" -e HTTPS_PROXY="http://mdi-egress:3128" \
  -e MDI_BAU_TOKEN_FILE=/run/secrets/fk2-bau.token -e MDI_BAU_STATE_DIR=/var/lib/mdi-bau \
  -e MDI_BAU_MODELL_PLANER=claude-haiku-5-5 -e MDI_BAU_MODELL_BAUER=claude-haiku-5-5 -e MDI_BAU_MODELL_ABNAHME=claude-haiku-5-5 \
  "mdi-bau:$TAG"
do_ docker network connect "$PRUEF_NET" mdi-bau

say "== 7 Spiel-Ursprung auf den Spiel-Dienst umstellen (nur der spiel-agent; demos-34a13a96 bleibt auf 8794) =="
agent_origin "127.0.0.1:8795" || exit 1

say "== 8 Pruefen (wie ein Nutzer, siehe README) =="
say "+ curl -sI $SPIEL_ORIGIN/frame.html   (Content-Security-Policy mit sandbox allow-scripts, frame-ancestors der App)"
say "+ docker exec mdi-bau node -e \"fetch('https://example.org/',{signal:AbortSignal.timeout(5000)}).then(()=>console.log('OFFEN'),()=>console.log('zu'))\"   (muss: zu – kein Ausgang ohne Proxy)"
say "+ docker exec mdi-bau node -e \"fetch('http://demos-wrapper:8790/duell').then((r)=>console.log(r.status))\"   (muss: 404 – vom Bau-Netz nur der interne Listener)"
say "+ docker logs --tail 20 mdi-egress   (nur egress ok=true fuer api.anthropic.com:443)"
say "+ docker logs --tail 20 mdi-bau; docker logs --tail 20 mdi-pruef"
[ "$RUN" = 1 ] || say "Trockenlauf: nichts ausgefuehrt. Mit --ausfuehren wirklich."
