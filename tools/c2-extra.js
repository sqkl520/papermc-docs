'use strict';
/**
 * c2-extra.js — 补充证据截图（只读 + addStyleTag，不写仓库源码）
 *
 * 两张：
 *   a) 1440 particles 注入后 —— 目视「<p> 内图片被一同压窄 24.6%」这个副作用
 *   b) 390 dialogs **不注入** —— 证明移动端顶部那条 sticky「本页目录」浮层不是本改动造成的
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:8787';
const CSS_B2 = '.article p{max-width:40rem}';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const OUT = path.join(ROOT, 'reports', 'c2-shots');

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--disable-lcd-text', '--hide-scrollbars', '--disable-gpu'] });
  const jobs = [
    { file: '1440-particles-img.png', path: '/paper/dev/particles/', w: 1440, h: 900, inject: true, at: 'img' },
    { file: '1440-dialogs-before.png', path: '/paper/dev/dialogs/', w: 1440, h: 900, inject: false, at: 'mid' },
    { file: '390-dialogs-before.png', path: '/paper/dev/dialogs/', w: 390, h: 844, inject: false, at: 'mid' },
  ];
  for (const j of jobs) {
    const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + j.path, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    await page.evaluate(async () => {
      for (const im of [...document.images]) { im.loading = 'eager'; try { await im.decode(); } catch (e) {} }
    });
    if (j.inject) { await page.addStyleTag({ content: CSS_B2 }); await page.waitForTimeout(100); }
    const y = await page.evaluate((mode) => {
      if (mode === 'img') {
        const im = [...document.querySelectorAll('img.content-img')].find((i) => i.naturalWidth > 100);
        if (!im) return 0;
        return Math.max(0, Math.round(window.scrollY + im.getBoundingClientRect().top - 120));
      }
      return Math.round((document.documentElement.scrollHeight - window.innerHeight) * 0.45);
    }, j.at);
    await page.evaluate((t) => window.scrollTo({ top: t, left: 0, behavior: 'instant' }), y);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, j.file) });
    console.log('shot ' + j.file + '  scrollY=' + y);
    await ctx.close();
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
