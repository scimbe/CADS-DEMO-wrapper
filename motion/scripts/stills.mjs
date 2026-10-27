// Rendert einzelne Frames (Review und Poster). Aufruf: node scripts/stills.mjs <outDir> <jpegQuality> <id:frame,...> [lang]
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [outDir, quality, list, lang = 'de'] = process.argv.slice(2);
fs.mkdirSync(outDir, {recursive: true});
const serveUrl = await bundle({entryPoint: path.join(root, 'src/index.ts')});
for (const item of list.split(',')) {
  const [id, frame] = item.split(':');
  const inputProps = {lang};
  const comp = await selectComposition({serveUrl, id, inputProps});
  await renderStill({composition: comp, serveUrl, inputProps, frame: Number(frame), imageFormat: 'jpeg', jpegQuality: Number(quality), output: path.join(outDir, `${id}-f${frame}.jpg`)});
  console.log('still', id, frame);
}
