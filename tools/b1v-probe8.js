'use strict';
/* b1v-probe8.js — 终局核验：
 *  1) P0-2 的 preventScroll/scrollY 还原是否真的"承重"（去掉后是否出现掉落）
 *  2) P0-1 声称的"改前 H1 y=1317"能否复现（展开且去掉 max-height 上限）
 *  3) 声称的计数：29 个 .side-home / 13 个 .code-copy 出现在哪一页
 * 用法: node tools/b1v-probe8.js <port> <outPath>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const PORT = process.argv[2] || '8787';
const OUT = process.argv[3];
const BASE = 'http://127.0.0.1:' + PORT;
const PAGE = '/paper/dev/particles/index.html';

function chromePath() {
  const c = [];
  if (process.env.CHROME_PATH) c.push(process.env.CHROME_PATH);
  if (process.env.LOCALAPPDATA) {
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe');
    c.push(process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1234\\chrome-win\\chrome.exe');
  }
  if (process.env.PROGRAMFILES) c.push(process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe');
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  throw new Error('no chrome');
}

// 1) close 阶段：正常 vs 把 focus 的 preventScroll 剥掉
async function closeLoadBearing(page) {
  const run = async (label, strip) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }));
    await page.waitForTimeout(400);
    if (strip) {
      // 去掉 preventScroll：让 focus 恢复默认（会滚动）
      await page.evaluate(() => {
        const of = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (o) { return of.call(this, {}); };
      });
    }
    const b = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => document.getElementById('nav-toggle').click());
    await page.waitForTimeout(500);
    const o = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => document.getElementById('nav-toggle').click());
    await page.waitForTimeout(600);
    const c = await page.evaluate(() => window.scrollY);
    return { label, before: +b.toFixed(1), open: +o.toFixed(1), close: +c.toFixed(1), closeD: +(c - o).toFixed(1), net: +(c - b).toFixed(1) };
  };
  return { normal: await run('preventScroll-kept', false), stripped: await run('preventScroll-stripped', true) };
}

// 2) H1：展开 + 去掉 max-height（模拟"改前"的完全展开）
async function h1Uncapped(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(BASE + PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => {
    const h = document.querySelector('h1'); const t = document.querySelector('.toc-side');
    return { h1Y: +(h.getBoundingClientRect().top + window.scrollY).toFixed(1), tocH: t ? +t.getBoundingClientRect().height.toFixed(1) : null };
  });
  const capped = await page.evaluate(() => {
    const d = document.querySelector('.toc-side .toc-fold'); if (d) d.open = true;
    return null;
  });
  await page.waitForTimeout(350);
  const openCapped = await page.evaluate(() => {
    const h = document.querySelector('h1'); const t = document.querySelector('.toc-side'); const ol = document.querySelector('.toc-fold ol');
    return { h1Y: +(h.getBoundingClientRect().top + window.scrollY).toFixed(1), tocH: t ? +t.getBoundingClientRect().height.toFixed(1) : null, olH: ol ? +ol.getBoundingClientRect().height.toFixed(1) : null, maxH: ol ? getComputedStyle(ol).maxHeight : null };
  });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.toc-fold[open]>ol{max-height:none!important;overflow:visible!important}';
    document.head.appendChild(s);
  });
  await page.waitForTimeout(350);
  const openUncapped = await page.evaluate(() => {
    const h = document.querySelector('h1'); const t = document.querySelector('.toc-side'); const ol = document.querySelector('.toc-fold ol');
    return { h1Y: +(h.getBoundingClientRect().top + window.scrollY).toFixed(1), tocH: t ? +t.getBoundingClientRect().height.toFixed(1) : null, olH: ol ? +ol.getBoundingClientRect().height.toFixed(1) : null };
  });
  return { width, closed, openCapped, openUncapped };
}

// 3) 计数
async function counts(page) {
  const out = {};
  for (const p of ['/index.html', '/sections/paper.html', PAGE, '/paper/anti-xray/index.html']) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(350);
    out[p] = await page.evaluate(() => ({
      sideHome: document.querySelectorAll('.side-group-title a.side-home').length,
      codeCopy: document.querySelectorAll('.code-copy').length,
      tocLinks: document.querySelectorAll('.toc-side li a').length,
      codeScroll: document.querySelectorAll('.code-scroll').length,
      alertTitle: document.querySelectorAll('.alert-title').length,
    }));
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    out.closeLB = await closeLoadBearing(page);
    out.h1_390 = await h1Uncapped(page, 390);
    out.h1_320 = await h1Uncapped(page, 320);
    out.counts = await counts(page);
    await ctx.close();
  } catch (e) { out.error = String((e && e.stack) || e); }
  finally { await browser.close(); }
  const j = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, j, 'utf8'); console.log('wrote ' + OUT); } else console.log(j);
})();
