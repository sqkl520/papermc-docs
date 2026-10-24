'use strict';
/**
 * b1g-nest.js - explain the m.capW/m.lineW change on reference-longpage at 390/320
 * (nested list paragraph narrower after) and the /all-pages table mode change.
 *
 * Usage: node tools/b1g-nest.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const P = () => {
  const art = document.querySelector('article');
  if (!art) return null;
  const isProse = (el) => !el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs') && (el.textContent || '').trim().length >= 40;
  const prose = [...art.querySelectorAll('p')].filter(isProse)[0];
  if (!prose) return null;
  const cs = (e, p) => getComputedStyle(e)[p];
  const chain = [];
  let n = prose;
  while (n && n !== art && chain.length < 6) {
    chain.push({
      tag: n.tagName.toLowerCase(),
      cls: typeof n.className === 'string' ? (n.className.split(/\s+/)[0] || '') : '',
      w: Math.round(n.getBoundingClientRect().width * 100) / 100,
      padL: cs(n, 'paddingLeft'), marL: cs(n, 'marginLeft'), fs: cs(n, 'fontSize'),
    });
    n = n.parentElement;
  }
  const rg = document.createRange(); rg.selectNodeContents(prose);
  const rs = [...rg.getClientRects()].filter((x) => x.width > 1);
  return {
    text: (prose.textContent || '').trim().slice(0, 50),
    proseW: Math.round(prose.getBoundingClientRect().width * 100) / 100,
    lineW: rs.length ? Math.round(Math.max(...rs.map((x) => x.width)) * 100) / 100 : null,
    chain,
    innerW: window.innerWidth, clientW: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth,
  };
};

const AP = () => {
  const t = document.querySelector('table.allpages');
  if (!t) return null;
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const tr = t.querySelector('tbody tr');
  return {
    disp: cs(t, 'display'), w: Math.round(t.getBoundingClientRect().width),
    rowDisp: cs(tr, 'display'), rowH: tr ? Math.round(tr.getBoundingClientRect().height) : null,
    rows: t.querySelectorAll('tbody tr').length,
    pageH: document.documentElement.scrollHeight,
    scrollW: document.documentElement.scrollWidth,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    for (const vp of [{ n: '390', w: 390, h: 844 }, { n: '320', w: 320, h: 568 }]) {
      for (const u of ['/paper/reference/world-configuration/', '/velocity/tuning/', '/paper/dev/dialogs/']) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await page.goto(base + u, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(350);
        out[side + ' ' + vp.n + ' ' + u] = await page.evaluate(P);
        await ctx.close();
      }
      const ctx2 = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const p2 = await ctx2.newPage();
      await p2.goto(base + '/all-pages.html', { waitUntil: 'load', timeout: 45000 });
      await p2.waitForTimeout(350);
      out[side + ' ' + vp.n + ' /all-pages.html'] = await p2.evaluate(AP);
      await ctx2.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'b1-shots', '_nest.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) {
    if (k.includes('all-pages')) { console.log(k + ' ' + JSON.stringify(v)); continue; }
    if (!v) { console.log(k + ' (no prose)'); continue; }
    console.log(k + ' proseW=' + v.proseW + ' lineW=' + v.lineW + ' innerW=' + v.innerW + ' scrollW=' + v.scrollW);
    console.log('   chain=' + JSON.stringify(v.chain));
  }
})();
