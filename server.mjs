// CADS marketplace demo wrapper — multi-demo, application-oriented, bunsenbrenner.org style.
//
// Index (/) lists the portfolio; /d/<slug> is one demo's tool workspace. Every demo:
//   - installs via the real marketplace path (installActivate = the sim->real seam), Variante 1;
//   - is invoked per TYPE (photo-tool: run the installed tool on a real photo folder;
//     report-html: run the bundle entrypoint, render the produced HTML report);
//   - renders results in the bunsenbrenner.org design system (shared shell + per-type view).
// Design/copy live HERE (wrapper), never in the bundle → survive every reinstall by construction.
// Secrets (LLM key, Pexels key) load from wrapper/.env — never demos.json / shared artifacts.

import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, createReadStream, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, isAbsolute } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEMOS = JSON.parse(readFileSync(join(__dir, 'demos.json'), 'utf8'));
const WORK = join(__dir, 'work');
const PORT = Number(process.env.PORT || 8790);
// Default 0.0.0.0, not 127.0.0.1: a container bound to its own loopback is unreachable
// through Docker's port-publish NAT (the compose file's co-located ct-agent sidecar never hit
// this, since container-to-container traffic on the shared bridge network doesn't go through
// that NAT) -- caught deploying standalone (host ct-agent -> published port) where GET / just
// hung/connection-refused despite the container logging "wrapper on http://127.0.0.1:8790".
const HOST = process.env.HOST || '0.0.0.0';
const activated = new Map(); // slug -> { workDir, manifest, outputDir }
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// local env (LLM creds) — parse `export K=V` lines
const ENV = {};
try {
  for (const l of readFileSync(join(__dir, '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const CHROME_BIN = join(__dir, 'bin'); // google-chrome shim dir, prepended to PATH

const STAMP = {
  'photo1.jpg': ['2025:01:15 10:15:00', 52.5200, 13.4050], 'photo2.jpg': ['2025:01:15 11:30:00', 52.5200, 13.4050],
  'photo3.jpg': ['2025:01:15 09:00:00', 53.5511, 9.9937], 'photo4.jpg': ['2025:06:02 16:45:00', 53.5511, 9.9937],
  'photo5.jpg': ['2025:06:02 14:20:00', 48.1351, 11.5820], 'photo6.jpg': ['2025:11:30 08:05:00', 48.1351, 11.5820],
};

// ---- install seam (shared, sim->real) ----------------------------------------------------------
function installActivate(slug, emit, stage) {
  const d = DEMOS[slug];
  // manifestDir may be repo-relative (bundled in the image at manifests/<slug>, so it works on any
  // host) or an absolute path (legacy/local dev). Resolve relative paths against the wrapper dir —
  // this is what makes the bundle demos portable to the hosting machine (they used to point at a
  // local scratchpad path that only existed on the author's laptop -> "Abbruch bei der Installation").
  const md = isAbsolute(d.manifestDir) ? d.manifestDir : join(__dir, d.manifestDir);
  const manifest = JSON.parse(readFileSync(join(md, 'manifest.json'), 'utf8'));
  const bundlePath = join(md, 'bundle.tar.gz');
  stage('install', 'Installieren');
  emit('step', `Manifest beziehen — ${manifest.name} v${manifest.version}`);
  emit('sim', 'simuliert · Registry ist live (registry.bunsenbrenner.org), aber dieses Manifest ist noch nicht publiziert (blockiert von #37/#38) — lokal geladen');
  emit('step', 'Signatur (ed25519) prüfen');
  emit('sim', 'simuliert · braucht den Trust-Root der Live-Registry');
  emit('step', 'Bundle-Integrität (sha256) prüfen');
  const got = sha256File(bundlePath);
  if (got !== manifest.bundle.sha256) { emit('fail', 'sha256-Mismatch'); throw new Error('sha256'); }
  emit('real', `echt geprüft · sha256 ${got.slice(0, 12)}… == Manifest`);
  emit('step', 'Bundle entpacken & aktivieren');
  const workDir = join(WORK, slug);
  rmSync(workDir, { recursive: true, force: true }); mkdirSync(workDir, { recursive: true });
  if (spawnSync('tar', ['xzf', bundlePath, '-C', workDir]).status !== 0) { emit('fail', 'entpacken fehlgeschlagen'); throw new Error('unpack'); }
  emit('real', 'echt · installiert');
  const rec = { workDir, manifest, outputDir: null }; activated.set(slug, rec); return rec;
}

// ---- invoke: photo-tool ------------------------------------------------------------------------
function invokePhotoTool(slug, rec, emit, stage, done, reg) {
  const d = DEMOS[slug];
  stage('process', 'Fotos verarbeiten');
  const px = join(__dir, 'pexels');
  mkdirSync(d.inputDir, { recursive: true });
  let stamped = 0;
  for (const [fn, [date, lat, lon]] of Object.entries(STAMP)) {
    const dst = join(d.inputDir, fn); if (existsSync(dst)) continue;
    copyFileSync(join(px, fn), dst);
    spawnSync('exiftool', ['-q', '-overwrite_original', `-DateTimeOriginal=${date}`, `-GPSLatitude=${lat}`, '-GPSLatitudeRef=N', `-GPSLongitude=${lon}`, '-GPSLongitudeRef=E', dst]);
    stamped++;
  }
  emit(stamped ? 'sim' : 'ok', stamped ? `${stamped} Beispiel-Fotos mit repräsentativen Metadaten versehen (echte Kamerafotos bringen das selbst mit)` : 'Eingangsordner fotos/ bereit — 6 Fotos');
  emit('step', 'Werkzeug ausführen — phototools organize fotos/ → sortiert/');
  emit('ok', 'exiftool liest EXIF · Gazetteer GPS→Stadt · Dateien verschieben · ImageMagick Wasserzeichen+Kontaktbogen — keine KI');
  rmSync(d.outputDir, { recursive: true, force: true });
  const toolDir = join(rec.workDir, 'phototools');
  const args = [join(toolDir, 'bin', 'phototools.js'), 'organize', d.inputDir, '--out', d.outputDir, '--watermark-text', d.watermark, '--contact-sheet', '--gallery'];
  const child = spawn('node', args, { cwd: toolDir, env: { PATH: process.env.PATH, HOME: rec.workDir, CT_MANIFEST_PROJECT_NAME: `${slug}-demo` } });
  if (reg) reg(child);
  let o = ''; const on = (b) => { const s = b.toString(); o += s; s.split('\n').filter(Boolean).forEach((l) => emit('run', l)); };
  child.stdout.on('data', on); child.stderr.on('data', on);
  child.on('close', (code) => {
    const manPath = join(d.outputDir, 'manifest.json');
    if (code !== 0 || !existsSync(manPath)) { emit('fail', `organize exit ${code}`); return done(null); }
    rec.outputDir = d.outputDir;
    emit('real', 'echt · Ordner sortiert, Kontaktbogen erzeugt');
    const m = JSON.parse(readFileSync(manPath, 'utf8'));
    const byFolder = new Map();
    for (const e of m.entries || []) { const f = e.destRelPath.split('/').slice(0, 2).join('/'); byFolder.set(f, (byFolder.get(f) || 0) + 1); }
    done({ render: 'photo-tool', count: m.count, folders: [...byFolder.entries()].map(([path, count]) => ({ path, count })), contact: `/d/${slug}/out/contact-sheet.jpg?t=${Date.now()}`, gallery: existsSync(join(d.outputDir, 'gallery.html')) ? `/d/${slug}/out/gallery.html?t=${Date.now()}` : null });
  });
}

// ---- invoke: report-html -----------------------------------------------------------------------
const DE_MAP = [
  ['Hamburg Weekly Weather Briefing', 'Wöchentliches Wetter-Briefing Hamburg'],
  ['This Week at a Glance', 'Die Woche auf einen Blick'],
  ['Warmest day', 'Wärmster Tag'], ['Wettest day', 'Nassester Tag'], ['Windiest day', 'Windigster Tag'],
  ['Dry days (< 1mm)', 'Trockene Tage (< 1 mm)'], ['Dry days', 'Trockene Tage'],
  ['Daily Data', 'Tageswerte'], ['Temperature chart', 'Temperaturdiagramm'], ['Precipitation chart', 'Niederschlagsdiagramm'],
  ['>Temperature<', '>Temperatur<'], ['>Precipitation<', '>Niederschlag<'], ['>Date<', '>Datum<'],
  ['High (°C)', 'Höchst (°C)'], ['Low (°C)', 'Tiefst (°C)'], ['Precip (mm)', 'Niederschlag (mm)'], ['Wind max (km/h)', 'Wind max (km/h)'],
  ['Average daily high', 'Durchschnittliche Höchsttemperatur'], ['Average daily low', 'Durchschnittliche Tiefsttemperatur'],
  ['Coldest day', 'Kältester Tag'], ['Total precipitation', 'Gesamtniederschlag'], ['Calmest day', 'Windstillster Tag'],
  ['generated', 'erstellt'], ['source:', 'Quelle:'],
  ['Every figure above comes directly from the Open-Meteo forecast API response', 'Jede Zahl oben stammt direkt aus der Open-Meteo-Vorhersage-API-Antwort'],
  ['the narrative text above was written by', 'der obige Fließtext wurde geschrieben von'],
  ['selecting and phrasing these figures under an enforced facts-only guard', 'das die Zahlen unter einem erzwungenen Fakten-Guard auswählt und formuliert'],
  ['This is a demo artifact; forecast data is not archived and will differ on each regeneration', 'Dies ist ein Demo-Artefakt; die Vorhersagedaten werden nicht archiviert und unterscheiden sich bei jeder Erzeugung'],
  ['Generated by', 'Erzeugt von'],
];
function germanizeReport(html) {
  for (const [en, de] of DE_MAP) html = html.split(en).join(de);
  return html.replace(/([A-Za-zÄÖÜäöü]+) Weekly Weather Briefing/g, 'Wöchentliches Wetter-Briefing $1').replace(/(\d(?:\.\d)?)days/g, '$1 Tage').replace(/lang="en"/g, 'lang="de"');
}
function invokeReportHtml(slug, rec, emit, stage, done, reg, lang, cfg) {
  const d = DEMOS[slug]; cfg = cfg || {};
  lang = lang === 'en' ? 'en' : 'de';
  stage('process', lang === 'de' ? 'Report erstellen' : 'Build report');
  emit('step', 'Werkzeug ausführen — run.sh (Open-Meteo → Kennzahlen → Diagramme → LLM-Narrativ → HTML/PDF)');
  if (d.usesLLM) emit(ENV.LITELLM_BASE_URL ? 'ok' : 'sim', ENV.LITELLM_BASE_URL ? `LLM-Endpunkt gesetzt · Modell ${d.model} · Sprache ${lang.toUpperCase()}` : 'LLM-Zugang fehlt (LITELLM_*)');
  // Report language: swap the demo's narrative system prompt (DE from the wrapper, EN restored from
  // a backup taken on first run). The LLM (operator's DSGVO LiteLLM endpoint) then writes DE or EN.
  try {
    const tgt = join(rec.workDir, 'src', 'prompt', 'narrative_system_prompt.txt');
    const bak = join(rec.workDir, 'src', 'prompt', 'narrative_system_prompt.en.bak');
    if (existsSync(tgt) && !existsSync(bak)) copyFileSync(tgt, bak);
    const dePrompt = join(__dir, 'i18n', 'newsletter_de_prompt.txt');
    if (lang === 'de' && existsSync(dePrompt)) copyFileSync(dePrompt, tgt);
    else if (lang === 'en' && existsSync(bak)) copyFileSync(bak, tgt);
  } catch {}
  // Guided parameterization: apply the validated config (location/forecast_days) to config.yaml.
  if ((cfg.location && d.locations && d.locations[cfg.location]) || cfg.forecast_days) {
    try {
      const yp = join(rec.workDir, 'config', 'report.yaml'); let y = readFileSync(yp, 'utf8');
      if (cfg.location && d.locations[cfg.location]) { const [lat, lon, tz] = d.locations[cfg.location];
        y = y.replace(/name:\s*".*"/, `name: "${cfg.location}, DE"`).replace(/latitude:\s*[\d.]+/, `latitude: ${lat}`).replace(/longitude:\s*[\d.]+/, `longitude: ${lon}`).replace(/timezone:\s*".*"/, `timezone: "${tz}"`).replace(/report_title:\s*".*"/, `report_title: "${cfg.location} Weekly Weather Briefing"`); }
      if (cfg.forecast_days) y = y.replace(/days:\s*\d+/, `days: ${cfg.forecast_days}`);
      writeFileSync(yp, y);
      emit('ok', `Anpassung übernommen: ${[cfg.location && 'Ort ' + cfg.location, cfg.forecast_days && cfg.forecast_days + ' Tage'].filter(Boolean).join(', ')}`);
    } catch {}
  }
  const runPath = join(rec.workDir, 'run.sh'); spawnSync('chmod', ['+x', runPath]);
  const env = { PATH: `${CHROME_BIN}:${process.env.PATH}`, CT_MANIFEST_PROJECT_NAME: `${slug}-demo`,
    LITELLM_BASE_URL: ENV.LITELLM_BASE_URL || '', LITELLM_API_KEY: ENV.LITELLM_API_KEY || '', LITELLM_DEFAULT_MODEL: ENV.LITELLM_DEFAULT_MODEL || d.model || '' };
  const child = spawn(runPath, [], { cwd: rec.workDir, env });
  if (reg) reg(child);
  let o = ''; const on = (b) => { const s = b.toString(); o += s; s.split('\n').filter(Boolean).forEach((l) => emit('run', l.slice(0, 200))); };
  child.stdout.on('data', on); child.stderr.on('data', on);
  child.on('close', (code) => {
    const outDir = join(rec.workDir, d.outputRel);
    const html = join(outDir, d.htmlEntry);
    if (!existsSync(html)) { emit('fail', `Report nicht erzeugt (exit ${code})`); return done(null); }
    rec.outputDir = outDir;
    try { const py = join(rec.workDir, '.venv', 'bin', 'python'); if (existsSync(py) && existsSync(join(__dir, 'restyle_charts.py'))) { const rs = spawnSync(py, [join(__dir, 'restyle_charts.py'), outDir, cfg.accent_color || ''], { encoding: 'utf8' }); if (rs.status === 0) emit('ok', 'Diagramme im bunsenbrenner-Stil neu gestaltet'); } } catch {}
    if (lang === 'de') { try { const hp = join(outDir, d.htmlEntry); writeFileSync(hp, germanizeReport(readFileSync(hp, 'utf8'))); emit('ok', 'Report ins Deutsche übersetzt (Labels + LLM-Narrativ auf Deutsch)'); } catch {} }
    if (cfg.accent_color || cfg.font || (cfg.include && cfg.include.length < 3)) { try { const hp = join(outDir, d.htmlEntry); let h = readFileSync(hp, 'utf8');
      if (cfg.accent_color) h = h.replace(/#1f4e79/g, cfg.accent_color);
      if (cfg.font === 'serif') h = h.replace('</style>', 'h1,h2{font-family:Georgia,"Iowan Old Style",serif}</style>');
      else if (cfg.font === 'sans') h = h.replace('</style>', 'h1,h2{font-family:-apple-system,system-ui,Arial,sans-serif}</style>');
      if (cfg.include && !cfg.include.includes('precipitation')) h = h.replace(/<h2>(Precipitation|Niederschlag)<\/h2>\s*<div class="chart">[\s\S]*?<\/div>/, '');
      if (cfg.include && !cfg.include.includes('temperature')) h = h.replace(/<h2>(Temperature|Temperatur)<\/h2>\s*<div class="chart">[\s\S]*?<\/div>/, '');
      writeFileSync(hp, h); emit('ok', `Stil angewandt: ${[cfg.accent_color, cfg.font, cfg.include && cfg.include.join('+')].filter(Boolean).join(' · ')}`); } catch {} }
    if (code !== 0) emit('warn', `Nebenschritt exit ${code} — HTML-Report trotzdem erzeugt`);
    else emit('real', 'echt · Report erzeugt');
    const hasPdf = lang !== 'de' && existsSync(join(outDir, 'report.pdf'));
    done({ render: 'report-html', reportUrl: `/d/${slug}/out/${d.htmlEntry}?t=${Date.now()}`, pdf: hasPdf ? `/d/${slug}/out/report.pdf` : null, lang });
  });
}

// ---- guided parameterization: free text -> validated config via the DSGVO LLM ----------------
async function callLLM(system, user, maxTokens = 300, temp = 0.1) {
  const base = (ENV.LITELLM_BASE_URL || '').replace(/\/$/, '');
  const r = await fetch(base + '/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + ENV.LITELLM_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ENV.LITELLM_DEFAULT_MODEL, temperature: temp, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}
async function planConfig(slug, text) {
  const d = DEMOS[slug]; const dp = d && d.demo_prompt;
  if (!dp) return { error: 'Diese Demo hat (noch) keinen Anpassungs-Prompt.' };
  const schema = dp.parameters.map((p) => {
    const allowed = (p.type === 'enum' || p.type === 'multiselect') ? ` — erlaubt: ${p.options.join(', ')}` : p.type === 'int' ? ` — ${p.min}…${p.max}` : p.type === 'color' ? ' — Hex #rrggbb' : '';
    return `- ${p.name} (${p.type})${allowed}${p.note ? ' · ' + p.note : ''}`;
  }).join('\n');
  const system = `${dp.system}\n\nErlaubte Felder (nur diese, exakte Werte):\n${schema}\n\nWICHTIG: Gib NUR Felder zurück, die der Nutzer AUSDRÜCKLICH ändern will. Felder, die er nicht erwähnt, WEGLASSEN (nicht mit Standardwerten füllen). Wenn ein Wunsch NICHT zu den erlaubten Werten passt (z. B. eine nicht gelistete Stadt), das Feld WEGLASSEN — niemals raten oder durch einen anderen erlaubten Wert ersetzen.`;
  let raw = '';
  try { raw = await callLLM(system, text, 300); } catch (e) { return { error: 'LLM nicht erreichbar: ' + e.message }; }
  let obj = {}; try { const m = raw.match(/\{[\s\S]*\}/); obj = JSON.parse(m ? m[0] : raw); } catch { return { error: 'LLM-Antwort war kein gültiges JSON', raw }; }
  const config = {}, changed = [], rejected = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = dp.parameters.find((x) => x.name === k);
    if (!p) { rejected.push(`${k}: unbekanntes Feld`); continue; }
    if (p.type === 'enum') { const hit = p.options.find((o) => o.toLowerCase() === String(v).toLowerCase()); if (hit) { config[k] = hit; changed.push(`${k} → ${hit}`); } else rejected.push(`${k}: „${v}" nicht erlaubt`); }
    else if (p.type === 'color') { if (/^#[0-9a-fA-F]{6}$/.test(v)) { config[k] = v; changed.push(`${k} → ${v}`); } else rejected.push(`${k}: „${v}" ist keine Hex-Farbe`); }
    else if (p.type === 'multiselect') { const arr = (Array.isArray(v) ? v : [v]).map(String); const ok = arr.filter((x) => p.options.includes(x)); if (ok.length) { config[k] = ok; changed.push(`${k} → ${ok.join('+')}`); } arr.filter((x) => !p.options.includes(x)).forEach((x) => rejected.push(`${k}: „${x}" nicht verfügbar`)); }
    else if (p.type === 'int') { let n = parseInt(v, 10); if (!isNaN(n)) { const c = Math.max(p.min, Math.min(p.max, n)); config[k] = c; changed.push(`${k} → ${c}${c !== n ? ' (begrenzt)' : ''}`); } else rejected.push(`${k}: keine Zahl`); }
  }
  return { config, changed, rejected };
}
function handlePlan(req, res, url) {
  const slug = url.searchParams.get('demo');
  if (!DEMOS[slug]) { res.writeHead(404).end('unknown'); return; }
  let body = ''; req.on('data', (c) => { body += c; if (body.length > 4000) req.destroy(); });
  req.on('end', async () => {
    let text = ''; try { text = JSON.parse(body).text || ''; } catch {}
    const out = await planConfig(slug, String(text).slice(0, 500));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
  });
}

// ---- minimal Markdown -> styled HTML (for report-md demos like contractcheck) ---------------
function md2html(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n'); let html = ''; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) { const lang = l.slice(3).trim(); i++; let body = '';
      while (i < lines.length && !lines[i].startsWith('```')) { body += lines[i] + '\n'; i++; } i++;
      if (lang === 'diff') { const rows = body.replace(/\n$/, '').split('\n').map((r) => {
          const cls = r.startsWith('+') ? 'add' : r.startsWith('-') ? 'del' : r.startsWith('@') ? 'hunk' : '';
          return `<div class="dl ${cls}">${esc(r) || '&nbsp;'}</div>`; }).join('');
        html += `<div class="diff">${rows}</div>`; }
      else html += `<pre class="code">${esc(body)}</pre>`; continue; }
    if (l.startsWith('## ')) { html += `<h2>${esc(l.slice(3))}</h2>`; i++; continue; }
    if (l.startsWith('# ')) { html += `<h1>${esc(l.slice(2))}</h1>`; i++; continue; }
    if (l.trim() === '') { i++; continue; }
    let p = l; while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !lines[i + 1].startsWith('#') && !lines[i + 1].startsWith('```')) { p += ' ' + lines[i + 1]; i++; }
    html += `<p>${esc(p).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`; i++;
  }
  return `<!doctype html><meta charset="utf-8"><style>
    body{font-family:-apple-system,system-ui,"Segoe UI",sans-serif;color:#131A2C;line-height:1.6;margin:0;padding:22px 26px;background:#fff}
    h1{font-family:ui-serif,Georgia,serif;font-size:1.5rem;color:#131A2C;margin:0 0 14px;border-bottom:3px solid #2F8A7D;padding-bottom:10px}
    h2{font-family:ui-serif,Georgia,serif;font-size:1.12rem;color:#1F6B60;margin:26px 0 10px}
    p{max-width:70ch}code{background:#EEF1F8;padding:1px 5px;border-radius:4px;font-family:ui-monospace,Menlo,monospace;font-size:.9em}
    .code{background:#0f1524;color:#c7d2e0;padding:14px 16px;border-radius:8px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:.82rem;white-space:pre-wrap}
    .diff{border:1px solid #D7DEEC;border-radius:8px;overflow:hidden;font-family:ui-monospace,Menlo,monospace;font-size:.82rem}
    .dl{padding:2px 12px;white-space:pre-wrap;border-bottom:1px solid #F0F3F8}
    .dl.add{background:#e7f4ee;color:#1f6b60}.dl.del{background:#fbecea;color:#b23c30}.dl.hunk{background:#EEF1F8;color:#5B6478}
  </style>${html}`;
}

// ---- invoke: report-md (run entrypoint, render report.md -> HTML) ------------------------------
function invokeReportMd(slug, rec, emit, stage, done, reg) {
  const d = DEMOS[slug];
  stage('process', 'Verträge vergleichen');
  emit('step', 'Werkzeug ausführen — run.sh (pdftotext → difflib-Vergleich → Markdown-Report)');
  emit('ok', 'deterministisch · pdftotext liest die PDFs, difflib rechnet den Unterschied — keine KI im Kernpfad');
  const runPath = join(rec.workDir, d.entrypoint); spawnSync('chmod', ['+x', runPath]);
  // pass the LLM creds so contractcheck's `compare` can run its LLM text-summary + the visual (vision) comparison
  const child = spawn(runPath, [], { cwd: rec.workDir, env: { PATH: process.env.PATH, HOME: rec.workDir, CT_MANIFEST_PROJECT_NAME: `${slug}-demo`,
    LLM_BASE_URL: process.env.LITELLM_BASE_URL || '', LLM_API_KEY: process.env.LITELLM_API_KEY || '', LLM_MODEL: process.env.LITELLM_DEFAULT_MODEL || '' } });
  if (reg) reg(child);
  let o = ''; const on = (b) => { const s = b.toString(); o += s; s.split('\n').filter(Boolean).forEach((l) => emit('run', l.slice(0, 200))); };
  child.stdout.on('data', on); child.stderr.on('data', on);
  child.on('close', (code) => {
    const mdPath = join(rec.workDir, d.reportMd);
    if (!existsSync(mdPath)) { emit('fail', `Report nicht erzeugt (exit ${code})`); return done(null); }
    rec.outputDir = rec.workDir;
    try { writeFileSync(join(rec.workDir, 'report.html'), md2html(readFileSync(mdPath, 'utf8'))); } catch (e) { emit('fail', 'MD→HTML fehlgeschlagen'); return done(null); }
    emit('real', 'echt · Vergleich erzeugt, als Report gerendert');
    done({ render: 'report-html', reportUrl: `/d/${slug}/out/report.html?t=${Date.now()}`, pdf: null, lang: 'de' });
  });
}

// ---- invoke: image (diagram) -------------------------------------------------------------------
function invokeImage(slug, rec, emit, stage, done, reg, cfg = {}) {
  const d = DEMOS[slug];
  // Visitor-supplied inputs (validated): the free-text diagram description drives --description; the
  // tune-resolved engine/max_attempts drive their flags. Anything absent falls back to the demo default.
  const desc = (cfg && typeof cfg.description === 'string' && cfg.description.trim()) ? cfg.description.trim().slice(0, 600) : d.description;
  const engine = (cfg && (cfg.engine === 'mermaid' || cfg.engine === 'graphviz')) ? cfg.engine : d.engine;
  const maxAtt = (cfg && Number.isInteger(cfg.max_attempts)) ? String(Math.max(1, Math.min(5, cfg.max_attempts))) : '3';
  stage('process', 'Diagramm erzeugen');
  if (!ENV.LITELLM_BASE_URL) { emit('fail', 'LLM-Zugang fehlt (LITELLM_*) — diagram braucht das Modell'); return done(null); }
  emit('step', 'Abhängigkeiten (mermaid-cli) installieren — npm ci');
  const npm = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: rec.workDir, encoding: 'utf8', env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' } });
  if (npm.status !== 0) { emit('fail', 'npm ci fehlgeschlagen: ' + (npm.stderr || '').split('\n')[0]); return done(null); }
  emit('real', 'echt · mermaid-cli installiert');
  emit('step', 'LLM schreibt Mermaid, Renderer prüft & erzeugt PNG (mit Fehler-Korrektur-Schleife)');
  emit('ok', `LLM-Endpunkt · Modell ${d.model}`);
  const env = { PATH: process.env.PATH, HOME: rec.workDir, PUPPETEER_SKIP_DOWNLOAD: 'true', PUPPETEER_EXECUTABLE_PATH: d.chromePath,
    LITELLM_BASE_URL: ENV.LITELLM_BASE_URL, LITELLM_API_KEY: ENV.LITELLM_API_KEY, LITELLM_DEFAULT_MODEL: ENV.LITELLM_DEFAULT_MODEL || d.model };
  const args = [join(rec.workDir, d.tool), 'generate', '--description', desc, '--engine', engine, '--out', 'diagram.png', '--max-attempts', maxAtt, '--attempts-log', 'attempts.json'];
  const child = spawn('node', args, { cwd: rec.workDir, env });
  if (reg) reg(child);
  let o = ''; const on = (b) => { const s = b.toString(); o += s; s.split('\n').filter(Boolean).forEach((l) => emit('run', l.slice(0, 200))); };
  child.stdout.on('data', on); child.stderr.on('data', on);
  child.on('close', (code) => {
    const img = join(rec.workDir, 'diagram.png');
    if (code !== 0 || !existsSync(img)) { emit('fail', `Diagramm nicht erzeugt (exit ${code})`); return done(null); }
    rec.outputDir = rec.workDir;
    emit('real', 'echt · Diagramm-PNG erzeugt');
    done({ render: 'image', title: 'Erzeugtes Diagramm (Mermaid → PNG)', image: `/d/${slug}/out/diagram.png?t=${Date.now()}`, desc });
  });
}

// ---- invoke: timeline (temporal-poc) -----------------------------------------------------------
function invokeTimeline(slug, rec, emit, stage, done, reg) {
  const d = DEMOS[slug];
  stage('process', 'Ablauf ausführen (Worker killen & Recovery)');
  emit('step', 'run.sh — lokalen Temporal-Server starten, Workflow starten, Worker mitten drin killen, Recovery beweisen');
  emit('ok', 'startet lokal einen Temporal-Dev-Server (Ports 7233/8233) · echter Kill & Recovery');
  const runPath = join(rec.workDir, d.entrypoint); spawnSync('chmod', ['+x', runPath]);
  const child = spawn(runPath, [], { cwd: rec.workDir, env: { PATH: process.env.PATH, HOME: rec.workDir, CT_MANIFEST_PROJECT_NAME: `${slug}-demo`, ...(d.env || {}) } });
  if (reg) reg(child);
  let o = ''; const on = (b) => { const s = b.toString(); o += s; s.split('\n').filter(Boolean).forEach((l) => emit('run', l.slice(0, 200))); };
  child.stdout.on('data', on); child.stderr.on('data', on);
  child.on('close', (code) => {
    const hist = join(rec.workDir, d.produces.history);
    if (!existsSync(hist)) { emit('fail', `Kein Event-Verlauf erzeugt (exit ${code})`); return done(null); }
    rec.outputDir = rec.workDir;
    let steps = [];
    try {
      const ev = JSON.parse(readFileSync(hist, 'utf8')).events || [];
      const want = { WorkflowExecutionStarted: 'Workflow gestartet', ActivityTaskScheduled: 'Aufgabe eingeplant', ActivityTaskStarted: 'Aufgabe gestartet', ActivityTaskCompleted: 'Aufgabe abgeschlossen', WorkflowExecutionCompleted: 'Workflow abgeschlossen ✓' };
      for (const e of ev) { const t = (e.eventType || '').replace(/^EVENT_TYPE_/, '').replace(/_([a-z])/g, (m, c) => c.toUpperCase()); const key = t.charAt(0).toUpperCase() + t.slice(1);
        for (const [k, label] of Object.entries(want)) if (key === k) {
          let extra = ''; const att = e.activityTaskStartedEventAttributes; if (att && att.attempt) extra = `Versuch ${att.attempt}${att.attempt > 1 ? ' (nach Heartbeat-Timeout — neuer Worker übernimmt)' : ''}`;
          steps.push({ label, id: e.eventId, extra, recover: !!(att && att.attempt > 1) }); }
      }
    } catch (e) {}
    emit('real', `echt · ${steps.length} Ereignisse — Recovery im Verlauf belegt`);
    done({ render: 'timeline', steps });
  });
}

// ---- invoke: serve-existing media (podcast audio, explainer video) -----------------------------
function invokeServeMedia(slug, rec, emit, stage, done) {
  const d = DEMOS[slug];
  stage('process', d.type === 'audio' ? 'Folge bereitstellen' : 'Video bereitstellen');
  rec = rec || {}; rec.outputDir = d.staticOut; activated.set(slug, rec);
  emit('ok', d.hasManifest === false ? 'läuft aus der Quelle (noch kein Marktplatz-Manifest) · echtes, vorgerendertes Ergebnis' : 'echtes Ergebnis eines früheren Laufs (voller Render dauert zu lange für einen Klick)');
  if (d.type === 'audio') {
    let chapters = [], transcript = '';
    try { const c = JSON.parse(readFileSync(join(d.staticOut, d.chapters), 'utf8')); chapters = (c.chapters || c).map((x) => ({ t: (x.start_ms || 0) / 1000, title: x.title })); } catch {}
    try { transcript = readFileSync(join(d.staticOut, d.transcript), 'utf8').slice(0, 4000); } catch {}
    emit('real', `echt · Folge + ${chapters.length} Kapitel + Transkript`);
    done({ render: 'audio', audio: `/d/${slug}/out/${d.audio}?t=${Date.now()}`, chapters, transcript });
  } else {
    let scenes = [];
    try { const s = JSON.parse(readFileSync(join(d.staticOut, d.scenes), 'utf8')); scenes = (s.scenes || s).map((x, i) => ({ n: i + 1, title: x.title || x.heading || `Szene ${i + 1}`, dur: x.duration || x.durationSec })); } catch {}
    emit('real', `echt · Video + ${scenes.length} Szenen`);
    done({ render: 'video', video: `/d/${slug}/out/${d.video}?t=${Date.now()}`, scenes });
  }
}

function handleStart(req, res, url) {
  const slug = url.searchParams.get('demo');
  const fresh = url.searchParams.get('fresh') === '1';
  let lang = url.searchParams.get('lang') === 'en' ? 'en' : 'de';
  let cfg = {}; try { const c = url.searchParams.get('cfg'); if (c) cfg = JSON.parse(Buffer.from(c, 'base64').toString('utf8')); } catch {}
  if (cfg.language === 'en' || cfg.language === 'de') lang = cfg.language;
  const d = DEMOS[slug];
  if (!d) { res.writeHead(404).end('unknown'); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const emit = (t, text) => res.write(`event: ${t}\ndata: ${JSON.stringify({ text })}\n\n`);
  const stage = (id, label) => res.write(`event: stage\ndata: ${JSON.stringify({ id, label })}\n\n`);
  let child = null; let aborted = false;
  const reg = (c) => { child = c; if (aborted && c && !c.killed) try { c.kill('SIGKILL'); } catch {} };
  req.on('close', () => { aborted = true; if (child && !child.killed) { try { child.kill('SIGKILL'); } catch {} } });
  let rec = activated.get(slug);
  try {
    if (d.hasManifest === false) { stage('install', 'Bereit'); emit('ok', 'kein Marktplatz-Manifest — läuft aus der Quelle'); rec = rec || {}; }
    else if (fresh || !rec) { if (fresh) activated.delete(slug); rec = installActivate(slug, emit, stage); }
    else { stage('install', 'Bereit'); emit('cache', 'aus Cache · schon installiert'); }
  } catch (e) { emit('fail', 'Abbruch bei der Installation'); stage('error', 'Fehlgeschlagen'); res.end(); return; }
  if (aborted) { res.end(); return; }
  const cb = (result) => { if (aborted) { try { res.end(); } catch {} return; } if (result) res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`); stage(result ? 'done' : 'error', result ? 'Fertig' : 'Fehlgeschlagen'); emit('done', ''); res.end(); };
  if (d.type === 'photo-tool') invokePhotoTool(slug, rec, emit, stage, cb, reg);
  else if (d.type === 'report-html') invokeReportHtml(slug, rec, emit, stage, cb, reg, lang, cfg);
  else if (d.type === 'report-md') invokeReportMd(slug, rec, emit, stage, cb, reg);
  else if (d.type === 'image') invokeImage(slug, rec, emit, stage, cb, reg, cfg);
  else if (d.type === 'timeline') invokeTimeline(slug, rec, emit, stage, cb, reg);
  else if (d.type === 'audio' || d.type === 'video') invokeServeMedia(slug, rec, emit, stage, cb);
  else { emit('fail', 'Unbekannter Demo-Typ'); cb(null); }
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
function serveFile(res, path) {
  if (!existsSync(path)) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(path).pipe(res);
}
// Resolve a demo's output dir from the live activation OR from disk (so report/PDF/media links keep
// working across server restarts — the "nf" bug). staticOut demos serve a fixed pre-rendered dir.
function resolveOut(slug) {
  const rec = activated.get(slug); if (rec && rec.outputDir) return rec.outputDir;
  const d = DEMOS[slug]; if (!d) return null;
  if (d.staticOut) return d.staticOut;
  if (d.type === 'photo-tool') return d.outputDir;
  if (d.type === 'report-html') return join(WORK, slug, d.outputRel);
  if (d.type === 'report-md' || d.type === 'image' || d.type === 'timeline') return join(WORK, slug);
  return null;
}

// ---- shared design system ----------------------------------------------------------------------
const BB_CSS = `
:root{--bg:#0c111d;--card:#141b2c;--ink:#eef1f7;--muted:#8a93ad;--muted2:#c3c9db;--teal:#5fb8ab;--teal-ink:#8fd6c9;--terra:#d98a4f;--terra-ink:#e0a458;--border:#2a3450;--panel:#1a2338;--panel2:#212a41;--bg-blur:rgba(12,17,29,.85);--on-accent:#0c111d;--serif:ui-serif,Georgia,"Iowan Old Style","Palatino Linotype",serif;--sans:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme: light){:root{--bg:#F5F7FB;--card:#FFFFFF;--ink:#131A2C;--muted:#5B6478;--muted2:#333D54;--teal:#2F8A7D;--teal-ink:#1F6B60;--terra:#B8672F;--terra-ink:#9A531F;--border:#D7DEEC;--panel:#EEF1F8;--panel2:#E7ECF5;--bg-blur:rgba(245,247,251,.85);--on-accent:#ffffff}}
*{box-sizing:border-box}a{color:var(--teal-ink);text-decoration:none}a:hover{color:var(--teal)}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:44px 44px;background-position:-1px -1px}
.appbar{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;background:var(--bg-blur);backdrop-filter:blur(6px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:5}
.appbar .l{display:flex;align-items:center;gap:16px}
.brand{font-weight:700;font-size:1rem;letter-spacing:-.01em;display:flex;align-items:center;gap:.5ch;color:var(--ink);text-decoration:none}.brand:hover{color:var(--ink)}
.brand .dot{color:var(--terra)}.brand .tld{color:var(--muted);font-weight:600}
.crumb{font-family:var(--mono);font-size:.76rem;color:var(--muted);letter-spacing:.04em}.crumb b{color:var(--muted2)}.crumb a{color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:.72rem;color:var(--teal-ink);background:rgba(47,138,125,.09);border:1px solid rgba(47,138,125,.25);border-radius:999px;padding:.28rem .66rem}
.chip .d{width:7px;height:7px;border-radius:50%;background:var(--teal)}
.wrap{max-width:1120px;margin:0 auto;padding:24px 28px 40px}
.eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--teal);font-weight:600;margin:26px 0 12px}
.eyebrow .lead{color:var(--border);margin-right:.6ch}
h1{font-family:var(--serif);font-weight:600;font-size:2.3rem;line-height:1.1;letter-spacing:-.015em;margin:0 0 12px;max-width:20ch;text-wrap:balance}
.lede{font-size:1.1rem;color:var(--muted2);max-width:60ch;margin:0}
.toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;padding-bottom:18px;border-bottom:1px solid var(--border)}
.toolbar h1{font-size:1.7rem;margin:0 0 4px}.toolbar p{margin:0;color:var(--muted2);font-size:.95rem;max-width:60ch}
.controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.setting{display:flex;align-items:center;gap:8px;font-size:.82rem;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.42rem .7rem}
.setting .k{font-family:var(--mono);font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.setting .v{font-weight:600}.setting .v.on{color:var(--teal-ink)}
.btn{font:600 .92rem var(--sans);border-radius:9px;padding:.62rem 1.2rem;border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;gap:.5ch}
.btn-primary{background:var(--terra);color:var(--on-accent)}.btn-primary:hover{background:var(--terra-ink)}
.btn-ghost{background:var(--card);color:var(--muted2);border:1px solid var(--border)}.btn-ghost:hover{color:var(--ink)}
.btn:disabled{opacity:.55;cursor:progress}
.io{display:flex;align-items:center;gap:10px;margin:16px 0 4px;font-family:var(--mono);font-size:.78rem;color:var(--muted2);flex-wrap:wrap}
.io .path{background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:.28rem .6rem;color:var(--ink)}.io .ar{color:var(--teal)}
.grid2{display:grid;grid-template-columns:390px 1fr;gap:22px;margin-top:14px;align-items:start}
@media(max-width:860px){.grid2{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--border);border-radius:13px;box-shadow:0 1px 2px rgba(19,26,44,.03);overflow:hidden}
.ph{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)}
.ph h2{font-family:var(--serif);font-weight:600;font-size:1.05rem;margin:0}.ph .count{font-family:var(--mono);font-size:.72rem;color:var(--muted)}
.tray{padding:8px 8px 12px}
.prow{display:flex;align-items:center;gap:12px;padding:8px;border-radius:10px}.prow:hover{background:var(--panel)}
.prow img{width:60px;height:45px;object-fit:cover;border-radius:6px;flex:0 0 auto;box-shadow:inset 0 0 0 1px rgba(19,26,44,.1)}
.pn{font-family:var(--mono);font-size:.8rem}
.pt{display:flex;gap:12px;margin-top:2px;font-size:.72rem;color:var(--muted);flex-wrap:wrap}
.pt .lab{font-family:var(--mono);font-size:.62rem;letter-spacing:.05em;text-transform:uppercase;color:var(--teal-ink);margin-right:4px}
.credit{font-size:.68rem;color:var(--muted);margin-top:1px}
.out{display:flex;flex-direction:column;gap:20px;min-height:120px}
.placeholder{display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);font-size:.9rem;padding:40px 20px;border:1.5px dashed var(--border);border-radius:12px;background:var(--card)}
.tree{padding:8px 10px 12px}
.frow{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:9px;font-family:var(--mono);font-size:.82rem;color:var(--muted2)}
.frow:hover{background:var(--panel)}.frow .car{color:var(--teal);font-size:.7rem}.frow .fold{color:var(--ink);font-weight:600}.frow .yr{color:var(--muted)}
.frow .n{margin-left:auto;font-size:.72rem;color:var(--muted);background:var(--panel2);border-radius:999px;padding:.15rem .55rem}
.sheetwrap{padding:16px}.sheetwrap img{width:100%;border:1px solid var(--border);border-radius:9px;display:block}
.reportframe{width:100%;height:640px;border:1px solid var(--border);border-radius:9px;background:#fff}
.sheetwrap img.resimg{width:auto;max-width:100%;max-height:75vh;height:auto;object-fit:contain;border:1px solid var(--border);border-radius:9px;display:block;background:#fff;margin:0 auto;padding:10px;box-sizing:border-box}
ol.timeline{list-style:none;margin:0;padding:10px 16px 16px}
ol.timeline li.tstep{position:relative;padding:9px 10px 9px 26px;border-left:2px solid var(--border);margin-left:8px;font-size:.9rem}
ol.timeline li.tstep::before{content:"";position:absolute;left:-7px;top:13px;width:11px;height:11px;border-radius:50%;background:var(--teal);border:2px solid var(--card)}
ol.timeline li.tstep.rec{border-left-color:var(--terra)}ol.timeline li.tstep.rec::before{background:var(--terra)}
ol.timeline .ex{color:var(--terra-ink);font-size:.82rem;font-family:var(--mono)}
ol.chapters,ol.scenes{list-style:none;margin:12px 0 0;padding:0;font-size:.88rem}
ol.chapters li,ol.scenes li{padding:8px 10px;border-bottom:1px solid var(--border)}
ol.chapters li{cursor:pointer;border-radius:7px}ol.chapters li:hover{background:var(--panel)}
ol.chapters .ct{font-family:var(--mono);font-size:.76rem;color:var(--teal-ink);margin-right:8px}
details.tx summary{cursor:pointer;font-size:.85rem;color:var(--muted2);font-weight:600}
.txbody{white-space:pre-wrap;font-family:var(--mono);font-size:.74rem;color:var(--muted2);max-height:220px;overflow:auto;background:var(--panel);border-radius:8px;padding:10px 12px;margin-top:8px}
.stepper{display:flex;gap:10px;margin:16px 0 4px;flex-wrap:wrap}
.st{display:flex;align-items:center;gap:9px;font-size:.88rem;color:var(--muted);padding:7px 13px;border:1px solid var(--border);border-radius:999px;background:var(--card)}
.st .n{width:19px;height:19px;border-radius:50%;border:1.5px solid var(--border);display:grid;place-items:center;font:600 .7rem var(--mono);color:var(--muted)}
.st.active{border-color:var(--teal);color:var(--ink);box-shadow:0 0 0 3px rgba(47,138,125,.1)}.st.active .n,.st.done .n{border-color:var(--teal);background:var(--teal);color:var(--on-accent)}
.st.done{color:var(--ink)}.st.error{border-color:var(--terra);color:var(--terra-ink)}.st.error .n{border-color:var(--terra);background:var(--terra);color:var(--on-accent)}
details.tech{margin-top:12px;border:1px solid var(--border);border-radius:10px;background:var(--panel);overflow:hidden}
details.tech summary{cursor:pointer;padding:11px 15px;font-size:.86rem;color:var(--muted2);font-weight:600;list-style:none;display:flex;align-items:center;gap:8px}
details.tech summary::-webkit-details-marker{display:none}
details.tech summary::before{content:"▸";color:var(--teal)}details.tech[open] summary::before{content:"▾"}
.log{font-family:var(--mono);font-size:.76rem;line-height:1.7;background:#0f1524;color:#c7d2e0;padding:13px 15px;max-height:230px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.log .l{display:block}.log .step{color:#8fb4ff}.log .real{color:#5fd0ad}.log .sim{color:#e0a458}.log .cache{color:#e0a458}.log .run{color:#c7d2e0}.log .ok{color:#9fb0c4}.log .warn{color:#e0a458}.log .fail{color:#f2726b;font-weight:600}
.note{display:flex;gap:12px;align-items:flex-start;margin-top:18px;padding:14px 16px;background:var(--card);border:1px solid var(--border);border-radius:11px;font-size:.88rem;color:var(--muted2)}
.note .t{font-family:var(--mono);font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-ink);font-weight:600;padding-top:2px;white-space:nowrap}.note b{color:var(--ink)}
.prov{margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:11px;font-size:.8rem;color:var(--muted2)}
.prov .ok{color:var(--teal-ink);font-weight:600}.prov .sim{color:var(--terra-ink)}.prov .sep{color:var(--border)}
.capbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0 2px}
.caplabel{color:var(--muted);font-family:var(--mono);font-size:.68rem;text-transform:uppercase;letter-spacing:.09em;margin-right:2px}
.capchip{display:inline-flex;align-items:center;gap:6px;padding:.26rem .62rem;border-radius:999px;border:1px solid var(--border);background:var(--card);font-size:.78rem;color:var(--muted2)}
.capchip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--muted);flex:0 0 auto}
.cap-free::before{background:#2f8a5f}.cap-busy::before{background:var(--terra)}.cap-info::before{background:var(--teal)}.cap-un{color:var(--muted)}
.upcmp{margin:22px 0 4px;padding:16px 18px;border:1px dashed var(--border);border-radius:12px;background:var(--card)}
.upttl{font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:10px}
.uprow{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.upf{display:flex;flex-direction:column;gap:5px;font-size:.82rem;color:var(--muted2)}
.upf input[type=file]{font:inherit;font-size:.78rem;max-width:230px}
.upmsg{margin-top:10px;font-size:.82rem;color:var(--muted2);min-height:1.1em}
.res-upreport{margin-top:14px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;margin-top:26px}
.dcard{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border);border-radius:13px;padding:20px 22px;box-shadow:0 1px 2px rgba(19,26,44,.03);text-decoration:none;color:inherit;transition:border-color .15s,transform .15s}
.dcard:hover{border-color:var(--teal);transform:translateY(-2px)}
.dcard .k{font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-ink);font-weight:600}
.dcard h3{font-family:var(--serif);font-weight:600;font-size:1.2rem;margin:8px 0 6px}
.dcard p{margin:0 0 16px;color:var(--muted2);font-size:.9rem;flex:1}
.dcard .go{font-weight:600;color:var(--terra-ink);font-size:.88rem}
.dcard.soon{opacity:.62}.dcard.soon:hover{border-color:var(--border);transform:none}.dcard .soonlbl{color:var(--muted);font-weight:600}
.progress{margin:16px 0 6px}.pbar{height:8px;background:var(--panel2);border-radius:999px;overflow:hidden;border:1px solid var(--border)}.pbar>i{display:block;height:100%;background:var(--teal);width:0;transition:width .5s ease}
.pmeta{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:9px;font-family:var(--mono);font-size:.75rem;color:var(--muted)}
.btn-cancel{font:600 .8rem var(--sans);color:var(--terra-ink);background:var(--card);border:1px solid var(--border);border-radius:7px;padding:.34rem .8rem;cursor:pointer}.btn-cancel:hover{border-color:var(--terra)}
.langtoggle{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;font-family:var(--mono);font-size:.74rem}
.langtoggle a{padding:.42rem .6rem;color:var(--muted);text-decoration:none;background:var(--card)}.langtoggle a.on{background:var(--teal);color:var(--on-accent)}
.tune{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin:4px 0 18px}
.tune-h{display:flex;flex-direction:column;gap:3px;margin-bottom:12px}
.teyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--teal-ink);font-weight:600}
.tsub{color:var(--muted2);font-size:.88rem;max-width:74ch}
.tune-row{display:flex;gap:10px;flex-wrap:wrap}
.tuneinput{flex:1;min-width:240px;border:1px solid var(--border);border-radius:8px;padding:.6rem .8rem;font:400 .95rem var(--sans);color:var(--ink);background:var(--bg)}
.tuneinput:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(47,138,125,.12)}
.descfield{display:block;margin:2px 0 14px}.descfield .dl{display:block;font-size:.82rem;color:var(--muted2);margin-bottom:6px}
.descinput{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:8px;padding:.6rem .8rem;font:400 .95rem var(--sans);color:var(--ink);background:var(--bg);resize:vertical}
.descinput:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(47,138,125,.12)}
.tune-ex{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.exlbl{font-size:.76rem;color:var(--muted)}
.exchip{font:500 .78rem var(--sans);color:var(--muted2);background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:.3rem .7rem;cursor:pointer}
.exchip:hover{border-color:var(--teal);color:var(--ink)}
.tunepreview{margin-top:14px;border-top:1px solid var(--border);padding-top:14px}
.pv-h{font-size:.85rem;color:var(--muted2);font-weight:600;margin-bottom:8px}
ul.pv{list-style:none;margin:0 0 12px;padding:0;font-family:var(--mono);font-size:.82rem}
ul.pv li{padding:3px 0}ul.pv li.ok{color:var(--teal-ink)}ul.pv li.ok::before{content:"✓ "}
ul.pv li.rej{color:var(--terra-ink)}ul.pv li.rej::before{content:"✕ "}
ul.pv li.pmuted{color:var(--muted)}
.pmuted{color:var(--muted);font-size:.85rem}.perr{color:var(--terra-ink);font-size:.85rem}
.appliedbadge{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:.72rem;color:var(--teal-ink);background:rgba(47,138,125,.09);border:1px solid rgba(47,138,125,.25);border-radius:999px;padding:.26rem .6rem;margin-left:8px}
footer{margin:34px auto 40px;max-width:1120px;padding:20px 28px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:16px 24px;flex-wrap:wrap;color:var(--muted);font-size:.82rem}
footer{flex-direction:column;align-items:flex-start}
footer .fl{display:flex;gap:18px;flex-wrap:wrap;align-items:center}footer a{color:var(--muted2)}footer .support{color:var(--terra-ink);font-weight:600}footer .fnote{color:var(--muted)}
footer .attrib{color:var(--muted2)}footer .attrib b{color:var(--ink);font-weight:600}footer .attrib a{color:var(--teal-ink)}
.m-toggle{display:none;margin:16px 0 2px;font:600 .85rem var(--sans);color:var(--muted2);background:var(--card);border:1px solid var(--border);border-radius:9px;padding:.5rem 1rem;cursor:pointer;align-items:center;gap:.5ch}.m-toggle:hover{color:var(--ink);border-color:var(--teal)}@media(max-width:640px){.m-toggle{display:inline-flex}body:not(.m-open) .io,body:not(.m-open) .note,body:not(.m-open) .prov,body:not(.m-open) .capbar,body:not(.m-open) .caplabel,body:not(.m-open) details.tech,body:not(.m-open) .tune-ex,body:not(.m-open) .grid2>aside{display:none!important}}
`;

function appbar(crumb) {
  return `<header class="appbar"><div class="l"><a class="brand" href="https://bunsenbrenner.org"><span class="dot">◆</span>Bunsenbrenner<span class="tld">.org</span></a>
    <span class="crumb">${crumb}</span></div><span class="chip"><span class="d"></span>lokal aktiv · offline</span></header>`;
}
const SUPPORT = `<a class="support" href="https://steady.page/plans/77a32d9c-c399-4ca1-9515-7a628c7a9413" target="_blank" rel="noopener">Als Mitglied unterstützen →</a><a class="support" href="https://buymeacoffee.com/bunsenbrenner" target="_blank" rel="noopener">Buy me a coffee →</a><a href="https://github.com/scimbe/CADS-Tunnel" target="_blank" rel="noopener">GitHub</a><a href="https://bunsenbrenner.org/legal-notice" target="_blank" rel="noopener">Legal Notice</a><a href="https://bunsenbrenner.org/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a><a href="https://bunsenbrenner.org/terms-of-use" target="_blank" rel="noopener">Terms of Use</a>`;
const SERVED_BY = process.env.SERVED_BY || 'customer';
const FOOT = `<footer><div class="fl">${SUPPORT}</div>
<div class="attrib"><b>Supported by <a href="https://bunsenbrenner.org" target="_blank" rel="noopener">bunsenbrenner.org</a></b> · served by ${SERVED_BY}</div>
<div class="fnote">Deterministische Werkzeuge lokal · Sprachmodelle DSGVO-konform in Deutschland, ohne Datenspeicherung · Beispielfotos von <a href="https://www.pexels.com" target="_blank" rel="noopener">Pexels</a></div></footer>`;

const TYPE_LABEL = { 'photo-tool': 'Werkzeug · lokal', 'report-html': 'Report · LLM', 'report-md': 'Vergleich · lokal', image: 'Bild · LLM', timeline: 'Ablauf · lokal', audio: 'Audio', video: 'Video', 'service-proxy': 'Dauerdienst', external: 'Studio · live' };
function indexPage() {
  const cards = Object.entries(DEMOS).map(([slug, d]) => {
    const label = TYPE_LABEL[d.type] || 'Demo';
    // external: a live interactive app served elsewhere (its own subdomain) — link straight out
    if (d.type === 'external' && d.externalUrl) return `<a class="dcard" href="${d.externalUrl}" target="_blank" rel="noopener"><span class="k">${label}</span><h3>${d.title}</h3><p>${d.blurb}</p><span class="go">Öffnen →</span></a>`;
    if (d.live) return `<a class="dcard" href="/d/${slug}"><span class="k">${label}</span><h3>${d.title}</h3><p>${d.blurb}</p><span class="go">Öffnen →</span></a>`;
    return `<div class="dcard soon"><span class="k">${label}</span><h3>${d.title}</h3><p>${d.blurb}</p><span class="go soonlbl">bald verfügbar</span></div>`;
  }).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Marktplatz-Demos · Bunsenbrenner.org</title><style>${BB_CSS}</style></head><body>
${appbar('Marktplatz / <b>Demos</b>')}
<div class="wrap">
  <div class="eyebrow"><span class="lead">—</span>Marktplatz · besuchbare Demos</div>
  <h1>Werkzeuge zum Ausprobieren, direkt aus dem Marktplatz.</h1>
  <p class="lede">Jede Demo wird über den echten Marktplatz-Weg installiert. Die <b>deterministischen Werkzeuge laufen lokal</b> auf diesem Rechner; wo ein Sprachmodell nötig ist, läuft es auf <b>DSGVO-konformen Servern in Deutschland</b> — kleine Modelle, die zu keinem Zeitpunkt Daten speichern. Klick eine an und probier sie aus.</p>
  <div id="capbar" class="capbar" hidden></div>
  <div class="cards">${cards}</div>
</div>${FOOT}
<script>
(function(){
  var bar=document.getElementById('capbar'); if(!bar) return;
  function chip(label,cls,txt){return '<span class="capchip '+cls+'">'+label+': '+txt+'</span>';}
  function fmt(p){return (p||p===0)?(' · ~'+Number(p).toFixed(1)+' s'):'';}
  async function poll(){
    try{
      var j=await (await fetch('/api/status')).json();
      if(!j||!j.ok){ bar.innerHTML='<span class="capchip cap-un">Auslastung momentan nicht abrufbar</span>'; bar.hidden=false; return; }
      var s=j.svc||{}, parts=[];
      var tts=s['audio_generation.primary'];
      if(tts){ var busy=(tts.active+tts.queued)>0; parts.push(chip('Sprachausgabe', busy?'cap-busy':'cap-free', (busy?('ausgelastet · '+tts.queued+' in Warteschlange'):'frei')+fmt(tts.p50))); }
      var ol=s.ollama;
      if(ol){ parts.push(chip('Sprachmodell','cap-info',((ol.models&&ol.models.length)?ol.models.join(', '):'geladen')+(ol.parallel?(' · '+ol.parallel+'× parallel'):''))); }
      if(parts.length){ bar.innerHTML='<span class="caplabel">Aktuelle KI-Dienst-Auslastung</span>'+parts.join(''); bar.hidden=false; }
    }catch(e){ /* keep whatever is shown; never break the page */ }
  }
  poll(); setInterval(poll, 15000);
})();
</script>
</body></html>`;
}

const CLIENT = `
// Mobile-minimal view: on narrow screens the secondary blocks are hidden until the visitor asks.
(function(){var mt=document.querySelector('.m-toggle');if(!mt)return;mt.addEventListener('click',function(){var o=document.body.classList.toggle('m-open');mt.setAttribute('aria-expanded',o?'true':'false');mt.textContent=o?'weniger anzeigen \u25b4':'mehr anzeigen \u25be';});})();
document.querySelectorAll('button.run').forEach(btn=>btn.addEventListener('click',()=>{
  const wrap=document.querySelector('.wrap');const slug=wrap.dataset.slug;const fresh=btn.dataset.fresh;
  const out=document.querySelector('.out');const stepper=out.querySelector('.stepper');const log=out.querySelector('.log');
  const tech=out.querySelector('details.tech');const ph=out.querySelector('.placeholder');
  const rt=out.querySelector('.res-tree');const rs=out.querySelector('.res-sheet');const rr=out.querySelector('.res-report');
  stepper.hidden=false;tech.hidden=false;log.innerHTML='';if(ph)ph.style.display='none';
  out.querySelectorAll('section.panel').forEach(x=>{if(x.className.indexOf('res-')>=0)x.hidden=true});
  const fmt=(s)=>{s=Math.floor(s||0);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
  out.querySelectorAll('.st').forEach(s=>s.className='st');
  document.querySelectorAll('button.run').forEach(b=>b.disabled=true);
  const est=Math.max(4,parseInt(wrap.dataset.est||'20',10));
  let prog=out.querySelector('.progress');
  if(!prog){prog=document.createElement('div');prog.className='progress';
    prog.innerHTML='<div class="pbar"><i></i></div><div class="pmeta"><span class="ptxt"></span><button class="btn-cancel" type="button">Abbrechen</button></div>';
    stepper.after(prog);}
  prog.style.display='';const bar=prog.querySelector('.pbar>i');bar.style.background='var(--teal)';const ptxt=prog.querySelector('.ptxt');
  let cancel=prog.querySelector('.btn-cancel');if(!cancel){cancel=document.createElement('button');cancel.type='button';cancel.className='btn-cancel';cancel.textContent='Abbrechen';prog.querySelector('.pmeta').appendChild(cancel);}
  const t0=Date.now();let done=false;
  const tick=()=>{if(done)return;const el=(Date.now()-t0)/1000;bar.style.width=Math.min(95,el/est*100)+'%';ptxt.textContent='läuft … '+Math.round(el)+'s von ~'+est+'s erwartet';};
  const iv=setInterval(tick,400);tick();
  const line=(c,t)=>{const e=document.createElement('span');e.className='l '+c;e.textContent=t;log.appendChild(e);log.scrollTop=log.scrollHeight};
  var _cfg={}; try{ if(window.__cfg) _cfg=JSON.parse(decodeURIComponent(escape(atob(window.__cfg)))); }catch(e){}
  var _di=document.querySelector('.descinput'); if(_di && _di.value.trim()) _cfg.description=_di.value.trim();
  var _cfgP=Object.keys(_cfg).length?('&cfg='+encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(_cfg)))))):'';
  const es=new EventSource('/api/start?demo='+encodeURIComponent(slug)+'&fresh='+fresh+'&lang='+(wrap.dataset.lang||'de')+_cfgP);
  const stop=(ok,txt,terra)=>{if(done)return;done=true;clearInterval(iv);bar.style.width='100%';if(terra)bar.style.background='var(--terra)';ptxt.textContent=txt;if(cancel){cancel.remove();cancel=null;}document.querySelectorAll('button.run').forEach(b=>b.disabled=false);try{es.close()}catch(e){}};
  cancel.addEventListener('click',()=>{const s=Math.round((Date.now()-t0)/1000);line('warn','Abgebrochen durch Nutzer nach '+s+'s.');
    const a=[...out.querySelectorAll('.st')].find(x=>!x.classList.contains('done'));if(a)a.className='st error';
    stop(false,'abgebrochen nach '+s+'s',true);});
  ['step','real','sim','run','cache','ok','warn','fail'].forEach(t=>es.addEventListener(t,e=>line(t,({step:'▸ ',real:'✓ ',sim:'· ',run:'  ',cache:'✓ ',ok:'· ',warn:'! ',fail:'✕ '}[t]||'')+JSON.parse(e.data).text)));
  es.addEventListener('stage',e=>{const {id}=JSON.parse(e.data);const steps=['install','process','done'];const idx=steps.indexOf(id);
    out.querySelectorAll('.st').forEach(s=>{const si=steps.indexOf(s.dataset.step);if(id==='error'){if(!s.classList.contains('done'))s.classList.add('active');return}
      s.classList.toggle('done',si<idx||(si===idx&&id==='done'));s.classList.toggle('active',si===idx&&id!=='done')});
    if(id==='error'){const a=[...out.querySelectorAll('.st')].find(s=>!s.classList.contains('done'));if(a)a.className='st error'}});
  es.addEventListener('result',e=>{const r=JSON.parse(e.data);
    if(r.render==='photo-tool'){rt.querySelector('.count').textContent=r.count+' Fotos · '+r.folders.length+' Ordner';
      const tree=rt.querySelector('.tree');tree.innerHTML='';
      for(const f of r.folders){const p=f.path.split('/');const row=document.createElement('div');row.className='frow';
        row.innerHTML='<span class="car">▸</span><span class="yr">'+p[0]+' /</span><span class="fold">'+p[1]+'</span><span class="n">'+f.count+(f.count>1?' Fotos':' Foto')+'</span>';tree.appendChild(row)}
      rt.hidden=false;rs.querySelector('img').src=r.contact;rs.hidden=false;
      var g=rs.querySelector('.opengal');if(g){if(r.gallery){g.href=r.gallery;g.style.display='';}else{g.style.display='none';}}}
    else if(r.render==='report-html'){const s=out.querySelector('.res-report');const fr=s.querySelector('iframe');fr.src=r.reportUrl;s.hidden=false;
      s.querySelector('.openrep').href=r.reportUrl;const pl=s.querySelector('.pdflink');if(r.pdf){pl.href=r.pdf;pl.hidden=false}else if(pl)pl.hidden=true;}
    else if(r.render==='image'){const s=out.querySelector('.res-image');s.querySelector('.resimg').src=r.image;s.querySelector('.openimg').href=r.image;s.hidden=false;}
    else if(r.render==='timeline'){const s=out.querySelector('.res-timeline');const ol=s.querySelector('.timeline');ol.innerHTML='';
      for(const st of r.steps){const li=document.createElement('li');li.className='tstep'+(st.recover?' rec':'');li.innerHTML='<b>'+st.label+'</b>'+(st.extra?' <span class="ex">'+st.extra+'</span>':'');ol.appendChild(li)}s.hidden=false;}
    else if(r.render==='audio'){const s=out.querySelector('.res-audio');s.querySelector('.resaudio').src=r.audio;const ol=s.querySelector('.chapters');ol.innerHTML='';
      for(const c of r.chapters){const li=document.createElement('li');li.innerHTML='<span class="ct">'+fmt(c.t)+'</span> '+c.title;li.onclick=()=>{const a=s.querySelector('.resaudio');a.currentTime=c.t;a.play()};ol.appendChild(li)}
      if(r.transcript)s.querySelector('.txbody').textContent=r.transcript;s.hidden=false;}
    else if(r.render==='video'){const s=out.querySelector('.res-video');s.querySelector('.resvideo').src=r.video;const ol=s.querySelector('.scenes');ol.innerHTML='';
      for(const sc of r.scenes){const li=document.createElement('li');li.textContent='Szene '+sc.n+' — '+sc.title+(sc.dur?' ('+Math.round(sc.dur)+' s)':'');ol.appendChild(li)}s.hidden=false;}
  });
  es.addEventListener('done',()=>stop(true,'fertig in '+Math.round((Date.now()-t0)/1000)+'s',false));
  es.onerror=()=>stop(false,'Verbindung beendet',true);
}));
(function(){
  var tune=document.querySelector('.tune'); if(!tune)return;
  var wrap=document.querySelector('.wrap'); var slug=wrap&&wrap.dataset.slug;
  var inp=tune.querySelector('.tuneinput'); var prev=tune.querySelector('.tunepreview');
  tune.querySelectorAll('.exchip').forEach(function(c){c.addEventListener('click',function(){inp.value=c.textContent;inp.focus();});});
  tune.querySelector('.tunebtn').addEventListener('click',function(){
    var text=inp.value.trim(); if(!text)return;
    prev.hidden=false; prev.innerHTML='<span class="pmuted">Das LLM übersetzt deinen Wunsch in eine geprüfte Konfiguration …</span>';
    fetch('/api/plan?demo='+encodeURIComponent(slug),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text})}).then(function(r){return r.json();}).then(function(j){
      if(j.error){prev.innerHTML='<span class="perr">'+j.error+'</span>';window.__cfg='';return;}
      var changed=(j.changed||[]).map(function(c){return '<li class="ok">'+c+'</li>';}).join('');
      var rej=(j.rejected||[]).map(function(c){return '<li class="rej">'+c+'</li>';}).join('');
      var hasChange=Object.keys(j.config||{}).length>0;
      window.__cfg=hasChange?btoa(unescape(encodeURIComponent(JSON.stringify(j.config)))):'';
      prev.innerHTML='<div class="pv-h">Aufgelöste Anpassung — Vorschau, nichts wird gespeichert:</div><ul class="pv">'+(changed||'<li class="pmuted">keine gültige Änderung erkannt</li>')+rej+'</ul>'+(hasChange?'<button class="btn btn-primary tunerun" type="button">Übernehmen &amp; ausführen ▸</button> <button class="btn btn-ghost tuneclear" type="button">Verwerfen</button>':'');
      var tr=prev.querySelector('.tunerun'); if(tr)tr.addEventListener('click',function(){var b=document.querySelector('button.run.btn-primary'); if(b)b.click();});
      var tc=prev.querySelector('.tuneclear'); if(tc)tc.addEventListener('click',function(){window.__cfg='';prev.hidden=true;inp.value='';});
    }).catch(function(e){prev.innerHTML='<span class="perr">Fehler: '+e.message+'</span>';});
  });
})();
`;

function toolShell(slug, inner, lang) {
  const d = DEMOS[slug];
  const toggle = lang ? `<span class="langtoggle" title="Sprache umschalten"><a href="?lang=de"${lang === 'de' ? ' class="on"' : ''}>DE</a><a href="?lang=en"${lang === 'en' ? ' class="on"' : ''}>EN</a></span>` : '';
  return `<!doctype html><html lang="${lang || 'de'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${d.title} · Bunsenbrenner.org</title><style>${BB_CSS}</style></head><body>
