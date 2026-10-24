'use strict';
/**
 * critique-red-probe2.js — 红队复算器 #2：正文行盒 / 24px 命中区 / file:// 直开 / 搜索模态成本
 * 只读，不改任何站点文件。
 * 用法：node tools/critique-red-probe2.js
 * 产出：reports/critique-red-probe2.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const PAGES = [
  { url: '/paper/dev/dialogs/', name: 'dialogs' },
  { url: '/velocity/tuning/', name: 'tuning' },
  { url: '/paper/reference/world-configuration/', name: 'world' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/', name: 'landing' },
];
const ROOT = process.cwd();

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/** 只测「真正文」：.article p 无 class（body 段），逐字符行盒 */
const BODY_LINES = () => {
  const qa = (s) => [...document.querySelectorAll(s)];
  const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
  const measure = (root, maxN) => {
    const lines = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (['SCRIPT', 'STYLE'].includes(n.parentNode && n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let n = 0, stop = false;
    const range = document.createRange();
    while (!stop && walker.nextNode()) {
      const t = walker.currentNode; const s = t.nodeValue || '';
      for (let i = 0; i < s.length; i++) {
        if (n >= maxN) { stop = true; break; }
        const ch = s[i];
        if (ch === '\n' || ch === '\r' || ch === '\t') continue;
        range.setStart(t, i); range.setEnd(t, i + 1);
        const rects = range.getClientRects(); n++;
        if (!rects.length) continue;
        const bb = rects[0]; if (!bb.width && !bb.height) continue;
        const key = Math.round(bb.top / 2) * 2;
        let e = lines.get(key);
        if (!e) { e = { top: key, chars: 0, cjk: 0, left: bb.left, right: bb.right, w: 0 }; lines.set(key, e); }
        e.chars++; if (CJK.test(ch)) e.cjk++;
        e.left = Math.min(e.left, bb.left); e.right = Math.max(e.right, bb.right); e.w = e.right - e.left;
      }
    }
    return [...lines.values()].sort((a, b) => a.top - b.top).map((e, i) => ({ i, w: Math.round(e.w), chars: e.chars, cjk: e.cjk }));
  };

  const out = { bodyParas: 0, sampled: [], all: [] };
  const bodyPs = qa('.article > p').filter((p) => !p.className && (p.textContent || '').trim().length > 120);
  out.bodyParas = bodyPs.length;
  for (const p of bodyPs.slice(0, 6)) {
    const fs = parseFloat(getComputedStyle(p).fontSize);
    const w = Math.round(p.getBoundingClientRect().width);
    const lines = measure(p, 2500);
    const maxW = Math.max(...lines.map((l) => l.w), 0);
    const full = lines.filter((l) => l.w >= maxW * 0.94 && l.chars > 5);
    const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    out.sampled.push({
      fs, pW: w, lineCount: lines.length, maxLineW: maxW,
      medCharsPerFullLine: med(full.map((l) => l.chars)),
      medCJKPerFullLine: med(full.map((l) => l.cjk)),
      medLineW: med(full.map((l) => l.w)),
      tail: (p.textContent || '').trim().slice(0, 40),
      lines: lines.slice(0, 14),
    });
  }
  return out;
};

/** 命中区明细（WCAG 2.5.8 AA = 24×24） */
const TARGETS = () => {
  const qa = (s) => [...document.querySelectorAll(s)];
  const els = qa('a[href],button,input,summary,select,textarea');
  const rows = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.height < 24 || r.width < 24) {
      const region = el.closest('.sidebar') ? 'sidebar' : el.closest('.toc-side') ? 'toc' : el.closest('.topbar') ? 'topbar' : el.closest('.content') ? 'content' : 'other';
      rows.push({
        region, tag: el.tagName.toLowerCase(), h: Math.round(r.height), w: Math.round(r.width),
        sel: el.className || '', txt: (el.textContent || '').trim().slice(0, 24), href: el.getAttribute('href'),
        display: getComputedStyle(el).display, minH: getComputedStyle(el).minHeight, lh: getComputedStyle(el).lineHeight, fs: getComputedStyle(el).fontSize,
      });
    }
  }
  const byRegion = {};
  for (const r of rows) byRegion[r.region] = (byRegion[r.region] || 0) + 1;
  // 侧栏逐条高度（前 40）
  const side = [...document.querySelectorAll('.sidebar a')].filter((a) => a.getBoundingClientRect().height > 0)
    .map((a) => ({ h: Math.round(a.getBoundingClientRect().height), w: Math.round(a.getBoundingClientRect().width), txt: (a.textContent || '').trim().slice(0, 26) }));
  return { total: els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height; }).length, under24: rows.length, byRegion, rows: rows.slice(0, 40), sidebarRows: side.slice(0, 30), sidebarRowCount: side.length };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const report = { generated_at: new Date().toISOString(), body_lines: [], targets: [], fileProtocol: null, search: null, console: [] };

  // ---------- A. 真正文行盒（桌面 1440 / 1280 / 1025 / 1024 / 320） ----------
  for (const vp of [{ n: '1440x900', w: 1440, h: 900, m: false }, { n: '1280x800', w: 1280, h: 800, m: false }, { n: '1025x800', w: 1025, h: 800, m: false }, { n: '1024x800', w: 1024, h: 800, m: false }, { n: '390x844', w: 390, h: 844, m: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m, colorScheme: 'light' });
    const page = await ctx.newPage();
    for (const pg of PAGES) {
      await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(250);
      const b = await page.evaluate(BODY_LINES);
      report.body_lines.push({ vp: vp.n, page: pg.url, ...b });
      const smp = b.sampled[0];
      console.log('BODY ' + vp.n.padEnd(9) + pg.url.padEnd(40) + 'paras=' + String(b.bodyParas).padEnd(4) + (smp ? 'fs=' + smp.fs + ' pW=' + smp.pW + ' lines=' + smp.lineCount + ' maxLineW=' + smp.maxLineW + ' medChars/full=' + smp.medCharsPerFullLine + ' medCJK=' + smp.medCJKPerFullLine : '(no body para)'));
    }
    if (vp.n === '1440x900' || vp.n === '1024x800') {
      for (const pg of PAGES) {
        await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(250);
        const t = await page.evaluate(TARGETS);
        report.targets.push({ vp: vp.n, page: pg.url, ...t });
        console.log('TGT  ' + vp.n.padEnd(9) + pg.url.padEnd(40) + 'visible=' + String(t.total).padEnd(5) + 'under24=' + String(t.under24).padEnd(4) + JSON.stringify(t.byRegion));
      }
    }
    await ctx.close();
  }

  // ---------- B. file:// 直开 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errs.push('pageerror:' + String(e.message).slice(0, 160)));
    page.on('requestfailed', (r) => errs.push('reqfail:' + r.url().slice(0, 140) + ' :: ' + (r.failure() || {}).errorText));
    const f = 'file:///' + path.join(ROOT, 'paper', 'dev', 'dialogs', 'index.html').replace(/\\/g, '/');
    await page.goto(f, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(700);
    const probe = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
      const r = {};
      r.cssApplied = cs(document.body, 'fontFamily');
      r.hasSearchDialog = !!q('#search-dialog');
      r.hasSearchInput = !!q('#search-input');
      r.searchIndexScriptSrc = (q('script[src*="search-index"]') || {}).src || null;
      r.searchIndexLoaded = typeof window.__searchIndex !== 'undefined' || !!document.querySelector('script[src*="search-index"]');
      r.crumbHref = (q('.crumbs a') || {}).getAttribute ? q('.crumbs a').getAttribute('href') : null;
      r.imgCount = document.querySelectorAll('img').length;
      r.brokenImgs = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).length;
      r.codeBlocks = document.querySelectorAll('.code-block, pre').length;
      r.blockedByCorsNote = null;
      return r;
    });
    report.fileProtocol = { url: f, probe, errors: errs };
    console.log('FILE ' + f);
    console.log('  ' + JSON.stringify(probe));
    console.log('  errors(' + errs.length + '): ' + errs.slice(0, 8).join(' | '));

    // file:// 下真实搜索一次
    try {
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(300);
      const open = await page.evaluate(() => { const d = document.querySelector('#search-dialog'); return d ? { openAttr: d.hasAttribute('open'), openProp: d.open, rect: d.getBoundingClientRect().width } : null; });
      if (open && open.openProp) {
        const t0 = Date.now();
        await page.fill('#search-input', 'dialog');
        await page.waitForTimeout(50);
        const res = await page.evaluate(() => {
          const lis = document.querySelectorAll('#search-results li, .search-results li');
          return { items: lis.length, count: (document.querySelector('.sr-count') || {}).textContent || null, empty: !!document.querySelector('.sr-empty') };
        });
        report.search = report.search || {};
        report.search.fileProtocol = { open, results: res, ms: Date.now() - t0 };
        console.log('  SEARCH(file) open=' + JSON.stringify(open) + ' results=' + JSON.stringify(res));
      } else {
        report.search = report.search || {};
        report.search.fileProtocol = { open, results: null };
        console.log('  SEARCH(file) NOT OPEN ' + JSON.stringify(open));
      }
    } catch (e) { console.log('  SEARCH(file) ERR ' + e.message.slice(0, 120)); }
    await ctx.close();
  }

  // ---------- C. 搜索模态成本（http，桌面 1440） ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__lt = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ d: Math.round(e.duration), s: Math.round(e.startTime) }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    });
    const steps = {};
    const t0 = Date.now();
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => { const d = document.querySelector('#search-dialog'); return d && d.open; }, { timeout: 10000 });
    steps.openDialogMs = Date.now() - t0;
    const t1 = Date.now();
    await page.fill('#search-input', 'dialog');
    await page.waitForFunction(() => document.querySelectorAll('#search-results li, .search-results li').length > 0, { timeout: 10000 }).catch(() => {});
    steps.firstQueryMs = Date.now() - t1;
    const res1 = await page.evaluate(() => ({ items: document.querySelectorAll('#search-results li, .search-results li').length, count: (document.querySelector('.sr-count') || {}).textContent || null }));
    const t2 = Date.now();
    await page.fill('#search-input', 'con');
    await page.waitForTimeout(400);
    steps.secondQueryMs = Date.now() - t2;
    const res2 = await page.evaluate(() => ({ items: document.querySelectorAll('#search-results li, .search-results li').length }));
    const t3 = Date.now();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    steps.closeMs = Date.now() - t3;
    const lt = await page.evaluate(() => window.__lt);
    const idx = await page.evaluate(() => {
      const s = document.querySelector('script[src*="search-index"]');
      return { src: s ? s.getAttribute('src') : null, defer: s ? s.defer : null, len: s ? s.outerHTML.length : 0 };
    });
    report.search = Object.assign(report.search || {}, { http: { steps, res1, res2, longtasks: lt, longtaskTotal: lt.reduce((a, x) => a + x.d, 0), longtaskMax: lt.reduce((a, x) => Math.max(a, x.d), 0), index: idx } });
    console.log('SEARCH(http) ' + JSON.stringify({ steps, res1, res2, longtaskTotal: report.search.http.longtaskTotal, longtaskMax: report.search.http.longtaskMax, index: idx }));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe2.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\n写出 reports/critique-red-probe2.json');
})();
