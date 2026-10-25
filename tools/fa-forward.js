'use strict';
/**
 * fa-forward.js — final acceptance, group D: forward-apply C1 / C2 on the pre-batch-0 tree.
 *
 * The 11-assertion table was authored against the batch-1 tree (pre-C1). Assertions
 * #5 (dialogs +457 -> ~14262) and #7 (dialogs ~13050) are *absolute* page heights,
 * so they are only reproducible on that tree. Here C1 and C2 are applied forward by
 * injection onto the a19a6c2 tree (:8791) and compared with the same arms on HEAD (:8792):
 *
 *   tree b0   : none | +C1 | +C2 | +C1+C2
 *   tree head : none | -C1 | -C2
 *
 * Usage: node tools/fa-forward.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const OUT = path.join(os.tmpdir(), 'fa');
fs.mkdirSync(OUT, { recursive: true });

const ADD_C1 = '.code-pre{font-size:.875rem}';
const ADD_C2 = '@media (min-width:768px){.article p{max-width:40rem}}';

const CASES = [
  { key: 'b0/none', base: 'http://127.0.0.1:8791', css: [] },
  { key: 'b0/+C1', base: 'http://127.0.0.1:8791', css: [ADD_C1] },
  { key: 'b0/+C2', base: 'http://127.0.0.1:8791', css: [ADD_C2] },
  { key: 'b0/+C1+C2', base: 'http://127.0.0.1:8791', css: [ADD_C1, ADD_C2] },
  { key: 'head/none', base: 'http://127.0.0.1:8792', css: [] },
  { key: 'head/-C1', base: 'http://127.0.0.1:8792', css: ['.code-pre{font-size:16px !important}'] },
  { key: 'head/-C2', base: 'http://127.0.0.1:8792', css: ['.article p{max-width:none !important}'] },
];
const PAGES = [
  { key: 'dialogs', path: '/paper/dev/dialogs/' },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/' },
];

const MEASURE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const art = document.querySelector('article.article') || document.querySelector('article');
  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = art ? [...art.querySelectorAll('p')].filter(isProse) : [];
  const cv = document.createElement('canvas').getContext('2d');
  let zeroW = null, maxLine = 0;
  for (const p of paras) {
    const st = getComputedStyle(p);
    if (zeroW == null) { cv.font = st.fontSize + ' ' + st.fontFamily; zeroW = cv.measureText('0').width; }
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    if (rects.length) maxLine = Math.max(maxLine, ...rects.map((r) => r.width));
  }
  const pres = [...document.querySelectorAll('pre.code-pre')];
  const hosts = pres.map((p) => p.closest('.code-scroll') || p);
  let codeOv = 0;
  hosts.forEach((h, i) => { if (h.scrollWidth > h.clientWidth + 1 || pres[i].scrollWidth > pres[i].clientWidth + 1) codeOv++; });
  const codeW = hosts.map((h) => r2(h.getBoundingClientRect().width));
  const advOf = (el) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const tops = [...new Set(rects.map((r) => Math.round(r.top * 100) / 100))].sort((a, b) => a - b);
    const d = [];
    for (let i = 1; i < tops.length; i++) d.push(Math.round(tops[i] - tops[i - 1]));
    return d;
  };
  const fb = pres.length ? advOf(pres[0].querySelector('code') || pres[0]) : [];
  const srt = [...fb].sort((a, b) => a - b);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const pre0 = pres[0];
  const de = document.documentElement;
  const lines = pres.reduce((s, p) => s + ((p.textContent || '').split('\n').length), 0);
  return {
    docH: de.scrollHeight,
    lineW: maxLine || null,
    lineCh: maxLine && zeroW > 0 ? Math.round(maxLine / zeroW) : null,
    zeroW: zeroW == null ? null : r2(zeroW),
    codeWmin: codeW.length ? Math.min(...codeW) : null,
    codeWmax: codeW.length ? Math.max(...codeW) : null,
    codeOv, codeBlocks: pres.length, codeLines: lines,
    advMedian: srt.length ? srt[Math.floor(srt.length / 2)] : null,
    preFs: pre0 ? r2(parseFloat(cs(pre0, 'fontSize'))) : null,
    preLh: pre0 ? r2(parseFloat(cs(pre0, 'lineHeight'))) : null,
    hOverflow: de.scrollWidth - de.clientWidth,
  };
};

const settle = async (page) => {
  await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true));
  await page.evaluate(() => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= 4) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }));
  await page.waitForTimeout(140);
};

(async () => {
  if (!EXE) throw new Error('no chrome (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), cells: {} };
  try {
    for (const pd of PAGES) {
      console.log('\n== ' + pd.key + ' @1440 ==');
      console.log('case        lineW      ch   codeW            ov     adv  preFs/Lh   docH');
      for (const c of CASES) {
        const ctx = await browser.newContext({
          viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        await page.goto(c.base + pd.path, { waitUntil: 'load', timeout: 60000 });
        await settle(page);
        for (const s of c.css) await page.addStyleTag({ content: s });
        if (c.css.length) await settle(page);
        const m = await page.evaluate(MEASURE);
        await ctx.close();
        out.cells[c.key + '::' + pd.key] = m;
        console.log(c.key.padEnd(12) + String(m.lineW).padEnd(11) + String(m.lineCh).padEnd(5) +
          (m.codeWmin + '~' + m.codeWmax).padEnd(17) + (m.codeOv + '/' + m.codeBlocks).padEnd(7) +
          String(m.advMedian).padEnd(5) + (m.preFs + '/' + m.preLh).padEnd(11) + String(m.docH));
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-forward.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-forward.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
