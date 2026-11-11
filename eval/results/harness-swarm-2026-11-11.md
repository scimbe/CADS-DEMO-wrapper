# Harness-Swarm freie Karte – Ergebnis

> LLM-bewertet (Judge Claude Sonnet 5.5, kalibriert gegen Claude Opus 5.5). Kein Ergebnis gegen Gold-Labels; das menschliche Gold-Korpus bleibt offen und nicht eingefroren.

Kosten: 16.06 USD (≈ 14.78 EUR bei 0,92), harte Grenze 43 USD.

| Rolle | Aufrufe | USD |
|---|---|---|
| pilot | 360 | 0.714 |
| persona | 1071 | 0.434 |
| realism | 108 | 1.272 |
| sut | 5789 | 0.937 |
| judge | 2712 | 10.505 |
| judge-calib | 72 | 0.375 |
| persona-corr | 956 | 0.282 |
| judge-corr | 518 | 1.424 |
| sut-wish | 310 | 0.117 |

Gewichte: routing 0.35, intent 0.3, vorstellung 0.2, quality 0.15; Routing 0 (falscher Ersatz) deckelt den Reward bei 0,25; bestanden = Reward ≥ 0.65 und Routing ≥ 2.

**Baseline (alle Splits) nach Kategorie**

| | n | Reward [95 % CI] | Pass [Wilson 95 %] | Intent | Vorstellung | Routing | Qualität |
|---|---|---|---|---|---|---|---|
| Karte | 570 | 0.523 [0.495–0.551] | 45.1 % [41.0 %–49.2 %] | 2.16 | 1.98 | 2.11 | 2.09 |
| Meme | 116 | 0.716 [0.671–0.757] | 82.8 % [74.9 %–88.6 %] | 2.79 | 2.32 | 3.50 | 2.26 |
| Quiz | 124 | 0.712 [0.666–0.756] | 74.2 % [65.8 %–81.1 %] | 2.67 | 2.54 | 3.56 | 1.98 |
| Spiel | 171 | 0.765 [0.730–0.797] | 78.4 % [71.6 %–83.9 %] | 2.87 | 2.92 | 3.54 | 2.51 |
| Wie eine Karte | 75 | 0.834 [0.808–0.859] | 93.3 % [85.3 %–97.1 %] | 3.37 | 2.75 | 3.83 | 2.91 |

**Baseline nach Thema**

| | n | Reward [95 % CI] | Pass [Wilson 95 %] | Intent | Vorstellung | Routing | Qualität |
|---|---|---|---|---|---|---|---|
| eigene | 100 | 0.721 [0.672–0.765] | 78.0 % [68.9 %–85.0 %] | 2.70 | 2.62 | 3.49 | 2.18 |
| gesundheit | 103 | 0.821 [0.782–0.855] | 95.1 % [89.1 %–97.9 %] | 3.26 | 2.91 | 3.81 | 2.59 |
| goodfeeling | 102 | 0.857 [0.813–0.897] | 90.2 % [82.9 %–94.6 %] | 3.54 | 3.25 | 3.70 | 2.80 |
| meme | 105 | 0.744 [0.702–0.783] | 87.6 % [80.0 %–92.6 %] | 2.91 | 2.42 | 3.63 | 2.32 |
| orga-abgleich | 84 | 0.666 [0.597–0.729] | 72.6 % [62.3 %–81.0 %] | 2.73 | 2.23 | 2.92 | 2.52 |
| orga-essen | 102 | 0.430 [0.393–0.468] | 13.7 % [8.4 %–21.7 %] | 1.87 | 1.66 | 1.58 | 1.91 |
| orga-geld | 104 | 0.208 [0.182–0.237] | 1.9 % [0.5 %–6.7 %] | 0.77 | 0.76 | 0.64 | 1.49 |
| orga-termin | 97 | 0.215 [0.187–0.249] | 4.1 % [1.6 %–10.1 %] | 1.12 | 1.02 | 0.21 | 1.68 |
| quiz | 114 | 0.721 [0.672–0.766] | 75.4 % [66.8 %–82.4 %] | 2.70 | 2.57 | 3.60 | 1.99 |
| spiel | 145 | 0.805 [0.773–0.836] | 84.1 % [77.3 %–89.2 %] | 3.04 | 3.06 | 3.72 | 2.63 |

