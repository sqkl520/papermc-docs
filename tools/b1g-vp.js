'use strict';
/**
 * b1g-vp.js - check whether the two builds render 390px with the same
 * layout/visual viewport (shrink-to-fit). If they do not, mobile screenshots
 * are not directly comparable and the report must say so.
 *
 * Usage: node tools/b1g-vp.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    for (const u of ['/paper/dev/dialogs/', '/all-pages.html']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(base + u, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => {
        const meta = document.querySelector('meta[name=viewport]');
        const vv = window.visualViewport;
        // widest element that actually sticks out of the layout viewport
        let worst = null;
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          if (!worst || r.right > worst.right) {
            worst = {
              right: Math.round(r.right), w: Math.round(r.width),
              sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
            };
          }
        }
        return {
          meta: meta ? meta.getAttribute('content') : null,
          innerW: window.innerWidth, innerH: window.innerHeight,
          outerW: window.outerWidth,
          clientW: document.documentElement.clientWidth,
          scrollW: document.documentElement.scrollWidth,
          vvW: vv ? Math.round(vv.width * 100) / 100 : null,
          vvH: vv ? Math.round(vv.height * 100) / 100 : null,
          vvScale: vv ? Math.round(vv.scale * 1000) / 1000 : null,
          dpr: window.devicePixelRatio,
          topbarW: (() => { const t = document.querySelector('.topbar'); return t ? Math.round(t.getBoundingClientRect().width) : null; })(),
          worst,
        };
      });
      out[side + ' ' + u] = m;
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'b1-shots', '_vp.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) console.log(k + ' ' + JSON.stringify(v));
})();
