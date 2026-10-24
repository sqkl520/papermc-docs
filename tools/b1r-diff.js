'use strict';
/**
 * b1r-diff.js — 汇总 b1r-geom.json：改前/改后 pageHeight、H1 位置、TOC 结构差异
 * 用法: node tools/b1r-diff.js
 */
const fs = require('fs');
const path = require('path');
const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'reports', '.b1r-geom.json'), 'utf8'));

console.log('viewport|page            |docH new/old (delta)|H1top new/old|tocDisp new/old|tocPos|tocScrollbar(new)|olMaxH(new)');
for (const [k, row] of Object.entries(j.vps)) {
  const n = row.new.before, o = row.old.before;
  const d = n.docH - o.docH;
  console.log([
    k.padEnd(34),
    String(n.docH).padStart(6) + '/' + String(o.docH).padStart(6) + (d === 0 ? '  (=0)' : '  (' + (d > 0 ? '+' : '') + d + ')'),
    String(n.h1Top).padStart(6) + '/' + String(o.h1Top).padStart(6),
    String(n.toc ? n.toc.display : '-') + '/' + String(o.toc ? o.toc.display : '-'),
    n.toc ? n.toc.pos : '-',
    n.toc ? String(n.toc.hasScrollbar) : '-',
    n.toc ? n.toc.olMaxH : '-',
  ].join(' | '));
}
console.log('\n--- 滚动 900px 后 TOC 是否吸在顶栏下（sticky 生效判定）---');
for (const [k, row] of Object.entries(j.vps)) {
  const n = row.new.after, o = row.old.after;
  if (!n.toc || n.toc.display === 'none') continue;
  const pinnedNew = n.toc.rect ? n.toc.rect.t : null;
  const pinnedOld = o.toc && o.toc.rect ? o.toc.rect.t : null;
  console.log(k.padEnd(34), 'new tocTop=' + String(pinnedNew).padStart(5), '(topbarH ' + n.topbarH + ')', ' old tocTop=' + String(pinnedOld).padStart(5), ' new ol scrollbar=' + n.toc.olHasScrollbar);
}
