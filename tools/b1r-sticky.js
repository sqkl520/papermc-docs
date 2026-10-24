'use strict';
/**
 * b1r-sticky.js — 把 batch1 新增的 position:sticky/z-index 单独关掉做 A/B，隔离它引入的问题：
 *   A. 展开 TOC 后吸顶面板是否覆盖正文（768 / 812 横屏 / 390）
 *   B. 点目录项跳转后标题是否落在吸顶面板后面（scroll-padding-top 只算了顶栏）
 *   C. ≥1025 档 ol 内部滚动 vs 改前整列滚动（新增 scrollbar 位置）
 * 用法: node tools/b1r-sticky.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/particles/';

const KILL_STICKY = `.toc-side{position:static !important;z-index:auto !important}
.toc-side .toc-title{position:static !important}`;

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const probeOverlap = () => {
  const t = document.querySelector('.toc-side');
  const tb = t.getBoundingClientRect();
  const blocks = Array.from(document.querySelectorAll('.article p, .article h2, .article h3, .article li'));
  let covered = 0; const sample = [];
  for (const el of blocks) {
    const b = el.getBoundingClientRect();
    if (b.height > 0 && b.bottom > tb.top && b.top < tb.bottom && b.width > 0) {
      covered++;
      if (sample.length < 3) sample.push({ tag: el.tagName, top: Math.round(b.top), txt: (el.textContent || '').trim().slice(0, 26) });
    }
  }
  return {
    scrollY: Math.round(window.scrollY),
    tocTop: Math.round(tb.top), tocBottom: Math.round(tb.bottom), tocH: Math.round(tb.height),
    pctVh: +(100 * tb.height / window.innerHeight).toFixed(1),
    pos: getComputedStyle(t).position, z: getComputedStyle(t).zIndex,
    coveredBlocks: covered, sample,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { overlayAB: [], anchorAB: [], railScroll: {} };

  // ---------- A. 展开 TOC 覆盖正文：sticky ON vs OFF ----------
  for (const vp of [{ n: '768x1024', w: 768, h: 1024 }, { n: '812x375', w: 812, h: 375 }, { n: '390x844', w: 390, h: 844 }]) {
    for (const mode of ['stickyON', 'stickyOFF']) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      if (mode === 'stickyOFF') await page.addStyleTag({ content: KILL_STICKY });
      await page.waitForTimeout(200);
      // 用户展开目录（<1025 允许手动展开）
      await page.evaluate(() => { document.querySelector('.toc-side details').open = true; });
      await page.waitForTimeout(250);
      for (const y of [0, 400, 1200]) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(130);
        const r = await page.evaluate(probeOverlap);
        r.vp = vp.n; r.mode = mode;
        out.overlayAB.push(r);
        log('OVERLAY ' + JSON.stringify(r));
      }
      await ctx.close();
    }
  }

  // ---------- B. 点目录项跳转：标题是否藏在吸顶面板后 ----------
  for (const vp of [{ n: '768x1024', w: 768, h: 1024 }, { n: '812x375', w: 812, h: 375 }, { n: '390x844', w: 390, h: 844 }, { n: '1025x800', w: 1025, h: 800 }]) {
    for (const mode of ['stickyON', 'stickyOFF']) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      if (mode === 'stickyOFF') await page.addStyleTag({ content: KILL_STICKY });
      await page.waitForTimeout(200);
      // 模拟真实用户：展开目录 → 点第 3 项（用真实 click，走浏览器锚点滚动 + scroll-padding-top）
      await page.evaluate(() => { document.querySelector('.toc-side details').open = true; });
      await page.waitForTimeout(200);
      const link = page.locator('.toc-side ol li a').nth(2);
      const id = (await link.getAttribute('href')).slice(1);
      await link.click();
      await page.waitForTimeout(700);
      const r = await page.evaluate((hid) => {
        const el = document.getElementById(hid);
        const b = el.getBoundingClientRect();
        const t = document.querySelector('.toc-side').getBoundingClientRect();
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        return {
          id: hid,
          headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom),
          tocTop: Math.round(t.top), tocBottom: Math.round(t.bottom), tocH: Math.round(t.height),
          topbarBottom: Math.round(topbar.bottom),
          scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
          headingHiddenBehindToc: b.top < t.bottom && b.bottom > t.top,
          headingAboveTopbar: b.top < topbar.bottom,
          visiblePxOfHeading: Math.max(0, Math.min(b.bottom, t.top) - Math.max(b.top, topbar.bottom)),
          headingHeight: Math.round(b.height),
        };
      }, id);
      r.vp = vp.n; r.mode = mode;
      out.anchorAB.push(r);
      log('ANCHOR ' + JSON.stringify(r));
      await ctx.close();
    }
  }

  // ---------- C. 桌面 rail：内层 ol 滚动条 vs 改前整列滚动 ----------
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1280x800', w: 1280, h: 800 }, { n: '1440x600', w: 1440, h: 600 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    out.railScroll[vp.n] = await page.evaluate(() => {
      const t = document.querySelector('.toc-side');
      const ol = t.querySelector('ol');
      const tb = t.getBoundingClientRect();
      const ob = ol.getBoundingClientRect();
      return {
        asideClientH: t.clientHeight, asideScrollH: t.scrollHeight,
        asideScrollbar: t.scrollHeight > t.clientHeight + 1,
        olClientH: ol.clientHeight, olScrollH: ol.scrollHeight,
        olScrollbar: ol.scrollHeight > ol.clientHeight + 1,
        olMaxH: getComputedStyle(ol).maxHeight, olOverflowY: getComputedStyle(ol).overflowY,
        asideBottom: Math.round(tb.bottom), olBottom: Math.round(ob.bottom),
        deadSpaceBelowOl: Math.round(tb.bottom - ob.bottom),
        viewportH: window.innerHeight,
        // ol 的滚动条是否会出现在 aside 内部（双滚动容器）
        nestedScrollers: [t, ol].filter((e) => e.scrollHeight > e.clientHeight + 1).length,
      };
    });
    log('RAIL ' + vp.n + ' ' + JSON.stringify(out.railScroll[vp.n]));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-sticky.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-sticky.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE');
})();
