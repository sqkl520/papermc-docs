'use strict';
/**
 * b2b2-c.js — C 组：代码 strut 现状（批 3 的 P1-4）
 *
 * 对 3 个含大量代码的页面测：
 *   1. `<pre>` / `<pre> 内 <code>` 的 computed font-size / line-height
 *   2. **实际行推进**：对 <code> 全体建 Range，getClientRects() 每行一 rect，
 *      相邻 top 之差的中位数（对语法高亮 span 嵌套同样有效）
 *   3. 注入 `.code-pre{font-size:.875rem}` 后：行推进 / 页高 / 代码横滚数变化
 *   4. 三方（new/b0/old）对照，判定 strut 是否仍在、由谁引入
 *
 * 用法：node tools/b2b2-c.js
 * 产出：TMPDIR\b2b2\c.json
 */
const L = require('./b2b2-lib');

const PAGES = [
  { name: 'particles', url: '/paper/dev/particles/', note: '全站代码块最多' },
  { name: 'dialogs', url: '/paper/dev/dialogs/', note: '13 代码块 + 24 条 TOC' },
  { name: 'worldcfg', url: '/paper/reference/world-configuration/', note: '5 代码块 + 长正文' },
];

/** 行推进：<code> 全体 Range rects → 行 top 序列 → 相邻差 */
const ADV_FN = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const code = document.querySelector('pre.code-pre code');
  if (!code) return { tops: [], adv: [], mode: null, uniq: [] };
  const rg = document.createRange();
  rg.selectNodeContents(code);
  const rects = [...rg.getClientRects()].filter((r) => r.height > 1);
  const byTop = new Map();
  for (const r of rects) {
    const k = r2(r.top);
    if (!byTop.has(k)) byTop.set(k, r);
  }
  const tops = [...byTop.keys()].sort((a, b) => a - b);
  const adv = [];
  for (let i = 1; i < tops.length; i++) {
    const d = r2(tops[i] - tops[i - 1]);
    if (d > 1) adv.push(d);
  }
  const sorted = adv.slice().sort((a, b) => a - b);
  const mode = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return { tops, adv, mode: mode == null ? null : r2(mode), uniq: [...new Set(adv)].sort((a, b) => a - b) };
};

const MEASURE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const pres = [...document.querySelectorAll('pre.code-pre')];
  if (!pres.length) return { error: 'no pre.code-pre', blockCount: 0 };
  const pre = pres[0];
  const preCS = getComputedStyle(pre);
  const code = pre.querySelector('code');
  const codeCS = code ? getComputedStyle(code) : null;
  const preLH = preCS.lineHeight === 'normal' ? null : parseFloat(preCS.lineHeight);
  const codeLH = codeCS && codeCS.lineHeight !== 'normal' ? parseFloat(codeCS.lineHeight) : null;
  const codeFS = codeCS ? parseFloat(codeCS.fontSize) : null;

  const scroller = (p) => p.closest('.code-scroll') || p;
  return {
    blockCount: pres.length,
    overflow: pres.filter((p) => { const sc = scroller(p); return sc.scrollWidth > sc.clientWidth + 1; }).length,
    pageHeight: document.documentElement.scrollHeight,
    preFS: r2(parseFloat(preCS.fontSize)),
    preLH: r2(preLH),
    preLHraw: preCS.lineHeight,
    preH: r2(pre.getBoundingClientRect().height),
    prePadT: r2(parseFloat(preCS.paddingTop) || 0),
    prePadB: r2(parseFloat(preCS.paddingBottom) || 0),
    codeFS: r2(codeFS),
    codeLH: r2(codeLH),
    codeLHraw: codeCS ? codeCS.lineHeight : null,
    codeFontFamily: codeCS ? codeCS.fontFamily : null,
    strutDelta: preLH != null && codeLH != null ? r2(codeLH - preLH) : null,
    preHSum: r2(pres.reduce((a, p) => a + p.getBoundingClientRect().height, 0)),
  };
};

const VARIANTS = [
  { id: 'base', css: null },
  { id: 'pre-fs875', css: '.code-pre{font-size:.875rem}' },
  { id: 'pre-fs875-code-inherit', css: '.code-pre{font-size:.875rem}.code-pre code{font-size:inherit;line-height:inherit}' },
  { id: 'code-lh155', css: '.article pre code{line-height:1.55}' },
  { id: 'code-fs-inherit', css: '.article pre code{font-size:inherit}' },
];

(async () => {
  const browser = await L.launch();
  const out = [];
  try {
    for (const build of ['new', 'b0', 'old']) {
      const ctx = await L.makeContext(browser, build, { width: 1440, height: 900 });
      const page = await ctx.newPage();
      for (const pg of PAGES) {
        const variants = [];
        for (const v of VARIANTS) {
          await page.goto(L.baseUrl(build) + pg.url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(150);
          if (v.css) await page.addStyleTag({ content: v.css });
          await page.waitForTimeout(80);
          const m = await page.evaluate(MEASURE);
          const a = await page.evaluate(ADV_FN);
          variants.push({ id: v.id, css: v.css, advMode: a.mode, advUniq: a.uniq, lineCount: a.tops.length, ...m });
        }
        out.push({ build, page: pg.name, url: pg.url, note: pg.note, variants });
        const b0v = variants[0]; const v875 = variants[1];
        L.log({
          b: build, pg: pg.name,
          lines: b0v.lineCount,
          adv: b0v.advMode, advUniq: b0v.advUniq,
          preFS: b0v.preFS, codeFS: b0v.codeFS, preLH: b0v.preLH, codeLH: b0v.codeLH,
          ratio: b0v.codeFS ? Math.round((b0v.advMode / b0v.codeFS) * 1000) / 1000 : null,
          h: b0v.pageHeight, h875: v875.pageHeight,
          adv875: v875.advMode, ov: b0v.overflow + '/' + b0v.blockCount, ov875: v875.overflow + '/' + v875.blockCount,
          preH: b0v.preH, preH875: v875.preH,
        });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('wrote ' + L.save('c.json', out));
})();
