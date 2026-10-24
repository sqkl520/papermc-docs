'use strict';
// 验证「方案 A 全量」在 1025–1199 的最终数值（40rem 封顶 + TOC 断点上移叠加后的真实结果）
const path = require('path');
const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const FULL = `
@media (min-width:768px){
  .article > :is(p,ul,ol,blockquote,dl),
  .article li > :is(p,ul,ol){ max-width:40rem }
}
@media (min-width:1025px) and (max-width:1199px){
  .layout.has-toc{ grid-template-columns:290px minmax(0,1fr) }
  .toc-side{ display:none }
  .side-toc{ display:block }
}`;

const GEO = () => {
  const art = document.querySelector('.article');
  const p = art.querySelector('p:not(.page-desc):not(.page-meta)');
  const cs = getComputedStyle(document.body);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = '16px ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const pr = p.getBoundingClientRect();
  const toc = document.querySelector('.toc-side');
  return {
    vw: window.innerWidth,
    articleW: Math.round(art.getBoundingClientRect().width),
    proseW: Math.round(pr.width),
    ch: Math.round((pr.width / zeroW) * 10) / 10,
    cjk: Math.round(pr.width / 16),
    tocVis: toc ? getComputedStyle(toc).display !== 'none' : false,
    preScroll: [...document.querySelectorAll('.code-scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    preTotal: document.querySelectorAll('.code-scroll').length,
    tblScroll: [...document.querySelectorAll('.table-wrap')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    tblTotal: document.querySelectorAll('.table-wrap').length,
    horiz: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const rows = [];
  for (const w of [1600, 1440, 1280, 1200, 1199, 1100, 1025, 1024, 768]) {
    for (const [name, css] of [['base', ''], ['full', FULL]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      if (css) await page.addStyleTag({ content: css });
      await page.waitForTimeout(130);
      rows.push({ name, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p21.json'), JSON.stringify(rows, null, 1), 'utf8');
  for (const w of [1600, 1440, 1280, 1200, 1199, 1100, 1025, 1024, 768]) {
    const a = rows.find((r) => r.vw === w && r.name === 'base');
    const b = rows.find((r) => r.vw === w && r.name === 'full');
    console.log(String(w).padEnd(6) + 'base ' + String(a.ch).padStart(6) + 'ch toc=' + (a.tocVis ? 'Y' : 'n') + ' pre=' + a.preScroll + '/' + a.preTotal +
      '  ->  full ' + String(b.ch).padStart(6) + 'ch(' + b.cjk + 'cjk) toc=' + (b.tocVis ? 'Y' : 'n') + ' art=' + b.articleW + ' pre=' + b.preScroll + '/' + b.preTotal + ' tbl=' + b.tblScroll + '/' + b.tblTotal + (b.horiz ? ' !!HSCROLL' : ''));
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
