'use strict';
/**
 * b1s-stretch3.js — 冲突 4 收尾：右键目标 + 焦点环（消除坐标漂移）
 *
 * b1s-stretch2.js 的两个残留问题：
 *   1. 右键目标出现 "P"/"DIV/layout" —— 是操作间页面滚动导致坐标漂移命中别处；
 *   2. Tab 600 次未到达 .src-link —— 需要先定位它在 tab 序中的位置。
 * 本脚本每次交互前**重新取**几何；焦点环用「聚焦前一个可聚焦元素再按一次 Tab」的真实键盘路径。
 * 只读站点；写 TMPDIR\b1s\stretch3.json。
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

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { ctx: [], focusRing: [], tabOrder: null };

  // ---------- 右键：每次交互前重取坐标 ----------
  for (const [vpName, w, h] of [['1280x800', 1280, 800], ['390x844', 390, 844]]) {
    for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(base + PAGE, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'html{scroll-behavior:auto !important}' });
      await page.waitForTimeout(350);
      await page.evaluate(() => { window.__ctx = null; document.addEventListener('contextmenu', (e) => { window.__ctx = { tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 24) }; }, true); });

      const rec = { vp: vpName, tag, hits: {} };
      for (const k of ['src-sum', 'src-rel']) {
        // 1) 先把第 3 行滚到中部并**立刻**取该段中心
        const p = await page.evaluate((sel) => {
          const rows = document.querySelectorAll('.src-item');
          const r = rows[3];
          if (!r) return null;
          r.scrollIntoView({ block: 'center', behavior: 'instant' });
          const el = r.querySelector('.' + sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          const cx = b.x + Math.min(b.width / 2, 40), cy = b.y + b.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          return { cx: +cx.toFixed(2), cy: +cy.toFixed(2), w: +b.width.toFixed(2), hitTag: hit ? hit.tagName : null, hitCls: hit ? String(hit.className || '').slice(0, 24) : null, hitIsLink: !!(hit && hit.closest && hit.closest('a.src-link')) };
        }, k);
        if (!p) continue;
        // 2) 不滚动，直接右键（坐标刚取，未漂移）
        await page.mouse.click(p.cx, p.cy, { button: 'right' });
        await page.waitForTimeout(200);
        const target = await page.evaluate(() => window.__ctx);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        rec.hits[k] = { probe: p, ctxTarget: target, becomeLinkMenu: !!(target && target.tag === 'A') };
      }
      out.ctx.push(rec);
      log({ m: 'CTX3', vp: vpName, tag, sum: rec.hits['src-sum'] && { hit: rec.hits['src-sum'].probe.hitTag + '/' + rec.hits['src-sum'].probe.hitIsLink, ctx: rec.hits['src-sum'].ctxTarget, linkMenu: rec.hits['src-sum'].becomeLinkMenu }, rel: rec.hits['src-rel'] && { hit: rec.hits['src-rel'].probe.hitTag + '/' + rec.hits['src-rel'].probe.hitIsLink, ctx: rec.hits['src-rel'].ctxTarget, linkMenu: rec.hits['src-rel'].becomeLinkMenu } });
      await ctx.close();
    }
  }

  // ---------- 焦点环：真实键盘路径 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + PAGE, { waitUntil: 'load' });
    await page.waitForTimeout(400);

    // 定位 .src-link 在 tab 序里的前缀元素：取 DOM 中它之前所有可聚焦元素
    const info = await page.evaluate(() => {
      const first = document.querySelector('.src-item .src-link');
      if (!first) return null;
      first.scrollIntoView({ block: 'center', behavior: 'instant' });
      const sel = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
      const all = Array.from(document.querySelectorAll(sel)).filter((e) => {
        const cs = getComputedStyle(e);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
      });
      const idx = all.indexOf(first);
      const prev = idx > 0 ? all[idx - 1] : null;
      return {
        indexInTabOrder: idx, total: all.length,
        prevTag: prev ? prev.tagName : null, prevCls: prev ? String(prev.className || '').slice(0, 30) : null, prevId: prev ? prev.id : null,
        prevIsLink: !!(prev && prev.matches && prev.matches('.src-item .src-link')),
      };
    });
    out.tabOrder = info;
    log({ m: 'TABORDER', info });

    // 用 prev 聚焦，再按一次 Tab → 真实键盘焦点 → :focus-visible 应为真
    const r = await page.evaluate(() => {
      const first = document.querySelector('.src-item .src-link');
      const sel = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
      const all = Array.from(document.querySelectorAll(sel)).filter((e) => {
        const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
      });
      const idx = all.indexOf(first);
      const prev = idx > 0 ? all[idx - 1] : null;
      if (prev) prev.focus();
      return { focusedPrev: prev ? prev.tagName + '.' + String(prev.className || '').slice(0, 20) : null };
    });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
    const fr = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return null;
      const isSrc = !!(a.matches && a.matches('.src-item .src-link'));
      const item = a.closest ? a.closest('.src-item') : null;
      const ci = item ? getComputedStyle(item) : null;
      const ca = getComputedStyle(a);
      return {
        isSrcLink: isSrc, tag: a.tagName, cls: String(a.className || '').slice(0, 24),
        matchesFocusVisible: a.matches(':focus-visible'),
        itemOutline: ci ? ci.outline : null, itemOutlineOffset: ci ? ci.outlineOffset : null,
        linkOutline: ca.outline,
        inViewport: (() => { const b = a.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; })(),
      };
    });
    out.focusRing.push({ vp: '1280x800', prevFocus: r, afterTab: fr });
    log({ m: 'FOCUS3', prevFocus: r, afterTab: fr });
    await ctx.close();
  }

  fs.writeFileSync(path.join(TMP, 'stretch3.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE ' + path.join(TMP, 'stretch3.json'));
  await browser.close();
})();
