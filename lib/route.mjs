// travel ("Route planen (Bremen)"): client of the always-on route bridge behind the travel tunnel.
//
// The bridge (signed marketplace bundle manifests/travel, runs on the service host) answers
// POST <bridge>/api/plan {text} with {intent, raw_osrm, picked_route, provenance, llm_answer, verify}
// or {error} (400 bad body, 503 no LLM configured, 502 anything that failed while planning). The
// wrapper calls it over the public tunnel URL, at most one request per second per process (the
// bridge geocodes through Nominatim, which allows 1 req/s), with a timeout, and turns the answer
// into a small result for the page: OSRM numbers are the ground truth, the language model's text
// is shown next to the bridge's own mechanical check of that text against the route.

export const ROUTE_TEXT_MAX = 300;
export const ROUTE_MAX_POINTS = 400;

// Spaces the calls of this process at least `minGapMs` apart (start to start). A caller that would
// have to wait longer than `maxWaitMs` gets `null` instead of a slot, so the page can say "busy".
export function createThrottle({ minGapMs = 1000, maxWaitMs = 15000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let next = 0;
  return async function slot() {
    const t = now();
    const at = Math.max(t, next);
    if (at - t > maxWaitMs) return null;
    next = at + minGapMs;
    if (at > t) await sleep(at - t);
    return true;
  };
}

// The language model's prose without the machine-readable <ROUTE_FACTS>{...}</ROUTE_FACTS> block.
export const proseOf = (answer) => String(answer || '').replace(/<ROUTE_FACTS>[\s\S]*?<\/ROUTE_FACTS>/g, '').trim();

// Evenly thin a [lon,lat] line to at most `max` points, always keeping the first and the last.
export function thinLine(coords, max = ROUTE_MAX_POINTS) {
  const pts = (Array.isArray(coords) ? coords : []).filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [Number(p[0]), Number(p[1])]);
  if (pts.length <= max) return pts;
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))]);
  out.push(pts[pts.length - 1]);
  return out;
}

// Bridge 200 body -> page result, or { error } when the body does not hold a usable route.
export function summarizePlan(j) {
  const r = j && j.picked_route;
  if (!r || !Number.isFinite(r.distance) || !Number.isFinite(r.duration)) return { error: 'no-route' };
  const coords = thinLine(r.geometry && r.geometry.coordinates);
  if (coords.length < 2) return { error: 'no-route' };
  const v = (j.verify && typeof j.verify === 'object') ? j.verify : {};
  const intent = j.intent || {};
  const prov = j.provenance || {};
  return {
    render: 'route',
    origin: String(intent.origin || '').slice(0, 120),
    destination: String(intent.destination || '').slice(0, 120),
    preference: String(intent.preference || prov.preference || '').slice(0, 40),
    distance_m: Math.round(r.distance),
    duration_s: Math.round(r.duration),
    text: proseOf(j.llm_answer).slice(0, 4000),
    // Only a check that ran and passed is a pass; a missing verify block is "not checked", never ✓.
    verified: v.pass === true,
    checks: (Array.isArray(v.checks) ? v.checks : []).slice(0, 12).map((c) => ({ name: String(c && c.name || '').slice(0, 120), pass: !!(c && c.pass === true) })),
    coords,
    engine: String(prov.engine || '').slice(0, 80),
    dataset: String(prov.dataset || '').slice(0, 120),
  };
}

