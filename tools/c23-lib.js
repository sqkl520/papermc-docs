'use strict';
/**
 * c23-lib.js — C2/C3 预演共享装置（**纯只读**：不改 tools/site/**、assets/**、站点产物、package.json）
 *
 * 注入手段只有两种，均不落仓库：
 *   1) page.addStyleTag({content})    —— CSS 目标态
 *   2) page.route 内存改写 site.css / site.js 的响应体 —— 用来**逐字节等价地**预演批 3 的真实补丁
 *      （route.fulfill 只改内存中的响应，不写任何文件）
 *
 * 站点：http://127.0.0.1:8787（当前工作树 = 批 0 + 批 1）
 * 口径与 reports/b2-baseline.md §0.2 对齐，便于逐格对拍。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(require("os").tmpdir() || '.', 'c23');
fs.mkdirSync(TMP, { recursive: true });

const BASE = 'http://127.0.0.1:8787';

/* Chrome：不写字面盘符，全部由环境变量拼出 */
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1234', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* 6 页（与基线 A 组同一组页面；particles 为基线 E/C 组的第四张正文页） */
const PAGES = [
  { key: 'landing', path: '/', article: false },
  { key: 'paper', path: '/paper/', article: true },
  { key: 'dialogs', path: '/paper/dev/dialogs/', article: true },
  { key: 'worldcfg', path: '/paper/reference/world-configuration/', article: true },
  { key: 'tuning', path: '/velocity/tuning/', article: true },
  { key: 'allpages', path: '/all-pages.html', article: false },
];
const PAGE_BY_KEY = Object.fromEntries(PAGES.map((p) => [p.key, p]));

const VPS = [1440, 1280, 1200, 1100, 1025, 1024, 900, 768, 390, 320];

/* ------------------------------------------------------------------ *
 * 批 2：`.article p{max-width:40rem}`（只限叶段落，不碰 ul/ol/pre/table）
 * ------------------------------------------------------------------ */
const CSS_B2 = '.article p{max-width:40rem}';

/* ------------------------------------------------------------------ *
 * 批 3 目标态：侧栏常驻 + TOC 常驻**同绑 1200**
 *
 * 关键观察（决定了补丁为什么这么小）：
 *   ≥1200 时现状 CSS 已经是对的 —— @media(min-width:1024px) + @media(min-width:1025px)
 *   两条叠加后正好是 290px / 1fr / 250px。**需要动的只有 1024–1199 这段被"半激活"的区间**：
 *   把 1024 块里的列布局复原为移动端单栏。所以目标态注入只需一个 max-width:1199.98 的块。
 *   ≥1200 一条 !important 都不加 —— 也就不会掩盖任何"真实补丁没改到"的地方。
 * ------------------------------------------------------------------ */
const CSS_B3 = `
@media (max-width:1199.98px){
  .layout,.layout.has-toc{grid-template-columns:minmax(0,1fr)!important}
  .sidebar{position:fixed!important;left:0!important;width:min(88vw,320px)!important;
    height:calc(100dvh - var(--topbar-h))!important;max-height:none!important;
    transform:translateX(-102%)!important;transition:transform .18s ease!important;
    box-shadow:var(--shadow)!important;z-index:45!important;
    border-right:1px solid var(--border)!important;padding:.8rem .7rem 2rem!important;
    background:var(--bg-soft)!important;font-size:.88rem!important}
  body.nav-open .sidebar{transform:none!important}
  .nav-scrim,.side-secs,.sidebar-toggle{display:revert!important}
  .side-toc{display:block!important}
  .toc-side{display:block!important;position:sticky!important;top:var(--topbar-h)!important;
    order:1!important;margin:0 0 .75rem!important;border:1px solid var(--border)!important;
    border-radius:var(--radius)!important;background:var(--bg-soft)!important;
    max-height:none!important;overflow:visible!important;padding:0!important;
    font-size:.86rem!important;width:auto!important}
  .toc-side .toc-title{display:flex!important;align-items:center!important;gap:.4rem!important;
    min-height:48px!important;margin:0!important;padding:0 .75rem!important;cursor:pointer!important;
    list-style:none!important;font-weight:700!important;font-size:.78rem!important;
    text-transform:uppercase!important;letter-spacing:.06em!important;color:var(--fg-muted)!important}
  .toc-side a{display:flex!important;align-items:center!important;min-height:44px!important;padding:.1rem .45rem!important}
  .content{order:2!important}
}`;

