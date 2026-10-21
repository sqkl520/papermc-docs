'use strict';
/**
 * mobile-fixprobe.js — 收尾修复轮（fixround）自查探针。**只读测量**，不写站点产物、不改别人的报告。
 *
 * 用途：
 *   A) 任务 1：320/390 × ≥12 页，遍历「真横向溢出容器」(scrollWidth > clientWidth+1 且
 *      overflow-x ∈ {auto,scroll})，断言 tabindex=0 + role=region + aria-label 三者齐备，
 *      并用「真实 Tab 键」验证可达（聚焦容器前一个可聚焦元素 → 按 Tab → activeElement 命中容器）。
 *   B) 任务 2 佐证：768/1024/1280 的 headerH / sidebarW / brandW 双实例实测（8787 vs 8788）。
 *   C) 任务 3：搜索「权限」在改前/改后两实例上的显示条数 / 计数文本 / DOM 条数。
 *
 * 用法：
 *   node tools/mobile-fixprobe.js [--url=http://127.0.0.1:8787] [--pre=http://127.0.0.1:8788]
 *                                 [--json=reports/mobile-fixprobe.json] [--tag=before|after]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787').replace(/\/+$/, '');
const PRE = opt('pre', 'http://127.0.0.1:8788').replace(/\/+$/, '');
const TAG = opt('tag', 'run');
const OUT = path.isAbsolute(opt('json', '')) ? opt('json', '') : path.join(REPO, opt('json', path.join('reports', 'mobile-fixprobe.json')));
const ONLY = (opt('only', 'abcd')).toLowerCase();

const VP_MOBILE = [{ name: '320x568', w: 320, h: 568 }, { name: '390x844', w: 390, h: 844 }];
const VP_DESK = [{ name: '768x1024', w: 768, h: 1024 }, { name: '1024x768', w: 1024, h: 768 }, { name: '1280x800', w: 1280, h: 800 }];

/* A1 的 10 页 + D2/Tab 失败项点名的页（去重） = 16 页 */
const PAGES = [
  '/',
  '/paper/',
  '/paper/dev/command-api/basics/introduction/',
  '/paper/reference/world-configuration/',
  '/velocity/tuning/',
  '/folia/reference/region-logic/',
  '/all-pages.html',
  '/snapshots.html',
  '/sections/paper.html',
  '/categories/paper-dev-command.html',
  '/paper/dev/pdc/',
  '/paper/dev/dialogs/',
  '/paper/reference/configuration/',
  '/paper/reference/global-configuration/',
  '/paper/aikars-flags/',
  '/paper/dev/using-databases/',
];

function browserPath() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'));
  if (process.env.PROGRAMFILES) cands.push(path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (process.env['PROGRAMFILES(X86)']) cands.push(path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function withCtx(browser, vp, fn) {
  const mobile = vp.w < 768;
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
    isMobile: mobile, hasTouch: mobile, colorScheme: 'light',
  });
  const page = await ctx.newPage();
  try { return await fn(page); } finally { await ctx.close().catch(() => {}); }
}
async function go(page, url, w) {
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(w === undefined ? 120 : w);
}

