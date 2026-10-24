'use strict';
/**
 * critique-typo-p18.js — 最终行宽总表（逐段用「该段自己的字号」算 zeroW，避免混排字号导致的 5% 误差）
 *
 * 输出每 (视口, 页面)：
 *   colW      正文列宽（.article 或 .content 内容宽）
 *   capCh     容器一行容量（colW / 正文字号的 zeroW）
 *   p50/p90/max ch   实际行宽分布（只统计 16px 正文段落）
 *   cjk       全角字/行（colW / 16）
 *   maxLinePx 实际最长行像素
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

  /* 容器宽度 */
  const contentCS = getComputedStyle(content);
  const colEl = art || content;
  const colW = Math.round(colEl.getBoundingClientRect().width - (art ? 0 : parseFloat(contentCS.paddingLeft) + parseFloat(contentCS.paddingRight)));

  /* 逐段：用该段自己的字号算 zeroW */
  const lines = [];
  let capCh = null, cjk = null;
  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta,.page-desc,.hero-tag,.cover,.card,.task-card,.stat,.sr-item,.code-block,.table-wrap,.toc-side,.sidebar,.pager,.page-footer,.cat-links,.src-item,.entry-card,.quickbar,.info-footer,.crumbs')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  for (const p of root.querySelectorAll('p,li,td,dd')) {
    if (!isProse(p)) continue;
    /* li 里若含长段落，优先用内层 p，避免重复计 */
    if (p.tagName === 'LI' && p.querySelector('p')) continue;
    const cs = getComputedStyle(p);
    const fsPx = parseFloat(cs.fontSize);
    if (Math.abs(fsPx - 16) > 0.6) continue;      // 只统计 16px 正文
    const cvs = document.createElement('canvas').getContext('2d');
    cvs.font = fsPx + ' ' + cs.fontFamily;
    const zeroW = cvs.measureText('0').width;
    const range = document.createRange();
    range.selectNodeContents(p);
    for (const r of range.getClientRects()) {
      if (r.width <= 1) continue;
      lines.push({ px: r.width, ch: r.width / zeroW, fs: fsPx });
    }
    /* 容器容量：取该段内容盒宽 */
    const box = p.getBoundingClientRect();
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const cap = box.width - pad;
    if (capCh === null || cap > capCh) { capCh = cap / zeroW; cjk = cap / fsPx; }
  }
  const chs = lines.map((l) => l.ch).sort((a, b) => a - b);
  const q = (qq) => (chs.length ? chs[Math.min(chs.length - 1, Math.floor(qq * (chs.length - 1)))] : 0);
  const px = lines.map((l) => l.px).sort((a, b) => a - b);

  return {
    colW,
    capCh: capCh ? Math.round(capCh * 10) / 10 : null,
    cjk: cjk ? Math.round(cjk) : null,
    nLines: lines.length,
    p50: Math.round(q(0.5) * 10) / 10,
    p90: Math.round(q(0.9) * 10) / 10,
    max: Math.round(q(1) * 10) / 10,
    maxLinePx: px.length ? Math.round(px[px.length - 1]) : 0,
    contentMaxW: contentCS.maxWidth,
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
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p18.json'), JSON.stringify(rows, null, 1), 'utf8');
  console.log('vp        page                      colW capCh  p50   p90   max  maxPx  cjk  toc  pageH');
  for (const r of rows) {
    console.log(
      r.vp.padEnd(9) + r.page.padEnd(25) +
      String(r.colW).padStart(5) + String(r.capCh).padStart(6) +
      String(r.p50).padStart(6) + String(r.p90).padStart(6) + String(r.max).padStart(6) +
      String(r.maxLinePx).padStart(7) + String(r.cjk).padStart(5) +
      String(r.tocVisible ? 'Y' : 'n').padStart(5) + String(r.pageH).padStart(7)
    );
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
