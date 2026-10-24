'use strict';
/**
 * b1r-edge.js — 两个边界：
 *   A. 1023 / 1024 / 1025 的 TOC 是否存在（断点死区）
 *   B. 抽屉"打开"时丢位置的机制（docH / body overflow / scrollY 变化）
 * 用法: node tools/b1r-edge.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const LOGP = path.join(ROOT, 'reports', '.b1r-edge.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787', OLD = 'http://127.0.0.1:8788';
function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

(async () => {
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { band: [], drawerMech: [] };

  // ---------- A. 断点死区 ----------
  for (const w of [1022, 1023, 1024, 1025, 1026]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const t = document.querySelector('.toc-side');
      const d = t ? t.querySelector('details') : null;
      const links = t ? Array.from(t.querySelectorAll('ol a')).filter((a) => a.getBoundingClientRect().height > 0) : [];
      const drawerToc = document.querySelector('#drawer-toc');
      return {
        vw: window.innerWidth,
        tocDisplay: t ? getComputedStyle(t).display : null,
        tocH: t ? Math.round(t.getBoundingClientRect().height) : null,
        detailsOpen: d ? d.open : null,
        visibleTocLinks: links.length,
        drawerTocPresent: !!drawerToc,
        drawerTocDisplay: drawerToc ? getComputedStyle(drawerToc).display : null,
        hasAnyToc: (t && getComputedStyle(t).display !== 'none' && links.length > 0) || (drawerToc && getComputedStyle(drawerToc).display !== 'none'),
      };
    });
    out.band.push(r); log('BAND ' + JSON.stringify(r));
    await ctx.close();
  }

  // ---------- B. 抽屉打开机制 ----------
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base + '/paper/adding-plugins/', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 6000));
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => ({
      y: Math.round(window.scrollY), docH: Math.round(document.documentElement.scrollHeight),
      bodyOverflow: getComputedStyle(document.body).overflow, htmlOverflow: getComputedStyle(document.documentElement).overflow,
      activeEl: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
    }));
    await page.click('#nav-toggle');
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      y: Math.round(window.scrollY), docH: Math.round(document.documentElement.scrollHeight),
      bodyOverflow: getComputedStyle(document.body).overflow, htmlOverflow: getComputedStyle(document.documentElement).overflow,
      activeEl: document.activeElement ? (document.activeElement.id || document.activeElement.tagName + '.' + document.activeElement.className) : null,
      drawerScrollTop: (() => { const s = document.getElementById('sidebar'); return s ? Math.round(s.scrollTop) : null; })(),
    }));
    const rec = { tag, before, after, deltaY: after.y - before.y, docHDelta: after.docH - before.docH };
    out.drawerMech.push(rec); log('MECH ' + JSON.stringify(rec));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-edge.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