/* ------------------------------------------------------------------ *
 * 批 3 的 JS 补丁（内存改写 site.js 的响应体，逐字节等价于真实补丁）
 *
 * ⚠️ 实测教训：JS 里**不是只有 syncTocOffset 一处**，而是 4 处硬编码，
 *    且写法各不相同（matchMedia 的字符串是 `'(min-width:1024px)'` —— 括号在引号内，
 *    所以按 `'min-width:1024px'`（引号紧贴）去替换会**静默全不命中**，
 *    只剩 innerWidth 那两条改成功 → 断点改了一半，症状是
 *    1025–1199 的 TOC 被 matchMedia('(min-width:1025px)') 强制展开成 static 大面板。
 *    ⇒ 这里统一用不带引号的 `min-width:NNNNpx` 做替换，覆盖全部 4 处。
 * ------------------------------------------------------------------ */
function patchSiteJs(src) {
  return src
    .replace(/min-width:1024px/g, 'min-width:1200px')
    .replace(/min-width:1025px/g, 'min-width:1200px')
    .replace(/window\.innerWidth >= 1025/g, 'window.innerWidth >= 1200')
    .replace(/window\.innerWidth < 1025/g, 'window.innerWidth < 1200');
}

/* 真实补丁的 CSS 版本（供 route 改写 site.css 做「逐字节等价」复核）。
   ⚠️ 两条实测教训（本脚本都踩过，写进报告）：
   1) **只把 1025 块搬到 1200 不够**。1024 块里还有 `.toc-side{display:none}` ——
      1024 块留在原地 → 1024–1199 变成「侧栏常驻 + TOC 彻底隐藏」，比现状更糟。
   2) **不能把整块 1024 连 `.content{max-width:1000px}` 一起搬到 1200**。
      那样 1024–1199 失去 1000px 封顶 → artW 涨到 1147.81，主台阶放大成 **−539px**，
      与「−340px / 1024 处 949」的裁决不符。
   ⇒ 正解：1024/1025 块整体搬到 1200，再**补一条 1024–1199 的 `.content` 补偿规则**。 */
function patchSiteCss(src) {
  return src
    .replace(/@media \(max-width:1024\.98px\)/g, '@media (max-width:1199.98px)')
    .replace(/@media \(min-width:1024px\)/g, '@media (min-width:1200px)')
    .replace(/@media \(min-width:1025px\)/g, '@media (min-width:1200px)')
    /* 补偿：保住 1024–1199 的 content 封顶（= 裁决里的 949 / −340） */
    + '\n/* [c23 patch] 保留 1024–1199 的 .content 封顶，维持 1024 处 artW=949 */'
    + '\n@media (min-width:1024px) and (max-width:1199.98px){'
    + '\n  .content{padding:1.4rem 1.6rem 3rem;max-width:1000px}'
    + '\n}\n';
}

/* 对照变体：连 content 封顶也一起搬到 1200（预期 −539、1024 处 972.8） */
function patchSiteCssNoCap(src) {
  return src
    .replace(/@media \(max-width:1024\.98px\)/g, '@media (max-width:1199.98px)')
    .replace(/@media \(min-width:1024px\)/g, '@media (min-width:1200px)')
    .replace(/@media \(min-width:1025px\)/g, '@media (min-width:1200px)');
}

/* 对照变体：把 content 封顶提到**全宽度**（消灭 1024 处残留的 −23px 台阶） */
function patchSiteCssCap0(src) {
  return patchSiteCss(src)
    + '\n/* [c23 cap0] 全宽度封顶：消灭 1023→1024 的残留 −23px */'
    + '\n.content{max-width:1000px}\n';
}

/* ------------------------------------------------------------------ *
 * 采集函数（page.evaluate 内运行；只依赖 DOM/CSSOM）
 * ------------------------------------------------------------------ */
