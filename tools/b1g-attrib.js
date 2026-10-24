'use strict';
/**
 * b1g-attrib.js - final attribution details for the report:
 *  - what element the "article" selector actually resolves to on landing/all-pages
 *  - why .crumbs doubles in height at 390 (44px touch targets?)
 *  - where the reference-longpage prose sits at 390 (nested list padding?)
 *
 * Usage: node tools/b1g-attrib.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PROBE = () => {
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const bx = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100, Math.round(b.width * 100) / 100, Math.round(b.height * 100) / 100]; };
  const art = q('article.article') || q('article') || q('main');
  const crumbs = q('.crumbs');
  const a1 = crumbs ? crumbs.querySelector('a') : null;
  // deepest-first chain for the first real prose paragraph
  let prose = null;
  const artEl = q('article');
  if (artEl) prose = [...artEl.querySelectorAll('p')].find((p) => (p.textContent || '').trim().length >= 40) || null;
  const chain = [];
  let n = prose;
  while (n && n !== document.body && chain.length < 6) {
    chain.push({
      tag: n.tagName.toLowerCase(),
      cls: typeof n.className === 'string' ? n.className.split(/\s+/)[0] || '' : '',
      w: Math.round(n.getBoundingClientRect().width * 100) / 100,
      padL: cs(n, 'paddingLeft'), padR: cs(n, 'paddingRight'),
      marL: cs(n, 'marginLeft'),
    });
    n = n.parentElement;
  }
  return {
    resolvedArticle: { tag: art ? art.tagName.toLowerCase() : null, cls: art && typeof art.className === 'string' ? art.className : null, rect: bx(art) },
    hasArticleEl: !!q('article'),
    crumbs: crumbs ? { rect: bx(crumbs), h: cs(crumbs, 'height'), display: cs(crumbs, 'display'), fs: cs(crumbs, 'fontSize'), wrap: cs(crumbs, 'flexWrap') } : null,
    crumbLink: a1 ? { rect: bx(a1), minH: cs(a1, 'minHeight'), h: cs(a1, 'height'), pad: cs(a1, 'padding'), display: cs(a1, 'display') } : null,
    proseChain: chain,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    for (const vp of [{ n: '390', w: 390, h: 844 }, { n: '1440', w: 1440, h: 900 }]) {
      for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/', '/all-pages.html']) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: vp.n === '390', hasTouch: vp.n === '390' });
        const page = await ctx.newPage();
        await page.goto(base + u, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(350);
        out[side + ' ' + vp.n + ' ' + u] = await page.evaluate(PROBE);
        await ctx.close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'b1-shots', '_attrib.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) {
    console.log(k + ' article=' + JSON.stringify(v.resolvedArticle) + ' hasArticle=' + v.hasArticleEl);
    console.log('   crumbs=' + JSON.stringify(v.crumbs) + ' link=' + JSON.stringify(v.crumbLink));
    console.log('   chain=' + JSON.stringify(v.proseChain));
  }
})();
