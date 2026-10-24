'use strict';
/**
 * critique-typo-p5.js — 行宽分布（避免单段采样偏差）+ 长页结构 + 列表缩进侵蚀
 *
 *  measure.json 的 typography.measure 只取「第一个长段落」，对 world-configuration 这类
 *  段落大多嵌在 <li> 里的页面会低估/高估。这里对每一页**全部**正文段落逐行量，
 *  给出 p50 / p90 / max 的 lineW、ch、cjk 分布。
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
  { name: '1280x800', width: 1280, height: 800, mobile: false },
  { name: '768x1024', width: 768, height: 1024, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '320x568', width: 320, height: 568, mobile: true },
];

const PROBE = () => {
  const out = {};
  const art = document.querySelector('.article');
  const root = art || document.querySelector('.content') || document.body;

  /* 字号与 zero 宽 */
  const pRef = root.querySelector('p') || document.body;
  const cs = getComputedStyle(pRef);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = cs.fontSize + ' ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const fsPx = parseFloat(cs.fontSize);
  out.basis = { fontSize: fsPx, zeroW: Math.round(zeroW * 100) / 100, chPx: Math.round(zeroW * 100) / 100, cjkPx: fsPx };

  /* 全部正文段落的逐行宽度 */
  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .code-block, .table-wrap, .toc-side, .sidebar, .pager, .page-footer')) return false;
    return (el.textContent || '').trim().length >= 60;
  };
  const paras = [...root.querySelectorAll('p')].filter(isProse);
  const lines = [];
  for (const p of paras) {
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1);
    const inLi = !!p.closest('li');
    for (const r of rects) lines.push({ w: r.width, inLi, tag: p.tagName.toLowerCase() });
  }
  const ws = lines.map((l) => l.w).sort((a, b) => a - b);
  const q = (arr, qq) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(qq * (arr.length - 1)))] : 0);
  out.lineDistribution = {
    nParagraphs: paras.length,
    nLines: ws.length,
    p50px: Math.round(q(ws, 0.5)),
    p90px: Math.round(q(ws, 0.9)),
    maxpx: Math.round(ws.length ? ws[ws.length - 1] : 0),
    /* ch（zero 宽口径） */
    p50ch: Math.round((q(ws, 0.5) / zeroW) * 10) / 10,
    p90ch: Math.round((q(ws, 0.9) / zeroW) * 10) / 10,
    maxch: Math.round(((ws.length ? ws[ws.length - 1] : 0) / zeroW) * 10) / 10,
    /* 全角字/行口径 */
    p50cjk: Math.round(q(ws, 0.5) / fsPx),
    p90cjk: Math.round(q(ws, 0.9) / fsPx),
    maxcjk: Math.round((ws.length ? ws[ws.length - 1] : 0) / fsPx),
    /* 是否受列表缩进影响 */
    liLines: lines.filter((l) => l.inLi).length,
    nonLiMaxpx: Math.round(Math.max(0, ...lines.filter((l) => !l.inLi).map((l) => l.w))),
  };

  /* 每段行宽是否触顶（达到容器上限）——衡量"真的用满了多宽" */
  out.overflowish = (() => {
    const over = lines.filter((l) => l.w > 900).length;
    return { linesOver900px: over, linesOver700px: lines.filter((l) => l.w > 700).length };
  })();

  /* 世界配置页结构：标题之外的视觉分隔手段 */
  out.structure = (() => {
    if (!art) return null;
    return {
      h1: art.querySelectorAll('h1').length,
      h2: art.querySelectorAll('h2').length,
      h3: art.querySelectorAll('h3').length,
      h4: art.querySelectorAll('h4').length,
      h5: art.querySelectorAll('h5').length,
      h6: art.querySelectorAll('h6').length,
      p: art.querySelectorAll('p').length,
      ul: art.querySelectorAll('ul').length,
      ol: art.querySelectorAll('ol').length,
      li: art.querySelectorAll('li').length,
      pre: art.querySelectorAll('pre').length,
      table: art.querySelectorAll('table').length,
      strong: art.querySelectorAll('strong,b').length,
      em: art.querySelectorAll('em,i').length,
      code: art.querySelectorAll('code').length,
      a: art.querySelectorAll('a[href]').length,
      hr: art.querySelectorAll('hr').length,
      blockquote: art.querySelectorAll('blockquote').length,
      details: art.querySelectorAll('details').length,
      dl: art.querySelectorAll('dl').length,
      dt: art.querySelectorAll('dt').length,
      /* 用加粗当伪标题的段落数（>60% 的文本是 strong 的短段落） */
      boldPseudoHeadings: [...art.querySelectorAll('p')].filter((p) => {
        const t = p.textContent.trim();
        if (!t || t.length > 60) return false;
        const s = p.querySelector('strong,b');
        return s && s.textContent.trim().length / t.length > 0.6;
      }).length,
      chars: (art.textContent || '').length,
      pageH: Math.round(document.documentElement.scrollHeight),
      artH: Math.round(art.getBoundingClientRect().height),
      /* 嵌套列表深度分布 */
      liDepth: (() => {
        const d = {};
        for (const li of art.querySelectorAll('li')) {
          let n = 0, e = li;
          while (e && e !== art) { if (e.tagName === 'LI') n++; e = e.parentElement; }
          d[n] = (d[n] || 0) + 1;
        }
        return d;
      })(),
      /* 列表容器实际左内边距（px） */
      ulPadLeft: (() => { const u = art.querySelector('ul'); return u ? getComputedStyle(u).paddingLeft : null; })(),
      ulPadLeftPx: (() => { const u = art.querySelector('ul'); return u ? Math.round(parseFloat(getComputedStyle(u).paddingLeft)) : null; })(),
    };
  })();

  /* 首屏：H1 与正文的绝对 y */
  out.fold = (() => {
    const pos = (el) => (el ? { y: Math.round(el.getBoundingClientRect().top + window.scrollY), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) } : null);
    const toc = document.querySelector('.toc-side');
    return {
      vh: window.innerHeight,
      vw: window.innerWidth,
      h1: pos(document.querySelector('.article h1') || document.querySelector('.hero h1')),
      firstProse: pos(paras[0]),
      toc: toc ? { ...pos(toc), display: getComputedStyle(toc).display, order: getComputedStyle(toc).order, open: document.querySelector('.toc-fold') ? document.querySelector('.toc-fold').hasAttribute('open') : null, items: toc.querySelectorAll('a').length } : null,
      contentOrder: document.querySelector('.content') ? getComputedStyle(document.querySelector('.content')).order : null,
    };
  })();
  return out;
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const res = { base: BASE, rows: [] };
  for (const vp of VPS) {
    for (const pg of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'light', isMobile: vp.mobile, hasTouch: vp.mobile });
      const page = await ctx.newPage();
      await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 30000 });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.waitForTimeout(180);
      const d = await page.evaluate(PROBE);
      res.rows.push({ vp: vp.name, page: pg.name, url: pg.url, ...d });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p5.json'), JSON.stringify(res, null, 1), 'utf8');

  /* 控制台速览 */
  console.log('vp        page                     p50ch p90ch maxch  p50cjk p90cjk maxcjk  liLines/total  H1y   proseY');
  for (const r of res.rows) {
    const L = r.lineDistribution;
    console.log(
      r.vp.padEnd(9) + r.page.padEnd(25) +
      String(L.p50ch).padStart(5) + String(L.p90ch).padStart(6) + String(L.maxch).padStart(6) +
      String(L.p50cjk).padStart(8) + String(L.p90cjk).padStart(7) + String(L.maxcjk).padStart(7) +
      String('  ' + L.liLines + '/' + L.nLines).padEnd(15) +
      String(r.fold.h1 ? r.fold.h1.y : '-').padStart(6) + String(r.fold.firstProse ? r.fold.firstProse.y : '-').padStart(8)
    );
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
