'use strict';
/* critique-typo-t.js -- decisive measure: for every prose block on the page, collect all FULL
   rendered lines and report median / p90 / max characters (incl. spaces). This averages over
   real letter mixes instead of trusting one synthetic probe. */
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
  const art = q('.article') || q('.content');
  const blocks = qa('p, li', art).filter((el) => {
    if (el.querySelector('p, ul, ol, div, pre, table')) return false;
    const t = (el.innerText || '').trim();
    return t.length > 150 && /[A-Za-z]/.test(t);
  });

  const allLines = [];
  let widest = null;
  for (const blk of blocks) {
    const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, null);
    const chars = [];
    let n;
    while ((n = walker.nextNode())) { const v = n.nodeValue; for (let i = 0; i < v.length; i++) chars.push({ node: n, i: i, ch: v[i] }); }
    if (chars.length < 100) continue;
    const rng = document.createRange();
    const geo = [];
    for (let k = 0; k < chars.length; k++) {
      const c = chars[k];
      rng.setStart(c.node, c.i); rng.setEnd(c.node, c.i + 1);
      const rr = rng.getBoundingClientRect();
      geo.push({ k: k, ch: c.ch, top: rr.top, bottom: rr.bottom, w: rr.width, x1: rr.right, x0: rr.left });
    }
    const lines = [];
    for (const g of geo) {
      let t = null;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
        const L = lines[i];
        const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top);
        if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { t = L; break; }
      }
      if (!t) { t = { top: g.top, bottom: g.bottom, all: 0, glyphs: 0, han: 0, x0: g.x0, x1: g.x1 }; lines.push(t); }
      t.top = Math.min(t.top, g.top); t.bottom = Math.max(t.bottom, g.bottom);
      t.x0 = Math.min(t.x0, g.x0); t.x1 = Math.max(t.x1, g.x1);
      if (g.w > 0) { t.all++; if (!/\s/.test(g.ch)) { t.glyphs++; if (/[\u4e00-\u9fff]/.test(g.ch)) t.han++; } }
    }
    lines.sort((a, b) => a.top - b.top);
    /* full lines only: drop the last line of each block, and lines shorter than 60% of the block's widest */
    const body = lines.slice(0, -1);
    const maxW = body.length ? Math.max.apply(null, body.map((l) => l.x1 - l.x0)) : 0;
    body.forEach((l) => {
      if ((l.x1 - l.x0) >= maxW * 0.9) {
        allLines.push({ all: l.all, glyphs: l.glyphs, han: l.han });
        if (!widest || l.all > widest.all) widest = { all: l.all, glyphs: l.glyphs, w: R2(l.x1 - l.x0) };
      }
    });
  }
  const arr = allLines.map((l) => l.all).sort((a, b) => a - b);
  const gl = allLines.map((l) => l.glyphs).sort((a, b) => a - b);
  const hn = allLines.map((l) => l.han).sort((a, b) => a - b);
  const pick = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
  const artBox = art ? art.getBoundingClientRect() : null;
  return {
    url: location.pathname,
    articleW: artBox ? R2(artBox.width) : null,
    blocksScanned: blocks.length,
    linesScanned: allLines.length,
    medianChars: pick(arr, 0.5), p90Chars: pick(arr, 0.9), maxChars: arr.length ? arr[arr.length - 1] : null,
    medianGlyphs: pick(gl, 0.5), medianHan: pick(hn, 0.5),
    widestLine: widest,
    docHeight: Math.round(document.documentElement.scrollHeight),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const out = [];
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1025, height: 900 }, { width: 1024, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/', '/all-pages.html', '/paper/']) {
      await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.waitForTimeout(60);
      const d = await page.evaluate(IN_PAGE);
      out.push({ vp: vp.width, ...d });
      process.stderr.write('ok ' + vp.width + ' ' + u + ' med=' + d.medianChars + ' max=' + d.maxChars + '\n');
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 't-measure.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('vp    page'.padEnd(48) + 'artW    lines  med  p90  max  medGlyph medHan widest');
  for (const r of out) {
    console.log(String(r.vp).padEnd(6) + r.url.padEnd(42) + String(r.articleW).padStart(7) + String(r.linesScanned).padStart(7) +
      String(r.medianChars).padStart(5) + String(r.p90Chars).padStart(5) + String(r.maxChars).padStart(5) +
      String(r.medianGlyphs).padStart(9) + String(r.medianHan).padStart(7) + (r.widestLine ? String(r.widestLine.all).padStart(7) : '      -'));
  }
})();
