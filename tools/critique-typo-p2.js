'use strict';
/**
 * critique-typo-p2.js — 第二轮自采度量
 *   A. 从 assets/site.css 解析 CSS 变量，构建 light / dark / auto-dark 三套令牌对比度矩阵（纯计算，无浏览器）
 *   B. 浏览器侧：h1..h6 注入探针阶梯、表格数字对齐、`Administration` 断行实测、深色非文本对比、首屏几何
 *
 * 用法：node tools/critique-typo-p2.js
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

/* ================= 颜色数学（Node 侧，与浏览器侧同口径） ================= */
const parseHex = (h) => {
  h = h.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
};
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
};

/* ================= A. 解析 CSS 令牌 ================= */
const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'site.css'), 'utf8');

function varsInBlock(block) {
  const out = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}
function blockAfter(marker) {
  const i = css.indexOf(marker);
  if (i < 0) return '';
  const j = css.indexOf('{', i);
  const k = css.indexOf('}', j);
  return css.slice(j + 1, k);
}
const lightVars = varsInBlock(blockAfter(':root{'));
const darkVars = Object.assign({}, lightVars, varsInBlock(blockAfter('html[data-theme="dark"]')));
const autoDarkVars = Object.assign({}, lightVars, varsInBlock(blockAfter('html[data-theme="auto"]{')));

