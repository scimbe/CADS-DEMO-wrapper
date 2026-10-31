// /d/untertitel: the page shell, its strict response headers and the files it may load.
// Everything that happens to the video happens in static/untertitel.js, in the visitor's browser.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tr, normLang } from './i18n.mjs';
import { esc, jsonForScript } from './chrome.mjs';
import { MAX_BYTES, MAX_SECONDS, COMPONENT_FILES, componentsFor } from './untertitel-core.mjs';

export const UT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'vendor', 'untertitel');

// COOP + COEP unlock SharedArrayBuffer (whisper.cpp threads). The CSP is what makes "no upload" more
// than a promise: the browser refuses connections to any other host and any form submission.
export const UT_PAGE_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
};

export const UT_CSS = `
.ut{display:grid;gap:16px;margin-top:18px;max-width:640px}
.ut-drop{display:block;border:2px dashed var(--field);border-radius:13px;background:var(--card);padding:26px 18px;text-align:center;cursor:pointer}
.ut-drop:hover,.ut-drop.over{border-color:var(--teal-fill)}
.ut-drop b{display:block;font-size:1.05rem;margin-bottom:4px}.ut-drop span{color:var(--muted2);font-size:.9rem}
.ut-drop input{position:absolute;width:1px;height:1px;opacity:0}.ut-drop:focus-within{outline:2px solid var(--focus);outline-offset:2px}
.ut-opts{display:flex;flex-wrap:wrap;gap:12px}.ut-opts label{display:grid;gap:4px;font-size:.85rem;font-weight:600;flex:1 1 140px}
.ut-opts select,.ut-cue{min-height:44px;width:100%;border:1px solid var(--field);border-radius:8px;padding:.5rem .7rem;font:400 1rem var(--sans);color:var(--ink);background:var(--card)}
.ut-note{margin:0;color:var(--muted2);font-size:.88rem}
.ut-picked{margin:0;font-weight:600;overflow-wrap:anywhere}
.ut-err{border:2px solid var(--terra);border-radius:10px;padding:10px 14px;background:var(--card);margin:0;font-weight:600}
.ut-prog progress{width:100%;height:10px;accent-color:var(--teal-fill)}.ut-prog p{margin:0 0 6px;font-size:.92rem}
.ut-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.ut-cues{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:8px}
.ut-cues li{display:grid;grid-template-columns:3.2em 1fr;gap:8px;align-items:center}.ut-cues label{font:.8rem var(--mono);color:var(--muted2)}
.ut h2{font-family:var(--serif);font-weight:600;font-size:1.2rem;margin:0 0 8px}
.ut video{display:block;width:100%;max-height:70vh;background:#000;border-radius:10px;margin-bottom:12px}
.ut-trust summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--teal-ink);font-weight:600;font-size:.9rem}
.ut-lic{font-size:.82rem;color:var(--muted2);border-top:1px solid var(--border);padding-top:10px}.ut-lic h2{font:600 .9rem var(--sans);margin:0 0 4px;color:var(--ink)}.ut-lic p{margin:0 0 4px}
.ut-trust ul{margin:0 0 8px;padding-left:1.1em;font:.78rem var(--mono);color:var(--muted2);overflow-wrap:anywhere}
`;

