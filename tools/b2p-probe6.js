'use strict';
/**
 * b2p-probe6.js — 只读：P0-6 的**真实目标态**（probe5 的 grid 变体仍是错误状态，原因见下）
 *
 * probe5 的 grid 变体为什么还不算目标态：
 *   `.toc-fold` 仍带 `open`（现状 JS 在 ≥1025 强制展开，matchMedia 写死 1025），
 *   所以 1025–1279 下 tocH=410、`artTop=530.9` —— 正文被 410px 的**展开列表**推下去。
 *   P0-6 的目标是这一档**折叠**（48px 吸顶条），这需要同步改 JS 的 matchMedia 断点。
 *
 * 本脚本模拟完整目标态（CSS + JS 断点 + --toc-offset 三处联动）：
 *   - 移除 .toc-fold 的 open 属性（等价于把 matchMedia('(min-width:1025px)') 改成 1280）
 *   - --toc-offset 设为吸顶条实际高度（等价于把 syncTocOffset 的 `<1025` 改成 `<1280`）
 *
 * 变体：
 *   base    = 现状
 *   target  = P0-6 目标态（折叠条 + 正确 offset）
 *   targetOp= 目标态 + 用户展开（量展开后是否遮挡/是否可关）
 *
 * 只读。结果写 <TEMP>\b2p\probe6.json。用法: node tools/b2p-probe6.js
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

const CSS_TARGET = `
@media (min-width:1025px) and (max-width:1279.98px){
  .layout,.layout.has-toc{grid-template-columns:290px minmax(0,1fr)}
  .toc-side{grid-column:1 / -1;grid-row:1;display:block;position:sticky;top:var(--topbar-h);z-index:4;
    max-height:none;overflow:visible;margin:0 0 .75rem;padding:0;
    border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-soft);font-size:.86rem}
  .toc-side .toc-title{display:flex;align-items:center;gap:.4rem;min-height:48px;margin:0;padding:0 .75rem;
    cursor:pointer;list-style:none;font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-muted)}
  .toc-side a{display:block;min-height:0;padding:.16rem .4rem}
  .sidebar{grid-column:1;grid-row:2}
  .content{grid-column:2;grid-row:2}
  .side-toc{display:block}
  /* 展开态：改 static（与 <1025 一致，避免展开列表吸顶遮挡） */
  .toc-side.toc-open{position:static}
  .toc-fold[open]>ol{max-height:min(45vh,calc(100vh - var(--topbar-h) - 96px));overflow-y:auto;padding:0 .5rem .5rem}
}`;

const VP = [[1025, 800], [1100, 800], [1200, 800], [1279, 800], [1280, 800], [1440, 900], [390, 844]];

const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top * 10) / 10, h: Math.round(b.height * 10) / 10, w: Math.round(b.width), x: Math.round(b.x) }; };
  const toc = q('.toc-side'); const art = q('.article'); const html = document.documentElement; const fold = q('.toc-fold');
  return {
    scrollY: Math.round(window.scrollY), toc: box(toc),
    tocDisplay: toc ? getComputedStyle(toc).display : null, tocPosition: toc ? getComputedStyle(toc).position : null,
    foldOpen: fold ? fold.open : null,
    art: box(art), h1: box(q('.article h1, h1')), pageHeight: html.scrollHeight,
    codeOver: (() => { const s = [...document.querySelectorAll('.code-scroll')]; return s.filter((x) => x.scrollWidth > x.clientWidth + 1).length + '/' + s.length; })(),
    tocLinksVisible: toc ? [...toc.querySelectorAll('a')].filter((a) => { const b = a.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length : 0,
    tocOffset: getComputedStyle(html).getPropertyValue('--toc-offset').trim(),
    scrollPadTop: getComputedStyle(html).scrollPaddingTop,
    docW: html.scrollWidth + '/' + html.clientWidth,
    covered: (() => {
      const h = document.querySelector('.article h3[id], .article h2[id]');
      if (!h) return null;
      const b = h.getBoundingClientRect();
      const px = Math.min(b.x + 30, window.innerWidth - 6);
      const py = Math.max(b.y + 6, 2);
      const hit = document.elementFromPoint(px, py);
      return { top: Math.round(b.top), hitTag: hit ? hit.tagName : null, hitIsToc: hit ? !!(hit.closest && hit.closest('.toc-side')) : null };
    })(),
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
    for (const v of ['base', 'target', 'targetOp']) {
      await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
      if (v !== 'base' && w < 1280) {
        await page.addStyleTag({ content: CSS_TARGET });
        if (v === 'target') {
          // 等价于把 matchMedia 断点改成 1280：窄档强制折叠
          await page.evaluate(() => {
            document.querySelectorAll('.toc-side .toc-fold').forEach((f, i) => {
              f.removeAttribute('open');
              if (i === 0) f.parentElement.classList.remove('toc-open');
            });
            // 等价于把 syncTocOffset 的 `<1025` 改成 `<1280`
            const toc = document.querySelector('.toc-side');
            const b = toc.getBoundingClientRect();
            document.documentElement.style.setProperty('--toc-offset', Math.round(b.height) + 'px');
          });
        } else {
          await page.evaluate(() => {
            document.querySelectorAll('.toc-side .toc-fold').forEach((f) => { f.setAttribute('open', ''); f.parentElement.classList.add('toc-open'); });
            const toc = document.querySelector('.toc-side');
            const b = toc.getBoundingClientRect();
            document.documentElement.style.setProperty('--toc-offset', Math.round(b.height) + 'px');
          });
        }
        await page.waitForTimeout(80);
      }
      const at0 = await page.evaluate(MEASURE);
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(100);
      const at2000 = await page.evaluate(MEASURE);
      // 真锚点跳转
      const jumped = await page.evaluate(() => {
        const h = document.querySelectorAll('.article h3[id]');
        if (!h.length) return null;
        const t = h[Math.min(3, h.length - 1)];
        location.hash = '#' + t.id;
        return t.id;
      });
      await page.waitForTimeout(400);
      const atAnchor = await page.evaluate(MEASURE);
      out.push({ vw: w, variant: v, at0, at2000, atAnchor, jumped });
      console.log([w, v, 'disp=' + at0.tocDisplay, 'pos=' + at0.tocPosition, 'open=' + at0.foldOpen,
        'tocH=' + (at0.toc ? at0.toc.h : '-'), 'tocW=' + (at0.toc ? at0.toc.w : '-'), 'tocTop0=' + (at0.toc ? at0.toc.top : '-'),
        '| artW=' + (at0.art ? at0.art.w : '-'), 'artTop=' + (at0.art ? at0.art.top : '-'),
        '| top@2000=' + (at2000.toc ? at2000.toc.top : '-'),
        '| code=' + at0.codeOver, 'links=' + at0.tocLinksVisible,
        '| off=' + at0.tocOffset, 'pad=' + at0.scrollPadTop,
        '| anchorTop=' + (atAnchor.covered ? atAnchor.covered.top : '-'), 'hit=' + (atAnchor.covered ? atAnchor.covered.hitTag : '-'), 'isToc=' + (atAnchor.covered ? atAnchor.covered.hitIsToc : '-'),
        '| H=' + at0.pageHeight, 'docW=' + at0.docW].join(' '));
    }
  }
  await browser.close();
  const f = path.join(TMP, 'probe6.json');
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 1), 'utf8');
  console.log('WROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
