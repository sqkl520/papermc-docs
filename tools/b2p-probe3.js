'use strict';
/**
 * b2p-probe3.js — 只读：P0-6 的核心不确定点（1025–1279 的吸顶条到底能不能吸顶）+ 现状 sticky 机制是否成立
 *
 * 为什么要问：`.toc-side` 的 sticky 是 grid item，sticky 的包含块是**网格区域**。
 * 若该区域高度 = 元素自身高度，sticky 是空操作。批 1 在 390 档声称 tocH=61.19 吸顶，
 * 本探针直接实测「滚动 2000px 后 top 是否仍 = 顶栏高」，不靠推断。
 *
 * 变体：
 *   base  = 现状
 *   p06   = 模拟「TOC 断点 1025 → 1280」：在 1025–1279 注入还原 base 形态（`order:1` + sticky + 面板外观）
 *   p06b  = 同上 + grid-row 跨行（`grid-row:1 / span 2` + `align-self:start`），让吸顶条有可travel的区域
 *
 * 只读。结果写 <TEMP>\b2p\probe3.json。用法: node tools/b2p-probe3.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(process.env.TEMP || '.', 'b2p');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const BASE = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/dialogs/';

/** 在 1025–1279 还原 base（= 批 1 之前 1025 档的样子），并可选加 grid-row 跨行 */
const undo1025 = (span) => `
@media (min-width:1025px) and (max-width:1279.98px){
  .layout{grid-template-columns:290px minmax(0,1fr)}
  .layout.has-toc{grid-template-columns:290px minmax(0,1fr)}
  .toc-side{display:block;order:1;position:sticky;top:var(--topbar-h);max-height:none;overflow:visible;
    margin:0 0 .75rem;padding:0;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-soft);font-size:.86rem}
  .toc-side .toc-title{min-height:48px;margin:0;padding:0 .75rem;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em}
  .toc-side a{display:block;min-height:0;padding:.16rem .4rem}
  .content{order:2}
  .side-toc{display:block}
  ${span ? '.toc-side{grid-column:2;grid-row:1 / span 2;align-self:start;height:max-content}' : ''}
}`;

const VP = [[390, 844], [768, 1024], [1024, 768], [1025, 800], [1100, 800], [1279, 800], [1280, 800], [1440, 900]];

const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const toc = q('.toc-side');
  const b = toc ? toc.getBoundingClientRect() : null;
  const cs = toc ? getComputedStyle(toc) : null;
  const html = document.documentElement;
  const art = q('.article');
  return {
    scrollY: Math.round(window.scrollY),
    tocDisplay: cs ? cs.display : null,
    tocPosition: cs ? cs.position : null,
    tocTop: b ? Math.round(b.top * 10) / 10 : null,
    tocH: b ? Math.round(b.height * 10) / 10 : null,
    tocW: b ? Math.round(b.width) : null,
    tocGridRow: cs ? cs.gridRowStart + '/' + cs.gridRowEnd : null,
    articleW: art ? Math.round(art.getBoundingClientRect().width) : null,
    articleTop: art ? Math.round(art.getBoundingClientRect().top) : null,
    h1Top: (() => { const h = q('.article h1, h1'); return h ? Math.round(h.getBoundingClientRect().top) : null; })(),
    pageHeight: html.scrollHeight,
    codeOver: (() => { const s = [...document.querySelectorAll('.code-scroll')]; return s.filter((x) => x.scrollWidth > x.clientWidth + 1).length + '/' + s.length; })(),
    tocLinksVisible: toc ? [...toc.querySelectorAll('a')].filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length : null,
    tocOffset: getComputedStyle(html).getPropertyValue('--toc-offset').trim(),
    scrollPadTop: getComputedStyle(html).scrollPaddingTop,
    docW: html.scrollWidth + '/' + html.clientWidth,
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
    for (const variant of ['base', 'p06', 'p06b']) {
      await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
      if (variant !== 'base') await page.addStyleTag({ content: undo1025(variant === 'p06b') });
      const at0 = await page.evaluate(MEASURE);
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(120);
      const at2000 = await page.evaluate(MEASURE);
      await page.evaluate(() => window.scrollTo(0, 8000));
      await page.waitForTimeout(120);
      const at8000 = await page.evaluate(MEASURE);
      out.push({ vw: w, variant, at0, at2000, at8000 });
      console.log([w, variant, 'disp=' + at0.tocDisplay, 'pos=' + at0.tocPosition, 'gridRow=' + at0.tocGridRow,
        'top0=' + at0.tocTop, 'top@2000=' + at2000.tocTop, 'top@8000=' + at8000.tocTop,
        'h=' + at0.tocH, 'links=' + at0.tocLinksVisible, 'artW=' + at0.articleW,
        'artTop0=' + at0.articleTop, 'artTop@2000=' + at2000.articleTop, 'code=' + at0.codeOver,
        'offset=' + at0.tocOffset, 'padTop=' + at0.scrollPadTop].join(' '));
    }
  }
  await browser.close();
  const f = path.join(TMP, 'probe3.json');
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 1), 'utf8');
  console.log('WROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
