// Minimal Markdown -> styled HTML for report-md demos (contractcheck): headings, bold, code, lists, diff blocks.
// ---- minimal Markdown -> styled HTML (for report-md demos like contractcheck) ---------------
export function md2html(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
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
    if (l.startsWith('### ')) { html += `<h3>${inline(l.slice(4))}</h3>`; i++; continue; }
    if (/^\s*[-*] /.test(l)) { let items = ''; while (i < lines.length && /^\s*[-*] /.test(lines[i])) { items += `<li>${inline(lines[i].replace(/^\s*[-*] /, ''))}</li>`; i++; } html += `<ul>${items}</ul>`; continue; }
    if (l.startsWith('## ')) { html += `<h2>${inline(l.slice(3))}</h2>`; i++; continue; }
    if (l.startsWith('# ')) { html += `<h1>${inline(l.slice(2))}</h1>`; i++; continue; }
    if (l.trim() === '') { i++; continue; }
    let p = l; while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !lines[i + 1].startsWith('#') && !/^\s*[-*] /.test(lines[i + 1]) && !lines[i + 1].startsWith('```')) { p += ' ' + lines[i + 1]; i++; }
    html += `<p>${inline(p)}</p>`; i++;
  }
  return `<!doctype html><meta charset="utf-8"><style>
    body{font-family:-apple-system,system-ui,"Segoe UI",sans-serif;color:#131A2C;line-height:1.6;margin:0;padding:22px 26px;background:#fff}
    h1{font-family:ui-serif,Georgia,serif;font-size:1.5rem;color:#131A2C;margin:0 0 14px;border-bottom:3px solid #2F8A7D;padding-bottom:10px}
    h2{font-family:ui-serif,Georgia,serif;font-size:1.12rem;color:#1F6B60;margin:26px 0 10px}
    p{max-width:70ch}ul{padding-left:1.3em}h3{font-size:1rem;margin:18px 0 6px}code{background:#EEF1F8;padding:1px 5px;border-radius:4px;font-family:ui-monospace,Menlo,monospace;font-size:.9em}
    .code{background:#0f1524;color:#c7d2e0;padding:14px 16px;border-radius:8px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:.82rem;white-space:pre-wrap}
    .diff{border:1px solid #D7DEEC;border-radius:8px;overflow:hidden;font-family:ui-monospace,Menlo,monospace;font-size:.82rem}
    .dl{padding:2px 12px;white-space:pre-wrap;border-bottom:1px solid #F0F3F8}
    .dl.add{background:#e7f4ee;color:#1f6b60}.dl.del{background:#fbecea;color:#b23c30}.dl.hunk{background:#EEF1F8;color:#5B6478}
  </style>${html}`;
}

