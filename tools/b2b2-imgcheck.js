'use strict';
/**
 * b2b2-imgcheck.js — 核对 D.1 的「89 张 vs content-img 88」差异来源（只读）
 * 用法：node tools/b2b2-imgcheck.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'archive', 'tools', 'reports', '.git']);
const htmls = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmls.push(p);
  }
})(ROOT);

let withSrc = 0; let content = 0; let ext = 0; let other = 0;
const extList = [];
const otherList = [];

for (const f of htmls) {
  const s = fs.readFileSync(f, 'utf8');
  for (const t of (s.match(/<img\b[^>]*>/gi) || [])) {
    const hasSrc = /\ssrc\s*=/.test(t);
    if (hasSrc) withSrc++;
    if (/\sclass\s*=\s*"[^"]*content-img/.test(t)) content++;
    else if (/\sclass\s*=\s*"[^"]*external-image/.test(t)) { ext++; if (extList.length < 5) extList.push(path.relative(ROOT, f) + ' :: ' + t.slice(0, 130)); }
    else if (hasSrc) { other++; if (otherList.length < 5) otherList.push(path.relative(ROOT, f) + ' :: ' + t.slice(0, 130)); }
  }
}

const out = { htmlFiles: htmls.length, withSrc, contentImg: content, externalImage: ext, srcOtherClass: other, extList, otherList };
fs.writeFileSync(path.join(require("os").tmpdir() || '.', 'b2b2', 'imgcheck.json'), JSON.stringify(out, null, 1), 'utf8');
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