/* ── 任务 1：溢出容器语义 + Tab 可达 ── */
const PROBE_A = () => {
  const CS = (el) => getComputedStyle(el);
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    if (el.id) s += '#' + el.id;
    return s;
  };
  const ROOT = document.documentElement;
  const vis = (el) => {
    const cs = CS(el); const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const focusables = () => Array.prototype.slice.call(
    document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')
  ).filter((el) => { const r = el.getBoundingClientRect(); const cs = CS(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; });

  const triple = (el) => ({
    tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    ok: el.getAttribute('tabindex') === '0' && el.getAttribute('role') === 'region' && !!el.getAttribute('aria-label'),
  });
  const scrollerOf = (el, depth) => {
    let q = el;
    for (let k = 0; k <= (depth || 3) && q; k++) {
      const c = CS(q);
      if (['auto', 'scroll'].indexOf(c.overflowX) !== -1) return q;
      q = q.parentElement;
    }
    return null;
  };

  /* 1) 所有真横向溢出容器（自身就是滚动容器） */
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = CS(el);
    if (['auto', 'scroll'].indexOf(cs.overflowX) === -1) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const t = triple(el);
    overflowing.push({
      sel: desc(el), cls: (el.className || '').toString(),
      scrollW: el.scrollWidth, clientW: el.clientWidth, delta: el.scrollWidth - el.clientWidth,
      visible: vis(el), ...t,
    });
  }

  /* 2) 所有带 overflow-x 的滚动容器（含不溢出的）→ 噪音统计 */
  const allScrollers = [];
  let noiseAttrs = 0;              // 不溢出却带键盘语义的容器数
  for (const el of document.querySelectorAll('body *')) {
    const cs = CS(el);
    if (['auto', 'scroll'].indexOf(cs.overflowX) === -1) continue;
    const over = el.scrollWidth > el.clientWidth + 1;
    const t = triple(el);
    allScrollers.push({ sel: desc(el), over, ...t });
    if (!over && t.ok) noiseAttrs++;
  }

  /* 3) pre / table 视角（与验证器同口径：scope = 自身优先的最近 3/4 层滚动祖先） */
  const pres = [];
  for (const el of document.querySelectorAll('pre')) {
    const sc = scrollerOf(el, 3);
    pres.push({
      sel: desc(el), scrollW: el.scrollWidth, clientW: el.clientWidth,
      needsScroll: el.scrollWidth > el.clientWidth + 1,
      selfScroller: ['auto', 'scroll'].indexOf(CS(el).overflowX) !== -1,
      scope: sc ? desc(sc) : null,
      scopeOverflowX: sc ? CS(sc).overflowX : null,
      scopeTriple: sc ? triple(sc) : null,
      scrollable: !!sc,
    });
  }
  const tables = [];
  for (const t0 of document.querySelectorAll('table')) {
    let found = null, q = t0.parentElement;
    for (let k = 0; k < 4 && q; k++) {
      const c = CS(q);
      if (['auto', 'scroll'].indexOf(c.overflowX) !== -1 || q.getAttribute('role') === 'region') { found = q; break; }
      q = q.parentElement;
    }
    tables.push({
      sel: desc(t0), needsScroll: t0.scrollWidth > t0.clientWidth + 1,
      scope: found ? desc(found) : null, scopeTriple: found ? triple(found) : null,
    });
  }

  const preBad = pres.filter((p) => p.needsScroll && !(p.scopeTriple && p.scopeTriple.ok));
  const preNoScope = pres.filter((p) => !p.scrollable);
  const tableBad = tables.filter((t) => t.needsScroll && !(t.scopeTriple && t.scopeTriple.ok));
  const tableNoScope = tables.filter((t) => !t.scope);
  const contBad = overflowing.filter((c) => !c.ok);

  /* 4) Tab 可达候选：真溢出的 .code-scroll / .table-wrap */
  const tabTargets = overflowing
    .filter((c) => /code-scroll|table-wrap/.test(c.cls))
    .slice(0, 5)
    .map((c) => c.sel);
  const fl = focusables();
  const tabMeta = tabTargets.map((sel) => {
    const el = Array.prototype.slice.call(document.querySelectorAll('.code-scroll, .table-wrap'))
      .filter((x) => desc(x) === sel)[0];
    if (!el) return { sel, inTabOrder: false, idx: -1, prevSel: null };
    const idx = fl.indexOf(el);
    return {
      sel, inTabOrder: idx >= 0, idx,
      prevSel: idx > 0 ? desc(fl[idx - 1]) : null,
    };
  });
  window.__fixTabTargets = tabTargets;
  window.__fixFocusables = fl;

  /* 4b) 验证器同款：DOM 序第一个 .code-scroll / .table-wrap 的真实 Tab 可达 */
  const hostsAll = Array.prototype.slice.call(document.querySelectorAll('.code-scroll, .table-wrap'));
  const firstHost = hostsAll[0] ? desc(hostsAll[0]) : null;
  const firstIdx = hostsAll[0] ? fl.indexOf(hostsAll[0]) : -2;
  const firstTab = {
    sel: firstHost, inTabOrder: firstIdx >= 0, idx: firstIdx,
    prevSel: firstIdx > 0 ? desc(fl[firstIdx - 1]) : null,
    hostOverflowing: hostsAll[0] ? (hostsAll[0].scrollWidth > hostsAll[0].clientWidth + 1) : null,
    hostCount: hostsAll.length,
  };
  window.__fixFirstHost = firstTab;

  return {
    url: location.href,
    docOverflow: ROOT.scrollWidth - ROOT.clientWidth,
    overflowing, overflowingCount: overflowing.length,
    contBad: contBad.map((c) => ({ sel: c.sel, scrollW: c.scrollW, clientW: c.clientW, tabindex: c.tabindex, role: c.role, ariaLabel: c.ariaLabel })),
    contBadCount: contBad.length,
    scrollerCount: allScrollers.length, noiseAttrs,
    preCount: pres.length, preNeedingScroll: pres.filter((p) => p.needsScroll).length,
    preBadCount: preBad.length, preBad: preBad.slice(0, 6), preNoScopeCount: preNoScope.length,
    tableCount: tables.length, tableNeedingScroll: tables.filter((t) => t.needsScroll).length,
    tableBadCount: tableBad.length, tableNoScopeCount: tableNoScope.length,
    tabMeta,
    firstTab,
  };
};

