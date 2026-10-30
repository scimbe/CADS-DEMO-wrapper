// Pure logic of the /d/untertitel demo, shared by the browser and the tests: this file has NO Node
// imports and is served to the page as /pb/untertitel-core.mjs. Everything that touches the video,
// the speech model or ffmpeg lives in static/untertitel.js; nothing here does I/O.

export const MAX_BYTES = 200 * 1024 * 1024;
export const MAX_SECONDS = 90;
export const OUTPUT_SHORT_SIDE = 720;

/** Signed template component -> file in static/vendor/untertitel/. The digest always comes from the signature. */
export const COMPONENT_FILES = {
  'whisper-model-schnell': 'ggml-tiny-q5_1.bin',
  'whisper-model-genau': 'ggml-base-q5_1.bin',
  'whisper-runtime': 'shout.wasm.js',
  'ffmpeg-core-wasm': 'ffmpeg-core.wasm',
  'ffmpeg-core-js': 'ffmpeg-core.js',
  'untertitel-schrift': 'Poppins-ExtraBold.ttf',
};

/** The components one run needs: all but the speech model that was not chosen. */
export const componentsFor = (model) => Object.keys(COMPONENT_FILES).filter((n) => !n.startsWith('whisper-model-') || n === `whisper-model-${model}`);

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i;

/** First look at a dropped file, before anything is downloaded. null = fine, otherwise an error code. */
export function checkFile({ name = '', size = 0, type = '' }) {
  if (size === 0) return 'empty';
  if (size > MAX_BYTES) return 'too-big';
  if (type && !type.startsWith('video/') && !VIDEO_EXT.test(name)) return 'not-video';
  if (!type && !VIDEO_EXT.test(name)) return 'not-video';
  return null;
}

/** ffprobe -print_format json -show_streams -show_format -> what the pipeline needs, or { error }. */
export function parseProbe(json) {
  const streams = json && Array.isArray(json.streams) ? json.streams : [];
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!video || !(video.width > 0)) return { error: 'not-video' };
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!audio) return { error: 'no-audio' };
  const duration = Number(json.format?.duration ?? video.duration);
  if (!(duration > 0)) return { error: 'not-video' };
  if (duration > MAX_SECONDS) return { error: 'too-long', duration };
  const side = (video.side_data_list || []).find((d) => d.rotation !== undefined);
  const rotation = Math.abs(Number(side?.rotation ?? video.tags?.rotate ?? 0)) % 180;
  const [width, height] = rotation === 90 ? [video.height, video.width] : [video.width, video.height];
  return { duration, width, height, audioCodec: audio.codec_name };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Shrink so the short side is at most OUTPUT_SHORT_SIDE (never enlarge), even dimensions for H.264. */
export function outputSize(width, height) {
  const k = Math.min(1, OUTPUT_SHORT_SIDE / Math.min(width, height));
  return { width: even(width * k), height: even(height * k) };
}

const NOISE = /^[[(♪*-]|[\])♪*]$/;

/**
 * Whisper result (token_timestamps on) -> words [{start,end,text}] in seconds. A token starting with
 * a space opens a new word; special tokens "[_BEG_]" and noise such as "[Musik]" or "(Stille)" go.
 * Do not ask whisper for max_len/split_on_word instead: shout 1.0.7 then emits broken JSON.
 */
export function wordsFromResult(result) {
  const words = [];
  for (const seg of result?.transcription ?? []) {
    for (const tok of seg.tokens ?? []) {
      const raw = String(tok.text ?? '');
      if (!raw.trim() || raw.startsWith('[_')) continue;
      const last = words[words.length - 1];
      if (last && !/^\s/.test(raw)) { last.text += raw; last.end = tok.offsets.to / 1000; }
      else words.push({ start: tok.offsets.from / 1000, end: tok.offsets.to / 1000, text: raw.trim() });
    }
  }
  return words.filter((w) => !NOISE.test(w.text));
}

/** True for a track with nothing audible. Whisper invents sentences on silence, so it must not get it. */
export function isSilent(pcm, threshold = 0.002) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return pcm.length === 0 || Math.sqrt(sum / pcm.length) < threshold;
}

