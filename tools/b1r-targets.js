'use strict';
/**
 * b1r-targets.js — P0-3 完整性：>=1024 断点把大量 min-height 归零，P0-3 只补了 2 处。
 * 逐类量命中区，找出仍然 <24x24 的可点目标。
 * 用法: node tools/b1r-targets.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const LOGP = path.join(ROOT, 'reports', '.b1r-targets.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

const SELECTORS = [
  'a.side-home', '.code-copy', '.side-group-title', '.side-cat>summary', '.side-section-title',
  'summary.side-section-title', 'a.side-section-title', '.side-group a', '.side-sec a', '.crumbs a',
  'a.chip', '.tg-home', '.details-summary', '.side-filter', '.toc-side a', '.sec-switch a',
  '#theme-toggle', '#nav-toggle', '.search-open', '.heading-anchor', '.pager a',
];

(async () => {
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1025x800', w: 1025, h: 800 }, { n: '1024x800', w: 1024, h: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(450);
    const rows = [];
    for (const sel of SELECTORS) {
      const r = await page.evaluate((s) => {
        const els = Array.from(document.querySelectorAll(s)).filter((e) => e.getBoundingClientRect().height > 0);
        if (!els.length) return { sel: s, n: 0 };
        let minW = 1e9, minH = 1e9, under = 0;
        for (const e of els) {
          const b = e.getBoundingClientRect();
          minW = Math.min(minW, b.width); minH = Math.min(minH, b.height);
          if (b.width < 24 || b.height < 24) under++;
        }
        return { sel: s, n: els.length, minW: +minW.toFixed(1), minH: +minH.toFixed(1), under24: under };
      }, sel);
      if (r.n) rows.push(r);
    }
    const violators = rows.filter((r) => r.under24 > 0);
    log('TARGETS ' + vp.n + ' violators=' + violators.length + ' :: ' + JSON.stringify(rows));
    await ctx.close();
  }
  await browser.close();
  console.log('DONE');
})();
