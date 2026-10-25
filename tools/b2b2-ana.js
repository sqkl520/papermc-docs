'use strict';
/**
 * b2b2-ana.js — 把 a.json / b.json / c.json 等整理成报告用的 markdown 表（只读）
 * 用法：node tools/b2b2-ana.js a
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(process.env.TEMP || '.', 'b2b2');
const rd = (n) => JSON.parse(fs.readFileSync(path.join(TMP, n), 'utf8'));

const which = process.argv[2] || 'a';

if (which === 'a') {
  const rows = rd('a.json');
  const VPS = ['1440', '1280', '1200', '1100', '1025', '1024', '900', '768', '390', '320'];
  const PAGES = ['landing', 'paper', 'dialogs', 'worldcfg', 'tuning', 'allpages'];
  const BUILDS = ['new', 'b0', 'old'];
  const get = (b, v, p) => rows.find((r) => r.build === b && r.vp === v && r.page === p) || {};

  // 表 1：new 的正文行宽（字符数）+ article 宽
  for (const b of BUILDS) {
    console.log('\n#### ' + b + ' — lineWGlobal（px） / chLine / artClientW / pageHeight');
    console.log('| vp | ' + PAGES.join(' | ') + ' |');
    console.log('|' + '---|'.repeat(PAGES.length + 1));
    for (const v of VPS) {
      const cells = PAGES.map((p) => {
        const r = get(b, v, p);
        if (!r.prose) return 'n/a';
        return r.prose.lineWGlobal + ' / ' + r.prose.chLineGlobal + ' / ' + r.articleClientW + ' / ' + r.pageHeight;
      });
      console.log('| ' + v + ' | ' + cells.join(' | ') + ' |');
    }
  }

  // 表 2：dialogs 逐视口三方对拍（关键页）
  console.log('\n#### dialogs 三方对拍（artW / lineW / chLine / h / toc / code / tbl）');
  console.log('| vp | new | b0 | old |');
  console.log('|---|---|---|---|');
  for (const v of VPS) {
    const cells = BUILDS.map((b) => {
      const r = get(b, v, 'dialogs');
      return [r.articleClientW, r.prose && r.prose.lineWGlobal, r.prose && r.prose.chLineGlobal, r.pageHeight, r.tocMode, r.code && (r.code.overflow + '/' + r.code.blocks), r.tables && (r.tables.overflow + '/' + r.tables.blocks)].join(' / ');
    });
    console.log('| ' + v + ' | ' + cells.join(' | ') + ' |');
  }

  // 表 3：代码/表格横滚全页（new）
  console.log('\n#### new 代码块横滚 overflow/blocks、表格横滚');
  console.log('| vp | ' + PAGES.join(' | ') + ' |');
  console.log('|' + '---|'.repeat(PAGES.length + 1));
  for (const v of VPS) {
    console.log('| ' + v + ' | ' + PAGES.map((p) => {
      const r = get('new', v, p);
      if (!r.code) return 'n/a';
      return r.code.overflow + '/' + r.code.blocks + ' · ' + r.tables.overflow + '/' + r.tables.blocks;
    }).join(' | ') + ' |');
  }

  // 表 4：old 的代码横滚（对照）
  console.log('\n#### old 代码块横滚 overflow/blocks');
  for (const v of VPS) {
    console.log('| ' + v + ' | ' + PAGES.map((p) => {
      const r = get('old', v, p);
      if (!r.code) return 'n/a';
      return r.code.overflow + '/' + r.code.blocks;
    }).join(' | ') + ' |');
  }

  // 表 5：TOC 形态
  console.log('\n#### TOC 形态（三方 × 视口，dialogs）');
  for (const v of VPS) {
    console.log(v + ': ' + BUILDS.map((b) => {
      const r = get(b, v, 'dialogs');
      return b + '=' + r.tocMode + (r.toc ? '(' + r.toc.w + ')' : '');
    }).join('  '));
  }

  // 表 6：overflow 检查（docScrollW vs docClientW）
  console.log('\n#### 横向溢出（docScrollW > docClientW）');
  for (const b of BUILDS) {
    const bad = rows.filter((r) => r.build === b && r.docScrollW > r.docClientW + 1);
    console.log(b + ': ' + bad.length + ' 格' + (bad.length ? ' → ' + bad.map((r) => r.vp + r.page + '(' + (r.docScrollW - r.docClientW) + ')').join(', ') : ''));
  }
}
