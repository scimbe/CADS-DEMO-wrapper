// Search blob for the index cards (data-search attribute).
//
// Bug fixed here: the blob used to be built with `[d.title, …, d.demo_prompt].join(' ')`, and
// demo_prompt is an object -> every demo that has one got the literal text "[object Object]" in its
// data-search. flattenText() walks strings / numbers / arrays / objects explicitly, so a nested
// value can never be stringified by accident.

// Keys whose values are instructions for a model, URLs or schema plumbing -- not text a visitor
// would search for.
const SKIP_KEYS = new Set(['system', 'type', 'min', 'max', 'externalUrl', 'docsUrl', 'docsPath']);

export function flattenText(v, out = []) {
  if (v == null || v === false) return out;
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'number') out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) flattenText(x, out);
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!SKIP_KEYS.has(k)) flattenText(x, out); }
  return out;
}

// Demo fields that carry searchable text. *_en variants are indexed too, so a visitor finds the
// same card in either language.
const FIELDS = ['title', 'name', 'category', 'tagline', 'blurb', 'tech', 'description', 'note', 'story', 'tool', 'engine', 'demo_prompt', 'tracks'];

export function normalizeSearchText(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/[&<>"'`]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchBlob(slug, d, label) {
  const parts = [slug, label];
  for (const f of FIELDS) { flattenText(d[f], parts); flattenText(d[f + '_en'], parts); }
  return normalizeSearchText(parts.filter(Boolean).join(' '));
}
