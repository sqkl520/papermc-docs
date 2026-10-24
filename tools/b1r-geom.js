'use strict';
/**
 * b1r-geom.js — 红队攻击批 1：sticky 是否真的有作用 / 是否改变几何 / 横屏占屏 / 桌面双滚动条
 * 用法: node tools/b1r-geom.js
 * 输出: reports/.b1r-geom.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

const VPS = [
  { n: '1440x900', w: 1440, h: 900 },
  { n: '1280x800', w: 1280, h: 800 },
  { n: '1100x800', w: 1100, h: 800 },
  { n: '1025x800', w: 1025, h: 800 },
  { n: '1024x800', w: 1024, h: 800 },
  { n: '900x800', w: 900, h: 800 },
  { n: '768x1024', w: 768, h: 1024 },
  { n: '812x375横屏', w: 812, h: 375 },
  { n: '390x844', w: 390, h: 844 },
];
const PAGES = [
  { n: 'particles(166项TOC)', u: '/paper/dev/particles/' },
  { n: 'worldcfg(长页无TOC)', u: '/paper/reference/world-configuration/' },
  { n: 'dialogs(代码块)', u: '/paper/dev/dialogs/' },
];

function measureFn() {
  const toc = document.querySelector('.toc-side');
  const tocOl = toc ? toc.querySelector('ol') : null;
  const h1 = document.querySelector('.article h1, .page-head h1, h1');
  const content = document.querySelector('.content');
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const rr = (b) => (b ? { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) } : null);
  return {
    docH: Math.round(document.documentElement.scrollHeight),
    scrollY: Math.round(window.scrollY),
    vh: window.innerHeight,
    vw: window.innerWidth,
    topbarH: Math.round((document.querySelector('.topbar') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
    h1Top: h1 ? Math.round(h1.getBoundingClientRect().top + window.scrollY) : null,
    h1TopViewport: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    contentW: content ? Math.round(content.getBoundingClientRect().width) : null,
    toc: toc ? {
      display: getComputedStyle(toc).display,
      pos: getComputedStyle(toc).position,
      zIndex: getComputedStyle(toc).zIndex,
      scrollH: toc.scrollHeight, clientH: toc.clientHeight,
      hasScrollbar: toc.scrollHeight > toc.clientHeight + 1,
      rect: rr(r(toc)),
      open: toc.querySelector('details') ? toc.querySelector('details').open : null,
      olClientH: tocOl ? tocOl.clientHeight : null,
      olScrollH: tocOl ? tocOl.scrollHeight : null,
      olHasScrollbar: tocOl ? tocOl.scrollHeight > tocOl.clientHeight + 1 : false,
      olOverflowY: tocOl ? getComputedStyle(tocOl).overflowY : null,
      olMaxH: tocOl ? getComputedStyle(tocOl).maxHeight : null,
      titleH: toc.querySelector('.toc-title') ? Math.round(toc.querySelector('.toc-title').getBoundingClientRect().height) : null,
    } : null,
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { exe: EXE, vps: {}, stickyTest: {}, landscape: {}, desktopDoubleScroll: {} };

  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const pg of PAGES) {
      const row = {};
      for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
        await page.goto(base + pg.u, { waitUntil: 'load' });
        await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
        await page.waitForTimeout(120);
        const before = await page.evaluate(measureFn);
        // 滚动 900px 后再测：sticky 生效则 toc.top 仍 ≈ topbarH
        await page.evaluate(() => window.scrollTo(0, 900));
        await page.waitForTimeout(120);
        const after = await page.evaluate(measureFn);
        row[tag] = { before, after };
      }
      out.vps[vp.n + '|' + pg.n] = row;
    }
    await ctx.close();
  }

  // ---- 专项 1: 768 档 sticky 是否 no-op（在自身 grid 行内无法移动）----
  {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(120);
    const rec = [];
    for (const y of [0, 100, 400, 900, 2000]) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(100);
      rec.push(await page.evaluate(() => {
        const t = document.querySelector('.toc-side');
        const b = t.getBoundingClientRect();
        const cs = getComputedStyle(t);
        // 找到 grid 容器的行轨道信息：toc 的 offsetParent / 网格区域高度
        const cs2 = getComputedStyle(t.parentElement);
        return {
          scrollY: Math.round(window.scrollY),
          tocTop: Math.round(b.top), tocBottom: Math.round(b.bottom), tocH: Math.round(b.height),
          position: cs.position, top: cs.top, zIndex: cs.zIndex,
          gridCols: cs2.gridTemplateColumns, gridRows: cs2.gridTemplateRows, gap: cs2.gap,
          // 关键判定：toc 顶边是否被顶栏高度（56）夹住
          pinned: Math.abs(b.top - 56) <= 1,
        };
      }));
    }
    out.stickyTest['768'] = rec;
    await ctx.close();
  }

  // ---- 专项 2: 横屏 812x375 展开目录后占屏比 ----
  {
    const ctx = await browser.newContext({ viewport: { width: 812, height: 375 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
    await page.waitForTimeout(150);
    const bypass = await page.evaluate(() => {
      const t = document.querySelector('.toc-side');
      const d = t.querySelector('details');
      const m = { vh: window.innerHeight };
      m.closedTocH = Math.round(t.getBoundingClientRect().height);
      m.closedPanelBottom = Math.round(t.getBoundingClientRect().bottom);
      d.open = true;
      m.openTocH = Math.round(t.getBoundingClientRect().height);
      m.openPanelBottom = Math.round(t.getBoundingClientRect().bottom);
      m.openPctOfViewport = +(100 * t.getBoundingClientRect().height / window.innerHeight).toFixed(1);
      m.olClientH = Math.round(t.querySelector('ol').clientHeight);
      m.olScrollH = t.querySelector('ol').scrollHeight;
      m.olMaxH = getComputedStyle(t.querySelector('ol')).maxHeight;
      m.olHasScrollbar = t.querySelector('ol').scrollHeight > t.querySelector('ol').clientHeight + 1;
      const h1 = document.querySelector('h1');
      m.h1ViewportTop = Math.round(h1.getBoundingClientRect().top);
      m.h1BelowFold = h1.getBoundingClientRect().top > window.innerHeight;
      // iOS 大视口近似：85vh 用的是视口高度，若地址栏/工具栏占 80px，可用高度只有 295
      m.usableIfToolbar80 = window.innerHeight - 80;
      m.panelBottomVsUsable = Math.round(t.getBoundingClientRect().bottom) - (window.innerHeight - 80);
      return m;
    });
    out.landscape['812x375'] = bypass;
    await ctx.close();
  }

  // ---- 专项 3: 桌面 >=1025 目录内部滚动 vs 改前整列滚动 ----
  {
    for (const vp of [{ n: '1280x800', w: 1280, h: 800 }, { n: '1440x900', w: 1440, h: 900 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const row = {};
      for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
        await page.goto(base + '/paper/dev/particles/', { waitUntil: 'load' });
        await page.waitForTimeout(120);
        row[tag] = await page.evaluate(() => {
          const t = document.querySelector('.toc-side');
          const ol = t.querySelector('ol');
          const cs = getComputedStyle(t);
          const csOl = ol ? getComputedStyle(ol) : null;
          return {
            containerClientH: t.clientHeight, containerScrollH: t.scrollHeight,
            containerOverflowY: cs.overflowY,
            containerScrollbar: t.scrollHeight > t.clientHeight + 1,
            olPresent: !!ol,
            olClientH: ol ? ol.clientHeight : null, olScrollH: ol ? ol.scrollHeight : null,
            olOverflowY: csOl ? csOl.overflowY : null,
            olMaxH: csOl ? csOl.maxHeight : null,
            olScrollbar: ol ? ol.scrollHeight > ol.clientHeight + 1 : false,
            // 最后一项目录项是否可见（不需要滚轮）
            lastItemVisible: ol ? (() => { const li = ol.lastElementChild; const lb = li.getBoundingClientRect(); const tb = t.getBoundingClientRect(); return lb.bottom <= tb.bottom + 1 && lb.top >= tb.top - 1; })() : null,
          };
        });
      }
      out.desktopDoubleScroll[vp.n] = row;
      await ctx.close();
    }
  }

  await browser.close();
  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-geom.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log(JSON.stringify(out.desktopDoubleScroll, null, 1));
  console.log(JSON.stringify(out.landscape, null, 1));
  console.log(JSON.stringify(out.stickyTest, null, 1));
})();