**Baseline nach Altersband**

| | n | Reward [95 % CI] | Pass [Wilson 95 %] | Intent | Vorstellung | Routing | Qualität |
|---|---|---|---|---|---|---|---|
| 16-17 | 112 | 0.613 [0.556–0.668] | 60.7 % [51.5 %–69.3 %] | 2.42 | 2.20 | 2.75 | 2.17 |
| 18-24 | 176 | 0.646 [0.598–0.690] | 64.2 % [56.9 %–70.9 %] | 2.57 | 2.36 | 2.85 | 2.30 |
| 25-34 | 176 | 0.628 [0.582–0.675] | 62.5 % [55.2 %–69.3 %] | 2.51 | 2.30 | 2.78 | 2.24 |
| 35-49 | 192 | 0.620 [0.575–0.665] | 58.9 % [51.8 %–65.6 %] | 2.47 | 2.29 | 2.72 | 2.20 |
| 50-64 | 176 | 0.602 [0.552–0.648] | 59.7 % [52.3 %–66.6 %] | 2.36 | 2.18 | 2.70 | 2.11 |
| 65-74 | 128 | 0.652 [0.599–0.706] | 64.1 % [55.5 %–71.9 %] | 2.55 | 2.38 | 2.95 | 2.24 |
| 75-85 | 96 | 0.644 [0.582–0.702] | 60.4 % [50.4 %–69.6 %] | 2.61 | 2.36 | 2.77 | 2.35 |

**Baseline nach Sprache / DaZ / Digitalkompetenz**

| | n | Reward [95 % CI] | Pass [Wilson 95 %] | Intent | Vorstellung | Routing | Qualität |
|---|---|---|---|---|---|---|---|
| de | 896 | 0.632 [0.611–0.652] | 61.4 % [58.2 %–64.5 %] | 2.51 | 2.29 | 2.81 | 2.23 |
| en | 160 | 0.609 [0.554–0.663] | 61.9 % [54.2 %–69.0 %] | 2.41 | 2.27 | 2.65 | 2.21 |
| DaZ/2nd language | 288 | 0.625 [0.588–0.662] | 60.8 % [55.0 %–66.2 %] | 2.48 | 2.28 | 2.76 | 2.23 |
| L1 | 768 | 0.629 [0.608–0.651] | 61.7 % [58.2 %–65.1 %] | 2.49 | 2.29 | 2.79 | 2.22 |
| digital high | 352 | 0.622 [0.591–0.654] | 60.5 % [55.3 %–65.5 %] | 2.45 | 2.26 | 2.77 | 2.22 |
| digital low | 160 | 0.620 [0.571–0.667] | 58.8 % [51.0 %–66.1 %] | 2.48 | 2.29 | 2.69 | 2.24 |
| digital mid | 544 | 0.634 [0.607–0.661] | 62.9 % [58.7 %–66.8 %] | 2.52 | 2.31 | 2.82 | 2.22 |

**Baseline nach Ergebnis-Art**

| | n | Reward [95 % CI] | Pass [Wilson 95 %] | Intent | Vorstellung | Routing | Qualität |
|---|---|---|---|---|---|---|---|
| card | 983 | 0.667 [0.649–0.685] | 65.9 % [62.9 %–68.8 %] | 2.66 | 2.45 | 2.94 | 2.36 |
| notyet | 9 | 0.318 [0.169–0.478] | 11.1 % [2.0 %–43.5 %] | 1.11 | 0.89 | 1.56 | 1.44 |
| refused | 64 | 0.073 [0.057–0.090] | 0.0 % [0.0 %–5.7 %] | 0.06 | 0.06 | 0.64 | 0.25 |

**Final „c8“ (alle Splits) nach Kategorie**

| | n | Reward [95 % CI] | Pass [Wilson 95 %] | Intent | Vorstellung | Routing | Qualität |
|---|---|---|---|---|---|---|---|
| Karte | 570 | 0.747 [0.728–0.766] | 79.1 % [75.6 %–82.3 %] | 3.01 | 2.73 | 3.34 | 2.47 |
| Meme | 116 | 0.715 [0.672–0.757] | 82.8 % [74.9 %–88.6 %] | 2.78 | 2.31 | 3.50 | 2.25 |
| Quiz | 124 | 0.713 [0.668–0.757] | 74.2 % [65.8 %–81.1 %] | 2.67 | 2.54 | 3.56 | 1.98 |
| Spiel | 171 | 0.774 [0.742–0.804] | 79.5 % [72.9 %–84.9 %] | 2.91 | 2.95 | 3.58 | 2.53 |
| Wie eine Karte | 75 | 0.834 [0.806–0.859] | 93.3 % [85.3 %–97.1 %] | 3.37 | 2.75 | 3.83 | 2.91 |

