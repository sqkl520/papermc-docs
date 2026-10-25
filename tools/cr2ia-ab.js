'use strict';
/**
 * cr2ia-ab.js — 8788(改前) vs 8787(改后) 的 IA 结构 diff（只读 HTTP）
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

const SNAP = () => {
  const norm = (a) => {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      if (u.hash) return null;
      let p = u.pathname;
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      return p;
    } catch (e) { return null; }
  };
  const main = document.querySelector('#main');
  const blocks = [...main.children].filter((e) => e.getBoundingClientRect().height >= 2).map((e) => {
    const h = e.matches('h1,h2,h3') ? e : e.querySelector('h1,h2,h3');
    return {
      tag: e.tagName.toLowerCase(), cls: (e.className || '').toString().split(' ')[0],
      h: Math.round(e.getBoundingClientRect().height),
      head: h ? (h.textContent || '').trim().slice(0, 40) : (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      a: e.querySelectorAll('a[href]').length,
    };
  });
  const sideLinks = [...document.querySelectorAll('#sidebar a[href]')];
  return {
    docH: Math.round(document.documentElement.scrollHeight),
    htmlKB: Math.round(new Blob([document.documentElement.outerHTML]).size / 1024),
    aTotal: document.querySelectorAll('a').length,
    uniq: new Set([...document.querySelectorAll('a[href]')].map(norm).filter(Boolean)).size,
    sideUniq: new Set(sideLinks.map(norm).filter(Boolean)).size,
    sideATags: sideLinks.length,
    sideBytes: new Blob([document.querySelector('#sidebar').outerHTML]).size,
    sideDetails: document.querySelectorAll('#sidebar details').length,
    sideDetailsOpen: document.querySelectorAll('#sidebar details[open]').length,
    sideSecs: document.querySelectorAll('#sidebar details.side-sec').length,
    sideGroups: document.querySelectorAll('#sidebar details.side-group').length,
    sideCats: document.querySelectorAll('#sidebar details.side-cat').length,
    mainUniq: new Set([...document.querySelectorAll('#main a[href]')].map(norm).filter(Boolean)).size,
    blocks,
    h2: [...document.querySelectorAll('#main h2')].map((h) => (h.textContent || '').trim().slice(0, 30)),
    statsCards: document.querySelectorAll('#main .stat').length,
    entryCards: document.querySelectorAll('#main .entry-card').length,
    quickbar: document.querySelectorAll('#main .qa').length,
    srcTrees: document.querySelectorAll('#main .src-tree').length,
    catAnchor: document.querySelectorAll('#main .cat-anchorbar a').length,
    searchInputs: document.querySelectorAll('input[type=search]').length,
    topbarItems: [...document.querySelectorAll('.topbar > *')].map((e) => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22)),
    sideLinkSet: [...new Set(sideLinks.map(norm).filter(Boolean))].sort(),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const R = { new: {}, old: {} };
  for (const [name, url] of [['landing', '/'], ['dialogs', '/paper/dev/dialogs/'], ['allpages', '/all-pages.html']]) {
    await page.goto(NEW + url, { waitUntil: 'load' }); await page.waitForTimeout(400);
    R.new[name] = await page.evaluate(SNAP);
    await page.goto(OLD + url, { waitUntil: 'load' }); await page.waitForTimeout(400);
    R.old[name] = await page.evaluate(SNAP);
  }
  // 抽屉行为对照（390 档）
  R.drawer = {};
  for (const [k, base] of [['new', NEW], ['old', OLD]]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load' }); await page.waitForTimeout(400);
    R.drawer[k] = await page.evaluate(() => {
      const s = document.querySelector('#sidebar');
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      return {
        pos: cs.position, x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
        transform: cs.transform, display: cs.display,
        onScreen: r.x + r.width > 1,
        toggle: !!document.querySelector('#nav-toggle'),
        scrim: !!document.querySelector('.nav-scrim'),
        scrollH: s.scrollHeight, clientH: s.clientHeight,
        links: s.querySelectorAll('a[href]').length,
        docW: document.documentElement.scrollWidth, vw: window.innerWidth,
      };
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // 侧栏链接集合 diff
  const A = new Set(R.new.landing.sideLinkSet), B = new Set(R.old.landing.sideLinkSet);
  R.sideDiff = {
    newOnly: [...A].filter((x) => !B.has(x)),
    oldOnly: [...B].filter((x) => !A.has(x)),
    common: [...A].filter((x) => B.has(x)).length,
  };
  for (const k of Object.keys(R.new)) delete R.new[k].sideLinkSet;
  for (const k of Object.keys(R.old)) delete R.old[k].sideLinkSet;

  fs.writeFileSync(path.join(OUT, 'ab.json'), JSON.stringify(R, null, 2), 'utf8');

  const L = [];
  for (const name of ['landing', 'dialogs', 'allpages']) {
    const n = R.new[name], o = R.old[name];
    L.push('### ' + name);
    L.push('  new: docH=' + n.docH + ' html=' + n.htmlKB + 'KB a=' + n.aTotal + ' uniq=' + n.uniq + ' sideATags=' + n.sideATags + ' sideUniq=' + n.sideUniq + ' sideKB=' + Math.round(n.sideBytes / 1024) + ' details=' + n.sideDetails + '(' + n.sideDetailsOpen + ' open) groups=' + n.sideGroups + ' secs=' + n.sideSecs);
    L.push('  old: docH=' + o.docH + ' html=' + o.htmlKB + 'KB a=' + o.aTotal + ' uniq=' + o.uniq + ' sideATags=' + o.sideATags + ' sideUniq=' + o.sideUniq + ' sideKB=' + Math.round(o.sideBytes / 1024) + ' details=' + o.sideDetails + '(' + o.sideDetailsOpen + ' open) groups=' + o.sideGroups + ' secs=' + o.sideSecs);
    L.push('  new blocks=' + n.blocks.length + ' stats=' + n.statsCards + ' entry=' + n.entryCards + ' qa=' + n.quickbar + ' srcTrees=' + n.srcTrees + ' catAnchor=' + n.catAnchor + ' mainUniq=' + n.mainUniq + ' h2=' + JSON.stringify(n.h2));
    L.push('  old blocks=' + o.blocks.length + ' stats=' + o.statsCards + ' entry=' + o.entryCards + ' qa=' + o.quickbar + ' srcTrees=' + o.srcTrees + ' catAnchor=' + o.catAnchor + ' mainUniq=' + o.mainUniq + ' h2=' + JSON.stringify(o.h2));
    L.push('  new topbar=' + JSON.stringify(n.topbarItems));
    L.push('  old topbar=' + JSON.stringify(o.topbarItems));
    L.push('  --- new blocks ---');
    for (const b of n.blocks) L.push('    +' + String(b.h).padStart(5) + ' ' + (b.tag + '.' + b.cls).padEnd(22) + ' a=' + String(b.a).padStart(3) + ' ' + b.head);
    L.push('  --- old blocks ---');
    for (const b of o.blocks) L.push('    +' + String(b.h).padStart(5) + ' ' + (b.tag + '.' + b.cls).padEnd(22) + ' a=' + String(b.a).padStart(3) + ' ' + b.head);
  }
  L.push('');
  L.push('== DRAWER 390 ==');
  L.push('new ' + JSON.stringify(R.drawer.new));
  L.push('old ' + JSON.stringify(R.drawer.old));
  L.push('');
  L.push('== SIDE LINK DIFF == ' + JSON.stringify(R.sideDiff));
  const txt = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'ab.txt'), txt, 'utf8');
  console.log(txt);
  await browser.close();
})();