const MEASURE_FN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);

  const article = q('article.article') || q('article');
  const content = q('main.content') || q('.content');
  const toc = q('.toc-side');
  const side = q('#sidebar') || q('.sidebar');
  const layout = q('.layout');

  const isProse = (el) => {
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const paras = article ? [...article.querySelectorAll('p')].filter(isProse) : [];

  /* '0' advance：canvas 实测（基线口径，不用 0.5em 近似） */
  const zeroCache = new Map();
  const zeroFor = (st) => {
    const key = st.fontSize + '|' + st.fontFamily;
    if (zeroCache.has(key)) return zeroCache.get(key);
    const cv = document.createElement('canvas').getContext('2d');
    cv.font = st.fontSize + ' ' + st.fontFamily;
    const w = cv.measureText('0').width;
    zeroCache.set(key, w);
    return w;
  };

  let gMaxLine = 0;
  let zeroW = null;
  let lefts = [];
  let leftsDirect = [];
  for (const p of paras) {
    const st = getComputedStyle(p);
    const rg = document.createRange();
    rg.selectNodeContents(p);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
    if (rects.length) gMaxLine = Math.max(gMaxLine, ...rects.map((r) => r.width));
    if (zeroW == null) zeroW = zeroFor(st);
    const lf = Math.round(p.getBoundingClientRect().left * 100) / 100;
    lefts.push(lf);
    /* 「左边缘对齐」的判据必须只取 **.article 的直接子段落**：
       嵌套段落（li>ul>li>p）带 list 缩进，天然有多档 left（worldcfg 5 档 / dialogs 4 档），
       这是页面既有的缩进结构，与 max-width 无关、改前改后逐档相同。
       基线报告里的 uniqLeftCount=1 说的就是这个「被限宽的直接子块」。 */
    if (p.parentElement && p.parentElement === article) leftsDirect.push(lf);
  }
  const uniqLeftCount = new Set(lefts).size;          /* 全部段落（含嵌套缩进，仅作参考） */
  const uniqLeftDirect = new Set(leftsDirect).size;   /* 直接子段落（对齐判据） */

  /* 代码块：**可见宽度 = 滚动容器的 clientWidth**（这才是「列宽」；
     pre 的 getBoundingClientRect().width 是**内容盒**，长代码会把它撑到 1155.59px，
     但它被 .code-scroll 裁住，视觉宽度仍是 847 —— 拿 pre 宽当列宽会误判成「代码块变宽了」）。
     同时记录 pre 内容宽，用于发现「代码块被压窄」。 */
  const pres = [...document.querySelectorAll('pre.code-pre')];
  const preW = pres.map((p) => p.getBoundingClientRect().width);
  const scrollerCw = pres.map((p) => (p.closest('.code-scroll') || p).clientWidth);
  const codeOverflow = pres.filter((p) => {
    const sc = p.closest('.code-scroll') || p;
    return sc.scrollWidth > sc.clientWidth + 1;
  }).length;
  const range = (a) => (a.length ? [Math.min(...a), Math.max(...a)] : null);
  const rr = (pair) => (pair ? [r2(pair[0]), r2(pair[1])] : null);

  const wrappers = [...document.querySelectorAll('.table-wrap')];
  const tableOverflow = wrappers.filter((w) => w.scrollWidth > w.clientWidth + 1).length;

  /* TOC 形态：rail / top-block / hidden */
  const tb = toc ? toc.getBoundingClientRect() : null;
  const tocVisible = !!(toc && cs(toc, 'display') !== 'none' && tb.width > 0);
  const ab = article ? article.getBoundingClientRect() : null;
  let tocMode = 'hidden';
  if (tocVisible) {
    if (tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2) tocMode = 'rail';
    else tocMode = 'top-block';
  }

  return {
    path: location.pathname,
    vw: window.innerWidth,
    artW: article ? r2(ab.width) : null,
    artClientW: article ? article.clientWidth : null,
    contentW: content ? r2(content.getBoundingClientRect().width) : null,
    contentMaxW: cs(content, 'maxWidth'),
    cols: cs(layout, 'gridTemplateColumns'),
    lineW: paras.length ? r2(gMaxLine) : null,
    lineCh: paras.length && zeroW > 0 ? Math.round(gMaxLine / zeroW) : null,
    zeroW: zeroW == null ? null : r2(zeroW),
    proseCount: paras.length,
    uniqLeftCount,
    uniqLeftDirect,
    codeBlocks: pres.length,
    codeOverflow,
    codePreW: rr(range(preW)),
    codeScrollCw: rr(range(scrollerCw)),
    tableBlocks: wrappers.length,
    tableOverflow,
    tocMode,
    tocW: tb ? r2(tb.width) : null,
    tocH: tb ? r2(tb.height) : null,
    sidePos: cs(side, 'position'),
    sideW: side ? r2(side.getBoundingClientRect().width) : null,
    pageHeight: document.documentElement.scrollHeight,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

/* 轻量版：断崖扫地只要列宽相关（快） */
const SCAN_FN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = q('article.article') || q('article');
  const content = q('main.content') || q('.content');
  const toc = q('.toc-side');
  const side = q('#sidebar') || q('.sidebar');
  const tb = toc ? toc.getBoundingClientRect() : null;
  const ab = art ? art.getBoundingClientRect() : null;
  const vis = !!(toc && cs(toc, 'display') !== 'none' && tb.width > 0);
  let mode = 'hidden';
  if (vis) {
    if (tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2) mode = 'rail';
    else mode = 'top-block';
  }
  const pres = [...document.querySelectorAll('pre.code-pre')];
  return {
    vw: window.innerWidth,
    artW: art ? r2(ab.width) : null,
    contentW: content ? r2(content.getBoundingClientRect().width) : null,
    cols: cs(q('.layout'), 'gridTemplateColumns'),
    tocMode: mode,
    tocW: tb ? r2(tb.width) : null,
    sidePos: cs(side, 'position'),
    sideW: side ? r2(side.getBoundingClientRect().width) : null,
    codePreWmax: pres.length ? r2(Math.max(...pres.map((p) => p.getBoundingClientRect().width))) : null,
    codeScrollCwmax: pres.length ? Math.max(...pres.map((p) => (p.closest('.code-scroll') || p).clientWidth)) : null,
    pageHeight: document.documentElement.scrollHeight,
    docScrollW: document.documentElement.scrollWidth,
  };
};

async function launch() {
  if (!EXE) throw new Error('no chrome executable found');
  return chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
}

async function newCtx(browser, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({
    viewport: { width: o.width || 1440, height: o.height || 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    bypassCSP: true,
  });
  /* jsPatch / cssPatch：内存改写响应体（等价预演真实补丁，不写盘） */
  if (o.jsPatch || o.cssPatch) {
    const cssFn = o.cssPatchFn || patchSiteCss;
    await ctx.route('**/assets/site.js', async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      if (o.jsPatch) body = patchSiteJs(body);
      return route.fulfill({ status: res.status(), headers: res.headers(), body });
    });
    await ctx.route('**/assets/site.css', async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      if (o.cssPatch) body = cssFn(body);
      return route.fulfill({ status: res.status(), headers: res.headers(), body });
    });
  }
  return ctx;
}

async function settle(page, frames) {
  const n = frames == null ? 1 : frames;
  await page.evaluate((k) => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= k) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n);
}

async function gotoPage(page, p, waitMs) {
  await page.goto(BASE + p.path, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(waitMs == null ? 120 : waitMs);
}

function save(name, obj) {
  const f = path.join(TMP, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 1), 'utf8');
  return f;
}
function saveText(name, text) {
  const f = path.join(TMP, name);
  fs.writeFileSync(f, text, 'utf8');
  return f;
}
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

module.exports = {
  ROOT, TMP, BASE, EXE, PAGES, PAGE_BY_KEY, VPS,
  CSS_B2, CSS_B3, patchSiteJs, patchSiteCss, patchSiteCssNoCap,
  MEASURE_FN, SCAN_FN, launch, newCtx, settle, gotoPage, save, saveText, r2,
};
