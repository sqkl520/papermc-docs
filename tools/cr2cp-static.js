'use strict';
/**
 * cr2cp-static.js — 内容页导航静态审计（只读已构建 HTML，不跑 build）。
 * 输出：<tmpdir>/cr2cp/static.json + 终端摘要
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cr2cp');
fs.mkdirSync(OUT, { recursive: true });

const SECTIONS = ['paper', 'velocity', 'folia'];

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'source' || e.name === 'markdown' || e.name === 'snapshot') continue;
      walk(p, acc);
    } else if (e.name === 'index.html') acc.push(p);
  }
  return acc;
}

const files = [];
for (const s of SECTIONS) {
  const d = path.join(ROOT, s);
  if (fs.existsSync(d)) walk(d, files);
}

const rows = [];
for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const html = fs.readFileSync(abs, 'utf8');
  const $ = cheerio.load(html);
  const article = $('article.article').first();
  if (!article.length) continue;

  // 标题序列（正文内 h1-h6，含外壳 h1）
  const headingEls = $('h1,h2,h3,h4,h5,h6').filter((i, el) => {
    // 排除侧栏/抽屉/目录里的伪标题
    return $(el).parents('.sidebar,.toc-side,.topbar,.page-footer').length === 0;
  });
  const levels = headingEls.map((i, el) => Number(el.tagName.slice(1))).get();
  const counts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  levels.forEach((l) => { counts['h' + l] += 1; });

  // 跳级：相邻标题层级差 > 1（忽略 h1 -> h2 正常推进）
  const skips = [];
  for (let i = 1; i < levels.length; i++) {
    const d = levels[i] - levels[i - 1];
    if (d > 1) skips.push({ from: 'h' + levels[i - 1], to: 'h' + levels[i], text: $(headingEls[i]).text().replace(/#$/, '').trim().slice(0, 40) });
  }

  // TOC
  const tocLis = $('.toc-side ol > li');
  const tocLevels = tocLis.map((i, el) => {
    const cls = $(el).attr('class') || '';
    const m = /lvl-(\d)/.exec(cls);
    return m ? Number(m[1]) : null;
  }).get().filter(Boolean);
  const tocCount = tocLis.length;

  // 面包屑
  const crumbNav = $('nav.crumbs').first();
  const crumbLinks = crumbNav.find('a').length;
  const crumbItems = crumbNav.length ? crumbNav.children('a,span').filter((i, el) => {
    const t = $(el).text().trim();
    return t && t !== '/';
  }).length : 0;
  const crumbText = crumbNav.length ? crumbNav.text().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim() : '';

  // 翻页
  const pager = $('nav.pager').first();
  const pagerPrev = pager.find('a.prev').attr('href') || null;
  const pagerNext = pager.find('a.next').attr('href') || null;

  // 侧栏
  const sideLinks = $('.sidebar a[href]').length;
  const sideActive = $('.sidebar a.active, .sidebar a[aria-current="page"]').length;

  // 抽屉内目录
  const drawerToc = $('[data-drawer-toc]').length;

  // scroll spy 候选：TOC 链接数
  const tocAnchors = $('.toc-side a[href^="#"]').length;

  rows.push({
    rel,
    h1: counts.h1, h2: counts.h2, h3: counts.h3, h4: counts.h4, h5: counts.h5, h6: counts.h6,
    headingsTotal: levels.length,
    h2to4: counts.h2 + counts.h3 + counts.h4,
    skips: skips.slice(0, 6),
    skipCount: skips.length,
    tocCount,
    tocLevels: [...new Set(tocLevels)].sort(),
    tocMatchesH2to4: tocCount === (counts.h2 + counts.h3 + counts.h4),
    crumb: !!crumbNav.length,
    crumbItems,
    crumbText,
    pagerPrev, pagerNext,
    hasPager: !!pager.length,
    sideLinks, sideActive, drawerToc, tocAnchors,
    contentChars: article.text().replace(/\s+/g, ' ').trim().length,
  });
}

const contentPages = rows.length;
const noH2 = rows.filter((r) => r.h2 === 0);
const skipPages = rows.filter((r) => r.skipCount > 0);
const noToc = rows.filter((r) => r.tocCount === 0);
const tocMismatch = rows.filter((r) => !r.tocMatchesH2to4);
const noCrumb = rows.filter((r) => !r.crumb);
const noPager = rows.filter((r) => !r.hasPager);
const noSideActive = rows.filter((r) => r.sideActive === 0);
const h5Pages = rows.filter((r) => r.h5 > 0);
const h6Pages = rows.filter((r) => r.h6 > 0);

// 跳级分布
const skipDist = {};
rows.forEach((r) => {
  (r.skips || []).forEach((s) => {
    const k = s.from + '->' + s.to;
    skipDist[k] = (skipDist[k] || 0) + 1;
  });
});

const summary = {
  contentPages,
  noH2Count: noH2.length,
  noH2Sample: noH2.slice(0, 10).map((r) => r.rel + ' (h:' + [r.h2, r.h3, r.h4, r.h5, r.h6].join('/') + ')'),
  skipPageCount: skipPages.length,
  skipPagePct: +(skipPages.length / contentPages * 100).toFixed(1),
  skipDist,
  noTocCount: noToc.length,
  tocMismatchCount: tocMismatch.length,
  tocMismatchSample: tocMismatch.slice(0, 10).map((r) => r.rel + ' toc=' + r.tocCount + ' h2-4=' + r.h2to4),
  noCrumbCount: noCrumb.length,
  noPagerCount: noPager.length,
  noSideActiveCount: noSideActive.length,
  h5Pages: h5Pages.length,
  h6Pages: h6Pages.length,
  h5InToc: 0, // 由 tocLevels 判定
  tocLevelSet: [...new Set(rows.flatMap((r) => r.tocLevels))].sort(),
  avgSideLinks: Math.round(rows.reduce((n, r) => n + r.sideLinks, 0) / contentPages),
  maxSideLinks: rows.reduce((m, r) => Math.max(m, r.sideLinks), 0),
  minSideLinks: rows.reduce((m, r) => Math.min(m, r.sideLinks), 1e9),
  drawerTocPages: rows.filter((r) => r.drawerToc > 0).length,
  totalHeadings: rows.reduce((n, r) => n + r.headingsTotal, 0),
  totalTocEntries: rows.reduce((n, r) => n + r.tocCount, 0),
};

const dump = { summary, rows };
fs.writeFileSync(path.join(OUT, 'static.json'), JSON.stringify(dump, null, 1), 'utf8');

const p = (k, v) => console.log(String(k).padEnd(34) + ' ' + v);
console.log('=== cr2cp static (内容页导航结构) ===');
p('内容页数', summary.contentPages);
p('无 h2 的页', summary.noH2Count);
p('标题跳级页数', summary.skipPageCount + ' (' + summary.skipPagePct + '%)');
p('跳级形态分布', JSON.stringify(summary.skipDist));
p('无 TOC 页', summary.noTocCount);
p('TOC 条目 != h2-h4 的页', summary.tocMismatchCount);
p('无面包屑页', summary.noCrumbCount);
p('无 pager 页', summary.noPagerCount);
p('侧栏无高亮页', summary.noSideActiveCount);
p('有 h5 的页 / h6', summary.h5Pages + ' / ' + summary.h6Pages);
p('TOC 收录层级集合', JSON.stringify(summary.tocLevelSet));
p('侧栏链接 avg/max/min', summary.avgSideLinks + ' / ' + summary.maxSideLinks + ' / ' + summary.minSideLinks);
p('抽屉内目录页数', summary.drawerTocPages);
p('总标题 / 总 TOC 条目', summary.totalHeadings + ' / ' + summary.totalTocEntries);
console.log('\n-- 无 h2 样例 --'); summary.noH2Sample.forEach((s) => console.log('  ' + s));
console.log('-- TOC 不一致样例 --'); summary.tocMismatchSample.forEach((s) => console.log('  ' + s));
console.log('\nJSON -> ' + path.join(OUT, 'static.json'));