const M = {
  de: {
    empty: 'Bitte beschreibe deine Fahrt in einem Satz, z. B. „Von Bremen Hauptbahnhof nach Bremen Weserstadion“.',
    geocode: (p) => `Ort nicht gefunden: „${p}“. Bitte den Ort genauer und mit „Bremen“ schreiben, z. B. „Bremen Hauptbahnhof“ – die Demo kennt nur den Raum Bremen.`,
    geobusy: 'Die Ortssuche ist gerade ausgelastet. Bitte in ein paar Sekunden noch einmal versuchen.',
    intent: 'Start und Ziel wurden nicht erkannt. Bitte so schreiben: „Von <Ort> nach <Ort>“, z. B. „Von Bremen Hauptbahnhof nach Bremen Weserstadion“.',
    noroute: 'Zwischen diesen Orten wurde keine Route gefunden. Die Demo rechnet nur innerhalb von Bremen.',
    llm: 'Das Sprachmodell ist gerade nicht erreichbar. Bitte später noch einmal versuchen.',
    down: 'Der Routendienst antwortet gerade nicht. Bitte später noch einmal versuchen.',
    timeout: 'Der Routendienst hat nicht rechtzeitig geantwortet. Bitte noch einmal versuchen.',
    busy: 'Gerade planen viele Besucher gleichzeitig. Bitte in ein paar Sekunden noch einmal versuchen.',
    generic: 'Die Route konnte gerade nicht geplant werden. Bitte noch einmal versuchen.',
  },
  en: {
    empty: 'Please describe your trip in one sentence, e.g. “From Bremen Hauptbahnhof to Bremen Weserstadion”.',
    geocode: (p) => `Place not found: “${p}”. Please write the place more precisely and include “Bremen”, e.g. “Bremen Hauptbahnhof” – the demo only knows the Bremen area.`,
    geobusy: 'The place search is busy right now. Please try again in a few seconds.',
    intent: 'Start and destination were not recognised. Please write it like “From <place> to <place>”, e.g. “From Bremen Hauptbahnhof to Bremen Weserstadion”.',
    noroute: 'No route was found between these places. The demo only plans within Bremen.',
    llm: 'The language model is not reachable right now. Please try again later.',
    down: 'The route service is not answering right now. Please try again later.',
    timeout: 'The route service did not answer in time. Please try again.',
    busy: 'Many visitors are planning at the same time. Please try again in a few seconds.',
    generic: 'The route could not be planned right now. Please try again.',
  },
};
export const routeMsg = (lang, key, arg) => { const m = M[lang === 'en' ? 'en' : 'de'][key] || M.de.generic; return typeof m === 'function' ? m(arg) : m; };

// Bridge failure -> { msg, details } in the visitor's language. `details` is the bridge's own message
// for the technical log, except where it may carry upstream (LLM endpoint) responses.
export function explainBridgeError(lang, status, error) {
  const e = String(error || '');
  const g = e.match(/no geocode result for "([^"]{1,120})"/);
  if (g) return { msg: routeMsg(lang, 'geocode', g[1]), details: e };
  if (/Nominatim request failed/.test(e)) return { msg: routeMsg(lang, 'geobusy'), details: e };
  if (/plan_route|no route intent/.test(e)) return { msg: routeMsg(lang, 'intent'), details: e.slice(0, 120) };
  if (/OSRM|no routes/.test(e)) return { msg: routeMsg(lang, 'noroute'), details: e.slice(0, 200) };
  if (/LiteLLM|LITELLM|formatted answer/.test(e) || status === 503) return { msg: routeMsg(lang, 'llm'), details: `HTTP ${status}` };
  if (status === 400) return { msg: routeMsg(lang, 'empty'), details: e.slice(0, 120) };
  return { msg: routeMsg(lang, 'generic'), details: `HTTP ${status}` };
}

// One planning call. -> { ok: true, result } | { ok: false, msg, details }
export async function planRoute({ bridgeUrl, text, lang = 'de', throttle, fetchImpl = fetch, timeoutMs = 60000 }) {
  text = typeof text === 'string' ? text.trim().slice(0, ROUTE_TEXT_MAX) : '';
  if (text.length < 3) return { ok: false, msg: routeMsg(lang, 'empty'), details: '' };
  if (throttle && !(await throttle())) return { ok: false, msg: routeMsg(lang, 'busy'), details: 'throttled' };
  let r;
  try {
    r = await fetchImpl(String(bridgeUrl).replace(/\/+$/, '') + '/api/plan', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
  } catch (e) {
    const to = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, msg: routeMsg(lang, to ? 'timeout' : 'down'), details: to ? `timeout ${timeoutMs} ms` : 'unreachable' };
  }
  let j = null;
  try { j = await r.json(); } catch { /* handled below */ }
  if (!r.ok) {
    if (!j || typeof j.error !== 'string') return { ok: false, msg: routeMsg(lang, 'down'), details: `HTTP ${r.status}` };
    return { ok: false, ...explainBridgeError(lang, r.status, j.error) };
  }
  const s = j ? summarizePlan(j) : { error: 'bad-json' };
  if (s.error) return { ok: false, msg: routeMsg(lang, 'generic'), details: s.error };
  return { ok: true, result: s };
}
