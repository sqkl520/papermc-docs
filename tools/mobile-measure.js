'use strict';
/**
 * mobile-measure.js — real-browser mobile measurement harness (Playwright + installed Chrome/Chromium).
 *
 * For each viewport × page it records:
 *   - document horizontal overflow (scrollWidth vs clientWidth) and the offending elements
 *   - tap-target sizes for interactive controls in the header / sidebar
 *   - computed font sizes for inputs (iOS auto-zoom needs >= 16px)
 *   - whether <pre>/<table> have a scroll container and keyboard access (tabindex/role)
 *   - sticky header height vs scroll-margin-top of headings
 *
 * Usage: node tools/mobile-measure.js [--url=http://127.0.0.1:8787] [--pages=8] [--json=reports/mobile-measure.json]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787');
const JSON_OUT = opt('json', path.join('reports', 'mobile-measure.json'));

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '414x896', width: 414, height: 896 },
  { name: '768x1024', width: 768, height: 1024 },
  // 820–1200px 区间（iPad 834/820、Surface 912、老 iPad 1024）：规划 Agent C3 指出这里既无抽屉也无本页目录，必须纳入采样
  { name: '834x1112', width: 834, height: 1112 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
];

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
];

/** Locate a Chromium/Chrome binary: env override → Playwright cache → common Windows install paths. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

function browserPath() {
  for (const c of CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}

const PROBE = () => {
  const de = document.documentElement;
  const overflow = de.scrollWidth - de.clientWidth;

  /** nearest ancestor that clips horizontally (cannot let the child widen the document) */
  const clippingAncestor = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX)) return p;
      if (cs.position === 'fixed') return p;          // fixed subtree never widens the document
      p = p.parentElement;
    }
    return null;
  };

  // Elements that ACTUALLY widen the document.
  // Red-team corrections: (a) skip the whole fixed subtree, not just the fixed element;
  // (b) LTR leftward overflow never enters the scrollable overflow region -> ignore left<-1;
  // (c) keep per-element entries (no tag|cls dedupe that hid later .tbtn instances).
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    if (cs.position === 'absolute' && cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= de.clientWidth + 1) continue;                    // only rightward overflow widens LTR documents
    if (clippingAncestor(el)) continue;
    wide.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 60),
      left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
      overflowX: cs.overflowX, ws: cs.whiteSpace, pos: cs.position,
      parentChain: (() => { const c = []; let p = el.parentElement; for (let i = 0; i < 3 && p; i++) { c.push(p.tagName.toLowerCase() + '.' + (p.className || '').toString().split(' ')[0]); p = p.parentElement; } return c.join('<'); })(),
    });
  }
  // keep the widest 10 distinct *elements* (no dedupe by tag|cls)
  const offenders = wide.sort((a, b) => b.right - a.right).slice(0, 10);

  // tap targets: include summary/input/buttons/links/role=button, incl. <24px ones (red-team: 170 -> 262)
  const targets = [];
  for (const el of document.querySelectorAll('a, button, summary, input[type=button], input[type=submit], [role="button"], .tbtn, .code-copy')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (clippingAncestor(el) && el.closest('.sidebar') && de.clientWidth < 1024) {
      // inside the closed mobile drawer -> not user-reachable right now
      const sb = el.closest('.sidebar');
      if (sb.getBoundingClientRect().left < -1) continue;
    }
    targets.push({ tag: el.tagName.toLowerCase(), h: Math.round(r.height), w: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 24) });
  }
  const smallTargets = targets.filter((t) => t.h < 44);

  // inputs font size
  const inputs = [...document.querySelectorAll('input, select, textarea')].map((el) => ({
    tag: el.tagName.toLowerCase(),
    fontSize: parseFloat(getComputedStyle(el).fontSize),
    visible: el.getBoundingClientRect().height > 0,
  }));

  // header self-containment (must not overflow its own width)
  const header = document.querySelector('header, .topbar, .site-header');
  const headerBox = header ? {
    h: Math.round(header.getBoundingClientRect().height),
    scrollW: header.scrollWidth, clientW: header.clientWidth,
    overflowing: header.scrollWidth > header.clientWidth + 1,
    parts: [...header.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > header.getBoundingClientRect().right + 1;
    }).slice(0, 5).map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0]),
  } : null;

  // code blocks / tables: scroll container + keyboard access
  const pre = [...document.querySelectorAll('pre')];
  const hasScrollAncestor = (el, depth = 3) => {
    let p = el.parentElement;
    for (let i = 0; i < depth && p; i++) {
      const cs = getComputedStyle(p);
      if (['auto', 'scroll'].includes(cs.overflowX)) return true;
      p = p.parentElement;
    }
    return false;
  };
  const preScrollable = pre.filter((el) => hasScrollAncestor(el));
  const preFocusable = pre.filter((el) => {
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++) { if (p.getAttribute && p.getAttribute('tabindex') === '0') return true; p = p.parentElement; }
    return false;
  });
  const tables = [...document.querySelectorAll('table')];
  const tablesWrapped = tables.filter((t) => {
    let p = t.parentElement;
    for (let i = 0; i < 3 && p; i++) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || p.getAttribute('role') === 'region') return true;
      p = p.parentElement;
    }
    return false;
  });

  // sticky header vs anchor target offset (html scroll-padding-top is the real mechanism)
  const headerH = header ? Math.round(header.getBoundingClientRect().height) : 0;
  const headerSticky = header ? getComputedStyle(header).position : 'none';
  const htmlScrollPadding = parseFloat(getComputedStyle(de).scrollPaddingTop) || 0;
  const h2 = document.querySelector('h2[id], h3[id]');
  const scrollMargin = h2 ? parseFloat(getComputedStyle(h2).scrollMarginTop) || 0 : 0;

  // nav / drawer
  const sidebar = document.querySelector('aside, .sidebar, nav.sidebar');
  const sbRect = sidebar ? sidebar.getBoundingClientRect() : null;
  const navHidden = sidebar ? (getComputedStyle(sidebar).display === 'none' || sbRect.width === 0) : null;
  const menuEl = document.querySelector('#nav-toggle, .menu-toggle, .hamburger');
  const hasMenuButton = menuEl ? (() => {
    const cs = getComputedStyle(menuEl);
    const r = menuEl.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  })() : false;
  const navLinks = sidebar ? sidebar.querySelectorAll('a').length : 0;
  const navRowMin = sidebar ? Math.min(...[...sidebar.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().height)).filter((h) => h > 0), 999) : null;

  // TOC presence
  const toc = document.querySelector('.toc-side');
  const tocVisible = toc ? getComputedStyle(toc).display !== 'none' && toc.getBoundingClientRect().width > 0 : false;
  const tocInDrawer = !!document.querySelector('.sidebar .toc-side, .sidebar [data-toc]');
  const headingCount = document.querySelectorAll('.article h2[id], .article h3[id], .article h4[id]').length;

  // layout viewport expansion (mobile emulation chain effect the red team found)
  const vpExpanded = window.innerWidth > de.clientWidth + 1;

  return {
    overflow, offenders, smallTargetsCount: smallTargets.length, smallTargets: smallTargets.slice(0, 6),
    inputs, preCount: pre.length, preScrollableCount: preScrollable.length, preFocusableCount: preFocusable.length,
    tableCount: tables.length, tablesWrappedCount: tablesWrapped.length,
    headerH, headerSticky, headerBox, htmlScrollPadding, scrollMargin,
    navHidden, hasMenuButton, navLinks, navRowMin, tocVisible, tocInDrawer, headingCount,
    vpExpanded, clientWidth: de.clientWidth, innerWidth: window.innerWidth,
    title: document.title,
  };
};

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome/chromium found'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const results = [];
  let fails = 0;

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: vp.width < 768, hasTouch: vp.width < 768 });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      const url = BASE + p;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        const m = await page.evaluate(PROBE);
        const bad = m.overflow > 1;
        if (bad) fails++;
        console.log(
          (bad ? 'FAIL ' : ' ok  ') + vp.name.padEnd(9) + p.padEnd(52) +
          'overflow=' + String(m.overflow).padStart(4) +
          ' pre=' + m.preCount + '/scrollable ' + m.preScrollableCount +
          ' table=' + m.tableCount + '/wrapped ' + m.tablesWrappedCount +
          ' smallTargets=' + m.smallTargetsCount +
          ' navHidden=' + m.navHidden + ' menuBtn=' + m.hasMenuButton
        );
        results.push({ viewport: vp.name, page: p, ...m });
      } catch (e) {
        console.log('ERR  ' + vp.name.padEnd(9) + p + '  ' + e.message.slice(0, 80));
        results.push({ viewport: vp.name, page: p, error: e.message });
      }
    }
    await ctx.close();
  }
  await browser.close();

  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, results }, null, 2), 'utf8');
  console.log('\noverflowing page/viewport combos: ' + fails + ' / ' + (VIEWPORTS.length * PAGES.length));
  console.log('wrote ' + JSON_OUT);
  if (fails) process.exitCode = 1;
})();
