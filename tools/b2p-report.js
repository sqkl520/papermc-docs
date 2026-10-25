'use strict';
/**
 * b2p-report.js — 把 b2p-probe.js 的原始 JSON 压成几张可读表（只读，不改站点）。
 * 用法: node tools/b2p-report.js
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(process.env.TEMP || '.', 'b2p');
const raw = JSON.parse(fs.readFileSync(path.join(TMP, 'probe.json'), 'utf8'));
const rows = raw.rows;

const pick = (v) => rows.filter((r) => r.variant === v);
const idx = (v, p, w) => rows.find((r) => r.variant === v && r.page === p && r.vw === w);

const pages = [...new Set(rows.map((r) => r.page))];
const vws = [...new Set(rows.map((r) => r.vw))].sort((a, b) => a - b);

console.log('== T1 各变体 article.w / 正文 capW / ch（每视口取 dialogs 有 TOC + worldcfg 无 TOC）==');
console.log('vw\tpage\tbase.artW\tA.artW\tA1200.artW\tbase.cap\tA.cap\tA1200.cap\tbase.ch\tA.ch\tbase.toc\tA1200.toc');
for (const w of vws) {
  for (const p of ['dialogs', 'worldcfg', 'tuning']) {
    const b = idx('base', p, w), a = idx('A', p, w), c = idx('A1200', p, w);
    if (!b) continue;
    console.log([w, p, b.article && b.article.w, a.article && a.article.w, c.article && c.article.w,
      b.prose && b.prose.capW, a.prose && a.prose.capW, c.prose && c.prose.capW,
      b.prose && b.prose.ch, a.prose && a.prose.ch, b.tocDisplay, c.tocDisplay].join('\t'));
  }
}

console.log('\n== T2 代码块横滚 / 表格横滚 / 横向溢出（A 变体 vs base）==');
console.log('vw\tpage\tbase.code\tover\tA.code\tover\tA1200.code\tover\tbase.docW\tA.docW\tbase.tbl\tover\tA.tbl\tover');
for (const w of vws) {
  for (const p of pages) {
    const b = idx('base', p, w), a = idx('A', p, w), c = idx('A1200', p, w);
    if (!b) continue;
    console.log([w, p, b.code.total, b.code.overflowing + '/' + b.code.total, c.code.total, c.code.overflowing + '/' + c.code.total,
      b.docW.scroll + '/' + b.docW.client, a.docW.scroll + '/' + a.docW.client,
      b.tableTotal, b.tableOverflowing + '/' + b.tableTotal, a.tableOverflowing + '/' + a.tableTotal].join('\t'));
  }
}

console.log('\n== T3 pageHeight（base / A / A1200）与增量 ==');
console.log('vw\tpage\tbase\tA\tΔA\tΔA%\tA1200\tΔ1200');
for (const w of vws) {
  for (const p of pages) {
    const b = idx('base', p, w), a = idx('A', p, w), c = idx('A1200', p, w);
    if (!b) continue;
    const dA = a.pageHeight - b.pageHeight;
    console.log([w, p, b.pageHeight, a.pageHeight, (dA > 0 ? '+' : '') + dA, ((dA / b.pageHeight) * 100).toFixed(1) + '%',
      c.pageHeight, (c.pageHeight - b.pageHeight > 0 ? '+' : '') + (c.pageHeight - b.pageHeight)].join('\t'));
  }
}

console.log('\n== T4 代码行推进 / pre 字号（应为改前 16px/24.8 与改后 13.6px/21.76 的差别）==');
for (const w of vws) {
  const b = idx('base', 'dialogs', w);
  if (!b) continue;
  console.log([w, 'preFS=' + b.code.preFS, 'preLH=' + b.code.preLH, 'codeFS=' + b.code.codeFS, 'adv=' + b.code.adv].join('\t'));
}

console.log('\n== T5 article.x（左边缘是否 delta 0）==');
console.log('vw\tbase.x\tA.x\tA1200.x\tbase.w\tA.w');
for (const w of vws) {
  const b = idx('base', 'dialogs', w), a = idx('A', 'dialogs', w), c = idx('A1200', 'dialogs', w);
  if (!b) continue;
  console.log([w, b.article.x, a.article.x, c.article.x, b.article.w, c.article.w].join('\t'));
}

console.log('\n== T6 单调性检查（A1200 变体：article.w 随视口应不下降）==');
for (const p of ['dialogs', 'particles', 'tuning']) {
  const seq = vws.map((w) => { const r = idx('A1200', p, w); return w + ':' + (r.article ? r.article.w : '-'); });
  console.log(p + '\t' + seq.join(' '));
}
console.log('\n== T7 基线单调性（现状，用于对比断崖）==');
for (const p of ['dialogs', 'particles', 'tuning']) {
  const seq = vws.map((w) => { const r = idx('base', p, w); return w + ':' + (r.article ? r.article.w : '-'); });
  console.log(p + '\t' + seq.join(' '));
}
console.log('\nEXE ' + raw.exe + '\nraw ' + path.join(TMP, 'probe.json'));
