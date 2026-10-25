'use strict';
/**
 * cr-c3b.js — C3 的第二轮（修正版）
 *
 * 修正 cr-c3.js 的两个测量缺陷：
 *   1) 锚点/密度测试误用了 world-configuration（该页**没有 .toc-side**，实测 idx=-1）→ 改用 dialogs（24 条目录）
 *   2) 补上 C2 变体「只把 TOC 断点推到 1200，侧栏仍留 1024」（= 计划 B2-B）
 *
 * 变体：
 *   base     = 现状
 *   C2toc    = 只改 TOC 断点 1025→1200（侧栏仍 1024）
 *   C3       = 侧栏 + TOC 同绑 1200，JS 不动
 *   C3js     = 侧栏 + TOC 同绑 1200 + JS 两处 1025 同步改 1200
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(process.env.TEMP || '.', 'cr');
fs.mkdirSync(OUT, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const CSS0 = fs.readFileSync(path.join(ROOT, 'assets', 'site.css'), 'utf8');
const JS0 = fs.readFileSync(path.join(ROOT, 'assets', 'site.js'), 'utf8');

const CSS_C2 = CSS0.replace(/@media \(min-width:1025px\)/g, '@media (min-width:1200px)')
  .replace(/@media \(max-width:1024\.98px\)/g, '@media (max-width:1199.98px)');
const CSS_C3 = CSS_C2.replace(/@media \(min-width:1024px\)/g, '@media (min-width:1200px)');
const JS_C3 = JS0.replace(/min-width:1025px/g, 'min-width:1200px')
  .replace(/window\.innerWidth\s*<\s*1025/g, 'window.innerWidth < 1200')
  .replace(/window\.innerWidth\s*>=\s*1025/g, 'window.innerWidth >= 1200');

if (CSS_C2 === CSS0) throw new Error('C2 surgery no-op');
if (CSS_C3 === CSS_C2) throw new Error('C3 surgery no-op');
if (JS_C3 === JS0) throw new Error('JS surgery no-op');

const TOC_PAGE = '/paper/dev/dialogs/';   // 24 条目录，确有 .toc-side

const VAR = {
  base: { css: CSS0, js: JS0 },
  C2toc: { css: CSS_C2, js: JS0 },
  C3: { css: CSS_C3, js: JS0 },
  C3js: { css: CSS_C3, js: JS_C3 },
};

async function open(browser, vw, vh, variant) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh || 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true });
  const page = await ctx.newPage();
  const v = VAR[variant];
  await page.route('**/assets/site.css*', (r) => r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: v.css }));
  await page.route('**/assets/site.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: v.js }));
  return { ctx, page };
}

