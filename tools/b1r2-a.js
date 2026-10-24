'use strict';
/**
 * b1r2-a.js — 红队批1 · 角度 1/10：sticky TOC 展开态副作用 + 锚点落点 + --toc-offset 时序
 *   A1 展开态几何：TOC 占视口百分比、正文剩余可视高度、是否遮挡正文（几何 + 命中测试）
 *   A2 --toc-offset：折叠 / 展开 / 冷启动带 #hash 三种时序下的实际 scroll-padding-top
 *   A3 锚点落点：冷启动带 hash、页内点折叠态链接、页内点展开态链接；与改前(8788)对照
 * 用法: node tools/b1r2-a.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const PAGE = '/paper/dev/particles/';

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const STATE = () => {
  const toc = document.querySelector('.toc-side');
  const d = document.querySelector('.toc-fold');
  const ol = document.querySelector('.toc-fold > ol');
  const cs = getComputedStyle(toc);
  const r = toc.getBoundingClientRect();
  const olcs = ol ? getComputedStyle(ol) : null;
  return {
    vw: innerWidth, vh: innerHeight,
    scrollY: Math.round(window.scrollY),
    tocDisplay: cs.display, pos: cs.position, z: cs.zIndex,
    tocTop: Math.round(r.top), tocBottom: Math.round(r.bottom), tocH: Math.round(r.height),
    pctVh: +(100 * r.height / innerHeight).toFixed(1),
    remainsBelowPx: Math.round(innerHeight - Math.max(r.bottom, 0)),
    remainsBelowPct: +(100 * (innerHeight - Math.max(r.bottom, 0)) / innerHeight).toFixed(1),
    open: !!(d && d.open),
    olMaxH: olcs ? olcs.maxHeight : null,
    olClientH: ol ? ol.clientHeight : null,
    olScrollH: ol ? ol.scrollHeight : null,
    olOwnScrollbar: ol ? (ol.scrollHeight > ol.clientHeight + 1) : null,
    olOverflowY: olcs ? olcs.overflowY : null,
    tocBg: cs.backgroundColor,
    offsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    topbarH: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
  };
};

/* 遮挡判定：几何重叠 + elementFromPoint 命中测试（真正被压住，而不只是盒子相交） */
const COVER = () => {
  const toc = document.querySelector('.toc-side');
  const tb = toc.getBoundingClientRect();
  if (getComputedStyle(toc).display === 'none' || tb.height < 4) return { tocHidden: true, hits: [], covered: 0 };
  const blocks = Array.from(document.querySelectorAll('.article p, .article h2, .article h3, .article h4, .article li, .article pre'));
  const hits = [];
  for (const el of blocks) {
    const b = el.getBoundingClientRect();
    if (b.height <= 0 || b.width <= 0) continue;
    if (b.bottom <= tb.top || b.top >= tb.bottom) continue;
    /* 取该块与 TOC 垂直重叠区间中点做命中测试 */
    const y = Math.min(b.bottom, tb.bottom) - 4;
    if (y <= tb.top + 2 || y >= innerHeight) continue;
    const x = Math.min(Math.max(b.left + 40, tb.left + 8), tb.right - 8);
    const hit = document.elementFromPoint(x, y);
    hits.push({
      tag: el.tagName,
      top: Math.round(b.top),
      text: (el.textContent || '').trim().slice(0, 22),
      hitTag: hit ? hit.tagName : null,
      hitCls: hit ? String(hit.className || '').slice(0, 28) : null,
      occluded: !!(hit && toc.contains(hit)),
    });
  }
  return {
    tocHidden: false, tocTop: Math.round(tb.top), tocBottom: Math.round(tb.bottom),
    overlapped: hits.length,
    occluded: hits.filter((h) => h.occluded).length,
    sample: hits.filter((h) => h.occluded).slice(0, 4),
  };
};

const ANCHOR = (id) => {
  const el = document.getElementById(id);
  const toc = document.querySelector('.toc-side');
  const tb = toc ? toc.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };
  const b = el.getBoundingClientRect();
  const tbTop = 0 + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;
  const visibleTop = Math.max(b.top, tb.bottom > 0 && b.top < tb.bottom ? tb.bottom : b.top);
  return {
    id,
    scrollY: Math.round(window.scrollY),
    headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom),
    topbarBottom: Math.round(tbTop),
    tocBottom: Math.round(tb.bottom), tocH: Math.round(tb.height),
    scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    offsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    hiddenBehindToc: b.top < tb.bottom - 1 && b.bottom > tb.top,
    aboveTopbar: b.top < tbTop - 1,
    visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, tb.bottom, tbTop))),
    headingH: Math.round(b.height),
    /* 标题之后还剩多少正文可视高度（落点可用性） */
    remainBelowHeadingPx: Math.round(innerHeight - Math.max(b.bottom, 0)),
  };
};

