// Speech recognition off the main thread. Receives bytes the page has already checked against the
// signed digests, starts whisper.cpp (shout.wasm.js) from exactly those bytes and returns the result.
self.onmessage = async ({ data: { runtime, model, pcm, lang, threads } }) => {
  const fail = (e) => self.postMessage({ type: 'error', message: String(e?.message ?? e) });
  try {
    const url = URL.createObjectURL(runtime);
    const { default: createModule } = await import(url);
    const M = await createModule({ mainScriptUrlOrBlob: url, print() {}, printErr() {}, onAbort: fail });
    M.FS_createDataFile('/', 'model.bin', new Uint8Array(await model.arrayBuffer()), true, true);
    M.init('model.bin', '');
    M.onNewSegment = M.onCanceled = () => {}; // shout calls these unconditionally
    M.onProgress = (p) => self.postMessage({ type: 'progress', percent: p });
    M.onTranscribed = (result) => self.postMessage({ type: 'done', result });
    // pcm, language, threads, translate, max_len, split_on_word, suppress_non_speech, token_timestamps
    M.transcribe(pcm, lang, threads, false, 0, false, true, true);
  } catch (e) { fail(e); }
};
