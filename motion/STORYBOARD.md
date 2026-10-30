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
| 3 | Absagen | Echtes Gespräch, „… wurde erfolgreich abgesagt.“ markiert, Hinweis „getippt“ (mindestens 7,5 s) | Absagen geht genauso: Ein Satz genügt. Thomas bestätigt die Absage, und der Termin ist wieder frei. |
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

## Weitere Anwendungsfälle (`src/usecases.json`, je ≤ 25 s)

Alle folgen demselben Muster: Alltagsfrage, Schritte mit echten Aufnahmen, genau ein nächster Klick.
Steht im Bild „Aufgezeichneter echter Lauf“, kommt die Seite live aus der Galerie, das Ergebnis aus
einer Aufzeichnung, weil das Ausführen ein Konto braucht.

### Flappy-Spiel bauen (`flappy-spiel`)

Live, ohne Login. Echter Crew-Lauf je Sprache: Wunsch eintippen, bauen lassen, das geänderte Spiel spielen (DE „Ein Traktor-Spiel auf dem Bauernmarkt“, EN „harvester market“).

| # | Sprechtext DE |
|---|---------------|
| 1 | Lust auf dein eigenes kleines Spiel, ganz ohne Programmieren? |
| 2 | Schreib einfach auf, was für ein Spiel du willst. |
| 3 | Ein Klick, kurz warten, und dein Wunsch ist eingebaut. |
| 4 | Dein neues Spiel läuft sofort im Browser. |
| 5 | Probier es aus: Öffne Flappy-Spiel bauen und schreib deinen Wunsch. |

### Live-Auktion (`wer-macht-den-auftrag`)

Live, ohne Login. Echter Lauf je Sprache.

| # | Sprechtext DE |
|---|---------------|
| 1 | Du hast einen Auftrag. Aber wer soll ihn erledigen? |
| 2 | Text und Budget eintragen und den Auftrag ausschreiben. |
| 3 | Mehrere Anbieter bieten live. Du siehst, wer gewinnt und warum. |
| 4 | Die Kurzfassung kommt sofort, ein zweiter Anbieter prüft sie. |
| 5 | Probier es aus: Klick auf Auftrag ausschreiben. |

### Echtheit von Vorlagen prüfen (`vorlage-pruefen`)

Live, ohne Login. Echte Vorlage aus dem Marktplatz im Browser geprüft.

| # | Sprechtext DE |
|---|---------------|
| 1 | Stammt diese Vorlage wirklich vom Herausgeber? |
| 2 | Hol dir mit einem Klick eine echte Vorlage aus dem Marktplatz. |
| 3 | Dein Browser rechnet selbst nach: echt, und seit der Unterschrift unverändert. |
| 4 | Probier es aus: Klick auf den Knopf zum Abrufen. |

### Programmieren lernen (`programmieren-lernen`)

Lernpfade live; Aufgabe und Hinweis sind Bilder aus der öffentlichen Dokumentation, im Video so bezeichnet.

| # | Sprechtext DE |
|---|---------------|
| 1 | Programmieren lernen, ohne etwas zu installieren? |
| 2 | Such dir im Browser einen Lernpfad aus. |
| 3 | Jeder Schritt hat kleine Aufgaben, die automatisch geprüft werden. |
| 4 | Hängst du fest, gibt es erst einen Hinweis und nicht gleich die Lösung. |
| 5 | Wähl deinen Lernpfad und klick auf Öffnen. Dafür brauchst du ein Konto. |

### Foto-Ordner ordnen (`fotos-ordnen`)

Aufzeichnung `recordings/phototools.sse`.

| # | Sprechtext DE |
|---|---------------|
| 1 | Dein Foto-Ordner ist ein einziges Durcheinander? |
| 2 | Ein Klick auf Organisieren genügt. |
| 3 | Die Fotos landen in sauberen Ordnern, nach Datum und Ort. Im Beispiel: sechs Fotos in fünf Ordnern. |
| 4 | Probier es aus: Öffne Foto-Ordner ordnen und klick auf Organisieren. |

