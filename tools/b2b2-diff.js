'use strict';
/**
 * b2b2-diff.js — 三方逐格差分汇总（只读；给报告 A/F 节提供可直接引用的计数）
 * 用法：node tools/b2b2-diff.js
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(require("os").tmpdir() || '.', 'b2b2');
const a = JSON.parse(fs.readFileSync(path.join(TMP, 'a.json'), 'utf8'));

const VPS = ['1440', '1280', '1200', '1100', '1025', '1024', '900', '768', '390', '320'];
const PAGES = ['landing', 'paper', 'dialogs', 'worldcfg', 'tuning', 'allpages'];
const g = (b, v, p) => a.find((r) => r.build === b && r.vp === v && r.page === p);

function compare(x, y, field) {
  let same = 0; let diff = 0; const list = [];
  for (const v of VPS) {
    for (const p of PAGES) {
      const m = g(x, v, p); const n = g(y, v, p);
      const gv = (r) => (field === 'artW' ? r.articleClientW : (r.prose ? r.prose.lineWGlobal : null));
      const mv = gv(m); const nv = gv(n);
      if (mv === nv) same++;
      else { diff++; list.push({ vp: v, page: p, a: mv, b: nv, delta: (mv != null && nv != null) ? Math.round((nv - mv) * 100) / 100 : null }); }
    }
  }
  return { same, diff, list };
}

const out = {};
for (const field of ['artW', 'lineW']) {
  out[field] = {};
  for (const [x, y] of [['new', 'b0'], ['b0', 'old'], ['new', 'old']]) {
    out[field][x + '-' + y] = compare(x, y, field);
  }
}

// 页高差异（b0 → new）
const hDiff = [];
for (const v of VPS) {
  for (const p of PAGES) {
    const m = g('new', v, p); const n = g('b0', v, p);
    if (m.pageHeight !== n.pageHeight) hDiff.push({ vp: v, page: p, b0: n.pageHeight, new: m.pageHeight, d: m.pageHeight - n.pageHeight });
  }
}
out.pageHeightDiff_b0_new = hDiff;

// 代码横滚差异（b0 → new）
const cDiff = [];
for (const v of VPS) {
  for (const p of PAGES) {
    const m = g('new', v, p); const n = g('b0', v, p);
    const mo = m.code ? m.code.overflow : null; const no = n.code ? n.code.overflow : null;
    if (mo !== no) cDiff.push({ vp: v, page: p, b0: no, new: mo });
  }
}
out.codeOverflowDiff_b0_new = cDiff;

fs.writeFileSync(path.join(TMP, 'diff.json'), JSON.stringify(out, null, 1), 'utf8');

const line = (k, v) => k + ': same=' + v.same + ' diff=' + v.diff;
for (const f of ['artW', 'lineW']) {
  for (const k of Object.keys(out[f])) process.stdout.write(f + ' | ' + line(k, out[f][k]) + '\n');
}
process.stdout.write('pageHeight b0->new diffs: ' + hDiff.length + '\n');
for (const d of hDiff.slice(0, 12)) process.stdout.write('  ' + d.vp + '/' + d.page + ': ' + d.b0 + ' -> ' + d.new + ' (' + d.d + ')\n');
process.stdout.write('codeOverflow b0->new diffs: ' + cDiff.length + '\n');
for (const d of cDiff.slice(0, 12)) process.stdout.write('  ' + d.vp + '/' + d.page + ': ' + d.b0 + ' -> ' + d.new + '\n');
