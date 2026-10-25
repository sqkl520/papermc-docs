'use strict';
/** cr2cp-prepost.js — 改前(8788)/改后(8787) 真·正文首行 + 首屏导航像素占比 对比 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');
const OUT = path.join(os.tmpdir(), 'cr2cp');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const M = () => {
  const vh = window.innerHeight;
  const abs = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
  const art = document.querySelector('article.article');
  let body = null;
  if (art) {
    for (const el of art.children) {
      if (el.matches('.page-head,.page-desc,.page-meta,h1')) continue;
      if (el.closest('.page-head')) continue;
      if (/^h[1-6]$/.test(el.tagName)) { body = el; break; }
      if (el.matches('p,ul,ol,pre,table,figure,div.code-block,.alert,blockquote,aside')) { body = el; break; }
    }
  }
  const meta = document.querySelector('.page-meta');
  const navSel = ['.topbar', 'nav.crumbs', '.toc-side', '.page-meta', '.side-toc'];
  let navArea = 0;
  for (const sel of navSel) for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const top = Math.max(0, r.top), bot = Math.min(vh, r.bottom);
    const left = Math.max(0, r.left), right = Math.min(window.innerWidth, r.right);
    if (bot > top && right > left) navArea += (bot - top) * (right - left);
  }
  return {
    h1Y: abs(document.querySelector('article h1,.page-head h1')),
    descY: abs(document.querySelector('.page-desc')),
    metaY: abs(meta), metaH: meta ? Math.round(meta.getBoundingClientRect().height) : 0,
    bodyY: abs(body), bodyTag: body ? body.tagName.toLowerCase() : null,
    bodyScreens: body ? +(abs(body) / vh).toFixed(2) : null,
    navPct: +(navArea / (window.innerWidth * vh) * 100).toFixed(1),
    chips: document.querySelectorAll('.page-meta .chip, .page-head .chip').length,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const res = {};
  for (const [label, base] of [['pre', 'http://127.0.0.1:8788'], ['post', 'http://127.0.0.1:8787']]) {
    res[label] = {};
    for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }, { w: 320, h: 568 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 500, hasTouch: vp.w < 500 });
      const page = await ctx.newPage();
      for (const p of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/']) {
        await page.goto(base + p, { waitUntil: 'load' });
        await page.waitForTimeout(240);
        res[label][vp.w + 'x' + vp.h] = res[label][vp.w + 'x' + vp.h] || {};
        res[label][vp.w + 'x' + vp.h][p] = await page.evaluate(M);
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'prepost.json'), JSON.stringify(res, null, 1), 'utf8');
  const L = (s) => console.log(s);
  L('vp        page                       PRE(h1/desc/metaH/body)          POST(h1/desc/metaH/body)      navPct pre->post');
  Object.keys(res.pre).forEach((vp) => {
    Object.keys(res.pre[vp]).forEach((p) => {
      const a = res.pre[vp][p], b = res.post[vp][p];
      L(vp.padEnd(9) + p.replace('/paper/', '').replace('/velocity/', 'v/').padEnd(27)
        + (a.h1Y + '/' + a.descY + '/' + a.metaH + '/' + a.bodyY).padEnd(29)
        + (b.h1Y + '/' + b.descY + '/' + b.metaH + '/' + b.bodyY).padEnd(29)
        + a.navPct + '->' + b.navPct + '  chips ' + a.chips + '->' + b.chips);
    });
  });
})();