(async () => {
  if (!EXE) { console.error('NO CHROME'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { exe: EXE, overlap: [], offset: [], anchor: [], oldRef: [], build: {} };

  const VPS = [
    { n: '390x844', w: 390, h: 844 },
    { n: '768x1024', w: 768, h: 1024 },
    { n: '812x375', w: 812, h: 375 },
    { n: '360x640', w: 360, h: 640 },
    { n: '1024x800', w: 1024, h: 800 },
    { n: '1025x800', w: 1025, h: 800 },
  ];

  // ---------- A0 build fingerprint ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    out.build = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.getAttribute('href'));
      const js = Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src'));
      return { links, js, cssRules: (() => { try { return document.styleSheets[0].cssRules.length; } catch (e) { return -1; } })() };
    });
    await ctx.close();
  }
  log('BUILD ' + JSON.stringify(out.build));

  // ---------- A1/A2 展开 vs 折叠 + 覆盖 ----------
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const collapsed = await page.evaluate(STATE);
    // 折叠态：滚到 1200 看折叠条是否遮挡
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(180);
    const collapsedCover = await page.evaluate(COVER);
    // 展开
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    await page.evaluate(() => { const d = document.querySelector('.toc-fold'); if (d) d.open = true; });
    await page.waitForTimeout(350);
    const expanded = await page.evaluate(STATE);
    const expandedAt0 = await page.evaluate(COVER);
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(200);
    const expandedCover = await page.evaluate(COVER);
    out.overlap.push({ vp: vp.n, collapsed, collapsedCover, expanded, expandedAt0, expandedCover });
    log('OVERLAP ' + JSON.stringify({
      vp: vp.n, cH: collapsed.tocH, cOpen: collapsed.open,
      eH: expanded.tocH, ePctVh: expanded.pctVh, eRemain: expanded.remainsBelowPx, eRemainPct: expanded.remainsBelowPct,
      olMaxH: expanded.olMaxH, olClientH: expanded.olClientH, olScrollH: expanded.olScrollH, olOwn: expanded.olOwnScrollbar,
      coverAt1200: expandedCover.occluded, coverCollapsed: collapsedCover.occluded || 0,
      offsetCollapsed: collapsed.offsetVar, offsetExpanded: expanded.offsetVar,
      padCollapsed: collapsed.scrollPadTop, padExpanded: expanded.scrollPadTop,
      bg: expanded.tocBg,
    }));
    await ctx.close();
  }

  // ---------- A3 锚点落点：3 种时序 ----------
  const ID = 'directional-particles';
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '768x1024', w: 768, h: 1024 }, { n: '812x375', w: 812, h: 375 }]) {
    // (a) 冷启动带 hash（分享链接 / 搜索引擎直达）
    {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE + '#' + ID, { waitUntil: 'load' });
      await page.waitForTimeout(700);
      const a = await page.evaluate(ANCHOR, ID);
      a.when = 'coldLoadWithHash'; a.vp = vp.n;
      out.anchor.push(a);
      log('ANCHOR ' + JSON.stringify(a));
      await ctx.close();
    }
    // (b) 页内点折叠态 TOC 链接
    {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      await page.evaluate(() => { const d = document.querySelector('.toc-fold'); if (d) d.open = false; });
      await page.waitForTimeout(200);
      await page.click('.toc-side a[href="#' + ID + '"]');
      await page.waitForTimeout(900);
      const a = await page.evaluate(ANCHOR, ID);
      a.when = 'clickCollapsed'; a.vp = vp.n;
      a.tocAutoCollapsed = await page.evaluate(() => { const d = document.querySelector('.toc-fold'); return d ? !d.open : null; });
      out.anchor.push(a);
      log('ANCHOR ' + JSON.stringify(a));
      await ctx.close();
    }
    // (c) 页内点展开态 TOC 链接
    {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(NEW + PAGE, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      await page.evaluate(() => { const d = document.querySelector('.toc-fold'); if (d) d.open = true; });
      await page.waitForTimeout(350);
      await page.click('.toc-side a[href="#' + ID + '"]');
      await page.waitForTimeout(900);
      const a = await page.evaluate(ANCHOR, ID);
      a.when = 'clickExpanded'; a.vp = vp.n;
      a.tocAutoCollapsed = await page.evaluate(() => { const d = document.querySelector('.toc-fold'); return d ? !d.open : null; });
      out.anchor.push(a);
      log('ANCHOR ' + JSON.stringify(a));
      await ctx.close();
    }
  }

  // ---------- A4 改前基线（8788）：同一 hash 冷启动 ----------
  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '768x1024', w: 768, h: 1024 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(OLD + PAGE + '#' + ID, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const a = await page.evaluate(ANCHOR, ID);
    a.vp = vp.n; a.when = 'oldColdLoadWithHash';
    a.tocDisplay = await page.evaluate(() => { const t = document.querySelector('.toc-side'); return t ? getComputedStyle(t).display : null; });
    out.oldRef.push(a);
    log('ANCHOR ' + JSON.stringify(a));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-a.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-a.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-a.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
