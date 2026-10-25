'use strict';
/**
 * fa-inject.js — final acceptance, group C: 2x2 factorial (C1 x C2) on two trees.
 *
 * Trees:  b0   = a19a6c2 (pre-batch-0, :8791)  <- the tree the execution plan measured on
 *         head = 4ce8407 (HEAD, :8792)
 * Arms :  none / c1 / c2 / c1+c2, applied by injecting the *inverse* of each change:
 *           undo C1: `.code-pre{font-size:16px!important}`  (restores the 16px strut: 24.8px)
 *           undo C2: `.article p{max-width:none!important}`
 *
 * This settles whether assertion #5 (+457) and #7 (13050) reproduce on the tree the plan
 * used, and separates C1 from C2 on the delivered tree.
 *
 * Usage: node tools/fa-inject.js
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

const TREES = [
  { key: 'b0', base: 'http://127.0.0.1:8791' },
  { key: 'head', base: 'http://127.0.0.1:8792' },
];
const PAGES = [
  { key: 'dialogs', path: '/paper/dev/dialogs/' },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/' },
  { key: 'particles', path: '/paper/dev/particles/' },
  { key: 'tuning', path: '/velocity/tuning/' },
];
const ARMS = [
  { key: 'none', css: [] },
  { key: 'c1', css: ['.article p{max-width:none !important}'] },
  { key: 'c2', css: ['.code-pre{font-size:16px !important}'] },
  { key: 'c1c2', css: ['.code-pre{font-size:16px !important}', '.article p{max-width:none !important}'] },
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
  /* fractional visual width of each code block (host client box) */
  const codeW = hosts.map((h) => r2(h.getBoundingClientRect().width));
  let codeOv = 0;
  hosts.forEach((h, i) => {
    if (h.scrollWidth > h.clientWidth + 1 || pres[i].scrollWidth > pres[i].clientWidth + 1) codeOv++;
  });
  const codeH = pres.reduce((s, p) => s + p.getBoundingClientRect().height, 0);
  const advOf = (el) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const tops = [...new Set(rects.map((r) => Math.round(r.top * 100) / 100))].sort((a, b) => a - b);
    const d = [];
    for (let i = 1; i < tops.length; i++) d.push(Math.round(tops[i] - tops[i - 1]));
    return d;
  };
  const firstBlock = pres.length ? advOf(pres[0].querySelector('code') || pres[0]) : [];
  const srt = [...firstBlock].sort((a, b) => a - b);
  const fh = {};
  for (const d of firstBlock) fh[d] = (fh[d] || 0) + 1;
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const pre0 = pres[0];
  const de = document.documentElement;
  const ab = art ? art.getBoundingClientRect() : null;
  const cimgs = [...document.querySelectorAll('img.content-img')].filter((i) => i.getBoundingClientRect().width > 0);
  const codeLines = pres.reduce((s, p) => s + ((p.textContent || '').split('\n').length), 0);
  return {
    docH: de.scrollHeight,
    artW: ab ? r2(ab.width) : null,
    lineW: maxLine || null,
    lineCh: maxLine && zeroW > 0 ? Math.round(maxLine / zeroW) : null,
    zeroW: zeroW == null ? null : r2(zeroW),
    codeW, codeOv, codeBlocks: pres.length,
    codeWmin: codeW.length ? Math.min(...codeW) : null,
    codeWmax: codeW.length ? Math.max(...codeW) : null,
    codeH: r2(codeH),
    codeLines,
    advMedian: srt.length ? srt[Math.floor(srt.length / 2)] : null,
    advHist: fh,
    preFs: pre0 ? r2(parseFloat(cs(pre0, 'fontSize'))) : null,
    preLh: pre0 ? r2(parseFloat(cs(pre0, 'lineHeight'))) : null,
    hOverflow: de.scrollWidth - de.clientWidth,
    imgSumH: r2(cimgs.reduce((s, i) => s + i.getBoundingClientRect().height, 0)),
    contentImgs: cimgs.length,
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
    for (const t of TREES) {
      for (const pd of PAGES) {
        for (const a of ARMS) {
          const ctx = await browser.newContext({
            viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
          });
          const page = await ctx.newPage();
          await page.goto(t.base + pd.path, { waitUntil: 'load', timeout: 60000 });
          await settle(page);
          for (const c of a.css) await page.addStyleTag({ content: c });
          if (a.css.length) await settle(page);
          const m = await page.evaluate(MEASURE);
          await ctx.close();
          out.cells[t.key + '/' + pd.key + '/' + a.key] = m;
        }
      }
      console.log('\n### tree ' + t.key);
      for (const pd of PAGES) {
        const g = (k) => out.cells[t.key + '/' + pd.key + '/' + k];
        console.log(' ' + pd.key);
        for (const a of ARMS) {
          const x = g(a.key);
          console.log('   ' + a.key.padEnd(6) + ' lineW=' + String(x.lineW).padEnd(10) + ' ch=' + String(x.lineCh).padEnd(4) +
            ' pre=' + String(x.preFs + '/' + x.preLh).padEnd(11) + ' adv=' + String(x.advMedian).padEnd(4) +
            ' codeW=' + (x.codeWmin + '~' + x.codeWmax).padEnd(17) + ' ov=' + (x.codeOv + '/' + x.codeBlocks).padEnd(6) +
            ' docH=' + String(x.docH).padEnd(7) + ' hOv=' + x.hOverflow);
        }
        const d = (a, b) => g(a).docH - g(b).docH;
        console.log('   => dC1(none-c2)=' + d('none', 'c2') + '  dC2(none-c1)=' + d('none', 'c1') +
          '  dC1|c2present(c1-c1c2)=' + d('c1', 'c1c2') + '  dC2|c1present(c2-c1c2)=' + d('c2', 'c1c2'));
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-inject.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-inject.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
