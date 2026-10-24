'use strict';
/* b1v-probe5.js — 精细归因：
 *  A) 打开抽屉时 +27 漂移的真正来源（逐项禁用 openDrawer 的子步骤）
 *  B) P0-4 拉伸链接对文本选择/复制的影响（before vs after）
 *  C) P1-3 渐隐 ::after 是否真的有可见背景（而不是透明）
 *  D) P0-1 声称的"改前 H1 y=1317"能否在当前树上复现（强制展开 details）
 * 用法: node tools/b1v-probe5.js <port> <outPath>
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const PORT = process.argv[2] || '8787';
const OUT = process.argv[3];
const BASE = 'http://127.0.0.1:' + PORT;
const PAGE_TOC = '/paper/dev/particles/index.html';
const PAGE_LAND = '/index.html';
const PAGE_CODE = '/paper/anti-xray/index.html';

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

// A) 单次打开的逐项归因
async function openAttribution(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const runOnce = async (label, setup) => {
    await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }));
    await page.waitForTimeout(400);
    if (setup) await setup();
    const before = await page.evaluate(() => window.scrollY);
    // 记录整段事件
    await page.evaluate(() => {
      window.__ev = [];
      const p = (o) => window.__ev.push(Object.assign({ t: Math.round(performance.now()), y: +window.scrollY.toFixed(1) }, o));
      window.addEventListener('scroll', () => p({ ev: 'scroll' }), { passive: true });
      const si = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...a) { p({ ev: 'scrollIntoView', on: this.tagName + '.' + String(this.className).slice(0, 20) }); return si.apply(this, a); };
      const fo = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (...a) { p({ ev: 'focus', on: this.tagName + '.' + String(this.className).slice(0, 20), opt: JSON.stringify(a) }); return fo.apply(this, a); };
      window.__p = p;
    });
    await page.evaluate(() => { document.getElementById('nav-toggle').click(); });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.scrollY);
    const ev = await page.evaluate(() => window.__ev);
    return { label, before: +before.toFixed(1), after: +after.toFixed(1), delta: +(after - before).toFixed(1), ev };
  };

  const out = {};
  out.baseline = await runOnce('baseline-as-is');
  out.noSIV = await runOnce('scrollIntoView-noop', async () => {
    await page.evaluate(() => { Element.prototype.scrollIntoView = function () {}; });
  });
  out.noFocusScroll = await runOnce('focus-preventScroll-forced-noop-focus', async () => {
    await page.evaluate(() => { HTMLElement.prototype.focus = function () {}; });
  });
  out.noOverflowLock = await runOnce('body-overflow-lock-disabled', async () => {
    await page.evaluate(() => {
      const d = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'overflow');
      // 简化：阻止 body.style.overflow 被设置
      Object.defineProperty(document.body.style, 'overflow', { set() {}, get() { return ''; }, configurable: true });
    });
  });
  out.noInert = await runOnce('inert-disabled', async () => {
    await page.evaluate(() => {
      Object.defineProperty(HTMLElement.prototype, 'inert', { set() {}, get() { return false; }, configurable: true });
    });
  });
  out.noStickyToc = await runOnce('toc-static', async () => {
    await page.evaluate(() => { const s = document.createElement('style'); s.textContent = '.toc-side{position:static!important}'; document.head.appendChild(s); });
  });
  return out;
}

// B) 文本选择/复制
async function selectionTest(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BASE + PAGE_LAND, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const target = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.src-item'))
      .find((i) => (i.querySelector('.src-sum') || {}).textContent);
    if (!row) return null;
    row.scrollIntoView({ block: 'center', behavior: 'instant' });
    const sum = row.querySelector('.src-sum');
    const r = sum.getBoundingClientRect();
    const rel = row.querySelector('.src-rel');
    const rr = rel ? rel.getBoundingClientRect() : null;
    return {
      sum: { x1: r.left + 4, x2: r.left + Math.min(200, r.width - 4), y: r.top + r.height / 2, text: sum.textContent.slice(0, 30) },
      rel: rr ? { x1: rr.left + 2, x2: rr.left + Math.min(120, rr.width - 2), y: rr.top + rr.height / 2, text: rel.textContent.slice(0, 30) } : null,
      link: (() => { const a = row.querySelector('.src-link'); const ar = a.getBoundingClientRect(); return { x1: ar.left + 2, x2: ar.left + ar.width - 2, y: ar.top + ar.height / 2, text: a.textContent }; })(),
      sumPE: getComputedStyle(sum).pointerEvents,
      relPE: rel ? getComputedStyle(rel).pointerEvents : null,
      linkPos: getComputedStyle(row.querySelector('.src-link')).position,
    };
  });
  if (!target) return { error: 'no target' };
  await page.waitForTimeout(200);

  const drag = async (x1, x2, y) => {
    await page.evaluate(() => { const s = window.getSelection(); if (s) s.removeAllRanges(); });
    await page.mouse.move(x1, y);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) { await page.mouse.move(x1 + ((x2 - x1) * k) / 10, y); await page.waitForTimeout(20); }
    await page.mouse.up();
    await page.waitForTimeout(150);
    return await page.evaluate(() => {
      const s = window.getSelection();
      return { len: s ? s.toString().length : 0, text: s ? s.toString().slice(0, 50) : '' };
    });
  };

  const sumSel = await drag(target.sum.x1, target.sum.x2, target.sum.y);
  const relSel = target.rel ? await drag(target.rel.x1, target.rel.x2, target.rel.y) : null;
  const linkSel = await drag(target.link.x1, target.link.x2, target.link.y);

  // 程序化全选是否还能拷贝到正文（三击/双击段落）
  const dbl = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.src-item')).find((i) => (i.querySelector('.src-sum') || {}).textContent);
    const sum = row.querySelector('.src-sum');
    const r = sum.getBoundingClientRect();
    return { x: r.left + 10, y: r.top + r.height / 2 };
  });
  await page.mouse.dblclick(dbl.x, dbl.y);
  await page.waitForTimeout(200);
  const dblSel = await page.evaluate(() => {
    const s = window.getSelection();
    return { len: s ? s.toString().length : 0, text: s ? s.toString().slice(0, 60) : '' };
  });
  return { target, sumSel, relSel, linkSel, dblSel };
}

// C) P1-3 渐隐可见性
async function fadeCheck(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + PAGE_CODE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  return await page.evaluate(() => {
    const flagged = Array.from(document.querySelectorAll('.code-scroll[data-overflowing]'));
    const rows = flagged.map((s) => {
      const a = getComputedStyle(s, '::after');
      return {
        w: a.width, bgImg: a.backgroundImage.slice(0, 120), bgColor: a.backgroundColor,
        content: a.content, pointer: a.pointerEvents, zIndex: a.zIndex, pos: a.position,
      };
    });
    const titles = Array.from(document.querySelectorAll('.code-block')).filter((b) => b.querySelector('.code-scroll[data-overflowing]'))
      .map((b) => {
        const t = b.querySelector('.code-title');
        const ta = getComputedStyle(t, '::after');
        return { content: ta.content, color: ta.color, fontSize: ta.fontSize, display: ta.display };
      });
    return { flagged: flagged.length, afterStyle: rows.slice(0, 3), titleHints: titles.slice(0, 3), titleHintCount: titles.length };
  });
}

// D) P0-1 强制展开 = 模拟改前，测 H1 y
async function forcedOpenH1(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(BASE + PAGE_TOC, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const aside = document.querySelector('.toc-side');
    return {
      h1Y: +(h1.getBoundingClientRect().top + window.scrollY).toFixed(1),
      tocH: aside ? +aside.getBoundingClientRect().height.toFixed(1) : null,
    };
  });
  await page.evaluate(() => { const d = document.querySelector('.toc-side .toc-fold'); if (d) d.open = true; });
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const aside = document.querySelector('.toc-side');
    const ol = document.querySelector('.toc-side .toc-fold ol');
    return {
      h1Y: +(h1.getBoundingClientRect().top + window.scrollY).toFixed(1),
      tocH: aside ? +aside.getBoundingClientRect().height.toFixed(1) : null,
      olScrollH: ol ? ol.scrollHeight : null,
      olClientH: ol ? ol.clientHeight : null,
      olMaxH: ol ? getComputedStyle(ol).maxHeight : null,
    };
  });
  return { width, closed, opened };
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { port: PORT };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    out.openAttr = await openAttribution(page);
    out.selection1280 = await selectionTest(page, 1280);
    out.selection390 = await selectionTest(page, 390);
    out.fade = await fadeCheck(page);
    out.forced390 = await forcedOpenH1(page, 390);
    out.forced320 = await forcedOpenH1(page, 320);
    await ctx.close();
  } catch (e) { out.error = String((e && e.stack) || e); }
  finally { await browser.close(); }
  const j = JSON.stringify(out, null, 1);
  if (OUT) { fs.writeFileSync(OUT, j, 'utf8'); console.log('wrote ' + OUT); } else console.log(j);
})();
