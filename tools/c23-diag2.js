'use strict';
/**
 * c23-diag2.js — 诊断：注入目标态后 1025–1199 的 .toc-side 为什么是 expanded/static？
 *   1) site.js 的响应体是否真的被改写（跑 b3full 上下文，抓 document 里实际执行的源码片段）
 *   2) .toc-side 的 DOM 结构 / <details> open 状态 / toc-open class
 *   3) 命中 .toc-side 的 position 规则从哪来
 *
 * 用法：node tools/c23-diag2.js
 */
const L = require('./c23-lib');

const PROBE = () => {
  const toc = document.querySelector('.toc-side');
  const fold = document.querySelector('.toc-side .toc-fold');
  const cs = toc ? getComputedStyle(toc) : null;
  const chain = [];
  let cur = toc;
  while (cur && chain.length < 6) {
    chain.push(cur.tagName.toLowerCase() + (cur.id ? '#' + cur.id : '') + (cur.className ? '.' + String(cur.className).trim().split(/\s+/).join('.') : ''));
    cur = cur.parentElement;
  }
  return {
    vw: window.innerWidth,
    tocTag: toc ? toc.tagName : null,
    tocCls: toc ? String(toc.className) : null,
    foldTag: fold ? fold.tagName : null,
    foldOpen: fold ? !!fold.open : null,
    foldOpenAttr: fold ? fold.hasAttribute('open') : null,
    tocPos: cs ? cs.position : null,
    tocDisplay: cs ? cs.display : null,
    tocH: toc ? Math.round(toc.getBoundingClientRect().height * 10) / 10 : null,
    topbarH: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
    tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    chain: chain.join(' < '),
  };
};

(async () => {
  const browser = await L.launch();
  try {
    /* 先确认 route 改写真的生效：直接抓 site.js 的文本 */
    const ctx = await L.newCtx(browser, { width: 1200, height: 900, jsPatch: true, cssPatch: true });
    const page = await ctx.newPage();
    const js = await page.evaluate(async (origin) => {
      const r = await fetch(origin + '/assets/site.js');
      const t = await r.text();
      return {
        has1025: t.includes('1025'),
        has1200: t.includes('1200'),
        snippets: (t.match(/min-width:1\d{3}px/g) || []).slice(0, 6),
        innerW: (t.match(/window\.innerWidth\s*[<>]=?\s*\d+/g) || []).slice(0, 6),
      };
    }, L.BASE);
    console.log('site.js 改写检查:', JSON.stringify(js, null, 1));

    await L.gotoPage(page, L.PAGE_BY_KEY.dialogs, 400);
    for (const w of [1024, 1025, 1199, 1200]) {
      await page.setViewportSize({ width: w, height: 900 });
      await L.settle(page, 3);
      const r = await page.evaluate(PROBE);
      console.log(`vw=${w}`, JSON.stringify(r));
    }
    await ctx.close();

    /* 对照：完全不注入 */
    const ctx2 = await L.newCtx(browser, { width: 1200, height: 900 });
    const p2 = await ctx2.newPage();
    await L.gotoPage(p2, L.PAGE_BY_KEY.dialogs, 400);
    for (const w of [1024, 1025]) {
      await p2.setViewportSize({ width: w, height: 900 });
      await L.settle(p2, 3);
      console.log(`[base] vw=${w}`, JSON.stringify(await p2.evaluate(PROBE)));
    }
    await ctx2.close();
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
