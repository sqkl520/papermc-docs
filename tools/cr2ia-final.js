'use strict';
/**
 * cr2ia-final.js — 终局取证：
 *  A. 同源（same-origin）重合率重算（修正外链误判）
 *  B. 目标页的「入口路径」全枚举（侧栏/首页树/面包屑/翻页/TOC/搜索/all-pages/snapshots/分类）
 *  C. 搜索索引覆盖 + 键盘成本
 *  D. file:// 直开可用性（离线约束的实证）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2ia');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8787';
const ROOT = path.resolve(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const TARGETS = ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/'];

/** A. 同源重合率 */
const OVERLAP = () => {
  const here = location.origin;
  const norm = (a) => {
    let u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return null; }
    if (u.origin !== here) return null;
    if (u.hash) return null;
    let p = u.pathname;
    if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
    if (p === '' || p === '/') return '/';
    return p.replace(/\/$/, '/');
  };
  const side = new Set([...document.querySelectorAll('#sidebar a[href]')].map(norm).filter(Boolean));
  const main = new Set([...document.querySelectorAll('#main a[href]')].map(norm).filter(Boolean));
  const tree = new Set([...document.querySelectorAll('#main .src-tree a[href]')].map(norm).filter(Boolean));
  const inter = [...main].filter((x) => side.has(x));
  const treeInter = [...tree].filter((x) => side.has(x));
  const mainOnly = [...main].filter((x) => !side.has(x));
  return {
    side: side.size, main: main.size, tree: tree.size,
    overlap: inter.length,
    overlapPct: Math.round((inter.length / main.size) * 1000) / 10,
    treeOverlap: treeInter.length,
    treeOverlapPct: Math.round((treeInter.length / tree.size) * 1000) / 10,
    mainOnly,
    sideOnly: [...side].filter((x) => !main.has(x)),
    extLinks: [...document.querySelectorAll('#main a[href]')].filter((a) => { try { return new URL(a.getAttribute('href'), location.href).origin !== here; } catch (e) { return false; } }).length,
  };
};

