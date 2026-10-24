'use strict';
/**
 * b1r-toc.js — 攻击 P0-1 的 matchMedia 强制展开：用户意图覆盖、状态丢失、resize 成本
 * 用法: node tools/b1r-toc.js
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

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = {};

  const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__syncCalls = 0;
    const MM = window.matchMedia.bind(window);
    window.matchMedia = function (q) { const m = MM(q); return m; };
  });
  await page.goto(NEW + PAGE, { waitUntil: 'load' });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
  await page.waitForTimeout(300);

  const state = () => page.evaluate(() => {
    const d = document.querySelector('.toc-side details');
    const t = document.querySelector('.toc-side');
    return {
      vw: window.innerWidth,
      open: d ? d.open : null,
      hasOpenAttr: d ? d.hasAttribute('open') : null,
      tocDisplay: t ? getComputedStyle(t).display : null,
      tocH: t ? Math.round(t.getBoundingClientRect().height) : null,
      olH: t && t.querySelector('ol') ? Math.round(t.querySelector('ol').getBoundingClientRect().height) : null,
    };
  });

  out.s1_1024_initial = await state();

  // A) 在 1024 手动展开（用户意图 = 想看目录）
  await page.evaluate(() => { document.querySelector('.toc-side details').open = true; });
  await page.waitForTimeout(100);
  out.s2_1024_userExpanded = await state();

  // B) 放大到 1025（跨断点）→ 期望保持展开；然后缩回 1024 → 用户展开状态是否保留？
  await page.setViewportSize({ width: 1025, height: 800 });
  await page.waitForTimeout(200);
  out.s3_at1025 = await state();
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.waitForTimeout(200);
  out.s4_back_to1024 = await state();

  // C) 1025 下用户手动折叠（桌面用户想收起右栏目录）→ 是否被强制展开覆盖
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(200);
  out.s5_at1200 = await state();
  await page.evaluate(() => { document.querySelector('.toc-side details').open = false; });
  await page.waitForTimeout(100);
  out.s6_1200_userCollapsed = await state();
  // 任何 resize（哪怕 1px、甚至打开软键盘/地址栏伸缩）都会触发 syncToc
  await page.setViewportSize({ width: 1200, height: 801 });
  await page.waitForTimeout(200);
  out.s7_after_1px_resize = await state();
  await page.setViewportSize({ width: 1199, height: 800 });
  await page.waitForTimeout(200);
  out.s8_at1199 = await state();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(200);
  out.s9_back_to1200 = await state();

  // D) 用户点击 summary 折叠后，下一次 resize 是否又展开
  await page.evaluate(() => document.querySelector('.toc-side details').open = true);
  await page.waitForTimeout(80);
  await page.click('.toc-side .toc-title');
  await page.waitForTimeout(200);
  out.s10_clickedToCollapse = await state();
  await page.setViewportSize({ width: 1200, height: 795 });
  await page.waitForTimeout(250);
  out.s11_afterResize_postClick = await state();

  // E) syncToc 的 resize 成本：统计 resize 处理函数耗时 + 强制布局次数
  out.resizeCost = await page.evaluate(async () => {
    const folds = document.querySelectorAll('.toc-side .toc-fold');
    // 直接量 syncToc 的等价成本：querySelectorAll + 逐项写 open
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      const f = document.querySelectorAll('.toc-side .toc-fold');
      for (let k = 0; k < f.length; k++) { if (f[k].open) f[k].open = true; else f[k].removeAttribute('open'); }
    }
    const t1 = performance.now();
    // 对比：不做 DOM 写的空循环
    const t2 = performance.now();
    for (let i = 0; i < 200; i++) { document.querySelectorAll('.toc-side .toc-fold'); }
    const t3 = performance.now();
    return { loops: 200, withWriteMs: +(t1 - t0).toFixed(2), queryOnlyMs: +(t3 - t2).toFixed(2), foldCount: folds.length };
  });

  // F) 真实 resize 事件期间的长任务 / 布局次数
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(() => { window.__rs = 0; window.addEventListener('resize', () => { window.__rs++; }); });
  for (let i = 0; i < 9; i++) {
    await page.setViewportSize({ width: 1200 + (i % 2), height: 800 });
    await page.waitForTimeout(30);
  }
  const metrics = await cdp.send('Performance.getMetrics');
  const pick = (n) => { const m = metrics.metrics.find((x) => x.name === n); return m ? m.value : null; };
  out.resizeMetrics = {
    resizeEvents: await page.evaluate(() => window.__rs),
    LayoutCount: pick('LayoutCount'), RecalcStyleCount: pick('RecalcStyleCount'),
  };

  // G) 页面初始加载时 syncToc() 是否会覆盖 layout.js 的默认折叠（JS 未执行前的 CLS）
  out.initialToggleCLS = await (async () => {
    const p2 = await ctx.newPage();
    await p2.goto(NEW + PAGE, { waitUntil: 'load' });
    await p2.waitForTimeout(400);
    return p2.evaluate(() => {
      const d = document.querySelector('.toc-side details');
      return { open: d.open, tocH: Math.round(document.querySelector('.toc-side').getBoundingClientRect().height), h1ViewportTop: Math.round(document.querySelector('h1').getBoundingClientRect().top) };
    });
  })();

  await ctx.close();
  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-toc.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log(JSON.stringify(out, null, 1));
})();
