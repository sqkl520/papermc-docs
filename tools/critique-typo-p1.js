'use strict';
/**
 * critique-typo-p1.js — 排版锐评专用自采度量（不修改站点，只读 DOM / 计算样式）
 *
 * 覆盖：
 *   A. 对比度（light / dark / auto+系统深色 三条路径），含 .hljs-* token、徽章、行内代码
 *   B. 字号阶梯（h1..h6 实测，注入探针元素，不依赖 CSS 文件推断）
 *   C. 垂直节奏（各块级元素实测 margin）
 *   D. 字重与强调手段清单
 *   E. 等宽/数字（pre、pre code、表格 tabular-nums）
 *   F. 首屏阅读引导（H1 y、TOC y、chips 相对位置）
 *   G. 断行实测（overflow-wrap:anywhere 是否切断英文单词）
 *   H. 候选行宽下的代码块/表格溢出测算
 *
 * 用法：node tools/critique-typo-p1.js > (stdout, JSON)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const VP = { width: 1440, height: 900 };

/* ============ 页面内执行：所有度量 ============ */
const PROBE = () => {
  const out = {};

  /* ---------- 颜色工具 ---------- */
  const parseColor = (s) => {
    if (!s) return null;
    s = s.trim();
    if (s === 'transparent') return [0, 0, 0, 0];
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = s.match(/^color\(srgb\s+([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
    }
    return null;
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100; };
  const hex = (c) => '#' + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  /** 从 html 一路复合到 el 的有效背景（含 alpha 合成） */
  const effBg = (el) => {
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    chain.push(document.documentElement);
    let acc = [255, 255, 255, 1];
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = parseColor(getComputedStyle(chain[i]).backgroundColor);
      if (c && c[3] > 0) acc = over(c, acc);
    }
    return acc;
  };

  const sample = (sel, label, opts) => {
    const el = document.querySelector(sel);
    if (!el) return { label, sel, missing: true };
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    const bg = effBg(el);
    const col = fg[3] < 1 ? over(fg, bg) : fg;
    const fs = parseFloat(cs.fontSize);
    const fw = parseInt(cs.fontWeight, 10) || 400;
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const r = ratio(col, bg);
    return {
      label, sel,
      fg: hex(col), bg: hex(bg),
      ratio: r,
      fontSize: Math.round(fs * 100) / 100,
      fontWeight: String(fw),
      threshold: large ? 3 : 4.5,
      pass: r >= (large ? 3 : 4.5),
      text: (el.textContent || '').trim().slice(0, 60),
    };
  };

  const article = document.querySelector('.article') || document.querySelector('main');

  /* ---------- A. 对比度样本 ---------- */
  const samples = [
    ['.article > p:not(.page-desc):not(.page-meta)', '正文段落'],
    ['.page-desc', '页面描述（次要）'],
    ['.crumbs a', '面包屑链接'],
    ['.crumbs span:not(.sep):not(.crumb-zh)', '面包屑当前项'],
    ['.article p a[href]', '正文链接'],
    ['.article p code', '行内代码'],
    ['.page-meta .chip', '元信息 chip'],
    ['.article h2', 'H2'],
    ['.article h3', 'H3'],
    ['.article blockquote', '引用块'],
    ['.alert-title', '提示框标题'],
    ['.code-title .code-lang', '代码语言徽标'],
    ['.code-title .code-file', '代码文件名'],
    ['.code-copy', '复制按钮'],
    ['.toc-side a', '右栏目录项'],
    ['.toc-side a.active', '右栏目录当前项'],
    ['.pager .pth', '翻页器路径'],
    ['.page-footer', '页脚'],
    ['.table-wrap td', '表格单元格'],
    ['.table-wrap thead th', '表格表头'],
    ['.article li', '列表项'],
    ['.heading-anchor', '标题锚点'],
    ['.article pre code', '代码正文'],
    ['.hljs-keyword', 'hljs keyword'],
    ['.hljs-string', 'hljs string'],
    ['.hljs-number', 'hljs number'],
    ['.hljs-title', 'hljs title'],
    ['.hljs-comment', 'hljs comment'],
    ['.hljs-built_in', 'hljs built_in'],
    ['.hljs-variable', 'hljs variable'],
    ['.hljs-attr', 'hljs attr'],
    ['.hljs-meta', 'hljs meta'],
  ];
  out.contrast = samples.map(([sel, label]) => sample(sel, label));

  /* 非文本对比（边框/焦点环，WCAG 1.4.11 ≥3:1） */
  const borderProbe = (sel, label, prop) => {
    const el = document.querySelector(sel);
    if (!el) return { label, missing: true };
    const cs = getComputedStyle(el);
    const c = parseColor(cs[prop]);
    if (!c) return { label, missing: true };
    const bg = effBg(el);
    const col = c[3] < 1 ? over(c, bg) : c;
    return { label, sel, color: hex(col), bg: hex(bg), ratio: ratio(col, bg), threshold: 3, pass: ratio(col, bg) >= 3 };
  };
  out.nonText = [
    borderProbe('.article h2', 'H2 下边框', 'borderBottomColor'),
    borderProbe('.code-block', '代码块边框', 'borderTopColor'),
    borderProbe('.table-wrap', '表格外框', 'borderTopColor'),
    borderProbe('.alert', '提示框左边框（note）', 'borderLeftColor'),
    borderProbe('.alert-warning', '提示框左边框（warning）', 'borderLeftColor'),
    borderProbe('.side-filter', '侧栏筛选框边框', 'borderTopColor'),
  ];

  /* ---------- B. 字号阶梯：注入探针 ---------- */
  const host = article || document.body;
  const probeWrap = document.createElement('div');
  probeWrap.setAttribute('data-probe', '1');
  probeWrap.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px';
  const scale = {};
  for (let lv = 1; lv <= 6; lv++) {
    const h = document.createElement('h' + lv);
    h.textContent = 'Probe ' + lv;
    probeWrap.appendChild(h);
    const p1 = document.createElement('p');
    p1.textContent = 'para after h' + lv;
    probeWrap.appendChild(p1);
  }
  const paraEl = document.createElement('p');
  paraEl.textContent = 'probe body paragraph';
  probeWrap.appendChild(paraEl);
  host.appendChild(probeWrap);
  for (let lv = 1; lv <= 6; lv++) {
    const h = probeWrap.querySelector('h' + lv);
    const cs = getComputedStyle(h);
    scale['h' + lv] = {
      size: Math.round(parseFloat(cs.fontSize) * 100) / 100,
      rem: Math.round((parseFloat(cs.fontSize) / 16) * 1000) / 1000,
      weight: cs.fontWeight,
      marginTop: Math.round(parseFloat(cs.marginTop) * 100) / 100,
      marginBottom: Math.round(parseFloat(cs.marginBottom) * 100) / 100,
      lineHeight: cs.lineHeight === 'normal' ? 'normal' : Math.round(parseFloat(cs.lineHeight) * 100) / 100,
      color: cs.color,
    };
  }
  scale.body = {
    size: parseFloat(getComputedStyle(paraEl).fontSize),
    lineHeight: parseFloat(getComputedStyle(paraEl).lineHeight),
    marginTop: parseFloat(getComputedStyle(paraEl).marginTop),
    marginBottom: parseFloat(getComputedStyle(paraEl).marginBottom),
  };
  /* 实际出现的标题尺寸（含 .page-head / .hero 变体） */
  scale.actual = {};
  for (const sel of ['.hero h1', '.page-head h1', '.article h1', '.section-head h2', '.section-head h2', '.article h2', '.cat-block h3', '.card h3']) {
    const el = document.querySelector(sel);
    if (el && !scale.actual[sel]) scale.actual[sel] = Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
  }
  scale.ratios = {};
  for (let lv = 1; lv < 6; lv++) {
    const a = scale['h' + lv].size, b = scale['h' + (lv + 1)].size;
    scale.ratios['h' + lv + '->h' + (lv + 1)] = b ? Math.round((a / b) * 1000) / 1000 : null;
  }
  scale.ratios['body->h6'] = Math.round((scale['h6'].size / scale.body.size) * 1000) / 1000;
  scale.ratios['body->h4'] = Math.round((scale['h4'].size / scale.body.size) * 1000) / 1000;
  probeWrap.remove();

  /* ---------- C. 垂直节奏 ---------- */
  const rhythm = {};
  const mm = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      marginTop: Math.round(parseFloat(cs.marginTop) * 100) / 100,
      marginBottom: Math.round(parseFloat(cs.marginBottom) * 100) / 100,
      paddingTop: Math.round(parseFloat(cs.paddingTop) * 100) / 100,
      paddingBottom: Math.round(parseFloat(cs.paddingBottom) * 100) / 100,
      lineHeight: cs.lineHeight === 'normal' ? 'normal' : Math.round(parseFloat(cs.lineHeight) * 100) / 100,
      fontSize: Math.round(parseFloat(cs.fontSize) * 100) / 100,
    };
  };
  rhythm.h1 = mm('.article h1');
  rhythm.h2 = mm('.article h2');
  rhythm.h3 = mm('.article h3');
  rhythm.h4 = mm('.article h4');
  rhythm.p = mm('.article > p:not(.page-desc):not(.page-meta)');
  rhythm.ul = mm('.article ul');
  rhythm.ol = mm('.article ol');
  rhythm.li = mm('.article li');
  rhythm.blockquote = mm('.article blockquote');
  rhythm.pre = mm('.code-pre');
  rhythm.codeBlock = mm('.code-block');
  rhythm.tableWrap = mm('.table-wrap');
  rhythm.alert = mm('.alert');
  rhythm.hr = mm('.article hr');
  rhythm.img = mm('.article img.content-img');
  rhythm.figure = mm('.article figure');
  /* 相邻块的实际间隙（H2 bottom→P top；P bottom→P top） */
  const gaps = {};
  const h2 = document.querySelector('.article h2');
  if (h2) {
    const next = h2.nextElementSibling;
    if (next) {
      const a = h2.getBoundingClientRect(), b = next.getBoundingClientRect();
      gaps.h2ToNext = Math.round((b.top - a.bottom) * 100) / 100;
      gaps.h2ToNextKind = next.tagName.toLowerCase();
    }
  }
  const ps = [...document.querySelectorAll('.article > p')].filter((p) => p.textContent.trim().length > 40);
  if (ps.length > 1) {
    gaps.pToP = Math.round((ps[1].getBoundingClientRect().top - ps[0].getBoundingClientRect().bottom) * 100) / 100;
  }
  out.rhythm = rhythm;
  out.gaps = gaps;

  /* ---------- D. 字重与强调 ---------- */
  const weights = {};
  let strongs = 0, ems = 0, codes = 0, links = 0, kbs = 0, marks = 0;
  if (article) {
    for (const el of article.querySelectorAll('*')) {
      const fw = getComputedStyle(el).fontWeight;
      weights[fw] = (weights[fw] || 0) + 1;
    }
    strongs = article.querySelectorAll('strong,b').length;
    ems = article.querySelectorAll('em,i').length;
    codes = article.querySelectorAll('code').length;
    links = article.querySelectorAll('a[href]').length;
    kbs = article.querySelectorAll('kbd').length;
    marks = article.querySelectorAll('mark').length;
  }
  out.weights = weights;
  out.emphasis = { strong: strongs, em: ems, code: codes, links, kbd: kbs, mark: marks };

  /* ---------- E. 等宽与数字 ---------- */
  const mono = {};
  const pre = document.querySelector('pre');
  if (pre) {
    const codeEl = pre.querySelector('code') || pre;
    const csP = getComputedStyle(pre), csC = getComputedStyle(codeEl);
    mono.pre = {
      fontFamily: csP.fontFamily, fontSize: parseFloat(csP.fontSize),
      lineHeight: Math.round(parseFloat(csP.lineHeight) * 100) / 100,
      lineHeightRatio: Math.round((parseFloat(csP.lineHeight) / parseFloat(csP.fontSize)) * 100) / 100,
      whiteSpace: csP.whiteSpace, tabSize: csP.tabSize,
      fontVariantNumeric: csP.fontVariantNumeric, fontFeatureSettings: csP.fontFeatureSettings,
    };
    mono.code = {
      fontSize: parseFloat(csC.fontSize),
      lineHeight: Math.round(parseFloat(csC.lineHeight) * 100) / 100,
      lineHeightRatio: Math.round((parseFloat(csC.lineHeight) / parseFloat(csC.fontSize)) * 100) / 100,
      emOfBody: Math.round((parseFloat(csC.fontSize) / 16) * 1000) / 1000,
    };
    const cvs = document.createElement('canvas').getContext('2d');
    cvs.font = csC.fontSize + ' ' + csC.fontFamily;
    mono.codeCharW = {
      zero: Math.round(cvs.measureText('0').width * 100) / 100,
      capM: Math.round(cvs.measureText('M').width * 100) / 100,
      space: Math.round(cvs.measureText(' ').width * 100) / 100,
      isMonospaced: Math.abs(cvs.measureText('i').width - cvs.measureText('W').width) < 0.01,
    };
  }
  const td = document.querySelector('.table-wrap td');
  if (td) {
    const cs = getComputedStyle(td);
    mono.table = {
      fontSize: parseFloat(cs.fontSize),
      fontVariantNumeric: cs.fontVariantNumeric,
      fontFeatureSettings: cs.fontFeatureSettings,
      fontFamily: cs.fontFamily,
    };
  }
  const numCell = document.querySelector('.table-wrap td.num, .stat b, .side-count, .filter-count');
  if (numCell) {
    const cs = getComputedStyle(numCell);
    mono.numEl = { sel: numCell.className, fontVariantNumeric: cs.fontVariantNumeric };
  }
  out.mono = mono;

  /* ---------- F. 首屏阅读引导 ---------- */
  const pos = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), yAbs: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  out.aboveFold = {
    topbar: pos('.topbar'),
    crumbs: pos('.crumbs'),
    h1: pos('.article h1') || pos('.hero h1'),
    pageDesc: pos('.page-desc'),
    pageMeta: pos('.page-meta'),
    toc: pos('.toc-side'),
    tocFirstItem: pos('.toc-side a'),
    firstProse: pos('.article > p:not(.page-desc):not(.page-meta)'),
    article: pos('.article'),
    viewportH: window.innerHeight,
  };
  /* DOM 顺序（H1 与 chips 谁先） */
  const order = [];
  const h1El = document.querySelector('.article h1') || document.querySelector('.hero h1');
  for (const sel of ['.crumbs', '.page-head', '.article h1', '.page-desc', '.page-meta', '.toc-side']) {
    const el = document.querySelector(sel);
    if (el && h1El) {
      const rel = el.compareDocumentPosition(h1El);
      order.push({ sel, beforeH1: !!(rel & Node.DOCUMENT_POSITION_FOLLOWING) ? false : !!(rel & Node.DOCUMENT_POSITION_PRECEDING) });
    }
  }
  out.domOrder = order;

  /* ---------- G. 断行实测：英文单词是否被切断 ---------- */
  const brokenWords = [];
  if (article) {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue;
      if (!/[A-Za-z]{6,}/.test(raw)) continue;
      const re = /[A-Za-z][A-Za-z'’\-]{5,}/g;
      let m;
      while ((m = re.exec(raw))) {
        const word = m[0];
        if (word.length < 8) continue;
        // 只在单词完整位于同一元素时测（跨 inline 元素的词另计）
        const range = document.createRange();
        try { range.setStart(node, m.index); range.setEnd(node, m.index + word.length); } catch (e) { continue; }
        const rects = [...range.getClientRects()].filter((r) => r.width > 1);
        if (rects.length > 1) {
          const parent = node.parentElement;
          brokenWords.push({
            word,
            lines: rects.length,
            container: parent ? (parent.tagName.toLowerCase() + (parent.className ? '.' + String(parent.className).split(/\s+/).join('.') : '')) : '?',
            context: raw.trim().slice(Math.max(0, m.index - 25), m.index + word.length + 25),
          });
        }
      }
    }
  }
  out.brokenWords = brokenWords.slice(0, 25);
  out.brokenCount = brokenWords.length;

  /* 行内 code 的 anywhere 风险：统计超长 token */
  out.longTokens = (() => {
    const res = [];
    if (!article) return res;
    for (const el of article.querySelectorAll('code, .chip, .pth, .src-rel')) {
      const t = (el.textContent || '').trim();
      if (t.length >= 18 && /^[A-Za-z0-9._/\-]+$/.test(t)) res.push({ tag: el.tagName.toLowerCase(), cls: el.className, len: t.length, t: t.slice(0, 50) });
    }
    return res.slice(0, 15);
  })();

  /* ---------- H. 候选行宽下的代码/表格溢出 ---------- */
  out.blockNaturals = (() => {
    const preW = [...document.querySelectorAll('.code-pre')].map((p) => {
      const inner = p.querySelector('code');
      return Math.round((inner ? Math.max(inner.scrollWidth, p.scrollWidth) : p.scrollWidth));
    });
    const tblW = [...document.querySelectorAll('.table-wrap table')].map((t) => Math.round(t.scrollWidth));
    return { preNaturalWidths: preW, tableNaturalWidths: tblW, maxPre: preW.length ? Math.max(...preW) : 0, maxTable: tblW.length ? Math.max(...tblW) : 0 };
  })();

  /* 正文列几何 */
  const contentEl = document.querySelector('.content');
  const artRect = article ? article.getBoundingClientRect() : null;
  out.geometry = {
    content: contentEl ? { w: Math.round(contentEl.getBoundingClientRect().width), padL: parseFloat(getComputedStyle(contentEl).paddingLeft), padR: parseFloat(getComputedStyle(contentEl).paddingRight), maxWidth: getComputedStyle(contentEl).maxWidth } : null,
    article: artRect ? { w: Math.round(artRect.width), x: Math.round(artRect.x) } : null,
    sidebarW: (document.querySelector('.sidebar') || {}).getBoundingClientRect ? Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) : 0,
    tocW: (document.querySelector('.toc-side') || {}).getBoundingClientRect ? Math.round(document.querySelector('.toc-side').getBoundingClientRect().width) : 0,
    viewportW: window.innerWidth,
  };
  /* 每页 zero 宽 → px/ch */
  const cvs2 = document.createElement('canvas').getContext('2d');
  const pStyle = article && article.querySelector('p') ? getComputedStyle(article.querySelector('p')) : getComputedStyle(document.body);
  cvs2.font = pStyle.fontSize + ' ' + pStyle.fontFamily;
  const zeroW = cvs2.measureText('0').width;
  out.geometry.zeroW = Math.round(zeroW * 100) / 100;
  out.geometry.pxPerCh = Math.round(zeroW * 100) / 100;
  out.geometry.chOfArticle = artRect ? Math.round((artRect.width / zeroW) * 10) / 10 : null;

  /* 列表嵌套缩进（窄屏吃字） */
  out.indent = (() => {
    const li = [...document.querySelectorAll('.article li p, .article li')].find((e) => (e.textContent || '').trim().length > 40);
    if (!li) return null;
    const r = li.getBoundingClientRect();
    return { tag: li.tagName.toLowerCase(), textW: Math.round(r.width), x: Math.round(r.x), depth: (() => { let d = 0, n = li; while (n && n !== article) { if (n.tagName === 'LI') d++; n = n.parentElement; } return d; })() };
  })();

  return out;
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const result = { browser: EXE.replace(/\\/g, '/').split('/').slice(-3).join('/'), base: BASE, pages: {} };

  const PAGES = [
    { url: '/paper/dev/dialogs/', name: 'content-callout-code' },
    { url: '/paper/reference/world-configuration/', name: 'reference-longpage' },
    { url: '/velocity/tuning/', name: 'content-tuning' },
    { url: '/', name: 'landing' },
    { url: '/all-pages.html', name: 'index-allpages' },
  ];

  async function open(url, colorScheme, themeAttr) {
    const ctx = await browser.newContext({ viewport: VP, colorScheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE + url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(250);
    if (themeAttr) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), themeAttr);
    await page.evaluate(() => { try { localStorage.removeItem('lcb-theme'); } catch (e) {} });
    await page.waitForTimeout(120);
    return { ctx, page };
  }

  /* 1) 三条主题路径的对比度（内容页） */
  const themes = [
    { key: 'light', colorScheme: 'light', attr: 'light' },
    { key: 'dark', colorScheme: 'dark', attr: 'dark' },
    { key: 'auto-dark', colorScheme: 'dark', attr: 'auto' },
  ];
  for (const t of themes) {
    const { ctx, page } = await open('/paper/dev/dialogs/', t.colorScheme, t.attr);
    const data = await page.evaluate(PROBE);
    result.pages['theme:' + t.key] = { url: '/paper/dev/dialogs/', themeAttr: await page.evaluate(() => document.documentElement.getAttribute('data-theme')), colorScheme: t.colorScheme, ...data };
    await ctx.close();
  }

  /* 2) 其余页面（light, 1440） */
  for (const pg of PAGES) {
    const { ctx, page } = await open(pg.url, 'light', 'light');
    const data = await page.evaluate(PROBE);
    const heights = await page.evaluate(() => ({ scrollH: Math.round(document.documentElement.scrollHeight), h2: document.querySelectorAll('.article h2').length, h3: document.querySelectorAll('.article h3').length, chars: (document.querySelector('.article') || {}).textContent ? document.querySelector('.article').textContent.length : 0 }));
    result.pages[pg.name] = { url: pg.url, ...data, heights };
    await ctx.close();
  }

  /* 3) 窄视口断行实测 320 / 390 */
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, colorScheme: 'light', deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.waitForTimeout(250);
    const data = await page.evaluate(PROBE);
    result.pages['vp' + w] = { url: '/paper/dev/dialogs/', width: w, ...data };
    await ctx.close();
  }

  /* 4) 候选行宽下的溢出测算（内容页，静态计算） */
  const { ctx: c2, page: p2 } = await open('/paper/dev/dialogs/', 'light', 'light');
  const nat = await p2.evaluate(() => {
    const g = getComputedStyle(document.querySelector('.content'));
    const zero = (() => { const c = document.createElement('canvas').getContext('2d'); const s = getComputedStyle(document.querySelector('.article p')); c.font = s.fontSize + ' ' + s.fontFamily; return c.measureText('0').width; })();
    const preW = [...document.querySelectorAll('.code-pre')].map((p) => { const i = p.querySelector('code'); return Math.round(i ? Math.max(i.scrollWidth, p.scrollWidth) : p.scrollWidth); });
    const tblW = [...document.querySelectorAll('.table-wrap table')].map((t) => Math.round(t.scrollWidth));
    return { pad: parseFloat(g.paddingLeft) + parseFloat(g.paddingRight), zero, preW, tblW };
  });
  const cands = [480, 518, 561, 570, 605, 647, 725, 780, 849, 948];
  result.widthCandidates = cands.map((px) => ({
    px,
    ch: Math.round((px / nat.zero) * 10) / 10,
    preOverflow: nat.preW.filter((w) => w > px).length,
    preTotal: nat.preW.length,
    tblOverflow: nat.tblW.filter((w) => w > px).length,
    tblTotal: nat.tblW.length,
  }));
  result.contentPad = nat.pad;
  await c2.close();

  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p1.json'), JSON.stringify(result, null, 1), 'utf8');
  console.log(JSON.stringify(result, null, 1));
})().catch((e) => { console.error('FAIL', e && e.stack || e); process.exit(1); });
