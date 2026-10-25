#!/usr/bin/env node
'use strict';
/**
 * b1o-index.js — 确认 `file://` 下搜索索引**怎么**加载成功的（机制而非结果）。
 *
 * 疑点：b1o-search.js 里 file:// 得到 index=141，但 performance 资源条目为 0、
 * 也没看到 assets/search-index.js 的资源记录。要么是 resource timing 不记录 file://，
 * 要么索引走了别的通道。必须查清楚，否则「离线搜索可用」的结论站不住。
 *
 * 判据：
 *   1 DOM 里有没有 <script src*="assets/search-index.js">
 *   2 window.__LIBRARY_SEARCH__ 是否在**未交互**时就已存在（说明站点内联了索引 or 预加载）
 *   3 清掉 window.__LIBRARY_SEARCH__ 再触发搜索，看是否重新注入并成功
 *   4 拦 page.route / CDP 观察真实请求（file:// 也走 network 层）
 *
 * 用法：node tools/b1o-index.js [--json=$env:TEMP\b1o\index.json]
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'index.json')));
const REL = opt('rel', 'paper/dev/dialogs/index.html');

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean);
function browserPath() { for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* */ } } return null; }

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  const out = { tool: 'tools/b1o-index.js', generatedAt: new Date().toISOString(), rel: REL, runs: [] };

  for (const proto of ['file', 'http']) {
    const url = proto === 'file' ? pathToFileURL(path.join(REPO, REL)).href : 'http://127.0.0.1:8787/' + REL;
    const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const reqs = [];
    page.on('request', (r) => reqs.push(r.url()));
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(600);

    // 1+2 未交互状态
    const idle = await page.evaluate(() => ({
      scriptTags: Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src')),
      indexScriptPresent: !!document.querySelector('script[src*="assets/search-index.js"]'),
      hasGlobal: typeof window.__LIBRARY_SEARCH__ !== 'undefined',
      indexPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length) || 0,
      // 站点是否把索引内联进了页面
      inlineSearchScript: Array.from(document.querySelectorAll('script:not([src])')).some((s) => (s.textContent || '').indexOf('__LIBRARY_SEARCH__') !== -1),
      headHTMLChars: (document.head.innerHTML || '').length,
    }));

    // 3 清掉全局后触发搜索
    await page.evaluate(() => { try { delete window.__LIBRARY_SEARCH__; } catch (e) { window.__LIBRARY_SEARCH__ = undefined; } });
    const btn = await page.$('[data-open-search]');
    if (btn) await btn.click().catch(() => {});
    await page.waitForTimeout(300);
    const input = await page.$('#search-input');
    if (input) await input.fill('权限').catch(() => {});
    let n = 0;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);
      n = await page.evaluate(() => document.querySelectorAll('#search-results a').length);
      if (n > 0) break;
    }
    const after = await page.evaluate(() => ({
      hasGlobal: typeof window.__LIBRARY_SEARCH__ !== 'undefined',
      indexPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length) || 0,
      indexScriptPresent: !!document.querySelector('script[src*="assets/search-index.js"]'),
      results: document.querySelectorAll('#search-results a').length,
      emptyMsg: (() => { const e = document.querySelector('.sr-empty'); return e ? (e.textContent || '').trim().slice(0, 180) : null; })(),
      perfResources: performance.getEntriesByType('resource').length,
    }));

    out.runs.push({ proto, url, idle, after, resultsAfterReload: n, requestCount: reqs.length, requests: reqs.filter((u) => /search-index|\.css|\.js/.test(u)).slice(0, 8), errs: errs.slice(0, 4) });
    console.log('\n=== ' + proto + '  ' + url.slice(0, 80));
    console.log('  idle: ' + JSON.stringify(idle));
    console.log('  after reload-trigger: ' + JSON.stringify(after) + '  results=' + n);
    console.log('  requests(' + reqs.length + '): ' + JSON.stringify(out.runs[out.runs.length - 1].requests));
    if (errs.length) console.log('  errs: ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
    await browser.close();
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nWROTE ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
