'use strict';
/**
 * b1r2-f.js — 复核 E5：展开态点「页尾目录项」后页面纹丝不动，是动画未完成还是真缺陷？
 *   逐帧采样 scrollY，等 6s，测多个目录项（首/中/尾），并对折叠态做同样采样作为对照。
 * 用法: node tools/b1r2-f.js
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
const PAGE = '/paper/dev/particles/';
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = [];

  for (const vp of [{ n: '390x844', w: 390, h: 844 }, { n: '812x375', w: 812, h: 375 }]) {
    for (const openState of ['collapsed', 'expanded']) {
      for (const which of ['first', 'middle', 'last']) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await ctx.newPage();
        await page.goto(NEW + PAGE, { waitUntil: 'load' });
        await page.waitForTimeout(500);
        if (openState === 'expanded') {
          await page.evaluate(() => { document.querySelector('.toc-fold').open = true; });
          await page.waitForTimeout(500);
        }
        const info = await page.evaluate((w) => {
          const as = Array.from(document.querySelectorAll('.toc-side a[href^="#"]'));
          const idx = w === 'first' ? 0 : (w === 'middle' ? Math.floor(as.length / 2) : as.length - 1);
          const a = as[idx];
          /* 用 JS click 绕过 Playwright 的自动滚入，排除测试工具干扰 */
          window.__b1r2Target = a.getAttribute('href').slice(1);
          return { total: as.length, idx, href: a.getAttribute('href'), id: window.__b1r2Target };
        }, which);
        const t0 = Date.now();
        await page.evaluate(() => { const a = document.querySelector('.toc-side a[href="#' + window.__b1r2Target + '"]'); a.click(); });
        /* 逐帧采样 2 秒，再等 4 秒看是否还在动 */
        const frames = [];
        for (let i = 0; i < 20; i++) { frames.push(await page.evaluate(() => Math.round(window.scrollY))); await page.waitForTimeout(100); }
        await page.waitForTimeout(4000);
        const final = await page.evaluate((id) => {
          const el = document.getElementById(id);
          const b = el.getBoundingClientRect();
          const toc = document.querySelector('.toc-side').getBoundingClientRect();
          const tb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
          return {
            id,
            scrollY: Math.round(window.scrollY),
            maxScroll: Math.round(document.documentElement.scrollHeight - innerHeight),
            headingTop: Math.round(b.top), headingBottom: Math.round(b.bottom), vh: innerHeight,
            tocBottom: Math.round(toc.bottom), topbarBottom: Math.round(tb),
            behindToc: b.top < toc.bottom && b.bottom > toc.top,
            visiblePx: Math.max(0, Math.round(Math.min(b.bottom, innerHeight) - Math.max(b.top, toc.bottom, tb))),
            scrollPad: getComputedStyle(document.documentElement).scrollPaddingTop,
            offsetVar: getComputedStyle(document.documentElement).getPropertyValue('--toc-offset').trim(),
            hash: location.hash,
          };
        }, info.id);
        const row = { vp: vp.n, openState, which, ...info, frames, finalY: final.scrollY, distinctFrames: new Set(frames).size, stillMoving: frames[frames.length - 1] !== final.scrollY, ms: Date.now() - t0, ...final };
        out.push(row);
        log('NAV ' + JSON.stringify({ vp: vp.n, openState, which, total: info.total, idx: info.idx, scrollY: final.scrollY, max: final.maxScroll,
          headingTop: final.headingTop, vh: final.vh, tocBottom: final.tocBottom, behindToc: final.behindToc, visiblePx: final.visiblePx,
          pad: final.scrollPad, distinctFrames: row.distinctFrames, stillMoving: row.stillMoving, framesHead: frames.slice(0, 6).join(','), framesTail: frames.slice(-3).join(',') }));
        await ctx.close();
      }
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-f.json'), JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r2-f.log'), lines.join('\n') + '\n', 'utf8');
  console.log('DONE -> reports/.b1r2-f.json');
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
