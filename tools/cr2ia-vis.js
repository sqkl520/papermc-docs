'use strict';
/**
 * cr2ia-vis.js — 可见性口径修正 + 入口机制枚举 + 展开成本（只读）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2ia');
fs.mkdirSync(OUT, { recursive: true });
const NEW = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const TARGETS = ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/'];

/** 侧栏真实可见性：checkVisibility + 侧栏可视区内 */
const SIDEVIS = () => {
  const s = document.querySelector('#sidebar');
  const r = s.getBoundingClientRect();
  const links = [...s.querySelectorAll('a[href]')];
  let rendered = 0, renderedInBox = 0, hidden = 0;
  const rows = [];
  for (const a of links) {
    const b = a.getBoundingClientRect();
    const cv = a.checkVisibility ? a.checkVisibility() : (b.height > 0);
    if (cv) rendered++; else hidden++;
    const inBox = cv && b.height > 0 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
    if (inBox) renderedInBox++;
    rows.push({ t: (a.textContent || '').trim().slice(0, 26), h: Math.round(b.height), top: Math.round(b.top), cv, inBox });
  }
  return {
    pos: getComputedStyle(s).position,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    clientH: s.clientHeight, scrollH: s.scrollHeight,
    links: links.length,
    rendered, hidden, renderedInBox,
    openDetails: s.querySelectorAll('details[open]').length,
    details: s.querySelectorAll('details').length,
    first20: rows.slice(0, 20),
    renderedSample: rows.filter((x) => x.cv).slice(0, 6).map((x) => x.t),
    renderedTail: rows.filter((x) => x.cv).slice(-4).map((x) => x.t),
  };
};

/** 当前页在侧栏中的位置（sticky 侧栏内部坐标） */
const ACTIVE = () => {
  const s = document.querySelector('#sidebar');
  const act = s.querySelector('a[aria-current="page"]');
  if (!act) return null;
  const r = s.getBoundingClientRect();
  const b = act.getBoundingClientRect();
  // 需要滚动多少才能把它完整带进侧栏可视框
  const above = b.top - r.top;      // 负 = 已在框上方
  const below = b.bottom - r.bottom; // 正 = 在框下方
  let needScroll = 0;
  if (below > 0) needScroll = below + 40;
  else if (above < 0) needScroll = above - 40;
  return {
    text: (act.textContent || '').trim().slice(0, 40),
    rectTop: Math.round(b.top), sidebarTop: Math.round(r.top), sidebarBottom: Math.round(r.bottom),
    inSidebarViewport: b.top >= r.top - 1 && b.bottom <= r.bottom + 1,
    needScrollPx: Math.round(needScroll),
    scrollTopNow: s.scrollTop,
  };
};

/** 展开全部 details 需要多少次点击 + 展开后总高 */
const EXPAND_COST = () => {
  const s = document.querySelector('#sidebar');
  const closed = [...s.querySelectorAll('details:not([open])')];
  const before = { h: s.scrollHeight, links: s.querySelectorAll('a[href]').length };
  for (const d of closed) d.open = true;
  const after = { h: s.scrollHeight, links: s.querySelectorAll('a[href]').length };
  return { closedDetails: closed.length, before, after };
};

/** 从侧栏到最深页面的点击链 */
const DEEPEST = () => {
  const s = document.querySelector('#sidebar');
  const links = [...s.querySelectorAll('a[href]')];
  let best = null;
  for (const a of links) {
    let d = 0; let n = a;
    while (n && n !== s) { if (n.tagName === 'DETAILS') d++; n = n.parentElement; }
    if (!best || d > best.d) best = { d, t: (a.textContent || '').trim().slice(0, 30), href: a.getAttribute('href'), ulDepth: (() => { let u = 0; let m = a; while (m && m !== s) { if (m.tagName === 'UL') u++; m = m.parentElement; } return u; })() };
  }
  const all = links.map((a) => { let d = 0; let n = a; while (n && n !== s) { if (n.tagName === 'DETAILS') d++; n = n.parentElement; } return d; });
  const hist = {};
  for (const d of all) hist[d] = (hist[d] || 0) + 1;
  return { deepest: best, detailsDepthHistogram: hist, max: Math.max(...all) };
};

