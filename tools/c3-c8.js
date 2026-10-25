'use strict';
/* c3-c8.js — 精确列出 check=8 的 4 条硬断言与 56 条 C 类差异（只读） */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'mobile-verification.json'), 'utf8'));
const c = (j.checks || []).find((x) => x.id === 8);
const m = c.metrics || {};
console.log('check8: verdict=' + c.verdict + ' diff=' + m.diffCount + ' regression=' + m.regressionCount + ' expected=' + m.expectedCount);

/* 按字段聚合，给出 pre→post 的完整值域 */
const agg = {};
for (const d of (m.diffTable || [])) {
  const k = d.viewport + ' | ' + d.field;
  agg[k] = agg[k] || { kind: d.kind, abc: d.abc, pres: [], posts: [], n: 0 };
  agg[k].n++;
  if (!agg[k].pres.includes(JSON.stringify(d.pre))) agg[k].pres.push(JSON.stringify(d.pre));
  if (!agg[k].posts.includes(JSON.stringify(d.post))) agg[k].posts.push(JSON.stringify(d.post));
}
console.log('\n字段 | 类别 | n | pre → post');
for (const k of Object.keys(agg).sort()) {
  const a = agg[k];
  console.log('  ' + k.padEnd(34) + a.kind.padEnd(11) + 'abc=' + a.abc + ' n=' + String(a.n).padEnd(2) + ' ' + a.pres.join('/') + ' → ' + a.posts.join('/'));
}
console.log('\n硬断言（' + (m.hardFailures || []).length + '）：');
for (const h of (m.hardFailures || [])) console.log('  ' + h);
