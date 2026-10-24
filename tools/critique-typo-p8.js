'use strict';
/**
 * critique-typo-p8.js — 下限（下限不足）修复方案实测 + 方案 A 在「列表型长页」的适用性
 *
 *  问题：max-width 只能封顶，不能兜底。1025–1150 区间侧栏290 + 右栏250 把正文挤到 50ch。
 *  候选兜底方案：
 *    F1. 把右栏 TOC 的断点从 1025 上移到 N（N 由「正文 ≥60ch」反解）
 *    F2. 该区间把侧栏从 290 收窄到 240
 *    F3. 该区间把 TOC 从 250 收窄到 200
 *  并验证方案 A（只给行文块限宽）在 world-configuration（96% 内容是嵌套 li）上的覆盖度
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

/* 测正文列几何 */
const GEO = () => {
  const art = document.querySelector('.article');
  const p = art.querySelector('p:not(.page-desc):not(.page-meta)');
  const cs = getComputedStyle(p);
  const cvs = document.createElement('canvas').getContext('2d');
  cvs.font = cs.fontSize + ' ' + cs.fontFamily;
  const zeroW = cvs.measureText('0').width;
  const fsPx = parseFloat(cs.fontSize);
  const pr = p.getBoundingClientRect();
  const toc = document.querySelector('.toc-side');
  return {
    vw: window.innerWidth,
    articleW: Math.round(art.getBoundingClientRect().width),
    proseW: Math.round(pr.width),
    ch: Math.round((pr.width / zeroW) * 10) / 10,
    cjk: Math.round(pr.width / fsPx),
    zeroW: Math.round(zeroW * 100) / 100,
    tocVisible: toc ? getComputedStyle(toc).display !== 'none' : false,
    tocW: toc && getComputedStyle(toc).display !== 'none' ? Math.round(toc.getBoundingClientRect().width) : 0,
    sidebarW: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
  };
};

/* 方案 A 覆盖度：给行文块限宽后，还有多少正文行宽超过目标 */
const COVERAGE = (px) => {
  const art = document.querySelector('.article');
  const st = document.createElement('style');
  st.id = 'cov';
  st.textContent = '.article p,.article li,.article blockquote{max-width:' + px + 'px!important}';
  document.head.appendChild(st);
  const over = [];
  let total = 0;
  for (const p of art.querySelectorAll('p')) {
    if (p.closest('.page-meta,.page-desc,.code-block,.table-wrap')) continue;
    const t = (p.textContent || '').trim();
    if (t.length < 40) continue;
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1);
    for (const r of rects) { total++; if (r.width > px + 1) over.push(Math.round(r.width)); }
  }
  st.remove();
  return { target: px, linesTotal: total, linesOver: over.length, worstPx: over.length ? Math.max(...over) : 0 };
};

(async () => {
  if (!EXE) { console.error('NO_BROWSER'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
  const out = { floorFix: [], coverage: {}, baseline: [] };

  /* 1) 基线：1024~1200 逐点扫，找正文 ch 的断崖 */
  for (const w of [1024, 1025, 1060, 1100, 1140, 1180, 1200, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(100);
    out.baseline.push(await page.evaluate(GEO));
    await ctx.close();
  }

  /* 2) 兜底方案：在 1025 / 1100 / 1140 下模拟 F1/F2/F3 */
  const FIXES = [
    { name: '基线', css: '' },
    { name: 'F2 侧栏240', css: '@media(min-width:1025px) and (max-width:1279px){.layout,.layout.has-toc{grid-template-columns:240px minmax(0,1fr) 250px!important}}' },
    { name: 'F2b 侧栏256', css: '@media(min-width:1025px) and (max-width:1279px){.layout,.layout.has-toc{grid-template-columns:256px minmax(0,1fr) 250px!important}}' },
    { name: 'F3 TOC200', css: '@media(min-width:1025px) and (max-width:1279px){.layout.has-toc{grid-template-columns:290px minmax(0,1fr) 200px!important}}' },
    { name: 'F2+F3 (256/200)', css: '@media(min-width:1025px) and (max-width:1279px){.layout.has-toc{grid-template-columns:256px minmax(0,1fr) 200px!important}}' },
    { name: 'F1 TOC上移到1160', css: '@media(min-width:1025px) and (max-width:1159px){.layout.has-toc{grid-template-columns:290px minmax(0,1fr)!important}.toc-side{display:none!important}}' },
  ];
  for (const w of [1025, 1100, 1140]) {
    for (const f of FIXES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'light' });
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load' });
      if (f.css) await page.addStyleTag({ content: f.css });
      await page.waitForTimeout(120);
      const g = await page.evaluate(GEO);
      out.floorFix.push({ vw: w, fix: f.name, ...g });
      await ctx.close();
    }
  }

  /* 3) 方案 A 覆盖度（长页 + 正文页） */
  for (const pg of ['/paper/reference/world-configuration/', '/paper/dev/dialogs/', '/velocity/tuning/']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE + pg, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    const rows = [];
    for (const px of [560, 605, 614, 630, 640, 660, 704]) rows.push(await page.evaluate(COVERAGE, px));
    out.coverage[pg] = rows;
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, '..', 'reports', '.critique-typo-p8.json'), JSON.stringify(out, null, 1), 'utf8');

  console.log('== 基线断崖（正文 ch 随视口）==');
  for (const b of out.baseline) console.log(String(b.vw).padEnd(6) + 'article=' + String(b.articleW).padStart(4) + ' prose=' + String(b.proseW).padStart(4) + ' ch=' + String(b.ch).padStart(6) + ' cjk=' + String(b.cjk).padStart(3) + ' toc=' + (b.tocVisible ? b.tocW : 'none'));
  console.log('');
  console.log('== 兜底方案 ==');
  for (const r of out.floorFix) console.log(String(r.vw).padEnd(6) + String(r.fix).padEnd(20) + 'prose=' + String(r.proseW).padStart(4) + ' ch=' + String(r.ch).padStart(6) + ' cjk=' + String(r.cjk).padStart(3) + ' toc=' + (r.tocVisible ? r.tocW : 'none'));
  console.log('');
  console.log('== 方案A 覆盖度 ==');
  for (const k of Object.keys(out.coverage)) {
    console.log(k);
    for (const r of out.coverage[k]) console.log('   target=' + String(r.target).padStart(4) + ' lines=' + String(r.linesTotal).padStart(4) + ' over=' + String(r.linesOver).padStart(4) + ' worst=' + r.worstPx);
  }
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