### Verträge vergleichen (`vertrag-vergleichen`)

Aufzeichnung `recordings/contractcheck-mietvertrag.json` mit den beiden PDFs daneben.

| # | Sprechtext DE |
|---|---------------|
| 1 | Was hat sich in deinem neuen Mietvertrag geändert? |
| 2 | Lade die alte und die neue Fassung hoch. |
| 3 | Du siehst jede Änderung: Die Miete steigt von 800 auf 950 Euro, die Kündigungsfrist von drei auf sechs Monate, und Haustiere sind neu verboten. |
| 4 | Probier es aus: Zwei Dateien wählen und auf Vergleichen klicken. |

### Diagramm aus Text (`diagramm-aus-text`)

Aufzeichnung `recordings/diagram.sse`.

| # | Sprechtext DE |
|---|---------------|
| 1 | Du willst einen Ablauf schnell als Bild zeigen? |
| 2 | Beschreib ihn in einem Satz. |
| 3 | Kurz warten, und das fertige Diagramm ist da. |
| 4 | Probier es aus: Satz eintragen und auf Diagramm erzeugen klicken. |

### Absturzsichere Abläufe (`absturzsicher`)

Aufzeichnung `recordings/temporal-poc.sse`.

| # | Sprechtext DE |
|---|---------------|
| 1 | Was passiert, wenn mitten in einer wichtigen Aufgabe ein Helfer ausfällt? |
| 2 | Hier wird genau das ausprobiert: Ein Klick startet den Ablauf, mittendrin fällt ein Helfer aus. |
| 3 | Ein zweiter Helfer übernimmt, und die Aufgabe wird trotzdem fertig. |
| 4 | Sieh es dir an: Klick auf Ablauf starten. |

### Route planen (`route-planen`)

Bildschirmfotos des echten Laufs aus PR #33 (Weserstadion nach Flughafen).

| # | Sprechtext DE |
|---|---------------|
| 1 | Wie weit ist es vom Weserstadion zum Bremer Flughafen? |
| 2 | Schreib deine Fahrt einfach in einem Satz. |
| 3 | Du bekommst Strecke und Dauer: 5,7 Kilometer, 10 Minuten, geprüft gegen die echte Route. |
| 4 | Dazu siehst du den Weg als Linie. |
| 5 | Probier es aus: Satz eintragen und auf Route planen klicken. |

### Erklärvideo (`text-wird-video`)

Formular live; Ergebnis sind Bilder aus einem echten Produktionsvideo (Nordwind Bootsservice).

| # | Sprechtext DE |
|---|---------------|
| 1 | Du hast einen Text, aber keine Zeit für ein Video? |
| 2 | Füg deinen Text ein und wähl die Länge. |
| 3 | Kurz warten: Du bekommst ein Video mit Folien und gesprochener Erklärung. |
| 4 | Probier es aus: Text einfügen und auf Video erstellen klicken. |

### Untertitel (`untertitel`)

Live, ohne Konto. Echter Lauf im Browser mit eigenem Clip, das Ergebnis ist das Video aus der Seite.

| # | Sprechtext DE |
|---|---------------|
| 1 | Viele schauen Reels ohne Ton. Versteht man deins trotzdem? |
| 2 | Wähl dein Video aus. Es bleibt auf deinem Gerät. |
| 3 | Prüf den Text. Stimmt ein Wort nicht, änderst du es einfach. |
| 4 | Fertig: dein Video mit großen Untertiteln, bereit zum Speichern. |
| 5 | Frei und ohne Konto. Probier es aus: Klick auf Video auswählen. |

## Lesbarkeit

Alle Aufnahmen zeigen einen Ausschnitt in fester Vergrößerung (`src/crop.ts`): 16-px-Text ergibt
etwa 32 px im 16:9-Bild und 38 px im 9:16-Bild. Quelle sind die Handy-Aufnahmen, weil sie einspaltig
sind. Ausnahmen: das breite Diagramm und die Folien des Erklärvideos werden ganz gezeigt.

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
