'use strict';
/**
 * c23-anchor2.js — 证明「只改 CSS、不改 JS」会复现锚点遮挡（只读）
 *
 * b3cssOnly 的 TOC 是 expanded/static（matchMedia 仍按 1025 强制展开），
 * 所以它在 1025–1199 **不是** 48px 吸顶条 → 我上一个脚本用「手册 scrollTo + elementFromPoint」
 * 测到 0/3 遮挡，但那是**在已展开的大面板**下测的，不能代表真实回归路径。
 *
 * 真实回归路径是：**用户把折叠条收起**（这是页面默认态）→ 此时 .toc-side 变 sticky 61px，
 * 而 JS 的 syncTocOffset 若仍写 <1025 → --toc-offset 恒 0 → scroll-padding-top 只算顶栏
 * → 锚点跳转后标题落在吸顶条下面。
 *
 * 所以本脚本显式构造这个状态：
 *   collapsed = 手动 removeAttribute('open') + 移除 .toc-open（= 窄屏默认态）
 * 然后测 elementFromPoint。
 *
 * 变体：
 *   cssOnly_collapsed  = CSS 搬了、JS 没搬，且强制折叠 → 预期遮挡
 *   full_collapsed     = CSS + JS 都搬，强制折叠       → 预期不遮挡
 *
 * 用法：node tools/c23-anchor2.js
 */
const L = require('./c23-lib');

const COLLAPSE = () => {
  document.querySelectorAll('.toc-side .toc-fold').forEach((f) => f.removeAttribute('open'));
  const host = document.querySelector('.toc-side');
  if (host) host.classList.remove('toc-open');
  /* 让 syncTocOffset 的 toggle 监听跑完 */
  return new Promise((r) => setTimeout(r, 120));
};

const PROBE = () => {
  const r1 = (v) => Math.round(v * 10) / 10;
  const toc = document.querySelector('.toc-side');
  const heads = [...document.querySelectorAll('.article h2[id], .article h3[id], .article h4[id]')];
  const padTop = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const results = [];
  const idxs = [0, Math.floor(heads.length / 2), heads.length - 1].filter((i) => heads[i]);
  for (const i of idxs) {
    const h = heads[i];
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
    foldOpen: !!document.querySelector('.toc-side .toc-fold[open]'),
    results,
    occluded: results.filter((r) => r.occluded).length,
    total: results.length,
  };
};

async function run(browser, name, opts) {
  const ctx = await L.newCtx(browser, { width: 1200, height: 900, jsPatch: opts.jsPatch, cssPatch: opts.cssPatch });
  const page = await ctx.newPage();
  await L.gotoPage(page, L.PAGE_BY_KEY.dialogs);
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  const rows = [];
  for (const w of [1025, 1100, 1150, 1199, 1200]) {
    await page.setViewportSize({ width: w, height: 900 });
    await L.settle(page, 3);
    await page.evaluate(COLLAPSE);
    await page.evaluate(() => window.scrollTo(0, 0));
    await L.settle(page, 1);
    rows.push(await page.evaluate(PROBE));
    await page.reload({ waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
    await page.waitForTimeout(80);
  }
  await ctx.close();
  return { variant: name, rows };
}

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    out.push(await run(browser, 'cssOnly_collapsed', { cssPatch: true }));
    out.push(await run(browser, 'full_collapsed', { cssPatch: true, jsPatch: true }));
  } finally { await browser.close(); }

  for (const v of out) {
    console.log(`\n===== ${v.variant}（强制折叠态 = 窄屏默认态）=====`);
    for (const r of v.rows) {
      const det = r.results.map((x) => `#${x.idx}(top=${x.top}${x.occluded ? ' 遮挡←' + x.hitTag + '.' + (x.hitCls || '') : ' ok'})`).join('  ');
      console.log(`${String(r.vw).padEnd(5)} toc=${String(r.tocDisplay).padEnd(5)}/${String(r.tocPos).padEnd(7)} h=${String(r.tocH).padEnd(6)} off=${String(r.tocOffset).padEnd(6)} pad=${String(r.padTop).padEnd(4)} open=${String(r.foldOpen).padEnd(5)} 遮挡=${r.occluded}/${r.total}  ${det}`);
    }
  }
  console.log('\nWROTE ' + L.save('anchor2.json', out));
})().catch((e) => { console.error(e); process.exit(1); });
