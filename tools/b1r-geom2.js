'use strict';
/**
 * b1r-geom2.js — 几何归因：pageHeight 变化是否可归因于 P1-5(font-weight 650→600)，以及 sticky 覆盖正文
 * 用法: node tools/b1r-geom2.js
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
const OLD = 'http://127.0.0.1:8788';
const PAGES = [
  '/paper/reference/world-configuration/',
  '/paper/dev/dialogs/',
  '/paper/dev/particles/',
  '/paper/reference/system-properties/',
];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { determinism: [], p15: [], overlay: {} };

  // 1) 确定性：同页连测两次是否一致；再注入 font-weight:650 看能否复现改前高度
  for (const vp of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 1025, h: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of PAGES) {
      const rec = { vp: vp.w + 'x' + vp.h, page: u, runs: {}, p15: {} };
      await page.goto(NEW + u, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      rec.runs.new1 = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      rec.runs.new2 = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      // 用改前的 650 覆盖回 .alert-title，看高度是否回到改前值
      await page.addStyleTag({ content: '.alert-title,.tg-home{font-weight:650 !important}' });
      await page.waitForTimeout(150);
      rec.p15.with650 = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      await page.goto(OLD + u, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      rec.runs.old = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      await page.addStyleTag({ content: '.alert-title{font-weight:650 !important}' });
      await page.waitForTimeout(150);
      rec.p15.oldWith650 = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      rec.delta = rec.runs.new1 - rec.runs.old;
      rec.deltaAfterRestore650 = rec.p15.with650 - rec.p15.oldWith650;
      out.determinism.push(rec);
      console.log(JSON.stringify(rec));
    }
    await ctx.close();
  }

  // 2) 768 档：展开 TOC 后 sticky 面板是否覆盖正文（overlay）
  {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.querySelector('.toc-side details').open = true; });
    await page.waitForTimeout(200);
    const rec = [];
    for (const y of [0, 300, 900, 3000, 9000]) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120);
      rec.push(await page.evaluate(() => {
        const t = document.querySelector('.toc-side');
        const c = document.querySelector('.content');
        const tb = t.getBoundingClientRect(), cb = c.getBoundingClientRect();
        // 找一条 TOC 底边下方的第一个正文可见文本节点位置
        const els = Array.from(document.querySelectorAll('.article p, .article h2, .article h3'));
        let covered = 0;
        for (const el of els) {
          const b = el.getBoundingClientRect();
          if (b.bottom > tb.top && b.top < tb.bottom && b.right > tb.left && b.left < tb.right) covered++;
        }
        return {
          scrollY: Math.round(window.scrollY),
          tocTop: Math.round(tb.top), tocBottom: Math.round(tb.bottom), tocH: Math.round(tb.height),
          contentTop: Math.round(cb.top),
          tocOverlapsContent: tb.bottom > cb.top,
          articleBlocksCoveredByToc: covered,
          tocHasOwnScroller: t.scrollHeight > t.clientHeight + 1,
          tocBg: getComputedStyle(t).backgroundColor,
          tocZ: getComputedStyle(t).zIndex,
        };
      }));
    }
    out.overlay['768-open'] = rec;
    await ctx.close();
  }

  // 3) 1024/1025 档 sticky 是否盖住面包屑（crumbs 在 content 内，toc 是独立列，应无重叠）
  {
    for (const w of [1024, 1025, 1100]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(120);
      await page.evaluate(() => window.scrollTo(0, 800));
      await page.waitForTimeout(120);
      out.overlay['w' + w] = await page.evaluate(() => {
        const t = document.querySelector('.toc-side');
        const cr = document.querySelector('.crumbs');
        const t2 = t.getBoundingClientRect();
        const c2 = cr ? cr.getBoundingClientRect() : null;
        return {
          tocDisplay: getComputedStyle(t).display,
          tocRect: { t: Math.round(t2.top), b: Math.round(t2.bottom), l: Math.round(t2.left), r: Math.round(t2.right) },
          crumbsTop: c2 ? Math.round(c2.top) : null, crumbsBottom: c2 ? Math.round(c2.bottom) : null,
          overlap: c2 ? (t2.left < c2.right && t2.right > c2.left && t2.top < c2.bottom && t2.bottom > c2.top) : null,
          topbarH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
        };
      });
      await ctx.close();
    }
    console.log(JSON.stringify(out.overlay, null, 1));
  }

  // 4) 锚点跳转 vs 吸顶 TOC：scroll-padding-top 只有 topbar+12，是否足够
  {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.waitForTimeout(150);
    const res = [];
    // 用 location.hash 触发原生锚点跳转（含 scroll-padding-top 语义）
    for (const id of ['', '', '']) {
      // 取前 3 个 h2/h3 的 id
    }
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.article h2[id], .article h3[id]')).slice(0, 3).map((e) => e.id));
    for (const id of ids) {
      await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
      await page.waitForTimeout(120);
      await page.evaluate((h) => { location.hash = '#' + h; }, id);
      await page.waitForTimeout(500);
      res.push(await page.evaluate((h) => {
        const el = document.getElementById(h);
        const b = el.getBoundingClientRect();
        const t = document.querySelector('.toc-side').getBoundingClientRect();
        return {
          id: h,
          headingTopViewport: Math.round(b.top),
          pinnedTocBottom: Math.round(t.bottom),
          topbarH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
          hiddenBehindPinnedToc: b.top < t.bottom,
          scrollPad: getComputedStyle(document.documentElement).scrollPaddingTop,
          matched: location.hash === '#' + h,
        };
      }, id));
    }
    out.anchor = res;
    await ctx.close();
  }

  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-geom2.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log(JSON.stringify(out.anchor, null, 1));
})();
