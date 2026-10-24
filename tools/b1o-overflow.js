#!/usr/bin/env node
'use strict';
/**
 * b1o-overflow.js — 定位 160px CSS 视口（= 320×568 @ 200% 页面缩放）下的横向溢出源。
 *
 * 任务 C 的 63 组里有 3 组 FAIL，全部是「320x568 视口 + 200% 页面缩放」→ 等效 CSS 视口 160x284。
 * 这是合成极值（真机最小 320 CSS px，200% 缩放时浏览器等效 CSS 视口就是 160px）。
 * 本脚本列出真正把 scrollWidth 撑破的元素，给出最小复现（选择器 + 宽度 + 归属 CSS 规则）。
 *
 * 用法：node tools/b1o-overflow.js [--json=$env:TEMP\b1o\overflow.json] [--w=160]
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(process.env.TEMP || '.', 'b1o', 'overflow.json')));
const W = Number(opt('w', '160'));
const H = Number(opt('h', '284'));

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

const PAGES = ['index.html', 'paper/dev/dialogs/index.html', 'velocity/tuning/index.html'];
const out = { tool: 'tools/b1o-overflow.js', generatedAt: new Date().toISOString(), width: W, height: H, pages: [] };

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });
  for (const rel of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(REPO, rel)).href, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(600);
    const rec = await page.evaluate(() => {
      const de = document.documentElement;
      const vw = de.clientWidth;
      const total = Math.max(0, de.scrollWidth - vw);
      const culprits = [];
      const all = document.querySelectorAll('body *');
      for (const el of all) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        // 元素自身是否越过视口右边缘（用 offset 位置而非 rect，避免 transform 干扰）
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const rightOver = Math.round(r.right - vw);
        if (rightOver <= 1) continue;
        // 只报「最外层」肇事者：父元素不越界，它越界
        const p = el.parentElement;
        let parentOk = true;
        if (p && p !== document.body && p !== de) {
          const pr = p.getBoundingClientRect();
          parentOk = pr.right <= vw + 1;
        }
        if (!parentOk) continue;
        const sel = (() => {
          let s = el.tagName.toLowerCase();
          if (el.id) s += '#' + el.id;
          if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
          return s;
        })();
        culprits.push({
          sel,
          tag: el.tagName,
          cls: typeof el.className === 'string' ? el.className.slice(0, 60) : null,
          w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right),
          rightOver,
          display: cs.display, position: cs.position,
          minWidth: cs.minWidth, width: cs.width, maxWidth: cs.maxWidth,
          padding: cs.padding, margin: cs.margin, gap: cs.gap, flex: cs.flex,
          whiteSpace: cs.whiteSpace, overflowX: cs.overflowX,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        });
      }
      // 也检查 body/html 自身
      return {
        vw, scrollW: de.scrollWidth, total,
        bodyScrollW: document.body.scrollWidth,
        culpritCount: culprits.length,
        culprits: culprits.sort((a, b) => b.rightOver - a.rightOver).slice(0, 20),
        topbarH: getComputedStyle(de).getPropertyValue('--topbar-h').trim(),
        contentW: (() => { const c = document.querySelector('.content'); return c ? Math.round(c.getBoundingClientRect().width) : null; })(),
      };
    });
    rec.rel = rel;
    out.pages.push(rec);
    console.log('\n=== ' + rel + '  vw=' + rec.vw + ' scrollW=' + rec.scrollW + ' overflow=' + rec.total + ' culprits=' + rec.culpritCount);
    for (const c of rec.culprits) {
      console.log('   +' + String(c.rightOver).padStart(3) + 'px  w=' + String(c.w).padStart(4) + ' [' + c.position + '/' + c.overflowX + '] minW=' + c.minWidth + ' w=' + c.width + ' maxW=' + c.maxWidth + '  ' + c.sel);
      console.log('          ' + JSON.stringify({ text: c.text, padding: c.padding, margin: c.margin, flex: c.flex, ws: c.whiteSpace }));
    }
    await ctx.close();
  }
  await browser.close();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nWROTE ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
