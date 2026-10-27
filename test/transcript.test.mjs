import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transcriptText } from '../lib/transcript.mjs';

test('whisper JSON becomes plain text', () => {
  const t = transcriptText(JSON.stringify({ systeminfo: 'WHISPER', transcription: [{ text: ' Hello' }, { text: ' world.' }] }));
  assert.equal(t, 'Hello world.');
});
test('the shipped podcast transcript shows no JSON', () => {
  const t = transcriptText(readFileSync(new URL('../static/podcast/transcript.srt', import.meta.url), 'utf8'));
  assert.ok(t.length > 20 && !/systeminfo|[{}]/.test(t));
});
test('SRT is stripped of counters and timestamps; garbage gives empty', () => {
  assert.equal(transcriptText('1\n00:00:00,000 --> 00:00:02,000\nHallo Welt\n'), 'Hallo Welt');
  assert.equal(transcriptText('{not json'), '');
});
