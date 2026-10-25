'use strict';
/**
 * b2b2-prose.js — 正文段落 DOM 嵌套结构分析（E 组异常归因，只读）
 *
 * 背景：注入 `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}` 后，
 * dialogs@1440 的全局最长行盒只从 848.36 降到 797.75（未降到 ~640），
 * 说明存在**不是 article 直接子元素**的段落，选择器覆盖不到。
 * 本脚本统计每个段落相对 article 的深度与包裹容器，给出 40rem 覆盖率的真实边界。
 *
 * 用法：node tools/b2b2-prose.js
 */
const L = require('./b2b2-lib');

const PAGES = [
  { name: 'dialogs', url: '/paper/dev/dialogs/' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/' },
  { name: 'tuning', url: '/velocity/tuning/' },
  { name: 'paper', url: '/paper/' },
  { name: 'particles', url: '/paper/dev/particles/' },
];

const FN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const article = document.querySelector('article.article') || document.querySelector('article');
  if (!article) return { error: 'no article' };

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };

  // 每个段落的「最近 article 直接子元素祖先」
  const directChildOf = (el) => {
    let cur = el;
    while (cur && cur.parentElement !== article) cur = cur.parentElement;
    return cur;
  };

  const all = [...article.querySelectorAll('p')].filter(isProse);
  const byWrapper = new Map();
  let directCount = 0;
  let nestedCount = 0;
  let directLines = 0; let nestedLines = 0;
  let maxDirect = 0; let maxNested = 0;
  const nestedSamples = [];

  for (const p of all) {
    const holder = directChildOf(p);
    const isDirect = holder === p;
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    const lineW = rects.length ? Math.max(...rects.map((r) => r.width)) : 0;
    if (isDirect) {
      directCount++; directLines += rects.length;
      if (lineW > maxDirect) maxDirect = lineW;
    } else {
      nestedCount++; nestedLines += rects.length;
      if (lineW > maxNested) maxNested = lineW;
      const key = holder ? holder.tagName.toLowerCase() + '.' + (holder.className || '').split(/\s+/).filter(Boolean).join('.') : '(none)';
      const rec = byWrapper.get(key) || { n: 0, maxLine: 0 };
      rec.n++; if (lineW > rec.maxLine) rec.maxLine = lineW;
      byWrapper.set(key, rec);
      if (nestedSamples.length < 6) {
        nestedSamples.push({ holder: key, lineW: r2(lineW), text: (p.textContent || '').trim().slice(0, 45) });
      }
    }
  }

  // article 直接子元素的标签/类分布（决定选择器能覆盖到什么）
  const kids = [...article.children].map((c) => {
    const r = c.getBoundingClientRect();
    return {
      tag: c.tagName.toLowerCase(),
      cls: (c.className || '').toString().split(/\s+/).filter(Boolean).join('.'),
      w: r2(r.width),
      x: r2(r.x),
      ps: c.querySelectorAll('p').length,
      directPs: [...c.children].filter((k) => k.tagName === 'P').length,
    };
  });

  return {
    proseTotal: all.length,
    directCount, nestedCount,
    directLines, nestedLines,
    maxDirectLine: r2(maxDirect),
    maxNestedLine: r2(maxNested),
    wrappers: [...byWrapper.entries()].map(([k, v]) => ({ w: k, n: v.n, maxLine: r2(v.maxLine) })).sort((a, b) => b.maxLine - a.maxLine),
    nestedSamples,
    articleW: article.clientWidth,
    kids,
  };
};

(async () => {
  const browser = await L.launch();
  const out = {};
  try {
    const ctx = await L.makeContext(browser, 'new', { width: 1440, height: 900 });
    const page = await ctx.newPage();
    for (const pg of PAGES) {
      await page.goto(L.baseUrl('new') + pg.url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(150);
      const m = await page.evaluate(FN);
      out[pg.name] = m;
      L.log({
        pg: pg.name, total: m.proseTotal, direct: m.directCount, nested: m.nestedCount,
        maxDirect: m.maxDirectLine, maxNested: m.maxNestedLine,
        wrappers: m.wrappers.length,
      });
      if (process.env.B2B_DETAIL) for (const w of (m.wrappers || []).slice(0, 8)) L.log({ pg: pg.name, wrapper: w.w, n: w.n, maxLine: w.maxLine });
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('prose.json', out));
})();
