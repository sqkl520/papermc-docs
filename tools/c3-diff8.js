'use strict';
/* c3-diff8.js — 归类 check=8 的差异表（只读），按 viewport/field/kind 聚合 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'mobile-verification.json'), 'utf8'));
const c = (j.checks || []).find((x) => x.id === 8);
const m = c.metrics || {};
const table = m.diffTable || [];
console.log('verdict=' + c.verdict + '  diffCount=' + m.diffCount + ' regression=' + m.regressionCount + ' expected=' + m.expectedCount);
console.log('pre_missing=' + m.pre_missing);
console.log('abcCounts=' + JSON.stringify(m.abcCounts));
console.log('abcFields=' + JSON.stringify(m.abcFields, null, 1));

const byVp = {};
for (const d of table) {
  byVp[d.viewport] = byVp[d.viewport] || [];
  byVp[d.viewport].push(d);
}
for (const vp of Object.keys(byVp)) {
  console.log('\n### ' + vp + '  (' + byVp[vp].length + ' 条)');
  const fields = {};
  for (const d of byVp[vp]) {
    const k = d.field;
    fields[k] = fields[k] || { kind: d.kind, abc: d.abc, n: 0, sample: null };
    fields[k].n++;
    if (!fields[k].sample) fields[k].sample = JSON.stringify(d.pre) + ' → ' + JSON.stringify(d.post);
  }
  for (const f of Object.keys(fields).sort()) {
    const x = fields[f];
    console.log('  ' + f.padEnd(22) + ' ' + x.kind.padEnd(11) + ' abc=' + x.abc + '  n=' + String(x.n).padEnd(3) + '  ' + x.sample);
  }
}
