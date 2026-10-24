'use strict';
/* critique-typo-m.js -- DOM order probes: mobile TOC structure (what pushes H1 down) and
   landing/section page order above the H1. Read-only. */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const IN_PAGE = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: R2(r.width), h: R2(r.height), x: R2(r.x), y: R2(r.y + window.scrollY) }; };
  const pathOf = (el) => {
    const parts = [];
    let n = el;
    while (n && n !== document.body && parts.length < 6) {
      parts.unshift(n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.split(/\s+/).slice(0, 3).join('.') : '') + (n.id ? '#' + n.id : ''));
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  const aside = q('aside.toc-side');
  const details = q('details.side-toc');
  const cs = aside ? getComputedStyle(aside) : null;
  return {
    url: location.pathname,
    vp: window.innerWidth + 'x' + window.innerHeight,
    layoutOrder: (function () {
      const l = q('.layout');
      if (!l) return null;
      return Array.prototype.slice.call(l.children).map((c) => ({ sel: c.tagName.toLowerCase() + '.' + (typeof c.className === 'string' ? c.className : ''), order: getComputedStyle(c).order, box: box(c) }));
    })(),
    tocAside: aside ? { path: pathOf(aside), box: box(aside), display: cs.display, order: cs.order, position: cs.position, links: qa('a', aside).length, maxH: cs.maxHeight, overflowY: cs.overflowY, open: aside.tagName === 'DETAILS' ? aside.open : null } : null,
    tocDetails: details ? { path: pathOf(details), box: box(details), open: details.open, display: getComputedStyle(details).display } : null,
    h1Path: q('h1') ? pathOf(q('h1')) : null,
    h1Box: box(q('h1')),
    articleKidsBeforeH1: (function () {
      const art = q('.article');
      if (!art) return null;
      const kids = Array.prototype.slice.call(art.children);
      const i = kids.findIndex((k) => k.tagName === 'H1');
      return i >= 0 ? kids.slice(0, i).map((k) => ({ tag: k.tagName.toLowerCase(), cls: typeof k.className === 'string' ? k.className : '', box: box(k), text: (k.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50) })) : null;
    })(),
    contentKids: (function () {
      const c = q('.content') || q('main');
      if (!c) return null;
      return Array.prototype.slice.call(c.children).slice(0, 6).map((k) => ({ tag: k.tagName.toLowerCase(), cls: typeof k.className === 'string' ? k.className.split(/\s+/)[0] : '', box: box(k) }));
    })(),
    hero: q('.hero') ? { box: box(q('.hero')), kids: Array.prototype.slice.call(q('.hero').children).map((k) => ({ tag: k.tagName.toLowerCase(), cls: typeof k.className === 'string' ? k.className : '', box: box(k), text: (k.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) })) } : null,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const out = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 1025, height: 900 }]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light' });
    const page = await ctx.newPage();
    for (const u of ['/paper/dev/dialogs/', '/', '/paper/']) {
      await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
      await page.waitForTimeout(80);
      out.push(await page.evaluate(IN_PAGE));
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'm-dom.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const r of out) {
    console.log('==', r.vp, r.url, 'h1', JSON.stringify(r.h1Box));
    if (r.tocAside) console.log('  aside', r.tocAside.path, JSON.stringify(r.tocAside.box), 'display', r.tocAside.display, 'order', r.tocAside.order, 'links', r.tocAside.links);
    if (r.tocDetails) console.log('  details', JSON.stringify(r.tocDetails.box), 'open', r.tocDetails.open);
    if (r.layoutOrder) console.log('  layout order', JSON.stringify(r.layoutOrder.map((x) => x.sel + ':o' + x.order + ':y' + x.box.y + ':h' + x.box.h)));
    if (r.hero) console.log('  hero', JSON.stringify(r.hero.kids.map((k) => k.tag + '.' + k.cls + '@y' + k.box.y + 'h' + k.box.h)));
  }
})();
