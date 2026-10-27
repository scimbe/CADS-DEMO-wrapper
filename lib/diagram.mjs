// Diagram from one sentence: the LLM writes Graphviz DOT, `dot` validates and renders it in
// milliseconds on the server, and a failed render goes back to the LLM as an error message (at most
// MAX_RETRIES corrections). No browser, no npm, no Chromium.
import { spawn } from 'node:child_process';

export const MAX_RETRIES = 2;
export const DOT_TIMEOUT_MS = 5000;

// DOT attributes that make `dot` read local files or emit links into the SVG.
const FORBIDDEN = /\b(image|shapefile|imagepath|fontpath|URL|href|target|tooltip|peripheries\s*=\s*\d{3,})\b\s*=?/i;

export const SYSTEM_PROMPT = `Du schreibst Graphviz-DOT. Antworte NUR mit dem DOT-Code (ein einziger digraph oder graph), ohne Erklärung und ohne Markdown-Zaun.
Regeln: höchstens 14 Knoten; kurze deutsche Beschriftungen in Anführungszeichen; rankdir=TB oder LR; keine Attribute image, shapefile, URL, href, tooltip. Einfache Formen (box, ellipse, diamond).`;

/** Take the DOT out of a model answer (strips ``` fences and prose around the graph). */
export function extractDot(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:dot|graphviz)?\s*\n([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const m = t.match(/(?:strict\s+)?(?:di)?graph\b[\s\S]*\}/i);
  return m ? m[0].trim() : t;
}

/** Render DOT with the local `dot`. Resolves { ok:true, svg } | { ok:false, error }. */
export function renderDot(code, { timeoutMs = DOT_TIMEOUT_MS, bin = 'dot' } = {}) {
  return new Promise((resolve) => {
    if (!code || code.length > 8000) return resolve({ ok: false, error: 'DOT leer oder zu lang' });
    if (FORBIDDEN.test(code)) return resolve({ ok: false, error: 'Nicht erlaubtes Attribut (image/shapefile/URL/href/tooltip) — bitte ohne diese Attribute neu schreiben' });
    let out = '', err = '', settled = false;
    const done = (r) => { if (!settled) { settled = true; clearTimeout(to); resolve(r); } };
    let p;
    try { p = spawn(bin, ['-Tsvg'], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } }); }
    catch (e) { return resolve({ ok: false, error: 'dot nicht verfügbar', fatal: true }); }
    const to = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} done({ ok: false, error: 'dot: Zeitüberschreitung' }); }, timeoutMs);
    p.on('error', () => done({ ok: false, error: 'dot nicht verfügbar', fatal: true }));
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { err += b; });
    p.stdin.on('error', () => {});
    p.on('close', (rc) => {
      if (rc === 0 && out.includes('<svg')) {
        const svg = out.slice(out.indexOf('<svg')).replace(/<a\b[^>]*>|<\/a>/g, '');
        return done({ ok: true, svg });
      }
      done({ ok: false, error: (err.trim().split('\n').filter(Boolean).slice(0, 3).join(' ') || `dot exit ${rc}`).slice(0, 300) });
    });
    p.stdin.end(code);
  });
}

/**
 * description -> { ok, svg, dot, attempts, error? }.  `llm(system, user)` returns the model text;
 * `render` defaults to renderDot. On a render error the error text is appended to the conversation.
 */
export async function generateDiagram({ description, llm, render = renderDot, maxRetries = MAX_RETRIES, onAttempt = () => {} }) {
  let user = `Zeichne dieses Diagramm: ${description}`;
  let last = '';
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    onAttempt(attempt);
    let raw;
    try { raw = await llm(SYSTEM_PROMPT, user); } catch (e) { return { ok: false, attempts: attempt, error: 'LLM nicht erreichbar: ' + e.message }; }
    const dot = extractDot(raw);
    const r = await render(dot);
    if (r.ok) return { ok: true, svg: r.svg, dot, attempts: attempt };
    if (r.fatal) return { ok: false, attempts: attempt, error: r.error };
    last = r.error;
    user = `Zeichne dieses Diagramm: ${description}\n\nDein letzter DOT-Code war fehlerhaft:\n${dot}\n\nGraphviz meldet: ${r.error}\nSchreibe den korrigierten DOT-Code.`;
  }
  return { ok: false, attempts: maxRetries + 1, error: 'Kein gültiges Diagramm: ' + last };
}
