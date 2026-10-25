'use strict';
/** cr2ia-file.js — file:// 约束实证（不带 --allow-file-access-from-files，模拟用户双击） */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'cr2ia');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  const R = {};
  // 关键：只加 --no-sandbox，不加 --allow-file-access-from-files
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));

  const idxUrl = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
  await page.goto(idxUrl, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  R.load = await page.evaluate(() => ({
    css: getComputedStyle(document.body).fontSize,
    sidebarLinks: document.querySelectorAll('#sidebar a[href]').length,
    anchors: document.querySelectorAll('a[href]').length,
    theme: document.documentElement.getAttribute('data-theme'),
    storage: (() => { try { localStorage.setItem('t', '1'); localStorage.removeItem('t'); return 'ok'; } catch (e) { return 'throws: ' + e.name; } })(),
  }));

  await page.keyboard.press('Control+k');
  await page.waitForTimeout(2500);
  await page.keyboard.type('Dialog', { delay: 70 });
  await page.waitForTimeout(2500);
  R.search = await page.evaluate(() => ({
    open: (document.querySelector('#search-dialog') || {}).open,
    results: document.querySelectorAll('#search-results a').length,
    counter: (document.querySelector('#search-count') || {}).textContent || '',
  }));

  // 侧栏过滤（纯 DOM，不依赖网络）
  await page.keyboard.press('Escape');
  R.filter = await page.evaluate(() => {
    const inp = document.querySelector('#side-filter');
    inp.value = 'velocity';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const links = [...document.querySelectorAll('#sidebar a[href]')];
    const shown = links.filter((a) => a.checkVisibility && a.checkVisibility()).length;
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return { shownWhenFiltered: shown, total: links.length };
  });

  // 深链
  const deepUrl = 'file:///' + path.join(ROOT, 'paper/dev/dialogs/index.html').split(path.sep).join('/');
  await page.goto(deepUrl, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  R.deep = await page.evaluate(() => ({
    h1: (document.querySelector('h1') || {}).textContent || null,
    toc: document.querySelectorAll('.toc-side a').length,
    side: document.querySelectorAll('#sidebar a').length,
    crumb: (document.querySelector('.crumbs') || {}).textContent || null,
    codeBlocks: document.querySelectorAll('pre').length,
    imgBroken: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).length,
    imgTotal: document.querySelectorAll('img').length,
  }));

  R.errors = errs.slice(0, 10);
  fs.writeFileSync(path.join(OUT, 'file.json'), JSON.stringify(R, null, 2), 'utf8');
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})();
