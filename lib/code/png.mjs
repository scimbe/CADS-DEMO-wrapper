// My Daily Idea, Code-Modus: a display list (lib/code/sdk.js cleanView) as a small PNG, without dependencies. For the image
// part of the content check (shapes can form symbols too) and for the reviewer. Texts are drawn as bars (the check reads
// them as text separately), emoji as a coloured disc with a dark ring.
import { deflateSync } from 'node:zlib';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const rgb = (c) => { const h = String(c || '#000').slice(1); const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h; return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0]; };

/** ops -> PNG Buffer, scale: pixels per logical unit (0.5: 180 x 320) */
export function renderPng(ops, { W = 360, H = 640, scale = 0.5 } = {}) {
  const w = Math.round(W * scale), h = Math.round(H * scale), px = new Uint8Array(w * h * 3).fill(255);
  const put = (x, y, c, a) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 3; for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + c[k] * a); };
  const rect = (x, y, rw, rh, c, a = 1, r = 0) => {
    const x0 = Math.round(x * scale), y0 = Math.round(y * scale), x1 = Math.round((x + rw) * scale), y1 = Math.round((y + rh) * scale), rr = r * scale;
    for (let yy = Math.max(0, y0); yy < Math.min(h, y1); yy++) for (let xx = Math.max(0, x0); xx < Math.min(w, x1); xx++) {
      if (rr > 1) { const dx = Math.max(x0 + rr - xx, 0, xx - (x1 - rr)), dy = Math.max(y0 + rr - yy, 0, yy - (y1 - rr)); if (dx * dx + dy * dy > rr * rr) continue; }
      put(xx, yy, c, a);
    }
  };
  const disc = (cx, cy, r, c, a = 1) => { const X = cx * scale, Y = cy * scale, R = r * scale; for (let yy = Math.floor(Y - R); yy <= Y + R; yy++) for (let xx = Math.floor(X - R); xx <= X + R; xx++) if ((xx - X) ** 2 + (yy - Y) ** 2 <= R * R) put(xx, yy, c, a); };
  for (const o of ops || []) {
    if (o.o === 'bg') rect(0, 0, W, H, rgb(o.c));
    else if (o.o === 'rect') rect(o.x, o.y, o.w, o.h, rgb(o.c), o.a, o.r);
    else if (o.o === 'circle') disc(o.x, o.y, o.r, rgb(o.c), o.a);
    else if (o.o === 'line') { const n = Math.ceil(Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * scale) + 1; for (let i = 0; i <= n; i++) disc(o.x1 + (o.x2 - o.x1) * i / n, o.y1 + (o.y2 - o.y1) * i / n, o.w / 2, rgb(o.c)); }
    else if (o.o === 'text') { const tw = [...o.s].length * o.z * 0.55, x = o.al === 'l' ? o.x : o.al === 'r' ? o.x - tw : o.x - tw / 2; rect(x, o.y - o.z * 0.75, tw, o.z * 0.8, rgb(o.c), 0.55, 2); }
    else if (o.o === 'emoji') { disc(o.x, o.y - o.z * 0.35, o.z * 0.45, [40, 40, 40]); disc(o.x, o.y - o.z * 0.35, o.z * 0.38, [255, 200, 40]); }
  }
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
