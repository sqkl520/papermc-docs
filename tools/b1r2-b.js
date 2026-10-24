'use strict';
/**
 * b1r2-b.js — 红队批1 · 角度 1/3/10 续：展开态锚点落点、skip 链接、折叠态可达性、几何基线
 *   B1 展开态点目录链接的真实落点（<1025 唯一可达路径）
 *   B2 折叠态 + location.hash / 外部链接
 *   B3 skip 链接在 --toc-offset 下的落点
 *   B4 折叠态目录链接是否可达（用户能否点到）
 *   B5 ≥1025 与改前 8788 的 article.w / pageHeight 对照（真基线）
 * 用法: node tools/b1r2-b.js
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

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const ANCHOR = (id) => {
  const el = document.getElementById(id);
  const toc = document.querySelector('.toc-side');
  const tb = toc ? toc.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };
  const b = el.getBoundingClientRect();
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;
  /* 真正可见：既不压顶栏，也不压 TOC */
  const occlBottom = Math.max(tb.height > 2 ? tb.bottom : 0, topbar);
  const visTop = Math.max(b.top, occlBottom);
  const visBot = Math.min(b.bottom, innerHeight);
  const d = document.querySelector('.toc-fold');
  return {
    id,
    scrollY: Math.round(window.scrollY),
    headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom), headingH: Math.round(b.height),
    topbarBottom: Math.round(topbar),
    tocTop: Math.round(tb.top), tocBottom: Math.round(tb.bottom), tocH: Math.round(tb.height),
    tocOpen: d ? !!d.open : null,
    scrollPadTop: getComputedStyle(document.documentElement).scrollPaddingTop,
    offsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
    hiddenBehindToc: b.top < tb.bottom - 1 && b.bottom > tb.top + 1,
    visiblePx: Math.max(0, Math.round(visBot - visTop)),
    visiblePctOfHeading: Math.round(100 * Math.max(0, visBot - visTop) / Math.max(1, b.height)),
    /* 落点在视口里的相对位置：0=顶 100=底。
       期望值（改前基线 / 正确实现）应≈ (topbar+12)/vh*100 ≈ 8-18 */
    landingPctOfViewport: +(100 * b.top / innerHeight).toFixed(1),
    remainBelowHeadingPx: Math.round(innerHeight - Math.max(b.bottom, 0)),
    atScrollMax: Math.abs(window.scrollY - (document.documentElement.scrollHeight - innerHeight)) < 2,
  };
};

