'use strict';
/**
 * c45-report-check.js — 报告落盘后的自检（UTF-8 无 BOM、无替换符、关键数字自洽）
 * 用法: node tools/c45-report-check.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const REL = 'reports/c45-images-p2.md';
const abs = path.join(ROOT, REL);
const buf = fs.readFileSync(abs);

const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
const txt = buf.toString('utf8');
const fffd = (txt.match(/\uFFFD/g) || []).length;
const lines = txt.split(/\r?\n/);
const crlf = /\r\n/.test(txt);

console.log('file      : ' + REL);
console.log('bytes     : ' + buf.length);
console.log('BOM       : ' + (bom ? 'HAS BOM ← 必须修掉' : 'none ✔ (UTF-8 无 BOM)'));
console.log('U+FFFD    : ' + fffd + (fffd ? ' ← 有乱码' : ' ✔'));
console.log('CRLF      : ' + (crlf ? 'yes（约定用 LF）' : 'no ✔ (LF)'));
console.log('lines     : ' + lines.length);
console.log('h2 sections: ' + lines.filter((l) => /^## /.test(l)).length);

const need = [
  '5e375849ad605117', 'cce4f4ee059f4dc5',
  '88 / 88', '164 / 164', '0.08018',
  'PASS', 'FAIL',
];
for (const n of need) {
  const ok = txt.includes(n);
  console.log((ok ? 'OK   ' : 'MISS ') + JSON.stringify(n));
}

// 验收表 8 行
const tableRows = lines.filter((l) => /^\| \d \| /.test(l));
console.log('acceptance rows (| N | ) : ' + tableRows.length);
for (const r of tableRows) console.log('   ' + r.slice(0, 118));

if (bom || fffd) process.exitCode = 1;
