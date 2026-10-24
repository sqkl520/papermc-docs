'use strict';
/**
 * b1r-attrib2.js — 收尾归因：
 *   A. 1025 档 pageHeight +2913 是否纯由 grid 三列（290/1fr/250）造成
 *   B. 768 档代码块 +1050px 的成因（是否 .code-pre font-size / code-scroll 引起）
 *   C. 打印态 hljs token 在白纸上的对比度（假设浏览器不打印背景）
 * 用法: node tools/b1r-attrib2.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const LOGP = path.join(ROOT, 'reports', '.b1r-attrib2.log');
const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));
const NEW = 'http://127.0.0.1:8787';
function log(s) { try { fs.appendFileSync(LOGP, s + '\n', 'utf8'); } catch (e) {} console.log(s); }

// WCAG 相对亮度 + 对比度
function lum(hex) {
  const c = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a, b) { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); }

(async () => {
  try { fs.unlinkSync(LOGP); } catch (e) {}
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const out = {};

  // ---------- A. 1025 档：改回两列，看 pageHeight 是否回到基线 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1025, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of ['/paper/dev/particles/', '/paper/reference/system-properties/']) {
      await page.goto(NEW + u, { waitUntil: 'load' });
      await page.waitForTimeout(450);
      const base = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.layout')).gridTemplateColumns);
      const tag = await page.addStyleTag({ content: '.layout.has-toc{grid-template-columns:280px minmax(0,1fr) !important}' });
      await page.waitForTimeout(200);
      const twoCol = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
      const cols2 = await page.evaluate(() => getComputedStyle(document.querySelector('.layout')).gridTemplateColumns);
      await page.evaluate((e) => e.remove(), tag);
      await page.waitForTimeout(150);
      const rec = { page: u, base, cols, twoCol, cols2, shrankBy: base - twoCol };
      out['grid_' + u] = rec;
      log('GRID1025 ' + JSON.stringify(rec));
    }
    await ctx.close();
  }

  // ---------- B. 768 档代码块增高归因 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/particles/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const read = () => page.evaluate(() => {
      const cb = Array.from(document.querySelectorAll('.code-block'));
      const pre = document.querySelector('.code-pre');
      const code = pre ? pre.querySelector('code') : null;
      return {
        docH: Math.round(document.documentElement.scrollHeight),
        codeBlocksTotalH: +cb.reduce((a, e) => a + e.getBoundingClientRect().height, 0).toFixed(1),
        codeBlockCount: cb.length,
        preFontSize: pre ? getComputedStyle(pre).fontSize : null,
        preLineHeight: pre ? getComputedStyle(pre).lineHeight : null,
        codeFontSize: code ? getComputedStyle(code).fontSize : null,
        codeLineHeight: code ? getComputedStyle(code).lineHeight : null,
        firstPreH: pre ? +pre.getBoundingClientRect().height.toFixed(1) : null,
        firstPreScrollH: pre ? pre.scrollHeight : null,
        codeScrollW: (() => { const s = document.querySelector('.code-scroll'); return s ? { cw: s.clientWidth, sw: s.scrollWidth } : null; })(),
        contentW: Math.round(document.querySelector('.content').getBoundingClientRect().width),
        articleW: Math.round(document.querySelector('.article').getBoundingClientRect().width),
      };
    });
    out.code768 = { asIs: await read() };
    log('CODE768 asIs ' + JSON.stringify(out.code768.asIs));
    // 归因实验 1：把 pre 字号压回 .85rem 看高度
    let t = await page.addStyleTag({ content: '.code-pre{font-size:.85rem !important}' });
    await page.waitForTimeout(200);
    out.code768.withPre85 = await read(); log('CODE768 pre85 ' + JSON.stringify(out.code768.withPre85));
    await page.evaluate((e) => e.remove(), t);
    // 归因实验 2：把 code 字号改回 13.6（.85rem）
    t = await page.addStyleTag({ content: '.article pre code{font-size:.85rem !important}' });
    await page.waitForTimeout(200);
    out.code768.code85 = await read(); log('CODE768 code85 ' + JSON.stringify(out.code768.code85));
    await page.evaluate((e) => e.remove(), t);
    await ctx.close();
  }

  // ---------- C. 打印态对比度 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(NEW + '/paper/dev/dialogs/', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    const tokens = await page.evaluate(() => {
      const sel = ['.hljs-keyword', '.hljs-string', '.hljs-title', '.hljs-comment', '.hljs-number', '.hljs-built_in'];
      const r = {};
      sel.forEach((s) => { const e = document.querySelector(s); if (e) r[s] = getComputedStyle(e).color; });
      return { tokens: r, codeBg: getComputedStyle(document.querySelector('.code-block')).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor };
    });
    const toHex = (rgb) => { const m = rgb.match(/\d+/g); return '#' + m.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join(''); };
    const rows = Object.entries(tokens.tokens).map(([k, v]) => ({
      token: k, color: v, hex: toHex(v),
      onWhite: contrast(toHex(v), '#ffffff'),          // 浏览器默认不打印背景
      onDarkBg: contrast(toHex(v), toHex(tokens.codeBg)),
    }));
    out.printContrast = { codeBg: toHex(tokens.codeBg), bodyBg: toHex(tokens.bodyBg), rows };
    log('PRINT_CONTRAST ' + JSON.stringify(out.printContrast));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(ROOT, 'reports', '.b1r-attrib2.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('DONE');
})();