/* 聚焦前一个可聚焦元素 → Tab → 断言命中目标容器 */
const FOCUS_PREV = (i) => {
  const fl = window.__fixFocusables;
  const el = fl[i];
  if (!el || !el.focus) return { applied: false };
  el.focus();
  return { applied: document.activeElement === el, active: document.activeElement ? document.activeElement.tagName.toLowerCase() : null };
};
const IS_TARGET = (i) => {
  const sel = window.__fixTabTargets[i];
  const hosts = Array.prototype.slice.call(document.querySelectorAll('.code-scroll, .table-wrap'));
  const want = hosts.filter((x) => {
    let s = x.tagName.toLowerCase();
    const cls = (x.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    if (x.id) s += '#' + x.id;
    return s === sel;
  })[0];
  const a = document.activeElement;
  return { want: !!want, hit: !!want && a === want, activeSel: a ? a.tagName.toLowerCase() + '.' + ((a.className || '').toString().trim().split(/\s+/)[0] || '') : null };
};
/* 验证器同款判定：activeElement.matches('.code-scroll, .table-wrap') */
const IS_HOST = () => {
  const a = document.activeElement;
  return {
    hit: !!(a && a.matches && a.matches('.code-scroll, .table-wrap')),
    activeSel: a ? a.tagName.toLowerCase() + '.' + ((a.className || '').toString().trim().split(/\s+/)[0] || '') : null,
  };
};

/* ── 归属证明：容器在「渲染态」下必须真实可 Tab 到 ── */
const FIRST_HOST_TAB = () => {
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    return s;
  };
  const hosts = Array.prototype.slice.call(document.querySelectorAll('.code-scroll, .table-wrap'));
  const host = hosts[0];
  if (!host) return { host: null, reason: 'no-host' };
  const fl = Array.prototype.slice.call(document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])'))
    .filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; });
  const i = fl.indexOf(host);
  const closedDetails = (() => { let d = host.closest('details'); return d ? (d.open ? 'open' : 'closed') : null; })();
  const res = { host: desc(host), hostOver: host.scrollWidth > host.clientWidth + 1, idx: i, closedDetails, prevSel: i > 0 ? desc(fl[i - 1]) : null, ran: false, reached: null };
  if (i > 0) {
    fl[i - 1].focus();
    res.prevFocusApplied = document.activeElement === fl[i - 1];
    if (res.prevFocusApplied) { res.ran = true; res.pending = true; }
  } else if (i === -1) { res.reason = 'host-not-in-tab-order'; } else { res.reason = 'no-predecessor'; }
  window.__fh = host;
  return res;
};
const OPEN_ALL_DETAILS = () => {
  let n = 0;
  for (const d of document.querySelectorAll('details')) { if (!d.open) { d.open = true; n++; } }
  return n;
};

