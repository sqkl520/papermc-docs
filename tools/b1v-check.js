'use strict';
// b1v-check.js — 产物自检：BOM / 编码 / 乱码字节 / 只允许写入的文件清单
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const mustBeClean = [path.join(ROOT, 'reports', 'b1-verify.md')];
for (const f of mustBeClean) {
  const buf = fs.readFileSync(f);
  const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const txt = buf.toString('utf8');
  const roundtrip = Buffer.from(txt, 'utf8').equals(buf);
  console.log(path.basename(f));
  console.log('  BOM=' + (bom ? 'true' : 'false'));
  console.log('  utf8_roundtrip=' + roundtrip);
  console.log('  bytes=' + buf.length + ' chars=' + txt.length);
  // 常见中文乱码特征：U+FFFD 或 mojibake 区段
  const bad = (txt.match(/\uFFFD/g) || []).length;
  const mojibake = (txt.match(/[\u00C0-\u00FF]{3,}/g) || []).length;
  console.log('  replacement_chars=' + bad + ' mojibake_runs=' + mojibake);
  console.log('  lines=' + txt.split('\n').length);
}

// 我创建/允许修改的文件
const expected = new Set([
  'reports/b1-verify.md',
  'tools/b1v-pick.js', 'tools/b1v-inspect.js', 'tools/b1v-probe.js', 'tools/b1v-probe2.js',
  'tools/b1v-probe3.js', 'tools/b1v-probe4.js', 'tools/b1v-probe5.js', 'tools/b1v-probe6.js',
  'tools/b1v-probe7.js', 'tools/b1v-probe8.js', 'tools/b1v-probe9.js', 'tools/b1v-probe10.js',
  'tools/b1v-check.js',
]);
console.log('\n--- my artifacts present ---');
for (const e of expected) {
  const p = path.join(ROOT, e);
  console.log((fs.existsSync(p) ? 'OK   ' : 'MISS ') + e);
}

// 受保护区域最近修改时间（确认未被我触碰）
console.log('\n--- protected files mtime (should predate this session start) ---');
const protectedFiles = [
  'tools/site/assets.js', 'tools/site/layout.js', 'tools/site/nav.js', 'tools/site/render.js',
  'assets/site.css', 'assets/site.js', 'index.html', 'package.json',
];
const now = Date.now();
for (const f of protectedFiles) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { console.log('  (missing) ' + f); continue; }
  const st = fs.statSync(p);
  const ageMin = ((now - st.mtimeMs) / 60000).toFixed(1);
  console.log('  ' + f.padEnd(24) + ' mtime=' + st.mtime.toISOString() + '  age=' + ageMin + 'min');
}
