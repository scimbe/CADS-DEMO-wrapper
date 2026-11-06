// Re-review round 3, R3-1: a hyphen must not hide a youth topic, and must not turn a toy into a weapon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isYouthTopic } from '../lib/duell-ai.mjs';

test('R3-1: Bindestrich-Woerter mit Jugendschutz-Thema werden erkannt', () => {
  const bad = ['Alk-Party', 'Wein-Abend', 'Sekt-Empfang', 'Sekt-Frühstück', 'Gin-Tasting', 'Wine-Tasting', 'Booze-Cruise', 'Promille-Grenze',
    'Poker-Nacht', 'Poker-Nacht Regeln', 'Lotto-Spiel', 'Joint-Drehen', 'Weed-Party', 'Koks-Line', 'Meth-Labor', 'LSD-Trip', 'Tabak-Pfeife', 'Vape-Shop',
    'Raucher-Pause', 'Gun-Show', 'Ammo-Kiste', 'Bomben-Bau', 'Sex-Witze', 'Nackt-Bilder', 'Kondom-Automat', 'Korn-Party', 'Bier-Pong'];
  const missed = bad.filter((t) => !isYouthTopic(t));
  assert.deepEqual(missed, []);
});

test('R3-1: harmlose Bindestrich-Woerter bleiben erlaubt', () => {
  const ok = ['Nerf-Pistolen Party', 'Wasser-Pistolen', 'Wasserpistolen-Schlacht', 'Radler-Tour am Sonntag', 'Weizen-Mehl kaufen', 'Korn-Feld', 'Pilsen-Reise',
    'Schoko-Kuchen', 'Kinder-Punsch', 'Spielzeug-Gewehr', 'Start-Pistole beim Sportfest', 'Fußball-Turnier', 'Weintrauben-Saft', 'Grill-Party mit Würstchen'];
  const blocked = ok.filter((t) => isYouthTopic(t));
  assert.deepEqual(blocked, []);
});
