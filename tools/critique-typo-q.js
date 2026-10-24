'use strict';
/* critique-typo-q.js -- the code-block cost of a narrow measure.
   For each candidate reading-column width, count how many <pre> blocks need horizontal
   scrolling, and how wide the widest block is. Also reports table overflow. */
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
  const art = q('.article');
  const res = [];
  const CANDS = [0, 448, 480, 512, 528, 560, 576, 608, 640, 672, 720, 768, 848, 948];
  const style = document.createElement('style');
  document.head.appendChild(style);
  for (const c of CANDS) {
    style.textContent = c === 0 ? '' : '.article{max-width:' + c + 'px !important;margin-inline:auto !important}';
    void art.offsetWidth;
    const blocks = qa('.code-pre');
    let overflow = 0, widestNeed = 0;
    blocks.forEach((p) => {
      const need = p.scrollWidth;
      const have = p.clientWidth;
      if (need > have + 1) overflow++;
      widestNeed = Math.max(widestNeed, need);
    });
    const tables = qa('.table-wrap');
    let tOver = 0;
    tables.forEach((t) => { if (t.scrollWidth > t.clientWidth + 1) tOver++; });
    /* longest source line in chars */
    let maxChars = 0;
    qa('.code-pre code').forEach((c2) => {
      (c2.innerText || '').split('\n').forEach((l) => { maxChars = Math.max(maxChars, l.length); });
    });
    res.push({ maxWidth: c, articleW: R2(art.getBoundingClientRect().width), codeBlocks: blocks.length, codeOverflow: overflow, tables: tables.length, tableOverflow: tOver, widestCodeNeedPx: widestNeed, longestCodeLineChars: maxChars, docHeight: Math.round(document.documentElement.scrollHeight) });
  }
  style.remove();
  return res;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const out = {};
  for (const [u, vp] of [['/paper/dev/dialogs/', { width: 1440, height: 900 }], ['/paper/reference/world-configuration/', { width: 1440, height: 900 }], ['/velocity/tuning/', { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(100);
    out[u] = await page.evaluate(IN_PAGE);
    await ctx.close();
    process.stderr.write('ok ' + u + '\n');
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'q-codecost.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const u of Object.keys(out)) {
    console.log('==', u);
    for (const r of out[u]) console.log('  w=' + String(r.maxWidth).padStart(4) + ' act=' + String(r.articleW).padStart(7) + ' code ' + r.codeOverflow + '/' + r.codeBlocks + ' scroll | table ' + r.tableOverflow + '/' + r.tables + ' | longestLine ' + r.longestCodeLineChars + 'ch | needMax ' + r.widestCodeNeedPx + 'px | H ' + r.docHeight);
  }
})();
