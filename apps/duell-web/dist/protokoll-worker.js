// Fast Easy Protokoll: speech recognition off the main thread. The page hands over the whisper.cpp runtime and the model
// as bytes it has already checked against the pinned digests (src/protokoll.js), then one piece of 16 kHz audio at a time.
// The worker keeps the model loaded between pieces and answers with text only; it never fetches anything itself.
let M = null, threads = 1;
self.onmessage = async ({ data: m }) => {
  const fail = (e, id) => self.postMessage({ type: 'error', id, message: String(e?.message ?? e) });
  if (m.type === 'init') {
    try {
      const url = URL.createObjectURL(m.runtime);
      const { default: createModule } = await import(url);
      M = await createModule({ mainScriptUrlOrBlob: url, print() {}, printErr() {}, onAbort: (e) => fail(e) });
      M.FS_createDataFile('/', 'model.bin', new Uint8Array(await m.model.arrayBuffer()), true, true);
      M.init('model.bin', '');
      M.onNewSegment = M.onCanceled = M.onProgress = () => {}; // shout calls these unconditionally
      threads = m.threads || 1;
      self.postMessage({ type: 'ready' });
    } catch (e) { fail(e); }
    return;
  }
  if (m.type === 'chunk') {
    if (!M) return fail('not-ready', m.id);
    try {
      M.onTranscribed = (result) => self.postMessage({ type: 'text', id: m.id, result });
      // pcm, language, threads, translate, max_len, split_on_word, suppress_non_speech, token_timestamps
      M.transcribe(m.pcm, m.lang, threads, false, 0, false, true, false);
    } catch (e) { fail(e, m.id); }
  }
};
