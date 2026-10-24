'use strict';
/**
 * b1r2-l.js — 针对"当前构建"定点攻击
 *   L1 新规则 `.toc-side:has(.toc-fold[open]){position:static}` 在 ≥1025 是否也命中（桌面右栏失去吸顶？）
 *   L2 该 :has() 在旧浏览器被丢弃 → P0-1 的遮挡/锚点问题是否原样回归（CSSOM 改写模拟）
 *   L3 @supports selector(:has(*)) 的焦点环兜底是否真的生效（把条件改为 not all 模拟）
 *   L4 160px 横向溢出元凶：隐藏 .theme-icon 到底贡献了多少？真正元凶是 44px min-width？
 *   L5 1024 死区：抽屉能不能打开、.side-toc 是否可达
 *   L6 展开态 45vh 上限在 812×375 的占比（是否仍"占满屏"）
 * 用法: node tools/b1r2-l.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const EXE = [process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/particles/';
const lines = []; const log = (s) => { lines.push(s); console.log(s); };

const TOCINFO = () => {
  const t = document.querySelector('.toc-side');
  const cs = getComputedStyle(t);
  const b = t.getBoundingClientRect();
  const d = document.querySelector('.toc-fold');
  return { pos: cs.position, z: cs.zIndex, display: cs.display, top: Math.round(b.top), bottom: Math.round(b.bottom),
    h: Math.round(b.height), open: d ? !!d.open : null,
    pctVh: +(100 * b.height / innerHeight).toFixed(1),
    offset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    pad: getComputedStyle(document.documentElement).scrollPaddingTop };
};

const OCCL = () => {
  const toc = document.querySelector('.toc-side');
  const tb = toc.getBoundingClientRect();
  if (getComputedStyle(toc).display === 'none' || tb.height < 4) return { occluded: 0, tocH: 0 };
  const blocks = Array.from(document.querySelectorAll('.article p, .article h2, .article h3, .article li, .article pre'));
  let n = 0; const sample = [];
  for (const el of blocks) {
    const b = el.getBoundingClientRect();
    if (b.height <= 0 || b.width <= 0) continue;
    if (b.bottom <= tb.top || b.top >= tb.bottom) continue;
    const y = Math.min(b.bottom, tb.bottom) - 4;
    const x = Math.min(Math.max(b.left + 40, tb.left + 8), tb.right - 8);
    const hit = document.elementFromPoint(x, y);
    if (hit && toc.contains(hit)) { n++; if (sample.length < 3) sample.push({ tag: el.tagName, top: Math.round(b.top), txt: (el.textContent || '').trim().slice(0, 18) }); }
  }
  return { occluded: n, tocH: Math.round(tb.height), sample };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const R = {};

  // ---------- L1 桌面档：开放态的 position ----------
  R.desktop = [];
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1280x800', w: 1280, h: 800 }, { n: '1025x800', w: 1025, h: 800 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const atTop = await page.evaluate(TOCINFO);
    /* 滚下 2000px：吸附应当仍在 top=52；static 则随文档滚走 */
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(400);
    const afterScroll = await page.evaluate(TOCINFO);
    R.desktop.push({ vp: vp.n, atTop, afterScroll, stuck: Math.abs(afterScroll.top - 52) <= 2 });
    log('L1 ' + JSON.stringify({ vp: vp.n, pos: atTop.pos, open: atTop.open, top_atTop: atTop.top, top_afterScroll: afterScroll.top, stuck: Math.abs(afterScroll.top - 52) <= 2, h: atTop.h }));
    await ctx.close();
  }

  // ---------- L2 模拟 :has() 缺失：P0-1 是否回归 ----------
  R.hasAbsent = [];
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '768x1024', w: 768, h: 1024 }, { n: '812x375', w: 812, h: 375 }]) {
    for (const mode of ['hasSupported', 'hasDropped']) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      if (mode === 'hasDropped') {
        /* 等价于浏览器丢弃整条 :has() 规则：把 selectorText 改成永不匹配 */
        await page.evaluate(() => {
          let n = 0;
          const walk = (list) => { for (const r of list) {
            if (r.selectorText && r.selectorText.indexOf(':has(') >= 0) { try { r.selectorText = '.b1r2-never'; n++; } catch (e) {} }
            if (r.cssRules) { try { walk(r.cssRules); } catch (e) {} } } };
          for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch (e) { continue; } walk(rs); }
          window.__b1r2_rewritten = n;
        });
      }
      await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
      await page.waitForTimeout(500);
      const info = await page.evaluate(TOCINFO);
      await page.evaluate(() => window.scrollTo(0, 1200));
      await page.waitForTimeout(400);
      const occ = await page.evaluate(OCCL);
      const info2 = await page.evaluate(TOCINFO);
      /* 展开态点第 3 项，看落点 */
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      const id = await page.evaluate(() => document.querySelectorAll('.toc-side a[href^="#"]')[3].getAttribute('href').slice(1));
      await page.evaluate((x) => { document.querySelector('.toc-side a[href="#' + x + '"]').click(); }, id);
      await page.waitForTimeout(2600);
      const land = await page.evaluate((x) => { const b = document.getElementById(x).getBoundingClientRect();
        const mb = document.querySelector('.toc-side').getBoundingClientRect();
        return { headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom), vh: innerHeight,
          landingPct: +(100 * b.top / innerHeight).toFixed(1), clippedBottom: b.bottom > innerHeight,
          visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, mb.bottom))),
          offset: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim() }; }, id);
      R.hasAbsent.push({ vp: vp.n, mode, info, infoAfterScroll: info2, occ, land });
      log('L2 ' + JSON.stringify({ vp: vp.n, mode, pos: info.pos, tocH: info.h, pctVh: info.pctVh, offset: info.offset,
        occAt1200: occ.occluded, tocTopAfterScroll: info2.top, landPct: land.landingPct, clipped: land.clippedBottom, visPx: land.visiblePx }));
      await ctx.close();
    }
  }

  // ---------- L3 @supports(:has) 兜底是否生效 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    R.focusFallback = await page.evaluate(() => {
      const item = document.querySelector('.src-item'); const link = item.querySelector('.src-link');
      const read = () => ({ item: getComputedStyle(item).outlineStyle + '/' + getComputedStyle(item).outlineWidth,
        link: getComputedStyle(link).outlineStyle + '/' + getComputedStyle(link).outlineWidth });
      link.focus();
      const withSupports = read();
      let n = 0;
      const walk = (list) => { for (const r of list) {
        if (r.constructor && r.constructor.name === 'CSSSupportsRule' && r.conditionText && r.conditionText.indexOf(':has(') >= 0) { try { r.conditionText = 'not all'; n++; } catch (e) {} }
        if (r.cssRules) { try { walk(r.cssRules); } catch (e) {} } } };
      for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch (e) { continue; } walk(rs); }
      const withoutSupports = read();
      return { supportsBlocksDisabled: n, withSupports, withoutSupports, supportsSelector: (() => { try { return CSS.supports('selector(:has(*))'); } catch (e) { return 'err'; } })() };
    });
    log('L3 ' + JSON.stringify(R.focusFallback));
    await ctx.close();
  }

  // ---------- L4 160px 溢出归因 ----------
  R.overflow160 = [];
  {
    const variant = [
      { n: 'asis' },
      { n: 'iconForcedVisible', css: '.topbar #theme-toggle>.theme-icon{display:inline !important}' },
      { n: 'tbtnMinWidthZero', css: '.topbar .tbtn{min-width:0 !important}' },
      { n: 'iconHidden+tbtnMinW0', css: '.topbar .tbtn{min-width:0 !important}' },
      { n: 'brandShrink', css: '.topbar .brand{min-width:0 !important;flex:1 1 0 !important}.brand-name{display:none !important}' },
    ];
    for (const w of [160]) {
      for (const v of variant) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 640 } });
        const page = await ctx.newPage();
        await page.goto(NEW + '/', { waitUntil: 'load' });
        await page.waitForTimeout(350);
        if (v.css) await page.addStyleTag({ content: v.css });
        await page.waitForTimeout(200);
        const r = await page.evaluate(() => {
          const dw = document.documentElement.clientWidth;
          const kids = Array.from(document.querySelector('.topbar').children).map((c) => ({ cls: String(c.className || '').split(' ')[0], w: Math.round(c.getBoundingClientRect().width), right: Math.round(c.getBoundingClientRect().right) }));
          const tb = document.querySelector('.topbar').getBoundingClientRect();
          return { vw: innerWidth, overflow: document.documentElement.scrollWidth - dw, topbarScrollW: document.querySelector('.topbar').scrollWidth, topbarW: Math.round(tb.width), kids };
        });
        r.variant = v.n; r.testWidth = w;
        R.overflow160.push(r);
        log('L4 ' + JSON.stringify(r));
        await ctx.close();
      }
    }
  }

  // ---------- L5 1024 死区：抽屉可达性 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    R.dead1024 = await page.evaluate(() => {
      const t = document.querySelector('.toc-side');
      const st = document.querySelector('.side-toc');
      const tog = document.querySelector('.sidebar-toggle');
      const sb = document.querySelector('.sidebar');
      return {
        vw: innerWidth,
        pageTocDisplay: getComputedStyle(t).display,
        drawerTocDisplayInDom: st ? getComputedStyle(st).display : null,
        toggleDisplay: tog ? getComputedStyle(tog).display : null,
        toggleClickable: !!(tog && getComputedStyle(tog).display !== 'none' && tog.getBoundingClientRect().width > 0),
        sidebarPosition: getComputedStyle(sb).position,
        sidebarVisible: sb.getBoundingClientRect().left >= 0,
        anyInPageNav: (() => {
          const a = Array.from(document.querySelectorAll('.toc-side a, .side-toc a')).filter((x) => {
            const r = x.getBoundingClientRect(); const cs = getComputedStyle(x);
            return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && x.offsetParent !== null;
          });
          return a.length;
        })(),
      };
    });
    log('L5 ' + JSON.stringify(R.dead1024));
    await ctx.close();
  }

  // ---------- L6 展开态占屏（812×375 等） ----------
  R.expandedOccupancy = [];
  for (const vp of [{ n: '812x375', w: 812, h: 375 }, { n: '390x844', w: 390, h: 844 }, { n: '320x568', w: 320, h: 568 }, { n: '360x640', w: 360, h: 640 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const t = document.querySelector('.toc-side').getBoundingClientRect();
      const ol = document.querySelector('.toc-fold>ol');
      const h1 = document.querySelector('.article h1');
      return { pos: getComputedStyle(document.querySelector('.toc-side')).position,
        tocH: Math.round(t.height), pctVh: +(100 * t.height / innerHeight).toFixed(1),
        titleH: Math.round(document.querySelector('.toc-title').getBoundingClientRect().height),
        olH: ol.clientHeight, olMaxH: getComputedStyle(ol).maxHeight,
        h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
        h1InFirstScreen: h1 ? h1.getBoundingClientRect().top < innerHeight : null,
        docsBelowFoldPx: Math.round(t.height + (h1 ? h1.getBoundingClientRect().top : 0) - innerHeight) };
    });
    R.expandedOccupancy.push({ vp: vp.n, ...r });
    log('L6 ' + JSON.stringify({ vp: vp.n, ...r }));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-l.json'), JSON.stringify(R, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-l.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-l.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
