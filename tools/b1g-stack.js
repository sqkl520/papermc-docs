'use strict';
/**
 * b1g-stack.js - attribute the vertical shift at 390 and the 1025px TOC cliff.
 *
 * Usage: node tools/b1g-stack.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const STACK = () => {
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const bx = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, w: Math.round(b.width * 100) / 100, h: Math.round(b.height * 100) / 100 }; };
  const toc = q('.toc-side');
  const content = q('.content');
  const art = q('article');
  const tb = q('.topbar');
  return {
    topbarH: tb ? Math.round(tb.getBoundingClientRect().height) : null,
    toc: toc ? {
      rect: bx(toc), tag: toc.tagName.toLowerCase(), open: toc.hasAttribute('open'),
      disp: cs(toc, 'display'), pos: cs(toc, 'position'), order: cs(toc, 'order'),
      mt: cs(toc, 'marginTop'), mb: cs(toc, 'marginBottom'),
      borderT: cs(toc, 'borderTopWidth'), padT: cs(toc, 'paddingTop'),
      summaryH: toc.querySelector('summary') ? Math.round(toc.querySelector('summary').getBoundingClientRect().height) : null,
    } : null,
    content: content ? { rect: bx(content), padT: cs(content, 'paddingTop'), padL: cs(content, 'paddingLeft'), padR: cs(content, 'paddingRight'), order: cs(content, 'order') } : null,
    article: bx(art),
    h1: bx(q('article h1')),
    crumbs: bx(q('.crumbs')),
    pageH: document.documentElement.scrollHeight,
    docW: document.documentElement.clientWidth,
    scrollW: document.documentElement.scrollWidth,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    for (const vp of [{ n: '390', w: 390, h: 844 }, { n: '1025', w: 1025, h: 800 }, { n: '1024', w: 1024, h: 800 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: vp.n === '390', hasTouch: vp.n === '390' });
      const page = await ctx.newPage();
      await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(400);
      out[side + ' ' + vp.n] = await page.evaluate(STACK);
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'b1-shots', '_stack.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) {
    console.log(k + '  topbar=' + v.topbarH + ' pageH=' + v.pageH + ' scrollW=' + v.scrollW + '/' + v.docW);
    console.log('   toc=' + JSON.stringify(v.toc));
    console.log('   content.padT=' + v.content.padT + ' padL=' + v.content.padL + ' rect=' + JSON.stringify(v.content.rect));
    console.log('   article=' + JSON.stringify(v.article) + ' h1=' + JSON.stringify(v.h1));
  }
})();
