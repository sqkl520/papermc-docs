'use strict';
/**
 * critique-mobile-probe.js —— 移动端锐评专用补测器（只读诊断，不改站点、不覆盖 ui-shots）
 *
 * 目的：补足 reports/ui-shots 那批共享截图测不到的维度：
 *   1) 首屏「正文起点」在文档里的绝对 Y（chrome 侵占了多少像素）
 *   2) 本页目录：默认 open？多高？在流内还是在视口里？滚动后是否还看得见？
 *   3) 抽屉：打开成本、190 链接可寻性、当前项定位、搜索框位置、关闭后回焦
 *   4) 代码块：外层滚动容器谁在滚、有没有「可横滑」的视觉提示、复制按钮尺寸与距离
 *   5) 表格：横滚几屏、表头是否被隐藏、卡片的字段有没有标签
 *   6) 图片：自然尺寸 / 渲染尺寸 / lazy / width-height 是否预留 / 有无 caption / 有无 lightbox
 *   7) 触控目标审计（排除正文行内链接）
 *   8) 页脚 pager 在 4 万像素页面末尾的位置与尺寸
 *   9) 长页面有无回到顶部 / 阅读进度 / 分节锚
 *  10) 各种字号 / 内边距实测
 *
 * 用法：
 *   node tools/critique-mobile-probe.js                     # 全部视口 × 全部探针页
 *   node tools/critique-mobile-probe.js --vp=390x844
 *   node tools/critique-mobile-probe.js --json=out.json
 *   node tools/critique-mobile-probe.js --shots=1           # 额外把关键区域截图到 %TEMP%\critique-mobile
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787');
const SHOTDIR = path.join(os.tmpdir(), 'critique-mobile');
const WANT_SHOTS = argv.includes('--shots') || argv.some((a) => a.startsWith('--shots='));

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
  { name: '768x1024', width: 768, height: 1024 },
];

const PAGES = [
  { url: '/', name: 'landing' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/paper/dev/dialogs/', name: 'dialogs' },
  { url: '/paper/reference/world-configuration/', name: 'world-config' },
  { url: '/velocity/tuning/', name: 'tuning' },
  { url: '/all-pages.html', name: 'all-pages' },
  { url: '/paper/dev/particles/', name: 'particles' },
  { url: '/paper/reference/permissions/', name: 'permissions' },
  { url: '/velocity/configuration/', name: 'velocity-conf' },
];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PROBE = () => {
  const doc = document;
  const px = (v) => Math.round(parseFloat(v) * 100) / 100;
  const r2 = (n) => Math.round(n * 10) / 10;
  /** 文档坐标矩形（y 含滚动偏移） */
  const R = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: r2(b.x), y: r2(b.y + window.scrollY), w: r2(b.width), h: r2(b.height), vTop: r2(b.top), vBottom: r2(b.bottom) };
  };
  const q = (s, root) => (root || doc).querySelector(s);
  const qa = (s, root) => Array.from((root || doc).querySelectorAll(s));
  const csOf = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const txt = (el, n) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n || 60) : null);

  const main = q('#main');
  const article = q('.content .article') || q('.article');
  const toc = q('.toc-side');
  const tocFold = q('.toc-side .toc-fold') || q('.toc-side details');

  /* ---------- 1. 首屏：正文起点 ---------- */
  const bodyStart = article ? (article.querySelector('h2, h3, p, ul, ol, .code-block, .alert, .table-wrap') || article) : null;
  const firstP = article ? article.querySelector(':scope > p') : null;
  const headEls = ['.crumbs', '.page-head', '.page-head h1', '.page-desc', '.page-meta', '.toc-side', '.hero', '.hero-search', '.entry-cards', '.filter-bar', '.stats',
    '.article > h1', '.article > p', '.article > ul', '.article > .alert', '.article > .code-block'].map((s) => [s, R(q(s))]).filter((x) => x[1]);

  /* ---------- 2. 本页目录形态 ---------- */
  let tocInfo = null;
  if (toc) {
    const items = qa('.toc-side ol > li > a', toc);
    const firstItem = items[0], lastItem = items[items.length - 1];
    tocInfo = {
      position: csOf(toc, 'position'), display: csOf(toc, 'display'), order: csOf(toc, 'order'),
      rect: R(toc),
      foldOpen: tocFold ? !!tocFold.open : null,
      foldTag: tocFold ? tocFold.tagName : null,
      titleRect: R(q('.toc-title', toc)),
      itemCount: items.length,
      itemH: firstItem ? r2(firstItem.getBoundingClientRect().height) : null,
      itemFontSize: firstItem ? csOf(firstItem, 'fontSize') : null,
      firstItemRect: R(firstItem), lastItemRect: R(lastItem),
      listHeight: R(q('ol', toc)) ? R(q('ol', toc)).h : null,
      viewportsTall: R(toc) ? r2(R(toc).h / window.innerHeight) : null,
      anchors: items.map((a) => a.getAttribute('href')).slice(0, 3),
    };
  }

  /* ---------- 3. 锚点跳转落点（scroll-padding 实测） ---------- */
  const scrollPadTop = csOf(doc.documentElement, 'scrollPaddingTop');

  /* ---------- 4. 代码块 ---------- */
  const codeBlocks = qa('.code-block').slice(0, 3).map((fig) => {
    const pre = fig.querySelector('pre');
    const host = fig.querySelector('.code-scroll') || pre;
    const copy = fig.querySelector('.code-copy, [data-copy-code]');
    const lang = fig.querySelector('.code-lang');
    const file = fig.querySelector('.code-file');
    const figR = R(fig);
    const cbR = R(copy);
    return {
      file: txt(file, 40),
      hostClass: host ? host.className : null,
      hostClientW: host ? host.clientWidth : null,
      hostScrollW: host ? host.scrollWidth : null,
      hostOverflowX: host ? csOf(host, 'overflowX') : null,
      overflowingAttr: host ? host.hasAttribute('data-overflowing') : null,
      preScrollW: pre ? pre.scrollWidth : null,
      preClientW: pre ? pre.clientWidth : null,
      screensWide: host && host.clientWidth ? r2(host.scrollWidth / host.clientWidth) : null,
      hostBgImage: host ? csOf(host, 'backgroundImage') : null,
      hostAfterContent: host ? (getComputedStyle(host, '::after').content) : null,
      hostAfterWidth: host ? csOf(host, '::after') && getComputedStyle(host, '::after').width : null,
      scrollbarPx: host ? host.offsetHeight - host.clientHeight : null,
      copyBtn: copy ? { text: txt(copy, 12), w: cbR.w, h: cbR.h, distFromRight: figR ? r2(figR.x + figR.w - (cbR.x + cbR.w)) : null, distFromTop: figR ? r2(cbR.y - figR.y) : null } : null,
      langLabel: lang ? { text: txt(lang, 12), w: R(lang).w, h: R(lang).h, fontSize: csOf(lang, 'fontSize') } : null,
      codeFontSize: pre ? csOf(pre, 'fontSize') : null,
      preLineHeight: pre ? csOf(pre, 'lineHeight') : null,
      preRadius: pre ? csOf(pre, 'borderRadius') : null,
      figRadius: csOf(fig, 'borderRadius'),
      hostTabIndex: host ? host.getAttribute('tabindex') : null,
      ariaLabel: host ? host.getAttribute('aria-label') : null,
    };
  });

  /* ---------- 5. 表格 ---------- */
  const tables = qa('.table-wrap').slice(0, 4).map((w) => {
    const t = w.querySelector('table');
    const ths = qa('thead th', w);
    const firstRowTds = qa('tbody tr:first-child td', w);
    return {
      cls: t ? t.className : null,
      clientW: w.clientWidth, scrollW: w.scrollWidth,
      screensWide: w.clientWidth ? r2(w.scrollWidth / w.clientWidth) : null,
      overflowingAttr: w.hasAttribute('data-overflowing'),
      cols: ths.length,
      headers: ths.map((x) => txt(x, 14)),
      theadDisplay: q('thead', w) ? csOf(q('thead', w), 'display') : null,
      thNowrap: ths[0] ? csOf(ths[0], 'white-space') : null,
      tableWidth: t ? r2(t.getBoundingClientRect().width) : null,
      tableFontSize: t ? csOf(t, 'fontSize') : null,
      tableDisplay: t ? csOf(t, 'display') : null,
      rowCount: qa('tbody tr', w).length,
      firstRowH: R(q('tbody tr', w)) ? R(q('tbody tr', w)).h : null,
      firstRowCellDisplays: firstRowTds.map((td) => csOf(td, 'display')),
      firstRowCellLabels: firstRowTds.map((td) => td.getAttribute('data-label')),
      cellPadding: firstRowTds[0] ? csOf(firstRowTds[0], 'padding') : null,
      stickyCell: firstRowTds[0] ? csOf(firstRowTds[0], 'position') : null,
    };
  });

  /* ---------- 6. 图片 ---------- */
  const imgs = qa('img').map((im) => {
    const b = im.getBoundingClientRect();
    return {
      name: (im.getAttribute('src') || '').split('/').pop(),
      natural: im.naturalWidth + 'x' + im.naturalHeight,
      rendered: r2(b.width) + 'x' + r2(b.height),
      complete: im.complete,
      loading: im.getAttribute('loading'),
      hasWH: im.hasAttribute('width') || im.hasAttribute('height'),
      alt: im.getAttribute('alt'),
      zoom: im.getAttribute('data-zoom'),
      inFigure: !!im.closest('figure'),
      caption: im.closest('figure') ? txt(im.closest('figure').querySelector('figcaption'), 60) : null,
      external: im.classList.contains('external-image'),
      note: im.parentElement && im.parentElement.classList.contains('external-image-note') ? null : (im.nextElementSibling ? txt(im.nextElementSibling, 50) : null),
    };
  });
  const imgSummary = {
    total: imgs.length,
    broken: imgs.filter((i) => i.complete && i.natural === '0x0').length,
    lazy: imgs.filter((i) => i.loading === 'lazy').length,
    withWH: imgs.filter((i) => i.hasWH).length,
    withZoom: imgs.filter((i) => i.zoom !== null).length,
    withoutAlt: imgs.filter((i) => !i.alt).length,
    sample: imgs.slice(0, 8),
  };

  /* ---------- 7. 触控目标审计（排除正文行内链接） ---------- */
  const all = qa('a[href], button, summary, input, select, textarea');
  const inline = (el) => {
    if (el.tagName !== 'A') return false;
    const host = el.closest('.article');
    if (!host) return false;
    if (el.classList.contains('heading-anchor')) return true;
    if (el.closest('.code-block') || el.closest('.table-wrap') || el.closest('.alert') || el.closest('.pager')) return false;
    return !!el.closest('p, li, td, blockquote');
  };
  const small = [];
  const seen = new Set();
  for (const el of all) {
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    if (inline(el)) continue;
    if (b.height >= 44 && b.width >= 44) continue;
    const key = el.tagName + '.' + (el.className || '') + '|' + txt(el, 20) + '|' + Math.round(b.height) + 'x' + Math.round(b.width);
    if (seen.has(key)) continue;
    seen.add(key);
    small.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), text: txt(el, 24), h: r2(b.height), w: r2(b.width), href: el.getAttribute('href') });
  }

  /* ---------- 8. 页脚 / pager / 固定元素 / 回到顶部 ---------- */
  const pager = q('.pager');
  const pagerInfo = pager ? {
    rect: R(pager),
    depthFromTop: r2(R(pager).y),
    percentDown: r2((R(pager).y / Math.max(1, doc.documentElement.scrollHeight)) * 100),
    links: qa('a', pager).map((a) => ({ dir: txt(a.querySelector('.dir'), 12), ttl: txt(a.querySelector('.ttl'), 30), w: R(a).w, h: R(a).h })),
  } : null;
  const footer = q('.page-footer');

  const fixedSticky = [];
  const seenFS = new Set();
  for (const el of qa('body *')) {
    const p = csOf(el, 'position');
    if (p !== 'fixed' && p !== 'sticky') continue;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    const key = el.tagName + '.' + el.className + p;
    if (seenFS.has(key)) continue;
    seenFS.add(key);
    fixedSticky.push({ tag: el.tagName, cls: String(el.className).slice(0, 36), position: p, h: r2(b.height), w: r2(b.width), top: r2(b.top), bottom: r2(b.bottom), z: csOf(el, 'zIndex') });
  }

  const backToTop = qa('a[href="#top"], a[href="#"], [class*="to-top"], [class*="totop"], [class*="back-to"], [id*="to-top"], [class*="progress"], [id*="progress"], [role="progressbar"]').map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 40), text: txt(el, 20) }));
  const topAnchorTarget = !!q('#top') || !!doc.querySelector('[name="top"]');

  /* ---------- 9. 字号 / 内边距 ---------- */
  const sample = (sel) => {
    const el = q(sel);
    if (!el) return null;
    return { sel, fontSize: csOf(el, 'fontSize'), lineHeight: csOf(el, 'lineHeight'), color: csOf(el, 'color') };
  };
  const typo = {
    contentPadding: main ? csOf(main, 'padding') : null,
    articleWidth: article ? r2(article.getBoundingClientRect().width) : null,
    contentWidth: main ? r2(main.getBoundingClientRect().width) : null,
    crumbFontSize: q('.crumbs') ? csOf(q('.crumbs'), 'fontSize') : null,
    crumbLinkH: R(q('.crumbs a')) ? R(q('.crumbs a')).h : null,
    chipCount: qa('.page-meta .chip').length,
    pageMetaH: R(q('.page-meta')) ? R(q('.page-meta')).h : null,
    samples: ['.article p', '.article > h1', '.article h2', '.article h3', '.article h4', '.article li', '.article li li li', '.article pre', '.article code', '.crumbs a', '.chip', '.page-desc', '.toc-side a', '.toc-title', '.side-filter', '.pager .ttl', '.filter-count'].map(sample).filter(Boolean),
  };

  /* ---------- 10. 长页面：结构 / 锚 / 分节 ---------- */
  const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((t) => [t, qa('.article ' + t).length]);
  const headingIdCount = qa('.article h1[id], .article h2[id], .article h3[id], .article h4[id]').length;
  const maxUlDepth = (() => {
    let max = 0;
    for (const ul of qa('.article ul, .article ol')) {
      let d = 0, p = ul.parentElement;
      while (p && p !== doc.body) { if (p.tagName === 'UL' || p.tagName === 'OL') d++; p = p.parentElement; }
      if (d > max) max = d;
    }
    if (max > 0) max += 1;
    return max || 1;
  })();
  const deepLi = qa('.article li').map((li) => {
    let d = 0, p = li.parentElement;
    while (p && p !== doc.body) { if (p.tagName === 'UL' || p.tagName === 'OL') d++; p = p.parentElement; }
    return { d, w: r2(li.getBoundingClientRect().width), text: txt(li, 30) };
  }).sort((a, b) => b.d - a.d || a.w - b.w);
  const nested = {
    maxUlDepth,
    deepest: deepLi[0] || null,
    deepestWidthPx: deepLi[0] ? deepLi[0].w : null,
    liCount: deepLi.length,
    charsPerLineAtDeepest: deepLi[0] ? r2(deepLi[0].w / 15.2) : null,
  };

  /* ---------- 11. 落地页 / 清单页专属 ---------- */
  const heroInput = q('#hero-search');
  const hero = heroInput ? {
    rect: R(heroInput), fontSize: csOf(heroInput, 'fontSize'),
    placeholder: heroInput.getAttribute('placeholder'),
    placeholderChars: (heroInput.getAttribute('placeholder') || '').length,
    placeholderFitsCh: r2(heroInput.clientWidth / (parseFloat(csOf(heroInput, 'fontSize')) * 0.5)),
  } : null;
  const entryCards = qa('.entry-card').map((c) => ({ title: txt(c.querySelector('.ec-title'), 30), rect: R(c) }));
  const quickbar = qa('.quickbar .qa').map((c) => ({ title: txt(c.querySelector('b'), 30), rect: R(c) }));
  const firstFoldLinks = qa('a[href]').filter((a) => {
    const b = a.getBoundingClientRect();
    return b.top >= 0 && b.bottom <= window.innerHeight && b.width > 0;
  }).length;
  const firstFoldDocLinks = qa('a[href]').filter((a) => {
    const b = a.getBoundingClientRect();
    const href = a.getAttribute('href') || '';
    return b.top >= 0 && b.bottom <= window.innerHeight && !/#|^https?:|index\.html|all-pages|snapshots/.test(href);
  }).length;

  const filterBar = q('.filter-bar');
  const filterInfo = filterBar ? {
    rect: R(filterBar), position: csOf(filterBar, 'position'),
    inputFontSize: q('input', filterBar) ? csOf(q('input', filterBar), 'fontSize') : null,
    inputRect: R(q('input', filterBar)),
  } : null;
  const apRows = qa('table.allpages tbody tr, table.snapshots tbody tr');

  return {
    title: doc.title.slice(0, 70),
    pageHeight: Math.round(doc.documentElement.scrollHeight),
    viewportH: window.innerHeight,
    screens: r2(doc.documentElement.scrollHeight / window.innerHeight),
    docScrollW: Math.round(doc.documentElement.scrollWidth),
    innerW: window.innerWidth,
    hasHorizontalOverflow: doc.documentElement.scrollWidth > window.innerWidth + 1,
    bodyStartY: bodyStart ? R(bodyStart).y : null,
    bodyStartScreens: bodyStart ? r2(R(bodyStart).y / window.innerHeight) : null,
    firstParagraphY: firstP ? R(firstP).y : null,
    headEls,
    toc: tocInfo,
    scrollPadTop,
    codeBlocks,
    tables,
    images: imgSummary,
    smallTargets: { count: small.length, sample: small.slice(0, 22) },
    pager: pagerInfo,
    footer: footer ? R(footer) : null,
    fixedSticky,
    backToTop: { candidates: backToTop, topAnchorTarget },
    typo,
    headings,
    headingIdCount,
    nested,
    hero, entryCards, quickbar, firstFoldLinks, firstFoldDocLinks,
    filterInfo,
    apRowCount: apRows.length,
    apFirstRow: apRows[0] ? R(apRows[0]) : null,
    apRowTexts: apRows.slice(0, 2).map((r) => txt(r, 140)),
    detailsCount: qa('details').length,
    detailsOpen: qa('details[open]').length,
    focusables: qa('a[href], button, input, select, textarea, [tabindex="0"]').length,
    landmarks: { header: !!q('header'), nav: !!q('nav'), main: !!q('main'), aside: !!q('aside'), footer: !!q('footer') },
  };
};

