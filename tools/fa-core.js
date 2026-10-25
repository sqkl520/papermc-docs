'use strict';
/**
 * fa-core.js — final acceptance, group A: assertions #1-#8 + attribution separation.
 *
 * Read-only: measures http://127.0.0.1:8787 (HEAD 4ce8407) and http://127.0.0.1:8788 (a19a6c2, pre-batch-0).
 * Nothing is written into the repo; JSON goes to os.tmpdir()/fa/.
 *
 * State model (what "after batch 2" vs "C1 only" means):
 *   head      = HEAD as built ............ C1 + C2 + C3 (+C4/C5)
 *   noC1      = .code-pre font-size forced back to 16px (undo C1) -> "after batch 2, strut still present"
 *   noC2      = .article p max-width:none (undo C2)               -> "C1 only"
 *   noC1noC2  = both undone                                       -> pre-C1/pre-C2 baseline at HEAD CSS
 *
 * Usage: node tools/fa-core.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const BASES = {
  /* own servers, bound to the repo root and to the a19a6c2 extract, so that a
     concurrent agent rebuilding the site on :8787 cannot invalidate the run */
  head: 'http://127.0.0.1:8792',
  /* a19a6c2 (pre-batch-0) extracted to %TEMP%\fa-old, served by tools/serve.js --port 8791
     NB: the :8788 instance named in the brief actually serves a *C1-only* build —
     its site.css contains `.code-pre{...font-size:.875rem}` and none of C2/C3/C5. */
  old: 'http://127.0.0.1:8791',
};

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const OUT = path.join(os.tmpdir(), 'fa');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { key: 'dialogs', path: '/paper/dev/dialogs/' },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/' },
  { key: 'particles', path: '/paper/dev/particles/' },
  { key: 'tuning', path: '/velocity/tuning/' },
];

const CSS_NO_C1 = '.code-pre{font-size:16px !important}';
const CSS_NO_C2 = '.article p{max-width:none !important}';

const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/* ------------------------------------------------------------------ *
 * in-page measurement
 * ------------------------------------------------------------------ */
const MEASURE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const art = document.querySelector('article.article') || document.querySelector('article');

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = art ? [...art.querySelectorAll('p')].filter(isProse) : [];

  const cv = document.createElement('canvas').getContext('2d');
  let zeroW = null;
  let maxLine = 0;
  let maxLinePara = -1;
  const widths = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const st = getComputedStyle(p);
    if (zeroW == null) { cv.font = st.fontSize + ' ' + st.fontFamily; zeroW = cv.measureText('0').width; }
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    const mx = rects.length ? Math.max(...rects.map((r) => r.width)) : 0;
    if (mx > maxLine) { maxLine = mx; maxLinePara = i; }
    widths.push(r2(p.getBoundingClientRect().width));
  }

  /* code blocks: host = .code-scroll if present, else the <pre> itself */
  const pres = [...document.querySelectorAll('pre.code-pre')];
  const hosts = pres.map((p) => p.closest('.code-scroll') || p);
  const codeCw = hosts.map((h) => h.clientWidth);
  let codeOv = 0;
  const codeOvDetail = [];
  hosts.forEach((h, i) => {
    const pre = pres[i];
    const overHost = h.scrollWidth > h.clientWidth + 1;
    const overPre = pre.scrollWidth > pre.clientWidth + 1;
    if (overHost || overPre) {
      codeOv++;
      codeOvDetail.push({ i, hostSW: h.scrollWidth, hostCW: h.clientWidth, preSW: pre.scrollWidth, preCW: pre.clientWidth });
    }
  });

  /* per-line advance inside code: unique tops of range rects -> diffs */
  const advOf = (el) => {
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const tops = [...new Set(rects.map((r) => Math.round(r.top * 100) / 100))].sort((a, b) => a - b);
    const diffs = [];
    for (let i = 1; i < tops.length; i++) diffs.push(Math.round(tops[i] - tops[i - 1]));
    return diffs;
  };
  const allDiffs = [];
  const perBlock = [];
  pres.forEach((pre) => {
    const code = pre.querySelector('code') || pre;
    const d = advOf(code);
    if (d.length) { perBlock.push(d); allDiffs.push(...d); }
  });
  const hist = {};
  for (const d of allDiffs) hist[d] = (hist[d] || 0) + 1;
  const srt = [...allDiffs].sort((a, b) => a - b);
  const advance = {
    blocks: perBlock.length,
    diffs: allDiffs.length,
    hist,
    median: srt.length ? srt[Math.floor(srt.length / 2)] : null,
    min: srt.length ? srt[0] : null,
    max: srt.length ? srt[srt.length - 1] : null,
    /* the "line advance" the plan quotes: the dominant (mode) diff of the first block */
    firstBlockMedian: perBlock.length ? [...perBlock[0]].sort((a, b) => a - b)[Math.floor(perBlock[0].length / 2)] : null,
    firstBlockHist: (() => { const h = {}; for (const d of (perBlock[0] || [])) h[d] = (h[d] || 0) + 1; return h; })(),
  };

  const pre0 = pres[0];
  const code0 = pre0 ? (pre0.querySelector('code') || pre0) : null;
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);

  /* content images */
  const cimgs = [...document.querySelectorAll('img.content-img')].filter((i) => i.getBoundingClientRect().width > 0);
  const imgSumH = cimgs.reduce((s, i) => s + i.getBoundingClientRect().height, 0);
  const imgsWithDims = cimgs.filter((i) => i.getAttribute('width') && i.getAttribute('height')).length;

  const de = document.documentElement;
  const ab = art ? art.getBoundingClientRect() : null;

  return {
    url: location.pathname,
    vw: window.innerWidth,
    artW: ab ? r2(ab.width) : null,
    artX: ab ? r2(ab.x) : null,
    lineW: maxLine || null,
    lineCh: maxLine && zeroW > 0 ? Math.round(maxLine / zeroW) : null,
    zeroW: zeroW == null ? null : r2(zeroW),
    paraCount: paras.length,
    paraWidthMax: widths.length ? Math.max(...widths) : null,
    lineOfPara: maxLinePara,
    codeBlocks: pres.length,
    codeHosts: hosts.length,
    codeCw,
    codeCwRange: codeCw.length ? [Math.min(...codeCw), Math.max(...codeCw)] : null,
    codeOv,
    codeOvDetail,
    codePreFs: pre0 ? r2(parseFloat(cs(pre0, 'fontSize'))) : null,
    codePreLh: pre0 ? r2(parseFloat(cs(pre0, 'lineHeight'))) : null,
    codeFs: code0 ? r2(parseFloat(cs(code0, 'fontSize'))) : null,
    codeLh: code0 ? r2(parseFloat(cs(code0, 'lineHeight'))) : null,
    advance,
    docH: de.scrollHeight,
    bodyH: document.body.scrollHeight,
    hOverflow: de.scrollWidth - de.clientWidth,
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    contentImgs: cimgs.length,
    imgSumH: r2(imgSumH),
    imgsWithDims,
    h5: (() => { const h = art && art.querySelector('h5'); return h ? r2(parseFloat(cs(h, 'fontSize'))) : null; })(),
    pMaxWidthCss: paras.length ? cs(paras[0], 'max-width') : null,
  };
};

