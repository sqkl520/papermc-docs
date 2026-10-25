'use strict';
/**
 * cr2lp-h.js — 汇总计算：把 a/b/c/d/e/f/g 的临时 JSON 合成报告用的关键数字。
 * 只读临时 JSON，输出 tmpdir/cr2lp-h.json，并在 stdout 打印「报告用数字表」。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const T = os.tmpdir();
const load = (n) => JSON.parse(fs.readFileSync(path.join(T, 'cr2lp-' + n + '.json'), 'utf8'));

const A = load('a');
const B = load('b');
const C = load('c');
const D = load('d');
const E = load('e');
const F = load('f');
const G = load('g');

const out = { generatedAt: new Date().toISOString(), derived: {}, ab: {} };
const r1 = (n) => Math.round(n * 10) / 10;

for (const vp of ['1440x900', '390x844', '320x568']) {
  const a = A.new[vp];
  const b = B.data[vp];
  const c = C.data['new@' + vp];
  const g = G.data['new@' + vp];
  const e = E.data[vp];
  const f = F.data[vp];
  const d = D.data[vp];
  const missing = [!a && 'a', !b && 'b', !c && 'c', !g && 'g'].filter(Boolean);
  if (missing.length) { console.log('skip ' + vp + ' missing=' + missing.join(',')); continue; }

  const vh = a.vh;
  const tag = a.heroDetail.ps.find((p) => p.cls === 'hero-tag') || { h: 0 };
  const body = a.heroDetail.ps.find((p) => p.cls === '') || { h: 0 };
  const narr = tag.h + body.h;

  const foldTop = [];
  for (const blk of a.blocks) {
    if (blk.y >= vh) break;
    foldTop.push({
      cls: blk.cls || blk.tag, y: blk.y, h: blk.h,
      visible: Math.max(0, Math.min(blk.y + blk.h, vh) - Math.max(blk.y, 0)),
      links: blk.links, chars: blk.chars,
    });
  }
  const foldVisible = foldTop.reduce((n, x) => n + x.visible, 0);

  out.derived[vp] = {
    vh,
    pageHeight: a.pageHeight,
    screens: a.screensCount,
    h1Y: a.heroDetail.h1.y,
    h1Text: a.heroDetail.h1.text,
    narrPx: narr,
    narrPctOfVh: r1((narr / vh) * 100),
    heroPx: a.heroDetail.heroH,
    heroPctOfVh: r1((a.heroDetail.heroH / vh) * 100),
    heroChars: a.heroDetail.heroChars,
    heroCjk: a.heroDetail.heroCjk,
    foldBlocks: foldTop,
    foldVisiblePx: foldVisible,
    foldVisiblePct: r1((foldVisible / vh) * 100),
    foldDocPageLinks: g.foldDocLinks.length,
    foldLinkKinds: b.foldByKind,
    firstGroupHomeY: c.firstGroupHomeY,
    firstLeafY: c.firstLeafLinkY,
    firstLeafText: c.firstLeafLinkText,
    firstLeafScreensDown: r1(c.firstLeafLinkY / vh),
    cardCount: a.cards.length,
    entryCards: a.cards.filter((x) => x.kind === 'entry').length,
    quickCards: a.cards.filter((x) => x.kind === 'quick').length,
    statCards: a.cards.filter((x) => x.kind === 'stat').length,
    clickableCards: a.cards.filter((x) => x.clickable).length,
    distinctCssSignatures: f ? f.sigTotal : null,
    statWidths: [...new Set(g.stats.map((s) => s.w))],
    statRows: Object.entries(g.statRows).map(([y, ws]) => ({ y: +y, widths: ws })),
    treeLeafUnique: f ? f.treeLeafUnique : null,
    treeLeafDupInSidebar: f ? f.treeLeafAlsoInSidebar : null,
    treeLeafDupPct: f ? f.treeLeafDupPct : null,
    artLinks: b.artHrefTotal,
    artLinksUnique: b.artHrefUnique,
    sideLinks: b.sideHrefTotal,
    sideLinksUnique: b.sideHrefUnique,
    overlapPct: b.overlapPctOfArtUnique,
    ledger: e ? e.ledger : null,
    ledgerPct: e ? e.ledgerPct : null,
    fontSizesDistinct: a.styleCounts.fontSizes.distinct,
    borderColorsDistinct: a.styleCounts.borderColors.distinct,
    shadowsDistinct: a.styleCounts.shadows.distinct,
    radiiDistinct: a.styleCounts.radiiDistinct,
    smallText: d ? d.smallText : null,
    tapSmall: d ? d.tapSmallCount : null,
    tapTotal: d ? d.tapTotal : null,
    domNodes: d ? d.domNodes : null,
    numRep: b.numRep,
    outline: d ? d.outline : null,
    leafRowH: c.leafAvgRowH,
    groupHomeRowH: c.groupHomeAvgRowH,
    h2Count: c.h2Count,
  };
}

for (const vp of ['1440x900', '390x844', '320x568']) {
  const n = G.data['new@' + vp];
  const o = G.data['old@' + vp];
  const cn = C.data['new@' + vp];
  const co = C.data['old@' + vp];
  if (!n || !o) continue;
  out.ab[vp] = {
    pageH_new: n.pageHeight, pageH_old: o.pageHeight, delta: n.pageHeight - o.pageHeight,
    treeH_new: cn.trees.reduce((s, t) => s + t.h, 0),
    treeH_old: co.trees.reduce((s, t) => s + t.h, 0),
    leafRow_new: cn.leafAvgRowH, leafRow_old: co.leafAvgRowH,
    ghRow_new: cn.groupHomeAvgRowH, ghRow_old: co.groupHomeAvgRowH,
    heroH_new: cn.heroH, heroH_old: co.heroH,
    screens_new: cn.screensTotal, screens_old: co.screensTotal,
    firstGroupHome_new: cn.firstGroupHomeY, firstGroupHome_old: co.firstGroupHomeY,
    firstLeaf_new: cn.firstLeafLinkY, firstLeaf_old: co.firstLeafLinkY,
  };
}

fs.writeFileSync(path.join(T, 'cr2lp-h.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('WROTE ' + path.join(T, 'cr2lp-h.json'));
for (const [vp, v] of Object.entries(out.derived)) {
  console.log('\n== ' + vp + ' vh=' + v.vh + ' pageH=' + v.pageHeight + ' screens=' + v.screens);
  console.log('   h1.y=' + v.h1Y + ' heroPx=' + v.heroPx + '(' + v.heroPctOfVh + '%) narr=' + v.narrPx + 'px(' + v.narrPctOfVh + '%)');
  console.log('   fold visiblePx=' + v.foldVisiblePx + '(' + v.foldVisiblePct + '%) docPageLinks=' + v.foldDocPageLinks + ' kinds=' + JSON.stringify(v.foldLinkKinds));
  console.log('   firstGroupHome.y=' + v.firstGroupHomeY + ' firstLeaf.y=' + v.firstLeafY + ' (=' + v.firstLeafScreensDown + ' screens)');
  console.log('   cards=' + v.cardCount + ' entry=' + v.entryCards + ' quick=' + v.quickCards + ' stat=' + v.statCards + ' clickable=' + v.clickableCards + ' cssSigs=' + v.distinctCssSignatures);
  console.log('   statWidths=' + JSON.stringify(v.statWidths) + ' rows=' + JSON.stringify(v.statRows));
  console.log('   treeLeaf=' + v.treeLeafUnique + ' dupInSidebar=' + v.treeLeafDupInSidebar + '(' + v.treeLeafDupPct + '%) artLinks=' + v.artLinks + '/' + v.artLinksUnique + ' side=' + v.sideLinks + '/' + v.sideLinksUnique + ' overlap=' + v.overlapPct + '%');
  console.log('   ledgerPct=' + JSON.stringify(v.ledgerPct));
  console.log('   styles: fonts=' + v.fontSizesDistinct + ' borders=' + v.borderColorsDistinct + ' shadows=' + v.shadowsDistinct + ' radii=' + v.radiiDistinct);
  console.log('   taps=' + v.tapTotal + ' small(<44)=' + v.tapSmall + ' dom=' + v.domNodes + ' leafRow=' + v.leafRowH + ' ghRow=' + v.groupHomeRowH);
  console.log('   numRep=' + JSON.stringify(v.numRep));
}
console.log('\n== AB ==');
console.log(JSON.stringify(out.ab, null, 1));
