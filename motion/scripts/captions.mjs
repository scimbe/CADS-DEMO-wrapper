// Erzeugt WebVTT (DE + EN) fuer alle vier Videos in ../static/motion/captions/
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'motion', 'captions');
fs.mkdirSync(out, {recursive: true});
// [von, bis, DE, EN]
const V = {
  'die-idee': [
    [0, 2.8, 'Die Idee', 'The idea'],
    [2.8, 10.8, 'Heute: Prompt kopieren, Installer starten, hoffen.', 'Today: copy a prompt, run an installer, hope.'],
    [10.8, 15.3, 'Signiert: Jeder Baustein ist per Prüfsumme festgenagelt.', 'Signed: every building block is pinned by digest.'],
    [15.3, 19.8, 'Sandbox: Die Installation läuft immer abgeschottet.', 'Sandbox: installations always run walled off.'],
    [19.8, 24.2, 'Dein Abo: Dein Claude-Zugang verlässt dein Gerät nicht.', 'Your plan: your Claude credentials never leave your device.'],
    [24.2, 30.2, 'Die Signatur wird in deinem Browser geprüft.', 'The signature is verified in your browser.'],
    [30.2, 34, 'Vertrauen, das man prüfen kann.', 'Trust you can verify.'],
  ],
  herkunft: [
    [0, 3, 'Herkunft, die man prüfen kann', 'Provenance you can verify'],
    [3, 10.5, 'Jeder Baustein ist per sha256 festgenagelt, dazu ein signierter Hinweis des Herausgebers.', 'Every block is pinned by sha256, plus a signed note from the publisher.'],
    [10.5, 17.5, 'Die Signatur wird im Browser per WebAssembly geprüft.', 'The signature is verified in the browser via WebAssembly.'],
    [17.5, 24.5, 'Dein freier Text gilt als Angabe, nicht als Anweisung.', 'Your free text counts as data, not as instructions.'],
    [24.5, 29.5, 'Das Ergebnis trägt template_digest und values_digest.', 'The result carries template_digest and values_digest.'],
    [29.5, 37, 'Wird die Vorlage verändert, ist die Signatur ungültig. Prüfen statt vertrauen.', 'If the template is altered, the signature is invalid. Verify, don’t trust.'],
  ],
  sicher: [
    [0, 3, 'Sicher auf jedem Gerät', 'Safe on every device'],
    [3, 12.5, 'Dieselbe Installation auf macOS, Linux, Windows und Android. Windows und Android sind in Vorbereitung.', 'The same installation on macOS, Linux, Windows and Android. Windows and Android are in preparation.'],
    [12.5, 24.5, 'Ein Ausbruchsversuch aus der Sandbox wird blockiert. Die Tests unter macOS (Seatbelt) und Linux (bubblewrap) bestehen.', 'An escape attempt from the sandbox is blocked. The tests on macOS (Seatbelt) and Linux (bubblewrap) pass.'],
    [24.5, 34, 'Ohne Sandbox startet nichts.', 'Without a sandbox, nothing starts.'],
  ],
  nordwind: [
    [0, 3.5, 'Nordwind — ein echter Tag. Szenario; der Wetterteil läuft live.', 'Nordwind — one real day. Scenario; the weather part runs live.'],
    [3.5, 12, 'Der Außendienst füllt auf dem Android-Handy die signierte Vorlage „Törn-Briefing Samstag Bremen“ aus.', 'Field staff fill in the signed template “Törn-Briefing Samstag Bremen” on an Android phone.'],
    [12, 17, 'Die Installation wird im Konto gespeichert.', 'The installation is saved in the account.'],
    [17, 21.7, 'Die Zentrale in Hamburg führt sie in der Sandbox mit dem eigenen Claude-Abo aus.', 'HQ Hamburg runs it in the sandbox with its own Claude plan.'],
    [21.7, 31, 'Werkstatt-GPU und Hafenbüro helfen über verschlüsselte, nur ausgehende Kanäle mit. Der Edge sieht nichts.', 'Workshop GPU and harbour office join in over encrypted, outbound-only channels. The edge sees nothing.'],
    [31, 38.5, 'Das echte Briefing kommt aufs Handy zurück.', 'The real briefing returns to the phone.'],
    [38.5, 45, 'Echter Lauf für Bremen: „Für fünf Tage bleibt es trocken, was Outdoor-Aktivitäten wie Segeln begünstigt.“', 'Real run for Bremen (German output): “Für fünf Tage bleibt es trocken, was Outdoor-Aktivitäten wie Segeln begünstigt.”'],
  ],
};
const ts = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};
for (const [slug, cues] of Object.entries(V)) {
  for (const [i, lang] of [[2, 'de'], [3, 'en']]) {
    const body = cues.map((c, n) => `${n + 1}\n${ts(c[0])} --> ${ts(c[1])}\n${c[i]}\n`).join('\n');
    fs.writeFileSync(path.join(out, `${slug}.${lang}.vtt`), `WEBVTT\n\n${body}`);
  }
}
console.log('captions ok');