**Final „c8“ nach Thema**

| | n | Reward [95 % CI] | Pass [Wilson 95 %] | Intent | Vorstellung | Routing | Qualität |
|---|---|---|---|---|---|---|---|
| eigene | 100 | 0.721 [0.672–0.768] | 78.0 % [68.9 %–85.0 %] | 2.70 | 2.62 | 3.50 | 2.18 |
| gesundheit | 103 | 0.846 [0.826–0.864] | 97.1 % [91.8 %–99.0 %] | 3.36 | 3.00 | 3.93 | 2.67 |
| goodfeeling | 102 | 0.883 [0.849–0.913] | 93.1 % [86.5 %–96.6 %] | 3.65 | 3.36 | 3.80 | 2.89 |
| meme | 105 | 0.743 [0.701–0.780] | 87.6 % [80.0 %–92.6 %] | 2.90 | 2.41 | 3.63 | 2.31 |
| orga-abgleich | 84 | 0.796 [0.756–0.833] | 94.0 % [86.8 %–97.4 %] | 3.15 | 2.58 | 3.71 | 2.81 |
| orga-essen | 102 | 0.571 [0.535–0.610] | 47.1 % [37.7 %–56.7 %] | 2.35 | 2.15 | 2.37 | 2.13 |
| orga-geld | 104 | 0.606 [0.559–0.649] | 59.6 % [50.0 %–68.5 %] | 2.41 | 1.95 | 2.85 | 2.10 |
| orga-termin | 97 | 0.797 [0.742–0.848] | 85.6 % [77.2 %–91.2 %] | 3.31 | 3.15 | 3.35 | 2.64 |
| quiz | 114 | 0.721 [0.676–0.763] | 75.4 % [66.8 %–82.4 %] | 2.70 | 2.57 | 3.61 | 1.99 |
| spiel | 145 | 0.806 [0.773–0.835] | 84.1 % [77.3 %–89.2 %] | 3.04 | 3.06 | 3.72 | 2.63 |

**Baseline gegen Final, gepaart (gleiche Prompts)**

| Split | n | Reward base → final | Δ [Bootstrap 95 %] | Pass base → final | McNemar b/c, p |
|---|---|---|---|---|---|
| val | 272 | 0.603 → 0.747 | 0.145 [0.113–0.177] | 58.8 % → 79.4 % | 1/57, p=4.1e-16 |
| test | 256 | 0.625 → 0.727 | 0.102 [0.072–0.133] | 61.7 % → 77.3 % | 2/42, p=1.1e-10 |
| train | 528 | 0.643 → 0.763 | 0.120 [0.099–0.141] | 62.7 % → 81.6 % | 0/100, p=1.6e-30 |

**Häufigste Fehlerbilder (Baseline)**

- **ignores_details** (222)
  - p01-t02 [Card] „funny birthday card for my dad after his knee surgery he has to do his physio exercises every day and hates it“ → Karte (Stil druck), Titel „Physio Champ“: „Happy birthday! Your knee gets stronger, and so does your cake-eating.“ — Passende Karte auf Englisch, Titel „Physio Champ“ und Kniewitz funktionieren. Aber der Teil, dass er die Übungen hasst oder ein schlechter Patient ist, fehlt; die Sticker zeigen keine Physio-Szene.
  - p01-t05 [Game/Jump & run] „make a little game where a cat jumps over the buses and the bus driver keeps yelling at it funny“ → Jump & Run (antippen zum Springen): Titel „Bus Hop Cat“, Endlos-Lauf, Welt stadt, Figur 🐱, Hindernis 📦, Sammeln 🪙, Gegner 🐦 — Katze, Stadt und Endlos-Lauf passen, aber Hindernis ist 📦 statt Bus, der schimpfende Busfahrer fehlt und es gibt keinen Hinweis darauf. Titel passt gut, Rest bleibt generisch.
  - p01-t06 [Game/Flying] „flying game with santa and snow dodge the trees and presents for kids christmas“ → Flugspiel (antippen, um durch Lücken zu fliegen): Titel „Snowy Gift Flight“, Figur ⛄, Welt night, Hintergrund snow — Flugspiel mit Schnee, Nacht und englischem Titel passt. Figur ist aber ⛄ statt Santa 🎅, Bäume und Geschenke fehlen als Motiv. Die Route ist stimmig, aber etwas generisch.
  - p01-t08 [Game/Jump & run] „little jump and ron game where a cat jumps over pizza boxes and buses for lunch break“ → Jump & Run (antippen zum Springen): Titel „Lunch Break Leap“, Endlos-Lauf, Welt stadt, Figur 🐱, Hindernis 📦, Sammeln 🍪, Gegner 🐞 — Jump & Run mit Katze 🐱 in der Stadt und englischem Titel „Lunch Break Leap“ passt. Busse fehlen aber als Hindernis, nur 📦 ist dabei, dazu Kekse und Käfer ohne Bezug.
