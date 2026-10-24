'use strict';
/**
 * b1r-last.js — 两个判定性收尾：
 *   A. 打印态 token 对比度：改前(8788) vs 改后(8787) —— 判定是否为批 1 新引入
 *   B. P1-3 渐隐条：滚到最右时是否仍遮住行尾字符
 * 用法: node tools/b1r-last.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'reports', 'b1r-shots');
const LOGP = path.join(ROOT, 'reports', '.b1r-last.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787', OLD = 'http://127.0.0.1:8788';
function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }
function lum(hex) {
  const c = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };
const toHex = (rgb) => { const m = String(rgb).match(/\d+/g); return m ? '#' + m.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join('') : null; };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = { print: {}, fade: {} };

  // ---------- A. 打印对比度 改前/改后 ----------
  for (const [tag, base] of [['new', NEW], ['old', OLD]]) {
    for (const scheme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto(base + '/paper/dev/dialogs/', { waitUntil: 'load' });
      await page.waitForTimeout(500);
      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(300);
      const t = await page.evaluate(() => {
        const sel = ['.hljs-keyword', '.hljs-string', '.hljs-title', '.hljs-comment', '.hljs-number', '.hljs-built_in'];
        const r = {};
        sel.forEach((s) => { const e = document.querySelector(s); if (e) r[s] = getComputedStyle(e).color; });
        return { tokens: r, theme: document.documentElement.getAttribute('data-theme') };
      });
      const rows = Object.entries(t.tokens).map(([k, v]) => ({ token: k, hex: toHex(v), onWhite: contrast(toHex(v), '#ffffff') }));
      const fails = rows.filter((r) => r.onWhite < 4.5).length;
      out.print[tag + '_' + scheme] = { theme: t.theme, rows, failCountOnWhite: fails, worst: Math.min(...rows.map((r) => r.onWhite)) };
      log('PRINT ' + tag + ' ' + scheme + ' theme=' + t.theme + ' fails=' + fails + '/6 worst=' + Math.min(...rows.map((r) => r.onWhite)) + ' ' + JSON.stringify(rows));
      await ctx.close();
    }
  }

  // ---------- B. 渐隐条末端遮挡 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const idx = await page.evaluate(() => {
      const arr = Array.from(document.querySelectorAll('.code-scroll[data-overflowing]'));
      let best = -1, bi = 0;
      arr.forEach((e, i) => { const r = e.scrollWidth / e.clientWidth; if (r > best) { best = r; bi = i; } });
      arr[bi].scrollIntoView({ block: 'center', behavior: 'instant' });
      window.__i = Array.from(document.querySelectorAll('.code-scroll')).indexOf(arr[bi]);
      return { idx: window.__i, ratio: +best.toFixed(2) };
    });
    await page.waitForTimeout(300);
    const geom = () => page.evaluate(() => {
      const e = document.querySelectorAll('.code-scroll')[window.__i];
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e, '::after');
      const code = e.querySelector('code');
      const cb = code.getBoundingClientRect();
      // 用 Range 量最后一个文本节点的右边缘（真实可读内容右端）
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let last = null, n;
      while ((n = walker.nextNode())) { if (n.textContent.trim()) last = n; }
      let contentRight = null;
      if (last) { const r = document.createRange(); r.selectNodeContents(last); const rects = r.getClientRects(); if (rects.length) contentRight = Math.round(rects[rects.length - 1].right); }
      return {
        scrollLeft: Math.round(e.scrollLeft), maxScroll: Math.round(e.scrollWidth - e.clientWidth),
        boxRight: Math.round(b.right), afterWidthPx: parseFloat(cs.width),
        fadeLeftEdge: Math.round(b.right - parseFloat(cs.width)),
        codeBoxRight: Math.round(cb.right), lastTextRight: contentRight,
        // 判定：渐隐左边缘 < 最后字符右边缘 → 遮住字符
        fadeCoversLastChars: contentRight != null ? (b.right - parseFloat(cs.width)) < contentRight : null,
        coveredPx: contentRight != null ? Math.max(0, Math.round(contentRight - (b.right - parseFloat(cs.width)))) : null,
      };
    });
    out.fade.at0 = await geom();
    await page.screenshot({ path: path.join(SHOTS, 'fade-a-left.png'), clip: await page.evaluate(() => { const e = document.querySelectorAll('.code-scroll')[window.__i]; const b = e.getBoundingClientRect(); return { x: Math.max(0, b.right - 90), y: Math.max(0, b.top), width: 90, height: Math.min(90, b.height) }; }) });
    log('FADE at0 ' + JSON.stringify(out.fade.at0));
    await page.evaluate(() => { const e = document.querySelectorAll('.code-scroll')[window.__i]; e.scrollLeft = e.scrollWidth; });
    await page.waitForTimeout(350);
    out.fade.atMax = await geom();
    await page.screenshot({ path: path.join(SHOTS, 'fade-b-max.png'), clip: await page.evaluate(() => { const e = document.querySelectorAll('.code-scroll')[window.__i]; const b = e.getBoundingClientRect(); return { x: Math.max(0, b.right - 90), y: Math.max(0, b.top), width: 90, height: Math.min(90, b.height) }; }) });
    log('FADE atMax ' + JSON.stringify(out.fade.atMax));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-last.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
