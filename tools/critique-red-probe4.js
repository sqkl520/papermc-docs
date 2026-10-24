'use strict';
/** critique-red-probe4.js — file:// 搜索正确定时复测 + lightbox 断图定位 + 长页结构 */
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
  const out = { searchByProtocol: {}, lightbox: null, reference: null, listMeasure: null };

  for (const [mode, url] of [
    ['file', fileUrl('paper/dev/dialogs/index.html')],
    ['http', 'http://127.0.0.1:8787/paper/dev/dialogs/'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('pageerror:' + String(e.message).slice(0, 200)));
    page.on('requestfailed', (r) => errs.push('reqfail:' + r.url().slice(0, 180) + ' :: ' + ((r.failure() || {}).errorText) + ' :: ' + (r.failure() && r.failure().errorText === 'net::ERR_ABORTED' ? 'aborted' : '')));
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(500);
    const t0 = Date.now();
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => { const d = document.querySelector('#search-dialog'); return d && d.open; }, { timeout: 8000 });
    const openMs = Date.now() - t0;
    const t1 = Date.now();
    // 正确等待：等到「有结果 li」或「出现未载入提示」或 20s 超时
    let verdict = 'timeout';
    try {
      await page.waitForFunction(() => {
        const li = document.querySelectorAll('.search-results li, #search-results li').length;
        const em = document.querySelector('.sr-empty');
        const emTxt = em ? (em.textContent || '') : '';
        if (li > 0) return 'results';
        if (emTxt.indexOf('未能载入') >= 0) return 'failed';
        return false;
      }, { timeout: 25000, polling: 200 });
      verdict = await page.evaluate(() => (document.querySelectorAll('.search-results li, #search-results li').length > 0 ? 'results' : 'failed'));
    } catch (e) { verdict = 'timeout'; }
    const loadMs = Date.now() - t1;
    await page.fill('#search-input', 'dialog');
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => ({
      items: document.querySelectorAll('.search-results li, #search-results li').length,
      emptyTxt: (document.querySelector('.sr-empty') || {}).textContent || null,
      count: (document.querySelector('.sr-count') || {}).textContent || null,
      idxPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) ? window.__LIBRARY_SEARCH__.pages.length : null,
      idxBytes: null,
    }));
    out.searchByProtocol[mode] = { url, openMs, loadMs, verdict, ...st, errs };
    console.log('SEARCH[' + mode + '] verdict=' + verdict + ' openMs=' + openMs + ' loadMs=' + loadMs + ' items=' + st.items + ' idxPages=' + st.idxPages + ' count=' + st.count + ' emptyTxt=' + String(st.emptyTxt).slice(0, 60) + ' errs=' + JSON.stringify(errs.slice(0, 4)));
    await ctx.close();
  }

  // lightbox / img 无 src 定位
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(400);
    out.lightbox = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')].map((i) => ({
        src: i.getAttribute('src'), cls: i.className, inLightbox: !!i.closest('.lightbox, dialog'), nw: i.naturalWidth, alt: i.getAttribute('alt'),
      }));
      return { imgs, noSrcCount: imgs.filter((x) => !x.src).length, brokenReal: imgs.filter((x) => x.src && x.nw === 0).length };
    });
    console.log('LIGHTBOX ' + JSON.stringify(out.lightbox));
    await ctx.close();
  }

  // 长页结构（world-configuration）
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787/paper/reference/world-configuration/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(300);
    out.reference = await page.evaluate(() => {
      const art = document.querySelector('.article');
      const cnt = (s) => art.querySelectorAll(s).length;
      const listW = [...art.querySelectorAll('li > p')].slice(0, 8).map((p) => ({ w: Math.round(p.getBoundingClientRect().width), fs: getComputedStyle(p).fontSize, t: (p.textContent || '').trim().slice(0, 40) }));
      const ulDepth = (() => { let d = 0; art.querySelectorAll('ul,ol').forEach((u) => { let n = 0, p = u; while (p && p !== art) { if (p.tagName === 'UL' || p.tagName === 'OL') n++; p = p.parentElement; } d = Math.max(d, n); }); return d; })();
      const firstText = (art.innerText || '').slice(0, 300);
      const tocItems = document.querySelectorAll('.toc-side a').length;
      const sideToc = document.querySelectorAll('.side-toc a').length;
      return {
        h1: cnt('h1'), h2: cnt('h2'), h3: cnt('h3'), h4: cnt('h4'), h5: cnt('h5'), h6: cnt('h6'),
        ul: cnt('ul'), ol: cnt('ol'), li: cnt('li'), table: cnt('table'), pre: cnt('pre'), code: cnt('code'),
        strong: cnt('strong'), a: cnt('a'), img: cnt('img'),
        listW, ulDepth, tocItems, sideToc, pageH: document.documentElement.scrollHeight, firstText,
      };
    });
    console.log('REF ' + JSON.stringify({ ...out.reference, firstText: undefined }));
    console.log('     firstText=' + JSON.stringify(out.reference.firstText));
    await ctx.close();
  }

  // 列表内正文的 measure（949px 的 li>p）
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787/paper/reference/world-configuration/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(300);
    out.listMeasure = await page.evaluate(() => {
      const CJK = /[\u4e00-\u9fff]/;
      const p = [...document.querySelectorAll('.article li > p')].map((x) => x.textContent || '').filter((t) => t.trim().length > 100)[0];
      const el = [...document.querySelectorAll('.article li > p')].filter((x) => (x.textContent || '').trim().length > 100)[0];
      if (!el) return { none: true };
      const measure = (root, maxN) => {
        const lines = new Map(); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n = 0, stop = false; const rg = document.createRange();
        while (!stop && w.nextNode()) { const t = w.currentNode, s = t.nodeValue || '';
          for (let i = 0; i < s.length; i++) { if (n >= maxN) { stop = true; break; } const ch = s[i];
            rg.setStart(t, i); rg.setEnd(t, i + 1); const rr = rg.getClientRects(); n++;
            if (!rr.length) continue; const bb = rr[0]; if (!bb.width && !bb.height) continue;
            const k = Math.round(bb.top / 2) * 2; let e = lines.get(k); if (!e) { e = { chars: 0, cjk: 0, w: 0 }; lines.set(k, e); }
            e.chars++; if (CJK.test(ch)) e.cjk++; e.w = Math.max(e.w, bb.right - bb.left); } }
        return [...lines.values()].map((e) => ({ ...e, w: Math.round(e.w) }));
      };
      const lines = measure(el, 1500);
      const maxW = Math.max(...lines.map((l) => l.w));
      const full = lines.filter((l) => l.w >= maxW * 0.94 && l.chars > 5);
      return { pW: Math.round(el.getBoundingClientRect().width), fs: getComputedStyle(el).fontSize, lineCount: lines.length, maxLineW: maxW, lines: lines.slice(0, 6), fullSample: full.slice(0, 6), sample: p.slice(0, 120) };
    });
    console.log('LISTMEASURE ' + JSON.stringify(out.listMeasure));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe4.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n写出 reports/critique-red-probe4.json');
})();