${appbar(`<a href="/">Marktplatz</a> / <b>${d.name}</b>`)}
<div class="wrap" data-slug="${slug}" data-est="${d.estSeconds || 20}" data-lang="${lang || 'de'}">
  <div class="toolbar"><div><h1>${d.title}</h1><p>${d.tagline}</p></div><div class="controls">${toggle}${inner.controls}</div></div>
  <button class="m-toggle" type="button" aria-expanded="false">mehr anzeigen ▾</button>
  ${inner.body}
</div>${FOOT}<script>${CLIENT}</script></body></html>`;
}

function photoToolPage(slug) {
  const d = DEMOS[slug];
  const tray = d.photos.map((p) => `<div class="prow"><img src="/assets/thumbs/${p.file}" alt="${p.city}"/>
    <div><div class="pn">${p.file}</div><div class="pt"><span><span class="lab">Datum</span>${p.date}</span><span><span class="lab">Ort</span>${p.city}</span></div>
    <div class="credit">Foto: <a href="${p.pexels_url}" target="_blank" rel="noopener">${p.photographer}</a> · Pexels</div></div></div>`).join('');
  const controls = `<span class="setting"><span class="k">Sortieren</span><span class="v">Datum · Ort</span></span>
    <span class="setting"><span class="k">Wasserzeichen</span><span class="v on">an</span></span>
    <button class="btn btn-primary run" data-fresh="0">Organisieren ▸</button>
    ${installLink}`;
  const body = `
  <div class="io"><span>Eingang</span><span class="path">fotos/</span><span class="ar">→</span><span>Werkzeug</span><span class="path">phototools organize</span><span class="ar">→</span><span>Ausgabe</span><span class="path">sortiert/</span></div>
  <div class="grid2">
    <aside class="panel"><div class="ph"><h2>Eingang</h2><span class="count">6 Fotos · fotos/</span></div><div class="tray">${tray}</div></aside>
    <main class="out">
      <div class="stepper" hidden><div class="st" data-step="install"><span class="n">1</span> Installieren</div><div class="st" data-step="process"><span class="n">2</span> Fotos verarbeiten</div><div class="st" data-step="done"><span class="n">3</span> Fertig</div></div>
      <div class="placeholder">Noch nicht organisiert — klick <b style="color:var(--ink)">&nbsp;Organisieren&nbsp;</b>, und die 6 Fotos landen sortiert in <span style="font-family:var(--mono)">&nbsp;sortiert/</span>.</div>
      <section class="panel res-tree" hidden><div class="ph"><h2>Sortierte Ordner</h2><span class="count"></span></div><div class="tree"></div></section>
      <section class="panel res-sheet" hidden><div class="ph"><h2>Kontaktbogen</h2><span><a class="chip opengal" href="#" target="_blank" style="display:none">🖼 Galerie (Lightbox)</a> <a class="chip openrep" href="#" target="_blank">Öffnen</a></span></div><div class="sheetwrap"><img alt="Kontaktbogen"/></div></section>
      <details class="tech" hidden><summary>Technische Details — Installation &amp; Werkzeuglauf</summary><div class="log"></div></details>
    </main>
  </div>
  <div class="note"><span class="t">Ohne KI</span><div>Kein Modell „schaut" die Fotos an. <b>exiftool</b> liest die Metadaten der Kamera, ein <b>Gazetteer</b> übersetzt GPS→Stadt, <b>ImageMagick</b> setzt Wasserzeichen &amp; Kontaktbogen. Die Beispiel-Fotos stammen von <b>Pexels</b> und tragen kein Kamera-GPS — dafür sind ihnen Beispiel-Metadaten aufgeprägt (offengelegt); ein echtes Handyfoto bringt Datum &amp; Ort selbst mit.</div></div>
  <div class="prov"><span>Bereitgestellt über den <b>Marktplatz</b></span><span class="sep">|</span><span>Manifest <span class="ok">sha256 ✓</span></span><span class="sep">|</span><span>Signatur/Registry <span class="sim">Demo</span></span></div>`;
  return toolShell(slug, { controls, body });
}

function tuneBlock(slug) {
  const dp = DEMOS[slug] && DEMOS[slug].demo_prompt;
  if (!dp) return '';
  const ex = (dp.examples || []).map((e) => `<button class="exchip" type="button">${e}</button>`).join('');
  const params = dp.parameters.map((p) => p.name).join(' · ');
  return `<section class="tune">
    <div class="tune-h"><span class="teyebrow">◆ Anpassen per Prompt</span><span class="tsub">Schreib, was anders sein soll — unser DSGVO-LLM setzt es um, aber nur innerhalb fester Regeln (${params}). Vor dem Ausführen siehst du die aufgelöste Anpassung und kannst sie zurückhalten.</span></div>
    <div class="tune-row"><input class="tuneinput" type="text" placeholder="z. B. Berlin in Blau, ohne Wind, große serifenlose Schrift"/><button class="btn btn-ghost tunebtn" type="button">Vorschau ansehen</button></div>
    <div class="tune-ex"><span class="exlbl">Beispiele:</span>${ex}</div>
    <div class="tunepreview" hidden></div>
  </section>`;
}

function reportHtmlPage(slug, lang) {
  const d = DEMOS[slug];
  const controls = `<span class="setting"><span class="k">Standort</span><span class="v">${d.location}</span></span>
    <span class="setting"><span class="k">Quelle</span><span class="v">${d.source}</span></span>
    <span class="setting"><span class="k">Modell</span><span class="v on">${d.model}</span></span>
    <button class="btn btn-primary run" data-fresh="0">Briefing erstellen ▸</button>
    ${installLink}`;
  const body = `
  <p class="lede" style="margin:2px 0 16px">Diese Demo zeigt, wie sich ein Sprachmodell <b>faktentreu</b> einsetzen lässt: Es holt echte Wetterdaten für ${d.location} von Open-Meteo, rechnet daraus Kennzahlen und Diagramme mit gewöhnlichem Code und lässt das LLM nur den <b>Fließtext</b> schreiben — jede Zahl darin wird automatisch gegen die Rohdaten geprüft. Das Ergebnis ist ein fertiger, redaktioneller Wochen­report als HTML (und PDF), wie ihn ein Team ohne manuelle Arbeit jede Woche verschicken könnte.</p>
  <p class="subtle" style="margin:-6px 0 14px">Sprache oben rechts umschaltbar (DE/EN): das LLM schreibt den Report in der gewählten Sprache — über denselben DSGVO-konformen Endpunkt in Deutschland.</p>
  ${tuneBlock(slug)}
  <div class="io"><span>Eingang</span><span class="path">${d.source}</span><span class="ar">→</span><span>Werkzeug</span><span class="path">Kennzahlen · Diagramme · LLM-Narrativ</span><span class="ar">→</span><span>Ausgabe</span><span class="path">report.html</span></div>
  <main class="out" style="margin-top:14px">
    <div class="stepper" hidden><div class="st" data-step="install"><span class="n">1</span> Installieren</div><div class="st" data-step="process"><span class="n">2</span> Report erstellen</div><div class="st" data-step="done"><span class="n">3</span> Fertig</div></div>
    <div class="placeholder">Noch kein Briefing — klick <b style="color:var(--ink)">&nbsp;Briefing erstellen&nbsp;</b>. Holt echte Wetterdaten für ${d.location}, rechnet Kennzahlen &amp; Diagramme und lässt ein LLM ein faktentreues Kurz-Briefing schreiben.</div>
    <section class="panel res-report" hidden><div class="ph"><h2>Wetter-Briefing</h2><span><a class="chip pdflink" href="#" target="_blank" hidden>PDF</a> <a class="chip openrep" href="#" target="_blank">In neuem Tab</a></span></div><div class="sheetwrap"><iframe class="reportframe" title="Report"></iframe></div></section>
    <details class="tech" hidden><summary>Technische Details — Installation &amp; Werkzeuglauf</summary><div class="log"></div></details>
  </main>
  <div class="note"><span class="t">Faktentreu</span><div>Das LLM schreibt <b>nur den Fließtext</b> — aus eingefrorenen Fakten (Open-Meteo). Ein <b>narrative_guard</b> prüft, dass keine Zahl erfunden wird; Kennzahlen, Tabellen und Diagramme kommen aus deterministischem Code, nicht aus dem Modell. Quelle &amp; Roh-Hash stehen im Report.</div></div>
  <div class="prov"><span>Bereitgestellt über den <b>Marktplatz</b></span><span class="sep">|</span><span>Manifest <span class="ok">sha256 ✓</span></span><span class="sep">|</span><span>Signatur/Registry <span class="sim">Demo</span></span></div>`;
  return toolShell(slug, { controls, body }, lang);
}

function outBlock(steps, placeholder, panels, note, prov) {
  const st = steps.map((s, i) => `<div class="st" data-step="${['install', 'process', 'done'][i]}"><span class="n">${i + 1}</span> ${s}</div>`).join('');
  return `<main class="out" style="margin-top:14px">
    <div class="stepper" hidden>${st}</div>
    <div class="placeholder">${placeholder}</div>
    ${panels}
    <details class="tech" hidden><summary>Technische Details — Installation &amp; Werkzeuglauf</summary><div class="log"></div></details>
  </main>${note || ''}
  <div class="prov">${prov || '<span>Bereitgestellt über den <b>Marktplatz</b></span><span class="sep">|</span><span>Manifest <span class="ok">sha256 ✓</span></span><span class="sep">|</span><span>Signatur/Registry <span class="sim">Demo</span></span>'}</div>`;
}
// How-to for running/customizing a demo on your own machine (marketplace docs). Replaces the old
// "Werkzeug neu installieren" button, which the operator asked to swap for a real install guide link.
const HOWTO_URL = 'https://scimbe.github.io/CADS-agent-marketplace-docs/how-to/install-and-customize-a-demo/';
const installLink = `<a class="btn btn-ghost" href="${HOWTO_URL}" target="_blank" rel="noopener">Lokal installieren &amp; anpassen ↗</a>`;
const runBtns = (primary) => `<button class="btn btn-primary run" data-fresh="0">${primary}</button>${installLink}`;
const NOTE = (tag, html) => `<div class="note"><span class="t">${tag}</span><div>${html}</div></div>`;

const UPLOAD_CLIENT = `
(function(){
  var btn=document.getElementById('upbtn'); if(!btn) return;
  var msg=document.getElementById('upmsg'), fa=document.getElementById('pdfa'), fb=document.getElementById('pdfb');
  var panel=document.querySelector('.res-upreport'), frame=document.querySelector('.upframe');
  function b64(file){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(r.result)};r.onerror=rej;r.readAsDataURL(file);});}
  btn.addEventListener('click',async function(){
    if(!fa.files[0]||!fb.files[0]){msg.textContent='Bitte zwei PDF-Dateien wählen.';return;}
    if(fa.files[0].size>16e6||fb.files[0].size>16e6){msg.textContent='Jede Datei höchstens ~16 MB.';return;}
    btn.disabled=true; msg.textContent='Vergleiche … (Text-Diff + Bildvergleich, kann ~20–40 s dauern)';
    try{
      var a=await b64(fa.files[0]), b=await b64(fb.files[0]);
      var r=await fetch('/api/upload-compare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({a:a,b:b})});
      var j=await r.json();
      if(!j.ok){msg.textContent='Fehler: '+(j.error||'unbekannt');btn.disabled=false;return;}
      frame.srcdoc=j.html; panel.hidden=false; msg.textContent='Fertig — Ihr Vergleich unten.'; panel.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(e){msg.textContent='Netzwerkfehler: '+e.message;}
    btn.disabled=false;
  });
})();`;

function reportMdPage(slug) {
  const d = DEMOS[slug];
  const controls = runBtns('Vergleichen ▸');
  const upload = slug === 'contractcheck' ? `
  <div class="upcmp">
    <div class="upttl">Oder eigene zwei PDFs vergleichen</div>
    <div class="uprow">
      <label class="upf">Dokument A (PDF)<input type="file" id="pdfa" accept="application/pdf,.pdf"></label>
      <label class="upf">Dokument B (PDF)<input type="file" id="pdfb" accept="application/pdf,.pdf"></label>
      <button class="btn btn-primary" id="upbtn" type="button">Eigene PDFs vergleichen ▸</button>
    </div>
    <div class="upmsg" id="upmsg"></div>
    <section class="panel res-upreport" hidden><div class="ph"><h2>Ihr Vergleich (Text + Bild)</h2></div><div class="sheetwrap"><iframe class="upframe" title="Ihr Vergleich"></iframe></div></section>
  </div>
  <script>${UPLOAD_CLIENT}</script>` : '';
  const body = `
  <p class="lede" style="margin:2px 0 16px">${d.story}</p>
  <div class="io"><span>Eingang</span><span class="path">contract_v1.pdf · contract_v2.pdf</span><span class="ar">→</span><span>Werkzeug</span><span class="path">pdftotext · difflib · pdftoppm · Vision</span><span class="ar">→</span><span>Ausgabe</span><span class="path">report.md</span></div>
  ${upload}
  ${outBlock(['Installieren', 'Vergleichen', 'Fertig'],
    'Noch nicht verglichen — klick <b style="color:var(--ink)">&nbsp;Vergleichen&nbsp;</b>, dann siehst du den <b>Text-Unterschied</b> Klausel für Klausel und einen <b>Bildvergleich</b> der Seiten.',
    `<section class="panel res-report" hidden><div class="ph"><h2>Vergleich (Text + Bild)</h2><span><a class="chip pdflink" href="#" target="_blank" hidden>PDF</a> <a class="chip openrep" href="#" target="_blank">In neuem Tab</a></span></div><div class="sheetwrap"><iframe class="reportframe" title="Report"></iframe></div></section>`,
    NOTE('Text deterministisch · Bild per Vision', 'Der <b>Text-Vergleich</b> ist deterministisch: <b>pdftotext</b> liest beide PDFs, Pythons <b>difflib</b> rechnet die Zeilenunterschiede (kein Modell entscheidet, was sich geändert hat); eine kurze <b>LLM-Zusammenfassung</b> fasst sie zusammen. Der <b>Bild-Vergleich</b> rendert jede Seite (<b>pdftoppm</b>) und lässt ein <b>Vision-Modell</b> die visuellen Unterschiede beschreiben — byte-gleiche Seiten werden ohne Modellaufruf als identisch erkannt.'))}`;
  return toolShell(slug, { controls, body });
}

function imagePage(slug) {
  const d = DEMOS[slug];
  const controls = `<span class="setting"><span class="k">Engine</span><span class="v">${d.engine}</span></span><span class="setting"><span class="k">Modell</span><span class="v on">${d.model}</span></span>${runBtns('Diagramm erzeugen ▸')}`;
  const body = `
  <p class="lede" style="margin:2px 0 14px">${d.tagline}</p>
  <label class="descfield"><span class="dl">Deine Beschreibung — schreib in einem Satz, was das Diagramm zeigen soll:</span>
  <textarea class="descinput" rows="3" maxlength="600" placeholder="z. B. Ein Flussdiagramm: Nutzer öffnet die Demo, der Marktplatz installiert das Werkzeug, es läuft lokal, das Ergebnis wird gezeigt.">${d.description}</textarea></label>
  ${tuneBlock(slug)}
  <div class="io"><span>Beschreibung</span><span class="ar">→</span><span>LLM → ${d.engine === 'graphviz' ? 'Graphviz' : 'Mermaid'}</span><span class="ar">→</span><span>Renderer prüft</span><span class="ar">→</span><span class="path">diagram.png</span></div>
  ${outBlock(['Installieren', 'Diagramm erzeugen', 'Fertig'],
    'Noch kein Diagramm — klick <b style="color:var(--ink)">&nbsp;Diagramm erzeugen&nbsp;</b>. Das LLM schreibt Mermaid-Code, der Renderer prüft ihn und macht ein PNG.',
    `<section class="panel res-image" hidden><div class="ph"><h2>Erzeugtes Diagramm</h2><a class="chip openimg" href="#" target="_blank">Öffnen</a></div><div class="sheetwrap"><img class="resimg" alt="Diagramm"/></div></section>`,
    NOTE('Selbstkorrektur', 'Das LLM schreibt nur die <b>Mermaid-Beschreibung</b>; ein echter Renderer (mermaid-cli) prüft sie, indem er sie tatsächlich zeichnet. Bei einem Syntaxfehler bekommt das LLM die echte Fehlermeldung zurück und korrigiert — bis zu 3 Versuche.'))}`;
  return toolShell(slug, { controls, body });
}

function timelinePage(slug) {
  const d = DEMOS[slug];
  const controls = runBtns('Ablauf starten ▸');
  const body = `
  <p class="lede" style="margin:2px 0 16px">${d.tagline}</p>
  <div class="io"><span>Werkzeug</span><span class="path">temporal dev-server</span><span class="ar">→</span><span>Workflow läuft</span><span class="ar">→</span><span>Worker gekillt</span><span class="ar">→</span><span>zweiter Worker beendet</span></div>
  ${outBlock(['Installieren', 'Ausführen (Kill & Recovery)', 'Fertig'],
    'Noch nicht ausgeführt — klick <b style="color:var(--ink)">&nbsp;Ablauf starten&nbsp;</b>. Ein Worker wird mitten in der Aufgabe hart gekillt; sieh im Verlauf, wie ein zweiter sie zu Ende bringt. (~45 s)',
    `<section class="panel res-timeline" hidden><div class="ph"><h2>Ablauf-Verlauf</h2><span class="count">echter Temporal-Event-Verlauf</span></div><ol class="timeline"></ol></section>`,
    NOTE('Durable Execution', 'Nichts wird von Hand neu gestartet: Temporal erkennt am ausbleibenden <b>Heartbeat</b>, dass der Worker tot ist, und ein zweiter Worker übernimmt die Aufgabe automatisch. Der Verlauf ist der echte <code>event-history.json</code>.'))}`;
  return toolShell(slug, { controls, body });
}

function audioPage(slug) {
  const d = DEMOS[slug];
  const controls = runBtns('Folge bereitstellen ▸');
  const body = `
  <p class="lede" style="margin:2px 0 16px">${d.tagline}</p>
  <div class="io"><span>Eingang</span><span class="path">Roh-Spuren (WAV)</span><span class="ar">→</span><span>ffmpeg · whisper.cpp · LLM-Kapitel</span><span class="ar">→</span><span class="path">episode.mp3</span></div>
  ${outBlock(['Bereitstellen', 'Verarbeiten', 'Fertig'],
    'Klick <b style="color:var(--ink)">&nbsp;Folge bereitstellen&nbsp;</b> — Player, Kapitel und Transkript eines echten Laufs.',
    `<section class="panel res-audio" hidden><div class="ph"><h2>Folge</h2><span class="count">Kapitel klickbar</span></div><div class="sheetwrap"><audio class="resaudio" controls style="width:100%"></audio><ol class="chapters"></ol><details class="tx" style="margin-top:12px"><summary>Transkript (whisper.cpp)</summary><pre class="txbody"></pre></details></div></section>`,
    NOTE('Faktentreu', 'Kapitelmarken setzt das LLM, aber jede Zeit wird gegen die echten whisper.cpp-Zeitstempel geprüft. Schnitt/Transkription sind deterministische Werkzeuge (ffmpeg, whisper.cpp).'))}`;
  return toolShell(slug, { controls, body });
}

function videoPage(slug) {
  const d = DEMOS[slug];
  const controls = runBtns('Video bereitstellen ▸');
  const prov = '<span>Läuft aus der Quelle · <b>noch kein Marktplatz-Manifest</b></span><span class="sep">|</span><span>vorgerendertes echtes Ergebnis</span>';
  const body = `
  <p class="lede" style="margin:2px 0 16px">${d.tagline}</p>
  <div class="io"><span>Thema</span><span class="ar">→</span><span>LLM-Storyboard</span><span class="ar">→</span><span>TTS · GSAP · Chrome · ffmpeg</span><span class="ar">→</span><span class="path">final.mp4</span></div>
  ${outBlock(['Bereitstellen', 'Verarbeiten', 'Fertig'],
    'Klick <b style="color:var(--ink)">&nbsp;Video bereitstellen&nbsp;</b> — das fertige Erklärvideo mit Szenenliste.',
    `<section class="panel res-video" hidden><div class="ph"><h2>Erklärvideo</h2><span class="count">1920×1080 · H.264</span></div><div class="sheetwrap"><video class="resvideo" controls preload="metadata" style="width:100%;border:1px solid var(--border);border-radius:9px"></video><ol class="scenes"></ol></div></section>`,
    NOTE('KI ↔ Engine', 'Nur das <b>Storyboard</b> kommt vom LLM; danach ist alles deterministische Engine: Text-to-Speech, GSAP-Animation, Headless-Chrome-Render, ffmpeg-Schnitt. Deutsche Mehrstimmen-TTS folgt über den llm2-Channel.') +
    NOTE('Hinweis', d.note), prov)}`;
  return toolShell(slug, { controls, body });
}

// ---- Studio: one topic -> orchestrate several demos into one integrated workspace -------------
async function handleStudio(req, res, url) {
  const topic = (url.searchParams.get('topic') || '').slice(0, 300).trim();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const emit = (t, text) => res.write(`event: ${t}\ndata: ${JSON.stringify({ text })}\n\n`);
  const stage = (id, label) => res.write(`event: stage\ndata: ${JSON.stringify({ id, label })}\n\n`);
  const send = (ev, obj) => res.write(`event: ${ev}\ndata: ${JSON.stringify(obj)}\n\n`);
  if (!topic) { emit('fail', 'Kein Thema angegeben.'); res.end(); return; }
  if (!ENV.LITELLM_BASE_URL) { emit('fail', 'LLM-Zugang fehlt (LITELLM_*).'); res.end(); return; }

  // 1. DSGVO-LLM: brief + a diagram description, in one call
  stage('brief', 'Briefing schreiben');
  emit('step', 'DSGVO-LLM (DE) erzeugt Kurz-Briefing + Diagramm-Beschreibung');
  let brief = '', ddesc = '';
  try {
    const sys = 'Du bist ein Studio-Assistent für bunsenbrenner.org. Aus einem Thema erzeugst du (a) ein sachliches deutsches Kurz-Briefing (4–6 Sätze, klar, keine erfundenen Zahlen) und (b) eine knappe englische, Mermaid-taugliche Flowchart-Beschreibung des Themas. Antworte NUR als striktes JSON: {"brief":"…","diagram_description":"A flowchart: …"}';
    const rawr = await callLLM(sys, topic, 700, 0.3);
    const m = rawr.match(/\{[\s\S]*\}/); const o = JSON.parse(m ? m[0] : rawr);
    brief = String(o.brief || '').trim(); ddesc = String(o.diagram_description || `A flowchart explaining: ${topic}`).trim();
    if (!brief) throw new Error('leeres Briefing');
    emit('real', 'echt · Briefing erzeugt');
    send('brief', { brief });
  } catch (e) { emit('fail', 'LLM-Fehler: ' + e.message); stage('error', 'Fehlgeschlagen'); res.end(); return; }

  // 2. diagram demo: install (dogfooding) + render the LLM's diagram description to a real PNG
  stage('diagram', 'Diagramm erzeugen');
  try {
    let rec = activated.get('diagram');
    if (!rec) { rec = installActivate('diagram', emit, () => {}); }
    const d = DEMOS.diagram;
    if (!existsSync(join(rec.workDir, 'node_modules', '.bin', 'mmdc'))) {
      emit('step', 'mermaid-cli installieren (npm ci)');
      spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: rec.workDir, env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' } });
    }
    emit('step', 'LLM→Mermaid→PNG (mit Renderer-Prüfung)');
    const env = { PATH: process.env.PATH, HOME: rec.workDir, PUPPETEER_SKIP_DOWNLOAD: 'true', PUPPETEER_EXECUTABLE_PATH: d.chromePath, LITELLM_BASE_URL: ENV.LITELLM_BASE_URL, LITELLM_API_KEY: ENV.LITELLM_API_KEY, LITELLM_DEFAULT_MODEL: ENV.LITELLM_DEFAULT_MODEL || d.model };
    const args = [join(rec.workDir, d.tool), 'generate', '--description', ddesc, '--engine', 'mermaid', '--out', 'studio.png', '--max-attempts', '3', '--attempts-log', 'studio-attempts.json'];
    await new Promise((resolve) => { const c = spawn('node', args, { cwd: rec.workDir, env });
      c.stdout.on('data', (b) => b.toString().split('\n').filter(Boolean).forEach((l) => emit('run', l.slice(0, 160)))); c.stderr.on('data', () => {}); c.on('close', () => resolve()); });
    if (existsSync(join(rec.workDir, 'studio.png'))) { rec.outputDir = rec.workDir; emit('real', 'echt · Diagramm erzeugt'); send('diagram', { image: `/d/diagram/out/studio.png?t=${Date.now()}`, desc: ddesc }); }
    else emit('warn', 'Diagramm konnte diesmal nicht gerendert werden (LLM-Mermaid-Syntax).');
  } catch (e) { emit('warn', 'Diagramm-Baustein übersprungen: ' + e.message); }

  stage('done', 'Fertig'); emit('done', ''); res.end();
}

function soonPage(slug) {
  const d = DEMOS[slug];
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${d.title} · Bunsenbrenner.org</title><style>${BB_CSS}</style></head><body>
${appbar(`<a href="/">Marktplatz</a> / <b>${d.name}</b>`)}
<div class="wrap"><div class="eyebrow"><span class="lead">—</span>${TYPE_LABEL[d.type] || 'Demo'} · in Vorbereitung</div>
<h1>${d.title}</h1><p class="lede">${d.tagline}</p>
<div class="note" style="margin-top:24px"><span class="t">Bald</span><div>Diese Demo ist spezifiziert und wird gerade im gleichen Stil verdrahtet.${d.note ? ' ' + d.note : ''} Schau gleich nochmal rein — oder <a href="/">zurück zur Übersicht</a>.</div></div>
</div>${FOOT}</body></html>`;
}

