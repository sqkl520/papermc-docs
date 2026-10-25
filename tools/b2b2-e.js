'use strict';
/**
 * b2b2-e.js — E 组：40rem 方案实际效果预演（批 2 核心）
 *
 * 注入 `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}`，
 * 在 1440 / 1280 / 1200 / 1025 下测：
 *   正文行宽（px 与字符数，canvas 实测 '0' advance）｜代码块横滚数（关键判据）｜
 *   左边缘是否对齐（段落 x vs 代码块 x vs 表格 x）｜pageHeight（预期大幅增加，逐页给数值）
 *
 * 另测 4 个候选值（38 / 40 / 42 / 44rem）以便规划取参。
 * 40rem = 40 × 根字号；本页根字号未缩放时 = 640px。
 *
 * 用法：node tools/b2b2-e.js
 * 产出：%TEMP%\b2b2\e.json
 */
const L = require('./b2b2-lib');

const VPS = [1440, 1280, 1200, 1025];
const PAGES = [
  { name: 'dialogs', url: '/paper/dev/dialogs/' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/' },
  { name: 'tuning', url: '/velocity/tuning/' },
  { name: 'paper', url: '/paper/' },
];

const SIM = (rem) => `.article > :is(p,ul,ol,blockquote,dl){max-width:${rem}rem}`;

const MEASURE = (rem) => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const article = q('article.article') || q('article');
  const rootFS = parseFloat(getComputedStyle(document.documentElement).fontSize);

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = article ? [...article.querySelectorAll('p')].filter(isProse) : [];

  let maxLine = 0; let zeroW = null; let firstLeft = null; let lastLeft = null;
  for (const p of paras) {
    const st = getComputedStyle(p);
    if (zeroW == null) {
      const cv = document.createElement('canvas').getContext('2d');
      cv.font = st.fontSize + ' ' + st.fontFamily;
      zeroW = cv.measureText('0').width;
    }
    const rg = document.createRange();
    rg.selectNodeContents(p);
    for (const r of rg.getClientRects()) if (r.width > maxLine) maxLine = r.width;
    const l = p.getBoundingClientRect().left;
    if (firstLeft == null) firstLeft = l;
    lastLeft = l;
  }

  // 段落/列表/引用 的左右边缘（用于判断是否真的被限宽、左边缘是否对齐）
  const blocks = article ? [...article.children] : [];
  const limEdges = [];
  for (const b of blocks) {
    const tag = b.tagName.toLowerCase();
    if (!['p', 'ul', 'ol', 'blockquote', 'dl'].includes(tag)) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 2) continue;
    limEdges.push({ tag, x: r2(r.x), w: r2(r.width), right: r2(r.right) });
  }
  const uniqLeft = [...new Set(limEdges.map((e) => e.x))].sort((a, b) => a - b);
  const maxBlockW = limEdges.length ? Math.max(...limEdges.map((e) => e.w)) : null;

  // 代码块 / 表格 的横向位置（判断与正文左边缘是否对齐；代码块不应被限宽）
  const pre = q('pre.code-pre');
  const preScroller = pre ? (pre.closest('.code-scroll') || pre) : null;
  const preBox = preScroller ? preScroller.getBoundingClientRect() : null;
  const tw = q('.table-wrap');
  const twBox = tw ? tw.getBoundingClientRect() : null;

  const pres = [...document.querySelectorAll('pre.code-pre')];
  const codeOverflow = pres.filter((p) => { const sc = p.closest('.code-scroll') || p; return sc.scrollWidth > sc.clientWidth + 1; }).length;
  const wrappers = [...document.querySelectorAll('.table-wrap')];
  const tableOverflow = wrappers.filter((w) => w.scrollWidth > w.clientWidth + 1).length;

  return {
    rem,
    rootFS: r2(rootFS),
    limitPx: rem ? r2(rem * rootFS) : null,
    artClientW: article ? article.clientWidth : null,
    maxLine: maxLine > 0 ? r2(maxLine) : null,
    chLine: maxLine > 0 && zeroW ? Math.round(maxLine / zeroW) : null,
    zeroW: zeroW ? r2(zeroW) : null,
    firstLeft: r2(firstLeft),
    maxBlockW: r2(maxBlockW),
    uniqLeftCount: uniqLeft.length,
    uniqLeft: uniqLeft.slice(0, 6),
    preX: preBox ? r2(preBox.x) : null,
    preW: preBox ? r2(preBox.width) : null,
    preScrollW: preScroller ? preScroller.scrollWidth : null,
    preClientW: preScroller ? preScroller.clientWidth : null,
    tableX: twBox ? r2(twBox.x) : null,
    tableW: twBox ? r2(twBox.width) : null,
    code: { blocks: pres.length, overflow: codeOverflow },
    tables: { blocks: wrappers.length, overflow: tableOverflow },
    pageHeight: document.documentElement.scrollHeight,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
};

const VARIANTS = [null, 38, 40, 42, 44]; // null = 基线

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    const ctx = await L.makeContext(browser, 'new', { width: 1440, height: 900 });
    const page = await ctx.newPage();
    for (const vp of VPS) {
      await page.setViewportSize({ width: vp, height: 900 });
      for (const pg of PAGES) {
        for (const rem of VARIANTS) {
          // 每次都重载，避免 addStyleTag 累积
          await page.goto(L.baseUrl('new') + pg.url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(120);
          if (rem) await page.addStyleTag({ content: SIM(rem) });
          await page.waitForTimeout(60);
          const m = await page.evaluate(MEASURE, rem);
          out.push({ vp, page: pg.name, ...m });
          L.log({
            vp, pg: pg.name, rem: rem || 'base',
            lineW: m.maxLine, ch: m.chLine, blockW: m.maxBlockW,
            lefts: m.uniqLeftCount, preX: m.preX, preW: m.preW,
            codeOv: m.code.overflow + '/' + m.code.blocks, tblOv: m.tables.overflow + '/' + m.tables.blocks,
            h: m.pageHeight,
          });
        }
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('e.json', out));
})();
