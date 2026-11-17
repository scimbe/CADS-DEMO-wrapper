#!/bin/sh
# Aktive Pruefung der KI fuer My Daily Idea (Host-Skript, z. B. ssh-united, stuendlich per cron).
#
# Ein Aufruf mit max_tokens 1 an Claude Haiku (POST /v1/messages) mit dem Schluessel aus einer Datei. Antwortet die API nicht
# mit 200, ordnet das Skript den Fehler einer Klasse zu (dieselben Regeln wie lib/ki-ausfall.mjs, gemeinsam getestet in
# test/ki-ausfall.test.mjs) und schickt eine Mail an OPS_ALERT_MAIL, je Klasse hoechstens eine pro Stunde.
#   ki-limit        402, billing_error, Meldung ueber Nutzungs-/Ausgabenlimit, Guthaben, Abrechnung
#   ki-key          401, 403
#   ki-ueberlastet  429, 529
#   ki-ausfall      5xx, Zeitueberschreitung, Netzfehler
#   ki-anfrage      jede andere Antwort ausser 200 (z. B. ein Modellname, den es nicht mehr gibt): auch eine Mail
# Der Schluessel und das SMTP-Passwort gehen nur ueber stdin an curl (nie in die Prozessliste, nie in eine Ausgabe).
#
# Umgebung (alles ausser OPS_ALERT_MAIL und SMTP_PASS_FILE hat einen Standard):
#   OPS_ALERT_MAIL        Empfaenger, mehrere mit Komma. Ohne: WARN auf stderr bei jedem Lauf, keine Mail.
#   SMTP_PASS_FILE        Datei mit dem Passwort von SMTP_USER
#   KI_KEY_FILE           Standard ~/demos-wrapper-secrets/anthropic.key
#   SMTP_URL              Standard smtps://smtp.strato.de:465 (TLS ab dem ersten Byte); smtp:// nur fuer 127.0.0.1/localhost
#   SMTP_USER, SMTP_FROM  Standard no-reply@bunsenbrenner.org
#   KI_MODELL             Standard claude-haiku-5-5
#   KI_API                Standard https://api.anthropic.com
#   KI_PRUEFUNG_STAND     Verzeichnis fuer die Drossel, Standard ~/.cache/ki-pruefung
#   KI_PRUEFUNG_AUS       Datei; liegt sie da, prueft das Skript nichts (Standard ~/.config/ki-pruefung.aus)
#
# Ausgabe: eine Zeile. Exit 0 = KI antwortet (oder abgeschaltet), 1 = KI-Fehler, 2 = Konfiguration fehlt.
#
# Installation (ssh-united, als der Nutzer, dem ~/demos-wrapper-secrets gehoert):
#   install -m 0755 bin/ki-pruefung.sh ~/bin/ki-pruefung.sh
#   printf '%s\n' '<SMTP-Passwort>' > ~/demos-wrapper-secrets/smtp.pass && chmod 600 ~/demos-wrapper-secrets/smtp.pass
#   ~/bin/ki-pruefung.sh   (einmal von Hand; ohne OPS_ALERT_MAIL nur die WARN-Zeile)
#   crontab -e, eine Zeile (zur Minute 17, damit sie nicht mit anderen Jobs zur vollen Stunde laeuft):
#   17 * * * * OPS_ALERT_MAIL=ops@example.org SMTP_PASS_FILE=$HOME/demos-wrapper-secrets/smtp.pass $HOME/bin/ki-pruefung.sh >> $HOME/ki-pruefung.log 2>&1
# Abschalten:
#   voruebergehend: touch ~/.config/ki-pruefung.aus   (wieder an: rm ~/.config/ki-pruefung.aus)
#   dauerhaft:      crontab -e, die Zeile mit ki-pruefung.sh loeschen; rm ~/bin/ki-pruefung.sh ~/.cache/ki-pruefung -r

set -u
umask 077
LC_ALL=C; export LC_ALL

