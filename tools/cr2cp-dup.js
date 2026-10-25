'use strict';
/**
 * cr2cp-dup.js — 重复控件普查：同一动作在页面上出现几次（查看原文 / 页面源 / 主题 / 目录 / 全部页面）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cr2cp');
const pages = ['paper/dev/dialogs/index.html', 'paper/reference/world-configuration/index.html', 'velocity/tuning/index.html'];

const rows = [];
for (const rel of pages) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const $ = cheerio.load(fs.readFileSync(abs, 'utf8'));
  const count = (sel) => $(sel).length;
  rows.push({
    rel,
    external: count('a.external, a[target="_blank"]'),
    sourceMarkdown: count('a.page-source, a[href*="/source/"]'),
    themeToggle: count('#theme-toggle'),
    searchTrigger: count('[data-open-search]'),
    tocHosts: count('[data-page-toc]'),
    tocAsides: count('.toc-side'),
    drawerToc: count('[data-drawer-toc]'),
    allPages: count('a[href*="all-pages"]'),
    sidebar: count('.sidebar'),
    chips: count('.page-meta .chip, .page-head .chip'),
    chipTexts: $('.page-meta .chip, .page-head .chip').map((i, e) => $(e).text().replace(/\s+/g, ' ').trim()).get(),
    metaTexts: $('.page-meta').text().replace(/\s+/g, ' ').trim(),
    // 「查看原文」出现在几个位置
    viewOriginalInTopbar: $('.topbar').text().indexOf('查看原文') >= 0,
    viewOriginalInMeta: $('.page-meta').text().indexOf('查看原文') >= 0,
    viewOriginalInFooter: $('.page-footer').text().indexOf('来源 URL') >= 0,
    footerLinks: count('.page-footer a'),
    sideHomeLinks: count('.sidebar .side-home'),
    sideCatLinks: count('.sidebar .side-cat a'),
    sideTags: count('.sidebar .tag'),
    totalLinks: count('a[href]'),
  });
}

// TOC 条数与标题数一致性 + 每页 TOC 占视口
fs.writeFileSync(path.join(OUT, 'dup.json'), JSON.stringify(rows, null, 1), 'utf8');
const L = (s) => console.log(s);
L('rel'.padEnd(48) + ' ext  srcMd theme srch tocH tocA drwToc allPg chips foot 侧栏tag 总链接');
rows.forEach((r) => L(r.rel.padEnd(48) + String(r.external).padStart(4) + String(r.sourceMarkdown).padStart(7) + String(r.themeToggle).padStart(6) + String(r.searchTrigger).padStart(5) + String(r.tocHosts).padStart(5) + String(r.tocAsides).padStart(5) + String(r.drawerToc).padStart(7) + String(r.allPages).padStart(6) + String(r.chips).padStart(6) + String(r.footerLinks).padStart(5) + String(r.sideTags).padStart(8) + String(r.totalLinks).padStart(8)));
L('');
rows.forEach((r) => {
  L(r.rel);
  L('  chips: ' + JSON.stringify(r.chipTexts));
  L('  meta : ' + r.metaTexts);
  L('  查看原文 in topbar/meta: ' + r.viewOriginalInTopbar + '/' + r.viewOriginalInMeta + '  源URL in footer: ' + r.viewOriginalInFooter);
  L('  侧栏组首页链接: ' + r.sideHomeLinks + '  自定义分类链接: ' + r.sideCatLinks + '  侧栏徽标: ' + r.sideTags);
});
L('\nJSON -> ' + path.join(OUT, 'dup.json'));
