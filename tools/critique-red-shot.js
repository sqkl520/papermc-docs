'use strict';
/** critique-red-shot.js — 侧栏元素截图（写到系统临时目录，不污染 reports/） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));
(async () => {
  const dir = path.join(os.tmpdir(), 'critique-red');
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8787/paper/dev/dialogs/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const el = await page.$('.sidebar');
  await el.screenshot({ path: path.join(dir, 'sidebar-1440.png') });
  // 裁剪到前半部分更易读
  await page.evaluate(() => { const s = document.querySelector('.sidebar'); if (s) s.scrollTop = 0; });
  await page.screenshot({ path: path.join(dir, 'sidebar-clip-1440.png'), clip: { x: 0, y: 52, width: 300, height: 700 } });
  console.log('dir=' + dir);
  console.log(fs.readdirSync(dir).join('\n'));
  await browser.close();
})();
