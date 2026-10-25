/* C4: enumerate every content image referenced by built HTML, with resolved abs path and magic. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE_ROOTS = ['paper', 'velocity', 'folia', 'sections', 'categories'];
const SKIP = new Set(['node_modules', 'archive', 'assets', 'data', 'tools', 'reports', '.git']);
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (SKIP.has(e.name)) continue; walk(path.join(dir, e.name), acc); }
    else if (e.isFile() && e.name.endsWith('.html')) acc.push(path.join(dir, e.name));
  }
  return acc;
}
const files = [];
for (const r of SITE_ROOTS) { const a = path.join(ROOT, r); if (fs.existsSync(a)) walk(a, files); }
const seen = new Map();
let content = 0, ext = 0;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    const srcm = tag.match(/\ssrc="([^"]*)"/);
    if (!srcm) continue;
    if (/class="[^"]*\bcontent-img\b/.test(tag)) {
      content += 1;
      const src = srcm[1];
      const abs = path.resolve(path.dirname(f), src.split('#')[0].split('?')[0]);
      if (!seen.has(abs)) {
        let magic = 'MISSING', size = 0;
        if (fs.existsSync(abs)) {
          const fd = fs.openSync(abs, 'r');
          const b = Buffer.alloc(32); fs.readSync(fd, b, 0, 32, 0); fs.closeSync(fd);
          magic = b.slice(0, 12).toString('hex');
          size = fs.statSync(abs).size;
        }
        seen.set(abs, { abs: path.relative(ROOT, abs).replace(/\\/g, '/'), magic, size, ext: path.extname(abs), refs: 0 });
      }
      seen.get(abs).refs += 1;
    } else if (/class="[^"]*\bexternal-image\b/.test(tag)) ext += 1;
  }
}
const rows = [...seen.values()].sort((a, b) => a.abs.localeCompare(b.abs));
console.log('content-img tags:', content, '| unique files:', rows.length, '| external:', ext);
const byExt = {};
for (const r of rows) byExt[r.ext] = (byExt[r.ext] || 0) + 1;
console.log('by ext:', JSON.stringify(byExt));
for (const r of rows) console.log([r.ext, r.magic.slice(0, 24), r.size, r.refs, r.abs].join('\t'));