/** B. 入口路径枚举 */
const ENTRIES = (targets) => {
  const here = location.origin;
  const norm = (a) => {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      if (u.hash || u.origin !== here) return null;
      let p = u.pathname;
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p;
    } catch (e) { return null; }
  };
  const mech = (a) => {
    if (a.closest('#sidebar')) return 'sidebar';
    if (a.closest('.src-tree')) return 'home-tree';
    if (a.closest('.crumbs')) return 'breadcrumb';
    if (a.closest('.pager')) return 'pager';
    if (a.closest('.toc-side')) return 'toc-right';
    if (a.closest('[data-drawer-toc]')) return 'toc-drawer';
    if (a.closest('table.allpages')) return 'allpages-table';
    if (a.closest('table.snapshots')) return 'snapshots-table';
    if (a.closest('.cat-block, .cat-links, .tax-list')) return 'category-block';
    if (a.closest('.cat-anchorbar')) return 'cat-anchorbar';
    if (a.closest('footer')) return 'footer';
    if (a.closest('#main')) return 'main-body';
    return 'other';
  };
  const out = {};
  for (const t of targets) out[t] = {};
  for (const a of document.querySelectorAll('a[href]')) {
    const p = norm(a);
    if (!p || !(p in out)) continue;
    const m = mech(a);
    out[p][m] = (out[p][m] || 0) + 1;
  }
  return { url: location.pathname, out };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const R = {};

  // ---- A: 首页 / 分区页 / 清单页的重合率 ----
  R.overlap = {};
  for (const [n, u] of [['landing', '/'], ['paper', '/paper/'], ['allpages', '/all-pages.html'], ['snapshots', '/snapshots.html']]) {
    await page.goto(BASE + u, { waitUntil: 'load' }); await page.waitForTimeout(400);
    R.overlap[n] = await page.evaluate(OVERLAP);
  }

  // ---- B: 入口枚举 ----
  R.entries = {};
  for (const [n, u] of [['landing', '/'], ['paper', '/paper/'], ['allpages', '/all-pages.html'], ['snapshots', '/snapshots.html'], ['cat-config', '/categories/paper-config.html']]) {
    await page.goto(BASE + u, { waitUntil: 'load' }); await page.waitForTimeout(350);
    R.entries[n] = await page.evaluate(ENTRIES, TARGETS);
  }
  for (const t of TARGETS) {
    await page.goto(BASE + t, { waitUntil: 'load' }); await page.waitForTimeout(350);
    R.entries['self' + t] = await page.evaluate(ENTRIES, TARGETS);
  }

  // ---- C: 搜索覆盖 + 键盘成本 ----
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  R.search = {};
  // 用 Ctrl+K 打开搜索，输入 Dialog API，看首条结果
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(1200);
  R.search.dialogOpenAfterCtrlK = await page.evaluate(() => {
    const d = document.querySelector('#search-dialog');
    return { exists: !!d, open: !!(d && d.open), inputFocused: document.activeElement === document.querySelector('#search-input') };
  });
  await page.keyboard.type('Dialog', { delay: 60 });
  await page.waitForTimeout(1500);
  R.search.results = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#search-results a')];
    return {
      count: items.length,
      first: items.slice(0, 3).map((a) => ({ t: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70), href: a.getAttribute('href') })),
      counter: (document.querySelector('#search-count') || {}).textContent || '',
    };
  });
  await page.keyboard.press('Escape');

  // 首页 hero 搜索框聚焦会发生什么
  await page.goto(BASE + '/', { waitUntil: 'load' }); await page.waitForTimeout(300);
  R.search.heroFocus = await page.evaluate(async () => {
    const h = document.querySelector('#hero-search');
    const d = document.querySelector('#search-dialog');
    const before = { open: d.open };
    h.focus();
    await new Promise((r) => setTimeout(r, 900));
    return { before, after: { open: d.open, inputVal: (document.querySelector('#search-input') || {}).value, heroVal: h.value, active: (document.activeElement || {}).id } };
  });

  // 搜索索引规模
  R.index = await page.evaluate(async () => {
    const s = [...document.querySelectorAll('script[src]')].map((x) => x.getAttribute('src'));
    return { scripts: s, indexLoadedAtStart: s.some((x) => /search-index/.test(x || '')) };
  });

  // ---- D: file:// 直开 ----
  const fileUrl = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
  R.file = { url: fileUrl };
  try {
    const p2 = await ctx.newPage();
    const errs = [];
    p2.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
    p2.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 120)));
    await p2.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });
    await p2.waitForTimeout(600);
    R.file.load = await p2.evaluate(() => ({
      title: document.title,
      cssApplied: getComputedStyle(document.body).fontSize,
      sidebarLinks: document.querySelectorAll('#sidebar a[href]').length,
      anchors: document.querySelectorAll('a[href]').length,
      storageThrows: (() => { try { localStorage.getItem('lcb-theme'); return false; } catch (e) { return true; } })(),
      theme: document.documentElement.getAttribute('data-theme'),
    }));
    // 搜索能否加载索引
    await p2.keyboard.press('Control+k');
    await p2.waitForTimeout(2000);
    await p2.keyboard.type('Dialog', { delay: 60 });
    await p2.waitForTimeout(2000);
    R.file.search = await p2.evaluate(() => ({
      dialogOpen: (document.querySelector('#search-dialog') || {}).open,
      results: document.querySelectorAll('#search-results a').length,
      counter: (document.querySelector('#search-count') || {}).textContent || '',
    }));
    // 深链跳转
    await p2.goto('file:///' + path.join(ROOT, 'paper/dev/dialogs/index.html').split(path.sep).join('/'), { waitUntil: 'load' });
    await p2.waitForTimeout(500);
    R.file.deep = await p2.evaluate(() => ({ ok: !!document.querySelector('h1'), toc: document.querySelectorAll('.toc-side a').length, side: document.querySelectorAll('#sidebar a').length }));
    R.file.errors = errs.slice(0, 8);
    await p2.close();
  } catch (e) { R.file.error = e.message; }

  fs.writeFileSync(path.join(OUT, 'final.json'), JSON.stringify(R, null, 2), 'utf8');

  const L = [];
  L.push('== A. OVERLAP (same-origin) ==');
  for (const k of Object.keys(R.overlap)) L.push(k + ' ' + JSON.stringify(R.overlap[k]));
  L.push('');
  L.push('== B. ENTRIES ==');
  for (const k of Object.keys(R.entries)) {
    L.push(k + ' (' + R.entries[k].url + ')');
    for (const t of Object.keys(R.entries[k].out)) {
      const o = R.entries[k].out[t];
      const tot = Object.values(o).reduce((a, b) => a + b, 0);
      if (tot) L.push('   ' + t.padEnd(40) + ' total=' + String(tot).padStart(2) + ' ' + JSON.stringify(o));
    }
  }
  L.push('');
  L.push('== C. SEARCH ==');
  L.push(JSON.stringify(R.search, null, 1));
  L.push(JSON.stringify(R.index));
  L.push('');
  L.push('== D. FILE:// ==');
  L.push(JSON.stringify(R.file, null, 1));
  const txt = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'final.txt'), txt, 'utf8');
  console.log(txt);
  await browser.close();
})();
