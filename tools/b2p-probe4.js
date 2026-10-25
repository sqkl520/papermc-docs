'use strict';
/**
 * b2p-probe4.js — 只读：修正 P0-6 的 1025–1279 形态模拟（上一版 probe3 的 p06 变体是错的，本文档记录错误的成因）
 *
 * probe3 的 p06 犯了什么错（保留证据）：
 *   只写了 `.layout.has-toc{grid-template-columns:290px minmax(0,1fr)}` + `.toc-side{order:1}`，
 *   而 `.toc-side` 在 DOM 里位于 `<main class="content">` **之后**。order:1 把它排到 content 前，
 *   于是 toc 占第 1 列（290px）、content 被挤到第 2 列只剩 **239px**，且 `artTop0=884`。
 *   → **`article.w` 从 434 掉到 239 是注入错误，不是 P0-6 的后果。**
 *   正确形态必须让 toc **跨满整行**：`grid-column:1 / -1`。
 *
 * 本脚本测三种形态（1025/1100/1279 + 1280/1440 对照）：
 *   base   = 现状（3 列，右栏 250）
 *   strip  = 目标态：toc 跨满整行 + order:1 + 48px 吸顶条（折叠）
 *   stripOpen = 同上但 details 展开（用户点了之后的样子，用于量遮挡）
 *
 * 只读。结果写 <TEMP>\b2p\probe4.json。用法: node tools/b2p-probe4.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(process.env.TEMP || '', 'b2p');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const BASE = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/dialogs/';

const CSS_STRIP = `
@media (min-width:1025px) and (max-width:1279.98px){
  .layout{grid-template-columns:290px minmax(0,1fr)}
  .layout.has-toc{grid-template-columns:290px minmax(0,1fr)}
  /* 关键：跨满整行，否则会被挤进 290px 的第 1 列 */
  .toc-side{grid-column:1 / -1;order:1;display:block;position:sticky;top:var(--topbar-h);z-index:4;
    max-height:none;overflow:visible;margin:0 0 .75rem;padding:0;
    border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-soft);font-size:.86rem}
  .toc-side .toc-title{display:flex;align-items:center;gap:.4rem;min-height:48px;margin:0;padding:0 .75rem;
    cursor:pointer;list-style:none;font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-muted)}
  .toc-side a{display:block;min-height:0;padding:.16rem .4rem}
  .content{grid-column:1 / -1;order:2}
  .side-toc{display:block}
}`;

const CSS_OPEN = CSS_STRIP + `
@media (min-width:1025px) and (max-width:1279.98px){
  .toc-side{position:static}
  .toc-fold[open]>ol{max-height:min(45vh,calc(100vh - var(--topbar-h) - 96px));overflow-y:auto;padding:0 .5rem .5rem}
}`;

const VP = [[1025, 800], [1100, 800], [1279, 800], [1280, 800], [1440, 900]];

const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top * 10) / 10, h: Math.round(b.height * 10) / 10, w: Math.round(b.width), x: Math.round(b.x) }; };
  const toc = q('.toc-side');
  const art = q('.article');
  const html = document.documentElement;
  const fold = q('.toc-fold');
  return {
    scrollY: Math.round(window.scrollY),
    toc: r(toc), tocDisplay: toc ? getComputedStyle(toc).display : null,
    tocPosition: toc ? getComputedStyle(toc).position : null,
    foldOpen: fold ? fold.open : null,
    art: r(art), h1: r(q('.article h1, h1')),
    pageHeight: html.scrollHeight,
    codeOver: (() => { const s = [...document.querySelectorAll('.code-scroll')]; return s.filter((x) => x.scrollWidth > x.clientWidth + 1).length + '/' + s.length; })(),
    tocLinksVisible: toc ? [...toc.querySelectorAll('a')].filter((a) => { const b = a.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length : 0,
    tocOffset: getComputedStyle(html).getPropertyValue('--toc-offset').trim(),
    scrollPadTop: getComputedStyle(html).scrollPaddingTop,
    docW: html.scrollWidth + '/' + html.clientWidth,
    // 锚点落点：把 #registering-dialogs 之类的标题滚到 scrollPaddingTop 处，看是否被吸顶条盖住
    covered: (() => {
      const h = document.querySelector('.article h3[id], .article h2[id]');
      if (!h) return null;
      const b = h.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(b.x + 20, window.innerWidth - 5), Math.max(b.y + 4, 1));
      return { top: Math.round(b.top), hitTag: hit ? hit.tagName : null, hitIsToc: hit ? !!(hit.closest && hit.closest('.toc-side')) : null };
    })(),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const out = [];
  for (const [w, h] of VP) {
    await page.setViewportSize({ width: w, height: h });
    for (const v of ['base', 'strip', 'stripOpen']) {
      await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
      if (v === 'strip') await page.addStyleTag({ content: CSS_STRIP });
      if (v === 'stripOpen') await page.addStyleTag({ content: CSS_OPEN });
      const at0 = await page.evaluate(MEASURE);
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(120);
      const at2000 = await page.evaluate(MEASURE);
      // 锚点跳转
      const anchor = await page.evaluate(() => {
        const h = document.querySelector('.article h3[id]');
        if (!h) return null;
        location.hash = '#' + h.id;
        return h.id;
      });
      await page.waitForTimeout(300);
      const atAnchor = await page.evaluate(MEASURE);
      out.push({ vw: w, variant: v, at0, at2000, atAnchor, anchor });
      console.log([w, v, 'toc:disp=' + at0.tocDisplay, 'pos=' + at0.tocPosition, 'open=' + at0.foldOpen,
        'top0=' + (at0.toc ? at0.toc.top : '-'), 'h=' + (at0.toc ? at0.toc.h : '-'), 'w=' + (at0.toc ? at0.toc.w : '-'),
        '| artW=' + (at0.art ? at0.art.w : '-'), 'artTop=' + (at0.art ? at0.art.top : '-'), 'h1Top=' + (at0.h1 ? at0.h1.top : '-'),
        '| top@2000=' + (at2000.toc ? at2000.toc.top : '-'),
        '| code=' + at0.codeOver, 'links=' + at0.tocLinksVisible,
        '| offset=' + at0.tocOffset, 'pad=' + at0.scrollPadTop,
        '| anchorTop=' + (atAnchor.covered ? atAnchor.covered.top : '-'), 'hit=' + (atAnchor.covered ? atAnchor.covered.hitTag : '-'),
        '| H=' + at0.pageHeight, 'docW=' + at0.docW].join(' '));
    }
  }
  await browser.close();
  const f = path.join(TMP, 'probe4.json');
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 1), 'utf8');
  console.log('WROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
