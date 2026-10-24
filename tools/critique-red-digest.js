'use strict';
/** critique-red-digest.js — 从 critique-red-probe.json 抽取判决所需字段（只读） */
const fs = require('fs');
const path = require('path');
const J = JSON.parse(fs.readFileSync(path.join('reports', 'critique-red-probe.json'), 'utf8'));
const pick = process.argv[2] || 'summary';

const by = (vp, page) => J.results.find((r) => r.viewport === vp && (r.page === page || r.name === page));

if (pick === 'summary') {
  console.log('=== first <p> 身份（是否真的是正文） ===');
  for (const r of J.results) {
    const m = r.m; if (!m) continue;
    const f = m.firstP;
    console.log([r.viewport.padEnd(9), r.page.padEnd(42), 'cls=' + String(f && f.cls).padEnd(14), 'fs=' + String(f && f.fs).padEnd(6), 'pW=' + String(f && f.w).padEnd(5), '| ' + String(f && f.t)].join(' '));
  }
  console.log('\n=== 语言占比 / 溢出 / 侧栏高度 / 代码块 ===');
  for (const r of J.results) {
    const m = r.m; if (!m) continue;
    console.log([r.viewport.padEnd(9), r.page.padEnd(42),
      'cjkRatio=' + m.langMix.cjkRatio, 'ovf=' + m.overflowX,
      'grid=' + String(m.gridColumns).padEnd(30),
      'sideMed=' + (m.sidebar && m.sidebar.heights ? m.sidebar.heights.med : '-'),
      'sideMin=' + (m.sidebar && m.sidebar.heights ? m.sidebar.heights.min : '-'),
      'under24=' + (m.sidebar ? m.sidebar.under24 : '-'),
      'tocMed=' + (m.toc && m.toc.heights ? m.toc.heights.med : '-'),
      'code=' + JSON.stringify(m.code)].join(' '));
  }
  console.log('\n=== 外链 / 零依赖审计（应全部为空） ===');
  for (const r of J.results) {
    const m = r.m; if (!m) continue;
    const e = m.external;
    const bad = e.cssLinks.length + e.scripts.length + e.imgs.length + e.iframes.length;
    console.log(r.viewport + ' ' + r.page.padEnd(42) + ' ext=' + bad + ' inlineScripts=' + e.inlineScripts + ' htmlHasFetchPattern=' + e.fetchHtml);
  }
}

if (pick === 'cliff') {
  console.log('=== 1024 ↔ 1025 断崖 ===');
  const pages = ['/paper/dev/dialogs/', '/velocity/tuning/', '/paper/', '/paper/reference/world-configuration/', '/'];
  for (const p of pages) {
    const a = by('1024x800', p), b = by('1025x800', p);
    if (!a || !b) continue;
    const wa = a.m.articleW, wb = b.m.articleW;
    console.log(p.padEnd(42) + ' 1024w art=' + wa + ' (' + a.m.cjkChApprox + ' 汉字)  →  1025w art=' + wb + ' (' + b.m.cjkChApprox + ' 汉字)  Δ=' + (wb - wa) + ' (' + Math.round((wb / wa - 1) * 100) + '%)  grid1024=' + a.m.gridColumns + '  grid1025=' + b.m.gridColumns);
  }
  console.log('\n=== 宽度曲线非单调性（dialogs 正文页） ===');
  for (const vp of ['900x800', '1024x800', '1025x800', '1100x800', '1280x800', '1440x900']) {
    const r = by(vp, '/paper/dev/dialogs/');
    console.log(vp.padEnd(9) + ' art=' + r.m.articleW + 'px  ≈' + r.m.cjkChApprox + ' 汉字/行  真实 maxLine=' + r.m.widthMeasured.maxLineW + 'px, median ' + r.m.widthMeasured.medFullChars + ' 字符/行');
  }
}

if (pick === 'lines') {
  const r = by(process.argv[3] || '1440x900', process.argv[4] || '/paper/dev/dialogs/');
  console.log('page=' + r.page + ' vp=' + r.viewport + ' articleW=' + r.m.articleW + ' contentMaxW=' + r.m.contentMaxWidth);
  console.log('firstP=', JSON.stringify(r.m.firstP, null, 1));
  console.log('lineWidths=', r.m.widthMeasured.lineWidths.join(','));
  console.log('fullLines=', JSON.stringify(r.m.widthMeasured.fullLines, null, 1));
  console.log('paragraphWidths.count=' + r.m.paragraphWidths.count + ' fullWidth=' + r.m.paragraphWidths.fullWidth);
  console.log('typography=', JSON.stringify(r.m.typography, null, 1));
  console.log('geometry=', JSON.stringify(r.m.geometry, null, 1));
}

if (pick === 'raw') {
  const r = by(process.argv[3], process.argv[4]);
  console.log(JSON.stringify(r, null, 2));
}

if (pick === 'allsame') {
  // 每页第一段是否与容器同宽；以及段落宽度种类数
  for (const vp of ['1440x900', '320x568']) {
    for (const r of J.results.filter((x) => x.viewport === vp)) {
      const s = r.m.paragraphWidths.sample;
      const uniq = [...new Set(s.map((x) => x.w))];
      console.log(vp + ' ' + r.page.padEnd(42) + ' pCount=' + r.m.paragraphWidths.count + ' fullWidth=' + r.m.paragraphWidths.fullWidth + ' uniqWidths=' + uniq.length + ' [' + uniq.slice(0, 8).join(',') + ']');
    }
  }
}
