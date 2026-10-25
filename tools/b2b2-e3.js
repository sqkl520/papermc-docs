'use strict';
/**
 * b2b2-e3.js — E 组补测 2：只限 <p>（叶节点）vs 限容器，验证「代码块是否被连带压窄」
 *
 * 实测发现（e2.json）：worldcfg 的代码块嵌在 `<ul>` 内，
 * 限宽 `ul` 会把代码块滚动容器从 874.81px 压到 566px —— 这是 40rem 方案的**回归风险**。
 * 本脚本对比 4 种写法，给规划提供「既不压窄代码块、又能限住正文行宽」的写法。
 *
 *   P      = `.article p{max-width:40rem}`                        （只限叶段落，后代选择器）
 *   P-li   = P + `.article li>p{max-width:none}`                   （列表项内的段落不限，避免挤压列表）
 *   D      = `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}`（任务书原写法）
 *   DESC   = `.article :is(p,ul,ol,blockquote,dl){max-width:40rem}`  （后代全限，含容器）
 *
 * 用法：node tools/b2b2-e3.js
 * 产出：%TEMP%\b2b2\e3.json
 */
const L = require('./b2b2-lib');

const VPS = [1440, 1280, 1025];
const PAGES = [
  { name: 'dialogs', url: '/paper/dev/dialogs/' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/' },
  { name: 'particles', url: '/paper/dev/particles/' },
  { name: 'tuning', url: '/velocity/tuning/' },
];

const REM = 40;
const SIMS = [
  { id: 'base', css: null },
  { id: 'P', css: `.article p{max-width:${REM}rem}` },
  { id: 'P-li', css: `.article p{max-width:${REM}rem}\n.article li>p{max-width:none}` },
  { id: 'D', css: `.article > :is(p,ul,ol,blockquote,dl){max-width:${REM}rem}` },
  { id: 'DESC', css: `.article :is(p,ul,ol,blockquote,dl){max-width:${REM}rem}` },
];

const MEASURE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const article = document.querySelector('article.article') || document.querySelector('article');
  if (!article) return { error: 'no article' };
  const rootFS = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const limit = 40 * rootFS;

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };

  let maxLine = 0; let zeroW = null; let uncapped = 0; let capped = 0;
  for (const p of [...article.querySelectorAll('p')].filter(isProse)) {
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
    if (lw <= limit + 2) capped += rects.length; else uncapped += rects.length;
  }

  const scrollers = [...document.querySelectorAll('pre.code-pre')].map((p) => p.closest('.code-scroll') || p);
  const widths = scrollers.map((s) => r2(s.getBoundingClientRect().width));
  const overflow = scrollers.filter((s) => s.scrollWidth > s.clientWidth + 1).length;
  const tables = [...document.querySelectorAll('.table-wrap')];
  const tblW = tables.map((t) => r2(t.getBoundingClientRect().width));

  return {
    artClientW: article.clientWidth,
    maxLine: r2(maxLine),
    chLine: zeroW ? Math.round(maxLine / zeroW) : null,
    uncappedLines: uncapped, cappedLines: capped,
    codeBlocks: scrollers.length,
    codeOverflow: overflow,
    codeMinW: widths.length ? Math.min(...widths) : null,
    codeMaxW: widths.length ? Math.max(...widths) : null,
    tableBlocks: tables.length,
    tableMaxW: tblW.length ? Math.max(...tblW) : null,
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
            vp, pg: pg.name, sim: sim.id, lineW: m.maxLine, ch: m.chLine,
            uncap: m.uncappedLines, codeW: m.codeMinW + '~' + m.codeMaxW, codeOv: m.codeOverflow + '/' + m.codeBlocks,
            tblW: m.tableMaxW, h: m.pageHeight,
          });
        }
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('e3.json', out));
})();
