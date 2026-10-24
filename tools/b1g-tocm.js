'use strict';
/**
 * b1g-tocm.js - why did the desktop right-rail TOC height change at 1440/1280/1025?
 * Measures per-link box height and the header block before vs after.
 *
 * Usage: node tools/b1g-tocm.js
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
  const toc = document.querySelector('.toc-side');
  if (!toc) return null;
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const links = [...toc.querySelectorAll('a')];
  const heads = [...toc.children].map((c) => ({ tag: c.tagName.toLowerCase(), cls: c.className, h: Math.round(c.getBoundingClientRect().height * 100) / 100 }));
  const summary = toc.querySelector('summary');
  const first = links[0];
  return {
    tocH: Math.round(toc.getBoundingClientRect().height * 100) / 100,
    links: links.length,
    linkH: first ? Math.round(first.getBoundingClientRect().height * 100) / 100 : null,
    linkLH: first ? cs(first, 'lineHeight') : null,
    linkFS: first ? cs(first, 'fontSize') : null,
    linkPad: first ? cs(first, 'padding') : null,
    linkDisplay: first ? cs(first, 'display') : null,
    multiLine: links.filter((a) => a.getBoundingClientRect().height > 30).map((a) => a.textContent.trim().slice(0, 34)),
    summaryH: summary ? Math.round(summary.getBoundingClientRect().height * 100) / 100 : null,
    heads,
    tocFontSize: cs(toc, 'fontSize'),
    tocPadT: cs(toc, 'paddingTop'), tocPadB: cs(toc, 'paddingBottom'),
    marginBottom: cs(toc, 'marginBottom'), borderTop: cs(toc, 'borderTopWidth'),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '1025', w: 1025, h: 800 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(350);
      out[side + ' ' + vp.n] = await page.evaluate(P);
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'b1-shots', '_tocm.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) console.log(k + ' ' + JSON.stringify(v));
})();