/* 真实点击目录链接，判标题是否被遮挡 */
const ANCHOR = function () {
  return (async () => {
    const toc = document.querySelector('.toc-side');
    if (!toc) return { noToc: true };
    const topbar = document.querySelector('.topbar');
    const topbarH = topbar.getBoundingClientRect().height;
    const fold = toc.querySelector('.toc-fold');
    const pos0 = getComputedStyle(toc).position;
    /* 折叠态直接点（模拟真实用户：先展开再点目录项） */
    if (fold && !fold.open) { fold.open = true; toc.dispatchEvent(new Event('toggle')); }
    toc.classList.add('toc-open');
    await new Promise((r) => setTimeout(r, 120));
    const tocR = toc.getBoundingClientRect();
    const pos = getComputedStyle(toc).position;
    /* 遮挡带 = 顶栏底 + (若 TOC 是吸顶/浮层，则再加 TOC 底边) —— 但展开态 TOC 是 static 时不计 */
    const stickyBar = (pos === 'sticky' || pos === 'fixed') && fold && !fold.open;
    const barBottom = stickyBar ? tocR.bottom : topbarH;
    const links = Array.from(toc.querySelectorAll('a[href^="#"]')).slice(0, 6);
    const res = [];
    for (const a of links) {
      let id; try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch (e) { continue; }
      const h = document.getElementById(id);
      if (!h) continue;
      /* 用真实点击触发站点自己的滚动/校正逻辑 */
      const before = window.pageYOffset;
      a.click();
      await new Promise((r) => setTimeout(r, 600));
      const r = h.getBoundingClientRect();
      res.push({ href: a.getAttribute('href'), top: +r.top.toFixed(2), bar: +barBottom.toFixed(2), covered: r.top < barBottom - 0.5, hidePx: +(barBottom - r.top).toFixed(2), moved: Math.round(window.pageYOffset - before) });
      /* 收回展开态，避免影响下一次 */
    }
    return {
      tocPos: pos, tocPosCollapsed: pos0, tocH: +tocR.height.toFixed(2), tocW: +tocR.width.toFixed(2),
      topbarH: +topbarH.toFixed(2), barBottom: +barBottom.toFixed(2),
      scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
      tocOffset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
      coveredCount: res.filter((x) => x.covered).length, total: res.length, res,
      /* verify-mobile check8 关心的字段 */
      cols: getComputedStyle(document.querySelector('.layout')).gridTemplateColumns,
      menuBtn: (function () { const b = document.querySelector('.sidebar-toggle'); if (!b) return null; const s = getComputedStyle(b); return s.display === 'none' ? 'display:none' : 'visible'; })(),
      sidebarPos: getComputedStyle(document.querySelector('.sidebar')).position,
      sidebarW: +document.querySelector('.sidebar').getBoundingClientRect().width.toFixed(2),
      sidebarX: +document.querySelector('.sidebar').getBoundingClientRect().x.toFixed(2),
      headerH: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
      tocDisplay: getComputedStyle(toc).display,
      contentW: +document.querySelector('.content').getBoundingClientRect().width.toFixed(2),
      tocLinksInFlow: Array.from(toc.querySelectorAll('a[href^="#"]')).filter((a) => a.getBoundingClientRect().height > 0).length,
    };
  })();
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'] });
  const out = { anchor: [], density: [], gate1024: [] };

  /* ---- 1) 锚点遮挡：1025 / 1100 / 1199 / 1200 / 1280 × 4 变体 ---- */
  for (const vw of [1024, 1025, 1100, 1150, 1199, 1200, 1280]) {
    for (const variant of ['base', 'C2toc', 'C3', 'C3js']) {
      const { ctx, page } = await open(browser, vw, 900, variant);
      await page.goto(NEW + TOC_PAGE, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(200);
      const m = await page.evaluate(ANCHOR);
      out.anchor.push({ vw, variant, ...m });
      await ctx.close();
    }
  }

  /* ---- 2) 信息密度：1024–1199 从右栏 → 吸顶条 ---- */
  for (const vw of [1025, 1100, 1199, 1200, 1280]) {
    for (const variant of ['base', 'C3js']) {
      const { ctx, page } = await open(browser, vw, 900, variant);
      await page.goto(NEW + TOC_PAGE, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(200);
      const d = await page.evaluate(() => {
        const toc = document.querySelector('.toc-side');
        const fold = toc.querySelector('.toc-fold');
        const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
        const closed = toc.getBoundingClientRect();
        const closedH = +closed.height.toFixed(2), closedW = +closed.width.toFixed(2);
        const visClosed = links.filter((a) => { const r = a.getBoundingClientRect(); return r.height > 0 && r.width > 0; }).length;
        fold.open = true; toc.classList.add('toc-open');
        const openH = +toc.getBoundingClientRect().height.toFixed(2);
        const visOpen = links.filter((a) => { const r = a.getBoundingClientRect(); return r.height > 0; }).length;
        /* 打开后正文可用高度（首屏） */
        const art = document.querySelector('.article').getBoundingClientRect();
        fold.open = false; toc.classList.remove('toc-open');
        return {
          closedH, closedW, visClosed, openH, visOpen, linkTotal: links.length,
          pos: getComputedStyle(toc).position,
          articleTop: +art.top.toFixed(2),
          viewportShare: +(closedH / innerHeight * 100).toFixed(1),
        };
      });
      out.density.push({ vw, variant, ...d });
      await ctx.close();
    }
  }

  /* ---- 3) verify-mobile check8 @1024x768：逐字段判 REGRESSION ---- */
  const WL_1024 = { drawerTocVisible: 1, drawerTocInSidebar: 1, menuBtn: 1, inputFonts: 1, brandNameW: 1, brandW: 1, brandTruncated: 1, preFocusable: 1 };
  for (const variant of ['base', 'C3js']) {
    const { ctx, page } = await open(browser, 1024, 768, variant);
    await page.goto(NEW + TOC_PAGE, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(200);
    const m = await page.evaluate(ANCHOR);
    out.gate1024.push({ variant, cols: m.cols, menuBtn: m.menuBtn, sidebarPos: m.sidebarPos, sidebarW: m.sidebarW, sidebarX: m.sidebarX, headerH: m.headerH, tocDisplay: m.tocDisplay, contentW: m.contentW });
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'c3b.json'), JSON.stringify(out, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(out, null, 2));
})();
