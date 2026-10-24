'use strict';
/** b1r2-j.js — 打印态变量到底解析成哪一套（原始色值 + 媒体查询求值），避免误判 */
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const EXE = [process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787', OLD = 'http://127.0.0.1:8788', PAGE = '/paper/dev/particles/';
const lines = []; const log = (s) => { lines.push(s); console.log(s); };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = [];
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(base + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    const probe = () => page.evaluate(() => {
      const g = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; };
      const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
        bodyColor: getComputedStyle(document.body).color,
        hlKeywordVar: v('--hl-keyword'), fgVar: v('--fg'), codeBgVar: v('--code-bg'),
        kwEl: g('.hljs-keyword'), preEl: g('.code-pre') || g('pre'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
      };
    });
    const screen = await probe();
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    const printNoScheme = await probe();
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    await page.waitForTimeout(300);
    const printDark = await probe();
    out.push({ tag, screen, printNoScheme, printDark });
    log(`${tag} screen      ${JSON.stringify(screen)}`);
    log(`${tag} print(noCS) ${JSON.stringify(printNoScheme)}`);
    log(`${tag} print(dark) ${JSON.stringify(printDark)}`);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-j.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-j.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
