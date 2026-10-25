'use strict';
/**
 * c3-cliff.js — 批 3 断崖扫描（只读，不写仓库）
 *
 * 在 /paper/dev/dialogs/ 上做 1021→1300 **逐 1px** 扫描，量 article.clientWidth，
 * 输出所有 |Δ| ≥ 20px 的台阶（位置/幅度/TOC 形态/列宽），并单列关键点。
 *
 * 用法：
 *   node tools/c3-cliff.js --label=before            # 改前基线
 *   node tools/c3-cliff.js --label=after             # 改后
 *   node tools/c3-cliff.js --label=after --page=/paper/   # 换页
 *
 * 产物：TMPDIR/c3/cliff-<label>.json
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const TMP = path.join(os.tmpdir(), 'c3');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const p = '--' + n + '=';
  const h = argv.find((a) => a.startsWith(p));
  return h ? h.slice(p.length) : d;
};

const LABEL = opt('label', 'run');
const PAGE = opt('page', '/paper/dev/dialogs/');
const W0 = Number(opt('w0', 1021));
const W1 = Number(opt('w1', 1300));
const H = Number(opt('h', 900));
const KEYS = [1023, 1024, 1025, 1199, 1200, 1279, 1280, 1300];

/* 采集：只要列宽相关（快） */
const SCAN = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = q('article.article') || q('article');
  const toc = q('.toc-side');
  const side = q('#sidebar') || q('.sidebar');
  const layout = q('.layout');
  const ab = art ? art.getBoundingClientRect() : null;
  const tb = toc ? toc.getBoundingClientRect() : null;
  const tocVis = !!(toc && cs(toc, 'display') !== 'none' && tb.width > 0);
  let mode = 'hidden';
  if (tocVis) {
    if (tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2) mode = 'rail';
    else mode = 'top-block';
  }
  return {
    vw: window.innerWidth,
    artClientW: art ? art.clientWidth : null,
    artW: ab ? r2(ab.width) : null,
    tocMode: mode,
    tocW: tb ? r2(tb.width) : null,
    tocPos: cs(toc, 'position'),
    cols: cs(layout, 'gridTemplateColumns'),
    sidePos: cs(side, 'position'),
    sideW: side ? r2(side.getBoundingClientRect().width) : null,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
};

const settle = async (page, n) => {
  await page.evaluate((k) => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= k) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n == null ? 2 : n);
};

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  let rows = [];
  try {
    const ctx = await browser.newContext({
      viewport: { width: W0, height: H }, deviceScaleFactor: 1,
      colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + PAGE, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(200);
    await settle(page, 2);
    for (let w = W0; w <= W1; w++) {
      await page.setViewportSize({ width: w, height: H });
      await settle(page, 2);
      rows.push(await page.evaluate(SCAN));
    }
    await ctx.close();
  } finally {
    await browser.close();
  }

  /* 台阶：相邻两档 |Δ artClientW| >= 20px */
  const steps = [];
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].artClientW - rows[i - 1].artClientW;
    if (Math.abs(d) >= 20) {
      steps.push({
        from: rows[i - 1].vw, to: rows[i].vw,
        before: rows[i - 1].artClientW, after: rows[i].artClientW,
        delta: d,
        tocBefore: rows[i - 1].tocMode, tocAfter: rows[i].tocMode,
        sideBefore: rows[i - 1].sidePos, sideAfter: rows[i].sidePos,
        colsAfter: rows[i].cols,
      });
    }
  }
  const key = {};
  for (const w of KEYS) {
    const r = rows.find((x) => x.vw === w);
    if (r) key[w] = r;
  }
  const out = { label: LABEL, page: PAGE, range: [W0, W1], stepCount: steps.length, steps, keys: key, rows };
  const file = path.join(TMP, 'cliff-' + LABEL + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8');

  console.log('=== [' + LABEL + '] 台阶（|Δ article.clientWidth| ≥ 20px，' + W0 + '→' + W1 + ' 逐 1px）===');
  console.log('台阶数 = ' + steps.length);
  for (const s of steps) {
    console.log('  ' + s.from + '→' + s.to + ': ' + s.before + ' → ' + s.after
      + '  (' + (s.delta > 0 ? '+' : '') + s.delta + ')  TOC ' + s.tocBefore + '→' + s.tocAfter
      + '  side ' + s.sideBefore + '→' + s.sideAfter + '  cols=' + s.colsAfter);
  }
  if (!steps.length) console.log('  (none)');
  console.log('\n=== 关键点 ===');
  console.log('vw    artClientW  TOC        tocW   cols                          side');
  for (const w of KEYS) {
    const k = key[w];
    if (!k) continue;
    console.log(String(w).padEnd(6) + String(k.artClientW).padEnd(12) + String(k.tocMode).padEnd(11)
      + String(k.tocW).padEnd(7) + String(k.cols).padEnd(30) + k.sidePos);
  }
  console.log('\nWROTE ' + file);
})().catch((e) => { console.error(e); process.exit(1); });