const settle = async (page) => {
  await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true);
  await page.evaluate(() => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= 3) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }));
  await page.waitForTimeout(120);
};

async function measureState(browser, base, pageDef, css, label) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(base + pageDef.path, { waitUntil: 'load', timeout: 60000 });
  await settle(page);
  if (css && css.length) {
    for (const c of css) await page.addStyleTag({ content: c });
    await settle(page);
  }
  const m = await page.evaluate(MEASURE);
  const after = await page.evaluate(MEASURE); /* idempotence guard: second read must match */
  await ctx.close();
  return { label, errors, m, stable: after.docH === m.docH && after.lineW === m.lineW };
}

(async () => {
  if (!EXE) throw new Error('no chrome executable found (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), chrome: EXE, states: {}, old: {}, notes: [] };

  try {
    for (const pd of PAGES) {
      const rows = {};
      rows.head = await measureState(browser, BASES.head, pd, [], 'head');
      rows.noC1 = await measureState(browser, BASES.head, pd, [CSS_NO_C1], 'noC1');
      rows.noC2 = await measureState(browser, BASES.head, pd, [CSS_NO_C2], 'noC2');
      rows.noC1noC2 = await measureState(browser, BASES.head, pd, [CSS_NO_C1, CSS_NO_C2], 'noC1noC2');
      rows.old = await measureState(browser, BASES.old, pd, [], 'old');
      out.states[pd.key] = rows;
      console.log('measured ' + pd.key);
      for (const k of ['head', 'noC1', 'noC2', 'noC1noC2', 'old']) {
        const r = rows[k];
        console.log('  ' + k.padEnd(9) +
          ' lineW=' + String(r.m.lineW).padEnd(8) +
          ' ch=' + String(r.m.lineCh).padEnd(4) +
          ' codeCw=' + JSON.stringify(r.m.codeCwRange).padEnd(18) +
          ' codeOv=' + r.m.codeOv + '/' + r.m.codeBlocks +
          ' docH=' + String(r.m.docH).padEnd(7) +
          ' adv=' + JSON.stringify(r.m.advance.firstBlockHist) +
          ' hOv=' + r.m.hOverflow +
          (r.stable ? '' : ' [UNSTABLE]'));
      }
    }
    /* attribution summary printed by the caller */
    const d = out.states.dialogs;
    const H = (k) => d[k].m.docH;
    out.attrib = {
      both: H('head'),
      c1_only: H('noC2'),
      c2_only: H('noC1'),
      neither: H('noC1noC2'),
      old: H('old'),
      deltaC1: H('noC2') - H('noC1noC2'),
      deltaC2: H('head') - H('noC2'),
      net: H('head') - H('noC1noC2'),
    };
    console.log('\nATTRIB dialogs docH: neither=' + out.attrib.neither + ' c1only=' + out.attrib.c1_only +
      ' (dC1=' + out.attrib.deltaC1 + ') c2only=' + out.attrib.c2_only + ' both=' + out.attrib.both +
      ' (dC2=' + out.attrib.deltaC2 + ') net=' + out.attrib.net + ' old=' + out.attrib.old);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-core.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-core.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
