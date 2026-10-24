'use strict';
/**
 * critique-typo-p20.js — 报告里「可直接粘贴」那几段 CSS 的最终数值验证
 *  1) 行文封顶 40rem（640px）只封行文 vs 整列封顶居中 —— 各自的 ch / 代码滚动增量
 *  2) 右栏 TOC 断点上移到 1200 后的正文 ch
 *  3) 移动端 TOC 默认折叠 + 排到正文之后：H1 的首屏 y（当前 1317/1345）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PROSE40 = `@media (min-width:768px){
  .article > :is(p,ul,ol,blockquote,dl),
  .article li > :is(p,ul,ol){ max-width:40rem }
}`;
const COL40 = `@media (min-width:768px){
  .article{ max-width:40rem; margin-inline:auto }
}`;
const TOC1200 = `@media (min-width:1025px) and (max-width:1199px){
  .layout.has-toc{ grid-template-columns:290px minmax(0,1fr) }
  .toc-side{ display:none }
  .side-toc{ display:block }
}`;
const MOBILETOC = `@media (max-width:1024px){
  .content{ order:1 }
  .toc-side{ order:2; margin:1.2rem 0 0 }
}`;

const GEO = () => {
  const art = document.querySelector('.article');
  const p = art ? art.querySelector('p:not(.page-desc):not(.page-meta)') : null;
  const cs = getComputedStyle(document.body);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = '16px ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const pr = p ? p.getBoundingClientRect() : null;
  const h1 = document.querySelector('.article h1') || document.querySelector('.hero h1');
  return {
    vw: window.innerWidth,
    proseW: pr ? Math.round(pr.width) : null,
    ch: pr ? Math.round((pr.width / zeroW) * 10) / 10 : null,
    cjk: pr ? Math.round(pr.width / 16) : null,
    rightGap: pr ? Math.round(window.innerWidth - (pr.x + pr.width)) : null,
    h1Y: h1 ? Math.round(h1.getBoundingClientRect().top + window.scrollY) : null,
    vh: window.innerHeight,
    preScroll: [...document.querySelectorAll('.code-scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    preTotal: document.querySelectorAll('.code-scroll').length,
    tblScroll: [...document.querySelectorAll('.table-wrap')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    tblTotal: document.querySelectorAll('.table-wrap').length,
    scrollH: Math.round(document.documentElement.scrollHeight),
    tocVis: (() => { const t = document.querySelector('.toc-side'); return t ? getComputedStyle(t).display !== 'none' : false; })(),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const rows = [];
  const variants = [
    ['基线', ''],
    ['A 行文40rem', PROSE40],
    ['B 整列40rem居中', COL40],
    ['A+宽屏居中', PROSE40 + `@media (min-width:1440px){.layout.has-toc{grid-template-columns:290px minmax(0,calc(40rem + 3.2rem)) 250px;justify-content:center}}`],
  ];
  for (const w of [1600, 1440, 1280, 1200, 1100, 1025, 768, 390, 320]) {
    for (const [name, css] of variants) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light', isMobile: w < 768, hasTouch: w < 768 });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      if (css) await page.addStyleTag({ content: css });
      await page.waitForTimeout(130);
      rows.push({ name, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }
  /* TOC 断点 */
  for (const w of [1199, 1200, 1100]) {
    for (const [name, css] of [['TOC@1025', ''], ['TOC@1200', TOC1200]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      if (css) await page.addStyleTag({ content: css });
      await page.waitForTimeout(130);
      rows.push({ name: name + '@' + w, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }
  /* 移动端 TOC 顺序 */
  for (const w of [390, 320]) {
    for (const [name, css] of [['mob-base', ''], ['mob-TOC后置', MOBILETOC]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      if (css) await page.addStyleTag({ content: css });
      await page.waitForTimeout(130);
      rows.push({ name: name + '@' + w, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p20.json'), JSON.stringify(rows, null, 1), 'utf8');
  for (const r of rows) {
    console.log((r.name + '@' + r.vw).padEnd(26) + 'prose=' + String(r.proseW).padStart(4) + ' ch=' + String(r.ch).padStart(6) + ' cjk=' + String(r.cjk).padStart(3) + ' rGap=' + String(r.rightGap).padStart(4) + ' h1Y=' + String(r.h1Y).padStart(5) + '/vh' + r.vh + ' pre=' + r.preScroll + '/' + r.preTotal + ' tbl=' + r.tblScroll + '/' + r.tblTotal + ' toc=' + (r.tocVis ? 'Y' : 'n'));
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