- **missed_catalog_card** (160)
  - p01-t09 [Game/Choose & bluff] „game where we decide what food to get tonight and everyone bluffs about what they want“ → Die App sagt: „Choose & bluff“ gibt es noch nicht. Am nächsten dran: One of these is a lie, My messenger lies. — Die App sagt 'noch nicht' und nennt zwei Bluff-Karten, aber nicht raum-streichen, die Essensauswahl passt besser. Dazu auf Deutsch statt Englisch und Titel verwirrend wiedergegeben.
  - p02-t05 [Karte] „Speisekarde Weihnachten Pizza Döner Chinesisch zur Auswahl“ → Karte (Stil advent), Titel „Weihnachts-Speisekarte“: „Pizza, Döner oder Chinesisch? Heute entscheidet der Weihnachtsmann!“ — Die Karte nennt die drei Gerichte, aber nichts zum Auswählen oder Abstimmen. Die Gruppe entscheidet damit nichts. „Weihnachtsmann entscheidet“ ersetzt den Kern. Passend wäre raum-streichen gewesen.
  - p02-t09 [Karte] „karte wo alle wann zeit haben eintragen fuer treffen“ → Karte (Stil zettel), Titel „Wann habt ihr Zeit?“: „Tragt euch ein, wann ihr könnt. Dann finden wir den Treff!“ — Es wurde eine statische Sticker-Karte gebaut, die zum Eintragen auffordert, aber nichts sammeln kann. Die passende Karte zug-termin wurde nicht genutzt, das Eintragen ist unmöglich.
  - p04-t09 [Karte] „karte wo man einen tag und uhrzeit ankreuzen kann an dem alle aus der gruppe zeit haben“ → Karte (Stil druck), Titel „Wann passt es allen?“: „Tipp deine Tage an, dann finden wir gemeinsam den besten Termin!“ — Es wurde eine statische Sticker-Karte gebaut, die zum Antippen auffordert, aber nichts sammelt. Die passende Karte zug-termin (Termine antippen, Gruppe stimmt ab) wurde verfehlt.
- **generic_text** (131)
  - p01-t03 [Quiz] „quiz about my friends for toms bird day saturday with questions about our trip to the lakes and the inside jokes“ → Quiz „Tom's Birthday Lake Quiz“ mit 5 Fragen: — Quiz-Kategorie und Englisch passen, aber die Fragen sind erfundene Allerweltsdetails (Schokocreme, Auto-Schlaf) und die 'richtigen' Antworten Me/You/All of us sind für Mitspieler mehrdeutig. Inside Jokes fehlen.
  - p01-t16 [Meme] „make a meme about when the bus is late again and everybody acts like they dont care lol“ → Meme auf deinem eigenen Foto (Stil meme), Titel „Late Bus Again“: oben „Bus is late again“, unten „Everyone acts fine.“ — Meme-Kategorie passt, Captions sind englisch und kurz. Der Gag "Everyone acts fine." ist blass, "lol"-Ton fehlt. Person erwartete ein fertiges Bild, bekommt aber nur Captions für eigenes Foto, ohne Hinweis darauf.
  - p02-t08 [Quiz] „QUIZ ÜBER UNSERE FAMILIE wer kennt wen am besten lol“ → Quiz „Wer kennt wen am besten?“ mit 4 Fragen: — Quiz ist die richtige Kategorie, aber die Fragen sind beliebig erfunden. Antworten wie „Der Hund“, „Die Katze“, „Oma“ und „Du“ passen nicht zur Familie. Frage 1 hat „Alle zusammen“ als Antwort, Frage 4 ist unsinnig.
  - p02-t16 [Karte] „gute bessrung für basti grippe lustig“ → Karte (Stil herz), Titel „Gute Besserung, Basti!“: „Lieber Basti, werd schnell wieder gesund. Der Tee wartet schon!“ — Richtige Kategorie und Name Basti, aber der Text ist brav und kaum lustig. Die Sticker ☀️🧦💛 passen nicht zu Grippe, Stil Herz wirkt kitschig statt witzig.
