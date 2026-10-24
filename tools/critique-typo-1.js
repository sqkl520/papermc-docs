'use strict';
/**
 * critique-typo-1.js — 排版 / 可读性度量采集器（「排版与阅读体验锐评」专用，只读站点，不改任何站点文件）
 *
 * 产出（写到项目之外，避免污染别人的报告目录）：
 *   <out>.json   全部关键排版值的结构化导出（字号/行高/字重/字距/上下边距/颜色/对比度/行宽/垂直节奏…）
 *
 * 用法：
 *   node tools/critique-typo-1.js --theme=light --out="..\_typo-critique\measure-light.json"
 *   node tools/critique-typo-1.js --theme=dark  --out="..\_typo-critique\measure-dark.json"
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787');
const THEME = opt('theme', 'light');
const OUT = path.resolve(__dirname, '..', opt('out', path.join('..', '_typo-critique', 'measure-' + THEME + '.json')));

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, mobile: false },
  { name: '1280x800', width: 1280, height: 800, mobile: false },
  { name: '1024x768', width: 1024, height: 768, mobile: false },
  { name: '768x1024', width: 768, height: 1024, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '320x568', width: 320, height: 568, mobile: true },
];
const PAGES = [
  { url: '/', name: 'landing' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/paper/dev/dialogs/', name: 'content-dialogs' },
  { url: '/paper/reference/world-configuration/', name: 'reference-longpage' },
  { url: '/velocity/tuning/', name: 'content-tuning' },
  { url: '/all-pages.html', name: 'index-allpages' },
];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* ------------------------------------------------------------------ */
/* 页内采集：全部排版关键值                                             */
/* ------------------------------------------------------------------ */
const COLLECT = () => {
  const px = (v) => Math.round(parseFloat(v) * 100) / 100;
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 };
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const cr = (c1, c2) => { if (!c1 || !c2) return null; const L1 = lum(c1), L2 = lum(c2); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
  const effBg = (el) => { let n = el; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a >= 0.99) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const rgb = (c) => (c ? 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')' : null);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; };
  const q = (s, root) => (root || document).querySelector(s);
  const qa = (s, root) => Array.prototype.slice.call((root || document).querySelectorAll(s));
  const txt = (el, n) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n || 40) : null);

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d');
  const font = (el) => { const s = getComputedStyle(el); return s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; };
  const wOf = (el, str) => { ctx.font = font(el); return ctx.measureText(str).width; };

  /** 单元素排版快照 */
  const snap = (el, role) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const fg = parse(s.color), bg = effBg(el);
    const r = el.getBoundingClientRect();
    return {
      role: role, sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''),
      sample: txt(el, 34),
      size: px(s.fontSize), lh: px(s.lineHeight), lhRatio: s.lineHeight === 'normal' ? null : Math.round((parseFloat(s.lineHeight) / parseFloat(s.fontSize)) * 1000) / 1000,
      weight: s.fontWeight, spacing: s.letterSpacing, family: s.fontFamily.split(',')[0],
      color: s.color, bg: rgb(bg), contrast: cr(fg, bg),
      mT: px(s.marginTop), mB: px(s.marginBottom), pT: px(s.paddingTop), pL: px(s.paddingLeft),
      bB: s.borderBottomWidth, bL: s.borderLeftWidth,
      width: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y),
      transform: s.textTransform, align: s.textAlign, wrap: s.overflowWrap,
      deco: s.textDecorationLine, fontVariantNum: s.fontVariantNumeric, style: s.fontStyle,
    };
  };

  /** 行宽：内容列宽 / ch / 全角字数 / 实际墨迹宽度 */
  const measureOf = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const fs = parseFloat(s.fontSize);
    const inner = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    const chW = wOf(el, '0');
    const rects = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const rg = document.createRange();
    let n;
    while ((n = w.nextNode())) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      rg.selectNodeContents(n);
      const list = rg.getClientRects();
      for (let i = 0; i < list.length; i++) if (list[i].width > 1) rects.push({ w: list[i].width, t: Math.round(list[i].top) });
    }
    const byLine = {};
    rects.forEach((r) => { byLine[r.t] = Math.max(byLine[r.t] || 0, r.w); });
    const widths = Object.values(byLine).sort((a, b) => a - b);
    const pct = (p) => (widths.length ? Math.round(widths[Math.min(widths.length - 1, Math.floor((widths.length - 1) * p))]) : null);
    return {
      cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/)[0] || el.tagName.toLowerCase(),
      size: px(s.fontSize), lh: s.lineHeight === 'normal' ? null : px(s.lineHeight), lhRatio: s.lineHeight === 'normal' ? null : Math.round((parseFloat(s.lineHeight) / fs) * 1000) / 1000,
      weight: s.fontWeight, color: s.color, bg: rgb(effBg(el)), contrast: cr(parse(s.color), effBg(el)),
      mT: px(s.marginTop), mB: px(s.marginBottom),
      inner: Math.round(inner), chW: Math.round(chW * 100) / 100,
      chPerLine: Math.round((inner / chW) * 10) / 10,
      cjkPerLine: Math.round((inner / fs) * 10) / 10,
      lines: widths.length, inkMax: widths.length ? Math.round(widths[widths.length - 1]) : null,
      inkP90: pct(0.9), inkMedian: pct(0.5),
      text: txt(el, 46),
    };
  };

  const article = q('.article') || q('#main');
  const main = q('#main') || q('main');
  const layoutEl = q('.layout');
  const contentEl = q('.content') || main;
  const side = q('.sidebar');
  const toc = q('.toc-side');
  const topbar = q('.topbar');
  const cs = contentEl ? getComputedStyle(contentEl) : null;

  /* ---- 正文段落 ---- */
  const allP = qa('p', article).filter((p) => (p.textContent || '').trim().length > 60);
  const ps = allP.filter((p) => !/(page-meta|page-desc|pth|code-title|alert-title|external-image-note)/.test(p.className || '')).slice(0, 10);
  const paragraphs = allP.slice(0, 10).map(measureOf);
  const bodyP = ps[0] || allP[0];
  const pSizeCensus = {};
  allP.forEach((p) => { const s = getComputedStyle(p).fontSize; pSizeCensus[s] = (pSizeCensus[s] || 0) + 1; });

  /* ---- 标题阶梯 ---- */
  const heads = [];
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((tag) => {
    const list = qa(tag, article).slice(0, tag === 'h2' || tag === 'h3' ? 4 : 2);
    list.forEach((h) => heads.push(snap(h, tag)));
  });
  const h1 = q('h1', article) || q('h1');

  /* ---- 垂直节奏：article 内相邻块间距 ---- */
  const rhythm = [];
  if (article) {
    const kids = Array.prototype.slice.call(article.children).filter((el) => el.getBoundingClientRect().height > 0);
    for (let i = 1; i < kids.length && rhythm.length < 40; i++) {
      const a = kids[i - 1], b = kids[i];
      const sa = getComputedStyle(a), sb = getComputedStyle(b);
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      rhythm.push({
        prev: a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' && a.className ? '.' + a.className.split(/\s+/)[0] : ''),
        next: b.tagName.toLowerCase() + (b.className && typeof b.className === 'string' && b.className ? '.' + b.className.split(/\s+/)[0] : ''),
        gap: Math.round(rb.top - ra.bottom),
        prevMB: px(sa.marginBottom), nextMT: px(sb.marginTop),
      });
    }
  }

  /* ---- 强调手段用量 ---- */
  const articleHTML = article ? article.innerHTML.length : 0;
  const counts = {
    p: qa('p', article).length, li: qa('li', article).length, strong: qa('strong,b', article).length,
    em: qa('em,i', article).length, code: qa('code', article).length, a: qa('a', article).length,
    pre: qa('pre', article).length, table: qa('table', article).length, img: qa('img', article).length,
    blockquote: qa('blockquote', article).length, alert: qa('.alert', article).length,
    h2: qa('h2', article).length, h3: qa('h3', article).length, h4: qa('h4', article).length,
    h5: qa('h5', article).length, h6: qa('h6', article).length, hr: qa('hr', article).length,
  };
  const weightHist = {};
  if (article) qa('*', article).forEach((el) => { const w = getComputedStyle(el).fontWeight; weightHist[w] = (weightHist[w] || 0) + 1; });
  const sizeHist = {};
  qa('*', document.body).forEach((el) => { const s = getComputedStyle(el).fontSize; sizeHist[s] = (sizeHist[s] || 0) + 1; });

  /* ---- 等宽 / 数字 ---- */
  const pre = q('pre', article) || q('pre');
  const codeInline = q('p code', article) || q('code', article);
  const mono = {
    preFont: pre ? getComputedStyle(pre).fontFamily : null,
    preSize: pre ? px(getComputedStyle(pre).fontSize) : null,
    preLh: pre ? px(getComputedStyle(pre).lineHeight) : null,
    prePad: pre ? getComputedStyle(pre).padding : null,
    preScrollable: pre ? pre.scrollWidth > pre.clientWidth + 1 : null,
    preScrollW: pre ? pre.scrollWidth : null, preClientW: pre ? pre.clientWidth : null,
    preBg: pre ? getComputedStyle(pre).backgroundColor : null,
    inlineFont: codeInline ? getComputedStyle(codeInline).fontFamily : null,
    inlineSize: codeInline ? px(getComputedStyle(codeInline).fontSize) : null,
    inlineBg: codeInline ? getComputedStyle(codeInline).backgroundColor : null,
    inlineBorder: codeInline ? getComputedStyle(codeInline).borderTopWidth : null,
    inlineContrast: codeInline ? cr(parse(getComputedStyle(codeInline).color), effBg(codeInline)) : null,
    isMono: pre ? (function () { const acc = pre.querySelector('code') || pre; return Math.abs(wOf(acc, 'iiiii') - wOf(acc, 'MMMMM')) < 0.5; })() : null,
  };

  /* ---- 表格数字 ---- */
  const table = q('table', article);
  const tableInfo = table ? (function () {
    const th = q('th', table), td = qa('td', table)[0];
    const numCell = qa('td', table).find((c) => /^[\s0-9]/.test(c.textContent || ''));
    const f = numCell || td || th;
    return {
      size: td ? px(getComputedStyle(td).fontSize) : null,
      thSize: th ? px(getComputedStyle(th).fontSize) : null,
      thWeight: th ? getComputedStyle(th).fontWeight : null,
      thBg: th ? getComputedStyle(th).backgroundColor : null,
      thNowrap: th ? getComputedStyle(th).whiteSpace : null,
      align: f ? getComputedStyle(f).textAlign : null,
      variant: f ? getComputedStyle(f).fontVariantNumeric : null,
      tabular: f ? Math.abs(wOf(f, '11111') - wOf(f, '88888')) < 0.5 : null,
      digitW: f ? Math.round(wOf(f, '0') * 100) / 100 : null,
      family: f ? getComputedStyle(f).fontFamily.split(',')[0] : null,
      rows: qa('tr', table).length,
    };
  })() : null;

  /* ---- 颜色/对比度面板 ---- */
  const panels = [];
  const addPanel = (role, el) => { if (!el) return; const s = getComputedStyle(el); const bg = effBg(el); panels.push({ role: role, color: s.color, bg: rgb(bg), ratio: cr(parse(s.color), bg) }); };
  addPanel('body-text', bodyP || article);
  addPanel('body-bg-base', document.body);
  addPanel('h1', h1);
  addPanel('h2', q('h2', article));
  addPanel('h3', q('h3', article));
  addPanel('h4', q('h4', article));
  addPanel('h5', q('h5', article) || q('h6', article));
  addPanel('muted(.page-desc)', q('.page-desc'));
  addPanel('crumbs', q('.crumbs'));
  addPanel('chip', q('.chip, .page-meta .chip'));
  addPanel('toc-link', q('.toc-side a'));
  addPanel('sidebar-link', q('.sidebar a:not(.active)'));
  addPanel('sidebar-active', q('.sidebar a.active'));
  addPanel('inline-code', codeInline);
  addPanel('code-pre', pre);
  addPanel('hljs-comment', q('.hljs-comment', article));
  addPanel('hljs-keyword', q('.hljs-keyword', article));
  addPanel('hljs-string', q('.hljs-string', article));
  addPanel('hljs-number', q('.hljs-number', article));
  addPanel('hljs-title', q('.hljs-title', article));
  addPanel('alert-title', q('.alert-title', article));
  addPanel('alert-body', q('.alert-body p, .alert p', article));
  addPanel('table-td', qa('td', article)[0]);
  addPanel('table-th', q('th', article));
  addPanel('page-footer', q('.page-footer'));
  addPanel('pager-link', q('.pager a'));
  addPanel('crumb-zh', q('.crumb-zh'));
  addPanel('side-legend', q('.side-legend'));
  addPanel('stat-label', q('.stat span'));
  addPanel('entry-meta', q('.ec-meta'));
  addPanel('toc-title', q('.toc-side .toc-title'));
  addPanel('filter-input', q('.side-filter'));
  addPanel('kbd', q('kbd'));

  /* ---- 链接策略 ---- */
  const link = q('p a', article) || q('a', article);
  const links = {
    deco: link ? getComputedStyle(link).textDecorationLine : null,
    decoColor: link ? getComputedStyle(link).textDecorationColor : null,
    thickness: link ? getComputedStyle(link).textDecorationThickness : null,
    offset: link ? getComputedStyle(link).textUnderlineOffset : null,
    color: link ? getComputedStyle(link).color : null,
    weight: link ? getComputedStyle(link).fontWeight : null,
    externalAfter: link ? getComputedStyle(link, '::after').content : null,
    staleLinkBorder: (function () { const u = q('a.unmirrored', article); return u ? getComputedStyle(u).borderBottomStyle : null; })(),
  };

  /* ---- 中文排版细节 ---- */
  const cjk = article ? (function () {
    const s = getComputedStyle(article);
    return {
      overflowWrap: s.overflowWrap, wordBreak: s.wordBreak, lineBreak: s.lineBreak,
      hyphens: s.hyphens, textAlign: s.textAlign, letterSpacing: s.letterSpacing,
      textSpacingTrim: s.textSpacingTrim || 'n/a', textAutospace: s.textAutospace || 'n/a',
      fontKerning: s.fontKerning, textRendering: s.textRendering, widows: s.widows, orphans: s.orphans,
      locale: s.locale || 'n/a',
    };
  })() : null;

  /* ---- 列表 ---- */
  const ul = q('ul', article), li = q('li', article);
  const lists = ul ? {
    ulMT: px(getComputedStyle(ul).marginTop), ulMB: px(getComputedStyle(ul).marginBottom),
    padLeft: px(getComputedStyle(ul).paddingLeft), marker: q('li', article) ? getComputedStyle(q('li', article)).listStyleType : null,
    liMT: li ? px(getComputedStyle(li).marginTop) : null, liMB: li ? px(getComputedStyle(li).marginBottom) : null,
    liLh: li ? px(getComputedStyle(li).lineHeight) : null, liSize: li ? px(getComputedStyle(li).fontSize) : null,
    liInk: li ? measureOf(li) : null,
  } : null;

  /* ---- 引用/告警 ---- */
  const al = q('.alert', article), bq = q('blockquote', article);
  const alerts = (al || bq) ? {
    box: snap(al || bq, 'alert'), title: snap(q('.alert-title', article), 'alert-title'),
    bodyP: measureOf(q('.alert p, .alert-body p', article)),
    borderLeft: (function () { const e = al || bq; const s = getComputedStyle(e); return s.borderLeftWidth + ' ' + s.borderLeftColor; })(),
  } : null;

  /* ---- 首屏引导块顺序 ---- */
  const header = [];
  if (contentEl) {
    const walk = (root, depth) => {
      Array.prototype.slice.call(root.children).forEach((el) => {
        if (header.length > 12) return;
        const tag = el.tagName.toLowerCase();
        if (depth === 0 && /^(script|style|dialog|footer)$/.test(tag)) return;
        const r = el.getBoundingClientRect();
        if (r.height === 0) { if (depth < 2) walk(el, depth + 1); return; }
        header.push({ tag: tag, cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 2).join('.'), y: Math.round(r.top), h: Math.round(r.height), text: txt(el, 28) });
        if (depth < 1 && header.length < 9) walk(el, depth + 1);
      });
    };
    walk(contentEl, 0);
  }
  const chipsRow = q('.page-meta') || q('.chips');
  const chipInfo = chipsRow ? { count: qa('.chip, a.chip', chipsRow).length, box: box(chipsRow), items: qa('.chip, a.chip', chipsRow).map((c) => txt(c, 22)) } : null;
  const h1Order = h1 ? { h1Y: Math.round(h1.getBoundingClientRect().top), h1Size: px(getComputedStyle(h1).fontSize) } : null;

  /* ---- 长页导航锚点 ---- */
  const longPage = {
    pageHeight: Math.round(document.documentElement.scrollHeight),
    articleHeight: article ? Math.round(article.getBoundingClientRect().height) : null,
    h2: counts.h2, h3: counts.h3, h4: counts.h4, h5: counts.h5, h6: counts.h6,
    headingSpanPer1000px: counts.h2 ? Math.round((longPagePx() / counts.h2)) : null,
  };
  function longPagePx() { return Math.round(document.documentElement.scrollHeight); }
  const articleChars = article ? (article.textContent || '').replace(/\s+/g, '').length : 0;

  /* ---- 移动端首屏：TOC 是否把正文挤下去 ---- */
  const mobileToc = {
    tocBox: box(toc), tocVisible: !!(toc && getComputedStyle(toc).display !== 'none' && toc.getBoundingClientRect().height > 0),
    tocOpen: toc && toc.tagName === 'DETAILS' ? toc.hasAttribute('open') : null,
    tocItems: toc ? toc.querySelectorAll('a').length : 0,
    tocH: toc ? Math.round(toc.getBoundingClientRect().height) : 0,
    h1Y: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    articleY: article ? Math.round(article.getBoundingClientRect().top) : null,
    firstArticleTextY: (function () { const f = q('p', article) || q('h2,h3', article); return f ? Math.round(f.getBoundingClientRect().top) : null; })(),
  };

  /* ---- 字重/字号 统计 ---- */
  return {
    url: location.pathname, title: document.title, lang: document.documentElement.lang,
    vp: window.innerWidth + 'x' + window.innerHeight, dpr: window.devicePixelRatio,
    pageHeight: Math.round(document.documentElement.scrollHeight), articleChars: articleChars,
    layout: { layout: box(layoutEl), topbar: box(topbar), sidebar: box(side), toc: box(toc), content: box(contentEl), article: box(article) },
    contentBox: cs ? { maxWidth: cs.maxWidth, padL: px(cs.paddingLeft), padR: px(cs.paddingRight), width: Math.round(contentEl.getBoundingClientRect().width), cssW: contentEl.clientWidth } : null,
    typography: {
      body: snap(document.body, 'body'), p: snap(bodyP, 'p'), lead: snap(q('.page-desc', contentEl) || q('.hero-tag'), 'lead'),
      crumb: snap(q('.crumbs'), 'crumbs'), chip: snap(q('.chip'), 'chip'), tocLink: snap(q('.toc-side a'), 'toc-link'),
      sideLink: snap(q('.sidebar a:not(.active)'), 'side-link'), inlineCode: snap(codeInline, 'inline-code'),
      pre: snap(pre, 'pre'), table: snap(table, 'table'), footLink: snap(q('.page-footer a'), 'footer-link'),
      btn: snap(q('.tbtn'), 'topbar-btn'),
    },
    heads: heads, paragraphs: paragraphs, bodyP: measureOf(bodyP), pSizeCensus: pSizeCensus, h1Order: h1Order, header: header, chipInfo: chipInfo,
    rhythm: rhythm, counts: counts, weightHist: weightHist, sizeHist: sizeHist,
    mono: mono, tableInfo: tableInfo, panels: panels, links: links, cjk: cjk, lists: lists, alerts: alerts,
    longPage: longPage, mobileToc: mobileToc,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome exe'); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const results = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile,
      colorScheme: THEME === 'dark' ? 'dark' : 'light', locale: 'zh-CN',
    });
    const page = await ctx.newPage();
    for (const pg of PAGES) {
      try {
        await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(350);
        const m = await page.evaluate(COLLECT);
        // hover 下的链接下划线策略
        try {
          const l = await page.$('.article p a, .article a');
          if (l) { await l.hover({ timeout: 1500 }); await page.waitForTimeout(60); m.links.hoverDeco = await page.evaluate(() => { const e = document.querySelector('.article a:hover') || document.querySelector('.article a'); return e ? getComputedStyle(e).textDecorationLine : null; }); }
        } catch (e) { m.links.hoverDeco = 'n/a'; }
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, m: m });
        console.log('  ok ' + vp.name.padEnd(9) + pg.url.padEnd(42) + 'h=' + String(m.pageHeight).padEnd(6) + 'p=' + (m.bodyP ? m.bodyP.size + 'px/' + m.bodyP.lhRatio : '-') + ' measure=' + (m.bodyP ? m.bodyP.chPerLine + 'ch' : '-') + ' contentW=' + (m.contentBox ? m.contentBox.width : '-'));
      } catch (e) {
        console.log('  ERR ' + vp.name + ' ' + pg.url + ' :: ' + e.message.slice(0, 90));
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, error: e.message });
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, theme: THEME, results: results }, null, 2), 'utf8');
  console.log('\n写出 ' + OUT + '（' + results.filter((r) => !r.error).length + '/' + results.length + ' 组）');
})();