/* hljs token 颜色（不走变量，需单独抓） */
const hljsLight = {};
const hljsDark = {};
for (const line of css.split('\n')) {
  let m = line.match(/^\.hljs-([a-z_,.\- ]+)\{color:(#[0-9a-fA-F]{3,6})/);
  if (m) { for (const t of m[1].split(',')) hljsLight[t.trim().replace(/^\.hljs-/, '')] = m[2]; }
  m = line.match(/^html\[data-theme="dark"\] \.hljs-([a-z_,.\- ]+)\{color:(#[0-9a-fA-F]{3,6})/);
  if (m) { for (const t of m[1].split(',')) hljsDark[t.trim().replace(/^\.hljs-/, '')] = m[2]; }
}

/* 令牌语义对：fg × bg 组合（正文 4.5 / 大字 3.0） */
const PAIRS = [
  ['--fg', '--bg', '正文 fg on bg', 4.5],
  ['--fg', '--bg-soft', '正文 fg on bg-soft', 4.5],
  ['--fg', '--bg-elev', '正文 fg on bg-elev（行内 code 底）', 4.5],
  ['--fg', '--code-bg', '正文 fg on code-bg', 4.5],
  ['--fg-muted', '--bg', '次要 fg-muted on bg', 4.5],
  ['--fg-muted', '--bg-soft', '次要 fg-muted on bg-soft（alert/chip 底）', 4.5],
  ['--fg-muted', '--bg-elev', '次要 fg-muted on bg-elev（code-title 底）', 4.5],
  ['--accent', '--bg', '链接 accent on bg', 4.5],
  ['--accent', '--bg-soft', '链接 accent on bg-soft', 4.5],
  ['--accent', '--accent-soft', 'active 项 accent on accent-soft', 4.5],
  ['--danger', '--bg', 'danger on bg', 4.5],
  ['--warning', '--bg', 'warning on bg', 4.5],
  ['--caution', '--bg', 'caution on bg', 4.5],
  ['--tip', '--bg', 'tip on bg', 4.5],
  ['--note', '--bg', 'note on bg', 4.5],
  ['--important', '--bg', 'important on bg', 4.5],
  ['--badge-fg', '--badge-note', '徽章字 on badge-note', 4.5],
  ['--badge-fg', '--badge-tip', '徽章字 on badge-tip', 4.5],
  ['--badge-fg', '--badge-important', '徽章字 on badge-important', 4.5],
  ['--badge-fg', '--badge-warning', '徽章字 on badge-warning', 4.5],
  ['--badge-fg', '--badge-caution', '徽章字 on badge-caution', 4.5],
  ['--badge-fg', '--badge-danger', '徽章字 on badge-danger', 4.5],
  ['--border', '--bg', '边框 border on bg（非文本 3:1）', 3],
  ['--border-strong', '--bg', '强边框 border-strong on bg（非文本 3:1）', 3],
  ['--border', '--bg-soft', '边框 border on bg-soft', 3],
  ['--border-strong', '--bg-soft', '强边框 border-strong on bg-soft', 3],
];

function matrix(vars, label) {
  const rows = [];
  for (const [f, b, name, thr] of PAIRS) {
    const fv = vars[f], bv = vars[b];
    if (!fv || !bv || !/^#/.test(fv) || !/^#/.test(bv)) { rows.push({ name, missing: true, fv, bv }); continue; }
    const r = ratio(parseHex(fv), parseHex(bv));
    rows.push({ name, fgVar: f, bgVar: b, fg: fv, bg: bv, ratio: r, threshold: thr, pass: r >= thr });
  }
  return { label, rows };
}

const tokenMatrix = {
  light: matrix(lightVars, 'light（data-theme=light 或 auto+系统浅色）'),
  dark: matrix(darkVars, 'dark（data-theme=dark）'),
  autoDark: matrix(autoDarkVars, 'auto + 系统深色（prefers-color-scheme:dark）'),
};

/* hljs token 矩阵：light 用 --code-bg，dark 用 --code-bg */
function hljsMatrix(vars, map, label) {
  const bg = parseHex(vars['--code-bg']);
  const rows = [];
  for (const k of Object.keys(map)) {
    const r = ratio(parseHex(map[k]), bg);
    rows.push({ token: 'hljs-' + k, fg: map[k], bg: vars['--code-bg'], ratio: r, threshold: 4.5, pass: r >= 4.5 });
  }
  return { label, rows };
}

/* ================= B. 浏览器侧 ================= */
const PROBE = () => {
  const out = {};
  const art = document.querySelector('.article');
  /* 探针宿主：优先 .article（拿到真实层叠）；落地页/清单页没有 .article，退回 .content/.hero/body */
  const host = art || document.querySelector('.content') || document.querySelector('main') || document.body;

  /* B1. 标题阶梯：注入探针（继承真实层叠） */
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px';
  host.appendChild(wrap);
  const ladder = {};
  for (let lv = 1; lv <= 6; lv++) {
    const h = document.createElement('h' + lv);
    h.textContent = 'Probe heading level ' + lv;
    wrap.appendChild(h);
  }
  const pRef = document.createElement('p');
  pRef.textContent = 'reference body paragraph';
  wrap.appendChild(pRef);
  for (let lv = 1; lv <= 6; lv++) {
    const h = wrap.querySelector('h' + lv);
    const cs = getComputedStyle(h);
    ladder['h' + lv] = {
      px: Math.round(parseFloat(cs.fontSize) * 100) / 100,
      rem: Math.round((parseFloat(cs.fontSize) / 16) * 1000) / 1000,
      weight: cs.fontWeight,
      lineHeightPx: cs.lineHeight === 'normal' ? null : Math.round(parseFloat(cs.lineHeight) * 100) / 100,
      lineHeightRatio: cs.lineHeight === 'normal' ? null : Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 100) / 100,
      marginTop: Math.round(parseFloat(cs.marginTop) * 100) / 100,
      marginBottom: Math.round(parseFloat(cs.marginBottom) * 100) / 100,
      color: cs.color,
      borderBottom: cs.borderBottomWidth === '0px' ? null : cs.borderBottomWidth + ' ' + cs.borderBottomColor,
    };
  }
  const bodyPx = parseFloat(getComputedStyle(pRef).fontSize);
  ladder.body = { px: bodyPx, lineHeightPx: Math.round(parseFloat(getComputedStyle(pRef).lineHeight) * 100) / 100, lineHeightRatio: Math.round((parseFloat(getComputedStyle(pRef).lineHeight) / bodyPx) * 100) / 100 };
  const ratios = {};
  for (let lv = 1; lv < 6; lv++) ratios['h' + lv + '/h' + (lv + 1)] = Math.round((ladder['h' + lv].px / ladder['h' + (lv + 1)].px) * 1000) / 1000;
  ratios['h1/body'] = Math.round((ladder.h1.px / bodyPx) * 1000) / 1000;
  ratios['h3/body'] = Math.round((ladder.h3.px / bodyPx) * 1000) / 1000;
  ratios['h4/body'] = Math.round((ladder.h4.px / bodyPx) * 1000) / 1000;
  ratios['h6/body'] = Math.round((ladder.h6.px / bodyPx) * 1000) / 1000;
  ladder.ratios = ratios;
  /* 实际站点里出现的标题尺寸 */
  ladder.actual = {};
  for (const sel of ['.hero h1', '.page-head h1', '.article h1', '.section-head h2', '.article h2', '.article h3', '.article h4', '.cat-block h3', '.card h3', '.entry-card .ec-title', '.hero-tag']) {
    const el = document.querySelector(sel);
    if (el) ladder.actual[sel] = { px: Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100, weight: getComputedStyle(el).fontWeight };
  }
  wrap.remove();
  out.ladder = ladder;

  /* B2. 表格数字是否等宽对齐（同一列内 '1' 与 '8' 宽度 / 首字符 x 是否一致） */
  out.tableDigits = (() => {
    const t = document.querySelector('.table-wrap table');
    if (!t) return null;
    const cvs = document.createElement('canvas').getContext('2d');
    const td = t.querySelector('td');
    const cs = getComputedStyle(td);
    cvs.font = cs.fontSize + ' ' + cs.fontFamily;
    const w1 = cvs.measureText('1').width, w8 = cvs.measureText('8').width;
    const cells = [...t.querySelectorAll('td')].filter((c) => /^\d+$/.test(c.textContent.trim()));
    const xs = cells.map((c) => Math.round(c.getBoundingClientRect().right * 10) / 10);
    return {
      fontVariantNumeric: cs.fontVariantNumeric,
      digit1W: Math.round(w1 * 100) / 100,
      digit8W: Math.round(w8 * 100) / 100,
      digitIsTabular: Math.abs(w1 - w8) < 0.01,
      numericCellCount: cells.length,
      rightEdgesDiffer: xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0,
    };
  })();

  /* B3. `Administration` 断行实测：找所有含该词的文本节点，看是否跨行 */
  const target = 'Administration';
  const brk = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const v = n.nodeValue || '';
    let idx = v.indexOf(target);
    while (idx >= 0) {
      const range = document.createRange();
      range.setStart(n, idx); range.setEnd(n, idx + target.length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1);
      const pel = n.parentElement;
      brk.push({
        lines: rects.length,
        broken: rects.length > 1,
        container: pel ? pel.tagName.toLowerCase() + (pel.className ? '.' + String(pel.className).trim().split(/\s+/).join('.') : '') : '?',
        rectWidths: rects.map((r) => Math.round(r.width)),
        overflowWrap: pel ? getComputedStyle(pel).overflowWrap : null,
        wordBreak: pel ? getComputedStyle(pel).wordBreak : null,
        containerW: pel ? Math.round(pel.getBoundingClientRect().width) : null,
      });
      idx = v.indexOf(target, idx + 1);
    }
  }
  out.administration = brk;

  /* B4. 深色下的非文本对比（边框/分隔线是否还看得见） */
  const parse = (s) => { const m = (s || '').match(/^rgba?\(([^)]+)\)$/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const R = (a, b) => Math.round(((Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05)) * 100) / 100;
  out.darkBorders = [['.article h2', 'H2 下边框', 'borderBottomColor'], ['.code-block', '代码块边框', 'borderTopColor'], ['.table-wrap', '表格外框', 'borderTopColor'], ['.alert', '提示框上边框', 'borderTopColor'], ['.crumbs .sep', '面包屑分隔符', 'color']].map(([sel, label, prop]) => {
    const el = document.querySelector(sel);
    if (!el) return { label, missing: true };
    const c = parse(getComputedStyle(el)[prop]);
    const bgc = parse(getComputedStyle(document.body).backgroundColor);
    return { label, color: getComputedStyle(el)[prop], bg: getComputedStyle(document.body).backgroundColor, ratio: R(c, bgc), threshold: 3, pass: R(c, bgc) >= 3 };
  });

  /* B5. 首屏几何（含 chips 面积占首屏比例） */
  const pos = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const meta = document.querySelector('.page-meta');
  out.fold = {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    topbar: pos('.topbar'),
    crumbs: pos('.crumbs'),
    h1: pos('.article h1'),
    h1ScrollY: (() => { const el = document.querySelector('.article h1'); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.top + window.scrollY); })(),
    pageDesc: pos('.page-desc'),
    pageMeta: pos('.page-meta'),
    chips: meta ? meta.querySelectorAll('.chip').length : 0,
    chipText: meta ? [...meta.querySelectorAll('.chip')].map((c) => c.textContent.trim()) : [],
    toc: pos('.toc-side'),
    tocAriaExpanded: (() => { const d = document.querySelector('.toc-fold'); return d ? d.hasAttribute('open') : null; })(),
    tocItems: document.querySelectorAll('.toc-side a').length,
    tocHeight: (() => { const t = document.querySelector('.toc-side'); return t ? Math.round(t.getBoundingClientRect().height) : 0; })(),
    firstProse: pos('.article > p:not(.page-desc):not(.page-meta)'),
    h1BelowViewportBy: (() => { const el = document.querySelector('.article h1'); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.top + window.scrollY) > window.innerHeight ? Math.round(r.top + window.scrollY) : 0; })(),
  };

  /* B6. 字体栈是否真的落到中文字体 & 中英混排间距（西文/中文之间是否加空格是内容层面，这里测字体 fallback） */
  out.fontStack = (() => {
    const p = document.querySelector('.article > p') || document.querySelector('.hero p') || document.querySelector('.content p') || document.body;
    const cs = getComputedStyle(p);
    const cvs = document.createElement('canvas').getContext('2d');
    cvs.font = cs.fontSize + ' ' + cs.fontFamily;
    return {
      family: cs.fontFamily,
      latinWidthM: Math.round(cvs.measureText('M').width * 100) / 100,
      cjkWidth信: Math.round(cvs.measureText('信').width * 100) / 100,
      cjkIsFullWidth: Math.abs(cvs.measureText('信').width - parseFloat(cs.fontSize)) < 1.2,
      fontSynthesis: cs.fontSynthesis,
      textRendering: cs.textRendering,
    };
  })();

  /* B7. 长页面结构：heading 密度 */
  out.structure = (() => {
    if (!art) return null;
    const txt = (art.textContent || '').length;
    return {
      chars: txt,
      h2: art.querySelectorAll('h2').length,
      h3: art.querySelectorAll('h3').length,
      h4: art.querySelectorAll('h4').length,
      p: art.querySelectorAll('p').length,
      pre: art.querySelectorAll('pre').length,
      table: art.querySelectorAll('table').length,
      ul: art.querySelectorAll('ul').length,
      li: art.querySelectorAll('li').length,
      img: art.querySelectorAll('img').length,
      strong: art.querySelectorAll('strong,b').length,
      charsPerHeading: (() => { const h = art.querySelectorAll('h2,h3,h4').length; return h ? Math.round(txt / h) : null; })(),
      scrollH: Math.round(document.documentElement.scrollHeight),
      articleH: Math.round(art.getBoundingClientRect().height),
    };
  })();

  /* B8. 滚动深度：一屏能读到多少字（估算首屏正文行数） */
  out.readingDensity = (() => {
    const vh = window.innerHeight;
    const p = document.querySelector('.article > p:not(.page-desc):not(.page-meta)');
    if (!p) return null;
    const cs = getComputedStyle(p);
    const lh = parseFloat(cs.lineHeight);
    const topOfProse = p.getBoundingClientRect().top + window.scrollY;
    return { linesAboveProse: Math.round(topOfProse / lh), proseStartsAtPx: Math.round(topOfProse), viewportH: vh, linesInFirstScreen: Math.max(0, Math.round((vh - 52) / lh)) };
  })();

  return out;
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const res = { base: BASE, tokenMatrix, hljsLight: hljsMatrix(lightVars, hljsLight, 'light'), hljsDark: hljsMatrix(darkVars, hljsDark, 'dark'), hljsAutoDark: hljsMatrix(autoDarkVars, hljsLight, 'auto+系统深色（注意：未命中 dark 选择器 → 用 light token）'), pages: {} };

  const PAGES = [
    { url: '/paper/dev/dialogs/', name: 'content-callout-code' },
    { url: '/paper/reference/world-configuration/', name: 'reference-longpage' },
    { url: '/velocity/tuning/', name: 'content-tuning' },
    { url: '/', name: 'landing' },
    { url: '/paper/', name: 'section-paper' },
    { url: '/all-pages.html', name: 'index-allpages' },
  ];
  const VPS = [
    { name: '1440x900', width: 1440, height: 900, mobile: false },
    { name: '390x844', width: 390, height: 844, mobile: true },
    { name: '320x568', width: 320, height: 568, mobile: true },
  ];

  for (const vp of VPS) {
    for (const pg of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'light', deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
      const page = await ctx.newPage();
      await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 30000 });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.waitForTimeout(200);
      const data = await page.evaluate(PROBE);
      res.pages[vp.name + ' ' + pg.name] = { url: pg.url, ...data };
      await ctx.close();
    }
  }

  /* 深色页（用于边框/暗色 token 实测） */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  res.pages['dark-1440 content'] = { url: '/paper/dev/dialogs/', ...(await page.evaluate(PROBE)) };
  await ctx.close();

  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p2.json'), JSON.stringify(res, null, 1), 'utf8');
  console.log('OK');
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
