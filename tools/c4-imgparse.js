/* C4: prototype/validator for the intrinsic-size reader that will live in tools/build-site.js.
 * No dependencies: parses PNG / JPEG / GIF / WebP / SVG headers directly.
 * Usage: node tools/c4-imgparse.js [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function readImageSize(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR starts at 8, width at 16 (BE32), height at 20
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null;
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return w > 0 && h > 0 ? { w, h, format: 'png' } : null;
  }
  // GIF: "GIF87a"/"GIF89a", logical screen width/height are LE16 at 6 and 8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    const w = buf.readUInt16LE(6);
    const h = buf.readUInt16LE(8);
    return w > 0 && h > 0 ? { w, h, format: 'gif' } : null;
  }
  // WebP: RIFF....WEBP
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return readWebpSize(buf);
  }
  // JPEG: FFD8 ...., scan for a SOFn marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      let m = buf[i + 1];
      // padding fill bytes
      while (m === 0xff) { i += 1; m = buf[i + 1]; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      const isSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
      if (isSof) {
        const h = buf.readUInt16BE(i + 5);
        const w = buf.readUInt16BE(i + 7);
        return w > 0 && h > 0 ? { w, h, format: 'jpeg' } : null;
      }
      i += 2 + len;
    }
    return null;
  }
  // SVG (text)
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  if (/<svg[\s>]/i.test(head)) return readSvgSize(head);
  return null;
}

function readWebpSize(buf) {
  // walk RIFF chunks; VP8X canvas size wins, else VP8 (lossy) / VP8L (lossless) frame headers
  let off = 12;
  let vp8x = null;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (fourcc === 'VP8X' && body + 10 <= buf.length) {
      const w = 1 + (buf[body + 4] | (buf[body + 5] << 8) | (buf[body + 6] << 16));
      const h = 1 + (buf[body + 7] | (buf[body + 8] << 8) | (buf[body + 9] << 16));
      vp8x = { w, h, format: 'webp' };
    } else if (fourcc === 'VP8 ' && body + 10 <= buf.length) {
      // 3-byte frame tag, then 0x9D 0x01 0x2A start code
      if (buf[body + 3] === 0x9d && buf[body + 4] === 0x01 && buf[body + 5] === 0x2a) {
        const w = buf.readUInt16LE(body + 6) & 0x3fff;
        const h = buf.readUInt16LE(body + 8) & 0x3fff;
        if (w > 0 && h > 0) return { w, h, format: 'webp' };
      }
    } else if (fourcc === 'VP8L' && body + 5 <= buf.length) {
      if (buf[body] === 0x2f) {
        const bits = buf.readUInt32LE(body + 1);
        const w = 1 + (bits & 0x3fff);
        const h = 1 + ((bits >>> 14) & 0x3fff);
        if (w > 0 && h > 0) return { w, h, format: 'webp' };
      }
    }
    off = body + size + (size % 2); // chunks are word aligned
  }
  return vp8x;
}

function num(v) {
  const m = String(v || '').trim().match(/^(-?[\d.]+)(?:px)?$/);
  return m ? parseFloat(m[1]) : null;
}

function readSvgSize(head) {
  const svg = head.match(/<svg\b[^>]*>/i);
  if (!svg) return null;
  const tag = svg[0];
  const attrOf = (name) => {
    const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i'))
      || tag.match(new RegExp("\\s" + name + "\\s*=\\s*'([^']*)'", 'i'));
    return m ? m[1] : '';
  };
  const vb = attrOf('viewBox').split(/[\s,]+/).filter(Boolean).map(Number);
  const vbW = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? { w: vb[2], h: vb[3] } : null;
  const aw = num(attrOf('width'));
  const ah = num(attrOf('height'));
  if (aw && ah) return { w: Math.round(aw), h: Math.round(ah), format: 'svg' };
  if (vbW && aw) return { w: Math.round(aw), h: Math.round(aw * vbW.h / vbW.w), format: 'svg' };
  if (vbW && ah) return { w: Math.round(ah * vbW.w / vbW.h), h: Math.round(ah), format: 'svg' };
  if (vbW) return { w: Math.round(vbW.w), h: Math.round(vbW.h), format: 'svg' };
  return null;
}

module.exports = { readImageSize };

if (require.main === module) {
  const AS_JSON = process.argv.includes('--json');
  const dirs = ['archive/paper/assets', 'archive/velocity/assets', 'archive/folia/assets'];
  const files = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(webp|png|jpe?g|gif|svg)$/i.test(e.name)) files.push(p);
    }
  };
  dirs.forEach((d) => walk(path.join(ROOT, d)));
  const rows = [];
  for (const f of files) {
    const st = fs.statSync(f);
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(Math.min(st.size, 65536));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const r = readImageSize(buf);
    rows.push({ rel: path.relative(ROOT, f).replace(/\\/g, '/'), ...(r || { w: null, h: null, format: 'FAIL' }) });
  }
  const fails = rows.filter((r) => !r.w || !r.h);
  if (AS_JSON) console.log(JSON.stringify(rows, null, 1));
  else {
    console.log('files:', rows.length, 'parsed:', rows.length - fails.length, 'failed:', fails.length);
    const byFmt = {};
    for (const r of rows) byFmt[r.format] = (byFmt[r.format] || 0) + 1;
    console.log('by format:', JSON.stringify(byFmt));
    for (const f of fails) console.log('FAIL', f.rel);
  }
}