/** Short-video captions: a few words at a time, a new card after punctuation or a pause. */
export function groupCues(words, { maxWords = 4, maxChars = 26, maxGap = 0.6 } = {}) {
  const cues = [];
  let cur = null;
  for (const w of words) {
    const fits = cur && cur.n < maxWords && (cur.text + ' ' + w.text).length <= maxChars && w.start - cur.end <= maxGap && !/[.!?,:;]$/.test(cur.text);
    if (fits) { cur.text += ' ' + w.text; cur.end = w.end; cur.n++; }
    else { cur = { start: w.start, end: w.end, text: w.text, n: 1 }; cues.push(cur); }
  }
  return cues.map(({ start, end, text }) => ({ start, end, text }));
}

/** Text as typed by the person, safe for one line of .srt/.ass (no markup, no line breaks). */
export const cleanCue = (s) => String(s ?? '').replace(/[\\{}<>]/g, '').replace(/\s+/g, ' ').trim();

const pad = (n, w = 2) => String(n).padStart(w, '0');
function clock(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  return { h: Math.floor(ms / 3600000), m: Math.floor(ms / 60000) % 60, s: Math.floor(ms / 1000) % 60, ms: ms % 1000 };
}
const srtTime = (t) => { const c = clock(t); return `${pad(c.h)}:${pad(c.m)}:${pad(c.s)},${pad(c.ms, 3)}`; };
const assTime = (t) => { const c = clock(t); return `${c.h}:${pad(c.m)}:${pad(c.s)}.${pad(Math.floor(c.ms / 10))}`; };

export function toSrt(cues) {
  return cues.map((c) => cleanCue(c.text)).map((text, i) => ({ text, c: cues[i] })).filter((x) => x.text)
    .map((x, i) => `${i + 1}\n${srtTime(x.c.start)} --> ${srtTime(x.c.end)}\n${x.text}\n`).join('\n');
}

// Colours are ASS &HAABBGGRR. Primary = word already spoken, Secondary = still to come.
const LOOKS = {
  pop: { primary: '&H0000E6FF', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&H80000000', border: 1, outlineW: 0.09, shadow: 0.03, karaoke: true },
  neon: { primary: '&H00F0FF00', secondary: '&H00FF4DFF', outline: '&H00401030', back: '&H00000000', border: 1, outlineW: 0.1, shadow: 0, karaoke: true },
  klar: { primary: '&H00FFFFFF', secondary: '&H00FFFFFF', outline: '&H90000000', back: '&H90000000', border: 3, outlineW: 0.28, shadow: 0, karaoke: false },
};
const ALIGN = { unten: 2, mitte: 5, oben: 8 }; // numpad layout; margin keeps clear of the apps' own buttons

/** One line with each word's share of the cue, proportional to its length: survives any edit of the text. */
function karaokeLine(text, duration) {
  const words = text.split(' ');
  const total = words.reduce((a, w) => a + w.length, 0) || 1;
  const cs = Math.round(duration * 100);
  return words.map((w) => `{\\k${Math.round((cs * w.length) / total)}}${w}`).join(' ');
}

export function toAss(cues, { width, height, look = 'pop', position = 'unten' }) {
  const L = LOOKS[look] ?? LOOKS.pop;
  const size = Math.round(Math.min(width, height) * 0.082);
  const marginV = Math.round(height * 0.16);
  const marginH = Math.round(width * 0.06);
  const style = ['Cap', 'Poppins ExtraBold', size, L.primary, L.secondary, L.outline, L.back, 0, 0, 0, 0, 100, 100, 0, 0, L.border,
    Math.round(size * L.outlineW), Math.round(size * L.shadow), ALIGN[position] ?? 2, marginH, marginH, marginV, 1].join(',');
  const events = cues.map((c) => ({ c, text: cleanCue(c.text) })).filter((x) => x.text).map(({ c, text }) => {
    const body = L.karaoke ? karaokeLine(text, c.end - c.start) : text;
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${body}`;
  });
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${style}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}

/** ffmpeg arguments for the burn-in. Audio is copied when it is already AAC (MP4-compatible and free of CPU). */
export function burnArgs({ input, ass, fontsDir, width, height, audioCodec, output }) {
  return ['-i', input, '-vf', `scale=${width}:${height},subtitles=${ass}:fontsdir=${fontsDir}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
    ...(audioCodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k']),
    '-movflags', '+faststart', output];
}

/** Wasm out-of-memory shows up in several disguises; this is the one place that recognises them. */
export const isOutOfMemory = (e) => /out of memory|memory access out of bounds|Cannot enlarge memory|allocation failed|WebAssembly\.Memory|Array buffer allocation/i.test(String(e?.message ?? e));
