'use strict';
/**
 * fa-attrib.js — final acceptance, group B: per-commit attribution of page height / line width / code scroll.
 *
 * Four real builds are served side by side, so each CSS change is isolated by an
 * actual commit rather than by an injection alone (injections are kept as a
 * cross-check because `.code-pre{font-size:16px!important}` is not byte-identical
 * to the pre-C1 stylesheet, which had no font-size at all and inherited 16px):
 *
 *   8791  a19a6c2   pre-batch-0 baseline            (no C1, no C2, no C3, no C5)
 *   8793  9c82b47   C1 only                        (strut fix + build infra)
 *   8794  5d0831b   C1 + C3                        (breakpoint merge; no C2/C5 yet)
 *   8792  4ce8407   HEAD = C1+C2+C3+C4+C5
 *
 * Usage: node tools/fa-attrib.js
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

const BUILDS = [
  { key: 'b0', label: 'a19a6c2 pre-batch0', base: 'http://127.0.0.1:8791' },
  { key: 'c1', label: '9c82b47 C1', base: 'http://127.0.0.1:8793' },
  { key: 'c1c3', label: '5d0831b C1+C3', base: 'http://127.0.0.1:8794' },
  { key: 'head', label: '4ce8407 HEAD', base: 'http://127.0.0.1:8792' },
];

const PAGES = [
  { key: 'dialogs', path: '/paper/dev/dialogs/' },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/' },
  { key: 'particles', path: '/paper/dev/particles/' },
  { key: 'tuning', path: '/velocity/tuning/' },
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
  hosts.forEach((h, i) => {
    if (h.scrollWidth > h.clientWidth + 1 || pres[i].scrollWidth > pres[i].clientWidth + 1) codeOv++;
  });
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
  const fh = {};
  for (const d of firstBlock) fh[d] = (fh[d] || 0) + 1;
  const srt = [...firstBlock].sort((a, b) => a - b);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const pre0 = pres[0];
  const code0 = pre0 ? (pre0.querySelector('code') || pre0) : null;
  const de = document.documentElement;
  const ab = art ? art.getBoundingClientRect() : null;
  const cimgs = [...document.querySelectorAll('img.content-img')].filter((i) => i.getBoundingClientRect().width > 0);
  return {
    artW: ab ? r2(ab.width) : null,
    artX: ab ? r2(ab.x) : null,
    lineW: maxLine || null,
    lineCh: maxLine && zeroW > 0 ? Math.round(maxLine / zeroW) : null,
    zeroW: zeroW == null ? null : r2(zeroW),
    codeCw: hosts.map((h) => h.clientWidth),
    codeOv,
    codeBlocks: pres.length,
    preFs: pre0 ? r2(parseFloat(cs(pre0, 'fontSize'))) : null,
    preLh: pre0 ? r2(parseFloat(cs(pre0, 'lineHeight'))) : null,
    codeFs: code0 ? r2(parseFloat(cs(code0, 'fontSize'))) : null,
    codeLh: code0 ? r2(parseFloat(cs(code0, 'lineHeight'))) : null,
    advMedian: srt.length ? srt[Math.floor(srt.length / 2)] : null,
    advHist: fh,
    docH: de.scrollHeight,
    hOverflow: de.scrollWidth - de.clientWidth,
    contentImgs: cimgs.length,
    imgsWithDims: cimgs.filter((i) => i.getAttribute('width') && i.getAttribute('height')).length,
    h5: (() => { const h = art && art.querySelector('h5'); return h ? r2(parseFloat(cs(h, 'fontSize'))) : null; })(),
  };
};

const settle = async (page) => {
  await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true));
  await page.evaluate(() => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= 3) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }));
  await page.waitForTimeout(100);
};

(async () => {
  if (!EXE) throw new Error('no chrome (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), rows: {} };
  try {
    for (const pd of PAGES) {
      out.rows[pd.key] = {};
      for (const b of BUILDS) {
        const ctx = await browser.newContext({
          viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
        await page.goto(b.base + pd.path, { waitUntil: 'load', timeout: 60000 });
        await settle(page);
        const m = await page.evaluate(MEASURE);
        await ctx.close();
        out.rows[pd.key][b.key] = { ...m, errors: errs.length };
      }
      const r = out.rows[pd.key];
      console.log('\n== ' + pd.key + ' @1440 ==');
      console.log('build   lineW     ch   codeCw        ov     preFs/Lh    codeFs/Lh   adv   docH');
      for (const b of BUILDS) {
        const x = r[b.key];
        console.log(
          b.key.padEnd(7) +
          String(x.lineW).padEnd(10) + String(x.lineCh).padEnd(5) +
          JSON.stringify([Math.min(...x.codeCw), Math.max(...x.codeCw)]).padEnd(14) +
          String(x.codeOv + '/' + x.codeBlocks).padEnd(7) +
          String(x.preFs + '/' + x.preLh).padEnd(12) +
          String(x.codeFs + '/' + x.codeLh).padEnd(12) +
          String(x.advMedian).padEnd(6) + String(x.docH).padEnd(8) +
          ' hOv=' + x.hOverflow);
      }
      const dh = (a, b) => r[a].docH - r[b].docH;
      console.log('  ΔC1 (c1-b0)      = ' + dh('c1', 'b0'));
      console.log('  ΔC2 (head-c1c3)  = ' + dh('head', 'c1c3'));
      console.log('  ΔC3 (c1c3-c1)    = ' + dh('c1c3', 'c1'));
      console.log('  ΔC1+C2 (head-c1c3→?) net(head-b0) = ' + dh('head', 'b0'));
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-attrib.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-attrib.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
