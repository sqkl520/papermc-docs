'use strict';
/**
 * b2b2-maxw.js — 确认 `.content{max-width:1000px}` 到底在什么视口宽度下真正生效（只读）
 *
 * 起因：`.content` 在 ≥1025 是 `vw − 290 − 250 = vw − 540`；
 * 该值要超过 1000 才被 `max-width` 封顶 ⇒ 理论阈值 vw ≈ 1540。
 * 本脚本扫 1440…1800，验证阈值，并记录 artW 何时停止增长。
 *
 * 用法：node tools/b2b2-maxw.js
 */
const L = require('./b2b2-lib');

const FIX = (bp) => `
@media (max-width:${(bp - 0.02).toFixed(2)}px){
  .layout{grid-template-columns:minmax(0,1fr)!important}
  .layout.has-toc{grid-template-columns:minmax(0,1fr)!important}
  .toc-side{display:none!important}
  .sidebar{position:fixed!important;transform:translateX(-102%)!important;width:min(88vw,320px)!important}
}
@media (min-width:${bp}px){
  .layout{grid-template-columns:290px minmax(0,1fr)!important}
  .layout.has-toc{grid-template-columns:290px minmax(0,1fr) 250px!important}
  .toc-side{display:block!important;position:sticky!important;top:var(--topbar-h)}
}
`;

const P = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const art = document.querySelector('article.article') || document.querySelector('article');
  const c = document.querySelector('main.content') || document.querySelector('.content');
  const ab = art ? art.getBoundingClientRect() : null;
  return {
    vw: window.innerWidth,
    contentW: c ? r2(c.getBoundingClientRect().width) : null,
    contentMaxW: c ? getComputedStyle(c).maxWidth : null,
    artClientW: art ? art.clientWidth : null,
    artX: ab ? r2(ab.x) : null,
    artRight: ab ? r2(ab.right) : null,
    cols: getComputedStyle(document.querySelector('.layout')).gridTemplateColumns,
    pageH: document.documentElement.scrollHeight,
  };
};

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    // 1) 现状（无注入）扫宽视口
    const ctx = await L.makeContext(browser, 'new', { width: 1440, height: 900 });
    const page = await ctx.newPage();
    await page.goto(L.baseUrl('new') + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(200);
    for (const w of [1440, 1500, 1530, 1539, 1540, 1541, 1600, 1720, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(60);
      const p = await page.evaluate(P);
      out.push({ mode: 'base', ...p });
      L.log({ mode: 'base', vw: p.vw, contentW: p.contentW, maxW: p.contentMaxW, artW: p.artClientW });
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('maxw.json', out));
})();
