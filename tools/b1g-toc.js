'use strict';
/**
 * b1g-toc.js - mobile TOC panel behaviour at 390 (after) vs 390 (before).
 * Finds the real toggling element, measures collapsed/expanded heights and the
 * resulting article.y / pageHeight, and confirms whether the before build has
 * any mobile TOC at all.
 *
 * Usage: node tools/b1g-toc.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const SNAP = () => {
  const q = (s) => document.querySelector(s);
  const toc = q('.toc-side');
  const det = toc ? (toc.tagName.toLowerCase() === 'details' ? toc : toc.querySelector('details')) : null;
  const fold = q('.toc-fold');
  return {
    tocTag: toc ? toc.tagName.toLowerCase() : null,
    foldTag: fold ? fold.tagName.toLowerCase() : null,
    foldOpen: fold ? fold.hasAttribute('open') : null,
    tocH: toc ? Math.round(toc.getBoundingClientRect().height * 100) / 100 : 0,
    tocLinks: toc ? toc.querySelectorAll('a').length : 0,
    tocScrollH: toc ? toc.scrollHeight : 0,
    articleY: Math.round(q('article').getBoundingClientRect().y * 100) / 100,
    h1Y: q('article h1') ? Math.round(q('article h1').getBoundingClientRect().y * 100) / 100 : null,
    pageH: document.documentElement.scrollHeight,
    viewportH: window.innerHeight,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
      for (const vp of [{ n: '390', w: 390, h: 844 }, { n: '768', w: 768, h: 1024 }]) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await page.goto(base + u, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(450);
        const collapsed = await page.evaluate(SNAP);
        // click the summary / force the real <details> open
        const opened = await page.evaluate(() => {
          const fold = document.querySelector('.toc-fold');
          const det = fold && fold.tagName.toLowerCase() === 'details' ? fold : (fold ? fold.closest('details') : document.querySelector('.toc-side details'));
          if (!det) return false;
          det.open = true;
          return true;
        });
        await page.waitForTimeout(400);
        const expanded = opened ? await page.evaluate(SNAP) : null;
        out[side + ' ' + vp.n + ' ' + u] = { collapsed, expanded };
        await ctx.close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'b1-shots', '_toc.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) {
    console.log(k);
    console.log('   collapsed ' + JSON.stringify(v.collapsed));
    console.log('   expanded  ' + (v.expanded ? JSON.stringify(v.expanded) : 'n/a'));
  }
})();
