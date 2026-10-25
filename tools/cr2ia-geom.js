'use strict';
/**
 * cr2ia-geom.js — 侧栏几何 / 首屏可见链接 / 链接计数口径核对（只读）
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

const SIDE = () => {
  const s = document.querySelector('#sidebar');
  if (!s) return null;
  const cs = getComputedStyle(s);
  const r = s.getBoundingClientRect();
  const links = [...s.querySelectorAll('a[href]')];
  const heis = {};
  const vis = [];      // 完全落在侧栏自身可视区域内
  const partly = [];
  for (const a of links) {
    const b = a.getBoundingClientRect();
    const h = Math.round(b.height);
    heis[h] = (heis[h] || 0) + 1;
    const clipped = b.height > 0 && b.bottom > r.top + 1 && b.top < r.bottom - 1;
    const fully = b.height > 0 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
    if (clipped) partly.push((a.textContent || '').trim().slice(0, 24));
    if (fully) vis.push((a.textContent || '').trim().slice(0, 24));
  }
  return {
    position: cs.position, overflowY: cs.overflowY, display: cs.display,
    transform: cs.transform,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    clientH: s.clientHeight, scrollH: s.scrollHeight,
    scrollable: s.scrollHeight > s.clientHeight + 1,
    links: links.length,
    heightHistogram: heis,
    fullyVisibleLinks: vis.length,
    fullyVisibleSample: vis.slice(0, 8),
    clippedLinks: partly.length,
    lastVisibleText: vis.length ? vis[vis.length - 1] : null,
    // 链接纵向跨度
    contentSpan: (() => {
      const tops = links.map((a) => a.getBoundingClientRect().top).filter((t) => Number.isFinite(t));
      const bots = links.map((a) => a.getBoundingClientRect().bottom).filter((t) => Number.isFinite(t));
      return { top: Math.round(Math.min(...tops)), bottom: Math.round(Math.max(...bots)) };
    })(),
    vh: window.innerHeight,
    matchMedia: {
      m1025: matchMedia('(min-width:1025px)').matches,
      m1200: matchMedia('(min-width:1200px)').matches,
      m1280: matchMedia('(min-width:1280px)').matches,
    },
  };
};

const COUNTS = () => {
  const norm = (a, keepHash) => {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      if (!keepHash) u.hash = '';
      let p = u.pathname + (keepHash ? u.hash : '');
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p;
    } catch (e) { return null; }
  };
  const all = [...document.querySelectorAll('a')];
  const withHref = all.filter((a) => a.hasAttribute('href'));
  const rawAttr = new Set(withHref.map((a) => a.getAttribute('href')));
  const absHash = new Set(withHref.map((a) => { try { return new URL(a.getAttribute('href'), location.href).href; } catch (e) { return null; } }).filter(Boolean));
  const normPath = new Set(withHref.map((a) => norm(a, false)).filter(Boolean));
  const normHash = new Set(withHref.map((a) => norm(a, true)).filter(Boolean));
  const side = new Set([...document.querySelectorAll('#sidebar a[href]')].map((a) => norm(a, false)).filter(Boolean));
  const main = new Set([...document.querySelectorAll('#main a[href]')].map((a) => norm(a, false)).filter(Boolean));
  const htmlBytes = new Blob([document.documentElement.outerHTML]).size;
  return {
    url: location.pathname,
    aTotal: all.length,
    aWithHref: withHref.length,
    uniqRawAttr: rawAttr.size,
    uniqAbsoluteWithHash: absHash.size,
    uniqNormPath: normPath.size,
    uniqNormWithHash: normHash.size,
    sideUniq: side.size, mainUniq: main.size,
    mainMinusSide: [...main].filter((x) => !side.has(x)).length,
    sideMinusMain: [...side].filter((x) => !main.has(x)).length,
    htmlKB: Math.round(htmlBytes / 1024),
    // 树区块
    srcTreeLinks: document.querySelectorAll('.src-tree a[href]').length,
    srcTreeUniq: new Set([...document.querySelectorAll('.src-tree a[href]')].map((a) => norm(a, false)).filter(Boolean)).size,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const out = {};

  for (const [name, url] of [['landing', '/'], ['dialogs', '/paper/dev/dialogs/'], ['allpages', '/all-pages.html'], ['tuning', '/velocity/tuning/']]) {
    await page.goto(NEW + url, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    out['counts@' + name] = await page.evaluate(COUNTS);
    out['side@' + name] = await page.evaluate(SIDE);
  }

  // 视口矩阵（在内容页上，侧栏最费空间的形态）
  out.vp = {};
  for (const [w, h] of [[1440, 900], [1280, 800], [1200, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const s = await page.evaluate(SIDE);
    out.vp[w + 'x' + h] = s ? {
      position: s.position, rect: s.rect, clientH: s.clientH, scrollH: s.scrollH,
      scrollable: s.scrollable, links: s.links, fullyVisible: s.fullyVisibleLinks,
      lastVisible: s.lastVisibleText, span: s.contentSpan, vh: s.vh, mm: s.matchMedia,
    } : null;
    // 抽屉未打开时侧栏是否在视口外
    const offscreen = await page.evaluate(() => {
      const s = document.querySelector('#sidebar');
      const r = s.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), onScreen: r.x + r.width > 1 };
    });
    out.vp[w + 'x' + h].drawerOffscreenClosed = !offscreen.onScreen;
  }

  // 旧站侧栏几何（1440）
  await page.setViewportSize({ width: 1440, height: 900 });
  out.old = {};
  for (const [name, url] of [['landing', '/'], ['dialogs', '/paper/dev/dialogs/'], ['allpages', '/all-pages.html']]) {
    try {
      await page.goto(OLD + url, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      out.old[name] = { counts: await page.evaluate(COUNTS), side: await page.evaluate(SIDE) };
    } catch (e) { out.old[name] = { error: e.message }; }
  }

  fs.writeFileSync(path.join(OUT, 'geom.json'), JSON.stringify(out, null, 2), 'utf8');

  const L = [];
  L.push('== COUNTS (new) ==');
  for (const k of Object.keys(out).filter((x) => x.startsWith('counts@'))) L.push(k + ' ' + JSON.stringify(out[k]));
  L.push('');
  L.push('== SIDEBAR (new) ==');
  for (const k of Object.keys(out).filter((x) => x.startsWith('side@'))) {
    const s = out[k];
    L.push(k + ' pos=' + s.position + ' rect=' + JSON.stringify(s.rect) + ' clientH=' + s.clientH + ' scrollH=' + s.scrollH + ' scrollable=' + s.scrollable + ' links=' + s.links + ' fullyVisible=' + s.fullyVisibleLinks + ' clipped=' + s.clippedLinks + ' span=' + JSON.stringify(s.contentSpan));
    L.push('   heights=' + JSON.stringify(s.heightHistogram) + ' last=' + JSON.stringify(s.lastVisibleText));
  }
  L.push('');
  L.push('== VIEWPORTS ==');
  for (const k of Object.keys(out.vp)) L.push(k + ' ' + JSON.stringify(out.vp[k]));
  L.push('');
  L.push('== OLD 8788 ==');
  for (const k of Object.keys(out.old)) {
    const o = out.old[k];
    if (o.error) { L.push(k + ' ERR'); continue; }
    L.push(k + ' ' + JSON.stringify(o.counts));
    L.push('   side pos=' + o.side.position + ' links=' + o.side.links + ' fullyVisible=' + o.side.fullyVisibleLinks + ' scrollH=' + o.side.scrollH + ' clientH=' + o.side.clientH + ' heights=' + JSON.stringify(o.side.heightHistogram));
  }
  const txt = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'geom.txt'), txt, 'utf8');
  console.log(txt);
  await browser.close();
})();