- **wrong_substitute** (83)
  - p01-t04 [Card] „a card that shows when everyone is free for my birthday based on their shift plans and calendars and car pool times“ → Karte (Stil druck), Titel „Who's Free When?“: „Happy birthday! Let's find the day that works best for all of us.“ — Es entstand nur eine Sticker-Karte mit Geburtstagsgruß. Sie findet keinen Termin und sammelt nichts. Die passende Karte zug-termin wurde verfehlt. Der Text ist auf Englisch, was passt, aber generisch bleibt.
  - p01-t07 [Card] „make a card that finds the day and time where everyone in our group can make it for bens birthday trip“ → Karte (Stil druck), Titel „Bens Geburtstagstrip“: „Wann passt es allen? Wir finden den Tag gemeinsam, Ben!“ — Es wurde eine statische Sticker-Karte gebaut, die nur fragt „Wann passt es allen?“, aber keinen Tag findet. Die Katalogkarte zug-termin wurde verfehlt, der Text ist deutsch statt englisch.
  - p01-t10 [Card] „card that shows when everyone is free from the shift plan calendar and car pool so we can see the days that fit for all of us“ → Karte (Stil druck), Titel „Who Is Free When?“: „Let's find the days that fit for all of us, together.“ — Es wurde eine statische Sticker-Karte gebaut, die keine Termine sammelt oder vergleicht. Die passende Katalogkarte zug-termin wurde verfehlt; der Text ist nur eine leere Floskel mit Deko-Stickern.
  - p01-t14 [Card] „a card where everyone can pick the day we can all make it“ → Karte (Stil druck), Titel „Pick Our Day“: „Tap the day that works for you, and let's make it happen together!“ — Es wurde eine statische Sticker-Karte gebaut, die zum Antippen auffordert, aber nichts sammelt. Die Katalogkarte zug-termin hätte den Kern geleistet. Englischer Text passt, ist aber unbrauchbar.
- **refused_buildable** (56)
  - p01-t01 [Game/Flying] „small dumb game where a little guy flies through the sky and dodges pigeons and collects pizza slices lol“ → Die App sagt (in der Sprache der Person): Das geht so nicht (abgelehnt, Wortfilter). — Harmlose Anfrage (Tauben ausweichen, Pizza sammeln) wurde vom Wortfilter abgelehnt; keine Erklärung, keine Alternative, und nicht in der Sprache des Teens (Englisch) formuliert.
  - p01-t12 [Card] „card that reminds my friends to pay me back for the pizza and the coach gift lol“ → Die App sagt (in der Sprache der Person): Das geht so nicht (abgelehnt, Grund intern: unkind/ok-false). — Die App lehnt eine harmlose, witzige Erinnerungskarte als 'unkind' ab. Die Karte war baubar, ein Hinweis ohne Geldeinzug ging. Die Ablehnung ist unklar und bietet keinen nächsten Schritt.
  - p02-t06 [Meme] „Tom pennt im Unterricht mit Spruch lol“ → Die App sagt (in der Sprache der Person): Das geht so nicht (abgelehnt, Grund intern: unkind/harassment). — Harmloser Klassen-Scherz über einen Kumpel wurde als Mobbing abgelehnt. Das Meme mit eigenem Foto war baubar. Die Ablehnung nennt keinen nützlichen nächsten Schritt.
  - p03-t11 [Meme] „kann man da auch ein meme über unseren mathe lehrer machen? wie funktioniert das“ → Die App sagt (in der Sprache der Person): Das geht so nicht (abgelehnt, Grund intern: unkind/harassment). — Harmlose Frage zu einem Mathelehrer-Meme wurde pauschal als Mobbing abgelehnt. Die Funktionsfrage blieb unbeantwortet, kein Hinweis auf eine Alternative, daher unnötig unhilfreich.
