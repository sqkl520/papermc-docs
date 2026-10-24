'use strict';
/** critique-red-probe3.js — file:// 搜索复测（给足等待）+ 断图定位 + 参考页结构 + 上游 measure 对比准备 */
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
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const out = {};

  for (const mode of ['file', 'http']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('pageerror:' + String(e.message).slice(0, 200)));
    page.on('requestfailed', (r) => errs.push('reqfail:' + r.url().slice(0, 160) + ' :: ' + ((r.failure() || {}).errorText)));
    const url = mode === 'file' ? fileUrl('paper/dev/dialogs/index.html') : 'http://127.0.0.1:8787/paper/dev/dialogs/';
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(700);

    const before = await page.evaluate(() => ({
      scripts: [...document.querySelectorAll('script')].map((s) => s.getAttribute('src') || '(inline)'),
      idxLoaded: typeof window.SEARCH_INDEX !== 'undefined' || typeof window.__SEARCH_INDEX__ !== 'undefined' || Object.keys(window).filter((k) => /index/i.test(k)).slice(0, 8),
      brokenImgs: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      imgs: [...document.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), nw: i.naturalWidth })),
      globals: Object.keys(window).filter((k) => /^(LCB|SEARCH|DOCS|SITE)/i.test(k)),
    }));

    await page.keyboard.press('Control+k');
    let opened = false;
    try { await page.waitForFunction(() => { const d = document.querySelector('#search-dialog'); return d && d.open; }, { timeout: 8000 }); opened = true; } catch (e) {}
    const t0 = Date.now();
    let items = 0, empty = false, count = null;
    if (opened) {
      await page.fill('#search-input', 'dialog');
      try {
        await page.waitForFunction(() => document.querySelectorAll('.search-results li, #search-results li').length > 0 || document.querySelector('.sr-empty'), { timeout: 12000 });
      } catch (e) {}
      const st = await page.evaluate(() => ({
        items: document.querySelectorAll('.search-results li, #search-results li').length,
        empty: !!document.querySelector('.sr-empty'),
        emptyTxt: (document.querySelector('.sr-empty') || {}).textContent || null,
        count: (document.querySelector('.sr-count') || {}).textContent || null,
        scriptsNow: [...document.querySelectorAll('script')].map((s) => s.getAttribute('src') || '(inline)'),
      }));
      items = st.items; empty = st.empty; count = st.count;
      out[mode] = { url, opened, ms: Date.now() - t0, ...st, errs, before };
    } else {
      out[mode] = { url, opened: false, items: 0, errs, before };
    }
    console.log('=== ' + mode + ' === opened=' + opened + ' items=' + items + ' empty=' + empty + ' count=' + count + ' ms=' + (Date.now() - t0));
    console.log('  scripts(before)=' + JSON.stringify(before.scripts));
    if (out[mode].scriptsNow) console.log('  scripts(after)=' + JSON.stringify(out[mode].scriptsNow));
    console.log('  brokenImgs=' + JSON.stringify(before.brokenImgs));
    console.log('  errs=' + JSON.stringify(errs.slice(0, 6)));
    await ctx.close();
  }

  // 参考页结构体检
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787/paper/reference/world-configuration/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const art = document.querySelector('.article');
      const ps = [...art.querySelectorAll('p')];
      const cls = {};
      for (const p of ps) { const k = (p.className || '(none)') + '|' + (p.closest('td,th') ? 'inTable' : p.closest('li') ? 'inLi' : 'bare'); cls[k] = (cls[k] || 0) + 1; }
      const tables = [...art.querySelectorAll('table')].map((t) => ({ rows: t.rows.length, cols: t.rows[0] ? t.rows[0].cells.length : 0, w: Math.round(t.getBoundingClientRect().width) }));
      const pre = [...art.querySelectorAll('pre')].map((p) => ({ sw: p.scrollWidth, cw: p.clientWidth, fs: getComputedStyle(p).fontSize }));
      const h2 = art.querySelectorAll('h2').length, h3 = art.querySelectorAll('h3').length;
      return { pTotal: ps.length, pByClass: cls, tables, pre, h2, h3, tocLinks: document.querySelectorAll('.toc-side a').length, pageH: document.documentElement.scrollHeight };
    });
    out.referencePage = s;
    console.log('=== reference page === ' + JSON.stringify(s, null, 0).slice(0, 1200));
    await ctx.close();
  }

  // 全站断图审计（http:// 与 file:// 各一遍，只看 content-img/external-image）
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pages = ['/paper/dev/dialogs/', '/paper/dev/', '/paper/admin/', '/velocity/tuning/'];
    for (const p of pages) {
      await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(500);
      const d = await page.evaluate(() => ({
        imgs: [...document.querySelectorAll('img')].length,
        broken: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      }));
      console.log('IMG ' + p.padEnd(26) + ' total=' + d.imgs + ' broken=' + JSON.stringify(d.broken));
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe3.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n写出 reports/critique-red-probe3.json');
})();