/* ── 诊断：为什么某个「前一个可聚焦元素」focus() 不生效 ── */
const DIAG_PREV = (page_) => {
  const CS = (el) => getComputedStyle(el);
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (cls) s += '.' + cls;
    return s;
  };
  const hosts = Array.prototype.slice.call(document.querySelectorAll('.code-scroll, .table-wrap'));
  const host = hosts[0];
  const fl = Array.prototype.slice.call(document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])'));
  const i = fl.indexOf(host);
  const out = { hostSel: host ? desc(host) : null, hostIdx: i, hostOver: host ? host.scrollWidth > host.clientWidth + 1 : null, hostTabindex: host ? host.getAttribute('tabindex') : null, around: [] };
  for (let k = Math.max(0, i - 3); k < Math.min(fl.length, i + 2); k++) {
    const el = fl[k];
    const r = el.getBoundingClientRect();
    const inertChain = [];
    let q = el;
    while (q && q !== document.documentElement) { if (q.hasAttribute && q.hasAttribute('inert')) inertChain.push(desc(q)); q = q.parentElement; }
    el.focus();
    out.around.push({
      k, sel: desc(el), w: Math.round(r.width), h: Math.round(r.height),
      display: CS(el).display, visibility: CS(el).visibility,
      tabindex: el.getAttribute('tabindex'), disabled: !!el.disabled,
      inertAncestors: inertChain, focusApplied: document.activeElement === el,
      closestDetails: (() => { const d = el.closest('details'); return d ? (d.open ? 'details[open]' : 'details[closed]') : null; })(),
      activeAfter: document.activeElement ? desc(document.activeElement) : null,
    });
  }
  out.pres = Array.prototype.slice.call(document.querySelectorAll('pre')).slice(0, 6).map((p) => ({
    sel: desc(p), parent: p.parentElement ? desc(p.parentElement) : null,
    matchesDirect: p.matches('.code-scroll > .code-pre'),
    preOverflowX: CS(p).overflowX, parentOverflowX: p.parentElement ? CS(p.parentElement).overflowX : null,
    scrollW: p.scrollWidth, clientW: p.clientWidth,
    parentScrollW: p.parentElement ? p.parentElement.scrollWidth : null, parentClientW: p.parentElement ? p.parentElement.clientWidth : null,
    minWidth: CS(p).minWidth,
  }));
  return out;
};async function diagnose(browser, url, p, vp) {
  let out = null;
  await withCtx(browser, vp, async (page) => {
    await go(page, url + p);
    out = await page.evaluate(DIAG_PREV);
  });
  return out;
}

/* ── 任务 3：搜索 ── */
const READ_RESULTS = () => {
  const res = document.querySelector('#search-results');
  const c = document.querySelector('#search-count');
  const items = res ? Array.from(res.querySelectorAll('li a[href]')) : [];
  return {
    open: (() => { const d = document.querySelector('#search-dialog'); return d ? !!d.open : null; })(),
    liCount: items.length,
    countText: c ? c.textContent.trim() : null,
    first3: items.slice(0, 3).map((a) => (a.querySelector('.sr-ttl') || a).textContent.trim().slice(0, 36)),
    last: items.length ? (items[items.length - 1].querySelector('.sr-ttl') || items[items.length - 1]).textContent.trim().slice(0, 36) : null,
  };
};

async function openSearch(page) {
  const isOpen = () => page.evaluate(() => { const d = document.querySelector('#search-dialog'); return !!(d && d.open); });
  if (await isOpen()) return 'already';
  await page.click('button[data-open-search], [data-open-search]', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(320);
  if (await isOpen()) return 'click';
  await page.keyboard.press('Control+K');
  await page.waitForTimeout(320);
  if (await isOpen()) return 'ctrl+K';
  await page.evaluate(() => { const b = document.querySelector('[data-open-search]'); if (b) b.click(); });
  await page.waitForTimeout(320);
  if (await isOpen()) return 'js-click';
  await page.evaluate(() => { const d = document.querySelector('#search-dialog'); if (d && !d.open) { try { d.showModal(); } catch (e) {} } });
  await page.waitForTimeout(220);
  return 'forced';
}

async function searchOn(browser, url, queries) {
  const out = [];
  await withCtx(browser, { name: '390x844', w: 390, h: 844 }, async (page) => {
    await go(page, url + '/paper/dev/pdc/', 250);
    const strat = await openSearch(page);
    const indexAtRest = await page.evaluate(() => !!(window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages));
    for (const q of queries) {
      const ok = await page.fill('#search-input', q, { timeout: 2500 }).then(() => true).catch(() => false);
      if (!ok) await page.evaluate((v) => { const i = document.querySelector('#search-input'); if (i) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } }, q);
      await page.waitForTimeout(900);
      const r = await page.evaluate(READ_RESULTS);
      const idxLen = await page.evaluate(() => (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages) ? window.__LIBRARY_SEARCH__.pages.length : 0);
      out.push({ q, strategy: strat, indexAtRest, indexPages: idxLen, typed: await page.evaluate(() => { const i = document.querySelector('#search-input'); return i ? i.value : null; }), ...r });
    }
  });
  return out;
}

