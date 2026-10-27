import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';

test('credentials come from the process env (docker -e), without any .env file', () => {
  const env = loadEnv({ LITELLM_BASE_URL: 'https://llm.example', LITELLM_API_KEY: 'k', PATH: '/bin', HOME: '/root' });
  assert.deepEqual(env, { LITELLM_BASE_URL: 'https://llm.example', LITELLM_API_KEY: 'k' });
});

test('a local .env overrides the process env and accepts `export K="V"` lines', () => {
  const env = loadEnv({ LITELLM_DEFAULT_MODEL: 'a' }, 'export LITELLM_DEFAULT_MODEL="b"\n# comment\nPEXELS_API_KEY=p\n');
  assert.deepEqual(env, { LITELLM_DEFAULT_MODEL: 'b', PEXELS_API_KEY: 'p' });
});

test('.dockerignore keeps secrets and run state out of the image', () => {
  const lines = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8').split('\n');
  for (const l of ['.env', '.env.*', '.git', 'work/']) assert.ok(lines.includes(l), l);
});
