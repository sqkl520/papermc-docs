'use strict';
/**
 * critique-typo-p13.js — 确认方案的作用域应该从 768 起（平板 768~1023 也是 79~83ch），
 * 并验证「不限断点（全宽度）+ max-width 封顶」在 320/390 上零副作用。
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

/* 方案：不限媒体查询，只给行文块封顶（max-width 在窄屏天然无副作用） */
const GLOBAL = `@media (min-width:768px){
  .article > :is(p,ul,ol,blockquote,dl),
  .article li > :is(p,ul,ol){ max-width:38rem }
}`;

const GEO = () => {
  const art = document.querySelector('.article');
  const p = art.querySelector('p:not(.page-desc):not(.page-meta)');
  const cs = getComputedStyle(p);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = cs.fontSize + ' ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const pr = p.getBoundingClientRect();
  return {
    vw: window.innerWidth,
    proseW: Math.round(pr.width),
    ch: Math.round((pr.width / zeroW) * 10) / 10,
    cjk: Math.round(pr.width / parseFloat(cs.fontSize)),
    scrollH: Math.round(document.documentElement.scrollHeight),
    horiz: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    preScroll: [...document.querySelectorAll('.code-scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const rows = [];
  for (const w of [1440, 1280, 1180, 1100, 1024, 900, 820, 768, 600, 390, 320]) {
    for (const [name, css] of [['基线', ''], ['768起 38rem', GLOBAL]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light', isMobile: w < 768, hasTouch: w < 768 });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      if (css) await page.addStyleTag({ content: css });
      await page.waitForTimeout(130);
      rows.push({ name, ...(await page.evaluate(GEO)) });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p13.json'), JSON.stringify(rows, null, 1), 'utf8');
  for (const w of [1440, 1280, 1180, 1100, 1024, 900, 820, 768, 600, 390, 320]) {
    const a = rows.find((r) => r.vw === w && r.name === '基线');
    const b = rows.find((r) => r.vw === w && r.name === '768起 38rem');
    console.log(String(w).padEnd(6) + '基线 ch=' + String(a.ch).padStart(6) + ' (' + a.cjk + 'cjk)  ->  38rem ch=' + String(b.ch).padStart(6) + ' (' + b.cjk + 'cjk)' + (b.horiz ? ' !!HSCROLL' : '') + ' pre=' + b.preScroll);
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
