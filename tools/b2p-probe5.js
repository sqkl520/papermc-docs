'use strict';
/**
 * b2p-probe5.js — 只读：P0-6 的 1025–1279 形态，用**显式网格行**（probe4 的 strip 失败原因见下）
 *
 * probe4 的 strip 错在哪（保留证据，这是可复用的教训）：
 *   2 列网格里同时给 `.toc-side` 和 `.content` 写 `grid-column:1/-1` + `order`，
 *   而没有给 `.sidebar` 指定网格行 → 自动放置把 sidebar 塞进 row1/col1，
 *   跨列的 toc 只能落到 **row2**，content 落到 row3。
 *   实测：`top0=800`（toc 被推到视口外）、`artTop=1278.9`、`artW=949`（跨列后被撑满）。
 *   → 吸顶条成了"文档底部的条"，完全不是目标形态。
 *
 * 本脚本用**显式 grid-row** 三行布局：
 *   row1 = toc（跨满两列，sticky 吸顶）
 *   row2 = sidebar(col1) + content(col2)
 *
 * 变体：
 *   base       = 现状
 *   grid       = 显式行布局 + 折叠 48px 条
 *   gridOpen   = 同上，但 details 展开（量展开态遮挡与占屏）
 *   gridNoSpan = 对照：只有 grid-row 没有 grid-column 跨列（验证"跨列是必需的"）
 *
 * 只读。结果写 <TEMP>\b2p\probe5.json。用法: node tools/b2p-probe5.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(require("os").tmpdir() || '', 'b2p');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const BASE = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/dialogs/';

const base = (noSpan) => `
@media (min-width:1025px) and (max-width:1279.98px){
  .layout,.layout.has-toc{grid-template-columns:290px minmax(0,1fr)}
  .toc-side{${noSpan ? '' : 'grid-column:1 / -1;'}grid-row:1;display:block;position:sticky;top:var(--topbar-h);z-index:4;
    max-height:none;overflow:visible;margin:0 0 .75rem;padding:0;
    border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-soft);font-size:.86rem}
  .toc-side .toc-title{display:flex;align-items:center;gap:.4rem;min-height:48px;margin:0;padding:0 .75rem;
    cursor:pointer;list-style:none;font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-muted)}
  .toc-side a{display:block;min-height:0;padding:.16rem .4rem}
  .sidebar{grid-column:1;grid-row:2}
  .content{grid-column:2;grid-row:2}
  .side-toc{display:block}
}`;

const open = (noSpan) => base(noSpan) + `
@media (min-width:1025px) and (max-width:1279.98px){
  .toc-side{position:static}
  .toc-fold[open]>ol{max-height:min(45vh,calc(100vh - var(--topbar-h) - 96px));overflow-y:auto;padding:0 .5rem .5rem}
}`;

const VP = [[1025, 800], [1100, 800], [1200, 800], [1279, 800], [1280, 800]];

const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top * 10) / 10, h: Math.round(b.height * 10) / 10, w: Math.round(b.width), x: Math.round(b.x) }; };
  const toc = q('.toc-side'); const art = q('.article'); const html = document.documentElement; const fold = q('.toc-fold');
  return {
    scrollY: Math.round(window.scrollY),
    toc: r(toc), tocDisplay: toc ? getComputedStyle(toc).display : null, tocPosition: toc ? getComputedStyle(toc).position : null,
    foldOpen: fold ? fold.open : null,
    art: r(art), h1: r(q('.article h1, h1')), pageHeight: html.scrollHeight,
    codeOver: (() => { const s = [...document.querySelectorAll('.code-scroll')]; return s.filter((x) => x.scrollWidth > x.clientWidth + 1).length + '/' + s.length; })(),
    tocLinksVisible: toc ? [...toc.querySelectorAll('a')].filter((a) => { const b = a.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length : 0,
    tocOffset: getComputedStyle(html).getPropertyValue('--toc-offset').trim(),
    scrollPadTop: getComputedStyle(html).scrollPaddingTop,
    docW: html.scrollWidth + '/' + html.clientWidth,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const out = [];
  for (const [w, h] of VP) {
    await page.setViewportSize({ width: w, height: h });
    for (const v of ['base', 'grid', 'gridOpen', 'gridNoSpan']) {
      await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
      if (v === 'grid') await page.addStyleTag({ content: base(false) });
      if (v === 'gridOpen') await page.addStyleTag({ content: open(false) });
      if (v === 'gridNoSpan') await page.addStyleTag({ content: base(true) });
      const at0 = await page.evaluate(MEASURE);
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(120);
      const at2000 = await page.evaluate(MEASURE);
      await page.evaluate(() => window.scrollTo(0, 12000));
      await page.waitForTimeout(120);
      const at12000 = await page.evaluate(MEASURE);
      out.push({ vw: w, variant: v, at0, at2000, at12000 });
      console.log([w, v, 'tocDisp=' + at0.tocDisplay, 'pos=' + at0.tocPosition, 'open=' + at0.foldOpen,
        'tocTop0=' + (at0.toc ? at0.toc.top : '-'), 'tocH=' + (at0.toc ? at0.toc.h : '-'), 'tocW=' + (at0.toc ? at0.toc.w : '-'),
        '| artW=' + (at0.art ? at0.art.w : '-'), 'artTop=' + (at0.art ? at0.art.top : '-'),
        '| top@2000=' + (at2000.toc ? at2000.toc.top : '-'), 'top@12000=' + (at12000.toc ? at12000.toc.top : '-'),
        '| code=' + at0.codeOver, 'links=' + at0.tocLinksVisible, '| H=' + at0.pageHeight, 'docW=' + at0.docW].join(' '));
    }
  }
  await browser.close();
  const f = path.join(TMP, 'probe5.json');
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 1), 'utf8');
  console.log('WROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
