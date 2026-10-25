'use strict';
/**
 * b2b2-b2.js — B 组补测：模拟断点的「断崖落点」精扫
 *
 * B 组主曲线只扫 1200→1300，因此：
 *   - sim=1200 把右侧栏断点搬到 1200 后，断崖落在 1199→1200（**在主扫描区间之外**，B.4 未覆盖）
 *   - 现状（bp=1025）的断崖落在 1023→1025（另见 b2b2-b.js 的 1015→1035 精扫）
 * 本脚本精扫：
 *   new 基准     1190→1210
 *   sim=1200     1190→1210
 *   sim=1280     1020→1035（看 1024 死区是否随之消失）
 *   sim=1280     1270→1290
 *
 * 用法：node tools/b2b2-b2.js
 * 产出：TMPDIR\b2b2\b2.json
 */
const L = require('./b2b2-lib');

const PAGE = '/paper/dev/dialogs/';

const SWEEPS = [
  { id: 'base-1190-1210', from: 1190, to: 1210, sim: 0 },
  { id: 'sim1200-1190-1210', from: 1190, to: 1210, sim: 1200 },
  { id: 'sim1280-1020-1035', from: 1020, to: 1035, sim: 1280 },
  { id: 'sim1280-1270-1290', from: 1270, to: 1290, sim: 1280 },
  { id: 'base-1020-1035', from: 1020, to: 1035, sim: 0 },
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
  let tocMode = 'hidden';
  if (toc && getComputedStyle(toc).display !== 'none' && toc.getBoundingClientRect().width > 0) {
    tocMode = (toc.getBoundingClientRect().width < 400 && toc.getBoundingClientRect().x >= ab.x + ab.width - 2) ? 'rail' : 'top-block';
  }
  return {
    vw: window.innerWidth,
    artClientW: art ? art.clientWidth : null,
    line,
    cols: lay ? getComputedStyle(lay).gridTemplateColumns : null,
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
      const ctx = await L.makeContext(browser, 'new', { width: sw.from, height: 900 });
      const page = await ctx.newPage();
      await page.goto(L.baseUrl('new') + PAGE, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(200);
      if (sw.sim) await page.addStyleTag({ content: SIM_CSS(sw.sim) });
      const pts = [];
      for (let w = sw.from; w <= sw.to; w++) {
        await page.setViewportSize({ width: w, height: 900 });
        pts.push(await page.evaluate(POINT_FN));
      }
      let maxD = 0; let at = null;
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i].artClientW - pts[i - 1].artClientW;
        if (Math.abs(d) > Math.abs(maxD)) {
          maxD = d;
          at = { from: pts[i - 1].vw, to: pts[i].vw, before: pts[i - 1].artClientW, after: pts[i].artClientW };
        }
      }
      all.push({ id: sw.id, from: sw.from, to: sw.to, sim: sw.sim, points: pts, maxDelta: { d: maxD, at } });
      L.log({ sweep: sw.id, first: pts[0].artClientW, last: pts[pts.length - 1].artClientW, maxDelta: maxD, at });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('b2.json', all));
})();