- **factual_error** (26)
  - p03-t13 [Quiz] „quiz über die römer in köln mit fragen zum lernen?“ → Quiz „Römer in Köln“ mit 4 Fragen: — Quiz passt zum Wunsch und ist teilbar. Fakten stimmen weitgehend (Colonia 50 n. Chr., Rhein, Dionysos-Mosaik). Frage 4 ist leicht erratbar, Mauern fehlen; Frage 2 ist etwas ungenau (Grenze = Rhein).
  - p04-t12 [Quiz] „Quiz über Haarfarben und Frisuren für Familie und Freunde“ → Quiz „Wer hat welche Haare?“ mit 4 Fragen: — Quiz-Kategorie passt. Frage 1 ist fachlich ungenau: Schwarz ist die häufigste Haarfarbe weltweit, nicht Dunkelbraun. Frage 4 ist keine echte Wissensfrage. Für eine Friseur-Azubi zu einfach.
  - p11-t09 [Quiz] „quiz über italien für mama geburtstag 🇮🇹“ → Quiz „Italien für Mama“ mit 5 Fragen: — Quiz passt zum Wunsch. Aber Frage 5 hat „Etna Nord“ als Fantasie-Distraktor, Frage 3 ist trivial (Antwort steckt in der Frage), Fragen sind generisch und ohne Bezug zur Mama.}
  - p12-t13 [Quiz] „ein Quiss über griechische Götter und Helden für meine Klasse im Stil der Tageskarten mit vier Antworten pro Frage“ → Quiz „Götter und Helden“ mit 5 Fragen: — Quiz-Kategorie passt, vier Antworten pro Frage. Frage 4 ist schief formuliert: Theseus verband Kreta nicht mit dem Labyrinth, er besiegte den Minotaurus. Die Fragen sind sehr leicht und einfach gehalten.

**Realismus der Prompts** (Judge-Rubrik 1–5, ≥ 3 angenommen; Oberflächenmerkmale deterministisch)

erzeugt 1056, neu gezogen 15, angenommen 1056, abgelehnt 0; Mittel 4.229 [4.189–4.266]
Wörter p10/p50/p90: 7/11/19; Histogramm {"1-2":0,"3-5":35,"6-10":488,"11-15":320,"16-25":187,"26-40":25,"41+":0}
Anteile: alles klein 77.5 %, Emoji 27.6 %, Frage 16.7 %, Imperativ 0.7 %, Bitte/Höflich 9.8 %, Familie/Rolle 17.5 %, Satzzeichen am Ende 10.7 %, Liste 0.0 %; Judge: Tippfehler 17.6 %, Dialekt 27.3 %, zu glatt 2.9 %, LLM-Formulierung 2.3 %
Referenz (Größenordnung, kein Korpusvergleich): Websuche 2,2–2,8 Wörter je Anfrage (Jansen/Spink, Excite 1997–2001; Dogpile 2005); LLM-Chat-Prompts im Mittel 69,5 Llama-2-Token, stark rechtsschief (LMSYS-Chat-1M, Zheng et al. 2023). Ein Ein-Satz-Feld einer App liegt erwartbar dazwischen.

**Abdeckung Altersband|Sprache × Thema (angenommene Prompts)**

