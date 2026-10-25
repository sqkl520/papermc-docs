'use strict';
/**
 * b2b2-b.js — B 组：断崖曲线（批 3 核心）
 *
 * 主曲线：1200→1300 逐 1px（101 点）测 /paper/dev/dialogs/ 的 article.clientWidth + 正文行盒宽，
 *        new / b0 / old 各一条；叠加「TOC 断点改到 1200 / 1280」的注入模拟曲线。
 * 补测：1015→1035 邻域逐 1px（1024↔1025 是否仍在）、old 1195→1205。
 *
 * 模拟手法：不改原 @media，而在样式表末尾追加**同特异度、后出现**的规则靠层叠顺序取胜——
 *   把「≥1025 常驻右栏」搬到 ≥bp，并在 1025..bp-0.02 区间退回单栏、隐藏 .toc-side。
 *
 * 用法：node tools/b2b2-b.js
 * 产出：TMPDIR\b2b2\b.json
 */
const L = require('./b2b2-lib');

const PAGE = '/paper/dev/dialogs/';

const SWEEPS = [
  { id: 'new-1200-1300', build: 'new', from: 1200, to: 1300, sim: 0 },
  { id: 'b0-1200-1300', build: 'b0', from: 1200, to: 1300, sim: 0 },
  { id: 'old-1200-1300', build: 'old', from: 1200, to: 1300, sim: 0 },
  { id: 'new-1200-1300-sim1200', build: 'new', from: 1200, to: 1300, sim: 1200 },
  { id: 'new-1200-1300-sim1280', build: 'new', from: 1200, to: 1300, sim: 1280 },
  { id: 'new-1015-1035', build: 'new', from: 1015, to: 1035, sim: 0 },
  { id: 'b0-1015-1035', build: 'b0', from: 1015, to: 1035, sim: 0 },
  { id: 'old-1015-1035', build: 'old', from: 1015, to: 1035, sim: 0 },
  { id: 'old-1195-1205', build: 'old', from: 1195, to: 1205, sim: 0 },
];

const SIM_CSS = (bp) => `
@media (min-width:1025px) and (max-width:${(bp - 0.02).toFixed(2)}px){
  .layout{grid-template-columns:280px minmax(0,1fr)!important}
  .layout.has-toc{grid-template-columns:280px minmax(0,1fr)!important}
  .toc-side{display:none!important}
}
@media (min-width:${bp}px){
  .layout{grid-template-columns:290px minmax(0,1fr)!important}
  .layout.has-toc{grid-template-columns:290px minmax(0,1fr) 250px!important}
  .toc-side{order:0;display:block!important;position:sticky;top:var(--topbar-h);
    max-height:calc(100vh - var(--topbar-h));overflow-y:auto;padding:1rem .9rem 2rem;
    border:0;border-left:1px solid var(--border);border-radius:0;background:transparent;
    font-size:.82rem;margin:0}
}
`;

const POINT_FN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const art = q('article.article') || q('article');
  const toc = q('.toc-side');
  const lay = q('.layout');
  const ab = art ? art.getBoundingClientRect() : null;
  const tb = toc ? toc.getBoundingClientRect() : null;

  // 正文全局最长行盒（与 A 组同口径）+ '0' advance
  let lineW = null;
  if (art) {
    const isProse = (el) => {
      if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
      return (el.textContent || '').trim().length >= 40;
    };
    const paras = [...art.querySelectorAll('p')].filter(isProse);
    let mx = 0;
    let zeroW = null;
    for (const p of paras) {
      const rg = document.createRange();
      rg.selectNodeContents(p);
      const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
      for (const r of rects) if (r.width > mx) mx = r.width;
      if (zeroW == null) {
        const st = getComputedStyle(p);
        const cv = document.createElement('canvas').getContext('2d');
        cv.font = st.fontSize + ' ' + st.fontFamily;
        zeroW = cv.measureText('0').width;
      }
    }
    lineW = mx > 0 ? mx : null;
    if (lineW != null && zeroW) {
      lineW = { w: r2(lineW), ch: Math.round(lineW / zeroW), zeroW: r2(zeroW) };
    } else lineW = null;
  }

  let tocMode = 'hidden';
  if (tb && toc && getComputedStyle(toc).display !== 'none' && tb.width > 0) {
    tocMode = (tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2) ? 'rail' : 'top-block';
  }
  return {
    vw: window.innerWidth,
    artClientW: art ? art.clientWidth : null,
    artW: ab ? r2(ab.width) : null,
    artX: ab ? r2(ab.x) : null,
    line: lineW,
    contentW: (() => { const c = q('main.content') || q('.content'); return c ? r2(c.getBoundingClientRect().width) : null; })(),
    cols: lay ? getComputedStyle(lay).gridTemplateColumns : null,
    tocW: tb ? r2(tb.width) : null,
    tocMode,
    pageH: document.documentElement.scrollHeight,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
};

(async () => {
  const browser = await L.launch();
  const all = [];
  try {
    for (const sw of SWEEPS) {
      const ctx = await L.makeContext(browser, sw.build, { width: sw.from, height: 900 });
      const page = await ctx.newPage();
      await page.goto(L.baseUrl(sw.build) + PAGE, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(200);
      if (sw.sim) await page.addStyleTag({ content: SIM_CSS(sw.sim) });
      const pts = [];
      for (let w2 = sw.from; w2 <= sw.to; w2++) {
        await page.setViewportSize({ width: w2, height: 900 });
        pts.push(await page.evaluate(POINT_FN));
      }
      // 相邻 1px 的 |Δarticle.clientWidth| 最大者
      let maxD = 0; let at = null;
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i].artClientW - pts[i - 1].artClientW;
        if (Math.abs(d) > Math.abs(maxD)) {
          maxD = d;
          at = { from: pts[i - 1].vw, to: pts[i].vw, before: pts[i - 1].artClientW, after: pts[i].artClientW };
        }
      }
      all.push({ id: sw.id, build: sw.build, from: sw.from, to: sw.to, sim: sw.sim, points: pts, maxDelta: { d: maxD, at } });
      L.log({ sweep: sw.id, n: pts.length, first: pts[0].artClientW, last: pts[pts.length - 1].artClientW, maxDelta: maxD, at });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('b.json', all));
})();
