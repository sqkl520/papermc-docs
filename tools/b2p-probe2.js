'use strict';
/**
 * b2p-probe2.js — 只读预演：P1-4 代码 strut 修复 / P0-6 断崖变体 / 组合叠加
 *
 * 只读站点（8787）。不改源码；结果写 <TEMP>\b2p\probe2.json。
 *
 * 变体（全部用 addStyleTag 注入，串行叠加）：
 *   base         = 现状
 *   strut        = `.code-pre{font-size:.875rem}`（P1-4，仅改行距）
 *   col40        = `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}`（P0-5）
 *   toc1280      = <1280 视口注入「无右栏」+ 290 侧栏（P0-6 的目标态）
 *   col40_toc1280= 三者叠加（批 2 + 批 3 的最终态预演）
 *   toc1280_fluid= 同上但右栏改成 `minmax(200px,250px)`（可选强化：削减断崖幅度）
 *
 * 量：article.w、代码块横滚数、代码行推进、pageHeight、代码行数、表格横滚、横向溢出。
 * 用法: node tools/b2p-probe2.js
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
];
const VPS = [[1024, 800], [1025, 800], [1200, 800], [1279, 800], [1280, 800], [1440, 900]];

const CSS = {
  strut: `.code-pre{font-size:.875rem;line-height:1.6}`,
  col40: `.article > :is(p,ul,ol,blockquote,dl){max-width:40rem}`,
  toc1280: `.layout{grid-template-columns:290px minmax(0,1fr)}.layout.has-toc{grid-template-columns:290px minmax(0,1fr)}.toc-side{display:none}`,
  toc1280fluid: `.layout{grid-template-columns:290px minmax(0,1fr)}.layout.has-toc{grid-template-columns:290px minmax(0,1fr) minmax(180px,250px)}.toc-side{display:block;position:sticky;top:52px;max-height:calc(100vh - 52px);overflow-y:auto;font-size:.82rem;padding:1rem .9rem 2rem;border-left:1px solid var(--border)}`,
};

const VARIANTS = [
  ['base', []],
  ['strut', ['strut']],
  ['col40', ['col40']],
  ['toc1280', ['toc1280']],
  ['col40_toc1280', ['strut', 'col40', 'toc1280']],
  ['toc1280_fluid', ['strut', 'col40', 'toc1280fluid']],
];

const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) }; };
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = q('.article') || q('main.content');
  const pre = q('.code-pre');
  const codeEl = pre ? (pre.querySelector('code') || pre) : null;
  let adv = null;
  if (codeEl) {
    const rg = document.createRange(); rg.selectNodeContents(codeEl);
    const tops = [...new Set([...rg.getClientRects()].filter((x) => x.height > 1).map((x) => Math.round(x.top * 100) / 100))].sort((a, b) => a - b);
    if (tops.length > 1) adv = +(tops[1] - tops[0]).toFixed(2);
  }
  const scrolls = [...document.querySelectorAll('.code-scroll')];
  const over = scrolls.filter((s) => s.scrollWidth > s.clientWidth + 1);
  // 代码总行数（用于 pageHeight 归因）
  let codeLines = 0;
  for (const s of scrolls) {
    const c = s.querySelector('code');
    if (!c) continue;
    const rg = document.createRange(); rg.selectNodeContents(c);
    codeLines += [...new Set([...rg.getClientRects()].filter((x) => x.height > 1).map((x) => Math.round(x.top * 10)))].length;
  }
  const tables = [...document.querySelectorAll('.table-wrap')];
  return {
    article: box(art), h1: box(q('.article h1, h1')),
    pageHeight: document.documentElement.scrollHeight,
    docW: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
    cols: (() => { const l = q('.layout'); return l ? getComputedStyle(l).gridTemplateColumns : null; })(),
    tocDisplay: cs(q('.toc-side'), 'display'), toc: box(q('.toc-side')),
    code: {
      total: scrolls.length, overflowing: over.length, lines: codeLines,
      preFS: pre ? cs(pre, 'fontSize') : null, preLH: pre ? cs(pre, 'lineHeight') : null,
      codeFS: codeEl ? cs(codeEl, 'fontSize') : null, adv,
    },
    tableTotal: tables.length,
    tableOverflowing: tables.filter((t) => t.scrollWidth > t.clientWidth + 1).length,
    // 逐块看点：竖屏/横屏导航是否仍可达（P0-6 的关键判据）
    tocLinksVisible: (() => { const ts = q('.toc-side'); if (!ts) return null; const ls = [...ts.querySelectorAll('a')]; return ls.filter((a) => { const b = a.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length; })(),
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const out = [];
  for (const [vw, vh] of VPS) {
    await page.setViewportSize({ width: vw, height: vh });
    for (const [name, url] of PAGES) {
      for (const [v, tags] of VARIANTS) {
        // toc1280 系列只在 <1280 时注入（>=1280 目标态与现状一致）
        if ((v === 'toc1280' || v === 'col40_toc1280' || v === 'toc1280_fluid') && vw >= 1280) {
          if (v === 'toc1280') { /* 仍测：>=1280 应无变化，用作对照组 */ }
        }
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
        await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
        for (const t of tags) await page.addStyleTag({ content: CSS[t] });
        const m = await page.evaluate(MEASURE);
        out.push({ vw, page: name, variant: v, tags: tags.join('+') || 'none', ...m });
      }
    }
    process.stderr.write('vp ' + vw + ' done\n');
  }
  await browser.close();
  const file = path.join(TMP, 'probe2.json');
  fs.writeFileSync(file, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows: out }, null, 1), 'utf8');
  for (const r of out) {
    console.log([r.vw, r.page, r.variant, 'artW=' + (r.article ? r.article.w : '-'), 'code=' + r.code.overflowing + '/' + r.code.total,
      'lines=' + r.code.lines, 'adv=' + r.code.adv, 'H=' + r.pageHeight, 'toc=' + r.tocDisplay, 'cols=' + r.cols, 'tocLinks=' + r.tocLinksVisible].join(' '));
  }
  console.log('WROTE ' + file);
})().catch((e) => { console.error(e); process.exit(1); });
