'use strict';
/**
 * b1s-stretch2.js — 冲突 4 修正版：按「元素自身中心」取坐标，消除 b1s-stretch.js 的行中线误差
 *
 * b1s-stretch.js 的问题：390 档 .src-item 高 109.58（三行折行），行中线并不在任何一段上，
 * 于是 src-rel 的拖选/双击全部落空，且整行命中率被算成 100%（实际 rel 段在下方）。
 * 本脚本对 src-link / src-sum / src-rel **各自**取 getBoundingClientRect() 的中心点。
 *
 * 测：拖选(逐段) / 双击取词(逐段) / 右键目标(逐段) / Tab 焦点环 / 整行分段命中(按各段真实 y)
 * 只读站点；写 TMPDIR\b1s\stretch2.json。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const TMP = path.join(require("os").tmpdir() || '.', 'b1s');
fs.mkdirSync(TMP, { recursive: true });
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const NEW = 'http://127.0.0.1:8787';
const OLD = 'http://127.0.0.1:8788';
const PAGE = '/index.html';
const log = (o) => console.log(JSON.stringify(o));

async function geo(page, idx) {
  return page.evaluate((i) => {
    const rows = document.querySelectorAll('.src-item');
    const r = rows[i];
    if (!r) return null;
    r.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rb = r.getBoundingClientRect();
    const parts = {};
    for (const k of ['src-link', 'src-sum', 'src-rel']) {
      const el = r.querySelector('.' + k);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      const hitC = document.elementFromPoint(b.x + Math.min(b.width / 2, 30), b.y + b.height / 2);
      parts[k] = {
        x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2),
        cx: +(b.x + Math.min(b.width / 2, 30)).toFixed(2), cy: +(b.y + b.height / 2).toFixed(2),
        pe: getComputedStyle(el).pointerEvents, us: getComputedStyle(el).userSelect,
        hitTag: hitC ? hitC.tagName : null,
        hitIsLink: !!(hitC && hitC.closest && hitC.closest('a.src-link')),
        text: (el.textContent || '').trim().slice(0, 30),
      };
    }
    return { idx: i, box: { x: +rb.x.toFixed(2), y: +rb.y.toFixed(2), w: +rb.width.toFixed(2), h: +rb.height.toFixed(2) }, parts };
  }, idx);
}

async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(x1 + ((x2 - x1) * i) / 14, y1 + ((y2 - y1) * i) / 14);
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(160);
  const t = await page.evaluate(() => (window.getSelection() || '').toString());
  await page.evaluate(() => { try { window.getSelection().removeAllRanges(); } catch (e) {} });
  return { len: t.length, sample: t.slice(0, 45) };
}

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { rows: [], focusRing: [] };

  for (const [vpName, w, h] of [['1280x800', 1280, 800], ['390x844', 390, 844]]) {
    for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(350);
      const n = await page.evaluate(() => document.querySelectorAll('.src-item').length);
      // 选一个有 3 段且都在视口内可见的行
      let g = null;
      for (const i of [3, 4, 5, 6, 7, 8]) {
        if (i >= n) break;
        const t = await geo(page, i);
        if (t && t.parts['src-sum'] && t.parts['src-rel'] && t.parts['src-rel'].w > 30) { g = t; break; }
      }
      if (!g) { await ctx.close(); continue; }
      await page.waitForTimeout(150);
      g = await geo(page, g.idx);
      const rec = { vp: vpName, tag, geo: g, drag: {}, dbl: {}, ctxhit: {} };

      // ---- 逐段拖选 ----
      for (const k of ['src-sum', 'src-rel']) {
        const p = g.parts[k];
        if (!p) continue;
        rec.drag[k] = await drag(page, p.x + 3, p.cy, Math.min(p.x + p.w - 4, p.x + 220), p.cy);
      }
      // 整行（从 link 左缘到 rel 右缘，纵向下移一点避开折行）
      rec.drag.full = await drag(page, g.box.x + 5, g.parts['src-link'].cy, g.box.x + g.box.w - 6, g.parts['src-link'].cy);

      // ---- 逐段双击 ----
      for (const k of ['src-sum', 'src-rel']) {
        const p = g.parts[k];
        if (!p) continue;
        await page.evaluate(() => { try { window.getSelection().removeAllRanges(); } catch (e) {} });
        await page.mouse.move(p.cx, p.cy);
        await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
        await page.waitForTimeout(40);
        await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
        await page.waitForTimeout(200);
        const t = await page.evaluate(() => (window.getSelection() || '').toString());
        rec.dbl[k] = { len: t.length, sample: t.slice(0, 30) };
        await page.evaluate(() => { try { window.getSelection().removeAllRanges(); } catch (e) {} });
      }

      // ---- 逐段右键 ----
      await page.evaluate(() => { window.__ctx = null; document.addEventListener('contextmenu', (e) => { window.__ctx = { tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 24) }; }, true); });
      for (const k of ['src-sum', 'src-rel']) {
        const p = g.parts[k];
        if (!p) continue;
        await page.mouse.click(p.cx, p.cy, { button: 'right' });
        await page.waitForTimeout(180);
        rec.ctxhit[k] = await page.evaluate(() => window.__ctx);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(80);
      }

      out.rows.push(rec);
      log({ m: 'ROW', vp: vpName, tag, idx: g.idx, box: g.box, parts: Object.fromEntries(Object.entries(g.parts).map(([k, v]) => [k, { w: v.w, h: v.h, pe: v.pe, us: v.us, hit: v.hitTag, isLink: v.hitIsLink }])), drag: { sum: rec.drag['src-sum'] && rec.drag['src-sum'].len, rel: rec.drag['src-rel'] && rec.drag['src-rel'].len, full: rec.drag.full.len }, dbl: { sum: rec.dbl['src-sum'] && rec.dbl['src-sum'].len, rel: rec.dbl['src-rel'] && rec.dbl['src-rel'].len }, ctx: { sum: rec.ctxhit['src-sum'] && rec.ctxhit['src-sum'].tag + '/' + rec.ctxhit['src-sum'].cls, rel: rec.ctxhit['src-rel'] && rec.ctxhit['src-rel'].tag + '/' + rec.ctxhit['src-rel'].cls } });
      await ctx.close();
    }
  }

  // ---- 焦点环：真实键盘 Tab 走到第 1 个 .src-link ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    // 让第一个 .src-item 进入视口
    await page.evaluate(() => { const a = document.querySelector('.src-item .src-link'); if (a) a.scrollIntoView({ block: 'center', behavior: 'instant' }); });
    await page.waitForTimeout(200);
    // 从 body 开始按 Tab，最多 600 次
    await page.evaluate(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus(); });
    let found = null, steps = 0;
    for (let i = 0; i < 600; i++) {
      await page.keyboard.press('Tab');
      steps = i + 1;
      const st = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return null;
        return { tag: a.tagName, cls: String(a.className || '').slice(0, 30), isSrc: !!(a.matches && a.matches('.src-item .src-link')) };
      });
      if (st && st.isSrc) {
        found = await page.evaluate(() => {
          const a = document.activeElement; const item = a.closest('.src-item');
          const ci = getComputedStyle(item); const ca = getComputedStyle(a);
          return { itemOutline: ci.outline, itemOutlineOffset: ci.outlineOffset, linkOutline: ca.outline, matchesFocusVisible: a.matches(':focus-visible'), inViewport: (() => { const b = a.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; })() };
        });
        break;
      }
    }
    out.focusRing.push({ vp: '1280x800', steps, found });
    log({ m: 'FOCUSRING', steps, found });
    await ctx.close();
  }

  fs.writeFileSync(path.join(TMP, 'stretch2.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'stretch2.json'));
  await browser.close();
})();
