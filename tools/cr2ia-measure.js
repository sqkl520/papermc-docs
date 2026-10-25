'use strict';
/**
 * cr2ia-measure.js — IA 取证探针（只读，不写站点产物）
 * 用法：node tools/cr2ia-measure.js
 * 输出：<tmpdir>/cr2ia/*.json + 终端摘要
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2ia');
fs.mkdirSync(OUT, { recursive: true });

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const TARGETS = [
  '/paper/dev/dialogs/',
  '/paper/reference/world-configuration/',
  '/velocity/tuning/',
];

/** 页面里跑的通用采集：链接/侧栏/区块 */
const PROBE = () => {
  const norm = (a) => {
    try {
      const u = new URL(a.href, location.href);
      u.hash = '';
      let p = u.pathname;
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p;
    } catch (e) { return null; }
  };
  const all = [...document.querySelectorAll('a[href]')];
  const side = document.querySelector('#sidebar');
  const main = document.querySelector('#main') || document.querySelector('main');
  const sideLinks = side ? [...side.querySelectorAll('a[href]')] : [];
  const mainLinks = main ? [...main.querySelectorAll('a[href]')] : [];
  const uniq = (arr) => [...new Set(arr.map(norm).filter(Boolean))];

  // 侧栏几何
  let sideGeo = null;
  if (side) {
    const r = side.getBoundingClientRect();
    const cs = getComputedStyle(side);
    const vh = window.innerHeight;
    const top = r.top;
    const inView = sideLinks.filter((a) => {
      const b = a.getBoundingClientRect();
      return b.height > 0 && b.top >= Math.max(0, top - 1) && b.bottom <= vh + 0.5;
    });
    sideGeo = {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      clientH: side.clientHeight,
      scrollH: side.scrollHeight,
      overflowY: cs.overflowY,
      scrollable: side.scrollHeight > side.clientHeight + 1,
      viewportH: vh,
      linksTotal: sideLinks.length,
      linksUnique: uniq(sideLinks).length,
      linksVisibleFirstScreen: inView.length,
      details: side.querySelectorAll('details').length,
      events: null,
    };
  }

  // 侧栏深度分布
  const depthBuckets = {};
  let maxDepth = 0;
  if (side) {
    for (const a of sideLinks) {
      let d = 0;
      let n = a;
      while (n && n !== side) {
        if (n.tagName === 'DETAILS') d++;
        n = n.parentElement;
      }
      depthBuckets[d] = (depthBuckets[d] || 0) + 1;
      if (d > maxDepth) maxDepth = d;
    }
    sideGeo.events = {
      sideGroup: side.querySelectorAll('details.side-group').length,
      sideSec: side.querySelectorAll('details.side-sec').length,
      sideToc: side.querySelectorAll('details.side-toc').length,
      sideCat: side.querySelectorAll('details.side-cat').length,
      inputs: side.querySelectorAll('input').length,
      depthBuckets,
      maxDetailsDepth: maxDepth,
      maxUlDepth: (() => {
        let m = 0;
        for (const ul of side.querySelectorAll('ul')) {
          let d = 0; let n = ul;
          while (n && n !== side) { if (n.tagName === 'UL') d++; n = n.parentElement; }
          if (d > m) m = d;
        }
        return m;
      })(),
      openDetails: side.querySelectorAll('details[open]').length,
    };
  }

  // 首页/内容页主内容区块清单
  const blocks = [];
  if (main) {
    const kids = [...main.children];
    for (const el of kids) {
      const b = el.getBoundingClientRect();
      const hy = window.scrollY;
      if (b.height < 2) continue;
      const h = el.matches('h1,h2,h3') ? el : el.querySelector('h1,h2,h3');
      blocks.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 60),
        head: h ? (h.textContent || '').trim().slice(0, 46) : (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 46),
        top: Math.round(b.top + hy),
        h: Math.round(b.height),
        anchors: el.querySelectorAll('a[href]').length,
      });
    }
  }

  return {
    url: location.pathname,
    title: document.title,
    docH: Math.round(document.documentElement.scrollHeight),
    vh: window.innerHeight,
    anchorsAll: all.length,
    anchorsUnique: uniq(all).length,
    anchorsMain: mainLinks.length,
    anchorsMainUnique: uniq(mainLinks).length,
    sidebar: sideGeo,
    blocks,
    inputsSearch: document.querySelectorAll('input[type="search"]').length,
    detailsAll: document.querySelectorAll('details').length,
  };
};

