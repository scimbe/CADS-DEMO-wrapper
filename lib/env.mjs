// LLM / Pexels credentials for the demo runs.
//
// Bug fixed here: the wrapper used to read them ONLY from a local `.env` file, so a container started
// with `docker run -e LITELLM_*` (or compose `env_file:`) ran without LLM access unless the `.env`
// was baked into the image -- which put the key into an image layer. Now the process environment is
// the source, and a local `.env` (`export K=V` lines, dev convenience) overrides it.

const KEY = /^(LITELLM|PEXELS)_/;

export function loadEnv(processEnv, dotenvText = '') {
  const env = Object.fromEntries(Object.entries(processEnv).filter(([k]) => KEY.test(k)));
  for (const l of dotenvText.split('\n')) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
