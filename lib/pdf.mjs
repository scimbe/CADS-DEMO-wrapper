// Is a headless Chrome/Chromium available for the newsletter's PDF step? The image has none by
// policy; a developer laptop has one. Without it the PDF step is skipped up front (no traceback);
// the visitor prints the HTML report from the browser instead.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Absolute path of a usable Chrome, or null. `env` = process env (CHROME_BIN overrides). */
export function findChrome(env = process.env, exists = existsSync) {
  if (env.CHROME_BIN && exists(env.CHROME_BIN)) return env.CHROME_BIN;
  for (const dir of String(env.PATH || '').split(':').filter(Boolean)) for (const n of NAMES) { const p = join(dir, n); if (exists(p)) return p; }
  return exists(MAC) ? MAC : null;
}

/** run.sh of the newsletter bundle always passes --pdf; drop it when there is no Chrome. */
export const withoutPdf = (script) => script.replace(/ --pdf(?=\s)/g, '');
