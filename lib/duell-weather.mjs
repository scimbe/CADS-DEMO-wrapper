// My Daily Idea, weather card: real numbers from Open-Meteo, the source the gallery's weather briefing already uses.
// No model is involved and nothing here counts as an AI action. The place name goes from our server to Open-Meteo,
// the visitor's address does not. On any failure the answer is an error: the page shows no numbers then, never invented ones.
import { isUnfit, hasContact } from './duell-ai.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export function createWeather({ env = process.env, fetchImpl = fetch, now = () => Date.now(), timeoutMs = 5000 } = {}) {
  const perHour = Number(env.DUELL_WEATHER_IP_PER_HOUR ?? 30), dailyMax = Number(env.DUELL_WEATHER_DAILY_MAX ?? 1000);
  const cache = new Map(), hits = new Map(), daily = { day: '', n: 0 };
  const getJson = async (url) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error('weather-http-' + r.status);
    return r.json();
  };
  async function get(input, who) {
    const place = String(input && input.place || '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40), date = String(input && input.date || '');
    if (!place || !DATE.test(date)) return { status: 400, body: { error: 'bad-request' } };
    if (isUnfit(place) || hasContact(place)) return { status: 422, body: { error: 'blocked' } };
    const t = now(), days = (Date.parse(date + 'T00:00:00Z') - Date.parse(new Date(t).toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000;
    if (!(days >= 0 && days <= 7)) return { status: 422, body: { error: 'date-range' } };
    const key = place.toLowerCase() + '|' + date, hit = cache.get(key);
    if (hit && t - hit.at < 3600000) return { status: 200, body: hit.body };
    if (who) {
      const arr = (hits.get(who) || []).filter((x) => t - x < 3600000);
      if (arr.length >= perHour) return { status: 429, body: { error: 'rate-limited' } };
      arr.push(t); hits.set(who, arr); if (hits.size > 5000) hits.clear();
    }
    const today = new Date(t).toISOString().slice(0, 10);
    if (daily.day !== today) { daily.day = today; daily.n = 0; }
    if (daily.n >= dailyMax) return { status: 429, body: { error: 'daily-limit' } };
    daily.n++;
    try {
      const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&language=de&name=${encodeURIComponent(place)}`);
      const g = geo && Array.isArray(geo.results) && geo.results[0];
      if (!g || typeof g.latitude !== 'number' || typeof g.longitude !== 'number') return { status: 404, body: { error: 'no-place' } };
      const f = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&start_date=${date}&end_date=${date}`);
      const d = f && f.daily, hi = round(d && d.temperature_2m_max && d.temperature_2m_max[0]), lo = round(d && d.temperature_2m_min && d.temperature_2m_min[0]);
      if (hi === null || lo === null) return { status: 503, body: { error: 'weather-unavailable' } };
      const body = { place: String(g.name || place).slice(0, 32), date, hi, lo, rain: round(d.precipitation_probability_max && d.precipitation_probability_max[0]), code: round(d.weather_code && d.weather_code[0]), source: 'Open-Meteo' };
      cache.set(key, { at: t, body }); if (cache.size > 500) cache.delete(cache.keys().next().value);
      return { status: 200, body };
    } catch { return { status: 503, body: { error: 'weather-unavailable' } }; }
  }
  return { get };
}