/* ── 任务 2 佐证：双实例几何 ── */
const GEO = () => {
  const CS = (el) => getComputedStyle(el);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) }; };
  const brand = document.querySelector('.brand');
  const name = document.querySelector('.brand-name');
  const dot = document.querySelector('.brand-dot');
  const header = document.querySelector('header.topbar') || document.querySelector('header');
  const side = document.querySelector('#sidebar, .sidebar');
  const toc = document.querySelector('.toc-side');
  return {
    headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
    sidebarW: side ? Math.round(side.getBoundingClientRect().width) : null,
    brandBox: box(brand), brandNameBox: box(name),
    brandNameFont: name ? CS(name).fontSize : null,
    brandFont: brand ? CS(brand).fontSize : null,
    brandGap: brand ? CS(brand).gap : null,
    brandPad: brand ? CS(brand).padding : null,
    dotBox: box(dot),
    tocDisplay: toc ? CS(toc).display : null,
    menuVisible: (() => { const b = document.querySelector('#nav-toggle'); return !!b && CS(b).display !== 'none'; })(),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

async function geometry(browser, url, paths) {
  const rows = [];
  for (const vp of VP_DESK) {
    await withCtx(browser, vp, async (page) => {
      for (const p of paths) {
        await go(page, url + p, 120);
        rows.push({ viewport: vp.name, page: p, ...(await page.evaluate(GEO)) });
      }
    });
  }
  return rows;
}

async function main() {
  const exe = browserPath();
  if (!exe) throw new Error('no chrome found (set CHROME_PATH)');
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const report = {
    tool: 'tools/mobile-fixprobe.js', tag: TAG, at: new Date().toISOString(),
    base: BASE, pre: PRE, browser: exe,
    taskA: { viewports: VP_MOBILE.map((v) => v.name), pages: PAGES, rows: [] },
    taskB: { geometry_post: [], geometry_pre: [] },
    taskC: { queries: ['权限', '配置'], post: [], pre: [] },
  };

  /* A) 任务 1 */
  if (ONLY.indexOf('a') !== -1)
  for (const vp of VP_MOBILE) {
    await withCtx(browser, vp, async (page) => {
      for (const p of PAGES) {
        try {
          await go(page, BASE + p);
          const m = await page.evaluate(PROBE_A);
          const tabs = [];
          for (let i = 0; i < m.tabMeta.length; i++) {
            const meta = m.tabMeta[i];
            if (!meta.inTabOrder || meta.idx <= 0) { tabs.push({ ...meta, reached: null, note: meta.inTabOrder ? 'no-preceding-focusable' : 'container-not-focusable' }); continue; }
            const f = await page.evaluate(FOCUS_PREV, meta.idx - 1);
            if (!f.applied) { tabs.push({ ...meta, reached: null, note: 'predecessor-not-focusable' }); continue; }
            await page.keyboard.press('Tab');
            const r = await page.evaluate(IS_TARGET, i);
            tabs.push({ ...meta, reached: r.hit, activeSel: r.activeSel });
          }
          let firstTabRes = { ...m.firstTab, reached: null, note: 'n/a' };
          if (m.firstTab.inTabOrder && m.firstTab.idx > 0) {
            const f2 = await page.evaluate(FOCUS_PREV, m.firstTab.idx - 1);
            if (f2.applied) {
              await page.keyboard.press('Tab');
              const rr = await page.evaluate(IS_HOST);
              firstTabRes = { ...m.firstTab, reached: rr.hit, activeSel: rr.activeSel, note: 'ran' };
            } else { firstTabRes = { ...m.firstTab, note: 'predecessor-not-focusable' }; }
          } else if (!m.firstTab.inTabOrder) firstTabRes = { ...m.firstTab, note: 'host-not-focusable' };
          else firstTabRes = { ...m.firstTab, note: 'no-predecessor' };
          report.taskA.rows.push({ viewport: vp.name, page: p, ...m, tabResults: tabs, firstTabResult: firstTabRes });
        } catch (e) {
          report.taskA.rows.push({ viewport: vp.name, page: p, error: String(e.message).slice(0, 160) });
        }
      }
      console.log('  A ' + vp.name + ' done');
    });
  }

  /* B) 任务 2 佐证 */
  const geoPages = ['/', '/paper/', '/paper/dev/pdc/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/folia/reference/region-logic/'];
  if (ONLY.indexOf('b') !== -1) { report.taskB.geometry_post = await geometry(browser, BASE, geoPages); console.log('  B done'); }
  if (ONLY.indexOf('p') !== -1) { report.taskB.geometry_pre = await geometry(browser, PRE, geoPages); console.log('  B(pre) done'); }

  /* C) 任务 3 */
  if (ONLY.indexOf('c') !== -1) { report.taskC.post = await searchOn(browser, BASE, report.taskC.queries); console.log('  C done'); }
  if (ONLY.indexOf('d') !== -1) { report.taskC.pre = await searchOn(browser, PRE, report.taskC.queries); console.log('  C(pre) done'); }

  if (ONLY.indexOf('x') !== -1) {
    report.diag = {
      udb_390: await diagnose(browser, BASE, '/paper/dev/using-databases/', { name: '390x844', w: 390, h: 844 }),
      pdc_390: await diagnose(browser, BASE, '/paper/dev/pdc/', { name: '390x844', w: 390, h: 844 }),
    };
    console.log('  X done'); console.log(JSON.stringify(report.diag, null, 1));
  }

  await browser.close();

  /* 汇总 */
  const rows = report.taskA.rows.filter((r) => !r.error);
  const semBad = rows.filter((r) => r.contBadCount || r.preBadCount || r.tableBadCount || r.preNoScopeCount || r.tableNoScopeCount);
  const tabBad = rows.filter((r) => r.tabResults && r.tabResults.some((t) => t.reached === false));
  const tabInconclusive = rows.filter((r) => r.tabResults && r.tabResults.some((t) => t.reached === null));
  report.summary = {
    combos: rows.length, errors: report.taskA.rows.filter((r) => r.error).length,
    semBadCombos: semBad.length,
    semBadDetail: semBad.map((r) => ({ viewport: r.viewport, page: r.page, contBad: r.contBadCount, preBad: r.preBadCount, tableBad: r.tableBadCount, preNoScope: r.preNoScopeCount, tableNoScope: r.tableNoScopeCount })),
    tabBadCombos: tabBad.length,
    tabBadDetail: tabBad.map((r) => ({ viewport: r.viewport, page: r.page, f: r.tabResults.filter((t) => t.reached === false).map((t) => t.sel + ' active=' + t.activeSel) })),
    tabInconclusiveCombos: tabInconclusive.length,
    firstTabBadCombos: rows.filter((r) => r.firstTabResult && r.firstTabResult.reached === false).length,
    firstTabDetail: rows.map((r) => ({ viewport: r.viewport, page: r.page, sel: r.firstTabResult ? r.firstTabResult.sel : null, over: r.firstTabResult ? r.firstTabResult.hostOverflowing : null, reached: r.firstTabResult ? r.firstTabResult.reached : null, active: r.firstTabResult ? r.firstTabResult.activeSel : null, note: r.firstTabResult ? r.firstTabResult.note : null })).filter((x) => x.reached !== true),
    overflowCombos: rows.filter((r) => r.docOverflow > 1).length,
    overflowingContainersTotal: rows.reduce((a, r) => a + r.overflowingCount, 0),
    overflowingMissingSemantics: rows.reduce((a, r) => a + r.contBadCount, 0),
    noiseAttrsTotal: rows.reduce((a, r) => a + (r.noiseAttrs || 0), 0),
    scrollersTotal: rows.reduce((a, r) => a + (r.scrollerCount || 0), 0),
    preTotal: rows.reduce((a, r) => a + r.preCount, 0),
    preNeedingScroll: rows.reduce((a, r) => a + r.preNeedingScroll, 0),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n==== fixprobe summary (' + TAG + ') ====');
  console.log(JSON.stringify(report.summary, null, 1));
  if (report.summary.semBadCombos || report.summary.tabBadCombos || report.summary.errors) process.exitCode = 1;
  console.log('wrote ' + path.relative(REPO, OUT));
}

main().catch((e) => { console.error('FATAL ' + ((e && e.stack) || e)); process.exit(2); });
