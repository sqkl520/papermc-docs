'use strict';
/**
 * c3-preview.js — 批 3 断崖修复的**内存预演**（不写任何仓库文件）
 *
 * 用 page.route 改写 site.css / site.js 的响应体，逐字节等价地预演真实补丁，
 * 在 1021→1300 逐 1px 扫描 article.clientWidth，比较：
 *   base      无改写（现状：1023/1024/1025 两级台阶）
 *   cap1000   目标态：1024/1025 同绑 1200 + `@media (min-width:1000px){.content{max-width:1000px}}`
 *   cap1024   对照：补偿只从 1024 起（c23 原案）→ 1024 处残留 −23px
 *   nocap     对照：不补封顶 → 主台阶放大（−539）
 *
 * 用法：node tools/c3-preview.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8787';
const PAGE = '/paper/dev/dialogs/';
const TMP = path.join(os.tmpdir(), 'c3');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* ---- 与真实补丁一一对应的替换 ---- */
function patchJs(src) {
  return src
    .replace(/min-width:1024px/g, 'min-width:1200px')
    .replace(/min-width:1025px/g, 'min-width:1200px')
    .replace(/window\.innerWidth >= 1025/g, 'window.innerWidth >= 1200')
    .replace(/window\.innerWidth < 1025/g, 'window.innerWidth < 1200');
}

function mergeCss(src) {
  return src
    .replace(/@media \(max-width:1024\.98px\)/g, '@media (max-width:1199.98px)')
    .replace(/@media \(min-width:1024px\)/g, '@media (min-width:1200px)')
    .replace(/@media \(min-width:1025px\)/g, '@media (min-width:1200px)');
}
const CSS_CAP1000 = (src) => mergeCss(src) + '\n@media (min-width:1000px){.content{max-width:1000px}}\n';
const CSS_CAP1024 = (src) => mergeCss(src) + '\n@media (min-width:1024px) and (max-width:1199.98px){.content{padding:1.4rem 1.6rem 3rem;max-width:1000px}}\n';
const CSS_NOCAP = (src) => mergeCss(src);

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
    tocMode: mode, tocW: tb ? r2(tb.width) : null,
    tocPos: cs(toc, 'position'),
    cols: cs(layout, 'gridTemplateColumns'),
    sidePos: cs(side, 'position'),
    menuBtn: (() => { const b = q('#nav-toggle'); return b ? cs(b, 'display') : null; })(),
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const settle = async (page, n) => {
  await page.evaluate((k) => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= k) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n == null ? 2 : n);
};

async function scan(browser, name, cssFn) {
  const ctx = await browser.newContext({
    viewport: { width: 1021, height: 900 }, deviceScaleFactor: 1,
    colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
  });
  if (cssFn) {
    await ctx.route('**/assets/site.js', async (route) => {
      const res = await route.fetch();
      return route.fulfill({ status: res.status(), headers: res.headers(), body: patchJs(await res.text()) });
    });
    await ctx.route('**/assets/site.css', async (route) => {
      const res = await route.fetch();
      return route.fulfill({ status: res.status(), headers: res.headers(), body: cssFn(await res.text()) });
    });
  }
  const page = await ctx.newPage();
  await page.goto(BASE + PAGE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(200);
  await settle(page, 2);
  const rows = [];
  for (let w = 1021; w <= 1300; w++) {
    await page.setViewportSize({ width: w, height: 900 });
    await settle(page, 2);
    rows.push(await page.evaluate(SCAN));
  }
  await ctx.close();
  const steps = [];
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].artClientW - rows[i - 1].artClientW;
    if (Math.abs(d) >= 20) {
      steps.push({
        from: rows[i - 1].vw, to: rows[i].vw, before: rows[i - 1].artClientW, after: rows[i].artClientW, delta: d,
        tocBefore: rows[i - 1].tocMode, tocAfter: rows[i].tocMode, sideAfter: rows[i].sidePos, colsAfter: rows[i].cols,
      });
    }
  }
  const keys = {};
  for (const w of [1023, 1024, 1025, 1100, 1199, 1200, 1279, 1280, 1300]) keys[w] = rows.find((r) => r.vw === w);
  return { variant: name, steps, stepCount: steps.length, keys, maxHOverflow: Math.max(...rows.map((r) => r.hOverflow)) };
}

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  let out = [];
  try {
    out.push(await scan(browser, 'base', null));
    out.push(await scan(browser, 'cap1000', CSS_CAP1000));
    out.push(await scan(browser, 'cap1024', CSS_CAP1024));
    out.push(await scan(browser, 'nocap', CSS_NOCAP));
  } finally {
    await browser.close();
  }
  for (const v of out) {
    console.log('\n=== [' + v.variant + '] 台阶数=' + v.stepCount + '  maxHOverflow=' + v.maxHOverflow + ' ===');
    for (const s of v.steps) {
      console.log('  ' + s.from + '→' + s.to + ': ' + s.before + ' → ' + s.after + '  (' + (s.delta > 0 ? '+' : '') + s.delta
        + ')  TOC ' + s.tocBefore + '→' + s.tocAfter + '  side=' + s.sideAfter + '  cols=' + s.colsAfter);
    }
    if (!v.steps.length) console.log('  (none)');
    console.log('  vw     artW   TOC        cols                          menuBtn');
    for (const w of [1023, 1024, 1025, 1100, 1199, 1200, 1279, 1280, 1300]) {
      const k = v.keys[w];
      console.log('  ' + String(w).padEnd(6) + String(k.artClientW).padEnd(7) + String(k.tocMode).padEnd(11)
        + String(k.cols).padEnd(30) + k.menuBtn);
    }
  }
  const f = path.join(TMP, 'preview.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
  console.log('\nWROTE ' + f);
})().catch((e) => { console.error(e); process.exit(1); });
