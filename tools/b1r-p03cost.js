'use strict';
/**
 * b1r-p03cost.js — 精确量化批 1 的 P0-3（.code-copy 21.2→28px）对 ≥1024 档 pageHeight 的贡献
 * 用法: node tools/b1r-p03cost.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const LOGP = path.join(ROOT, 'reports', '.b1r-p03.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

// 改前(.code-copy 无 min-height)：font-size .72rem; padding .1rem .45rem; line-height 1.7
const PRE = `.code-copy{min-height:0 !important;min-width:0 !important;font-size:.72rem !important;padding:.1rem .45rem !important;line-height:1.7 !important}`;

(async () => {
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1280x800', w: 1280, h: 800 }, { n: '1025x800', w: 1025, h: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of ['/paper/dev/particles/', '/paper/dev/dialogs/', '/paper/reference/system-properties/']) {
      await page.goto(NEW + u, { waitUntil: 'load' });
      await page.waitForTimeout(450);
      const base = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      const n = await page.evaluate(() => document.querySelectorAll('.code-copy').length);
      const gh = await page.evaluate(() => { const c = document.querySelector('.code-copy'); const b = c.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; });
      const t = await page.addStyleTag({ content: PRE });
      await page.waitForTimeout(220);
      const restored = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      const gh2 = await page.evaluate(() => { const c = document.querySelector('.code-copy'); const b = c.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; });
      await page.evaluate((e) => e.remove(), t);
      const rec = { vp: vp.n, page: u, baseH: base, copyBtns: n, copyNow: gh, copyPreMobile: gh2, heightIfPreMobileCopy: restored, p03CostPx: base - restored };
      log('P03 ' + JSON.stringify(rec));
    }
    await ctx.close();
  }
  await browser.close();
  console.log('DONE');
})();
