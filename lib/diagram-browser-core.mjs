// Pure helpers of the "draw in your browser" part of /d/diagram. Served to the browser as /pb/diagram-browser-core.mjs
// and imported by the tests, so the tests run exactly what the browser runs. No imports on purpose.
export const BD_MAX_CHARS = 8000;

/**
 * What the person typed -> DOT. Real DOT (digraph/graph) is used as it is; otherwise every line is a chain
 * "A -> B -> C" and becomes edges of a digraph. Pure, so a test can run exactly what the browser runs.
 */
export function toDot(text) {
  const src = String(text || '').trim();
  if (!src) return '';
  if (/^\s*(strict\s+)?(di)?graph\b/i.test(src)) return src;
  const q = (s) => `"${s.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = [];
  for (const raw of src.split(/\r?\n/)) {
    const parts = raw.split(/\s*(?:->|→)\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) lines.push(`  ${q(parts[0])};`);
    else if (parts.length > 1) lines.push(`  ${parts.map(q).join(' -> ')};`);
  }
  return `digraph {\n  rankdir=LR; node [shape=box, style=rounded, fontname="sans-serif"];\n${lines.join('\n')}\n}`;
}

// Same rule as lib/diagram.mjs: no attribute that makes Graphviz read files or emit links.
const FORBIDDEN_ATTR = /(?:^|[\[,;{\s])"?(?:image|imagepath|imagescale|shapefile|fontpath|\w*url|\w*href|\w*target|\w*tooltip)"?\s*=/i;
const withoutValues = (code) => code.replace(/=\s*"(?:[^"\\]|\\.)*"/g, '=""');
export const isForbiddenDot = (code) => FORBIDDEN_ATTR.test(withoutValues(code)) || /<\s*img\b/i.test(code);