KEY_FILE=${KI_KEY_FILE:-$HOME/demos-wrapper-secrets/anthropic.key}
API=${KI_API:-https://api.anthropic.com}
MODELL=${KI_MODELL:-claude-haiku-5-5}
SMTP_URL=${SMTP_URL:-smtps://smtp.strato.de:465}
SMTP_FROM=${SMTP_FROM:-no-reply@bunsenbrenner.org}
SMTP_USER=${SMTP_USER:-$SMTP_FROM}
STAND=${KI_PRUEFUNG_STAND:-$HOME/.cache/ki-pruefung}
AUS=${KI_PRUEFUNG_AUS:-$HOME/.config/ki-pruefung.aus}
DROSSEL_S=3600
JETZT=$(date -u +%s)
ZEIT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ -e "$AUS" ]; then echo "$ZEIT AUS ki-pruefung abgeschaltet ($AUS)"; exit 0; fi
if [ ! -r "$KEY_FILE" ]; then echo "$ZEIT FEHLER Konfiguration: Schluesseldatei nicht lesbar ($KEY_FILE)" >&2; exit 2; fi
KEY=$(tr -d '\r\n' < "$KEY_FILE")
case $KEY in ''|*'"'*|*'\'*|*' '*) echo "$ZEIT FEHLER Konfiguration: Schluesseldatei leer oder mit unerwarteten Zeichen" >&2; exit 2 ;; esac

TMP=$(mktemp -d "${TMPDIR:-/tmp}/ki-pruefung.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

# ---- der Aufruf: 1 Token, Schluessel ueber stdin (-K -) ----
CODE=$(printf 'header = "x-api-key: %s"\n' "$KEY" | curl -sS -o "$TMP/antwort" -w '%{http_code}' --max-time 30 -K - \
  -H 'anthropic-version: 2026-10-21' -H 'content-type: application/json' \
  --data-binary "{\"model\":\"$MODELL\",\"max_tokens\":1,\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}]}" \
  "$API/v1/messages" 2>"$TMP/curl-fehler")
KEY=
[ -f "$TMP/antwort" ] || : > "$TMP/antwort"
TYP=$(grep -Eo '"type" *: *"[a-z_]+_error"' "$TMP/antwort" | head -n 1 | sed 's/.*"\([a-z_]*_error\)"/\1/')
TEXT=$(sed -n 's/.*"message" *: *"\([^"]*\)".*/\1/p' "$TMP/antwort" | head -n 1 | cut -c1-300 | sed 's/sk-[A-Za-z0-9_-]\{8,\}/[entfernt]/g')

case $CODE in ''|*[!0-9]*) CODE=000 ;; esac
if [ "$CODE" = 200 ]; then echo "$ZEIT OK ki antwortet ($MODELL)"; exit 0; fi

# ---- Klasse: dieselben Regeln wie klasseVon in lib/ki-ausfall.mjs ----
LIMIT='usage limits?|spend(ing)? limits?|credit balance|billing|insufficient[ _-]?(credit|funds|quota|balance)|quota exceeded|exceeded your current quota'
if [ "$CODE" = 000 ]; then KLASSE=ki-ausfall
elif [ "$CODE" = 402 ] || [ "$TYP" = billing_error ] || { [ "$CODE" -lt 500 ] && printf '%s' "$TEXT" | grep -Eiq "$LIMIT"; }; then KLASSE=ki-limit
elif [ "$CODE" = 401 ] || [ "$CODE" = 403 ] || [ "$TYP" = authentication_error ] || [ "$TYP" = permission_error ]; then KLASSE=ki-key
elif [ "$CODE" = 429 ] || [ "$CODE" = 529 ] || [ "$TYP" = rate_limit_error ] || [ "$TYP" = overloaded_error ]; then KLASSE=ki-ueberlastet
elif [ "$CODE" -ge 500 ]; then KLASSE=ki-ausfall
else KLASSE=ki-anfrage
fi
ZEILE="$ZEIT FEHLER $KLASSE HTTP $CODE${TYP:+ $TYP}"

# ---- Mail an den Betreiber, je Klasse hoechstens eine pro Stunde ----
if [ -z "${OPS_ALERT_MAIL:-}" ]; then echo "$ZEILE; WARN: OPS_ALERT_MAIL fehlt, keine Mail an den Betreiber" >&2; exit 1; fi
if [ -z "${SMTP_PASS_FILE:-}" ] || [ ! -r "$SMTP_PASS_FILE" ]; then echo "$ZEILE; WARN: SMTP_PASS_FILE fehlt oder nicht lesbar, keine Mail" >&2; exit 1; fi
mkdir -p "$STAND" || { echo "$ZEILE; WARN: $STAND nicht anlegbar, keine Mail" >&2; exit 1; }
LETZTE=$(cat "$STAND/$KLASSE" 2>/dev/null || echo 0)
case $LETZTE in ''|*[!0-9]*) LETZTE=0 ;; esac
if [ $((JETZT - LETZTE)) -lt $DROSSEL_S ]; then echo "$ZEILE; Mail gedrosselt (letzte vor $((JETZT - LETZTE)) s)"; exit 1; fi

case $SMTP_URL in
  smtps://*) TLS=--ssl-reqd ;;
  smtp://127.0.0.1:*|smtp://localhost:*) TLS= ;;
  *) echo "$ZEILE; WARN: SMTP_URL muss smtps:// sein (das Passwort geht nie unverschluesselt), keine Mail" >&2; exit 1 ;;
esac
PASS=$(sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' "$SMTP_PASS_FILE" | tr -d '\r\n')
RCPT=
ALT_IFS=$IFS; IFS=,
for A in $OPS_ALERT_MAIL; do A=$(printf '%s' "$A" | tr -d ' '); [ -n "$A" ] && RCPT="$RCPT --mail-rcpt $A"; done
IFS=$ALT_IFS
{
  printf 'From: %s\r\nTo: %s\r\nSubject: [My Daily Idea] KI nicht verfuegbar: %s (aktive Pruefung)\r\n' "$SMTP_FROM" "$OPS_ALERT_MAIL" "$KLASSE"
  printf 'Date: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' "$(date -u '+%a, %d %b %Y %H:%M:%S +0000')"
  printf 'Die stuendliche Pruefung der KI (1 Token, %s) ist fehlgeschlagen.\r\n\r\n' "$MODELL"
  printf 'Klasse:  %s\r\nZeit:    %s\r\nHTTP:    %s\r\nTyp:     %s\r\nMeldung: %s\r\n\r\n' "$KLASSE" "$ZEIT" "$CODE" "${TYP:--}" "${TEXT:--}"
  printf 'Weitere Fehler dieser Klasse melden sich fruehestens in einer Stunde wieder. Abschalten: touch %s\r\n' "$AUS"
} > "$TMP/mail"
# shellcheck disable=SC2086
if printf 'user = "%s:%s"\n' "$SMTP_USER" "$PASS" | curl -sS $TLS --max-time 30 -K - --url "$SMTP_URL" --mail-from "$SMTP_FROM" $RCPT -T "$TMP/mail" 2>"$TMP/smtp-fehler"; then
  PASS=
  echo "$JETZT" > "$STAND/$KLASSE"
  echo "$ZEILE; Mail an den Betreiber gesendet"
else
  PASS=
  echo "$ZEILE; WARN: Mail nicht gesendet ($(head -c 120 "$TMP/smtp-fehler" | tr -d '\r\n'))" >&2
fi
exit 1
