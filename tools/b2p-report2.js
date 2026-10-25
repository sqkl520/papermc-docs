'use strict';
/**
 * b2p-report2.js — 把 b2p-probe2.js 的原始 JSON 压成表（P1-4 strut / P0-6 / 组合）。
 * 用法: node tools/b2p-report2.js
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(require("os").tmpdir() || '.', 'b2p');
const raw = JSON.parse(fs.readFileSync(path.join(TMP, 'probe2.json'), 'utf8'));
const rows = raw.rows;
const idx = (v, p, w) => rows.find((r) => r.variant === v && r.page === p && r.vw === w);
const pages = [...new Set(rows.map((r) => r.page))];
const vws = [...new Set(rows.map((r) => r.vw))].sort((a, b) => a - b);

console.log('== A. P1-4 strut 的独立效果（只改行距，字形不变）==');
console.log('vw\tpage\tlines\tbase.adv\tstrut.adv\tbase.H\tstrut.H\tΔH\tΔ/行');
for (const w of vws) for (const p of pages) {
  const b = idx('base', p, w), s = idx('strut', p, w);
  if (!b || !s) continue;
  const d = s.pageHeight - b.pageHeight;
  console.log([w, p, b.code.lines, b.code.adv, s.code.adv, b.pageHeight, s.pageHeight, (d > 0 ? '+' : '') + d,
    b.code.lines ? (d / b.code.lines).toFixed(3) : '-'].join('\t'));
}
console.log('\n== A2. strut 变体下 pre 的 computed font-size / line-height ==');
for (const w of [1440]) for (const p of pages) {
  const b = idx('base', p, w), s = idx('strut', p, w);
  if (!b) continue;
  console.log([w, p, 'base ' + b.code.preFS + '/' + b.code.preLH + ' code=' + b.code.codeFS, 'strut ' + s.code.preFS + '/' + s.code.preLH + ' code=' + s.code.codeFS].join('\t'));
}

console.log('\n== B. P0-6 断崖目标态 article.w 曲线（<1280 无右栏）==');
console.log('vw\t' + pages.join('\t'));
for (const w of vws) {
  console.log([w, ...pages.map((p) => { const b = idx('base', p, w), t = idx('toc1280', p, w); return (b.article ? b.article.w : '-') + '→' + (t.article ? t.article.w : '-'); })].join('\t'));
}

console.log('\n== C. 断崖幅度：正文 vs 代码块可用宽度 ==');
console.log('变体\t1024→1025\t1279→1280\t备注');
for (const v of ['base', 'toc1280', 'col40_toc1280', 'toc1280_fluid']) {
  const g = (w) => idx(v, 'dialogs', w);
  const a = g(1024), b = g(1025), c = g(1279), d = g(1280);
  if (!a || !b || !c || !d) continue;
  const p1 = (((b.article.w - a.article.w) / a.article.w) * 100).toFixed(1);
  const p2 = (((d.article.w - c.article.w) / c.article.w) * 100).toFixed(1);
  console.log([v, (a.article.w + '→' + b.article.w + ' (' + p1 + '%)'), (c.article.w + '→' + d.article.w + ' (' + p2 + '%)'), 'cols@1280=' + d.cols].join('\t'));
}

console.log('\n== D. 代码块横滚数（判定 P0-6 是否把代价推给代码）==');
console.log('vw\tpage\tbase\tstrut\tcol40\ttoc1280\tcol40+toc1280\tfluid');
for (const w of vws) for (const p of pages) {
  const g = (v) => { const r = idx(v, p, w); return r ? r.code.overflowing + '/' + r.code.total : '-'; };
  console.log([w, p, g('base'), g('strut'), g('col40'), g('toc1280'), g('col40_toc1280'), g('toc1280_fluid')].join('\t'));
}

console.log('\n== E. pageHeight 全表（组合态）==');
console.log('vw\tpage\tbase\tstrut\tcol40\tcol40+toc1280\tfluid');
for (const w of vws) for (const p of pages) {
  const g = (v) => { const r = idx(v, p, w); return r ? r.pageHeight : '-'; };
  console.log([w, p, g('base'), g('strut'), g('col40'), g('col40_toc1280'), g('toc1280_fluid')].join('\t'));
}

console.log('\n== F. TOC 链接可见数（P0-6 后 1025–1279 必须由吸顶条接管）==');
console.log('vw\tpage\tbase.tocDisplay\tbase.tocLinks\ttoc1280.tocDisplay\ttoc1280.tocLinks');
for (const w of vws) for (const p of pages) {
  const b = idx('base', p, w), t = idx('toc1280', p, w);
  if (!b) continue;
  console.log([w, p, b.tocDisplay, b.tocLinksVisible, t.tocDisplay, t.tocLinksVisible].join('\t'));
}
console.log('\nraw ' + path.join(TMP, 'probe2.json'));