/* ---------- 抽屉专项探针（单独一轮，因为它改变页面状态） ---------- */
const DRAWER_PROBE = () => {
  const doc = document;
  const r2 = (n) => Math.round(n * 10) / 10;
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height) }; };
  const q = (s, root) => (root || doc).querySelector(s);
  const qa = (s, root) => Array.from((root || doc).querySelectorAll(s));
  const txt = (el, n) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n || 40) : null);

  const side = q('#sidebar') || q('.sidebar');
  const toggle = q('#nav-toggle');
  const filter = q('#side-filter');
  const scrim = q('#nav-scrim');
  const active = q('.sidebar a.active');
  const open = R(side);
  const links = qa('#sidebar a[href]', doc);
  const inViewport = links.filter((a) => { const b = a.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight && b.width > 0; });

  /* 当前页所在链路：有多少层折叠的 details 必须先点开才能看到当前项 */
  const collapsedAncestors = [];
  let p = active;
  while (p && p !== side) {
    if (p.tagName === 'DETAILS' && !p.open) collapsedAncestors.push(txt(p.querySelector('summary'), 30));
    p = p.parentElement;
  }
  return {
    openState: doc.body.classList.contains('nav-open'),
    toggleRect: R(toggle),
    toggleExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
    drawerRect: open,
    drawerScrollH: side ? side.scrollHeight : null,
    drawerScrollTop: side ? side.scrollTop : null,
    drawerFontSize: side ? getComputedStyle(side).fontSize : null,
    linksInViewport: inViewport.length,
    linksTotal: links.length,
    firstInViewport: inViewport.slice(0, 3).map((a) => txt(a, 26)),
    filterRect: R(filter),
    filterFontSize: filter ? getComputedStyle(filter).fontSize : null,
    filterPlaceholder: filter ? filter.getAttribute('placeholder') : null,
    drawerTocSummary: R(q('#drawer-toc > summary, .side-toc > summary')),
    drawerTocOpen: q('#drawer-toc, .side-toc') ? !!q('#drawer-toc, .side-toc').open : null,
    sideSecs: R(q('.side-secs')),
    sideSecsItems: qa('.side-secs a').map((a) => txt(a, 16)),
    activeFound: !!active,
    activeRect: R(active),
    activeText: txt(active, 40),
    activeVisible: active ? (() => { const b = active.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; })() : null,
    collapsedAncestors,
    sidebarHasOwnCloseButton: !!qa('#sidebar button, .sidebar button').filter((b) => /关闭|close/i.test((b.getAttribute('aria-label') || '') + txt(b, 10))).length,
    scrimRect: R(scrim),
    scrimVisible: scrim ? getComputedStyle(scrim).visibility : null,
    bodyOverflow: getComputedStyle(doc.body).overflow,
    scrollYBefore: window.__probeScrollY || null,
    scrollYNow: window.scrollY,
    activeElement: doc.activeElement ? (doc.activeElement.tagName + '#' + (doc.activeElement.id || '') + '.' + (doc.activeElement.className || '')) : null,
    inert: side ? side.hasAttribute('inert') : null,
    nestedDetailCount: qa('#sidebar details').length,
    nestedDetailOpen: qa('#sidebar details[open]').length,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  if (WANT_SHOTS) fs.mkdirSync(SHOTDIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { generated_at: new Date().toISOString(), base: BASE, results: [] };
  const onlyVp = opt('vp', null);
  const onlyPage = opt('page', null);

  for (const vp of VIEWPORTS.filter((v) => !onlyVp || v.name === onlyVp)) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light',
    });
    const page = await ctx.newPage();
    for (const pg of PAGES.filter((x) => !onlyPage || x.url === onlyPage)) {
      try {
        await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(500);
        const m = await page.evaluate(PROBE);

        // 抽屉专项：滚动一半后再开，模拟真实阅读位置
        await page.evaluate(() => { window.__probeScrollY = Math.round(window.scrollY); });
        let drawer = null;
        const toggleExists = await page.$('#nav-toggle');
        if (toggleExists) {
          await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.4)));
          await page.waitForTimeout(250);
          await page.evaluate(() => { window.__probeScrollY = Math.round(window.scrollY); });
          await page.click('#nav-toggle');
          await page.waitForTimeout(350);
          drawer = await page.evaluate(DRAWER_PROBE);
          if (WANT_SHOTS && (vp.name === '390x844') && ['dialogs', 'world-config', 'all-pages'].includes(pg.name)) {
            await page.screenshot({ path: path.join(SHOTDIR, 'drawer-' + pg.name + '-' + vp.name + '.png') });
          }
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
          drawer.afterEsc = await page.evaluate(() => ({
            navOpen: document.body.classList.contains('nav-open'),
            activeElement: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
            inert: document.querySelector('#sidebar') ? document.querySelector('#sidebar').hasAttribute('inert') : null,
            bodyOverflow: getComputedStyle(document.body).overflow,
          }));
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(200);
        }

        out.results.push({ viewport: vp.name, page: pg.url, name: pg.name, measure: m, drawer });
        console.log('  ok ' + vp.name.padEnd(9) + pg.url.padEnd(40) + ' h=' + m.pageHeight + ' bodyStart@' + m.bodyStartY + 'px (' + m.bodyStartScreens + ' 屏)');
      } catch (e) {
        out.results.push({ viewport: vp.name, page: pg.url, name: pg.name, error: e.message.slice(0, 200) });
        console.log('  ERR ' + vp.name + ' ' + pg.url + ' ' + e.message.slice(0, 90));
      }
    }

    /* ---------- 关键区域截图（只看 390/320）---------- */
    if (WANT_SHOTS && (vp.width <= 390)) {
      const shots = [
        { page: '/paper/reference/world-configuration/', sel: '.article li li li li', name: 'wc-deep-li' },
        { page: '/paper/reference/permissions/', sel: '.table-wrap', name: 'perm-table' },
        { page: '/paper/dev/particles/', sel: '.code-block', name: 'particles-code' },
        { page: '/velocity/tuning/', sel: '.code-block', name: 'tuning-code' },
        { page: '/paper/dev/particles/', sel: '.article img', name: 'particles-image' },
        { page: '/all-pages.html', sel: 'table.allpages tbody tr', name: 'ap-row' },
        { page: '/all-pages.html', sel: '.filter-bar', name: 'ap-filter' },
        { page: '/paper/reference/world-configuration/', sel: '.pager', name: 'wc-pager' },
        { page: '/', sel: '.entry-cards', name: 'landing-cards' },
        { page: '/velocity/tuning/', sel: '.toc-side', name: 'tuning-toc' },
      ];
      for (const s of shots) {
        try {
          await page.goto(BASE + s.page, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(400);
          const el = await page.$(s.sel);
          if (!el) { console.log('    no el ' + s.name + ' ' + s.sel); continue; }
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await el.screenshot({ path: path.join(SHOTDIR, s.name + '-' + vp.name + '.png') });
        } catch (e) { console.log('    shot ERR ' + s.name + ': ' + e.message.slice(0, 70)); }
      }
    }
    await ctx.close();
  }
  await browser.close();

  const jsonOut = opt('json', null);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2), 'utf8');
  console.log('\n结果组数 ' + out.results.length + (jsonOut ? ' → ' + jsonOut : '') + (WANT_SHOTS ? '，区域截图 → ' + SHOTDIR : ''));
  console.log(JSON.stringify(out, null, 1).slice(0, 200));
})();
