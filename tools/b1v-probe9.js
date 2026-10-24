'use strict';
/* b1v-probe9.js — 最后两项：
 *  1) ≥1025 右栏是否出现"嵌套滚动"（aside overflow-y:auto + ol max-height 自身滚动）
 *  2) 文本选择回归的稳健性（两次拖动 + 键盘选区 + 双击，并记录 selectionchange）
 *  3) 1023 档锚点遮挡量（sticky TOC 与 scroll-padding 的缺口）
 * 用法: node tools/b1v-probe9.js <port> <outPath>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const PORT = process.argv[2] || '8787';
const OUT = process.argv[3];
const BASE = 'http://127.0.0.1:' + PORT;
const PAGE = '/paper/dev/particles/index.html';
const LAND = '/index.html';

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

async function nestedScroll(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  return await page.evaluate(() => {
    const aside = document.querySelector('.toc-side');
    const ol = aside ? aside.querySelector('.toc-fold ol') : null;
    const csA = aside ? getComputedStyle(aside) : null;
    const csO = ol ? getComputedStyle(ol) : null;
    return {
      asideOverflowY: csA ? csA.overflowY : null,
      asideMaxH: csA ? csA.maxHeight : null,
      asideClientH: aside ? aside.clientHeight : null,
      asideScrollH: aside ? aside.scrollHeight : null,
      olOverflowY: csO ? csO.overflowY : null,
      olMaxH: csO ? csO.maxHeight : null,
      olClientH: ol ? ol.clientHeight : null,
      olScrollH: ol ? ol.scrollHeight : null,
      olScrolls: ol ? ol.scrollHeight > ol.clientHeight + 1 : null,
      asideScrolls: aside ? aside.scrollHeight > aside.clientHeight + 1 : null,
      nested: !!(aside && ol && aside.scrollHeight > aside.clientHeight + 1 && ol.scrollHeight > ol.clientHeight + 1),
    };
  });
}

async function selectionRobust(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + LAND, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.src-item'))
      .find((i) => i.querySelector('.src-sum') && i.querySelector('.src-rel'));
    if (!row) return null;
    row.scrollIntoView({ block: 'center', behavior: 'instant' });
    const sum = row.querySelector('.src-sum');
    const rel = row.querySelector('.src-rel');
    const r = sum.getBoundingClientRect();
    const rr = rel.getBoundingClientRect();
    return {
      sum: { x1: r.left + 3, x2: r.right - 3, y: r.top + r.height / 2, w: r.width },
      rel: { x1: rr.left + 2, x2: rr.right - 2, y: rr.top + rr.height / 2, w: rr.width },
      sumPE: getComputedStyle(sum).pointerEvents,
      relPE: getComputedStyle(rel).pointerEvents,
      sumUserSelect: getComputedStyle(sum).userSelect,
      sumText: sum.textContent.slice(0, 40),
      relText: rel.textContent.slice(0, 40),
    };
  });
  if (!geo) return { error: 'no dst row' };
  await page.waitForTimeout(200);

  const dragSlow = async (a, b, y, steps) => {
    await page.evaluate(() => { const s = window.getSelection(); if (s) s.removeAllRanges(); });
    await page.mouse.move(a, y);
    await page.mouse.down();
    for (let k = 1; k <= steps; k++) { await page.mouse.move(a + ((b - a) * k) / steps, y); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.waitForTimeout(180);
    return page.evaluate(() => { const s = window.getSelection(); return { len: s ? s.toString().length : 0, text: (s ? s.toString() : '').slice(0, 40) }; });
  };

  const r1 = await dragSlow(geo.sum.x1, geo.sum.x2, geo.sum.y, 12);
  const r2 = await dragSlow(geo.rel.x1, geo.rel.x2, geo.rel.y, 12);
  // 键盘：点进段落再 Shift+End / Ctrl+A
  await page.mouse.click(geo.sum.x1 + 2, geo.sum.y);
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  const kb = await page.evaluate(() => { const s = window.getSelection(); return { len: s ? s.toString().length : 0, text: (s ? s.toString() : '').slice(0, 40) }; });
  // 双击
  await page.mouse.dblclick(geo.sum.x1 + 8, geo.sum.y);
  await page.waitForTimeout(180);
  const dbl = await page.evaluate(() => { const s = window.getSelection(); return { len: s ? s.toString().length : 0, text: (s ? s.toString() : '').slice(0, 40) }; });

  // 同时验证：点这一行是否仍然能跳转（拉伸链接确实生效）
  const href = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.src-item'))
      .find((i) => i.querySelector('.src-sum') && i.querySelector('.src-rel'));
    if (!row) return null;
    const rr = row.getBoundingClientRect();
    const el = document.elementFromPoint(rr.left + rr.width * 0.9, rr.top + rr.height / 2);
    const a = el && el.closest('a');
    return a ? a.getAttribute('href') : null;
  });
  return { geo, drag: { sum: r1, rel: r2 }, keyboard: kb, dblclick: dbl, clickTargetHref: href };
}

async function anchorGap(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(BASE + PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return await page.evaluate((w) => {
    const hs = document.querySelectorAll('article h2[id], article h3[id]');
    const h = hs[1] || hs[0];
    const toc = document.querySelector('.toc-side');
    const tb = document.querySelector('.topbar');
    const tocVisible = toc && getComputedStyle(toc).display !== 'none';
    if (!h) return null;
    document.documentElement.style.scrollBehavior = 'auto';
    const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop || '0');
    const top = h.getBoundingClientRect().top + window.scrollY - pad;
    window.scrollTo({ top, behavior: 'instant' });
    const r = h.getBoundingClientRect();
    const tocR = tocVisible ? toc.getBoundingClientRect() : null;
    const tbR = tb.getBoundingClientRect();
    return {
      width: w,
      scrollPadTop: pad,
      topbarBottom: +tbR.bottom.toFixed(1),
      tocVisible,
      tocTop: tocR ? +tocR.top.toFixed(1) : null,
      tocBottom: tocR ? +tocR.bottom.toFixed(1) : null,
      headingTop: +r.top.toFixed(1),
      headingHeight: +r.height.toFixed(1),
      hiddenPx: tocR ? +Math.max(0, tocR.bottom - r.top).toFixed(1) : 0,
      fullyVisible: tocR ? r.top >= tocR.bottom : r.top >= tbR.bottom,
    };
  }, width);
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    out.nested1280 = await nestedScroll(page);
    out.selection = await selectionRobust(page);
    out.anchor1023 = await anchorGap(page, 1023);
    out.anchor390 = await anchorGap(page, 390);
    out.anchor1280 = await anchorGap(page, 1280);
    await ctx.close();
  } catch (e) { out.error = String((e && e.stack) || e); }
  finally { await browser.close(); }
  const j = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, j, 'utf8'); console.log('wrote ' + OUT); } else console.log(j);
})();
