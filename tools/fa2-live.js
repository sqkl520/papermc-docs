'use strict';
/**
 * fa2-live.js — 必查 5（线上 vs 本地）+ 必查 6（file:// 直开）
 *
 * 必查 5：抽 3 页，对 https://sqkl520.github.io/papermc-docs/ 与 http://127.0.0.1:8787 同页同档
 *        比较：正文行宽 / 代码横滚 / 台阶位置（1200 处 artW 跳变）/ artW / 代码块宽。
 *        —— 线上是「部署产物」，本地是「HEAD 产物」；两者应逐项相同，否则说明线上不是 HEAD。
 * 必查 6：file:// 直开 5 页，收集 console error / pageerror / 失败请求，
 *        并校验批 2/3 的 4 个新特性在 file:// 下确实生效：
 *          40rem（正文行宽 ≤ 641）、1200 断点（1199 单栏 / 1200 三栏）、图片宽高属性、h5=17px。
 *
 * 用法: node tools/fa2-live.js [--only=live|file|all]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'fa2');
fs.mkdirSync(TMP, { recursive: true });

const LOCAL = 'http://127.0.0.1:8787';
const LIVE = 'https://sqkl520.github.io/papermc-docs';

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const ONLY = opt('only', 'all');
const want = (n) => ONLY === 'all' || ONLY.split(',').map((s) => s.trim()).includes(n);

const MEASURE = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = document.querySelector('article.article') || document.querySelector('article');
  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer, figcaption')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = art ? [...art.querySelectorAll('p')].filter(isProse) : [];
  const cv = document.createElement('canvas').getContext('2d');
  let zeroW = null; let maxLine = 0;
  for (const p of paras) {
    const st = cs(p, 'fontSize') + ' ' + cs(p, 'fontFamily');
    if (zeroW == null) { cv.font = st; zeroW = cv.measureText('0').width; }
    const rg = document.createRange(); rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    if (rects.length) maxLine = Math.max(maxLine, ...rects.map((r) => r.width));
  }
  const pres = [...document.querySelectorAll('pre.code-pre')];
  const hosts = pres.map((p) => p.closest('.code-scroll') || p);
  const ov = hosts.filter((h, i) => h.scrollWidth > h.clientWidth + 1 || pres[i].scrollWidth > pres[i].clientWidth + 1).length;
  const cw = hosts.map((h) => h.clientWidth);
  const toc = document.querySelector('.toc-side');
  const layout = document.querySelector('.layout');
  const ab = art ? art.getBoundingClientRect() : null;
  const tb = toc ? toc.getBoundingClientRect() : null;
  const tocVis = !!(toc && cs(toc, 'display') !== 'none' && tb.width > 0);
  let tocMode = 'hidden';
  if (tocVis) tocMode = (tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2) ? 'rail' : 'top-block';
  const cimgs = [...document.querySelectorAll('img.content-img')];
  return {
    path: location.pathname,
    vw: window.innerWidth,
    artW: ab ? r2(ab.width) : null,
    lineW: maxLine ? r2(maxLine) : null,
    lineCh: maxLine && zeroW > 0 ? Math.round(maxLine / zeroW) : null,
    pMaxWidth: paras.length ? cs(paras[0], 'maxWidth') : null,
    codeBlocks: pres.length,
    codeOv: ov,
    codeCwRange: cw.length ? [Math.min(...cw), Math.max(...cw)] : null,
    tocMode,
    cols: cs(layout, 'gridTemplateColumns'),
    h5: (() => { const h = art && art.querySelector('h5'); return h ? r2(parseFloat(cs(h, 'fontSize'))) : null; })(),
    imgs: cimgs.length,
    imgsWithDims: cimgs.filter((i) => i.getAttribute('width') && i.getAttribute('height')).length,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const settle = (page, k) => page.evaluate((n) => new Promise((res) => {
  let i = 0;
  const step = () => { if (++i >= n) res(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), k || 2);

const PAGES = [
  { key: 'dialogs', rel: '/paper/dev/dialogs/' },
  { key: 'worldcfg', rel: '/paper/reference/world-configuration/' },
  { key: 'tuning', rel: '/velocity/tuning/' },
];

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), live: [], liveCliff: {}, file: [] };
  try {
    /* ---------------- 必查 5：线上 vs 本地 ---------------- */
    if (want('live')) {
      for (const pd of PAGES) {
        const rec = { key: pd.key, rel: pd.rel, live: null, local: null, err: null };
        for (const arm of ['local', 'live']) {
          const base = arm === 'live' ? LIVE : LOCAL;
          const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
          const page = await ctx.newPage();
          const errors = [];
          page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
          page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + String(m.text()).slice(0, 120)); });
          try {
            const resp = await page.goto(base + pd.rel, { waitUntil: 'load', timeout: 90000 });
            rec[arm + 'Status'] = resp ? resp.status() : null;
            await page.waitForTimeout(250);
            await settle(page, 3);
            const m = await page.evaluate(MEASURE);
            rec[arm] = m;
            rec[arm + 'Errors'] = errors;
          } catch (e) {
            rec[arm] = { error: String(e.message).slice(0, 200) };
            rec[arm + 'Errors'] = errors;
          }
          await ctx.close();
        }
        out.live.push(rec);
        const f = (m, k) => (m && m[k] != null ? m[k] : '-');
        console.log('=== ' + pd.key + ' @1440 ===');
        console.log('  local: status=' + rec.localStatus + ' lineW=' + f(rec.local, 'lineW') + '/' + f(rec.local, 'lineCh') + 'ch codeOv=' + f(rec.local, 'codeOv') + '/' + f(rec.local, 'codeBlocks') + ' codeCw=' + JSON.stringify(rec.local && rec.local.codeCwRange) + ' artW=' + f(rec.local, 'artW') + ' pMaxW=' + f(rec.local, 'pMaxWidth') + ' h5=' + f(rec.local, 'h5') + ' dims=' + f(rec.local, 'imgsWithDims') + '/' + f(rec.local, 'imgs') + ' hOv=' + f(rec.local, 'hOverflow'));
        console.log('  live : status=' + rec.liveStatus + ' lineW=' + f(rec.live, 'lineW') + '/' + f(rec.live, 'lineCh') + 'ch codeOv=' + f(rec.live, 'codeOv') + '/' + f(rec.live, 'codeBlocks') + ' codeCw=' + JSON.stringify(rec.live && rec.live.codeCwRange) + ' artW=' + f(rec.live, 'artW') + ' pMaxW=' + f(rec.live, 'pMaxWidth') + ' h5=' + f(rec.live, 'h5') + ' dims=' + f(rec.live, 'imgsWithDims') + '/' + f(rec.live, 'imgs') + ' hOv=' + f(rec.live, 'hOverflow'));
        if (rec.localErrors && rec.localErrors.length) console.log('  local errors: ' + rec.localErrors.join(' | '));
        if (rec.liveErrors && rec.liveErrors.length) console.log('  live errors : ' + rec.liveErrors.join(' | '));
      }

      /* 线上台阶：1199 / 1200 两点 */
      for (const arm of ['local', 'live']) {
        const base = arm === 'live' ? LIVE : LOCAL;
        out.liveCliff[arm] = {};
        const ctx = await browser.newContext({ viewport: { width: 1199, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
        const page = await ctx.newPage();
        await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 90000 });
        await page.waitForTimeout(200);
        for (const w of [1199, 1200]) {
          await page.setViewportSize({ width: w, height: 900 });
          await page.waitForTimeout(160);
          await settle(page, 2);
          out.liveCliff[arm][w] = await page.evaluate(MEASURE);
        }
        await ctx.close();
        const a = out.liveCliff[arm];
        console.log('台阶 ' + arm + ': 1199 artW=' + a[1199].artW + ' toc=' + a[1199].tocMode + ' | 1200 artW=' + a[1200].artW + ' toc=' + a[1200].tocMode + ' | Δ=' + (Math.round((a[1200].artW - a[1199].artW) * 100) / 100));
      }
    }

    /* ---------------- 必查 6：file:// ---------------- */
    if (want('file')) {
      const FILE_PAGES = [
        { key: 'index', rel: 'index.html' },
        { key: 'dialogs', rel: 'paper/dev/dialogs/index.html' },
        { key: 'worldcfg', rel: 'paper/reference/world-configuration/index.html' },
        { key: 'tuning', rel: 'velocity/tuning/index.html' },
        { key: 'all-pages', rel: 'all-pages.html' },
      ];
      for (const fp of FILE_PAGES) {
        const abs = path.join(ROOT, fp.rel).replace(/\\/g, '/');
        const url = 'file:///' + abs;
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
        const page = await ctx.newPage();
        const errs = [];
        const failed = [];
        page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
        page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + String(m.text()).slice(0, 160)); });
        page.on('requestfailed', (r) => failed.push(r.url().split('/').slice(-1)[0] + ' :: ' + (r.failure() ? r.failure().errorText : '?')));
        let m = null;
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(400);
          await settle(page, 3);
          m = await page.evaluate(MEASURE);
        } catch (e) {
          errs.push('goto: ' + String(e.message).slice(0, 160));
        }
        /* file:// 下 40rem / 1200 断点 / h5 三项的额外校验 */
        let extra = null;
        if (m) {
          extra = await page.evaluate(() => {
            const css = [...document.styleSheets].map((s) => { try { return (s.href || 'inline'); } catch (e) { return 'blocked'; } });
            const art = document.querySelector('article.article') || document.querySelector('article');
            const p = art ? [...art.querySelectorAll('p')].find((x) => (x.textContent || '').trim().length >= 40) : null;
            const h5 = art ? art.querySelector('h5') : null;
            return {
              sheets: css,
              pMaxWidth: p ? getComputedStyle(p).maxWidth : null,
              h5fs: h5 ? getComputedStyle(h5).fontSize : null,
              searchIndexLoaded: !!(window.__SEARCH || window.SEARCH_INDEX || document.querySelector('.search-hit')),
              jsRan: !!document.querySelector('.toc-side, .sidebar'),
            };
          });
        }
        await ctx.close();
        out.file.push({ key: fp.key, url, m, extra, errs, failed });
        console.log('FILE ' + fp.key + ' :: ' + (m ? ('lineW=' + m.lineW + '/' + m.lineCh + 'ch pMaxW=' + m.pMaxWidth + ' codeOv=' + m.codeOv + '/' + m.codeBlocks + ' artW=' + m.artW + ' h5=' + m.h5 + ' dims=' + m.imgsWithDims + '/' + m.imgs + ' hOv=' + m.hOverflow) : '(measure failed)'));
        console.log('     errs=' + (errs.length ? errs.length + ' -> ' + errs.slice(0, 4).join(' | ') : '0') + '  failedReq=' + (failed.length ? failed.length + ' -> ' + failed.slice(0, 4).join(' | ') : '0') + '  extra=' + JSON.stringify(extra));
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(TMP, 'fa2-live.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(TMP, 'fa2-live.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