/** 在某个页面上：统计指向 targets 的锚点，按区域归类 */
const COUNT_ENTRIES = (targets) => {
  const norm = (a) => {
    try {
      const u = new URL(a.href, location.href);
      u.hash = '';
      let p = u.pathname;
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p;
    } catch (e) { return null; }
  };
  const regionOf = (a) => {
    if (a.closest('#sidebar')) return 'sidebar';
    if (a.closest('.src-tree')) return 'src-tree(首页重复树)';
    if (a.closest('.entry-cards')) return 'entry-cards';
    if (a.closest('.quickbar')) return 'quickbar';
    if (a.closest('.cat-anchorbar')) return 'cat-anchorbar';
    if (a.closest('.crumbs')) return 'crumbs';
    if (a.closest('.pager')) return 'pager';
    if (a.closest('.toc-side') || a.closest('[data-drawer-toc]')) return 'toc';
    if (a.closest('table')) return 'table(all-pages/snapshots)';
    if (a.closest('.hero')) return 'hero';
    if (a.closest('.stats')) return 'stats';
    if (a.closest('.side-section')) return 'side-footer';
    if (a.closest('footer')) return 'footer';
    return 'body-other';
  };
  const out = {};
  for (const t of targets) out[t] = {};
  const all = [...document.querySelectorAll('a[href]')];
  for (const a of all) {
    const p = norm(a);
    if (!p || !(p in out)) continue;
    const r = regionOf(a);
    out[p][r] = (out[p][r] || 0) + 1;
  }
  // 目标链接的 y 位置（页面坐标）
  const pos = {};
  for (const t of targets) {
    const a = all.find((x) => norm(x) === t);
    if (a) {
      const b = a.getBoundingClientRect();
      pos[t] = { y: Math.round(b.top + window.scrollY), region: regionOf(a), text: (a.textContent || '').trim().slice(0, 40) };
    }
  }
  return { url: location.pathname, entries: out, firstPos: pos, anchors: all.length };
};

