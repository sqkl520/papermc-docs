'use strict';
/** critique-red-probe5.js — 索引加载时延（file vs http）+ 断图正确判定（gate on complete）+ 侧栏 21px 明细 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = process.cwd();
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const fileUrl = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { indexLoad: {}, images: {}, sidebar21: {} };

  for (const [mode, url] of [
    ['file', fileUrl('paper/dev/dialogs/index.html')],
    ['http', 'http://127.0.0.1:8787/paper/dev/dialogs/'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(400);
    // 到「第一个结果出现」的端到端时延（模拟真实用户：Ctrl+K → 立刻打字）
    const t0 = Date.now();
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => { const d = document.querySelector('#search-dialog'); return d && d.open; }, { timeout: 8000 });
    const t_open = Date.now() - t0;
    await page.fill('#search-input', 'dialog');
    await page.waitForFunction(() => document.querySelectorAll('.search-results li, #search-results li').length > 0, { timeout: 30000, polling: 50 });
    const t_first = Date.now() - t0;
    const pages = await page.evaluate(() => (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) ? window.__LIBRARY_SEARCH__.pages.length : null);
    out.indexLoad[mode] = { openMs: t_open, ctrlKToFirstResultMs: t_first, idxPages: pages };
    console.log('INDEX[' + mode + '] CtrlK→开=' + t_open + 'ms  CtrlK→首结果=' + t_first + 'ms  pages=' + pages);
    await ctx.close();
  }

  // 断图：正确地滚动整页并等待 complete
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    for (const p of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
      await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
      // 用 CDP 之外的方式：逐步滚动到底触发 lazy load
      await page.evaluate(async () => {
        const H = document.documentElement.scrollHeight;
        for (let y = 0; y < H; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(2500);
      const d = await page.evaluate(() => {
        const all = [...document.querySelectorAll('img')];
        const pending = all.filter((i) => !i.complete).length;
        const noSrc = all.filter((i) => !i.getAttribute('src')).map((i) => ({ cls: i.className, inLb: !!i.closest('dialog,.lightbox') }));
        const broken = all.filter((i) => i.complete && i.naturalWidth === 0).map((i) => ({ src: i.getAttribute('src'), cls: i.className, loading: i.getAttribute('loading'), w: i.getAttribute('width'), h: i.getAttribute('height') }));
        return { total: all.length, pending, noSrc, broken, brokenCount: broken.length };
      });
      out.images[p] = d;
      console.log('IMG ' + p.padEnd(40) + ' total=' + d.total + ' pending=' + d.pending + ' broken=' + d.brokenCount + ' noSrc=' + JSON.stringify(d.noSrc));
      if (d.broken.length) console.log('     ' + JSON.stringify(d.broken.slice(0, 6)));
    }
    await ctx.close();
  }

  // 桌面侧栏 21px 明细
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(300);
    out.sidebar21 = await page.evaluate(() => {
      const rows = [];
      for (const a of document.querySelectorAll('.sidebar a[href]')) {
        const r = a.getBoundingClientRect();
        if (!r.height) continue;
        rows.push({ h: Math.round(r.height), w: Math.round(r.width), cls: typeof a.className === 'string' ? a.className.slice(0, 30) : '', txt: (a.textContent || '').trim().slice(0, 22), fs: getComputedStyle(a).fontSize, lh: getComputedStyle(a).lineHeight, pad: getComputedStyle(a).padding, disp: getComputedStyle(a).display });
      }
      const hist = {};
      for (const r of rows) { const k = r.h; hist[k] = (hist[k] || 0) + 1; }
      return { count: rows.length, hist, under24: rows.filter((r) => r.h < 24).sort((a, b) => a.h - b.h).slice(0, 14), tallest: rows.slice().sort((a, b) => b.h - a.h).slice(0, 4) };
    });
    console.log('SIDEBAR count=' + out.sidebar21.count + ' hist=' + JSON.stringify(out.sidebar21.hist));
    console.log('  under24 sample=' + JSON.stringify(out.sidebar21.under24));
    // 侧栏可滚动高度与总高
    out.sidebarScroll = await page.evaluate(() => {
      const s = document.querySelector('.sidebar');
      const inner = s ? s.scrollHeight : 0;
      return { scrollHeight: inner, clientHeight: s ? s.clientHeight : 0, needsScroll: s ? inner > s.clientHeight + 2 : null };
    });
    console.log('SIDEBAR scroll=' + JSON.stringify(out.sidebarScroll));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe5.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n写出 reports/critique-red-probe5.json');
})();
