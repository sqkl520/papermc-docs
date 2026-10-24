// 评估 critique-typography.md（932 行合并版）质量 + 定位可插入位置
const fs = require('fs');
const t = fs.readFileSync('reports/critique-typography.md', 'utf8');
const lines = t.split('\n');

console.log('总行数:', lines.length, '| KB:', Math.round(Buffer.byteLength(t) / 1024));
console.log('表格行:', lines.filter((l) => /^\|/.test(l)).length);
console.log('H 级标记:', lines.filter((l) => /^### H\d|\*\*H[1-4]\*\*/.test(l)).length);
console.log('出处 URL:', new Set((t.match(/https?:\/\/[^\s)>"']+/g) || [])).size);

console.log('\n=== 与"断行/中文排版"相关的小节 ===');
lines.forEach((l, i) => {
  if (/^#{3,4} /.test(l) && /断行|断词|中文|行宽|measure|hyphen|overflow/i.test(l)) console.log('  ' + (i + 1) + ': ' + l);
});

console.log('\n=== 值得夸 段 ===');
const i = lines.findIndex((l) => /值得夸|值得称赞|优点/.test(l));
if (i >= 0) console.log(lines.slice(i, i + 10).join('\n').slice(0, 800));

console.log('\n=== 末尾 12 行（确认已写完）===');
console.log(lines.slice(-12).join('\n').slice(0, 800));
