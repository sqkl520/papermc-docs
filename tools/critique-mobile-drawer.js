'use strict';
/**
 * critique-mobile-drawer.js —— 隔离验证：开/关抽屉是否改变文档滚动位置（排除 smooth scroll 干扰）
 * 用法: node tools/critique-mobile-drawer.js
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

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const report = {};
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const steps = [];
    for (const url of ['/paper/reference/world-configuration/', '/paper/dev/dialogs/']) {
      await page.goto(BASE + url, { waitUntil: 'load' });
      // 关掉平滑滚动，避免动画造成的假位移
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(300);
      const rec = [];
      const snap = async (label) => {
        const s = await page.evaluate(() => ({
          y: Math.round(window.scrollY),
          docH: Math.round(document.documentElement.scrollHeight),
          bodyOverflow: getComputedStyle(document.body).overflow,
          active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
        }));
        rec.push({ label, ...s });
      };
      await page.evaluate(() => window.scrollTo(0, 12000));
      await page.waitForTimeout(900);
      await snap('afterJump');
      await page.click('#nav-toggle');
      await page.waitForTimeout(900);
      await snap('drawerOpen');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(900);
      await snap('afterEsc');
      // 再开再关一次，看是否累积
      await page.click('#nav-toggle');
      await page.waitForTimeout(900);
      await snap('drawerOpen2');
      await page.click('#nav-scrim', { position: { x: 5, y: 400 }, force: true });
      await page.waitForTimeout(900);
      await snap('afterScrimClose');
      const deltas = rec.map((r, i) => (i ? r.y - rec[i - 1].y : 0));
      steps.push({ url, rec, deltas });
    }
    report[vp.n] = steps;

    /* 归因：滚动锁定 vs 焦点滚入 */
    const p2 = await ctx.newPage();
    await p2.goto(BASE + '/paper/reference/world-configuration/', { waitUntil: 'load' });
    await p2.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await p2.waitForTimeout(300);
    const iso = [];
    const s2 = async (label) => iso.push({ label, y: await p2.evaluate(() => Math.round(window.scrollY)) });
    await p2.evaluate(() => window.scrollTo(0, 12000));
    await p2.waitForTimeout(700);
    await s2('baseline');
    await p2.evaluate(() => { document.body.style.overflow = 'hidden'; });
    await p2.waitForTimeout(600);
    await s2('afterBodyOverflowHidden');
    await p2.evaluate(() => { document.body.style.overflow = ''; });
    await p2.waitForTimeout(400);
    await s2('afterBodyOverflowRestore');
    await p2.evaluate(() => { document.querySelector('#sidebar').removeAttribute('inert'); document.body.classList.add('nav-open'); });
    await p2.waitForTimeout(400);
    await s2('afterNavOpenClassOnly');
    await p2.evaluate(() => { document.querySelector('#side-filter').focus(); });
    await p2.waitForTimeout(600);
    await s2('afterFilterFocus');
    await p2.evaluate(() => { document.querySelector('#sidebar').setAttribute('inert', ''); document.body.classList.remove('nav-open'); document.body.style.overflow = ''; });
    report[vp.n + '_isolation'] = iso;
    await p2.close();

    /* 归因 2：DOM.click()（无 Playwright 的滚动介入）vs Playwright click */
    const p3 = await ctx.newPage();
    await p3.goto(BASE + '/paper/reference/world-configuration/', { waitUntil: 'load' });
    await p3.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await p3.waitForTimeout(300);
    const mech = [];
    const s3 = async (label) => mech.push({ label, y: await p3.evaluate(() => Math.round(window.scrollY)), navOpen: await p3.evaluate(() => document.body.classList.contains('nav-open')) });
    await p3.evaluate(() => window.scrollTo(0, 12000));
    await p3.waitForTimeout(700);
    await s3('baseline');
    for (let i = 0; i < 2; i++) {
      await p3.evaluate(() => document.getElementById('nav-toggle').click());
      await p3.waitForTimeout(700);
      await s3('domClickOpen#' + (i + 1));
      await p3.evaluate(() => document.getElementById('nav-toggle').click());
      await p3.waitForTimeout(700);
      await s3('domClickClose#' + (i + 1));
    }
    await p3.evaluate(() => document.getElementById('nav-toggle').scrollIntoViewIfNeeded ? document.getElementById('nav-toggle').scrollIntoViewIfNeeded() : null);
    await p3.waitForTimeout(400);
    await s3('afterScrollIntoViewIfNeeded');
    await p3.click('#nav-toggle');
    await p3.waitForTimeout(700);
    await s3('pwClickOpen');
    report[vp.n + '_mechanism'] = mech;
    await p3.close();

    /* 归因 3：只 focus 顶栏按钮 / 用 preventScroll 验证最小修复 */
    const p4 = await ctx.newPage();
    await p4.goto(BASE + '/paper/reference/world-configuration/', { waitUntil: 'load' });
    await p4.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await p4.waitForTimeout(300);
    const foc = [];
    const s4 = async (label) => foc.push({ label, y: await p4.evaluate(() => Math.round(window.scrollY)) });
    await p4.evaluate(() => window.scrollTo(0, 12000));
    await p4.waitForTimeout(700);
    await s4('baseline');
    await p4.evaluate(() => document.getElementById('nav-toggle').focus());
    await p4.waitForTimeout(500);
    await s4('focusNavToggle');
    await p4.evaluate(() => window.scrollTo(0, 12000));
    await p4.waitForTimeout(500);
    await s4('reBaseline');
    await p4.evaluate(() => document.getElementById('nav-toggle').focus({ preventScroll: true }));
    await p4.waitForTimeout(500);
    await s4('focusNavTogglePreventScroll');
    await p4.evaluate(() => document.getElementById('nav-toggle').focus({ preventScroll: false }));
    await p4.waitForTimeout(500);
    await s4('focusNavToggleDefaultAgain');
    report[vp.n + '_focusCause'] = foc;
    await p4.close();
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(require('os').tmpdir(), 'critique-mobile-drawer.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 1));
})();
