'use strict';
/**
 * c23-anchor.js — 批 3 的锚点遮挡预演（只读）
 *
 * 背景：`syncTocOffset` 写死 `window.innerWidth < 1025`（assets/site.js:944）。
 * 若断点搬到 1200 而 JS 不改，1025–1199 会变成「TOC 是吸顶折叠条，但 --toc-offset 恒 0」
 * → 锚点跳转后标题被吸顶条盖住（= 批 1 刚修好的 F-2 回归）。
 *
 * 三个变体：
 *   base        = 现状（1025–1199 有 250px 右栏，不遮挡）
 *   b3cssOnly   = 只把 CSS 断点搬走、JS 不动  → 预期遮挡
 *   b3full      = CSS + JS 一起搬（matchMedia / innerWidth>=1200 / innerWidth<1200）→ 预期不遮挡
 *
 * 测法（确定性，不用 hash/smooth）：手动 scrollTo(0, headingAbsY - scrollPaddingTop)，
 * 再在标题文字位置 elementFromPoint —— 命中 .toc-side 或 .topbar 即判遮挡。
 *
 * 用法：node tools/c23-anchor.js
 */
const L = require('./c23-lib');

const PAGE = L.PAGE_BY_KEY.dialogs;

/* 用 .toc-side 的吸顶条形态判定：position:sticky 且高度 ~48 才算「会遮挡的条」 */
const PROBE = () => {
  const r1 = (v) => Math.round(v * 10) / 10;
  const toc = document.querySelector('.toc-side');
  const heads = [...document.querySelectorAll('.article h2[id], .article h3[id], .article h4[id]')];
  const padTop = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const results = [];
  /* 取首/中/末三档标题（不同滚动深度） */
  const idxs = [0, Math.floor(heads.length / 2), heads.length - 1].filter((i) => i >= 0 && heads[i]);
  for (const i of idxs) {
    const h = heads[i];
    if (!h) continue;
    const abs = h.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, abs - padTop));
    const b = h.getBoundingClientRect();
    const px = Math.min(b.x + 25, window.innerWidth - 6);
    const py = Math.max(b.y + Math.ceil(b.height / 2), 2);
    const hit = document.elementFromPoint(px, py);
    const byToc = !!(hit && hit.closest && hit.closest('.toc-side'));
    const byTop = !!(hit && hit.closest && hit.closest('.topbar'));
    results.push({
      idx: i, id: h.id, top: r1(b.top),
      hitTag: hit ? hit.tagName : null,
      hitCls: hit && hit.className ? String(hit.className).slice(0, 36) : null,
      byToc, byTopbar: byTop, occluded: byToc || byTop,
    });
  }
  const cs = toc ? getComputedStyle(toc) : null;
  const tb = toc ? toc.getBoundingClientRect() : null;
  return {
    vw: window.innerWidth,
    padTop: Math.round(padTop),
    tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    tocH: tb ? r1(tb.height) : 0,
    tocPos: cs ? cs.position : null,
    tocDisplay: cs ? cs.display : null,
    results,
    occluded: results.filter((r) => r.occluded).length,
    total: results.length,
  };
};

async function run(browser, name, opts) {
  const ctx = await L.newCtx(browser, { width: 1200, height: 900, jsPatch: opts.jsPatch, cssPatch: opts.cssPatch });
  const page = await ctx.newPage();
  await L.gotoPage(page, PAGE);
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  const rows = [];
  for (const w of opts.vps || [1025, 1100, 1150, 1199, 1200, 1024, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await L.settle(page, 3);
    const r = await page.evaluate(PROBE);
    rows.push(r);
    await page.evaluate(() => window.scrollTo(0, 0));
    await L.settle(page, 1);
  }
  await ctx.close();
  return { variant: name, rows };
}

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    out.push(await run(browser, 'base', {}));
    out.push(await run(browser, 'b3cssOnly', { cssPatch: true }));
    out.push(await run(browser, 'b3full', { cssPatch: true, jsPatch: true }));
  } finally {
    await browser.close();
  }

  for (const v of out) {
    console.log(`\n===== ${v.variant} =====`);
    for (const r of v.rows) {
      const det = r.results.map((x) => `#${x.idx}(top=${x.top}${x.occluded ? ' 遮挡:' + x.hitTag + '.' + (x.hitCls || '') : ' ok'})`).join('  ');
      console.log(`${String(r.vw).padEnd(5)} TOC=${String(r.tocDisplay).padEnd(5)}/${String(r.tocPos).padEnd(7)} h=${String(r.tocH).padEnd(6)} off=${String(r.tocOffset).padEnd(6)} pad=${String(r.padTop).padEnd(4)} 遮挡=${r.occluded}/${r.total}  ${det}`);
    }
  }
  console.log('\nWROTE ' + L.save('anchor.json', out));
})().catch((e) => { console.error(e); process.exit(1); });
