'use strict';
/**
 * b2b2-sec.js — 生成报告小节 markdown 到 TMPDIR\b2b2\sec<X>.md（只读数据，不改仓库）
 * 用法：node tools/b2b2-sec.js a|b|c|d|e
 */
const fs = require('fs');
const path = require('path');
const TMP = path.join(require("os").tmpdir() || '.', 'b2b2');
const rd = (n) => JSON.parse(fs.readFileSync(path.join(TMP, n), 'utf8'));
const w = (n, s) => { const f = path.join(TMP, n); fs.writeFileSync(f, s, 'utf8'); console.log('wrote ' + f + ' (' + s.length + ' chars)'); };

const VPS = ['1440', '1280', '1200', '1100', '1025', '1024', '900', '768', '390', '320'];
const PAGES = ['landing', 'paper', 'dialogs', 'worldcfg', 'tuning', 'allpages'];
const BUILDS = ['new', 'b0', 'old'];

const which = process.argv[2] || 'a';

if (which === 'a') {
  const rows = rd('a.json');
  const get = (b, v, p) => rows.find((r) => r.build === b && r.vp === v && r.page === p) || {};
  let s = '';
  s += '### A.1 关键视口汇总（1440 / 1025 / 1024，三方）\n\n';
  s += '口径：`artW` = `article.clientWidth`；`lineW` = 正文**全局最长行盒**（`Range.getClientRects()`）；`ch` = `round(lineW / zeroW)`，`zeroW = 8.63px`（canvas 实测 16px 系统 UI 字体 `\'0\'` advance）；`h` = `scrollHeight`。\n\n';
  s += '| 页面 | 视口 | new artW | new lineW | new ch | new h | b0 artW | b0 lineW | b0 ch | b0 h | old artW | old lineW | old ch | old h |\n';
  s += '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const p of PAGES) {
    for (const v of ['1440', '1025', '1024']) {
      const c = (b) => { const r = get(b, v, p); return [r.articleClientW, r.prose ? r.prose.lineWGlobal : 'n/a', r.prose ? r.prose.chLineGlobal : 'n/a', r.pageHeight]; };
      const a = c('new'); const bb = c('b0'); const o = c('old');
      s += '| ' + p + ' | ' + v + ' | ' + [...a, ...bb, ...o].join(' | ') + ' |\n';
    }
  }

  s += '\n### A.2 new 全表（10 视口 × 6 页）：`lineW / chLine / artW / pageHeight`\n\n';
  s += '| vp | ' + PAGES.join(' | ') + ' |\n|' + '---|'.repeat(PAGES.length + 1) + '\n';
  for (const v of VPS) {
    s += '| ' + v + ' | ' + PAGES.map((p) => {
      const r = get('new', v, p);
      if (!r.prose) return 'n/a（无 article）';
      return r.prose.lineWGlobal + ' / ' + r.prose.chLineGlobal + ' / ' + r.articleClientW + ' / ' + r.pageHeight;
    }).join(' | ') + ' |\n';
  }

  s += '\n### A.3 三方对拍：`/paper/dev/dialogs/`（关键页，全 10 视口）\n\n';
  s += '`artW / lineW / ch / h / TOC 形态 / 代码横滚 overflow-of-blocks / 表格横滚`\n\n';
  s += '| vp | new | b0 | old |\n|---|---|---|---|\n';
  for (const v of VPS) {
    s += '| ' + v + ' | ' + BUILDS.map((b) => {
      const r = get(b, v, 'dialogs');
      return [r.articleClientW, r.prose && r.prose.lineWGlobal, r.prose && r.prose.chLineGlobal, r.pageHeight, r.tocMode,
        r.code && (r.code.overflow + '/' + r.code.blocks), r.tables && (r.tables.overflow + '/' + r.tables.blocks)].join(' / ');
    }).join(' | ') + ' |\n';
  }

  s += '\n### A.4 代码块横滚 `overflow/blocks` 与表格横滚（new；old 对照列）\n\n';
  s += '| vp | ' + PAGES.join(' | ') + ' | old dialogs | old worldcfg | old tuning |\n';
  s += '|' + '---|'.repeat(PAGES.length + 4) + '\n';
  for (const v of VPS) {
    const cell = (p) => { const r = get('new', v, p); return r.code ? r.code.overflow + '/' + r.code.blocks : 'n/a'; };
    const oldc = (p) => { const r = get('old', v, p); return r.code ? r.code.overflow + '/' + r.code.blocks : 'n/a'; };
    s += '| ' + v + ' | ' + PAGES.map(cell).join(' | ') + ' | ' + ['dialogs', 'worldcfg', 'tuning'].map(oldc).join(' | ') + ' |\n';
  }
  s += '\n表格：new 的 `.table-wrap` 横滚数（`overflow/blocks`）\n\n';
  s += '| vp | ' + PAGES.join(' | ') + ' |\n|' + '---|'.repeat(PAGES.length + 1) + '\n';
  for (const v of VPS) {
    s += '| ' + v + ' | ' + PAGES.map((p) => { const r = get('new', v, p); return r.tables ? r.tables.overflow + '/' + r.tables.blocks : 'n/a'; }).join(' | ') + ' |\n';
  }

  s += '\n### A.5 布局列与 TOC 形态（new，dialogs）\n\n| vp | grid-template-columns | TOC | article.x | article.w |\n|---|---|---|---|---|\n';
  for (const v of VPS) {
    const r = get('new', v, 'dialogs');
    s += '| ' + v + ' | `' + r.layoutCols + '` | ' + r.tocMode + (r.toc ? '（w=' + r.toc.w + '）' : '') + ' | ' + (r.article ? r.article.x : 'n/a') + ' | ' + (r.article ? r.article.w : 'n/a') + ' |\n';
  }

  s += '\n### A.6 横向溢出（`docScrollW > docClientW + 1`）\n\n';
  for (const b of BUILDS) {
    const bad = rows.filter((r) => r.build === b && r.docScrollW > r.docClientW + 1);
    s += '- **' + b + '**：' + bad.length + ' / ' + rows.filter((r) => r.build === b).length + ' 格' + (bad.length ? ' → ' + bad.map((r) => '`' + r.vp + '/' + r.page + '` +' + (r.docScrollW - r.docClientW) + 'px').join('、') : '（无）') + '\n';
  }
  w('secA.md', s);
}