/** 入口枚举：给定目标路径，按区域数 */
const ENTRIES = (targets) => {
  const norm = (a) => {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      if (u.hash) return null; // 页内锚不算入口
      let p = u.pathname;
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p;
    } catch (e) { return null; }
  };
  const regionOf = (a) => {
    if (a.closest('#sidebar')) return 'sidebar';
    if (a.closest('.src-tree')) return 'home-src-tree';
    if (a.closest('.entry-cards')) return 'entry-cards';
    if (a.closest('.quickbar')) return 'quickbar';
    if (a.closest('.cat-anchorbar')) return 'cat-anchorbar';
    if (a.closest('.cat-block, .tax-list, .cat-links')) return 'category-body';
    if (a.closest('.crumbs')) return 'breadcrumb';
    if (a.closest('.pager')) return 'pager';
    if (a.closest('.toc-side, [data-drawer-toc]')) return 'toc';
    if (a.closest('table.allpages')) return 'allpages-table';
    if (a.closest('table.snapshots')) return 'snapshots-table';
    if (a.closest('footer')) return 'footer';
    if (a.closest('#main')) return 'main-body';
    return 'other';
  };
  const out = {};
  for (const t of targets) out[t] = { byRegion: {}, total: 0 };
  for (const a of document.querySelectorAll('a[href]')) {
    const p = norm(a);
    if (!p || !(p in out)) continue;
    const r = regionOf(a);
    out[p].byRegion[r] = (out[p].byRegion[r] || 0) + 1;
    out[p].total++;
  }
  return { url: location.pathname, out };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const R = {};

  for (const [name, url] of [['landing', '/'], ['dialogs', '/paper/dev/dialogs/'], ['allpages', '/all-pages.html'], ['tuning', '/velocity/tuning/']]) {
    await page.goto(NEW + url, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    R['sidevis@' + name] = await page.evaluate(SIDEVIS);
    R['active@' + name] = await page.evaluate(ACTIVE);
    if (name === 'dialogs') R.expand = await page.evaluate(EXPAND_COST);
    R['deepest@' + name] = await page.evaluate(DEEPEST);
  }

  // 入口枚举
  R.entries = {};
  for (const [name, url] of [['landing', '/'], ['paper-section', '/paper/'], ['allpages', '/all-pages.html'], ['snapshots', '/snapshots.html']]) {
    await page.goto(NEW + url, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    R.entries[name] = await page.evaluate(ENTRIES, TARGETS);
  }
  // 目标页自身（面包屑 / 翻页 / toc）
  for (const t of TARGETS) {
    await page.goto(NEW + t, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    R.entries['self' + t] = await page.evaluate(ENTRIES, TARGETS);
  }

  // 分类页覆盖（17 个分类里有几个含某目标）
  R.catCover = [];
  await page.goto(NEW + '/all-pages.html', { waitUntil: 'load' });
  const catHrefs = await page.evaluate(() => [...document.querySelectorAll('#sidebar .side-cat a[href]')].map((a) => a.getAttribute('href')));
  for (const h of catHrefs) {
    await page.goto(NEW + '/all-pages.html'.replace('all-pages.html', h), { waitUntil: 'load' });
    const hit = await page.evaluate((targets) => {
      const norm = (a) => { try { const u = new URL(a.getAttribute('href'), location.href); let p = u.pathname; if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length); return p; } catch (e) { return null; } };
      const inMain = new Set([...document.querySelectorAll('#main a[href]')].map(norm).filter(Boolean));
      return targets.filter((t) => inMain.has(t));
    }, TARGETS);
    R.catCover.push({ cat: h, hits: hit });
  }

  fs.writeFileSync(path.join(OUT, 'vis.json'), JSON.stringify(R, null, 2), 'utf8');

  const L = [];
  L.push('== SIDEBAR VISIBILITY ==');
  for (const k of Object.keys(R).filter((x) => x.startsWith('sidevis@'))) {
    const s = R[k];
    L.push(k + ' pos=' + s.pos + ' h=' + s.rect.h + ' clientH=' + s.clientH + ' scrollH=' + s.scrollH + ' links=' + s.links + ' rendered=' + s.rendered + ' hidden=' + s.hidden + ' inBox=' + s.renderedInBox + ' details=' + s.openDetails + '/' + s.details);
    L.push('    renderedHead=' + JSON.stringify(s.renderedSample) + ' tail=' + JSON.stringify(s.renderedTail));
  }
  L.push('');
  L.push('== ACTIVE POSITION ==');
  for (const k of Object.keys(R).filter((x) => x.startsWith('active@'))) L.push(k + ' ' + JSON.stringify(R[k]));
  L.push('');
  L.push('== EXPAND COST == ' + JSON.stringify(R.expand));
  L.push('== DEEPEST ==');
  for (const k of Object.keys(R).filter((x) => x.startsWith('deepest@'))) L.push(k + ' ' + JSON.stringify(R[k]));
  L.push('');
  L.push('== ENTRIES ==');
  for (const k of Object.keys(R.entries)) {
    const e = R.entries[k];
    L.push(k + ' (' + e.url + ')');
    for (const t of Object.keys(e.out)) L.push('   ' + t.padEnd(42) + ' total=' + String(e.out[t].total).padStart(2) + '  ' + JSON.stringify(e.out[t].byRegion));
  }
  L.push('');
  L.push('== CATEGORY COVERAGE ==');
  for (const c of R.catCover) L.push(c.cat + ' -> ' + JSON.stringify(c.hits));
  const txt = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'vis.txt'), txt, 'utf8');
  console.log(txt);
  await browser.close();
})();