(async () => {
  if (!EXE) { console.error('NO CHROME'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { anchorExpanded: [], anchorCollapsed: [], skip: [], reach: [], geom: [] };
  const ID = 'directional-particles';

  const VPS = [
    { n: '390x844', w: 390, h: 844 },
    { n: '768x1024', w: 768, h: 1024 },
    { n: '812x375', w: 812, h: 375 },
    { n: '320x568', w: 320, h: 568 },
  ];

  // ---------- B4 折叠态：目录链接是否可点 ----------
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const r = await page.evaluate((sel) => {
      const a = document.querySelector(sel);
      const rect = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      const d = document.querySelector('.toc-fold');
      return {
        open: d ? d.open : null,
        linkRect: { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top) },
        linkVisible: !!(rect.width > 0 && rect.height > 0),
        olDisplay: getComputedStyle(document.querySelector('.toc-fold > ol')).display,
        csVisibility: cs.visibility, csDisplay: cs.display,
        /* 用户视角：折叠条本身多高，可点面积多大 */
        summaryH: Math.round(document.querySelector('.toc-title').getBoundingClientRect().height),
        summaryW: Math.round(document.querySelector('.toc-title').getBoundingClientRect().width),
      };
    }, '.toc-side a[href="#' + ID + '"]');
    r.vp = vp.n;
    out.reach.push(r);
    log('REACH ' + JSON.stringify(r));
    await ctx.close();
  }

  // ---------- B1 展开态点链接（唯一可达路径） ----------
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
    await page.waitForTimeout(400);
    const padBefore = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop);
    await page.evaluate((sel) => { document.querySelector(sel).click(); }, '.toc-side a[href="#' + ID + '"]');
    await page.waitForTimeout(1200);
    const a = await page.evaluate(ANCHOR, ID);
    a.vp = vp.n; a.when = 'clickWhileExpanded'; a.padBefore = padBefore;
    /* 落点后用户能否看到标题：命中测试标题中心点 */
    a.hitAtHeadingCenter = await page.evaluate((id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      const y = Math.round(b.top + b.height / 2);
      if (y < 0 || y > innerHeight - 1) return 'offscreen';
      const el = document.elementFromPoint(Math.round(b.left + 30), y);
      return el ? (el.tagName + '.' + String(el.className || '').slice(0, 24)) : null;
    }, ID);
    out.anchorExpanded.push(a);
    log('ANCHOR ' + JSON.stringify(a));
    await ctx.close();
  }

  // ---------- B2 折叠态 + hash（外部链接 / 地址栏） ----------
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/' + '#' + ID, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const a = await page.evaluate(ANCHOR, ID);
    a.vp = vp.n; a.when = 'loadWithHashCollapsed';
    out.anchorCollapsed.push(a);
    log('ANCHOR ' + JSON.stringify(a));
    await ctx.close();
  }

  // ---------- B3 skip 链接 ----------
  for (const vp of VPS) {
    for (const openState of ['collapsed', 'expanded']) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (openState === 'expanded') {
        await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
        await page.waitForTimeout(400);
      }
      const r = await page.evaluate(() => {
        const s = document.querySelector('.skip');
        const href = s ? s.getAttribute('href') : null;
        const tgt = href && href.length > 1 ? document.querySelector(href) : null;
        const before = tgt ? Math.round(tgt.getBoundingClientRect().top) : null;
        if (s) s.focus();
        return { href, before, pad: getComputedStyle(document.documentElement).scrollPaddingTop, hasSkip: !!s };
      });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
      const after = await page.evaluate((href) => {
        const tgt = href && href.length > 1 ? document.querySelector(href) : null;
        const b = tgt ? tgt.getBoundingClientRect() : null;
        return {
          after: b ? Math.round(b.top) : null,
          scrollY: Math.round(window.scrollY),
          hitTop: b ? (document.elementFromPoint(Math.round(b.left + 40), Math.max(1, Math.round(b.top + 4))) || {}) : {},
          firstBlockVisible: (() => {
            const el = document.querySelector('.article h1, .article h2, .article p');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { top: Math.round(r.top), visible: r.top >= 0 && r.top < innerHeight };
          })(),
        };
      }, r.href);
      const row = { vp: vp.n, openState, ...r, after: after.after, scrollYAfter: after.scrollY, firstBlockVisible: after.firstBlockVisible };
      out.skip.push(row);
      log('SKIP ' + JSON.stringify(row));
      await ctx.close();
    }
  }

  // ---------- B5 几何：≥1025 新 vs 改前真基线 ----------
  const PAGES = ['/paper/dev/particles/', '/paper/reference/world-configuration/', '/paper/dev/dialogs/', '/paper/reference/system-properties/'];
  for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '1280x800', w: 1280, h: 800 }, { n: '1025x800', w: 1025, h: 800 }]) {
    for (const pg of PAGES) {
      const row = { vp: vp.n, page: pg };
      for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await ctx.newPage();
        await page.goto(base + pg, { waitUntil: 'load' });
        await page.waitForTimeout(250);
        row[tag] = await page.evaluate(() => {
          const art = document.querySelector('article.article') || document.querySelector('article');
          const c = document.querySelector('.content');
          const toc = document.querySelector('.toc-side');
          const r = art ? art.getBoundingClientRect() : null;
          return {
            pageHeight: document.documentElement.scrollHeight,
            articleW: r ? +r.width.toFixed(2) : null,
            articleX: r ? +r.x.toFixed(2) : null,
            padL: c ? getComputedStyle(c).paddingLeft : null,
            padR: c ? getComputedStyle(c).paddingRight : null,
            tocDisplay: toc ? getComputedStyle(toc).display : null,
            tocH: toc ? Math.round(toc.getBoundingClientRect().height) : 0,
            docW: document.documentElement.scrollWidth,
          };
        });
        await ctx.close();
      }
      row.dW = row.new.articleW !== null && row.old.articleW !== null ? +(row.new.articleW - row.old.articleW).toFixed(2) : null;
      row.dH = row.new.pageHeight - row.old.pageHeight;
      out.geom.push(row);
      log('GEOM ' + JSON.stringify(row));
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-b.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-b.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-b.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
