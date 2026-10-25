'use strict';
/* c3-syntax.js — 语法/模板字面量自检（只读）
 * 用法: node tools/c3-syntax.js [file]
 * 作用: 用 vm.Script 编译（不执行），报告首个语法错误 + 上下文；
 *       并单独统计 SITE_CSS 模板字面量区域内出现裸反引号的行号（模板被打断的根因）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const file = process.argv[2] || path.join(__dirname, 'site', 'assets.js');
const src = fs.readFileSync(file, 'utf8');
console.log('file=' + file + '  bytes=' + Buffer.byteLength(src, 'utf8') + '  lines=' + src.split('\n').length);
try {
  new vm.Script(src, { filename: file });
  console.log('PARSE: OK');
} catch (e) {
  console.log('PARSE: FAIL -> ' + e.message);
  const m = /:(\d+)/.exec(String(e.stack || ''));
  if (m) {
    const n = Number(m[1]);
    const lines = src.split('\n');
    for (let i = Math.max(1, n - 3); i <= Math.min(lines.length, n + 3); i++) {
      console.log((i === n ? '>> ' : '   ') + i + ': ' + lines[i - 1]);
    }
  }
  process.exitCode = 1;
}
/* 找出 const SITE_CSS = ` 到下一个 `; 的行区间，列出区间内所有裸反引号 */
const lines = src.split('\n');
let startLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^const SITE_CSS = `/.test(lines[i])) { startLine = i + 1; break; }
}
console.log('SITE_CSS starts at line ' + startLine);
if (startLine > 0) {
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (/^`;/.test(line)) { console.log('SITE_CSS ends at line ' + (i + 1)); break; }
    const n = (line.match(/`/g) || []).length;
    if (n) console.log('  BACKTICK x' + n + ' @line ' + (i + 1) + ': ' + line.trim().slice(0, 120));
  }
}
