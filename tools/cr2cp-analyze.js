'use strict';
/**
 * cr2cp-analyze.js — 对 static.json 做二次分类：区分「分组索引页」「真内容页无 h2」，
 * 并算出 h2->h4 跳级的具体页面与上下文。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const D = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'cr2cp', 'static.json'), 'utf8'));
const rows = D.rows;

const isIndexish = (r) => /(^|\/)(index\.html)$/.test(r.rel) && r.contentChars < 700;

const realContent = rows.filter((r) => !isIndexish(r));
const indexish = rows.filter(isIndexish);

const noH2Real = realContent.filter((r) => r.h2 === 0);
const noH2Index = indexish.filter((r) => r.h2 === 0);
const noTocReal = realContent.filter((r) => r.tocCount === 0);

console.log('=== 分类 ===');
console.log('总内容页        ', rows.length);
console.log('分组索引页(短)  ', indexish.length, '  其中无 h2:', noH2Index.length);
console.log('真内容页        ', realContent.length, '  其中无 h2:', noH2Real.length, ' 无 TOC:', noTocReal.length);
console.log('\n-- 真内容页里没有 h2 的（含标题分布 h2/h3/h4/h5/h6 + 正文字数）--');
noH2Real.forEach((r) => console.log('  ' + r.rel.padEnd(58) + ' ' + [r.h2, r.h3, r.h4, r.h5, r.h6].join('/').padEnd(10) + ' chars=' + r.contentChars + ' toc=' + r.tocCount));
console.log('\n-- 真内容页里没有 TOC 的 --');
noTocReal.forEach((r) => console.log('  ' + r.rel.padEnd(58) + ' ' + [r.h2, r.h3, r.h4].join('/').padEnd(8) + ' chars=' + r.contentChars));
console.log('\n-- 跳级页明细 --');
rows.filter((r) => r.skipCount > 0).forEach((r) => {
  console.log('  ' + r.rel + '  h=' + [r.h2, r.h3, r.h4, r.h5, r.h6].join('/'));
  r.skips.forEach((s) => console.log('      ' + s.from + ' -> ' + s.to + '  @ "' + s.text + '"'));
});

// 长页统计
const byChars = [...rows].sort((a, b) => b.contentChars - a.contentChars);
console.log('\n-- 正文字数 Top 8 --');
byChars.slice(0, 8).forEach((r) => console.log('  ' + r.rel.padEnd(56) + ' chars=' + r.contentChars + ' toc=' + r.tocCount + ' h2=' + r.h2));
console.log('\n-- TOC 条目 Top 8 --');
[...rows].sort((a, b) => b.tocCount - a.tocCount).slice(0, 8).forEach((r) => console.log('  ' + r.rel.padEnd(56) + ' toc=' + r.tocCount + ' chars=' + r.contentChars));

// 无 TOC 页在侧栏还有没有别的抓手 —— 统计 drawerToc
console.log('\n-- 抽屉目录覆盖 --');
console.log('  有 drawerToc 的页:', rows.filter((r) => r.drawerToc > 0).length, '/', rows.length);
console.log('  无 TOC 且无 drawerToc:', rows.filter((r) => r.tocCount === 0 && r.drawerToc === 0).length);

const out = {
  indexish: indexish.length, realContent: realContent.length,
  noH2Index: noH2Index.length, noH2Real: noH2Real.length, noTocReal: noTocReal.length,
  noH2RealList: noH2Real.map((r) => ({ rel: r.rel, h: [r.h2, r.h3, r.h4, r.h5, r.h6], chars: r.contentChars, toc: r.tocCount })),
  skipList: rows.filter((r) => r.skipCount > 0).map((r) => ({ rel: r.rel, skips: r.skips })),
};
fs.writeFileSync(path.join(os.tmpdir(), 'cr2cp', 'analyze.json'), JSON.stringify(out, null, 1), 'utf8');
