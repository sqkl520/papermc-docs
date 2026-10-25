'use strict';
/**
 * cr-c3.js — C3「侧栏 + TOC 同绑 1200」攻击
 *
 * 与 cr-probe 的区别：这里对**真实 CSS 文本**做阈值外科手术（把 1024/1025 两个断点
 * 一起改写成 1200），而不是用 addStyleTag 覆盖 —— 覆盖会漏掉 order/display/padding
 * 那几十条声明。同时提供「JS 同步改 / 不同步改」两个变体，用来验证 R1 风险。
 *
 * 变体：
 *   C3      = 只改 CSS（syncTocOffset 里写死的 <1025 不动）
 *   C3js    = CSS + 把 JS 里两处 1025 改成 1200（计划 R1 要求的"同 commit"）
 *
 * 用法：node tools/cr-c3.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(require("os").tmpdir() || '.', 'cr');
fs.mkdirSync(OUT, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const PRE = 'http://127.0.0.1:8788';

const CSS0 = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'), 'utf8');
const JS0 = fs.readFileSync(path.join(ROOT, 'assets', 'site.js'), 'utf8');

/* ---------- 阈值外科手术 ---------- */
function cssAt1200(css) {
  return css
    .replace(/@media \(min-width:1025px\)/g, '@media (min-width:1200px)')
    .replace(/@media \(min-width:1024px\)/g, '@media (min-width:1200px)')
    .replace(/@media \(max-width:1024\.98px\)/g, '@media (max-width:1199.98px)');
}
function jsAt1200(js) {
  return js
    .replace(/min-width:1025px/g, 'min-width:1200px')
    .replace(/window\.innerWidth\s*<\s*1025/g, 'window.innerWidth < 1200')
    .replace(/window\.innerWidth\s*>=\s*1025/g, 'window.innerWidth >= 1200');
}
const CSS1200 = cssAt1200(CSS0);
const JS1200 = jsAt1200(JS0);
if (CSS1200 === CSS0) throw new Error('css surgery no-op — threshold text changed?');
if (JS1200 === JS0) throw new Error('js surgery no-op');

const PAGES = {
  dialogs: '/paper/dev/dialogs/',
  worldcfg: '/paper/reference/world-configuration/',
  pdc: '/paper/dev/pdc/',
  cli: '/paper/reference/cli-arguments/',
};

const MEASURE = function () {
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
  const cs = (e, p) => (e ? getComputedStyle(e).getPropertyValue(p) : null);
  const toc = q('.toc-side');
  const out = {
    vw: innerWidth,
    cols: cs(q('.layout'), 'grid-template-columns'),
    hasTocClass: q('.layout') ? /\bhas-toc\b/.test(q('.layout').className) : null,
    articleW: R(q('.article')) && R(q('.article')).w,
    contentW: R(q('.content')) && R(q('.content')).w,
    toc: { display: cs(toc, 'display'), pos: cs(toc, 'position'), r: R(toc) },
    tocOffset: cs(document.documentElement, '--toc-offset'),
    scrollPadTop: cs(document.documentElement, 'scroll-padding-top'),
    pageH: document.documentElement.scrollHeight,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    // 信息密度：右栏形态下可见的目录链接数
    tocLinksVisible: qa('.toc-side a[href^="#"]').filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(a).visibility !== 'hidden'; }).length,
    topbarH: R(q('.topbar')) ? R(q('.topbar')).h : null,
    sidebarW: R(q('.sidebar')) ? R(q('.sidebar')).w : null,
    sidebarPos: cs(q('.sidebar'), 'position'),
    sidebarX: R(q('.sidebar')) ? R(q('.sidebar')).x : null,
  };
  return out;
};

/* 点目录链接后，目标标题是否被遮挡 */
const CLICK_TEST = function () {
  return (async () => {
    const toc = document.querySelector('.toc-side');
    const fold = toc && toc.querySelector('.toc-fold');
    if (fold && !fold.open) { fold.open = true; toc.dispatchEvent(new Event('toggle')); }
    toc && toc.classList.add('toc-open');
    await new Promise((r) => setTimeout(r, 80));
    const tocR = toc ? toc.getBoundingClientRect() : null;
    const topbarH = document.querySelector('.topbar').getBoundingClientRect().height;
    const tocPos = toc ? getComputedStyle(toc).position : null;
    // 遮挡带：顶栏 底 + （sticky 形态下 TOC 的底边）
    const barBottom = (tocPos === 'sticky' || tocPos === 'fixed') && tocR ? tocR.bottom : topbarH;
    const res = [];
    const links = Array.from(document.querySelectorAll('.toc-side a[href^="#"]')).slice(0, 6);
    for (const a of links) {
      let id; try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch (e) { continue; }
      const h = document.getElementById(id);
      if (!h) { res.push({ href: a.getAttribute('href'), missing: true }); continue; }
      h.scrollIntoView();
      await new Promise((r) => setTimeout(r, 120));
      const r = h.getBoundingClientRect();
      res.push({ href: a.getAttribute('href'), top: +r.top.toFixed(2), bar: +barBottom.toFixed(2), covered: r.top < barBottom - 0.5, hidePx: +(barBottom - r.top).toFixed(2) });
    }
    return {
      tocPos, tocH: tocR ? +tocR.height.toFixed(2) : null, tocBottom: tocR ? +tocR.bottom.toFixed(2) : null,
      topbarH: +topbarH.toFixed(2), barBottom: +barBottom.toFixed(2), scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
      tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
      coveredCount: res.filter((x) => x.covered).length, total: res.length, res,
    };
  })();
};

