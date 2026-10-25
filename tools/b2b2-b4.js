'use strict';
/**
 * b2b2-b4.js — 定位「1023→1024 残留 −23px」台阶的成因（只读探针）
 *
 * 在 FixAlign1200 修法下，1023→1024 仍有 artClientW 972→949（−23px），
 * 但 `.layout` 已是单列、侧栏仍是 drawer、TOC 仍 hidden。
 * 本脚本对比 1023 / 1024 两点的 box 与 computed 差异，找出那 23px 的归属。
 *
 * 用法：node tools/b2b2-b4.js
 */
const L = require('./b2b2-lib');

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
  .toc-side{order:0!important;display:block!important;position:sticky!important;top:var(--topbar-h)}
  .content{order:0!important}
}
`;

const PROBE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const el = (s) => {
    const e = q(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    return {
      x: r2(b.x), w: r2(b.width), h: r2(b.height),
      clientW: e.clientWidth, offsetW: e.offsetWidth,
      padL: st.paddingLeft, padR: st.paddingRight,
      bwL: st.borderLeftWidth, bwR: st.borderRightWidth,
      maxW: st.maxWidth, box: st.boxSizing, disp: st.display,
    };
  };
  return {
    vw: window.innerWidth,
    innerW: window.innerWidth,
    docClientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth,
    body: el('body'),
    layout: el('.layout'),
    content: el('main.content') || el('.content'),
    article: el('article.article') || el('article'),
    main: el('main'),
    pageWrap: el('.page'),
    toc: el('.toc-side'),
    sidebar: el('.sidebar'),
    // 关键：是否有滚动条占位
    htmlGutter: getComputedStyle(document.documentElement).scrollbarGutter,
    htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
  };
};

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    const ctx = await L.makeContext(browser, 'new', { width: 1023, height: 900 });
    const page = await ctx.newPage();
    await page.goto(L.baseUrl('new') + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(200);
    await page.addStyleTag({ content: FIX_CSS(1200) });
    for (const w of [1022, 1023, 1024, 1025, 1400]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(80);
      const p = await page.evaluate(PROBE);
      out.push(p);
      L.log({
        vw: p.vw, docClientW: p.docClientW,
        contentW: p.content && p.content.w, contentClientW: p.content && p.content.clientW,
        contentPadL: p.content && p.content.padL, contentPadR: p.content && p.content.padR,
        artW: p.article && p.article.w, artClientW: p.article && p.article.clientW,
        layoutW: p.layout && p.layout.w, layoutCols: p.layout && p.layout.disp,
        tocDisp: p.toc && p.toc.disp, tocW: p.toc && p.toc.w,
        sbW: p.sidebar && p.sidebar.w, sbDisp: p.sidebar && p.sidebar.disp,
        gutter: p.htmlGutter, overflowY: p.htmlOverflowY,
      });
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('b4.json', out));
})();
