#!/usr/bin/env node
'use strict';
/**
 * b1o-overflow2.js — 精确定位「真正撑破文档宽度」的元素（考虑祖先裁剪）。
 *
 * 上一版把 .code-scroll 内的 <pre> 也算成肇事者 —— 那是误报：<pre> 的 rect 可以越出视口，
 * 但它的祖先 .code-scroll 有 overflow-x:auto，已经把溢出吃掉了，不会变成文档级横向滚动。
 *
 * 本版规则：
 *   一个元素算「真肇事者」当且仅当
 *     (a) 它的右边缘超出 clientWidth，且
 *     (b) 从它到 <html> 的祖先链上**没有任何** overflow-x ∈ {auto,scroll,hidden,clip} 的裁剪容器。
 *
 * 用法：node tools/b1o-overflow2.js [--json=$env:TEMP\b1o\overflow2.json] [--w=160] [--h=284]
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'overflow2.json')));

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].filter(Boolean);
function browserPath() { for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* */ } } return null; }

const PAGES = ['index.html', 'all-pages.html', 'paper/dev/dialogs/index.html', 'velocity/tuning/index.html'];
/** 扫描的宽度梯度：320 是 WCAG 1.4.10 reflow 基线，160 是「320 @200% 缩放」的合成极值 */
const WIDTHS = [320, 240, 160];

const out = { tool: 'tools/b1o-overflow2.js', generatedAt: new Date().toISOString(), results: [] };

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });

  for (const w of WIDTHS) {
    for (const rel of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: Math.max(360, Math.round(w * 1.78)) }, isMobile: w <= 820, hasTouch: w <= 820 });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(path.join(REPO, rel)).href, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(500);
      const rec = await page.evaluate(() => {
        const de = document.documentElement;
        const vw = de.clientWidth;
        const CLIP = new Set(['auto', 'scroll', 'hidden', 'clip']);
        const clippedBy = (el) => {
          let p = el.parentElement;
          while (p && p !== de && p !== document.body) {
            const cs = getComputedStyle(p);
            if (CLIP.has(cs.overflowX)) return p;
            p = p.parentElement;
          }
          return null;
        };
        const sel = (el) => {
          let s = el.tagName.toLowerCase();
          if (el.id) s += '#' + el.id;
          if (el.className && typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
          return s;
        };
        const real = [];
        const clipped = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const rightOver = Math.round(r.right - vw);
          if (rightOver <= 1) continue;
          const clipper = clippedBy(el);
          const row = {
            sel: sel(el), w: Math.round(r.width), rightOver,
            position: cs.position, overflowX: cs.overflowX, minWidth: cs.minWidth, width: cs.width,
            whiteSpace: cs.whiteSpace, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
          };
          if (clipper) { row.clippedBy = sel(clipper); clipped.push(row); }
          else real.push(row);
        }
        // 按 rightOver 降序取前 12
        real.sort((a, b) => b.rightOver - a.rightOver);
        return {
          vw, scrollW: de.scrollWidth, overflow: Math.max(0, de.scrollWidth - vw),
          realCount: real.length, clippedCount: clipped.length,
          real: real.slice(0, 12), clipped: clipped.slice(0, 6),
        };
      });
      rec.width = w; rec.rel = rel;
      out.results.push(rec);
      console.log('\n=== ' + w + 'px  ' + rel + '  vw=' + rec.vw + ' scrollW=' + rec.scrollW + ' overflow=' + rec.overflow + '  real=' + rec.realCount + ' clipped=' + rec.clippedCount);
      for (const c of rec.real) console.log('   +' + String(c.rightOver).padStart(4) + '  ' + c.sel.padEnd(34) + ' w=' + String(c.w).padStart(4) + ' minW=' + c.minWidth + ' pos=' + c.position + ' ox=' + c.overflowX + '  «' + c.text + '»');
      for (const c of rec.clipped.slice(0, 3)) console.log('   (clipped by ' + c.clippedBy + ') ' + c.sel + ' +' + c.rightOver);
      await ctx.close();
    }
  }

  await browser.close();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nWROTE ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
