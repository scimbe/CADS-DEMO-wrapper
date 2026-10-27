// stdout protocol of the erklaervideo bundle (manifests/erklaervideo, API.md):
//   PROGRESS {"stage":..,"pct":..,"message":..}  ...  then exactly one RESULT {..} or ERROR {"code":..,"message":..}
export function parseBundleLine(line) {
  const m = /^(PROGRESS|RESULT|ERROR) (\{.*\})\s*$/.exec(line);
  if (!m) return null;
  try { return { kind: m[1], data: JSON.parse(m[2]) }; } catch { return null; }
}
