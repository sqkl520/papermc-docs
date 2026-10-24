'use strict';
/**
 * critique-typo-p19.js — 最终行宽总表（修正版）
 *
 * p18 的 bug：capCh 用 px 与 ch 比较，导致 ch 被算成「最后一个段落」的值，
 * 且逐段 canvas zeroW 在个别元素上取到了非正文的字体度量。
 *
 * 本版口径（透明可复现）：
 *   1) 行宽一律先量像素，再用**全站统一的** zeroW 折算 ch —— zeroW 用 canvas 在
 *      body 字体栈 + 16px 下量一次，并在结果里输出，任何人都能复算。
 *   2) cjk  = 像素 / 16（全角字宽度 = 字号）。
 *   3) 只统计 16px 的正文段落（15.2px 的 .page-desc / 清单页说明单独标注）。
 *   4) 同时输出 p50/p90/max 三种分位，避免「单段采样」误导。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const PAGES = [
  { url: '/', name: 'landing' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/paper/dev/dialogs/', name: 'content-callout-code' },
  { url: '/paper/reference/world-configuration/', name: 'reference-longpage' },
  { url: '/velocity/tuning/', name: 'content-tuning' },
  { url: '/all-pages.html', name: 'index-allpages' },
];
const VPS = [
  { name: '1440x900', w: 1440, h: 900, m: false },
  { name: '1280x800', w: 1280, h: 800, m: false },
  { name: '768x1024', w: 768, h: 1024, m: true },
  { name: '390x844', w: 390, h: 844, m: true },
  { name: '320x568', w: 320, h: 568, m: true },
];

const PROBE = () => {
  const art = document.querySelector('.article');
  const content = document.querySelector('.content');
  const root = art || content || document.body;

  /* 全站统一 zeroW：body 字体栈 + 16px */
  const bodyCS = getComputedStyle(document.body);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = '16px ' + bodyCS.fontFamily;
  const zeroW = cvs.measureText('0').width;

  const contentCS = getComputedStyle(content);
  const padL = parseFloat(contentCS.paddingLeft), padR = parseFloat(contentCS.paddingRight);
  /* 正文列宽 = .article 内容盒宽；无 .article 时用 .content 内容盒 */
  const colW = art
    ? Math.round(art.getBoundingClientRect().width)
    : Math.round(content.getBoundingClientRect().width - padL - padR);

  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta,.page-desc,.hero-tag,.cover,.card,.task-card,.stat,.sr-item,.code-block,.table-wrap,.toc-side,.sidebar,.pager,.page-footer,.cat-links,.src-item,.entry-card,.quickbar,.info-footer,.crumbs,.alert-title,.code-title')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const px = [];
  let excluded15 = 0;
  for (const p of root.querySelectorAll('p,li')) {
    if (!isProse(p)) continue;
    if (p.tagName === 'LI' && p.querySelector('p')) continue;
    const cs = getComputedStyle(p);
    const fsPx = parseFloat(cs.fontSize);
    if (Math.abs(fsPx - 16) > 0.6) { if (Math.abs(fsPx - 15.2) < 0.3) excluded15++; continue; }
    const range = document.createRange();
    range.selectNodeContents(p);
    for (const r of range.getClientRects()) if (r.width > 1) px.push(r.width);
  }
  px.sort((a, b) => a - b);
  const q = (qq) => (px.length ? px[Math.min(px.length - 1, Math.floor(qq * (px.length - 1)))] : 0);

  const ch = (v) => Math.round((v / zeroW) * 10) / 10;
  const cjk = (v) => Math.round((v / 16) * 10) / 10;

  return {
    viewport: window.innerWidth,
    zeroW: Math.round(zeroW * 100) / 100,
    colW,
    capCh: ch(colW),
    capCjk: cjk(colW),
    nLines: px.length,
    p50px: Math.round(q(0.5)), p50ch: ch(q(0.5)),
    p90px: Math.round(q(0.9)), p90ch: ch(q(0.9)),
    maxpx: Math.round(q(1)), maxch: ch(q(1)), maxcjk: cjk(q(1)),
    excluded15,
    tocVisible: (() => { const t = document.querySelector('.toc-side'); return t ? getComputedStyle(t).display !== 'none' : false; })(),
    pageH: Math.round(document.documentElement.scrollHeight),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const rows = [];
  for (const vp of VPS) {
    for (const pg of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: 'light', isMobile: vp.m, hasTouch: vp.m });
      const page = await ctx.newPage();
      await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(180);
      rows.push({ vp: vp.name, page: pg.name, ...(await page.evaluate(PROBE)) });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p19.json'), JSON.stringify(rows, null, 1), 'utf8');

  console.log('zeroW@1440 = ' + (rows.find((r) => r.vp === '1440x900').zeroW));
  console.log('');
  console.log('vp        page                      colW  capCh capCjk | p50ch  p90ch  maxch  maxPx | toc pageH');
  for (const r of rows) {
    console.log(
      r.vp.padEnd(9) + r.page.padEnd(25) +
      String(r.colW).padStart(5) + String(r.capCh).padStart(7) + String(r.capCjk).padStart(7) + ' |' +
      String(r.p50ch).padStart(7) + String(r.p90ch).padStart(7) + String(r.maxch).padStart(7) + String(r.maxpx).padStart(7) +
      ' |  ' + (r.tocVisible ? 'Y' : 'n') + String(r.pageH).padStart(7)
    );
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