export function untertitelStrings(lang) {
  const t = tr(lang);
  const mb = Math.round(MAX_BYTES / 1048576);
  return {
    decimal: lang === 'en' ? '.' : ',',
    picked: t('{name} ({mb} MB)', '{name} ({mb} MB)'),
    trust: t('Geprüft: {n} Bausteine stimmen mit der signierten Vorlage überein ({who}).', 'Verified: {n} components match the signed template ({who}).'),
    timesEdit: t('Vorbereitung {prepare} s · Text {text} s', 'Setup {prepare} s · text {text} s'),
    timesDone: t('Vorbereitung {prepare} s · Text {text} s · Video {burn} s · {mb} MB', 'Setup {prepare} s · text {text} s · video {burn} s · {mb} MB'),
    step: {
      verify: t('Prüfe Signatur …', 'Checking signature …'),
      download: t('Lade und prüfe Bausteine: {mb} von {total} MB', 'Loading and checking components: {mb} of {total} MB'),
      read: t('Lese dein Video …', 'Reading your video …'),
      transcribe: t('Erkenne Sprache auf deinem Gerät …', 'Recognising speech on your device …'),
      burn: t('Brenne Untertitel ein …', 'Burning in captions …'),
    },
    err: {
      empty: t('Die Datei ist leer.', 'The file is empty.'),
      'too-big': t(`Die Datei ist größer als ${mb} MB. Kürze das Video und versuche es erneut.`, `The file is larger than ${mb} MB. Trim the video and try again.`),
      'too-long': t(`Das Video ist {min} s lang. Hier gehen höchstens ${MAX_SECONDS} s.`, `The video is {min} s long. The limit here is ${MAX_SECONDS} s.`),
      'not-video': t('Das ist kein lesbares Video. Nimm zum Beispiel eine MP4- oder MOV-Datei.', 'This is not a readable video. Try an MP4 or MOV file, for example.'),
      'no-audio': t('Das Video hat keine Tonspur, also gibt es nichts zu untertiteln.', 'The video has no audio track, so there is nothing to caption.'),
      'no-speech': t('Im Video wurde keine Sprache erkannt.', 'No speech was found in the video.'),
      memory: t('Deinem Gerät ging der Speicher aus. Schließe andere Tabs oder nimm ein kürzeres Video oder einen Laptop.', 'Your device ran out of memory. Close other tabs, or use a shorter video or a laptop.'),
      browser: t('Dieser Browser kann die Demo nicht ausführen. Nimm einen aktuellen Chrome, Edge, Firefox oder Safari.', 'This browser cannot run the demo. Use a current Chrome, Edge, Firefox or Safari.'),
      template: t('Die signierte Vorlage konnte nicht bestätigt werden. Die Demo startet deshalb nicht.', 'The signed template could not be confirmed, so the demo will not start.'),
      tampered: t('Baustein „{name}“ stimmt nicht mit der Signatur überein. Die Demo startet deshalb nicht.', 'Component "{name}" does not match the signature, so the demo will not start.'),
      download: t('Die Bausteine konnten nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.', 'The components could not be loaded. Check your connection and try again.'),
      burn: t('Das Video konnte nicht erzeugt werden. Dein Text ist noch da, versuche es erneut.', 'The video could not be created. Your text is still here, so try again.'),
      cancelled: t('Abgebrochen.', 'Cancelled.'),
      generic: t('Das hat nicht geklappt. Versuche es erneut oder nimm ein anderes Video.', 'That did not work. Try again or use another video.'),
    },
  };
}

/** Total download of the first start, from PROVENANCE.json, so the page states a real number. */
export function downloadBytes(model) {
  const prov = JSON.parse(readFileSync(join(UT_DIR, 'PROVENANCE.json'), 'utf8'));
  return componentsFor(model).reduce((a, n) => a + prov.files[COMPONENT_FILES[n]].bytes, 0);
}

const V = '/static/vendor/untertitel';
/** Visible licence notice: GPL source offer for the ffmpeg core, plus the other licences. Facts: PROVENANCE.json, NOTICE.txt. */
export function licenseNotice(lang) {
  const t = tr(normLang(lang));
  const a = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  return `<section class="ut-lic" id="ut-lic" aria-labelledby="ut-lic-h"><h2 id="ut-lic-h">${t('Lizenzen und Quellcode','Licences and source code')}</h2>
  <p>${t('Das Video wird mit FFmpeg 5.1.4 (ffmpeg.wasm 0.12.10) bearbeitet. Es ist mit x264 und x265 gebaut und steht deshalb unter der GNU GPL, Version 2 oder später. Es ist unverändert aus dem Paket @ffmpeg/core 0.12.10. Du darfst es nach diesen Bedingungen weitergeben und ändern.','The video is processed with FFmpeg 5.1.4 (ffmpeg.wasm 0.12.10). It is built with x264 and x265 and is therefore licensed under the GNU GPL, version 2 or later. It is unchanged from the package @ffmpeg/core 0.12.10. You may pass it on and change it under these terms.')}</p>
  <p>${t('Quellcode dieser Version:','Source code of this version:')} ${a('https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10', 'ffmpeg.wasm v0.12.10')} · ${a('https://github.com/FFmpeg/FFmpeg/tree/n5.1.4', 'FFmpeg n5.1.4')} · ${a('https://github.com/ffmpegwasm/ffmpeg.wasm/blob/v0.12.10/Dockerfile', t('alle Bibliotheken mit Versionen','all libraries with versions'))} · ${a(`${V}/LICENSE.ffmpeg-gpl-2.0.txt`, t('GPL-Text','GPL text'))}</p>
  <p>${t('Spracherkennung: whisper.cpp 1.8.2 (MIT, © The ggml authors) mit den Whisper-Modellen von OpenAI (MIT, © 2022 OpenAI). Schrift Poppins (OFL 1.1).','Speech recognition: whisper.cpp 1.8.2 (MIT, © The ggml authors) with OpenAI’s Whisper models (MIT, © 2022 OpenAI). Poppins font (OFL 1.1).')} ${a(`${V}/NOTICE.txt`, t('Alle Hinweise und Lizenztexte','All notices and licence texts'))}</p></section>`;
}