// Live capacity indicator: server-side proxy of llm2's read-only /status (avoids CORS; the flaky
// TLS-TCP endpoint can time out, so we retry once and degrade gracefully — never break the page).
let _statusCache = { t: 0, data: null };
async function fetchStatus() {
  const now = Date.now();
  if (_statusCache.data && now - _statusCache.t < 10000) return _statusCache.data;   // 10s cache
  for (let i = 0; i < 2; i++) {
    try {
      const c = new AbortController(); const to = setTimeout(() => c.abort(), 8000);
      const r = await fetch('https://site-f29c55da.bunsenbrenner.org/status', { signal: c.signal });
      clearTimeout(to);
      if (r.ok) { const j = await r.json(); _statusCache = { t: now, data: j }; return j; }
    } catch { /* retry once, then give up */ }
  }
  return null;
}
function handleStatus(res) {
  fetchStatus().then((j) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    if (!j) { res.end(JSON.stringify({ ok: false })); return; }
    const svc = {};
    for (const [k, v] of Object.entries(j)) {
      if (k === 'ollama_backed' && v) { svc.ollama = { models: v.loaded_models || [], parallel: v.num_parallel_configured }; continue; }
      if (v && typeof v === 'object' && 'active_requests' in v) svc[k] = { active: v.active_requests, queued: v.queued_requests, p50: v.p50_latency_s };
    }
    res.end(JSON.stringify({ ok: true, svc }));
  }).catch(() => { try { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false })); } catch {} });
}

