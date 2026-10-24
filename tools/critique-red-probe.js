'use strict';
/**
 * critique-red-probe.js — 红队复算器（只读，不改任何站点文件）
 *
 * 目的：把 ui-shots.js 的 measureCh（容器宽 ÷ 字号×0.5 的拉丁近似）与「真实行盒」对齐，
 *       并用 Range 逐字符测量真实每行汉字数/字符数/行盒宽。
 *
 * 用法：node tools/critique-red-probe.js [--url=http://127.0.0.1:8787]
 * 产出：reports/critique-red-probe.json
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const BASE = opt('url', 'http://127.0.0.1:8787');
const OUT = path.join('reports', 'critique-red-probe.json');

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, mobile: false },
  { name: '1280x800', width: 1280, height: 800, mobile: false },
  { name: '1100x800', width: 1100, height: 800, mobile: false },
  { name: '1025x800', width: 1025, height: 800, mobile: false },
  { name: '1024x800', width: 1024, height: 800, mobile: false },
  { name: '900x800', width: 900, height: 800, mobile: false },
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

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
void CJK; // 仅作文档用；真实正则内联进 PROBE（page.evaluate 不携带闭包）

const PROBE = ({ maxChars }) => {
  const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
  /** 真实行盒测量：对元素内前 N 个字符逐字取 rect，按行盒 top 分组 */
  const LINE_METRICS = (root, maxN) => {
    const lines = new Map();
    const skip = new Set(['SCRIPT', 'STYLE']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (skip.has(n.parentNode && n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n = 0;
    let stop = false;
    const range = document.createRange();
    while (!stop && walker.nextNode()) {
      const t = walker.currentNode;
      const s = t.nodeValue || '';
      for (let i = 0; i < s.length; i++) {
        if (n >= maxN) { stop = true; break; }
        const ch = s[i];
        if (ch === '\n' || ch === '\r' || ch === '\t') continue;
        range.setStart(t, i); range.setEnd(t, i + 1);
        const rects = range.getClientRects();
        n++;
        if (!rects.length) continue;
        const bb = rects[0];
        if (bb.width === 0 && bb.height === 0) continue;
        const key = Math.round(bb.top / 2) * 2;
        let e = lines.get(key);
        if (!e) { e = { top: key, chars: 0, cjk: 0, spaces: 0, left: bb.left, right: bb.right, w: 0 }; lines.set(key, e); }
        e.chars++;
        if (CJK.test(ch)) e.cjk++;
        if (ch === ' ') e.spaces++;
        e.left = Math.min(e.left, bb.left); e.right = Math.max(e.right, bb.right);
        e.w = e.right - e.left;
      }
    }
    const arr = [...lines.values()].sort((a, b) => a.top - b.top);
    arr.forEach((e, i) => { e.i = i; e.left = Math.round(e.left); e.right = Math.round(e.right); e.w = Math.round(e.w); });
    return arr;
  };

  const px = (v) => (v == null ? null : Math.round(parseFloat(v) * 100) / 100);
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; };

  const article = q('.article') || q('main');
  const ps = article ? [...article.querySelectorAll('p')] : [];
  const first = ps[0] || null;
  const fsBody = first ? parseFloat(cs(first, 'fontSize')) : null;
  const artW = article ? article.getBoundingClientRect().width : null;

  // ui-shots.js 原公式复算（拉丁近似）
  const measureChLatinApprox = first ? Math.round(artW / (fsBody * 0.5)) : null;
  // 中文等效：汉字 advance ≈ 1em
  const cjkChApprox = first ? Math.round(artW / fsBody) : null;

  // 真实行盒（真实数据，不是近似）
  const lineSample = article ? LINE_METRICS(article, maxChars) : [];
  const widths = lineSample.map((l) => l.w).sort((a, b) => a - b);
  const maxW = widths.length ? widths[widths.length - 1] : 0;
  const fullLines = lineSample.filter((l) => l.w >= maxW * 0.92 && l.chars > 4);
  const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

  // 正文段宽分布：article 内直接 p，看是否有窄列/宽列混排
  const pWidths = ps.slice(0, 40).map((p) => ({ cls: p.className || '', w: Math.round(p.getBoundingClientRect().width), fs: px(cs(p, 'fontSize')), t: (p.textContent || '').trim().slice(0, 48) }));
  const pWide = pWidths.filter((p) => p.w >= artW - 2).length;

  // 侧栏/目录/顶栏几何
  const side = q('.sidebar');
  const sideLinks = side ? [...side.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().height > 0) : [];
  const sideH = sideLinks.map((a) => Math.round(a.getBoundingClientRect().height));
  const toc = q('.toc-side');
  const tocLinks = toc ? [...toc.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().height > 0) : [];
  const tocH = tocLinks.map((a) => Math.round(a.getBoundingClientRect().height));

  // 交互目标命中区（<24px 视为过小）
  const smallTargets = qa('a[href],button,input,summary').filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return r.height < 24 || r.width < 24;
  }).length;
  const visibleTargets = qa('a[href],button,input,summary').filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;

  // 外链/零依赖审计
  const ext = {
    cssLinks: qa('link[href]').map((l) => l.getAttribute('href')).filter((h) => /^https?:|^\/\//i.test(h)),
    scripts: qa('script[src]').map((s) => s.getAttribute('src')).filter((h) => /^https?:|^\/\//i.test(h)),
    imgs: qa('img[src]').map((i) => i.getAttribute('src')).filter((h) => /^https?:|^\/\//i.test(h)),
    iframes: qa('iframe[src]').map((i) => i.getAttribute('src')).filter((h) => /^https?:|^\/\//i.test(h)),
    inlineScripts: qa('script:not([src])').length,
    fetchInHtml: /fetch\(|XMLHttpRequest|import\(/.test(document.documentElement.innerHTML),
  };

  // 代码块
  const pres = qa('.article pre, pre');
  const codeScroll = pres.filter((p) => p.scrollWidth > p.clientWidth + 1).length;

  // 语言占比（CJK 字符占非空白字符比例）
  const txt = article ? (article.innerText || '') : '';
  const nonWs = txt.replace(/\s+/g, '');
  const cjkCount = (nonWs.match(new RegExp(CJK.source, 'g')) || []).length;

  return {
    lang: document.documentElement.lang || null,
    pageHeight: Math.round(document.documentElement.scrollHeight),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    geometry: { topbar: R(q('.topbar')), sidebar: R(side), content: R(q('.content')), toc: R(toc), article: R(article) },
    contentMaxWidth: q('.content') ? cs(q('.content'), 'maxWidth') : null,
    gridColumns: q('.layout') ? cs(q('.layout'), 'gridTemplateColumns') : null,
    articleW: artW ? Math.round(artW) : null,
    firstP: first ? { cls: first.className || '', fs: fsBody, w: Math.round(first.getBoundingClientRect().width), lh: px(cs(first, 'lineHeight')), t: (first.textContent || '').trim().slice(0, 64) } : null,
    measureChLatinApprox,
    cjkChApprox,
    widthMeasured: {
      sampleChars: lineSample.reduce((a, l) => a + l.chars, 0),
      lines: lineSample.length,
      lineWidths: widths,
      maxLineW: maxW,
      medFullChars: median(fullLines.map((l) => l.chars)),
      medFullCJK: median(fullLines.map((l) => l.cjk)),
      medFullW: median(fullLines.map((l) => l.w)),
      fullLines: fullLines.map((l) => ({ i: l.i, w: l.w, chars: l.chars, cjk: l.cjk })),
      allLines: lineSample.map((l) => ({ i: l.i, w: l.w, chars: l.chars, cjk: l.cjk })),
    },
    paragraphWidths: { count: ps.length, fullWidth: pWide, sample: pWidths },
    sidebar: side ? { visible: cs(side, 'display') !== 'none' && side.getBoundingClientRect().width > 0, links: sideLinks.length, heights: { min: Math.min(...sideH), med: median(sideH), max: Math.max(...sideH) }, under24: sideH.filter((h) => h < 24).length } : null,
    toc: toc ? { visible: cs(toc, 'display') !== 'none' && toc.getBoundingClientRect().width > 0, links: tocLinks.length, heights: tocH.length ? { min: Math.min(...tocH), med: median(tocH), max: Math.max(...tocH) } : null } : null,
    targets: { visible: visibleTargets, under24: smallTargets },
    external: ext,
    code: { blocks: pres.length, horizontallyScrollable: codeScroll },
    langMix: { totalNonWs: nonWs.length, cjk: cjkCount, cjkRatio: nonWs.length ? Math.round((cjkCount / nonWs.length) * 1000) / 1000 : null },
    typography: {
      bodyFontSize: fsBody, bodyLineHeightRatio: first && fsBody ? Math.round((parseFloat(cs(first, 'lineHeight')) / fsBody) * 100) / 100 : null,
      bodyFontFamily: first ? cs(first, 'fontFamily') : null,
      h1: (() => { const h = article && article.querySelector('h1'); return h ? { fs: px(cs(h, 'fontSize')), w: cs(h, 'fontWeight') } : null; })(),
      h2: (() => { const h = article && article.querySelector('h2'); return h ? { fs: px(cs(h, 'fontSize')), w: cs(h, 'fontWeight'), mt: px(cs(h, 'marginTop')) } : null; })(),
      codeFontSize: pres[0] ? px(cs(pres[0], 'fontSize')) : null,
      codeLineHeight: pres[0] ? px(cs(pres[0], 'lineHeight')) : null,
      tableFontSize: (() => { const t = article && article.querySelector('.table-wrap table'); return t ? px(cs(t, 'fontSize')) : null; })(),
      mutedColor: (() => { const m = article && article.querySelector('.page-meta, .page-desc, .crumbs'); return m ? cs(m, 'color') : null; })(),
      bodyColor: first ? cs(first, 'color') : null,
      bgColor: cs(document.body, 'backgroundColor'),
    },
    media: { hoverNone: matchMedia('(hover:none)').matches, coarse: matchMedia('(pointer:coarse)').matches },
    headingAnchorOpacity: (() => { const a = article && article.querySelector('.heading-anchor'); return a ? cs(a, 'opacity') : null; })(),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome at ' + EXE); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const results = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: 'light' });
    const page = await ctx.newPage();
    for (const pg of PAGES) {
      try {
        await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(350);
        const m = await page.evaluate(PROBE, { maxChars: 4000 });
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, m });
        console.log('  ' + vp.name.padEnd(9) + pg.url.padEnd(42) + 'art=' + m.articleW + ' latCh=' + m.measureChLatinApprox + ' cjkCh=' + m.cjkChApprox + ' realCJK/line=' + m.widthMeasured.medFullCJK + ' realChars/line=' + m.widthMeasured.medFullChars + ' ovf=' + m.overflowX + ' sideMedH=' + (m.sidebar && m.sidebar.heights ? m.sidebar.heights.med : '-'));
      } catch (e) {
        console.log('  ERR ' + vp.name + ' ' + pg.url + ' ' + e.message.slice(0, 80));
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, error: e.message });
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, results }, null, 2), 'utf8');
  console.log('\n写出 ' + OUT + ' (' + results.length + ' 组)');
})();
