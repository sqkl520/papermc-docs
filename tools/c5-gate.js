'use strict';
/**
 * c5-gate.js — 开工前的写权门禁判定（C1 的 assets.js 是否已完成）
 * 判定口径（任务书）：grep -c 'font-size:.875rem' tools/site/assets.js === 1 → C1 已完成，可写。
 * 为了在口径为 0 时给出可解释的证据，这里同时报告 .code-pre 附近所有 font-size 声明。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const p = path.join(ROOT, 'tools', 'site', 'assets.js');
const txt = fs.readFileSync(p, 'utf8');

function countAll(needle) {
  let n = 0, i = -1;
  while ((i = txt.indexOf(needle, i + 1)) !== -1) n++;
  return n;
}

const report = {
  file: 'tools/site/assets.js',
  bytes: Buffer.byteLength(txt, 'utf8'),
  mtime: fs.statSync(p).mtime.toISOString(),
  marker_exact_no_space: countAll('font-size:.875rem'),
  marker_exact_with_space: countAll('font-size: .875rem'),
  marker_875rem_anywhere: countAll('.875rem'),
  code_pre_lines: [],
  gate: null,
};

txt.split('\n').forEach((line, i) => {
  if (line.indexOf('.code-pre') !== -1 || line.indexOf('code-scroll') !== -1) {
    if (line.indexOf('font-size') !== -1 || line.indexOf('.code-pre{') !== -1) {
      report.code_pre_lines.push({ line: i + 1, ctx: line.trim().slice(0, 300) });
    }
  }
});

report.gate = report.marker_exact_no_space === 1 ? 'OPEN (C1 done -> assets.js writable)' : 'CLOSED (C1 not done -> assets.js READ-ONLY)';
report.decision = report.gate.startsWith('OPEN') ? 'may write assets.js' : 'must NOT write assets.js; ship patch text only';
fs.writeFileSync(path.join(ROOT, 'reports', '.c5-gate.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