// contractcheck: compare TWO user-uploaded PDFs (base64 JSON, no multipart parsing needed).
function handleUploadCompare(req, res) {
  const reply = (code, obj) => { try { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); } catch {} };
  let body = ''; let tooBig = false;
  req.on('data', (c) => { body += c; if (body.length > 24 * 1024 * 1024) { tooBig = true; req.destroy(); } });
  req.on('end', () => {
    if (tooBig) return reply(413, { error: 'Dateien zu groß (max. ~16 MB je PDF).' });
    let a, b; try { const j = JSON.parse(body); a = j.a; b = j.b; } catch { return reply(400, { error: 'Ungültige Anfrage.' }); }
    const decode = (s) => { const m = String(s || '').match(/^data:[^;]*;base64,(.*)$/s); try { return Buffer.from(m ? m[1] : String(s || ''), 'base64'); } catch { return Buffer.alloc(0); } };
    const bufA = decode(a), bufB = decode(b);
    if (bufA.slice(0, 5).toString() !== '%PDF-' || bufB.slice(0, 5).toString() !== '%PDF-') return reply(400, { error: 'Bitte zwei gültige PDF-Dateien hochladen.' });
    let rec = activated.get('contractcheck');
    if (!rec) { try { rec = installActivate('contractcheck', () => {}, () => {}); } catch { return reply(500, { error: 'Werkzeug konnte nicht vorbereitet werden.' }); } }
    const wd = rec.workDir;
    const up = join(WORK, '_uploads', String(process.pid) + '-' + reqSeq++);
    try { mkdirSync(up, { recursive: true }); } catch {}
    const pa = join(up, 'a.pdf'), pb = join(up, 'b.pdf'), rep = join(up, 'report.md');
    try { writeFileSync(pa, bufA); writeFileSync(pb, bufB); } catch { return reply(500, { error: 'Konnte Uploads nicht ablegen.' }); }
    const key = process.env.LITELLM_API_KEY || '';
    const env = { PATH: process.env.PATH, HOME: wd, PYTHONPATH: join(wd, 'vendor'),
      LLM_BASE_URL: process.env.LITELLM_BASE_URL || '', LLM_API_KEY: key, LLM_MODEL: process.env.LITELLM_DEFAULT_MODEL || '' };
    const args = [join(wd, 'src', 'pipeline.py'), 'compare', '--old', pa, '--new', pb, '--report', rep];
    if (!key) args.push('--no-llm', '--no-vision');
    const child = spawn('python3', args, { cwd: wd, env });
    let err = ''; child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => reply(500, { error: 'python3 nicht verfügbar.' }));
    child.on('close', (code) => {
      try {
        if (!existsSync(rep)) return reply(500, { error: 'Vergleich fehlgeschlagen' + (err ? (': ' + err.slice(-160)) : ' (exit ' + code + ').') });
        reply(200, { ok: true, html: md2html(readFileSync(rep, 'utf8')) });
      } finally { try { rmSync(up, { recursive: true, force: true }); } catch {} }
    });
  });
}
let reqSeq = 0;

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(indexPage()); return; }
  if (p === '/api/status') { handleStatus(res); return; }
  if (p === '/api/upload-compare' && req.method === 'POST') { handleUploadCompare(req, res); return; }
  if (p === '/api/start') { handleStart(req, res, url); return; }
  if (p === '/api/plan' && req.method === 'POST') { handlePlan(req, res, url); return; }
  const dm = p.match(/^\/d\/([a-z0-9-]+)\/out\/(.+)$/);
  if (dm) { const base = resolveOut(dm[1]); if (!base) { res.writeHead(404).end('nf'); return; } serveFile(res, join(base, dm[2].replace(/\.\./g, ''))); return; }
  if (p.startsWith('/assets/thumbs/')) { serveFile(res, join(__dir, 'thumbs', p.slice('/assets/thumbs/'.length).replace(/\.\./g, ''))); return; }
  const pd = p.match(/^\/d\/([a-z0-9-]+)\/?$/);
  if (pd) { const slug = pd[1], d = DEMOS[slug]; if (!d) { res.writeHead(404).end('unknown demo'); return; }
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'de';
    const PAGES = { 'photo-tool': photoToolPage, 'report-html': (s) => reportHtmlPage(s, lang), 'report-md': reportMdPage, image: imagePage, timeline: timelinePage, audio: audioPage, video: videoPage };
    const html = d.live && PAGES[d.type] ? PAGES[d.type](slug) : soonPage(slug);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return; }
  res.writeHead(404).end('not found');
}).listen(PORT, HOST, () => console.log(`wrapper on http://${HOST}:${PORT}`));
