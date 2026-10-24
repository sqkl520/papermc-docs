'use strict';
/* b1v-probe7.js — 收尾：
 *  1) 打开抽屉 +27px 漂移的机制（度量 scrollHeight / clientWidth / 各候选因素）
 *  2) P0-1 断点边界：1023 / 1024 / 1025 / 1026
 * 用法: node tools/b1v-probe7.js <port> <outPath>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const PORT = process.argv[2] || '8787';
const OUT = process.argv[3];
const BASE = 'http://127.0.0.1:' + PORT;
const PAGE = '/paper/dev/particles/index.html';

function chromePath() {
  const c = [];
  if (process.env.CHROME_PATH) c.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe');
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win\\chrome.exe');
  }
  if (process.env.PROGRAMFILES) c.push(process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe');
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  throw new Error('no chrome');
}

const snap = (page, label) => page.evaluate((l) => {
  const de = document.documentElement;
  const toc = document.querySelector('.toc-side');
  const h1 = document.querySelector('h1');
  const art = document.querySelector('article');
  return {
    label: l,
    scrollY: +window.scrollY.toFixed(1),
    scrollH: de.scrollHeight,
    clientW: de.clientWidth,
    clientH: de.clientHeight,
    tocH: toc ? +toc.getBoundingClientRect().height.toFixed(1) : null,
    tocTop: toc ? +toc.getBoundingClientRect().top.toFixed(1) : null,
    h1DocY: h1 ? +(h1.getBoundingClientRect().top + window.scrollY).toFixed(1) : null,
    artDocY: art ? +(art.getBoundingClientRect().top + window.scrollY).toFixed(1) : null,
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlGutter: getComputedStyle(de).scrollbarGutter,
    navOpen: document.body.classList.contains('nav-open'),
  };
}, label);

async function driftMechanism(page) {
  const out = {};
  const variants = [
    ['as-is', null],
    ['no-gutter', () => { const s = document.createElement('style'); s.textContent = 'html.nav-locked{scrollbar-gutter:auto!important}'; document.head.appendChild(s); }],
    ['no-toc-sticky', () => { const s = document.createElement('style'); s.textContent = '.toc-side{position:static!important}'; document.head.appendChild(s); }],
    ['no-body-lock', () => { const s = document.createElement('style'); s.textContent = 'body{overflow:visible!important}'; document.head.appendChild(s); }],
    ['no-scrim', () => { const s = document.createElement('style'); s.textContent = '.nav-scrim{display:none!important}'; document.head.appendChild(s); }],
  ];
  for (const [name, setup] of variants) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }));
    await page.waitForTimeout(380);
    if (setup) { await page.evaluate(setup); await page.waitForTimeout(250); }
    const before = await snap(page, 'before');
    await page.evaluate(() => document.getElementById('nav-toggle').click());
    await page.waitForTimeout(500);
    const after = await snap(page, 'after');
    await page.evaluate(() => document.getElementById('nav-toggle').click());
    await page.waitForTimeout(450);
    const closed = await snap(page, 'closed');
    out[name] = { before, after, closed, openD: +(after.scrollY - before.scrollY).toFixed(1), closeD: +(closed.scrollY - after.scrollY).toFixed(1) };
  }
  return out;
}

async function breakpoints(page) {
  const out = {};
  for (const w of [1023, 1024, 1025, 1026]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.goto(BASE + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    out[w] = await page.evaluate(() => {
      const toc = document.querySelector('.toc-side');
      const fold = document.querySelector('.toc-side .toc-fold');
      const cs = toc ? getComputedStyle(toc) : null;
      const links = Array.from(document.querySelectorAll('.toc-side li a'));
      const vis = links.filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(a).display !== 'none'; });
      return {
        display: cs ? cs.display : null,
        position: cs ? cs.position : null,
        foldOpen: fold ? fold.open : null,
        hasFold: !!fold,
        visibleLinks: vis.length,
        tocH: toc ? +toc.getBoundingClientRect().height.toFixed(1) : null,
        h1Y: (() => { const h = document.querySelector('h1'); return h ? +(h.getBoundingClientRect().top + window.scrollY).toFixed(1) : null; })(),
        linkH: vis.length ? +vis[0].getBoundingClientRect().height.toFixed(1) : null,
      };
    });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    out.drift = await driftMechanism(page);
    out.breakpoints = await breakpoints(page);
    await ctx.close();
  } catch (e) { out.error = String((e && e.stack) || e); }
  finally { await browser.close(); }
  const j = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, j, 'utf8'); console.log('wrote ' + OUT); } else console.log(j);
})();
