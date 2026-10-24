'use strict';
/**
 * critique-typo-write.js — 把报告正文（critique-typo-doc/*.part.md）按序拼接写成
 * reports/critique-typography.md（UTF-8 无 BOM）。
 *
 * 之所以分片：一次性内联 4 万字符的中文正文容易在传输层被截断/转义出错；
 * 分片文件各自短小、可单独校对，拼接是纯字节操作。
 */
const fs = require('fs');
const path = require('path');

const DOC = path.join(__dirname, 'critique-typo-doc');
const OUT = path.join(__dirname, '..', 'reports', 'critique-typography.md');

const parts = fs.readdirSync(DOC).filter((f) => /^\d+.*\.part\.md$/.test(f)).sort();
if (!parts.length) { console.error('no parts'); process.exit(1); }

let buf = '';
for (const f of parts) {
  const s = fs.readFileSync(path.join(DOC, f), 'utf8');
  buf += s;
  if (!s.endsWith('\n')) buf += '\n';
}
/* 去掉可能的 BOM / 替换字符，保证纯 UTF-8 洁净 */
buf = buf.replace(/^\uFEFF/, '');
const bad = (buf.match(/\uFFFD/g) || []).length;
fs.writeFileSync(OUT, buf, 'utf8');

const t = fs.readFileSync(OUT, 'utf8');
console.log('parts=' + parts.length + ' (' + parts.join(' ') + ')');
console.log('BOM=' + (t.charCodeAt(0) === 0xFEFF));
console.log('REPL=' + t.includes('\uFFFD'));
console.log('LINES=' + t.split('\n').length);
console.log('CHARS=' + t.length);
console.log('BYTES=' + Buffer.byteLength(t, 'utf8'));
console.log('badBeforeWrite=' + bad);
