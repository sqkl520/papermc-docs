'use strict';
/**
 * cr2cp-live.js — 内容页导航现场实测（Playwright，只读）。
 * 输出：<tmpdir>/cr2cp/live.json
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const OUT = path.join(os.tmpdir(), 'cr2cp');
fs.mkdirSync(OUT, { recursive: true });

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/** 页面内：顶部 400px 元素清单 + 内容起点 + 导航控件普查 */
const PROBE = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
  };
  const cls = (el) => (el.getAttribute('class') || '').trim();
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  // ---- 顶部 400px ----
  const band = [];
  const all = [...document.querySelectorAll('body *')];
  for (const el of all) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY;
    if (top >= 400) continue;
    const tag = el.tagName.toLowerCase();
    if (['html', 'body', 'script', 'style'].includes(tag)) continue;
    // 只收「有自身文字或是有语义的容器叶子」
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const semantic = /^(header|nav|aside|main|h1|h2|h3|a|button|input|summary|details|ol|ul|li|p)$/.test(tag);
    if (!ownText && !semantic) continue;
    band.push({
      tag, cls: cls(el).slice(0, 60),
      id: el.id || '', role: el.getAttribute('role') || '',
      y: Math.round(top), h: Math.round(r.height), w: Math.round(r.width),
      text: (ownText || txt(el)).slice(0, 46),
      inNav: !!el.closest('.topbar,.sidebar,.toc-side,.crumbs,.pager,.sec-switch'),
      navKind: el.closest('.crumbs') ? 'crumbs'
        : el.closest('.topbar') ? 'topbar'
          : el.closest('.toc-side') ? 'toc' : el.closest('.sidebar') ? 'sidebar'
            : el.closest('.pager') ? 'pager' : '',
      isHeading: /^h[1-6]$/.test(tag),
      isArticleText: !!el.closest('article') && !el.closest('.crumbs,.pager,.topbar,.sidebar,.toc-side'),
    });
  }
  band.sort((a, b) => a.y - b.y || b.w - a.w);

  // ---- 正文起点 ----
  const art = document.querySelector('article.article');
  const h1 = document.querySelector('article h1, .page-head h1');
  const firstP = art ? art.querySelector('p, ul, ol, pre, table, figure') : null;
  const absY = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
  const contentStart = {
    h1Y: absY(h1), h1Text: h1 ? txt(h1).slice(0, 60) : null,
    firstBlockY: absY(firstP), firstBlockTag: firstP ? firstP.tagName.toLowerCase() : null,
    firstBlockText: firstP ? txt(firstP).slice(0, 70) : null,
    crumbsY: absY(document.querySelector('nav.crumbs')),
    articleTop: absY(art),
  };

  // ---- 导航控件普查 ----
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const ctl = (key, sel, extra) => {
    const els = qa(sel).filter(vis);
    const first = els[0];
    const r = first ? first.getBoundingClientRect() : null;
    return Object.assign({
      key, sel,
      inDom: qa(sel).length,
      visible: els.length,
      y: r ? Math.round(r.top + window.scrollY) : null,
      h: r ? Math.round(r.height) : null,
      sampleHref: first && first.getAttribute ? first.getAttribute('href') : null,
      sampleText: first ? txt(first).slice(0, 40) : null,
    }, extra || {});
  };

  const controls = [
    ctl('brand(站名→首页)', '.topbar .brand'),
    ctl('sec-switch(分区)', '.topbar .sec-switch a'),
    ctl('breadcrumbs(面包屑链接)', 'nav.crumbs a'),
    ctl('sidebar 分组标题', '.sidebar .side-group-title'),
    ctl('sidebar 页面链接', '.sidebar a[href]'),
    ctl('sidebar 组首页', '.sidebar .side-home'),
    ctl('sidebar 过滤框', '#side-filter'),
    ctl('右栏 TOC 条目', '.toc-side a[href^="#"]'),
    ctl('抽屉 TOC 条目', '[data-drawer-toc] a[href^="#"]'),
    ctl('pager 上一页', 'nav.pager a.prev'),
    ctl('pager 下一页', 'nav.pager a.next'),
    ctl('页内标题锚点 #', 'a.heading-anchor'),
    ctl('搜索按钮', '[data-open-search]'),
    ctl('all-pages 链接', 'a[href*="all-pages"]'),
    ctl('跳到正文 skip', 'a.skip'),
  ];

  // ---- 面包屑明细 ----
  const crumbNav = q('nav.crumbs');
  const crumbs = crumbNav ? [...crumbNav.querySelectorAll('a,span')].filter((e) => txt(e) && txt(e) !== '/').map((e) => ({
    tag: e.tagName.toLowerCase(), text: txt(e), href: e.getAttribute('href'),
  })) : [];

  // ---- TOC 形态 ----
  const tocSide = q('.toc-side');
  let tocState = null;
  if (tocSide) {
    const fold = tocSide.querySelector('.toc-fold');
    const titleEl = tocSide.querySelector('.toc-title');
    const ol = tocSide.querySelector('ol');
    tocState = {
      present: true,
      foldOpen: fold ? fold.hasAttribute('open') : null,
      titleText: titleEl ? txt(titleEl) : null,
      titleH: titleEl ? Math.round(titleEl.getBoundingClientRect().height) : null,
      titleBeforeContent: titleEl ? getComputedStyle(titleEl, '::before').content : null,
      position: getComputedStyle(tocSide).position,
      y: Math.round(tocSide.getBoundingClientRect().top + window.scrollY),
      listVisibleH: ol ? Math.round(ol.getBoundingClientRect().height) : 0,
      items: tocSide.querySelectorAll('a[href^="#"]').length,
      activeItems: tocSide.querySelectorAll('a.active').length,
    };
  }

  // ---- 层级序列 & 跳级 ----
  const hs = [...document.querySelectorAll('article h1,article h2,article h3,article h4,article h5,article h6')];
  const seq = hs.map((e) => Number(e.tagName.slice(1)));
  const skips = [];
  for (let i = 1; i < seq.length; i++) if (seq[i] - seq[i - 1] > 1) skips.push('h' + seq[i - 1] + '->h' + seq[i]);
  const lvl = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  seq.forEach((n) => { lvl['h' + n] += 1; });

  // ---- 无标题块（>834 字符）----
  const NOHEAD_LIMIT = 834;
  const blocks = [];
  if (art) {
    let run = ''; let runStart = null;
    const kids = [...art.children];
    for (const el of kids) {
      const t = txt(el);
      if (/^h[2-6]$/i.test(el.tagName)) {
        if (run.length > NOHEAD_LIMIT) blocks.push({ chars: run.length, startY: runStart, endTag: el.tagName, preview: run.slice(0, 60) });
        run = ''; runStart = null;
      } else {
        if (runStart === null) runStart = Math.round(el.getBoundingClientRect().top + window.scrollY);
        run += t + ' ';
      }
    }
    if (run.length > NOHEAD_LIMIT) blocks.push({ chars: run.length, startY: runStart, endTag: '(EOF)', preview: run.slice(0, 60) });
  }

  // ---- 页面几何 ----
  const doc = document.scrollingElement || document.documentElement;

  return {
    url: location.pathname,
    title: document.title,
    vw: window.innerWidth, vh: window.innerHeight,
    docH: Math.round(doc.scrollHeight),
    band: band.slice(0, 40),
    bandCount: band.length,
    contentStart,
    controls, crumbs, tocState,
    headings: { seq: seq.slice(0, 40), lvl, skips, total: seq.length },
    noHeadingBlocks: blocks,
    sidebarLinks: document.querySelectorAll('.sidebar a[href]').length,
    allLinks: document.querySelectorAll('a[href]').length,
    hasDrawerToc: !!q('[data-drawer-toc]'),
    navToggleVisible: (() => { const b = q('#nav-toggle'); return !!(b && vis(b)); })(),
  };
};

