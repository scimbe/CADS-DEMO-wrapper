# Storyboard: Anwendungsfall-Videos

Ziel: Wer nichts über das Projekt weiß, versteht nach dem Hauptvideo in unter
40 s drei Dinge: welches Alltagsproblem es löst, dass es in drei einfachen
Schritten geht (Vorlage wählen, Angaben eintragen, Ergebnis bekommen) und was
er als Nächstes klickt. Technik kommt höchstens in einem Satz vor, als
Vertrauensbeleg.

Regeln: ein Gedanke pro Szene, große echte Bilder, wenig Text auf der Folie,
Sprecher Thomas (DE) bzw. Joe (EN). Alle Bilder sind Bildschirmaufnahmen der
laufenden Demos (`scripts/capture-usecases.mjs`). Das Briefing in Szene 4
stammt aus einem echten Lauf (Bremen, „Segelgruppe, Wind und Regen
hervorheben“, siehe `static/motion/README.md`).

## 1. So einfach geht's (`so-einfach`, Ziel ≤ 40 s)

| # | Szene | Bild | Sprechtext DE |
|---|-------|------|---------------|
| 1 | Problem | Groß: „Samstag segeln. Hält das Wetter?“, Anker-Symbol | Samstag will deine Segelgruppe raus. Aber hält das Wetter? |
| 2 | Schritt 1: Vorlage wählen | Echte Galerie, Karte „Wetter-Briefing erstellen“ markiert, Ziffer 1 | Schritt eins: Im Marktplatz die Vorlage „Wetter-Briefing“ wählen. |
| 3 | Schritt 2: Angaben eintragen | Echtes Formular: Ort Bremen, Hinweis „Segelgruppe, Wind und Regen hervorheben“, Ziffer 2 | Schritt zwei: Ort eintragen, dazu ein Satz in deinen eigenen Worten. |
| 4 | Schritt 3: Ergebnis | Echtes Briefing mit Kennzahlen und Diagramm, der Satz „Für fünf Tage bleibt es trocken …“ markiert, Ziffer 3 | Schritt drei: Du bekommst ein fertiges Briefing mit echten Wetterdaten. Fünf trockene Tage, gut zum Segeln. |
| 5 | Ohne Technik, mit Vertrauen | Chips „Kein Programmieren“, „Kein Prompt“; echte Meldung „Signatur in Ordnung: Die Vorlage ist unverändert.“ | Kein Programmieren, kein Prompt. Und dein Browser prüft vorher, dass die Vorlage unverändert ist. |
| 6 | Was als Nächstes | Echte Kartenreihe der Galerie, „Ausprobieren →“ markiert; Zeile „1 Vorlage wählen · 2 Angaben eintragen · 3 Ergebnis“ | Ob Wetter, Vertrag oder Diagramm: immer dieselben drei Schritte. Such dir unten eine Vorlage aus und klick auf „Ausprobieren“. |

## 2. Termin per Anruf (`termin-per-anruf`, ≤ 25 s)

Echter Lauf im Terminassistenten „Salon Schnittwerk“: Termin gebucht (Kalender
am 03.11.: 35 → 32 freie Plätze) und im selben Lauf wieder abgesagt (zurück
auf 35). Getippt statt gesprochen; das sagt die Folie.

| # | Szene | Bild | Sprechtext DE |
|---|-------|------|---------------|
| 1 | Problem | „Friseurtermin? Einfach anrufen.“, Salon-Seite mit „Anruf starten“ markiert | Neuer Haarschnitt? Ruf einfach Thomas an, die digitale Empfangskraft. |
| 2 | Buchen | Echtes Gespräch, Antwort „Ihr Termin ist bestätigt …“ markiert | Sag, was du möchtest. Thomas findet eine freie Zeit und bestätigt den Termin. |
| 3 | Absagen | Echtes Gespräch, „… wurde erfolgreich abgesagt.“ markiert | Absagen geht genauso: ein Satz genügt. |
| 4 | Was als Nächstes | „Anruf starten“ markiert, Adresse der Demo | Probier es aus: Anruf starten und ganz normal sprechen. |

## 3. Frag deine Region (`frag-deine-region`, ≤ 25 s)

Echter Lauf im Callcenter: Frage per Textfeld, Antwort aus dem Deutschlandatlas
(Quelle `v_harzt_HA2023`, Region Hannover).

| # | Szene | Bild | Sprechtext DE |
|---|-------|------|---------------|
| 1 | Problem | Groß: „Wie gut ist meine Region versorgt?“ | Du willst wissen, wie gut deine Region versorgt ist? |
| 2 | Fragen | Echte Seite, „Anrufen“ markiert | Ruf an oder tipp die Frage einfach ein. |
| 3 | Antwort | Echte Antwort „65 Hausärzte je 100.000 Einwohner“, Quelle markiert | Die Antwort kommt gesprochen, mit echten Zahlen aus dem Deutschlandatlas: In der Region Hannover sind es 65 Hausärzte je 100.000 Einwohner. |
| 4 | Was als Nächstes | „Sprachassistent für Regionaldaten“ in der Galerie | Frag nach deiner Region: in der Galerie unter „Sprachassistent für Regionaldaten“. |

## Selbstprüfung gegen das Ziel

- Problem zuerst: Jedes Video beginnt mit einer Alltagsfrage (Wetter fürs
  Segeln, Friseurtermin, Versorgung der Region), nicht mit dem Produkt.
- Drei Schritte: Das Hauptvideo nummeriert sie sichtbar (1, 2, 3) und sagt sie
  wörtlich an; Szene 6 wiederholt sie als Zeile.
- Nächster Klick: Jede letzte Szene nennt genau eine Handlung („Ausprobieren“,
  „Anruf starten“, Karte in der Galerie).
- Ohne Vorwissen: Kein Fachwort im Sprechtext außer „Vorlage“ und „Marktplatz“,
  beide sind im Bild zu sehen. Signatur, Prüfsumme und Sandbox fallen weg; die
  Vertrauenszeile („prüft, dass die Vorlage unverändert ist“) entspricht dem,
  was die Galerie als „Aktiv in der Demo“ ausweist.
- Ehrlichkeit: Keine Behauptung „läuft auf deinem Gerät“ (die Galerie markiert
  das als „in Vorbereitung“). Zahlen stammen aus den gezeigten Läufen.
- Länge: Das Hauptvideo hat 6 Szenen bei etwa 5 bis 7 s; die Länge folgt der
  gemessenen Sprechdauer (siehe `src/vo-timing.json`).
