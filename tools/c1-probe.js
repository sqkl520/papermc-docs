'use strict';
/**
 * c1-probe.js — P1-4 代码 strut 修复的量测探针（只读站点，不写盘到站点目录）
 *
 * 量 3 个页面 × 1440×900：
 *   - .code-pre / 内层 code 的 computed font-size、line-height
 *   - 实际行推进：Range.getClientRects() 逐行取 rect，相邻 top 差 → uniq 值 + 中位数
 *   - 页高（documentElement.scrollHeight）
 *   - 代码块横滚数/总数（.code-scroll 里 pre.scrollWidth > pre.clientWidth+1 或 host 溢出）
 *   - 横向溢出（documentElement.scrollWidth > clientWidth+1）
 *
 * 用法：node tools/c1-probe.js <side>       # side = before | after，结果写系统临时目录 c1\<side>.json
 *      node tools/c1-probe.js before --base=http://127.0.0.1:8787
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const argv = process.argv.slice(2);
const SIDE = argv.find((a) => !a.startsWith('--')) || 'before';
const baseArg = argv.find((a) => a.startsWith('--base='));
const BASE = baseArg ? baseArg.slice('--base='.length) : 'http://127.0.0.1:8787';

const PAGES = ['/paper/dev/dialogs/', '/paper/dev/particles/', '/paper/reference/world-configuration/'];
const VP = { w: 1440, h: 900 };

const MEASURE = () => {
  const cs = (e, p) => getComputedStyle(e)[p];
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

  // 行推进：对一个 code 元素，Range 逐行 rect → 相邻 top 差
  const advanceOf = (el) => {
    if (!el) return null;
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const tops = [...new Set(rects.map((r) => Math.round(r.top * 100) / 100))].sort((a, b) => a - b);
    if (tops.length < 2) return { lines: tops.length, diffs: [], uniq: {}, median: null, min: null, max: null };
    const diffs = [];
    for (let i = 1; i < tops.length; i++) diffs.push(Math.round(tops[i] - tops[i - 1]));
    const hist = {};
    for (const d of diffs) hist[d] = (hist[d] || 0) + 1;
    const sorted = [...diffs].sort((a, b) => a - b);
    return {
      lines: tops.length,
      diffs,
      uniq: hist,
      median: sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  };

  const pre0 = document.querySelector('.code-pre');
  const code0 = pre0 ? (pre0.querySelector('code') || pre0) : null;
  const scrolls = [...document.querySelectorAll('.code-scroll')];

  // 代码横滚：host 或 host 里的 pre 溢出即算（与站内 JS 判据一致）
  let over = 0;
  const overDetail = [];
  scrolls.forEach((h, i) => {
    const pre = h.querySelector('pre');
    const isOver = pre
      ? (pre.scrollWidth > pre.clientWidth + 1 || h.scrollWidth > h.clientWidth + 1)
      : (h.scrollWidth > h.clientWidth + 1);
    if (isOver) {
      over++;
      overDetail.push({
        i,
        preSW: pre ? pre.scrollWidth : null,
        preCW: pre ? pre.clientWidth : null,
        hostSW: h.scrollWidth,
        hostCW: h.clientWidth,
      });
    }
  });

  // 全页所有代码块的行推进聚合（用于 uniq 值 + 中位数）
  const perBlock = [];
  document.querySelectorAll('.code-pre').forEach((pre) => {
    const code = pre.querySelector('code') || pre;
    const a = advanceOf(code);
    if (a && a.diffs.length) perBlock.push(a);
  });
  const allDiffs = perBlock.flatMap((b) => b.diffs).sort((a, b) => a - b);
  const allHist = {};
  for (const d of allDiffs) allHist[d] = (allHist[d] || 0) + 1;

  const html = document.documentElement;

  // 连续空行诊断：空行没有字形 rect，Range.getClientRects() 会跳过它，
  // 于是相邻 top 差 = (空行数+1) × 行推进。用于解释聚合里 >40px 的离群值，避免误判为"行高异常"。
  const blankRuns = [];
  document.querySelectorAll('.code-pre').forEach((pre) => {
    const code = pre.querySelector('code') || pre;
    const lines = (code.textContent || '').split('\n');
    let run = 0;
    for (const ln of lines) {
      if (ln.trim() === '') { run++; } else { if (run > 0) blankRuns.push(run); run = 0; }
    }
    if (run > 0) blankRuns.push(run);
  });
  const blankHist = {};
  for (const r of blankRuns) blankHist[r] = (blankHist[r] || 0) + 1;

  return {
    url: location.pathname,
    viewport: { w: innerWidth, h: innerHeight },
    pre: pre0 ? {
      fontSize: px(cs(pre0, 'fontSize')),
      lineHeight: px(cs(pre0, 'lineHeight')),
      height: Math.round(pre0.getBoundingClientRect().height),
    } : null,
    code: code0 ? {
      fontSize: px(cs(code0, 'fontSize')),
      lineHeight: px(cs(code0, 'lineHeight')),
    } : null,
    // 首块逐行推进（便于人读）
    firstBlock: advanceOf(code0),
    // 全页聚合
    advance: {
      blocks: perBlock.length,
      lines: perBlock.reduce((n, b) => n + b.lines, 0),
      uniq: allHist,
      uniqSorted: Object.keys(allHist).map(Number).sort((a, b) => a - b),
      median: allDiffs.length ? allDiffs[Math.floor(allDiffs.length / 2)] : null,
      min: allDiffs.length ? allDiffs[0] : null,
      max: allDiffs.length ? allDiffs[allDiffs.length - 1] : null,
      samples: allDiffs.length,
    },
    // 离群值归因：连续空行段长 n → 相邻 rect 差 = (n+1)×行推进
    blankRuns: { hist: blankHist, segments: blankRuns.length, blankLines: blankRuns.reduce((a, b) => a + b, 0) },
    pageHeight: html.scrollHeight,
    codeScroll: { overflowing: over, total: scrolls.length, detail: overDetail },
    hOverflow: html.scrollWidth > html.clientWidth + 1,
    docW: { scroll: html.scrollWidth, client: html.clientWidth },
    // 供交叉核对：产物里这条规则是否真的生效
    cssRuleApplied: pre0 ? /(^|\s)14px(\s|$)/.test(cs(pre0, 'fontSize')) : null,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { side: SIDE, base: BASE, at: new Date().toISOString(), viewport: VP, pages: {} };

  for (const u of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: VP.w, height: VP.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE + u, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(400);
    out.pages[u] = await page.evaluate(MEASURE);
    await ctx.close();
  }
  await browser.close();

  const dir = path.join(require("os").tmpdir() || '.', 'c1');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, SIDE + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

  console.log('== ' + SIDE + ' @ ' + BASE + ' 1440x900 ==');
  for (const u of PAGES) {
    const m = out.pages[u];
    console.log(u);
    console.log('   pre fs=' + (m.pre ? m.pre.fontSize : '-') + ' lh=' + (m.pre ? m.pre.lineHeight : '-')
      + ' | code fs=' + (m.code ? m.code.fontSize : '-') + ' lh=' + (m.code ? m.code.lineHeight : '-'));
    console.log('   advance uniq=' + JSON.stringify(m.advance.uniq) + ' median=' + m.advance.median
      + ' min=' + m.advance.min + ' max=' + m.advance.max
      + ' (blocks=' + m.advance.blocks + ' lines=' + m.advance.lines + ')'
      + ' | 空行段=' + JSON.stringify(m.blankRuns.hist) + ' 段数=' + m.blankRuns.segments + ' 空行数=' + m.blankRuns.blankLines);
    console.log('   pageHeight=' + m.pageHeight
      + ' | codeScroll=' + m.codeScroll.overflowing + '/' + m.codeScroll.total
      + ' | hOverflow=' + m.hOverflow + ' docW=' + m.docW.scroll + '/' + m.docW.client);
  }
  console.log('\nwrote ' + file);
})();