/** 目标页自身：面包屑/翻页/TOC/侧栏里到达它的点击数 */
const PAGE_SELF = (target) => {
  const side = document.querySelector('#sidebar');
  const norm = (a) => {
    try {
      const u = new URL(a.href, location.href);
      u.hash = '';
      let p = u.pathname;
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p;
    } catch (e) { return null; }
  };
  const act = side ? side.querySelector('a[aria-current="page"]') : null;
  let clicks = null;
  let chain = null;
  if (act) {
    const closed = [];
    let n = act;
    while (n && n !== side) {
      if (n.tagName === 'DETAILS' && !n.hasAttribute('open')) closed.push((n.querySelector('summary') || {}).textContent || '');
      n = n.parentElement;
    }
    clicks = closed.length + 1; // 展开 + 点链接
    chain = closed.map((s) => s.trim().slice(0, 30));
  }
  const crumbs = document.querySelector('.crumbs');
  const crumbLinks = crumbs ? crumbs.querySelectorAll('a').length : 0;
  const pager = document.querySelector('.pager');
  const toc = document.querySelector('.toc-side');
  const aa = [...document.querySelectorAll('a[href]')].filter((a) => norm(a) === target);
  return {
    url: location.pathname,
    selfLinks: aa.length,
    activeInSidebar: !!act,
    clicksFromSidebar: clicks,
    closedChain: chain,
    crumbSteps: crumbLinks,
    pagerLinks: pager ? pager.querySelectorAll('a').length : 0,
    tocItems: toc ? toc.querySelectorAll('a').length : 0,
    details: document.querySelectorAll('details[open]').length + '/' + document.querySelectorAll('details').length,
    docH: Math.round(document.documentElement.scrollHeight),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  const go = async (base, u) => {
    await page.goto(base + u, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(350);
  };

  const result = { generated_at: new Date().toISOString(), new: NEW, old: OLD };

  // ---------- 1. 新站：首页 ----------
  await go(NEW, '/');
  result.landing = await page.evaluate(PROBE);
  // 侧栏与主内容的重合率
  result.landing.overlap = await page.evaluate(() => {
    const norm = (a) => {
      try {
        const u = new URL(a.href, location.href); u.hash = '';
        let p = u.pathname;
        if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
        return p;
      } catch (e) { return null; }
    };
    const side = new Set([...document.querySelectorAll('#sidebar a[href]')].map(norm).filter(Boolean));
    const main = new Set([...document.querySelectorAll('#main a[href]')].map(norm).filter(Boolean));
    const tree = new Set([...document.querySelectorAll('.src-tree a[href]')].map(norm).filter(Boolean));
    const inter = [...main].filter((x) => side.has(x));
    const treeInSide = [...tree].filter((x) => side.has(x));
    return {
      sideUnique: side.size, mainUnique: main.size, overlap: inter.length,
      overlapPct: main.size ? Math.round((inter.length / main.size) * 1000) / 10 : null,
      treeUnique: tree.size, treeInSide: treeInSide.length,
      treeOverlapPct: tree.size ? Math.round((treeInSide.length / tree.size) * 1000) / 10 : null,
      sideNotInMain: [...side].filter((x) => !main.has(x)).length,
    };
  });
  // 首页 src-tree 深度分布 + 目标链接位置
  result.landing.tree = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.src-tree li')];
    const b = {};
    for (const li of items) {
      const d = parseInt(li.style.getPropertyValue('--d') || '0', 10);
      b[d] = (b[d] || 0) + 1;
    }
    return { nodes: items.length, depthBuckets: b, srcItems: document.querySelectorAll('.src-item').length, srcGroups: document.querySelectorAll('.src-group').length, links: document.querySelectorAll('.src-tree a').length };
  });

  // ---------- 2. 新站：三个目标页的入口统计 ----------
  result.entries = {};
  for (const site of [['landing', '/'], ['section', '/paper/'], ['allpages', '/all-pages.html'], ['snapshots', '/snapshots.html']]) {
    await go(NEW, site[1]);
    result.entries[site[0]] = await page.evaluate(COUNT_ENTRIES, TARGETS);
  }
  for (const t of TARGETS) {
    await go(NEW, t);
    result.entries['self:' + t] = await page.evaluate(PAGE_SELF, t);
  }

  // ---------- 3. 侧栏在三个视口下的几何 ----------
  result.sidebarByVp = {};
  for (const vp of [[1440, 900], [1280, 800], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: vp[0], height: vp[1] });
    await go(NEW, '/paper/dev/dialogs/');
    result.sidebarByVp[vp.join('x')] = await page.evaluate(() => {
      const s = document.querySelector('#sidebar');
      if (!s) return null;
      const cs = getComputedStyle(s);
      const vis = cs.display !== 'none' && s.getBoundingClientRect().width > 0;
      const links = [...s.querySelectorAll('a[href]')];
      const vh = window.innerHeight;
      const inView = links.filter((a) => { const b = a.getBoundingClientRect(); return b.height > 0 && b.top >= 0 && b.bottom <= vh; });
      return {
        visible: vis, display: cs.display, rect: (() => { const r = s.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        clientH: s.clientHeight, scrollH: s.scrollHeight, overflowY: cs.overflowY,
        links: links.length, inView: inView.length, vh,
      };
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---------- 4. 旧站 A/B ----------
  result.old = {};
  for (const u of ['/', '/paper/', '/paper/dev/dialogs/', '/all-pages.html']) {
    try {
      await go(OLD, u);
      result.old[u] = await page.evaluate(PROBE);
    } catch (e) { result.old[u] = { error: e.message }; }
  }

  // ---------- 5. 搜索入口（DOM 侧） ----------
  await go(NEW, '/');
  result.searchEntry = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-open-search]')];
    return {
      searchInputs: [...document.querySelectorAll('input[type="search"]')].map((i) => ({ id: i.id, ph: (i.getAttribute('placeholder') || '').slice(0, 50), in: i.closest('#sidebar') ? 'sidebar' : (i.closest('.hero') ? 'hero' : (i.closest('.filter-bar') ? 'allpages-filter' : 'other')) })),
      openSearchButtons: btn.length,
      kbdHints: document.querySelectorAll('kbd').length,
      hasDialog: !!document.querySelector('#search-dialog'),
      sideFooterLinks: [...document.querySelectorAll('.side-section a')].map((a) => (a.textContent || '').trim()),
      catCount: document.querySelectorAll('.cat-anchorbar a').length,
    };
  });

  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(result, null, 2), 'utf8');

  // ---------- 摘要 ----------
  const L = [];
  L.push('== LANDING ==');
  L.push('docH=' + result.landing.docH + ' anchors=' + result.landing.anchorsAll + ' uniq=' + result.landing.anchorsUnique + ' mainAnchors=' + result.landing.anchorsMain + ' mainUniq=' + result.landing.anchorsMainUnique);
  L.push('overlap=' + JSON.stringify(result.landing.overlap));
  L.push('tree=' + JSON.stringify(result.landing.tree));
  L.push('sideGeo=' + JSON.stringify(result.landing.sidebar));
  L.push('blocks:');
  for (const b of result.landing.blocks) L.push('  ' + String(b.top).padStart(5) + ' +' + String(b.h).padStart(5) + '  ' + (b.tag + '.' + b.cls).slice(0, 34).padEnd(36) + ' a=' + String(b.anchors).padStart(3) + '  ' + b.head);
  L.push('');
  L.push('== ENTRIES ==');
  for (const k of Object.keys(result.entries)) L.push(k + ' -> ' + JSON.stringify(result.entries[k]));
  L.push('');
  L.push('== SIDEBAR BY VP ==');
  for (const k of Object.keys(result.sidebarByVp)) L.push(k + ' ' + JSON.stringify(result.sidebarByVp[k]));
  L.push('');
  L.push('== OLD (8788) ==');
  for (const k of Object.keys(result.old)) {
    const o = result.old[k];
    if (o.error) { L.push(k + ' ERR ' + o.error); continue; }
    L.push(k + ' docH=' + o.docH + ' anchors=' + o.anchorsAll + ' uniq=' + o.anchorsUnique + ' mainUniq=' + o.anchorsMainUnique + ' blocks=' + o.blocks.length + ' sidebar=' + (o.sidebar ? o.sidebar.linksTotal + '/' + o.sidebar.linksUnique : 'none'));
  }
  L.push('');
  L.push('== SEARCH ENTRY ==');
  L.push(JSON.stringify(result.searchEntry, null, 1));
  const txt = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'summary.txt'), txt, 'utf8');
  console.log(txt);

  await browser.close();
})();
