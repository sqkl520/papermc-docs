'use strict';
/**
 * c45-bytecheck.js — 诊断 tools/site/assets.js 的 UTF-8 字节级异常（只读）。
 * 起因：node --check tools/site/assets.js 报 "Unexpected token '<'"（第 10 行的模板字面量未开），
 * 但终端里那行的反引号"看着还在" —— 典型的**同形字符 / BOM / 非法 UTF-8** 伪装。
 * 用法: node tools/c45-bytecheck.js [--file=tools/site/assets.js]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const REL = opt('file', 'tools/site/assets.js');
const abs = path.join(ROOT, REL);
const buf = fs.readFileSync(abs);

console.log('file  : ' + REL);
console.log('bytes : ' + buf.length);
console.log('BOM   : ' + (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF ? 'YES (UTF-8 BOM!)' : 'no'));

// 1) 严格 UTF-8 解码检查（replacement char U+FFFD 出现 = 源文件在某个环节被破坏）
const asUtf8 = buf.toString('utf8');
const fffd = (asUtf8.match(/\uFFFD/g) || []).length;
console.log('U+FFFD (非法 UTF-8 替换符) 次数: ' + fffd);

// 2) 非 ASCII 但"不应该出现在 ASCII 上下文"的可疑字符：把所有反引号类同形字符找出来
const lookalikes = [
  ['U+0060 GRAVE ACCENT  `', 0x0060],
  ['U+00B4 ACUTE ACCENT  ´', 0x00B4],
  ['U+02CB MODIFIER GRAVE ˋ', 0x02CB],
  ['U+2018 LEFT SINGLE QUOTE ‘', 0x2018],
  ['U+2035 REVERSED PRIME ‵', 0x2035],
  ['U+2036 REVERSED DOUBLE PRIME ‶', 0x2036],
  ['U+2039', 0x2039],
  ['U+203A', 0x203A],
];

// 3) 逐字符扫描第 8-16 行，把每个字符的码点打出来（ASCII 可打印直接显示）
const lines = asUtf8.split(/\n/);
const WATCH = [8, 16];
for (let ln = WATCH[0]; ln <= WATCH[1] && ln <= lines.length; ln++) {
  const line = lines[ln - 1] || '';
  const firstNonAscii = [];
  for (let i = 0; i < line.length; i++) {
    const cp = line.codePointAt(i);
    if (cp > 0x7e || (cp < 0x20 && cp !== 0x09)) {
      firstNonAscii.push({ i, cp: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), ch: line[i] });
    }
  }
  console.log('\nL' + ln + ' len=' + line.length + (firstNonAscii.length ? '  non-ASCII: ' : '  (pure ASCII)'));
  if (firstNonAscii.length) console.log('   ' + firstNonAscii.slice(0, 12).map((x) => x.cp + '@' + x.i + ' (' + x.ch + ')').join('  '));
  console.log('   text: ' + line.slice(0, 120));
}

// 4) 反引号统计：模板字面量必须成对
const backticks = (asUtf8.match(/`/g) || []).length;
console.log('\n反引号 U+0060 总数: ' + backticks + ' → ' + (backticks % 2 === 0 ? '偶数（配平）' : '奇数（未配平 → 必然语法错误）'));

// 5) 同形字符在全文的出现次数
console.log('\n同形/易混字符在全文出现次数：');
for (const [name, cp] of lookalikes) {
  const n = [...asUtf8].filter((c) => c.codePointAt(0) === cp).length;
  if (n) console.log('  ' + name + ' : ' + n);
}

// 6) 第 13-15 行原始字节（定位那对多出来的字符）
console.log('\n原始字节 L13-L16:');
for (let ln = 13; ln <= 16 && ln <= lines.length; ln++) {
  const start = lines.slice(0, ln - 1).join('\n').length + (ln > 1 ? 1 : 0);
  const b = buf.subarray(start, start + Math.min(64, (lines[ln - 1] || '').length + 2));
  console.log('  L' + ln + ': ' + [...b].map((x) => x.toString(16).padStart(2, '0')).join(' '));
  console.log('       ascii: ' + JSON.stringify(b.toString('latin1')));
}
