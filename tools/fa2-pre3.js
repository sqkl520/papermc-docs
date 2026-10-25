'use strict';
/**
 * fa2-pre3.js — 断言 #9 的「C3 之前」对照（只读：route 级换 assets/site.css）
 *
 * 为什么不能拿 8788（a19a6c2）当 C3 的 before：a19a6c2 是**批 0 之前**，它自己也只有一级台阶
 * （1200→1201，−259），两级台阶是批 0（fcdf3e1）引入的。C3 的直接 before 是 `9c82b47`。
 *
 * 做法：保持当前 HTML/JS 不变，仅用 Playwright route 把 /assets/site.css 的响应体换成
 * `git show 9c82b47:assets/site.css`。不写任何文件到仓库，也不改产物。
 * 局限（必须写进报告）：这是 CSS 单因子对照；C3 的 commit 同时改了 site.js 的两处阈值，
 * 但「台阶位置与幅度」由 CSS 网格决定，JS 只影响抽屉/TOC 的交互形态，不影响 artW。
 *
 * 用法: node tools/fa2-pre3.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:8787';
const TMP = path.join(os.tmpdir(), 'fa2');
fs.mkdirSync(TMP, { recursive: true });

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const cssAt = (rev) => execFileSync('git', ['show', rev + ':assets/site.css'], { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8');

const GEOM = () => {
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const q = (s) => document.querySelector(s);
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = q('article.article') || q('article');
  const toc = q('.toc-side');
  const layout = q('.layout');
  const ab = art ? art.getBoundingClientRect() : null;
  const tb = toc ? toc.getBoundingClientRect() : null;
  const tocVis = !!(toc && cs(toc, 'display') !== 'none' && tb.width > 0);
  let mode = 'hidden';
  if (tocVis) mode = (tb.width < 400 && tb.width < window.innerWidth * 0.5 && ab && tb.x >= ab.x + ab.width - 2) ? 'rail' : 'top-block';
  return { vw: window.innerWidth, artW: ab ? r2(ab.width) : null, tocMode: mode, tocW: tb ? r2(tb.width) : null, cols: cs(layout, 'gridTemplateColumns') };
};

const settle = (page, k) => page.evaluate((n) => new Promise((res) => {
  let i = 0;
  const step = () => { if (++i >= n) res(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), k || 1);

(async () => {
  if (!EXE) throw new Error('no chrome executable found');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), variants: {} };
  try {
    for (const rev of ['9c82b47', '5d0831b', '4ce8407']) {
      const css = cssAt(rev);
      const ctx = await browser.newContext({
        viewport: { width: 1021, height: 900 }, deviceScaleFactor: 1,
        colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true,
      });
      await ctx.route('**/assets/site.css*', (route) => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css }));
      const page = await ctx.newPage();
      await page.goto(BASE + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(140);
      const rows = [];
      for (let w = 1021; w <= 1300; w++) {
        await page.setViewportSize({ width: w, height: 900 });
        await settle(page, 1);
        rows.push(await page.evaluate(GEOM));
      }
      await ctx.close();
      const steps = [];
      for (let i = 1; i < rows.length; i++) {
        const d = rows[i].artW - rows[i - 1].artW;
        if (Math.abs(d) >= 20) steps.push({ at: rows[i].vw, from: rows[i - 1].artW, to: rows[i].artW, d: Math.round(d * 100) / 100, tocMode: rows[i].tocMode, cols: rows[i].cols });
      }
      const at = (w) => (rows.find((r) => r.vw === w) || {});
      out.variants[rev] = {
        cssLen: css.length, steps, count: steps.length,
        key: { 1023: at(1023).artW, 1024: at(1024).artW, 1025: at(1025).artW, 1199: at(1199).artW, 1200: at(1200).artW, 1440: at(1440).artW },
        keyMode: { 1023: at(1023).tocMode, 1024: at(1024).tocMode, 1025: at(1025).tocMode, 1199: at(1199).tocMode, 1200: at(1200).tocMode, 1440: at(1440).tocMode },
      };
      console.log('=== ' + rev + ' (css ' + css.length + 'B) 台阶数=' + steps.length + ' ===');
      for (const s of steps) console.log('  ' + s.at + ': ' + s.from + ' -> ' + s.to + '  Δ=' + s.d + '  toc=' + s.tocMode + '  cols=' + s.cols);
      console.log('  artW 1023/1024/1025/1199/1200/1440 = ' + JSON.stringify(out.variants[rev].key) + '  toc=' + JSON.stringify(out.variants[rev].keyMode));
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(TMP, 'fa2-pre3.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(TMP, 'fa2-pre3.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