| | eigene | gesundheit | goodfeeling | meme | orga-abgleich | orga-essen | orga-geld | orga-termin | quiz | spiel |
|---|---|---|---|---|---|---|---|---|---|---|
| 16-17|de | 7 | 8 | 6 | 6 | 7 | 6 | 11 | 7 | 9 | 13 |
| 16-17|en | 3 | 4 | 2 | 5 | 3 | 2 | 4 | 3 | 2 | 4 |
| 18-24|de | 13 | 15 | 15 | 13 | 14 | 15 | 12 | 13 | 16 | 18 |
| 18-24|en | 5 | 4 | 2 | 3 | 2 | 2 | 3 | 3 | 4 | 4 |
| 25-34|de | 14 | 12 | 11 | 16 | 10 | 13 | 18 | 16 | 12 | 22 |
| 25-34|en | 5 | 4 | 4 | 3 | 2 | 3 | 3 | 3 | 2 | 3 |
| 35-49|de | 16 | 16 | 18 | 20 | 11 | 22 | 15 | 16 | 16 | 26 |
| 35-49|en | 1 | 2 | 1 | 3 | 1 | 2 | 1 | 1 | 2 | 2 |
| 50-64|de | 12 | 13 | 13 | 11 | 13 | 15 | 16 | 13 | 17 | 21 |
| 50-64|en | 4 | 3 | 3 | 2 | 2 | 2 | 3 | 3 | 5 | 5 |
| 65-74|de | 9 | 11 | 10 | 13 | 9 | 10 | 9 | 9 | 17 | 15 |
| 65-74|en | 2 | 1 | 4 | 1 | 1 | 1 | 1 | 1 | 3 | 1 |
| 75-85|de | 9 | 10 | 13 | 9 | 9 | 9 | 8 | 9 | 9 | 11 |

**Stil-Abgleich mit echten Prompts (WildChat-DE)**

Quelle: allenai/WildChat-1M (ODC-BY), 100 deutsche erste Nutzer-Turns, Hugging Face datasets-server (erste Seite des Filters). Lizenz ODC-BY; Zitat: Zhao et al., „WildChat: 1M ChatGPT Interaction Logs in the Wild“, ICLR 2024. Einschränkung: Chat-Assistent-Nutzung (lange Aufgaben, viele Vorlagen/Bots): Referenz nur für Stil, nicht für die Länge in einem Ein-Satz-Feld einer App.
Von 100 Zeilen haben nur 8 verschiedene Anfänge; 93.0 % stammen aus einer einzigen automatisierten Vorlage („Gib mir nur 10 Keywords …“). Der Auszug taugt daher nicht als Referenz für menschlichen Stil: Kleinschreibung 1.0 % (Personas 75.4 %), Emoji 0.0 % (28.5 %), Imperativ 96.0 % (0.3 %), Liste 94.0 % (0.0 %); Judge auf den ersten 40 Wörtern: Tippfehler 3.0 % (18.9 %), LLM-artig 93.0 % (2.1 %). Entscheidung: keine Neugewichtung der Personas; ein brauchbarer Vergleich braucht mehr Seiten des Filters mit Entfernen der Vorlagen (Duplikate nach Anfang) oder echte, datenschutzkonforme Eingaben der App.

**Judge-Kalibrierung sonnet_vs_sonnet** (n=36): bestanden κ=0.94 (Übereinstimmung 97.2 %), Fehlerbild gleich 72.2 %; intent κw=0.96 exakt 94.4 %, vorstellung κw=0.936 exakt 91.7 %, routing κw=0.953 exakt 91.7 %, quality κw=0.896 exakt 88.9 %

**Judge-Kalibrierung sonnet_vs_opus** (n=36): bestanden κ=0.71 (Übereinstimmung 86.1 %), Fehlerbild gleich 41.7 %; intent κw=0.802 exakt 75.0 %, vorstellung κw=0.844 exakt 80.6 %, routing κw=0.821 exakt 75.0 %, quality κw=0.66 exakt 61.1 %

**Korrektur base_test**: Stichprobe 70, sofort zufrieden 28, korrigiert 42; angekommen (≥ 3/4) nach Runde 1: 11, bis Runde 3: 18 (42.9 %, Wilson 29.1 %–57.8 %), Runden bis Erfolg 1.44; je Weg: wunsch n=47 ≥3: 34.0 %, neu n=31 ≥3: 16.1 %, selbst n=5 ≥3: 0.0 %

**Korrektur final_test**: Stichprobe 69, sofort zufrieden 31, korrigiert 38; angekommen (≥ 3/4) nach Runde 1: 7, bis Runde 3: 16 (42.1 %, Wilson 27.9 %–57.8 %), Runden bis Erfolg 1.69; je Weg: wunsch n=38 ≥3: 31.6 %, neu n=33 ≥3: 21.2 %, selbst n=4 ≥3: 0.0 %

**Iterationen (Append-only-Log, eval/runs/main/iterations.jsonl)**

