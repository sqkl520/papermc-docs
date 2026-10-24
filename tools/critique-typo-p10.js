'use strict';
/**
 * critique-typo-p10.js — 方案收敛：修掉 p9 暴露的两个副作用
 *   副作用1：C2 的 .layout 被 site.css 的 .layout.has-toc 压掉（特异性不足）
 *   副作用2：把 .alert/.details-block 一起限宽，会把**嵌在里面的代码块**挤窄（pre 滚动 5→7）
 *
 * 本轮对比：
 *   D1 只限 p/ul/ol/blockquote/dl（不碰 alert/details 容器本身）  36/38/40rem
 *   D2 D1 + .layout.has-toc 正确居中                               38rem
 *   D3 只限 .article（整列）居中 38rem
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const D1 = (rem) => `@media (min-width:1024px){
  .article > :is(p,ul,ol,blockquote,dl),
  .article li > :is(p,ul,ol){ max-width:${rem}rem }
}`;
const D2 = (rem) => `${D1(rem)}
@media (min-width:1024px){
  .layout.has-toc{ grid-template-columns:290px minmax(0,calc(${rem}rem + 3.2rem)) 250px; justify-content:center }
  .layout:not(.has-toc){ grid-template-columns:290px minmax(0,calc(${rem}rem + 3.2rem)); justify-content:center }
}`;
const D3 = (rem) => `@media (min-width:1024px){
  .article{ max-width:${rem}rem; margin-left:auto; margin-right:auto }
}`;

const VARIANTS = [
  { name: '基线', css: '' },
  { name: 'D1 36rem', css: D1(36) },
  { name: 'D1 38rem', css: D1(38) },
  { name: 'D1 40rem', css: D1(40) },
  { name: 'D2 38rem 居中', css: D2(38) },
  { name: 'D3 38rem 整列居中', css: D3(38) },
];

const GEO = () => {
  const art = document.querySelector('.article');
  const p = art.querySelector('p:not(.page-desc):not(.page-meta)');
  const cs = getComputedStyle(p);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = cs.fontSize + ' ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const fsPx = parseFloat(cs.fontSize);
  const pr = p.getBoundingClientRect();
  const toc = document.querySelector('.toc-side');
  const tocVisible = toc && getComputedStyle(toc).display !== 'none';
  const preScrollEls = [...document.querySelectorAll('.code-scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1);
  /* 分「独立代码块」与「嵌在 alert/details 里」两类，分别统计 */
  const nested = preScrollEls.filter((e) => e.closest('.alert,.details-block')).length;
  const alertW = (() => { const a = art.querySelector('.alert'); return a ? Math.round(a.getBoundingClientRect().width) : null; })();
  const detW = (() => { const d = art.querySelector('.details-block'); return d ? Math.round(d.getBoundingClientRect().width) : null; })();
  const tblW = (() => { const t = art.querySelector('.table-wrap'); return t ? Math.round(t.getBoundingClientRect().width) : null; })();
  return {
    vw: window.innerWidth,
    proseW: Math.round(pr.width),
    ch: Math.round((pr.width / zeroW) * 10) / 10,
    cjk: Math.round(pr.width / fsPx),
    rightGap: Math.round(window.innerWidth - (pr.x + pr.width)),
    gapToToc: tocVisible ? Math.round(toc.getBoundingClientRect().left - (pr.x + pr.width)) : null,
    preScroll: preScrollEls.length, preNestedScroll: nested,
    preTotal: document.querySelectorAll('.code-scroll').length,
    tblScroll: [...document.querySelectorAll('.table-wrap')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    alertW, detW, tblW,
    scrollH: Math.round(document.documentElement.scrollHeight),
    horizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const out = [];
  for (const w of [1440, 1280, 1200, 1100, 1025, 768, 390, 320]) {
    for (const v of VARIANTS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light', isMobile: w < 768, hasTouch: w < 768 });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      if (v.css) await page.addStyleTag({ content: v.css });
      await page.waitForTimeout(140);
      out.push({ vw: w, variant: v.name, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p10.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const w of [1440, 1280, 1200, 1100, 1025, 768, 390, 320]) {
    console.log('===== ' + w);
    for (const r of out.filter((x) => x.vw === w)) {
      console.log('  ' + r.variant.padEnd(16) + 'prose=' + String(r.proseW).padStart(4) + ' ch=' + String(r.ch).padStart(6) + ' cjk=' + String(r.cjk).padStart(3) + ' rGap=' + String(r.rightGap).padStart(4) + ' gapToc=' + String(r.gapToToc).padStart(5) + ' pre=' + r.preScroll + '(nest' + r.preNestedScroll + ')/' + r.preTotal + ' alert=' + String(r.alertW).padStart(4) + ' det=' + String(r.detW).padStart(4) + ' tbl=' + String(r.tblW).padStart(4) + ' H=' + r.scrollH + (r.horizOverflow ? ' !!HSCROLL' : ''));
    }
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
