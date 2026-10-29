// Rendert alle Videos (DE + EN, 16:9 + 9:16) nach ../static/motion und Poster (JPG).
// Aufruf: node scripts/render.mjs [Filter, z.B. "die-idee" oder "9x16"]
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '..', 'static', 'motion');
fs.mkdirSync(out, {recursive: true});
const filter = process.argv[2] ?? '';
const vids = [
  {id: 'Idee', slug: 'die-idee', poster: 700},
  {id: 'Herkunft', slug: 'herkunft', poster: 330},
  {id: 'Sicher', slug: 'sicher', poster: 650},
  {id: 'Nordwind', slug: 'nordwind', poster: 1000},
  // Anwendungsfall-Videos: Sprecher direkt aus public/vo (scripts/voice.py), daher nicht stumm
  {id: 'SoEinfach', slug: 'so-einfach', poster: 520, audio: true},
  {id: 'TerminPerAnruf', slug: 'termin-per-anruf', poster: 260, audio: true},
  {id: 'FragDeineRegion', slug: 'frag-deine-region', poster: 330, audio: true},
];
const serveUrl = await bundle({entryPoint: path.join(root, 'src/index.ts')});
for (const v of vids) for (const fmt of ['16x9', '9x16']) for (const lang of ['de', 'en']) {
  const name = `${v.slug}-${fmt}${lang === 'en' ? '.en' : ''}`;
  if (filter && !filter.split(',').some((x) => name.includes(x))) continue;
  const inputProps = {lang};
  const composition = await selectComposition({serveUrl, id: `${v.id}-${fmt}`, inputProps});
  await renderMedia({composition, serveUrl, inputProps, codec: 'h264', crf: 28, pixelFormat: 'yuv420p', muted: !v.audio, audioCodec: 'aac', audioBitrate: '128k', imageFormat: 'jpeg', jpegQuality: 85, outputLocation: path.join(out, `${name}.mp4`), logLevel: 'error'});
  await renderStill({composition, serveUrl, inputProps, frame: v.poster, imageFormat: 'jpeg', jpegQuality: 78, output: path.join(out, `${name}.jpg`), logLevel: 'error'});
  console.log('rendered', name, (fs.statSync(path.join(out, `${name}.mp4`)).size / 1e6).toFixed(2) + ' MB');
}
