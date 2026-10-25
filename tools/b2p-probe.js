'use strict';
/**
 * b2p-probe.js — 批 2（阅读列宽 40rem）只读预演探针
 *
 * 只读站点（8787 改后）。不改任何源码/产物；结果写 <TEMP>\b2p\probe.json。
 *
 * 三个变体，同进程同视口同页面：
 *   base   = as-built（HEAD f3ebbfc 的构建产物）
 *   A      = 只加 `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}`（addStyleTag）
 *   A1200  = A + 模拟「TOC 断点 1025→1200」：在 <1200 视口注入
 *            `.layout.has-toc{grid-template-columns:290px minmax(0,1fr)}` + `.toc-side{display:none}`
 *            （>=1200 视口不注入：现状与目标态一致）
 *
 * 量：article.w/x、正文 Range 实测行宽与 ch、代码块横滚计数、横向溢出、pageHeight、h1 y。
 * 用法: node tools/b2p-probe.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(require("os").tmpdir() || '.', 'b2p');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const BASE = 'http://127.0.0.1:8787';

const PAGES = [
  ['dialogs', '/paper/dev/dialogs/'],
  ['particles', '/paper/dev/particles/'],
  ['tuning', '/velocity/tuning/'],
  ['worldcfg', '/paper/reference/world-configuration/'],
  ['landing', '/'],
  ['allpages', '/all-pages.html'],
];
const VPS = [
  [1024, 800], [1025, 800], [1100, 800], [1200, 800], [1279, 800], [1280, 800], [1440, 900], [1920, 1080],
];

const CSS_A = `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}`;
const CSS_HIDE_TOC = `.layout.has-toc{grid-template-columns:290px minmax(0,1fr)}.toc-side{display:none}`;

const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y + window.scrollY), w: Math.round(b.width), h: Math.round(b.height) }; };
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const art = q('.article') || q('main.content');
  const paras = art ? [...art.querySelectorAll('p')].filter(isProse) : [];
  const prose = paras[0] || null;
  const measure = (el) => {
    if (!el) return null;
    const st = getComputedStyle(el);
    const r = document.createRange(); r.selectNodeContents(el);
    const rects = [...r.getClientRects()].filter((x) => x.width > 1);
    if (!rects.length) return null;
    const lineW = Math.max(...rects.map((x) => x.width));
    const eb = el.getBoundingClientRect();
    const padL = parseFloat(st.paddingLeft) || 0, padR = parseFloat(st.paddingRight) || 0;
    const capW = Math.max(eb.width - padL - padR, lineW);
    const cvs = document.createElement('canvas').getContext('2d');
    cvs.font = st.fontSize + ' ' + st.fontFamily;
    const zeroW = cvs.measureText('0').width;
    const fs2 = parseFloat(st.fontSize);
    return { lineW: Math.round(lineW), capW: Math.round(capW), zeroW: +zeroW.toFixed(2), ch: Math.round(capW / zeroW), chText: Math.round(lineW / zeroW), cjk: Math.round(capW / fs2), fontSize: fs2, lines: rects.length };
  };
  // 代码块横滚：真溢出（scrollWidth 超 clientWidth 1px 以上）
  const scrolls = [...document.querySelectorAll('.code-scroll')];
  const over = scrolls.filter((s) => s.scrollWidth > s.clientWidth + 1);
  // 代码行推进（首块，按行盒 top 去重）
  const pre = q('.code-pre');
  let codeAdv = null, preFS = null, preLH = null, codeFS = null;
  if (pre) {
    preFS = cs(pre, 'fontSize'); preLH = cs(pre, 'lineHeight');
    const codeEl = pre.querySelector('code') || pre;
    codeFS = cs(codeEl, 'fontSize');
    const rg = document.createRange(); rg.selectNodeContents(codeEl);
    const tops = [...new Set([...rg.getClientRects()].filter((x) => x.height > 1).map((x) => Math.round(x.top * 100) / 100))].sort((a, b) => a - b);
    if (tops.length > 1) codeAdv = +(tops[1] - tops[0]).toFixed(2);
  }
  // 表格是否词中断（有 <br> 式断词 = 需要宽度不足）——这里量 td 的 scrollWidth 溢出
  const tables = [...document.querySelectorAll('.table-wrap')];
  const tOver = tables.filter((t) => t.scrollWidth > t.clientWidth + 1).length;
  return {
    article: box(art), h1: box(q('.article h1, h1')), content: box(q('.content')),
    pageHeight: document.documentElement.scrollHeight,
    docW: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
    cols: (() => { const l = q('.layout'); return l ? getComputedStyle(l).gridTemplateColumns : null; })(),
    tocDisplay: cs(q('.toc-side'), 'display'),
    toc: box(q('.toc-side')),
    proseCount: paras.length, prose: measure(prose),
    proseWmax: (() => { const ws = paras.map((p) => Math.round(p.getBoundingClientRect().width)); return ws.length ? Math.max(...ws) : null; })(),
    code: { total: scrolls.length, overflowing: over.length, preFS, preLH, codeFS, adv: codeAdv },
    tableTotal: tables.length, tableOverflowing: tOver,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const [vw, vh] of VPS) {
    await page.setViewportSize({ width: vw, height: vh });
    for (const [name, url] of PAGES) {
      const variants = ['base', 'A', 'A1200'];
      for (const v of variants) {
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
        // 统一关掉平滑滚动与图片懒加载抖动
        await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
        let injected = 'none';
        if (v !== 'base') { await page.addStyleTag({ content: CSS_A }); injected = 'A'; }
        if (v === 'A1200' && vw < 1200) { await page.addStyleTag({ content: CSS_HIDE_TOC }); injected = 'A+tocHidden'; }
        const m = await page.evaluate(MEASURE);
        out.push({ vp: `${vw}x${vh}`, vw, page: name, variant: v, injected, ...m });
      }
    }
    process.stderr.write(`vp ${vw} done\n`);
  }
  await browser.close();
  const file = path.join(TMP, 'probe.json');
  fs.writeFileSync(file, JSON.stringify({ base: BASE, exe: EXE, at: new Date().toISOString(), rows: out }, null, 1), 'utf8');
  // 精简摘要到 stdout
  for (const r of out) {
    console.log([r.vw, r.page, r.variant, 'artW=' + (r.article ? r.article.w : '-'), 'proseCap=' + (r.prose ? r.prose.capW : '-'), 'ch=' + (r.prose ? r.prose.ch : '-'), 'code=' + r.code.overflowing + '/' + r.code.total, 'tbl=' + r.tableOverflowing + '/' + r.tableTotal, 'docW=' + r.docW.scroll + '/' + r.docW.client, 'H=' + r.pageHeight, 'x=' + (r.article ? r.article.x : '-'), 'toc=' + r.tocDisplay].join(' '));
  }
  console.log('WROTE ' + file);
})().catch((e) => { console.error(e); process.exit(1); });
