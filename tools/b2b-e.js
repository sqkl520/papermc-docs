'use strict';
/**
 * b2b-e.js — E 组：40rem 方案实际效果预演（批 2 核心）
 *
 * 注入 `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}`（注意：**只封行文块**，
 * 不给整个 .article 限宽——那样代码块会被一起勒窄，横滚数会变差）。
 * 在 1440 / 1280 / 1200 三档，测注入前后的：
 *   - 正文行宽（px + 字符数，canvas 实测 '0' advance）
 *   - 代码块横滚数量（关键：只封行文块应保持）
 *   - 表格横滚数量
 *   - 左边缘对齐（p.left − article.left）
 *   - pageHeight
 *
 * 另设对照组 sim=article-max：`.article{max-width:40rem}`（整块限宽），用来证明「只封行文块」更优。
 *
 * 用法：node tools/b2b-e.js
 * 产出：TMPDIR\b2b\e.json
 */
const L = require('./b2b-lib');

const VPS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1200', width: 1200, height: 900 },
];
const PAGES = [
  { name: 'dialogs', url: '/paper/dev/dialogs/' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/' },
  { name: 'tuning', url: '/velocity/tuning/' },
  { name: 'particles', url: '/paper/dev/particles/' },
];

const VARIANTS = [
  { id: 'base', css: null },
  { id: 'prose40', css: '.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}' },
  { id: 'prose40-h2', css: '.article > :is(p,ul,ol,blockquote,dl,h2,h3,h4){max-width:40rem}' },
  { id: 'article40', css: '.article{max-width:40rem}' },
  { id: 'prose38', css: '.article > :is(p,ul,ol,blockquote,dl){max-width:38rem}' },
  { id: 'prose44', css: '.article > :is(p,ul,ol,blockquote,dl){max-width:44rem}' },
];

const FN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const article = q('article.article') || q('article');
  if (!article) return { error: 'no article' };
  const ab = article.getBoundingClientRect();

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    if (el.className && /page-meta|page-desc|hero-tag/.test(el.className)) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = [...article.querySelectorAll('p')].filter(isProse);
  if (!paras.length) return { error: 'no prose' };

  const st = getComputedStyle(paras[0]);
  const cv = document.createElement('canvas').getContext('2d');
  cv.font = st.fontSize + ' ' + st.fontFamily;
  const zeroW = cv.measureText('0').width;

  let maxLine = 0, maxCap = 0, capOfFirst = null, leftFirst = null, lines = 0;
  const capSet = new Set();
  for (const p of paras) {
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    if (!rects.length) continue;
    lines += rects.length;
    const lw = Math.max(...rects.map((r) => r.width));
    if (lw > maxLine) maxLine = lw;
    const ps = getComputedStyle(p);
    const pb = p.getBoundingClientRect();
    const cap = pb.width - (parseFloat(ps.paddingLeft) || 0) - (parseFloat(ps.paddingRight) || 0);
    capSet.add(Math.round(cap * 100) / 100);
    if (cap > maxCap) maxCap = cap;
    if (capOfFirst == null) { capOfFirst = r2(cap); leftFirst = r2(pb.left); }
  }

  const pres = [...document.querySelectorAll('pre.code-pre')];
  const codeOverflow = pres.filter((p) => { const sc = p.closest('.code-scroll') || p; return sc.scrollWidth > sc.clientWidth + 1; }).length;
  const wraps = [...document.querySelectorAll('.table-wrap')];
  const tableOverflow = wraps.filter((w) => w.scrollWidth > w.clientWidth + 1).length;

  // 代码块宽度（限宽是否波及代码块）
  const preW = pres.length ? r2(pres[0].getBoundingClientRect().width) : null;
  const preScrollW = pres.length ? pres[0].scrollWidth : null;

  return {
    pageHeight: document.documentElement.scrollHeight,
    articleW: r2(ab.width), articleLeft: r2(ab.left), articleClientW: article.clientWidth,
    proseCapMax: r2(maxCap),
    proseCapFirst: capOfFirst,
    proseCapDistinct: [...capSet].sort((a, b) => a - b).slice(0, 6),
    proseLeft: leftFirst,
    leftGap: leftFirst != null ? r2(leftFirst - ab.left) : null,
    lineW: r2(maxLine),
    lineChaText: r2(maxLine / zeroW),
    chLine: Math.round(maxLine / zeroW),
    chCap: Math.round(maxCap / zeroW),
    chCapFirst: capOfFirst != null ? Math.round(capOfFirst / zeroW) : null,
    zeroW: r2(zeroW),
    lines,
    codeOverflow, codeBlocks: pres.length,
    tableOverflow, tableBlocks: wraps.length,
    preW, preScrollW,
    preOverflowFirst: preScrollW != null && pres.length ? preScrollW > (pres[0].closest('.code-scroll') || pres[0]).clientWidth + 1 : null,
  };
};

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    for (const build of ['new', 'b0', 'old']) {
      const ctx = await L.makeContext(browser, build, { width: 1440, height: 900 });
      const page = await ctx.newPage();
      for (const vp of VPS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const pg of PAGES) {
          for (const v of VARIANTS) {
            await page.goto(L.baseUrl(build) + pg.url, { waitUntil: 'load', timeout: 60000 });
            await page.waitForTimeout(120);
            if (v.css) await page.addStyleTag({ content: v.css });
            await page.waitForTimeout(60);
            const m = await page.evaluate(FN);
            out.push({ build, vp: vp.name, page: pg.name, variant: v.id, css: v.css, ...m });
            L.log({
              b: build, vp: vp.name, pg: pg.name, v: v.id,
              capW: m.proseCapMax, chCap: m.chCap, chCapFirst: m.chCapFirst, lineW: m.lineW,
              code: m.codeOverflow + '/' + m.codeBlocks, tbl: m.tableOverflow + '/' + m.tableBlocks,
              leftGap: m.leftGap, h: m.pageHeight, preW: m.preW, artW: m.articleW,
            });
          }
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('e.json', out));
})();
