'use strict';
/**
 * critique-mobile-sum.js —— 把 critique-mobile-probe.js 的 JSON 摘成可读文本（锐评取数用）
 * 用法：node tools/critique-mobile-sum.js <json> [section]
 *   section: all|head|toc|code|table|img|tap|pager|fix|typo|nest|hero|filter|drawer
 */
const fs = require('fs');
const file = process.argv[2];
const sect = process.argv[3] || 'all';
if (!file) { console.error('usage: node tools/critique-mobile-sum.js <probe.json> [section]'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const S = (x) => JSON.stringify(x);

for (const r of data.results) {
  if (r.error) { console.log('ERR ' + r.viewport + ' ' + r.page + ' ' + r.error); continue; }
  const m = r.measure;
  const tag = r.viewport + ' ' + r.name.padEnd(14);
  console.log('\n=== ' + tag + ' page=' + m.pageHeight + 'px screens=' + m.screens + ' vpH=' + m.viewportH + ' scrollW=' + m.docScrollW + '/' + m.innerW + ' hOverflow=' + m.hasHorizontalOverflow);
  if (sect === 'all' || sect === 'head') {
    console.log('  bodyStartY=' + m.bodyStartY + ' (' + m.bodyStartScreens + ' 屏)  firstP=' + m.firstParagraphY);
    console.log('  headEls:');
    for (const [s, b] of m.headEls) console.log('    ' + s.padEnd(22) + ' y=' + b.y + ' h=' + b.h + ' w=' + b.w);
    console.log('  crumbLinkH=' + m.typo.crumbLinkH + ' chipCount=' + m.typo.chipCount + ' pageMetaH=' + m.typo.pageMetaH);
  }
  if (sect === 'all' || sect === 'toc') {
    console.log('  toc: ' + S(m.toc));
  }
  if (sect === 'all' || sect === 'code') {
    for (const c of m.codeBlocks) console.log('  code: ' + S(c));
  }
  if (sect === 'all' || sect === 'table') {
    for (const t of m.tables) console.log('  table: ' + S(t));
  }
  if (sect === 'all' || sect === 'img') {
    console.log('  imgs: ' + S(m.images));
  }
  if (sect === 'all' || sect === 'tap') {
    console.log('  smallTargets.count=' + m.smallTargets.count);
    for (const t of m.smallTargets.sample) console.log('    ' + t.tag + ' ' + t.h + 'x' + t.w + ' [' + t.cls + '] "' + t.text + '"');
  }
  if (sect === 'all' || sect === 'pager') {
    console.log('  pager: ' + S(m.pager));
    console.log('  footer: ' + S(m.footer));
  }
  if (sect === 'all' || sect === 'fix') {
    console.log('  fixedSticky: ' + S(m.fixedSticky));
    console.log('  backToTop: ' + S(m.backToTop));
  }
  if (sect === 'all' || sect === 'typo') {
    console.log('  contentPadding=' + m.typo.contentPadding + ' contentW=' + m.typo.contentWidth + ' articleW=' + m.typo.articleWidth);
    for (const s of m.typo.samples) console.log('    ' + String(s.sel).padEnd(22) + ' fs=' + s.fontSize + ' lh=' + s.lineHeight);
  }
  if (sect === 'all' || sect === 'nest') {
    console.log('  headings=' + S(m.headings) + ' headingIds=' + m.headingIdCount + ' details=' + m.detailsCount + '/open' + m.detailsOpen + ' maxUlDepth=' + m.nested.maxUlDepth);
    console.log('  deepest=' + S(m.nested.deepest) + ' liCount=' + m.nested.liCount);
  }
  if (sect === 'all' || sect === 'hero') {
    console.log('  hero=' + S(m.hero));
    console.log('  entryCards=' + S(m.entryCards));
    console.log('  quickbar=' + S(m.quickbar));
    console.log('  firstFoldLinks=' + m.firstFoldLinks + ' firstFoldDocLinks=' + m.firstFoldDocLinks);
  }
  if (sect === 'all' || sect === 'filter') {
    console.log('  filterBar=' + S(m.filterInfo) + ' rows=' + m.apRowCount + ' firstRow=' + S(m.apFirstRow));
    console.log('  rowTexts=' + S(m.apRowTexts));
  }
  if (sect === 'all' || sect === 'drawer') {
    console.log('  drawer=' + S(r.drawer));
  }
}
