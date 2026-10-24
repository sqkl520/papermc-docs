'use strict';
/**
 * critique-typo-p7.js — max-width 正式方案的候选实测
 *
 *  方案 A（推荐）：只给「行文块」限宽（p/li/blockquote/alert），代码块/表格/图片保持整列宽
 *  方案 B（保底）：整个 .article 限宽
 *  另测 1025–1279 区间（右栏 TOC 已出现但窗口不够宽）的真实正文宽
 *
 * 每种方案都在 1440 / 1280 / 1100 / 1025 下量：ch、cjk、右空、代码块横向滚动条增量、表格溢出
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

const PAGE = '/paper/dev/dialogs/';

/* 应用某个方案后测一次 */
const APPLY = (args) => {
  const { mode, px } = args;
  const old = document.getElementById('probe-plan');
  if (old) old.remove();
  const st = document.createElement('style');
  st.id = 'probe-plan';
  if (mode === 'A') {
    /* 行文块限宽；代码/表格/图片/图注不限 */
    st.textContent = '@media (min-width:1024px){.article>:is(p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,.alert,.details-block),.article li>:is(p,ul,ol){max-width:' + px + 'px!important}}';
  } else if (mode === 'A-center') {
    st.textContent = '@media (min-width:1024px){.article>:is(p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,.alert,.details-block),.article li>:is(p,ul,ol){max-width:' + px + 'px!important;margin-left:auto!important;margin-right:auto!important}}';
  } else if (mode === 'B') {
    st.textContent = '@media (min-width:1024px){.article{max-width:' + px + 'px!important}}';
  } else if (mode === 'B-center') {
    st.textContent = '@media (min-width:1024px){.article{max-width:' + px + 'px!important;margin-left:auto!important;margin-right:auto!important}}';
  }
  document.head.appendChild(st);

  const art = document.querySelector('.article');
  const p = art.querySelector('p:not(.page-desc):not(.page-meta)');
  const cs = getComputedStyle(p);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = cs.fontSize + ' ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const fsPx = parseFloat(cs.fontSize);

  /* 正文行宽：取全部正文段落的最大行宽 */
  const range = document.createRange();
  range.selectNodeContents(p);
  const rects = [...range.getClientRects()].filter((r) => r.width > 1);
  const lineW = rects.length ? Math.max(...rects.map((r) => r.width)) : 0;
  const pRect = p.getBoundingClientRect();

  /* 代码块 / 表格是否横向滚动 */
  const preScroll = [...document.querySelectorAll('.code-scroll')].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
  const tblScroll = [...document.querySelectorAll('.table-wrap')].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
  const artRect = art.getBoundingClientRect();

  return {
    mode, px,
    proseW: Math.round(pRect.width),
    proseLineW: Math.round(lineW),
    proseCh: Math.round((pRect.width / zeroW) * 10) / 10,
    proseCjk: Math.round(pRect.width / fsPx),
    articleW: Math.round(artRect.width),
    /* 正文块左缘到视口左缘、右缘到视口右缘 */
    proseLeft: Math.round(pRect.x),
    proseRight: Math.round(pRect.x + pRect.width),
    rightGapPx: Math.round(window.innerWidth - (pRect.x + pRect.width)),
    leftDeadPx: Math.round(pRect.x - 290),
    preScroll, preTotal: document.querySelectorAll('.code-scroll').length,
    tblScroll, tblTotal: document.querySelectorAll('.table-wrap').length,
    scrollH: Math.round(document.documentElement.scrollHeight),
  };
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const out = { widths: {}, baseline: {} };

  const VPS = [1440, 1280, 1200, 1100, 1025, 1024];
  const PLANS = [
    { mode: 'none', px: 0 },
    { mode: 'A', px: 560 }, { mode: 'A', px: 605 }, { mode: 'A', px: 614 }, { mode: 'A', px: 630 }, { mode: 'A', px: 640 }, { mode: 'A', px: 660 },
    { mode: 'A-center', px: 620 },
    { mode: 'B', px: 614 }, { mode: 'B-center', px: 614 },
    { mode: 'B', px: 704 },
  ];

  for (const w of VPS) {
    const key = String(w);
    out.widths[key] = { geometry: null, plans: [] };
    for (const plan of PLANS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(BASE + PAGE, { waitUntil: 'load' });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.waitForTimeout(120);
      if (plan.mode === 'none') {
        out.widths[key].geometry = await page.evaluate((a) => {
          const A = (function () { return null; })();
          const art = document.querySelector('.article');
          const content = document.querySelector('.content');
          const toc = document.querySelector('.toc-side');
          const p = art.querySelector('p:not(.page-desc):not(.page-meta)');
          const cs = getComputedStyle(p);
          const cvs = document.createElement('canvas').getContext('2d');
          cvs.font = cs.fontSize + ' ' + cs.fontFamily;
          const zeroW = cvs.measureText('0').width;
          const pr = p.getBoundingClientRect();
          return {
            viewport: window.innerWidth,
            contentW: Math.round(content.getBoundingClientRect().width),
            contentMaxWidth: getComputedStyle(content).maxWidth,
            contentPad: Math.round(parseFloat(getComputedStyle(content).paddingLeft) * 10) / 10,
            articleW: Math.round(art.getBoundingClientRect().width),
            articleX: Math.round(art.getBoundingClientRect().x),
            proseW: Math.round(pr.width),
            proseCh: Math.round((pr.width / zeroW) * 10) / 10,
            proseCjk: Math.round(pr.width / parseFloat(cs.fontSize)),
            tocW: toc ? Math.round(toc.getBoundingClientRect().width) : 0,
            tocDisplay: toc ? getComputedStyle(toc).display : null,
            sidebarW: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
            rightGapPx: Math.round(window.innerWidth - (pr.x + pr.width)),
          };
        });
      } else {
        out.widths[key].plans.push(await page.evaluate(APPLY, plan));
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p7.json'), JSON.stringify(out, null, 1), 'utf8');

  console.log('== 基线几何（无干预）==');
  for (const w of VPS) {
    const g = out.widths[String(w)].geometry;
    console.log(String(w).padEnd(6) + 'content=' + String(g.contentW).padStart(5) + ' maxW=' + String(g.contentMaxWidth).padStart(7) + ' article=' + String(g.articleW).padStart(4) + ' prose=' + String(g.proseW).padStart(4) + ' ch=' + String(g.proseCh).padStart(6) + ' cjk=' + String(g.proseCjk).padStart(3) + ' toc=' + String(g.tocW).padStart(4) + ' rightGap=' + String(g.rightGapPx).padStart(4));
  }
  console.log('');
  console.log('== 1440 各方案 ==');
  for (const r of out.widths['1440'].plans) {
    console.log(String(r.mode).padEnd(9) + String(r.px).padStart(4) + ' -> prose=' + String(r.proseW).padStart(4) + ' ch=' + String(r.proseCh).padStart(6) + ' cjk=' + String(r.proseCjk).padStart(3) + ' rightGap=' + String(r.rightGapPx).padStart(4) + ' leftDead=' + String(r.leftDeadPx).padStart(4) + ' preScroll=' + r.preScroll + '/' + r.preTotal + ' tbl=' + r.tblScroll + '/' + r.tblTotal);
  }
  console.log('');
  console.log('== 1025 各方案 ==');
  for (const r of out.widths['1025'].plans) {
    console.log(String(r.mode).padEnd(9) + String(r.px).padStart(4) + ' -> prose=' + String(r.proseW).padStart(4) + ' ch=' + String(r.proseCh).padStart(6) + ' preScroll=' + r.preScroll + '/' + r.preTotal);
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
