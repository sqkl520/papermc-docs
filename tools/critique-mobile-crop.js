'use strict';
/**
 * critique-mobile-crop.js —— 视口高度级别的区域裁剪（<8192px，便于人眼核对）
 * 用法: node tools/critique-mobile-crop.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const OUT = path.join(os.tmpdir(), 'critique-mobile');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const JOBS = [
  { vp: '320x568', url: '/paper/reference/permissions/', sel: '.table-wrap', name: 'perm-table-top', maxH: 620 },
  { vp: '390x844', url: '/paper/reference/permissions/', sel: '.table-wrap', name: 'perm-table-top', maxH: 620 },
  { vp: '320x568', url: '/paper/reference/world-configuration/', sel: '.article li li li', name: 'wc-deep-list', maxH: 560 },
  { vp: '390x844', url: '/paper/dev/particles/', sel: '.content-img', name: 'particles-img-1', maxH: 420 },
  { vp: '390x844', url: '/all-pages.html', sel: '.filter-bar', name: 'ap-filter', maxH: 200 },
  { vp: '390x844', url: '/', sel: '.entry-cards', name: 'landing-cards', maxH: 520 },
  { vp: '390x844', url: '/velocity/tuning/', sel: '.toc-side', name: 'tuning-toc', maxH: 700 },
  { vp: '390x844', url: '/paper/dev/dialogs/', sel: '.code-block', name: 'dialogs-code', maxH: 300 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  for (const vp of ['320x568', '390x844']) {
    const [w, h] = vp.split('x').map(Number);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    for (const j of JOBS.filter((x) => x.vp === vp)) {
      try {
        await page.goto(BASE + j.url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(400);
        const el = await page.$(j.sel);
        if (!el) { console.log('  no el ' + j.name); continue; }
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const box = await el.boundingBox();
        await page.screenshot({ path: path.join(OUT, j.name + '-' + vp + '.png'), clip: { x: box.x, y: Math.max(0, box.y - (box.y + box.height > h ? 0 : 0)), width: Math.min(box.width, w), height: Math.min(box.height, j.maxH) } });
        console.log('  ok ' + j.name + '-' + vp + ' box=' + Math.round(box.width) + 'x' + Math.round(box.height));
      } catch (e) { console.log('  ERR ' + j.name + ': ' + e.message.slice(0, 80)); }
    }
    await ctx.close();
  }
  await browser.close();
  console.log('done → ' + OUT);
})();
