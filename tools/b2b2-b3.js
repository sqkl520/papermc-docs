'use strict';
/**
 * b2b2-b3.js — B 组补测 2：断崖的**修法验证**（给规划用）
 *
 * 已证实（b2b2-b.js / b2b2-b2.js）：
 *   现状有**两级台阶**：1023→1024（−279px，`min-width:1024px` 的 280px 侧栏进场、无 TOC）
 *                     + 1024→1025（−259px，`min-width:1025px` 的 250px TOC 进场）。
 *   只把 TOC 断点搬到 1280（sim1280）**并不能消除** 1024 台阶，只是把它变成孤立的一级。
 *   ⇒ 台阶①的根因是「**侧栏断点(1024) 与 TOC 断点(1025) 不重合**」，必须让两者对齐。
 *
 * 本脚本验证 4 个修法：
 *   FixAlign1025 = 侧栏与 TOC 都在 ≥1025 进场（1024 及以下保持单栏）
 *   FixAlign1200 = 侧栏与 TOC 都在 ≥1200 进场
 *   FixAlign1280 = 侧栏与 TOC 都在 ≥1280 进场
 *   FixMax1200   = FixAlign1200 + 去掉 `.content{max-width:1000px}` 的 1280 提前触发（改到 ≥1200）
 *
 * 用法：node tools/b2b2-b3.js
 * 产出：TMPDIR\b2b2\b3.json
 */
const L = require('./b2b2-lib');

const PAGE = '/paper/dev/dialogs/';

/** 统一修法：把「侧栏常驻」与「TOC 常驻」绑到同一个 bp */
const FIX_CSS = (bp) => `
@media (max-width:${(bp - 0.02).toFixed(2)}px){
  .layout{grid-template-columns:minmax(0,1fr)!important}
  .layout.has-toc{grid-template-columns:minmax(0,1fr)!important}
  .toc-side{order:1;display:none!important}
  .sidebar{position:fixed!important;transform:translateX(-102%)!important;width:min(88vw,320px)!important}
  .content{order:2!important}
}
@media (min-width:${bp}px){
  .layout{grid-template-columns:290px minmax(0,1fr)!important}
  .layout.has-toc{grid-template-columns:290px minmax(0,1fr) 250px!important}
  .toc-side{order:0!important;display:block!important;position:sticky!important;top:var(--topbar-h);
    max-height:calc(100vh - var(--topbar-h));overflow-y:auto;padding:1rem .9rem 2rem;
    border:0!important;border-left:1px solid var(--border)!important;border-radius:0!important;
    background:transparent!important;font-size:.82rem;margin:0!important}
  .sidebar{position:sticky!important;transform:none!important;width:auto!important;height:auto!important;
    max-height:calc(100vh - var(--topbar-h));box-shadow:none!important;border-right:1px solid var(--border)!important}
  .content{order:0!important}
}
`;

const FIX_MAX = `
@media (min-width:1200px){ .content{max-width:1000px!important} }
`;

const SWEEPS = [
  { id: 'base-1000-1320', sim: 0, css: null },
  { id: 'FixAlign1025-1000-1320', sim: 1025, css: null },
  { id: 'FixAlign1200-1000-1320', sim: 1200, css: null },
  { id: 'FixAlign1280-1000-1320', sim: 1280, css: null },
  { id: 'FixMax1200-1000-1320', sim: 1200, css: FIX_MAX },
];

const POINT_FN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const art = document.querySelector('article.article') || document.querySelector('article');
  const toc = document.querySelector('.toc-side');
  const lay = document.querySelector('.layout');
  const ab = art ? art.getBoundingClientRect() : null;

  let line = null;
  if (art) {
    const isProse = (el) => {
      if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
      return (el.textContent || '').trim().length >= 40;
    };
    let mx = 0; let zeroW = null;
    for (const p of [...art.querySelectorAll('p')].filter(isProse)) {
      const rg = document.createRange();
      rg.selectNodeContents(p);
      for (const r of rg.getClientRects()) if (r.width > mx) mx = r.width;
      if (zeroW == null) {
        const st = getComputedStyle(p);
        const cv = document.createElement('canvas').getContext('2d');
        cv.font = st.fontSize + ' ' + st.fontFamily;
        zeroW = cv.measureText('0').width;
      }
    }
    if (mx > 0) line = { w: r2(mx), ch: Math.round(mx / zeroW) };
  }

  // 侧栏形态
  const sb = document.querySelector('.sidebar');
  let sbMode = 'none';
  if (sb) {
    const s = sb.getBoundingClientRect();
    const css = getComputedStyle(sb);
    if (css.display === 'none') sbMode = 'none';
    else if (css.position === 'fixed') sbMode = 'drawer';
    else sbMode = 'rail(' + r2(s.width) + ')';
  }
  let tocMode = 'hidden';
  if (toc && getComputedStyle(toc).display !== 'none' && toc.getBoundingClientRect().width > 0) {
    tocMode = (toc.getBoundingClientRect().width < 400 && ab && toc.getBoundingClientRect().x >= ab.x + ab.width - 2) ? 'rail' : 'top-block';
  }

  return {
    vw: window.innerWidth,
    artClientW: art ? art.clientWidth : null,
    artX: ab ? r2(ab.x) : null,
    line,
    cols: lay ? getComputedStyle(lay).gridTemplateColumns : null,
    sbMode, tocMode,
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
      const ctx = await L.makeContext(browser, 'new', { width: 1000, height: 900 });
      const page = await ctx.newPage();
      await page.goto(L.baseUrl('new') + PAGE, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(200);
      if (sw.sim) await page.addStyleTag({ content: FIX_CSS(sw.sim) });
      if (sw.css) await page.addStyleTag({ content: sw.css });
      const pts = [];
      // 1020..1300 逐 1px（跳过 1000-1019 以省时，但仍记录首尾）
      for (const w of [1000, 1010, 1020]) {
        await page.setViewportSize({ width: w, height: 900 });
        pts.push(await page.evaluate(POINT_FN));
      }
      for (let w = 1021; w <= 1300; w++) {
        await page.setViewportSize({ width: w, height: 900 });
        pts.push(await page.evaluate(POINT_FN));
      }
      // 找所有 |Δ| ≥ 20px 的台阶
      const steps = [];
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i].artClientW - pts[i - 1].artClientW;
        if (Math.abs(d) >= 20) steps.push({ from: pts[i - 1].vw, to: pts[i].vw, d, before: pts[i - 1].artClientW, after: pts[i].artClientW });
      }
      all.push({ id: sw.id, sim: sw.sim, points: pts, steps });
      L.log({ sweep: sw.id, steps: steps.length ? steps : 'none（单调，无 ≥20px 台阶）' });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('b3.json', all));
})();