async function makePage(browser, opts) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width, height: opts.height || 900 },
    deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
  });
  const page = await ctx.newPage();
  if (opts.css || opts.js) {
    await page.route('**/assets/site.css*', (r) => r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: opts.css || CSS0 }));
    if (opts.js) await page.route('**/assets/site.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: opts.js }));
  }
  return { ctx, page };
}

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'] });
  const result = {};

  /* ---------- 1) 断点曲线：baseline / C3(css only) / C3js ---------- */
  const widths = [1000, 1023, 1024, 1025, 1100, 1150, 1199, 1200, 1201, 1280, 1440, 1540];
  const curve = [];
  for (const w of widths) {
    const row = { vw: w };
    for (const variant of ['base', 'C3', 'C3js']) {
      const opts = { width: w };
      if (variant === 'C3') { opts.css = CSS1200; }
      if (variant === 'C3js') { opts.css = CSS1200; opts.js = JS1200; }
      const { ctx, page } = await makePage(browser, opts);
      await page.goto(NEW + PAGES.dialogs, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(180);
      const m = await page.evaluate(MEASURE);
      row[variant] = { cols: m.cols, articleW: m.articleW, tocDisplay: m.toc.display, tocPos: m.toc.pos, tocLinksVisible: m.tocLinksVisible, pageH: m.pageH, hScroll: m.hScroll };
      await ctx.close();
    }
    curve.push(row);
  }
  result.curve = curve;

  /* ---------- 2) 锚点遮挡：1025–1199 档（C3 只改 CSS，syncTocOffset 仍写死 <1025） ---------- */
  const anchors = [];
  for (const w of [1025, 1100, 1150, 1199, 1200]) {
    for (const variant of ['base', 'C3', 'C3js']) {
      const opts = { width: w };
      if (variant === 'C3') opts.css = CSS1200;
      if (variant === 'C3js') { opts.css = CSS1200; opts.js = JS1200; }
      const { ctx, page } = await makePage(browser, opts);
      await page.goto(NEW + PAGES.worldcfg, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(200);
      const r = await page.evaluate(CLICK_TEST);
      anchors.push({ vw: w, variant, ...r });
      await ctx.close();
    }
  }
  result.anchors = anchors;

  /* ---------- 3) 双实例对打：8788(pre, a19a6c2) vs 8787+C3 —— 直接复算 verify-mobile 白名单 ---------- */
  const VP = [
    { name: '1024x768', w: 1024, h: 768 },
    { name: '1100x900', w: 1100, h: 900 },
    { name: '1280x800', w: 1280, h: 800 },
  ];
  const dual = [];
  for (const vp of VP) {
    for (const url of ['/paper/dev/pdc/', '/paper/reference/world-configuration/']) {
      const row = { vp: vp.name, url };
      // pre = 8788（改前实例）
      {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
        const page = await ctx.newPage();
        await page.goto(PRE + url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(150);
        const m = await page.evaluate(MEASURE);
        row.pre = { cols: m.cols, tocDisplay: m.toc.display, tocPos: m.toc.pos, sidebarW: m.sidebarW, sidebarPos: m.sidebarPos, sidebarX: m.sidebarX, headerH: m.topbarH, contentW: m.contentW };
        await ctx.close();
      }
      // post = 8787 + C3（CSS+JS 都改，计划要求的同 commit 形态）
      {
        const { ctx, page } = await makePage(browser, { width: vp.w, height: vp.h, css: CSS1200, js: JS1200 });
        await page.goto(NEW + url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(150);
        const m = await page.evaluate(MEASURE);
        row.post = { cols: m.cols, tocDisplay: m.toc.display, tocPos: m.toc.pos, sidebarW: m.sidebarW, sidebarPos: m.sidebarPos, sidebarX: m.sidebarX, headerH: m.topbarH, contentW: m.contentW };
        await ctx.close();
      }
      // 白名单期望（verify-mobile.js:1586-1588）
      row.whitelist = { '1024x768': { layoutCols: '280px 744px', tocSide: 'display:none' }, '1100x900': { layoutCols: '280px 820px', tocSide: 'display:none' }, '1280x800': { layoutCols: '290px 740px 250px', tocSide: 'visible 250px' } }[vp.name];
      dual.push(row);
    }
  }
  result.dual = dual;

  /* ---------- 4) 信息密度：1025–1199 从「右栏」变「吸顶条」的净损失 ---------- */
  const density = [];
  for (const w of [1025, 1100, 1199, 1200]) {
    for (const variant of ['base', 'C3']) {
      const opts = { width: w };
      if (variant === 'C3') opts.css = CSS1200;
      const { ctx, page } = await makePage(browser, opts);
      await page.goto(NEW + PAGES.worldcfg, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(180);
      const d = await page.evaluate(() => {
        const toc = document.querySelector('.toc-side');
        const links = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
        const fold = toc && toc.querySelector('.toc-fold');
        const collapsedH = toc ? toc.getBoundingClientRect().height : null;
        if (fold) fold.open = true;
        const expandedH = toc ? toc.getBoundingClientRect().height : null;
        if (fold) fold.open = false;
        return {
          tocH_collapsed: collapsedH ? +collapsedH.toFixed(2) : null,
          tocH_expanded: expandedH ? +expandedH.toFixed(2) : null,
          linkTotal: links.length,
          linkVisibleNow: links.filter((a) => a.getBoundingClientRect().height > 0).length,
          tocW: toc ? +toc.getBoundingClientRect().width.toFixed(2) : null,
          inFlow: toc ? getComputedStyle(toc).position : null,
        };
      });
      density.push({ vw: w, variant, ...d });
      await ctx.close();
    }
  }
  result.density = density;

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'c3.json'), JSON.stringify(result, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(result, null, 2));
})();
