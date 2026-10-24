'use strict';
/**
 * b1g-tuning.js - why does the FIRST <pre> on /velocity/tuning/ have
 * clientWidth 834 (before) vs 1140 (after) at 1440, when the article is only
 * ~849 wide? Identify the actual scroll container.
 *
 * Usage: node tools/b1g-tuning.js
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
  const pre = document.querySelector('pre');
  if (!pre) return null;
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const bx = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) }; };
  const chain = [];
  let n = pre;
  while (n && n !== document.body && chain.length < 5) {
    chain.push({ tag: n.tagName.toLowerCase(), cls: typeof n.className === 'string' ? n.className.split(/\s+/).slice(0, 2).join('.') : '', bx: bx(n), ovx: cs(n, 'overflowX') });
    n = n.parentElement;
  }
  return {
    preClientW: pre.clientWidth, preScrollW: pre.scrollWidth, preBx: bx(pre),
    articleW: Math.round(document.querySelector('article').getBoundingClientRect().width),
    chain,
    totalPre: document.querySelectorAll('pre').length,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = {};
  for (const [side, base] of [['after', 'http://127.0.0.1:8787'], ['before', 'http://127.0.0.1:8788']]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(base + '/velocity/tuning/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(400);
    out[side] = await page.evaluate(P);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'b1-shots', '_tuning.json'), JSON.stringify(out, null, 2), 'utf8');
  for (const [k, v] of Object.entries(out)) {
    console.log(k + ' articleW=' + v.articleW + ' preClientW=' + v.preClientW + ' preScrollW=' + v.preScrollW + ' pre=' + JSON.stringify(v.preBx) + ' totalPre=' + v.totalPre);
    console.log('   chain=' + JSON.stringify(v.chain));
  }
})();