| Änderung | Split | n | Pass vorher → nachher | Δ Reward [95 %] | McNemar b/c p | behalten |
|---|---|---|---|---|---|---|
| c1 train: Karte-Wunsch mit Termin/Geld/Essen-Bedarf -> Katalogkarten (notyet kategorie), Wortlisten Termin/Geld/Essen erweitert | train | 528 | 62.7 % → 75.6 % | 0.081 [0.062–0.101] | 3/71 p=7.2e-18 | ja |
| c1 val (Entscheidung): Karte-Wunsch mit Termin/Geld/Essen-Bedarf -> Katalogkarten, Wortlisten erweitert | val | 272 | 58.8 % → 76.1 % | 0.122 [0.091–0.153] | 1/48 p=1.8e-13 | ja |
| c2 train: c1 + Termin/Geld/Essen-Formulierungen erweitert, Termin nur mit Gruppe, Gruß-Ausnahme enger | train | 528 | 75.6 % → 78.8 % | 0.023 [0.012–0.035] | 2/19 p=0.00022 | ja |
| c2 val: c1 + Termin/Geld/Essen-Formulierungen erweitert, Termin nur mit Gruppe, Gruß-Ausnahme enger | val | 272 | 76.1 % → 77.6 % | 0.011 [0.000–0.023] | 1/5 p=0.22 | ja |
| A/A: base gegen eine zweite Ausführung von base (Rauschen, keine Änderung) | val | 271 | 59.0 % → 54.2 % | -0.024 [-0.045–-0.003] | 18/5 p=0.011 | nein |
| c3 train: S3-Katalogtext: eigene Details zuerst (Namen, Dinge, Ton), nächstliegendes Emoji statt Standard, keine ungefragten Gegner, max. 5 Quizfragen | train | 525 | 78.7 % → 79.2 % | 0.003 [-0.008–0.014] | 17/20 p=0.74 | nein |
| c3 val: S3-Katalogtext: eigene Details zuerst (Namen, Dinge, Ton), nächstliegendes Emoji statt Standard, keine ungefragten Gegner, max. 5 Quizfragen | val | 271 | 77.5 % → 77.9 % | 0.001 [-0.015–0.018] | 5/6 p=1.0 | nein |
| A/A wiederholt nach Ledger-Fix (ENOENT-Fehler durch zwei Prozesse am selben Ledger neu gelaufen) | val | 270 | 58.9 % → 56.7 % | -0.001 [-0.015–0.014] | 11/5 p=0.21 | nein |
| c3 train wiederholt nach Ledger-Fix | train | 525 | 78.7 % → 79.2 % | 0.003 [-0.008–0.014] | 17/20 p=0.74 | nein |
| c3 val wiederholt nach Ledger-Fix | val | 271 | 77.5 % → 78.6 % | 0.007 [-0.008–0.021] | 3/6 p=0.51 | nein |
| FINAL einmalig auf test: base gegen c2 (c1+c2), gleicher Renderer (Sprache der Person) | test | 256 | 61.7 % → 76.6 % | 0.098 [0.072–0.127] | 1/39 p=7.5e-11 | ja |
| c4 (alle Splits, nur betroffene 2 Prompts neu): c2 + Nigeria kein Schimpfwort-Präfix (lib/duell.mjs); Befund-Fix, n zu klein für Signifikanz | train,val,test | 1056 | 77.9 % → 77.9 % | 0.000 [0.000–0.000] | 0/0 p=1.0 | nein |
| c8 train (Runde 2): c5 S1-Fehlalarme (Prüfung verhauen, nicht dumm, kurze Pausen, 💊 bei eigenen Tabletten) + c6 Geld unter 18 / abgelehnter Geldwunsch ohne Strike + c7 Essen enger, Was machen wir jetzt? zuerst | train | 528 | 79.4 % → 81.6 % | 0.012 [0.007–0.019] | 0/12 p=0.00049 | ja |
| c8 val (Runde 2): c5 S1-Fehlalarme (Prüfung verhauen, nicht dumm, kurze Pausen, 💊 bei eigenen Tabletten) + c6 Geld unter 18 / abgelehnter Geldwunsch ohne Strike + c7 Essen enger, Was machen wir jetzt? zuerst | val | 272 | 77.2 % → 79.4 % | 0.014 [0.004–0.027] | 0/6 p=0.031 | ja |
| FINAL Runde 2 einmalig auf test: c4 gegen c8 | test | 256 | 76.6 % → 77.3 % | 0.004 [-0.003–0.013] | 1/3 p=0.63 | nein |
