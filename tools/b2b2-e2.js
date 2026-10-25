'use strict';
/**
 * b2b2-e2.js — E 组补测：40rem 的两种选择器写法 + worldcfg 的 ul 嵌套结构
 *
 * 起因（实测发现的覆盖盲区）：
 *   任务书写法 `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}` 是**直接子元素**选择器。
 *   - dialogs@1440：43 个正文档落里有 5 个嵌在容器内（maxNested=797.75），全局最长行仍 797.75，
 *     而不是 640 ⇒ 限宽"看起来生效但最长行没到 640"。
 *   - worldcfg：正文档落 31 个，**全部**嵌在 `<ul>` 里（29 个）+ `aside.alert` 里（2 个），
 *     直接子 p 为 0 ⇒ 该页 40rem 几乎完全失效。
 * 本脚本对比：
 *   A = `.article > :is(...)`（任务书写法，直接子元素）
 *   B = `.article :is(p,ul,ol,blockquote,dl)`（后代，覆盖嵌套）
 *   C = B + `.article > ul{max-width:...}`（保证 worldcfg 的 ul 容器本身被限宽）
 *
 * 用法：node tools/b2b2-e2.js
 * 产出：%TEMP%\b2b2\e2.json
 */
const L = require('./b2b2-lib');

const VPS = [1440, 1280, 1200, 1025];
const PAGES = [
  { name: 'dialogs', url: '/paper/dev/dialogs/' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/' },
  { name: 'tuning', url: '/velocity/tuning/' },
  { name: 'paper', url: '/paper/' },
  { name: 'particles', url: '/paper/dev/particles/' },
];

const REM = 40;
const SIMS = [
  { id: 'base', css: null },
  { id: 'A-direct', css: `.article > :is(p,ul,ol,blockquote,dl){max-width:${REM}rem}` },
  { id: 'B-desc', css: `.article :is(p,ul,ol,blockquote,dl){max-width:${REM}rem}` },
  { id: 'C-desc-ul', css: `.article :is(p,ul,ol,blockquote,dl){max-width:${REM}rem}\n.article > ul,.article > ol{max-width:${REM}rem}` },
];

const MEASURE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const article = document.querySelector('article.article') || document.querySelector('article');
  if (!article) return { error: 'no article' };
  const rootFS = parseFloat(getComputedStyle(document.documentElement).fontSize);

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const directChildOf = (el) => { let c = el; while (c && c.parentElement !== article) c = c.parentElement; return c; };

  let maxLine = 0; let zeroW = null;
  let cappedLines = 0; let uncappedLines = 0;
  let maxLineCapped = 0; let maxLineUncapped = 0;
  const paras = [...article.querySelectorAll('p')].filter(isProse);
  for (const p of paras) {
    const st = getComputedStyle(p);
    if (zeroW == null) {
      const cv = document.createElement('canvas').getContext('2d');
      cv.font = st.fontSize + ' ' + st.fontFamily;
      zeroW = cv.measureText('0').width;
    }
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    const lw = rects.length ? Math.max(...rects.map((r) => r.width)) : 0;
    if (lw > maxLine) maxLine = lw;
    // 「是否被限宽」：以 40rem×根字号 + 2px 容差判定
    const limit = 40 * rootFS;
    if (lw <= limit + 2) { cappedLines += rects.length; if (lw > maxLineCapped) maxLineCapped = lw; }
    else { uncappedLines += rects.length; if (lw > maxLineUncapped) maxLineUncapped = lw; }
  }

  // 代码块位置（判断是否被正文限宽连带影响）
  const pre = document.querySelector('pre.code-pre');
  const sc = pre ? (pre.closest('.code-scroll') || pre) : null;
  const pb = sc ? sc.getBoundingClientRect() : null;
  const pres = [...document.querySelectorAll('pre.code-pre')];
  const codeOverflow = pres.filter((p) => { const s2 = p.closest('.code-scroll') || p; return s2.scrollWidth > s2.clientWidth + 1; }).length;

  const wrappers = [...document.querySelectorAll('.table-wrap')];
  const tableOverflow = wrappers.filter((w) => w.scrollWidth > w.clientWidth + 1).length;

  return {
    rootFS: r2(rootFS),
    artClientW: article.clientWidth,
    maxLine: r2(maxLine),
    chLine: zeroW ? Math.round(maxLine / zeroW) : null,
    zeroW: zeroW ? r2(zeroW) : null,
    maxLineUncapped: r2(maxLineUncapped),
    uncappedLines, cappedLines,
    preX: pb ? r2(pb.x) : null,
    preW: pb ? r2(pb.width) : null,
    code: { blocks: pres.length, overflow: codeOverflow },
    tables: { blocks: wrappers.length, overflow: tableOverflow },
    pageHeight: document.documentElement.scrollHeight,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
};

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    const ctx = await L.makeContext(browser, 'new', { width: 1440, height: 900 });
    const page = await ctx.newPage();
    for (const vp of VPS) {
      await page.setViewportSize({ width: vp, height: 900 });
      for (const pg of PAGES) {
        for (const sim of SIMS) {
          await page.goto(L.baseUrl('new') + pg.url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(120);
          if (sim.css) await page.addStyleTag({ content: sim.css });
          await page.waitForTimeout(60);
          const m = await page.evaluate(MEASURE);
          out.push({ vp, page: pg.name, sim: sim.id, ...m });
          L.log({
            vp, pg: pg.name, sim: sim.id,
            lineW: m.maxLine, ch: m.chLine,
            uncappedLines: m.uncappedLines, cappedLines: m.cappedLines,
            codeOv: m.code.overflow + '/' + m.code.blocks,
            tblOv: m.tables.overflow + '/' + m.tables.blocks,
            h: m.pageHeight,
          });
        }
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('e2.json', out));
})();
