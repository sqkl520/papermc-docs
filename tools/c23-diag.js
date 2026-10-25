'use strict';
/**
 * c23-diag.js — 诊断 c23-b2.js 里两个异常指标的成因（只读）
 *   (1) uniqLeftCount > 1：段落左边缘分布到底是什么？基线"1"是怎么来的？
 *   (2) pre 宽离群值 1155.59 / 1139.66：这些 pre 在哪、是不是可见内容？
 *
 * 用法：node tools/c23-diag.js
 */
const L = require('./c23-lib');

const FN = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const art = document.querySelector('article.article') || document.querySelector('article');
  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = art ? [...art.querySelectorAll('p')].filter(isProse) : [];

  /* 段落左边缘分布 + 祖先链 */
  const byLeft = new Map();
  for (const p of paras) {
    const l = r2(p.getBoundingClientRect().left);
    if (!byLeft.has(l)) byLeft.set(l, { left: l, n: 0, sample: [], depth: new Set() });
    const e = byLeft.get(l);
    e.n++;
    if (e.sample.length < 3) {
      const chain = [];
      let cur = p.parentElement;
      while (cur && cur !== art && chain.length < 4) { chain.push(cur.tagName.toLowerCase() + (cur.className ? '.' + String(cur.className).split(' ')[0] : '')); cur = cur.parentElement; }
      e.sample.push(chain.join(' < '));
    }
    let d = 0; let cur = p.parentElement;
    while (cur) { d++; cur = cur.parentElement; }
    e.depth.add(d);
  }
  const lefts = [...byLeft.values()].sort((a, b) => a.left - b.left).map((e) => ({ ...e, depth: [...e.depth] }));

  /* 所有 pre：定位离群值 */
  const pres = [...document.querySelectorAll('pre')].map((pre) => {
    const b = pre.getBoundingClientRect();
    const sc = pre.closest('.code-scroll');
    const cs = getComputedStyle(pre);
    const chain = [];
    let cur = pre.parentElement;
    while (cur && chain.length < 5) { chain.push(cur.tagName.toLowerCase() + (cur.id ? '#' + cur.id : '') + (cur.className ? '.' + String(cur.className).split(' ')[0] : '')); cur = cur.parentElement; }
    return {
      cls: String(pre.className || '').slice(0, 30),
      w: r2(b.width), h: r2(b.height), x: r2(b.x), y: r2(b.y + window.scrollY),
      inArticle: !!(art && art.contains(pre)),
      inScroll: !!sc, scrollCw: sc ? sc.clientWidth : null,
      display: cs.display, visibility: cs.visibility, position: cs.position,
      chain: chain.join(' < '),
      codeLen: (pre.textContent || '').length,
    };
  });
  return { vw: window.innerWidth, lefts, preCount: pres.length, pres };
};

(async () => {
  const browser = await L.launch();
  try {
    for (const key of ['dialogs', 'tuning', 'worldcfg']) {
      const p = L.PAGE_BY_KEY[key];
      const ctx = await L.newCtx(browser, { width: 1440, height: 900 });
      const page = await ctx.newPage();
      await L.gotoPage(page, p, 400);
      const base = await page.evaluate(FN);
      await page.addStyleTag({ content: L.CSS_B2 });
      await L.settle(page, 2);
      const pat = await page.evaluate(FN);
      console.log(`\n===== ${key} @1440 =====`);
      console.log('段落左边缘分布 base:');
      for (const l of base.lefts) console.log(`  left=${l.left}  n=${l.n}  depth={${[...l.depth]}}  e.g. ${l.sample[0]}`);
      console.log('段落左边缘分布 patched:');
      for (const l of pat.lefts) console.log(`  left=${l.left}  n=${l.n}  depth={${[...l.depth]}}  e.g. ${l.sample[0]}`);
      console.log(`pre 总数=${base.preCount}（含 article 外）`);
      const wide = base.pres.filter((x) => x.w > ((base.pres.find((y) => y.inArticle) || {}).w || 0) || !x.inArticle);
      for (const x of base.pres) {
        const flag = (!x.inArticle ? '  [article 外]' : '') + (x.display === 'none' ? '  [display:none]' : '');
        console.log(`  w=${String(x.w).padEnd(9)} h=${String(x.h).padEnd(7)} inArticle=${x.inArticle} scroll=${x.inScroll}/${x.scrollCw} codeLen=${x.codeLen}${flag}  ${x.chain}`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
