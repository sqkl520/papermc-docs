'use strict';
/**
 * ui-shots.js — 统一截图 + 度量采集器（供「文档界面锐评」的各 Agent 共用同一批证据）。
 *
 * 产出：
 *   reports/ui-shots/<vp>/<page>.full.png     整页截图（full page）
 *   reports/ui-shots/<vp>/<page>.fold.png     首屏（above the fold）
 *   reports/ui-shots/measure.json             结构化度量（排版/间距/颜色/几何/交互元素）
 *   reports/ui-shots/index.md                 图目录（便于锐评 Agent 引用）
 *
 * 用法：
 *   node tools/ui-shots.js                       # 全部视口 × 全部页面
 *   node tools/ui-shots.js --vp=1280x800         # 单个视口
 *   node tools/ui-shots.js --page=/velocity/tuning/
 *   node tools/ui-shots.js --url=http://127.0.0.1:8787 --dark
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787');
const DARK = argv.includes('--dark');
const OUT = opt('out', path.join('reports', 'ui-shots'));

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, mobile: false },
  { name: '1280x800', width: 1280, height: 800, mobile: false },
  { name: '768x1024', width: 768, height: 1024, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '320x568', width: 320, height: 568, mobile: true },
];
const PAGES = [
  { url: '/', name: 'landing' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/paper/dev/dialogs/', name: 'content-callout-code' },
  { url: '/paper/reference/world-configuration/', name: 'reference-longpage' },
  { url: '/velocity/tuning/', name: 'content-tuning' },
  { url: '/all-pages.html', name: 'index-allpages' },
];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/** 采集排版/结构度量 */
const MEASURE = () => {
  const px = (v) => Math.round(parseFloat(v) * 100) / 100;
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; };
  const q = (s) => document.querySelector(s);

  const article = q('.article') || q('main');
  const p = article && article.querySelector('p');
  const h2 = article && article.querySelector('h2');
  const pre = q('pre');
  const side = q('.sidebar');
  const toc = q('.toc-side');
  const topbar = q('.topbar');

  // 阅读行宽（measure）—— v2：用 Range 实测真实行盒，而不是"容器宽 / (字号×0.5)"的拉丁近似。
  // 另外：正文段落必须排除 .page-meta / .page-desc / .hero-tag 等"前缀段落"，
  // 否则会把 12.48px 的 chips 元信息条误当成正文（红队指出旧版的 8 条误读全部源自这里）。
  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item')) return false;
    if (el.className && /page-meta|page-desc|hero-tag/.test(el.className)) return false;
    return (el.textContent || '').trim().length >= 40;      // 真正的正文段落足够长
  };
  const proseP = article ? [...article.querySelectorAll('p')].find(isProse) : null;
  const proseParas = article ? [...article.querySelectorAll('p')].filter(isProse) : [];

  /** 用 Range 测量真实行盒；同时给出「容器容量」与「实际最长行」两种 ch 口径 */
  const measureOf = (el) => {
    if (!el) return null;
    const style = getComputedStyle(el);
    const fsPx = parseFloat(style.fontSize);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1);
    if (!rects.length) return null;
    // 实际最长行（末词不满行，故通常略小于容器）
    const lineW = Math.max(...rects.map((r) => r.width));
    // 容器内容宽（= 一行最多能放多宽的文字）
    const elBox = el.getBoundingClientRect();
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const capW = Math.max(elBox.width - padL - padR, lineW);
    // '0' 的 advance：用 canvas 在同一字体下量（拉丁字符计量的标准做法）
    const cvs = document.createElement('canvas').getContext('2d');
    cvs.font = style.fontSize + ' ' + style.fontFamily;
    const zeroW = cvs.measureText('0').width;
    const chOf = (w) => (zeroW > 0 ? Math.round(w / zeroW) : null);
    return {
      lineW: Math.round(lineW),
      capW: Math.round(capW),
      zeroW: Math.round(zeroW * 100) / 100,
      ch: chOf(capW),          // 主口径：容器一行容量（决定 max-width 该设多少）
      chText: chOf(lineW),     // 参考：实际最长行
      cjk: Math.round(capW / fsPx),   // 全角字/行
      lines: rects.length,
      fontSize: fsPx,
      lineHeight: parseFloat(style.lineHeight),
    };
  };
  const measureCh = measureOf(proseP);

  const linkSel = 'a:not([href^="#"])';
  const linksInArticle = article ? article.querySelectorAll(linkSel).length : 0;
  const imgs = article ? [...article.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src') || '', w: i.naturalWidth, h: i.naturalHeight, dw: Math.round(i.getBoundingClientRect().width), hasDims: i.hasAttribute('width') && i.hasAttribute('height') })) : [];

  return {
    title: document.title,
    lang: document.documentElement.lang || null,
    theme: document.documentElement.getAttribute('data-theme'),
    pageHeight: Math.round(document.documentElement.scrollHeight),
    // 布局栏
    layout: { topbar: box(topbar), sidebar: box(side), toc: box(toc), article: box(article) },
    topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
    sidebarVisible: side ? cs(side, 'display') !== 'none' && side.getBoundingClientRect().width > 0 : false,
    tocVisible: toc ? cs(toc, 'display') !== 'none' && toc.getBoundingClientRect().width > 0 : false,
    // 排版
    typography: {
      // 正文基准一律取"真正的正文段落"（proseP），而不是页面上第一个 <p>
      bodyFontFamily: proseP ? cs(proseP, 'fontFamily') : null,
      bodyFontSize: proseP ? px(cs(proseP, 'fontSize')) : null,
      bodyLineHeight: proseP ? px(cs(proseP, 'lineHeight')) : null,
      bodyColor: proseP ? cs(proseP, 'color') : null,
      bgColor: cs(document.body, 'backgroundColor'),
      h1: h2 ? null : (article && article.querySelector('h1') ? { size: px(cs(article.querySelector('h1'), 'fontSize')), weight: cs(article.querySelector('h1'), 'fontWeight'), marginBottom: px(cs(article.querySelector('h1'), 'marginBottom')) } : null),
      h2: h2 ? { size: px(cs(h2, 'fontSize')), weight: cs(h2, 'fontWeight'), marginTop: px(cs(h2, 'marginTop')), marginBottom: px(cs(h2, 'marginBottom')) } : null,
      pMarginBottom: proseP ? px(cs(proseP, 'marginBottom')) : null,
      measure: measureCh,                       // { lineW, zeroW, ch, cjk, lines, fontSize, lineHeight }
      measureCh: measureCh ? measureCh.ch : null,   // 兼容旧字段：真实 ch/行
      proseParagraphs: proseParas.length,
      maxWidth: article ? px(cs(article, 'maxWidth')) : null,
    },
    headingScale: (() => {
      const out = {};
      for (const lv of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        const el = article && article.querySelector(lv);
        if (el) out[lv] = { size: px(cs(el, 'fontSize')), weight: cs(el, 'fontWeight'), marginTop: px(cs(el, 'marginTop')), marginBottom: px(cs(el, 'marginBottom')) };
      }
      out.counts = { h2: article ? article.querySelectorAll('h2').length : 0, h3: article ? article.querySelectorAll('h3').length : 0, h4: article ? article.querySelectorAll('h4').length : 0 };
      return out;
    })(),
    imagesNoDims: imgs.filter((i) => !i.hasDims).length,
    codeBlock: pre ? {
      fontFamily: cs(pre, 'fontFamily'), fontSize: px(cs(pre, 'fontSize')), lineHeight: px(cs(pre, 'lineHeight')),
      bg: cs(pre, 'backgroundColor'), padding: cs(pre, 'padding'), radius: cs(pre, 'borderRadius'),
      overflowX: cs(pre, 'overflowX'), scrollW: pre.scrollWidth, clientW: pre.clientWidth,
      hasCopyBtn: !!document.querySelector('.code-copy, [data-copy], .copy-btn'),
      hasLangLabel: !!document.querySelector('.code-lang, [data-lang]'),
      hasLineNumbers: !!document.querySelector('.code-ln, .line-number, .linenums'),
      scrollable: pre.scrollWidth > pre.clientWidth + 1,
      focusable: pre.getAttribute('tabindex') === '0' || !!pre.closest('[tabindex="0"]'),
    } : null,
    toc: toc ? { items: toc.querySelectorAll('a').length, firstItem: (toc.querySelector('a') || {}).textContent || null } : null,
    sidebar: side ? { links: side.querySelectorAll('a').length, groups: side.querySelectorAll('details').length, hasFilter: !!q('#side-filter') } : null,
    search: { hasDialog: !!q('#search-dialog'), hasInput: !!q('#search-input'), hasShortcutHint: !!document.querySelector('[class*=hint], kbd') },
    interactive: {
      links: document.querySelectorAll('a').length,
      buttons: document.querySelectorAll('button').length,
      articleLinks: linksInArticle,
      images: imgs.length,
      tables: (article ? article.querySelectorAll('table').length : 0),
      callouts: (article ? article.querySelectorAll('blockquote').length : 0),
      details: (article ? article.querySelectorAll('details').length : 0),
    },
    a11y: {
      h1Count: document.querySelectorAll('h1').length,
      imgsWithoutAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt') || i.getAttribute('alt') === '').length,
      landmarks: { header: !!q('header'), nav: !!q('nav'), main: !!q('main'), aside: !!q('aside'), footer: !!q('footer') },
      skipLink: !!q('a.skip, .skip'),
      ariaCurrent: document.querySelectorAll('[aria-current]').length,
      focusables: document.querySelectorAll('a[href], button, input, select, textarea, [tabindex="0"]').length,
    },
    images: imgs.slice(0, 12),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const onlyVp = opt('vp', null);
  const onlyPage = opt('page', null);
  const results = [];
  const dirs = [];

  for (const vp of VIEWPORTS.filter((v) => !onlyVp || v.name === onlyVp)) {
    const dir = path.join(OUT, vp.name);
    fs.mkdirSync(dir, { recursive: true });
    dirs.push(vp.name);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: DARK ? 'dark' : 'light' });
    const page = await ctx.newPage();
    for (const pg of PAGES.filter((x) => !onlyPage || x.url === onlyPage)) {
      try {
        await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(600);
        const m = await page.evaluate(MEASURE);
        await page.screenshot({ path: path.join(dir, pg.name + '.fold.png'), fullPage: false });
        await page.screenshot({ path: path.join(dir, pg.name + '.full.png'), fullPage: true });
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, measure: m });
        console.log('  ' + vp.name.padEnd(9) + pg.url.padEnd(44) + 'h=' + m.pageHeight + ' measure=' + m.typography.measureCh + 'ch sidebar=' + m.sidebarVisible + ' toc=' + m.tocVisible);
      } catch (e) {
        console.log('  ERR ' + vp.name + ' ' + pg.url + ' ' + e.message.slice(0, 70));
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, error: e.message });
      }
    }
    await ctx.close();
  }
  await browser.close();

  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, dark: DARK, results }, null, 2), 'utf8');

  // 图片目录
  const lines = ['# UI 截图目录（ui-shots）', '', '> 由 `tools/ui-shots.js` 生成。视口：' + dirs.join(' / ') + '；主题：' + (DARK ? 'dark' : 'light') + '。', '', '| 视口 | 页面 | 首屏 | 整页 | 度量 |', '|---|---|---|---|---|'];
  for (const r of results) {
    if (r.error) { lines.push('| ' + r.viewport + ' | ' + r.page + ' | ERR | ERR | ' + r.error.slice(0, 40) + ' |'); continue; }
    lines.push('| ' + r.viewport + ' | `' + r.page + '` | [' + r.name + '.fold.png](' + r.viewport + '/' + r.name + '.fold.png) | [' + r.name + '.full.png](' + r.viewport + '/' + r.name + '.full.png) | 见 measure.json |');
  }
  lines.push('', '## 快速度量（' + results.length + ' 组）');
  lines.push('', '| 视口 | 页面 | 页高 | 正文行宽(ch) | 正文字号 | 侧栏 | 本页目录 | 代码块 |', '|---|---|---|---|---|---|---|---|');
  for (const r of results.filter((x) => !x.error)) {
    const m = r.measure;
    lines.push('| ' + r.viewport + ' | `' + r.page + '` | ' + m.pageHeight + ' | ' + (m.typography.measureCh || '-') + ' | ' + (m.typography.bodyFontSize || '-') + 'px | ' + (m.sidebarVisible ? '有' : '无') + ' | ' + (m.tocVisible ? '有(' + (m.toc ? m.toc.items : 0) + ')' : '无') + ' | ' + (m.codeBlock ? (m.codeBlock.fontSize + 'px/' + (m.codeBlock.scrollable ? '可横滚' : '不滚')) : '无') + ' |');
  }
  fs.writeFileSync(path.join(OUT, 'index.md'), lines.join('\n') + '\n', 'utf8');
  console.log('\n写出 ' + OUT + '/ （' + results.length + ' 组截图 + measure.json + index.md）');
})();
