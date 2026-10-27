# Claude Motion – Erklär-Animationen

Vier kurze Animationen für den bunsenbrenner.org Agent-Marktplatz. Wenig Text,
große Bilder, Deutsch zuerst (Englisch über Props). Gebaut mit Remotion
(`motion/`), gerendert als H.264 (CRF 28), stumm, jeweils 16:9 und 9:16.

| Datei (DE)              | Titel                           | Länge |
|-------------------------|---------------------------------|-------|
| `die-idee-*.mp4`        | Die Idee                        | 34 s  |
| `herkunft-*.mp4`        | Herkunft, die man prüfen kann   | 37 s  |
| `sicher-*.mp4`          | Sicher auf jedem Gerät          | 34 s  |
| `nordwind-*.mp4`        | Nordwind – ein echter Tag       | 45 s  |

Suffixe: `-16x9` (1920x1080), `-9x16` (1080x1920), `.en` vor der Endung für
Englisch (z. B. `die-idee-16x9.en.mp4`). Zu jedem Video gibt es ein Poster
(`.jpg`, gleicher Name) und Untertitel `captions/<slug>.de.vtt` und `.en.vtt`.

## Einbetten

`prefers-reduced-motion` wird respektiert: Dann startet nichts automatisch,
es erscheint das Poster mit Bedienelementen. Sonst spielt das Video stumm
und ohne Schleife, sobald es im Bild ist. Auf Hochformat-Geräten wird der
9:16-Schnitt geladen.

```html
<figure class="motion">
  <video id="motion-idee" controls muted playsinline preload="none"
         poster="/static/motion/die-idee-16x9.jpg"
         data-wide="/static/motion/die-idee-16x9.mp4"
         data-tall="/static/motion/die-idee-9x16.mp4"
         data-poster-wide="/static/motion/die-idee-16x9.jpg"
         data-poster-tall="/static/motion/die-idee-9x16.jpg">
    <track kind="captions" srclang="de" label="Deutsch" default
           src="/static/motion/captions/die-idee.de.vtt">
    <track kind="captions" srclang="en" label="English"
           src="/static/motion/captions/die-idee.en.vtt">
  </video>
  <figcaption>Die Idee: signiert, in der Sandbox, mit deinem Abo.</figcaption>
</figure>
<script>
(function () {
  var v = document.getElementById('motion-idee');
  var tall = matchMedia('(max-aspect-ratio: 1/1)').matches;
  v.poster = tall ? v.dataset.posterTall : v.dataset.posterWide;
  v.src = tall ? v.dataset.tall : v.dataset.wide;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // nur Poster
  new IntersectionObserver(function (e, o) {
    if (e[0].isIntersecting) { v.play().catch(function () {}); o.disconnect(); }
  }, {threshold: 0.6}).observe(v);
})();
</script>
```

Für die englische Fassung die `.en`-Dateien verwenden und im `<track>` das
englische `default` setzen.

## Was ist echt, was ist Szenario?

- Echt: alle Screenshots (Galerie, Signaturprüfung im Browser, Vorschau mit
  Vorlagen- und Angaben-Digest, ausgefülltes Formular, fertiges Briefing mit
  Diagrammen) stammen aus der Live-Demo `/d/newsletter`. Ein einziger echter
  Lauf (Bremen, freundlich, Hinweis "Segelgruppe, Wind und Regen hervorheben")
  liefert das Briefing im Finale; das Zitat ist die Ausgabe dieses Laufs.
- Die Demo ist mit einem Testschlüssel signiert (auf der Seite so gekennzeichnet).
- Szenario (illustriert): die Nordwind-Kette über Android, Konto, Mac in Hamburg,
  Werkstatt-GPU und Hafenbüro. Im Video als "Szenario" markiert.
- Beispiel (illustriert): die Manipulation in "Herkunft" (Wort geändert, anderer
  sha256, Signatur ungültig). Die gezeigten Hashes sind echte sha256-Werte der
  gezeigten Textzeile, die Zeile selbst ist ein Beispiel.
- Sandbox: gemessen sind die Ausbruchstests unter macOS (Seatbelt) und Linux
  (bubblewrap). Windows (WSL2) und Android sind als "in Vorbereitung" markiert.

## Neu rendern

```bash
cd motion
npm ci
npm run studio                  # Vorschau im Remotion Studio
node scripts/captions.mjs       # WebVTT neu erzeugen
node scripts/render.mjs         # alle Videos + Poster (16 Videos)
node scripts/render.mjs nordwind-9x16   # nur eines (Namensfilter)
node scripts/capture.mjs        # Screenshots der Live-Demo neu holen (kein Lauf)
```

Sprache: Prop `lang` (`de` | `en`), z. B. im Studio unter "Props".
`capture.mjs` schreibt nach `motion/public/real/`; die JPGs dort sind die
verwendeten Bilder (PNG wird per `.gitignore` ausgeschlossen).
