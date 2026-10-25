'use strict';
// 校验 reports/cr2-landing.md：BOM / CRLF / 编码 / 禁用词 / 结构必备小节
const fs = require('fs');

const F = 'reports/cr2-landing.md';
const buf = fs.readFileSync(F);

const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
const text = buf.toString('utf8');
const crlf = (text.match(/\r\n/g) || []).length;
const lf = (text.match(/\n/g) || []).length;
const loneCr = (text.match(/\r(?!\n)/g) || []).length;

const banned = ['TODO', 'TBD', '待填', '待补', '待定', '留给主 Agent', 'FIXME', 'XXX'];
const hits = banned.filter((w) => text.includes(w));

const required = [
  '首页区块清单表',
  '统计卡逐张判决',
  '建议的重写后首页结构',
  '明确不建议做的',
];

console.log('file=' + F);
console.log('bytes=' + buf.length);
console.log('BOM=' + bom + ' (must be false)');
console.log('CRLF=' + crlf + ' (must be 0)');
console.log('loneCR=' + loneCr + ' (must be 0)');
console.log('LF=' + lf);
console.log('bannedHits=' + JSON.stringify(hits));
console.log('requiredSections:');
for (const r of required) console.log('  ' + r + ' => ' + text.includes(r));

// 结构体检：表格行数、代码块是否闭合
const tableRows = (text.match(/^\|/gm) || []).length;
const fences = (text.match(/^```/gm) || []).length;
console.log('tableRows=' + tableRows + ' fenceMarkers=' + fences + ' (fence must be even)');

const bad = bom || crlf > 0 || loneCr > 0 || hits.length > 0 || fences % 2 !== 0 || required.some((r) => !text.includes(r));
console.log('RESULT=' + (bad ? 'FAIL' : 'PASS'));
