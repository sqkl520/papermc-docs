'use strict';
/**
 * b1r2-g.js — 定位「点目录项后落点短一截」的机制，并判定是否批 1 引入
 *   G1 变量隔离：原样 / 强制 scroll-behavior:auto / stub IntersectionObserver / 两者都做
 *   G2 距离扫描：目标越远，短多少
 *   G3 改前基线 8788 同协议（用 location.hash 原生片段导航，两侧都有）
 *   G4 原生 location.hash 在改后是否同样短（排除「点击」这一层）
 * 用法: node tools/b1r2-g.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const PAGE = '/paper/dev/particles/';
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const MEASURE = (id) => {
  const el = document.getElementById(id);
  const b = el.getBoundingClientRect();
  const toc = document.querySelector('.toc-side');
  const tb = toc ? toc.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const scrollY = Math.round(window.scrollY);
  const maxScroll = Math.round(document.documentElement.scrollHeight - innerHeight);
  const headingDocY = scrollY + Math.round(b.top);
  const ideal = Math.max(0, Math.min(maxScroll, headingDocY - pad));
  return {
    id, scrollY, maxScroll, pad,
    headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom), vh: innerHeight,
    tocBottom: Math.round(tb.bottom), topbarBottom: Math.round(topbar),
    headingDocY,
    idealScrollY: ideal,
    shortfallPx: ideal - scrollY,
    clamped: ideal === maxScroll,
    visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, tb.height > 2 ? tb.bottom : 0, topbar))),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { isolate: [], distance: [], old: [], native: [] };

  // ---------- G1 变量隔离（390x844，expanded） ----------
  const MODES = [
    { n: 'asis', css: null, stubIO: false },
    { n: 'scrollBehaviorAuto', css: 'html{scroll-behavior:auto !important}', stubIO: false },
    { n: 'stubIntersectionObserver', css: null, stubIO: true },
    { n: 'auto+stubIO', css: 'html{scroll-behavior:auto !important}', stubIO: true },
  ];
  for (const m of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    if (m.stubIO) {
      await page.addInitScript(() => {
        // 让 initToc 提前 return（它要求 IntersectionObserver 存在；我们给一个永不回调的实现）
        window.IntersectionObserver = function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
      });
    }
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    if (m.css) await page.addStyleTag({ content: m.css });
    await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
    await page.waitForTimeout(450);
    const target = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
      const a = as[Math.floor(as.length / 2)];
      return a.getAttribute('href').slice(1);
    });
    await page.evaluate((id) => { document.querySelector('.toc-side a[href="#' + id + '"]').click(); }, target);
    await page.waitForTimeout(5000);
    const r = await page.evaluate(MEASURE, target);
    r.mode = m.n; r.vp = '390x844';
    out.isolate.push(r);
    log('ISOLATE ' + JSON.stringify({ mode: m.n, scrollY: r.scrollY, ideal: r.idealScrollY, shortfall: r.shortfallPx, headingTop: r.headingTop, visiblePx: r.visiblePx, pad: r.pad }));
    await ctx.close();
  }

  // ---------- G2 距离扫描（asis，expanded，390） ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
    await page.waitForTimeout(450);
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.toc-side a[href^="#"]')).map((a) => a.getAttribute('href').slice(1)));
    for (const idx of [0, 5, 10, 20, 40, 60, 82]) {
      if (idx >= ids.length) continue;
      const id = ids[idx];
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.evaluate((i) => { document.querySelectorAll('.toc-side a[href^="#"]')[i].click(); }, idx);
      await page.waitForTimeout(5200);
      const r = await page.evaluate(MEASURE, id);
      r.idx = idx;
      out.distance.push(r);
      log('DIST ' + JSON.stringify({ idx, id, scrollY: r.scrollY, ideal: r.idealScrollY, shortfall: r.shortfallPx, clamped: r.clamped, headingTop: r.headingTop, visiblePx: r.visiblePx }));
    }
    await ctx.close();
  }

  // ---------- G3/G4 改前基线 vs 改后：原生 location.hash ----------
  for (const [tag, base] of [['old', OLD], ['new', NEW]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(base + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('h2[id],h3[id],h4[id]')).map((h) => h.id));
    for (const idx of [0, 20, 40, ids.length - 1]) {
      const id = ids[idx];
      if (!id) continue;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      await page.evaluate((i) => { location.hash = '#' + i; }, id);
      await page.waitForTimeout(5200);
      const r = await page.evaluate(MEASURE, id);
      r.tag = tag; r.idx = idx;
      out.native.push(r);
      log('NATIVE ' + JSON.stringify({ tag, idx, id, scrollY: r.scrollY, ideal: r.idealScrollY, shortfall: r.shortfallPx, pad: r.pad, headingTop: r.headingTop, maxScroll: r.maxScroll, clamped: r.clamped }));
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-g.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-g.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-g.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
