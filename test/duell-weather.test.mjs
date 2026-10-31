// Weather card: numbers only from the service, nothing invented on failure, limits, filter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeather } from '../lib/duell-weather.mjs';

const NOW = Date.parse('2026-11-01T10:00:00Z');
const ok = (j) => ({ ok: true, json: async () => j });
const service = (calls, over = {}) => async (url) => {
  calls.push(url);
  if (url.includes('geocoding')) return ok(over.geo ?? { results: [{ name: 'Hamburg', latitude: 53.55, longitude: 10 }] });
  return ok(over.fc ?? { daily: { temperature_2m_max: [12.4], temperature_2m_min: [6.6], precipitation_probability_max: [40], weather_code: [61] } });
};
const mk = (calls, over) => createWeather({ env: {}, fetchImpl: service(calls, over), now: () => NOW });

test('echte Werte werden gerundet durchgereicht, Quelle steht dabei, zweite Anfrage kommt aus dem Cache', async () => {
  const calls = [], w = mk(calls), r = await w.get({ place: 'hamburg', date: '2026-11-02' }, 'k');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { place: 'Hamburg', date: '2026-11-02', hi: 12, lo: 7, rain: 40, code: 61, source: 'Open-Meteo' });
  assert.match(calls[1], /start_date=2026-11-02&end_date=2026-11-02/);
  await w.get({ place: 'Hamburg', date: '2026-11-02' }, 'k');
  assert.equal(calls.length, 2);
});
test('Ausfall oder Luecke: Fehler statt Zahlen', async () => {
  const fail = createWeather({ env: {}, fetchImpl: async () => { throw new Error('x'); }, now: () => NOW });
  assert.equal((await fail.get({ place: 'Hamburg', date: '2026-11-01' })).status, 503);
  assert.equal((await mk([], { fc: { daily: { temperature_2m_max: [null], temperature_2m_min: [1] } } }).get({ place: 'Hamburg', date: '2026-11-01' })).status, 503);
  assert.equal((await mk([], { geo: { results: [] } }).get({ place: 'Nirgendwo', date: '2026-11-01' })).status, 404);
});
test('Eingabe: Datum nur heute bis +7 Tage, Filter wirkt, Grenze je Person', async () => {
  const calls = [], w = mk(calls);
  for (const date of ['2026-10-31', '2026-11-09', 'morgen', '']) assert.notEqual((await w.get({ place: 'Hamburg', date })).status, 200, date);
  assert.equal((await w.get({ place: 'fuck', date: '2026-11-01' })).status, 422);
  assert.equal(calls.length, 0);
  const lim = createWeather({ env: { DUELL_WEATHER_IP_PER_HOUR: '1' }, fetchImpl: service([]), now: () => NOW });
  assert.equal((await lim.get({ place: 'A', date: '2026-11-01' }, 'k')).status, 200);
  assert.equal((await lim.get({ place: 'B', date: '2026-11-01' }, 'k')).status, 429);
});