export function untertitelBody(lang, ver = {}) {
  lang = normLang(lang);
  const t = tr(lang);
  const q = (v) => (v ? `?v=${esc(v)}` : '');
  const bytes = { schnell: downloadBytes('schnell'), genau: downloadBytes('genau') };
  const mb = (n) => Math.round(n / 1e6);
  return `<div class="ut" id="ut" data-lang="${lang}" data-bytes-schnell="${bytes.schnell}" data-bytes-genau="${bytes.genau}" data-wasm-js="/pb/wasm/manifest_core_wasm.js${q(ver.wasm)}" data-wasm-bin="/pb/wasm/manifest_core_wasm_bg.wasm${q(ver.wasm)}">
  <label class="ut-drop" id="ut-drop"><b>${t('Video auswählen','Choose a video')}</b><span>${t(`Bis ${MAX_SECONDS} s und ${Math.round(MAX_BYTES / 1048576)} MB`, `Up to ${MAX_SECONDS} s and ${Math.round(MAX_BYTES / 1048576)} MB`)}</span><input type="file" id="ut-file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"></label>
  <p class="ut-picked" id="ut-picked"></p>
  <div class="ut-opts">
    <label>${t('Sprache','Language')}<select id="ut-language"></select></label>
    <label>${t('Erkennung','Recognition')}<select id="ut-model"></select></label>
    <label>${t('Look','Look')}<select id="ut-look"></select></label>
    <label>${t('Position','Position')}<select id="ut-position"></select></label>
  </div>
  <div class="ut-row"><button class="btn btn-primary" id="ut-go" type="button" disabled>${t('Untertitel erzeugen ▸','Create captions ▸')}</button><button class="btn btn-ghost" id="ut-cancel" type="button" hidden>${t('Abbrechen','Cancel')}</button></div>
  <p class="ut-note">${t(`Kein Konto, kein Upload: Dein Video bleibt auf deinem Gerät. Der erste Start lädt einmalig ${mb(bytes.genau)} MB (Schnell: ${mb(bytes.schnell)} MB), nimm dafür WLAN. Am Laptop getestet, auf dem Handy bisher nicht.`, `No account, no upload: your video stays on your device. The first start downloads ${mb(bytes.genau)} MB once (Fast: ${mb(bytes.schnell)} MB), so use Wi-Fi. Tested on a laptop, not yet on a phone.`)}</p>
  <div class="ut-prog" id="ut-progress" hidden><p id="ut-step" role="status" aria-live="polite"></p><progress id="ut-bar" max="1"></progress></div>
  <p class="ut-err" id="ut-error" role="alert" hidden></p>
  <section id="ut-edit" hidden aria-labelledby="ut-edit-h"><h2 id="ut-edit-h" tabindex="-1">${t('Text prüfen','Check the text')}</h2><ol class="ut-cues" id="ut-cues"></ol><button class="btn btn-primary" id="ut-burn" type="button">${t('Video erzeugen ▸','Create video ▸')}</button></section>
  <section id="ut-result" hidden aria-labelledby="ut-res-h"><h2 id="ut-res-h">${t('Fertig','Done')}</h2><video id="ut-video" controls playsinline></video><div class="ut-row"><a class="btn btn-primary" id="ut-dl-mp4">${t('Video speichern','Save video')}</a><a class="btn btn-ghost" id="ut-dl-srt">${t('.srt speichern','Save .srt')}</a></div></section>
  <p class="ut-note" id="ut-times"></p>
  <details class="ut-trust" id="ut-trust" hidden><summary id="ut-trust-sum"></summary><ul id="ut-trust-list"></ul></details>
  ${licenseNotice(lang)}
  <noscript></noscript>
  <script type="application/json" id="ut-strings">${jsonForScript(untertitelStrings(lang))}</script>
  <script type="module" src="/pb/untertitel.js${q(ver.js)}"></script>
</div>`;
}
