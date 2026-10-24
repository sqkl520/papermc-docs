'use strict';
/* b1v-probe4.js — P0-2 归因三连：
 *  A) 真实鼠标点击（不经 Playwright 自动滚动）
 *  B) locator.click()（Playwright 会 scrollIntoViewIfNeeded）→ 复现"改前 −428"这类基线伪影
 *  C) 在改后站点禁用 openDrawer 的 active.scrollIntoView，看 +27 是否消失
 * 用法: node tools/b1v-probe4.js <port> <outPath>
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

async function prepare(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(BASE + PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }));
  await page.waitForTimeout(400);
}

async function toggleBox(page) {
  return await page.evaluate(() => {
    const t = document.getElementById('nav-toggle');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      topmostIsToggle: !!(el && (el === t || t.contains(el))),
      topmost: el ? el.tagName + '.' + String(el.className).slice(0, 30) : null,
    };
  });
}

// A) 真实鼠标点击
async function realClickCycles(page, width, height) {
  await prepare(page, width, height);
  const box = await toggleBox(page);
  const startY = await page.evaluate(() => window.scrollY);
  const cycles = [];
  for (let i = 0; i < 3; i++) {
    const b = await page.evaluate(() => window.scrollY);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(450);
    const o = await page.evaluate(() => ({ y: window.scrollY, open: document.body.classList.contains('nav-open') }));
    const b2 = await page.evaluate(() => window.scrollY);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(520);
    const c = await page.evaluate(() => ({ y: window.scrollY, open: document.body.classList.contains('nav-open') }));
    cycles.push({
      i, openD: +(o.y - b).toFixed(1), closeD: +(c.y - b2).toFixed(1),
      openState: o.open, closeState: c.open,
    });
  }
  const endY = await page.evaluate(() => window.scrollY);
  return { width, box, startY: +startY.toFixed(1), endY: +endY.toFixed(1), net: +(endY - startY).toFixed(1), cycles };
}

// B) Playwright locator.click（会滚动元素到视口）
async function pwClickCycles(page, width, height) {
  await prepare(page, width, height);
  const startY = await page.evaluate(() => window.scrollY);
  const cycles = [];
  const loc = page.locator('#nav-toggle');
  for (let i = 0; i < 3; i++) {
    const b = await page.evaluate(() => window.scrollY);
    await loc.click();
    await page.waitForTimeout(450);
    const o = await page.evaluate(() => ({ y: window.scrollY, open: document.body.classList.contains('nav-open') }));
    const b2 = await page.evaluate(() => window.scrollY);
    await loc.click();
    await page.waitForTimeout(520);
    const c = await page.evaluate(() => ({ y: window.scrollY, open: document.body.classList.contains('nav-open') }));
    cycles.push({ i, openD: +(o.y - b).toFixed(1), closeD: +(c.y - b2).toFixed(1) });
  }
  const endY = await page.evaluate(() => window.scrollY);
  return { width, startY: +startY.toFixed(1), endY: +endY.toFixed(1), net: +(endY - startY).toFixed(1), cycles };
}

// C) 禁用 active.scrollIntoView 后的真实点击
async function noSivCycles(page, width, height) {
  await prepare(page, width, height);
  await page.evaluate(() => { Element.prototype.scrollIntoView = function () {}; });
  const box = await toggleBox(page);
  const startY = await page.evaluate(() => window.scrollY);
  const cycles = [];
  for (let i = 0; i < 3; i++) {
    const b = await page.evaluate(() => window.scrollY);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(450);
    const o = await page.evaluate(() => window.scrollY);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(520);
    const c = await page.evaluate(() => window.scrollY);
    cycles.push({ i, openD: +(o - b).toFixed(1), closeD: +(c - o).toFixed(1) });
  }
  const endY = await page.evaluate(() => window.scrollY);
  return { width, startY: +startY.toFixed(1), endY: +endY.toFixed(1), net: +(endY - startY).toFixed(1), cycles };
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    out.real390 = await realClickCycles(page, 390, 844);
    out.real320 = await realClickCycles(page, 320, 700);
    out.pw390 = await pwClickCycles(page, 390, 844);
    out.noSiv390 = await noSivCycles(page, 390, 844);
    await ctx.close();
  } catch (e) { out.error = String((e && e.stack) || e); }
  finally { await browser.close(); }
  const j = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, j, 'utf8'); console.log('wrote ' + OUT); } else console.log(j);
})();
