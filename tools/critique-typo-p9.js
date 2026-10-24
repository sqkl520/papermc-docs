'use strict';
/**
 * critique-typo-p9.js — 验证「可直接粘贴的 CSS 方案」候选（逐条实测，不是纸上推演）
 *
 *  C1 只给行文块限宽 38rem(608px)          —— 最小改动
 *  C2 C1 + .content 限宽居中                —— 消除右空
 *  C3 整体 .article 限宽 38rem 居中         —— 最省事，但代码块更窄
 *  C4 C1 + 1025~1159 兜底（侧栏256 / TOC200）
 *
 *  对每个方案在 1440 / 1280 / 1200 / 1100 / 1025 下量：正文 ch / cjk / 右空 / 代码块滚动条 / 表格滚动条 / 页面高
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

const C1 = `@media (min-width:1024px){
  .article > :is(p,ul,ol,blockquote,.alert,.details-block,dl,table,figure),
  .article li > :is(p,ul,ol){ max-width:38rem }
}`;
const C2 = `${C1}
@media (min-width:1024px){
  .layout{ grid-template-columns:290px minmax(0,calc(38rem + 3.2rem)) 250px; justify-content:center }
  .layout:not(.has-toc){ grid-template-columns:290px minmax(0,calc(38rem + 3.2rem)) }
}`;
const C3 = `@media (min-width:1024px){
  .article{ max-width:38rem; margin-left:auto; margin-right:auto }
}`;
const C4 = `${C1}
@media (min-width:1025px) and (max-width:1159px){
  .layout{ grid-template-columns:256px minmax(0,1fr) 200px }
}`;

const VARIANTS = [
  { name: '基线（现状）', css: '' },
  { name: 'C1 行文块38rem', css: C1 },
  { name: 'C2 C1+居中', css: C2 },
  { name: 'C3 整体38rem居中', css: C3 },
  { name: 'C4 C1+兜底', css: C4 },
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
  const artR = art.getBoundingClientRect();
  const toc = document.querySelector('.toc-side');
  const tocVisible = toc && getComputedStyle(toc).display !== 'none';
  return {
    vw: window.innerWidth,
    proseW: Math.round(pr.width),
    ch: Math.round((pr.width / zeroW) * 10) / 10,
    cjk: Math.round(pr.width / fsPx),
    proseX: Math.round(pr.x),
    rightGap: Math.round(window.innerWidth - (pr.x + pr.width)),
    /* 正文右缘 → TOC 左缘的空隙 */
    gapToToc: tocVisible ? Math.round(toc.getBoundingClientRect().left - (pr.x + pr.width)) : null,
    articleW: Math.round(artR.width),
    preScroll: [...document.querySelectorAll('.code-scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    preTotal: document.querySelectorAll('.code-scroll').length,
    tblScroll: [...document.querySelectorAll('.table-wrap')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    tblTotal: document.querySelectorAll('.table-wrap').length,
    scrollH: Math.round(document.documentElement.scrollHeight),
  };
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const out = [];
  const PAGE = '/paper/dev/dialogs/';
  for (const w of [1440, 1280, 1200, 1100, 1025]) {
    for (const v of VARIANTS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(BASE + PAGE, { waitUntil: 'load' });
      if (v.css) await page.addStyleTag({ content: v.css });
      await page.waitForTimeout(140);
      out.push({ vw: w, variant: v.name, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }
  /* 窄屏回归：确认方案不会影响 <=1023 */
  for (const w of [768, 390, 320]) {
    for (const v of [VARIANTS[0], VARIANTS[1], VARIANTS[2]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light', isMobile: w < 768, hasTouch: w < 768 });
      const page = await ctx.newPage();
      await page.goto(BASE + PAGE, { waitUntil: 'load' });
      if (v.css) await page.addStyleTag({ content: v.css });
      await page.waitForTimeout(140);
      out.push({ vw: w, variant: v.name, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p9.json'), JSON.stringify(out, null, 1), 'utf8');

  const widths = [1440, 1280, 1200, 1100, 1025, 768, 390, 320];
  for (const w of widths) {
    console.log('===== ' + w);
    for (const r of out.filter((x) => x.vw === w)) {
      console.log('  ' + r.variant.padEnd(18) + 'prose=' + String(r.proseW).padStart(4) + ' ch=' + String(r.ch).padStart(6) + ' cjk=' + String(r.cjk).padStart(3) + ' rightGap=' + String(r.rightGap).padStart(4) + ' gapToToc=' + String(r.gapToToc).padStart(5) + ' pre=' + r.preScroll + '/' + r.preTotal + ' tbl=' + r.tblScroll + '/' + r.tblTotal + ' H=' + r.scrollH);
    }
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