async function run() {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const result = { generatedAt: new Date().toISOString(), vps: {}, paths: {}, scrollspy: {}, click: {}, prePost: {}, mobile: {} };

  const PAGES = ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/paper/dev/particles/'];

  // ---------- 1) 各视口 × 各页 探针 ----------
  for (const vp of [{ w: 1440, h: 900 }, { w: 1280, h: 800 }, { w: 768, h: 1024 }, { w: 390, h: 844 }, { w: 320, h: 568 }]) {
    const key = vp.w + 'x' + vp.h;
    result.vps[key] = {};
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      await page.goto(NEW + p, { waitUntil: 'load' });
      await page.waitForTimeout(220);
      result.vps[key][p] = await page.evaluate(PROBE);
    }
    await ctx.close();
  }

  // ---------- 2) 滚动 3 个位置看 scroll spy（dialogs, 1440）----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const spy = [];
    const docH = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollHeight);
    for (const frac of [0, 0.35, 0.7]) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round((docH - 900) * frac));
      await page.waitForTimeout(600);
      spy.push(await page.evaluate(() => {
        const tocActive = [...document.querySelectorAll('.toc-side a.active')].map((a) => a.textContent.trim());
        const tocAt = [...document.querySelectorAll('.toc-side a')].findIndex((a) => a.classList.contains('active'));
        return {
          scrollY: Math.round(window.scrollY),
          tocActive, tocActiveIndex: tocAt,
          tocActiveCount: tocActive.length,
          drawerActive: [...document.querySelectorAll('[data-drawer-toc] a.active')].map((a) => a.textContent.trim()),
        };
      }));
    }
    result.scrollspy.dialogs1440 = spy;
    // world-configuration：无 TOC 时长页滚动
    await page.goto(NEW + '/paper/reference/world-configuration/', { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const spy2 = [];
    const docH2 = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollHeight);
    for (const frac of [0, 0.35, 0.7]) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round((docH2 - 900) * frac));
      await page.waitForTimeout(400);
      spy2.push(await page.evaluate(() => ({
        scrollY: Math.round(window.scrollY),
        tocPresent: !!document.querySelector('.toc-side'),
        tocActiveCount: document.querySelectorAll('.toc-side a.active').length,
        stickyHandholds: [...document.querySelectorAll('.topbar,.toc-side,.backtop,.to-top,[href="#top"],a[href="#main"]')]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.top < 200; })
          .map((e) => (e.getAttribute('class') || e.tagName).slice(0, 30)),
      })));
    }
    result.scrollspy.world1440 = spy2;
    result.scrollspy.worldDocH = docH2;

    // 同页：TOC 缺席时，正文中是否有「回到顶部」
    result.scrollspy.worldBackToTop = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('a[href="#"],a[href="#top"],button')].map((e) => e.textContent.trim()).filter((t) => /顶部|top|↑/i.test(t));
      return { found: cands.slice(0, 5), count: cands.length };
    });
    await ctx.close();
  }

  // ---------- 3) 点击实测：每个入口点完去哪 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const base = NEW + '/paper/dev/dialogs/';
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    const clicks = {};
    const trial = async (name, sel, expectNav) => {
      await page.goto(base, { waitUntil: 'load' });
      await page.waitForTimeout(160);
      const before = page.url();
      const el = page.locator(sel).first();
      const cnt = await el.count();
      if (!cnt) { clicks[name] = { exists: false }; return; }
      const href = await el.getAttribute('href');
      const vis = await el.isVisible().catch(() => false);
      let after = null; let err = null;
      try {
        await el.click({ timeout: 3500 });
        await page.waitForTimeout(420);
        after = page.url();
      } catch (e) { err = String(e.message).slice(0, 90); }
      clicks[name] = { exists: true, visible: vis, href, before, after, navigated: after ? after !== before : false, err };
      if (expectNav && after && after !== before && !/#/.test(href || '')) { /* 已跳走，下一次会重新 goto */ }
    };
    await trial('brand 站名', '.topbar .brand');
    await trial('sec-switch Paper', '.topbar .sec-switch a:first-child');
    await trial('crumb 第2级', 'nav.crumbs a:nth-of-type(2)');
    await trial('sidebar 组首页', '.sidebar .side-home');
    await trial('sidebar 当前项', '.sidebar a.active');
    await trial('sidebar 一个普通页', '.sidebar a[href$="/dev/index.html"]');
    await trial('TOC 第3条', '.toc-side a[href^="#"]:nth-of-type(1)');
    await trial('pager 下一页', 'nav.pager a.next');
    await trial('pager 上一页', 'nav.pager a.prev');
    await trial('heading 锚点#', 'a.heading-anchor');
    await trial('搜索按钮', '[data-open-search]');
    await trial('all-pages', 'a[href*="all-pages"]');
    result.click.dialogs = clicks;

    // 面包屑内容
    await page.goto(base, { waitUntil: 'load' });
    result.click.crumbText = await page.evaluate(() => {
      const n = document.querySelector('nav.crumbs');
      return n ? n.textContent.replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim() : null;
    });
    result.click.pagerText = await page.evaluate(() => {
      const n = document.querySelector('nav.pager');
      return n ? n.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    await ctx.close();
  }

  // ---------- 4) 改前 8788 vs 改后 8787 ----------
  for (const p of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
    const pair = {};
    for (const [label, base] of [['pre', OLD], ['post', NEW]]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(base + p, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      pair[label] = await page.evaluate(PROBE);
      await ctx.close();
    }
    result.prePost[p] = pair;
  }

  // ---------- 5) 移动端：首屏多少是导航 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    result.mobile.dialogs = await page.evaluate(() => {
      const vh = window.innerHeight;
      const absY = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
      const toc = document.querySelector('.toc-side');
      const fold = toc ? toc.querySelector('.toc-fold') : null;
      const h1 = document.querySelector('article h1, .page-head h1');
      const art = document.querySelector('article.article');
      const firstP = art ? art.querySelector('p, ul, ol, pre, table, figure') : null;
      return {
        vh,
        docH: Math.round((document.scrollingElement || document.documentElement).scrollHeight),
        h1Y: absY(h1), firstP: absY(firstP),
        h1Screens: +(absY(h1) / vh).toFixed(2),
        contentScreens: +(absY(firstP) / vh).toFixed(2),
        crumbsY: absY(document.querySelector('nav.crumbs')),
        tocY: absY(toc), tocH: toc ? Math.round(toc.getBoundingClientRect().height) : 0,
        tocOpen: fold ? fold.hasAttribute('open') : null,
        tocTitle: toc ? (toc.querySelector('.toc-title') || {}).textContent : null,
        tocItems: toc ? toc.querySelectorAll('a[href^="#"]').length : 0,
        sidebarVisible: (() => { const s = document.querySelector('.sidebar'); if (!s) return false; const r = s.getBoundingClientRect(); return r.width > 0 && r.left > -50; })(),
        navToggle: (() => { const b = document.querySelector('#nav-toggle'); if (!b) return null; const r = b.getBoundingClientRect(); return { y: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; })(),
        pagerY: absY(document.querySelector('nav.pager')),
        // 首屏内 y< 844 的可见导航控件数
        navInFirstScreen: [...document.querySelectorAll('.topbar a,.topbar button,nav.crumbs a,.toc-side summary,.pager a')]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < vh && r.bottom > 0; }).length,
        linksInFirstScreen: [...document.querySelectorAll('a[href]')]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < vh && r.bottom > 0; }).length,
      };
    });
    // 打开抽屉看目录是否容易发现
    await page.click('#nav-toggle');
    await page.waitForTimeout(420);
    result.mobile.drawer = await page.evaluate(() => {
      const tb = document.querySelector('[data-drawer-toc]');
      const sum = tb ? tb.querySelector('summary') : null;
      return {
        drawerOpen: !!document.querySelector('.sidebar.open, body.nav-open, .sidebar[data-open]'),
        drawerTocPresent: !!tb,
        drawerTocOpen: tb ? tb.hasAttribute('open') : null,
        drawerTocY: tb ? Math.round(tb.getBoundingClientRect().top) : null,
        drawerTocTitle: sum ? sum.textContent.replace(/\s+/g, ' ').trim() : null,
        h1FarBelow: (() => { const h1 = document.querySelector('article h1,.page-head h1'); return h1 ? Math.round(h1.getBoundingClientRect().top) : null; })(),
      };
    });
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, 'live.json'), JSON.stringify(result, null, 1), 'utf8');
  console.log('JSON -> ' + path.join(OUT, 'live.json'));

  // 终端摘要
  const d = result.vps['1440x900']['/paper/dev/dialogs/'];
  console.log('\n=== 1440x900 /paper/dev/dialogs/ ===');
  console.log('docH            ' + d.docH);
  console.log('h1 y            ' + d.contentStart.h1Y);
  console.log('首块正文 y      ' + d.contentStart.firstBlockY + '  <' + d.contentStart.firstBlockTag + '>');
  console.log('面包屑 y        ' + d.contentStart.crumbsY);
  console.log('标题层级        ' + JSON.stringify(d.headings.lvl) + ' skips=' + JSON.stringify(d.headings.skips));
  console.log('TOC             ' + JSON.stringify(d.tocState));
  console.log('侧栏链接        ' + d.sidebarLinks + ' / 全页链接 ' + d.allLinks);
  console.log('顶部400px 元素数 ' + d.bandCount);
  console.log('\n--- 顶部 400px（y / h / nav? / tag.cls / text）---');
  d.band.forEach((b) => console.log('  y=' + String(b.y).padStart(3) + ' h=' + String(b.h).padStart(3) + ' ' + (b.inNav ? 'NAV ' : '    ') + ' ' + (b.tag + '.' + b.cls).slice(0, 42).padEnd(42) + ' ' + b.text.slice(0, 34)));
  console.log('\n--- 控件普查 ---');
  d.controls.forEach((c) => console.log('  ' + c.key.padEnd(26) + ' dom=' + String(c.inDom).padStart(3) + ' vis=' + String(c.visible).padStart(3) + ' y=' + String(c.y).padStart(4) + ' h=' + String(c.h).padStart(3) + '  ' + String(c.sampleHref).slice(0, 44)));
  console.log('\n--- 面包屑 ---');
  d.crumbs.forEach((c) => console.log('  ' + c.tag + ' "' + c.text + '" -> ' + c.href));
}
run().catch((e) => { console.error('FAIL', e); process.exit(1); });
