// transcript.srt in the bundle is whisper.cpp `-oj` JSON, not SRT. Show text, never raw JSON.
export function transcriptText(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      const segs = Array.isArray(j.transcription) ? j.transcription : [];
      return segs.map((x) => String(x.text || '').trim()).filter(Boolean).join(' ').slice(0, 4000);
    } catch { return ''; }
  }
  // real SRT: drop counters and timestamps
  return s.split('\n').filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join(' ').slice(0, 4000);
}
