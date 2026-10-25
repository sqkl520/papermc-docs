#!/usr/bin/env node
'use strict';
/**
 * b1o-search.js — `file://` 与 `http://` 的搜索**等价性**复验。
 *
 * 只看「有没有结果」不足以证明离线搜索可用。本脚本对同一组查询词分别跑
 * file:// 与 http://，逐词比较：结果条数、Top1 标题与 href、索引条目数、索引加载通道。
 *
 * 索引加载通道判据（assets/site.js 的 ensureIndex）：
 *   ① <script src="assets/search-index.js">（file:// 可用）→ window.__LIBRARY_SEARCH__
 *   ② 回退 XHR 读 search-index.json（file:// 下会被浏览器拦）
 * 用 performance 资源 + window 变量即可判定走的是哪条。
 *
 * 用法：node tools/b1o-search.js [--json=$env:TEMP\b1o\search.json]
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'search.json')));
const BASE = opt('url', 'http://127.0.0.1:8787').replace(/\/+$/, '');

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean);
function browserPath() { for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* */ } } return null; }

const QUERIES = ['对话框', 'dialog', '权限', 'permission', '性能', '配置', '事件', '代理', 'command', '插件加载'];
const REL = 'paper/dev/dialogs/index.html';

async function runAll(browser, proto) {
  const url = proto === 'file' ? pathToFileURL(path.join(REPO, REL)).href : BASE + '/' + REL;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(500);

  // 打开搜索
  const btn = await page.$('[data-open-search]');
  if (btn) await btn.click().catch(() => {});
  await page.waitForTimeout(250);
  const input = await page.$('#search-input');
  if (!input) { await ctx.close(); return { proto, fatal: 'no #search-input', errs }; }

  const rows = [];
  for (const q of QUERIES) {
    await input.fill('');
    await input.fill(q);
    // 等结果稳定（90ms 防抖 + 渲染）
    let n = 0;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(120);
      n = await page.evaluate(() => document.querySelectorAll('#search-results a').length);
      if (n > 0) break;
    }
    await page.waitForTimeout(180);
    const r = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('#search-results a'));
      const first = links[0];
      return {
        n: links.length,
        top: first ? { text: (first.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50), href: first.getAttribute('href') } : null,
        countLabel: (() => { const e = document.getElementById('search-count'); return e ? (e.textContent || '').trim().slice(0, 40) : null; })(),
      };
    });
    rows.push({ q, ...r });
  }

  // 索引加载通道 + 资源
  const meta = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource').map((r) => r.name);
    return {
      indexPages: (window.__LIBRARY_SEARCH__ && window.__LIBRARY_SEARCH__.pages && window.__LIBRARY_SEARCH__.pages.length) || 0,
      viaScriptTag: res.some((u) => u.includes('assets/search-index.js')),
      viaJsonFetch: res.some((u) => u.includes('search-index.json')),
      resourceCount: res.length,
      errorMsg: (() => { const e = document.querySelector('.sr-empty'); return e ? (e.textContent || '').trim().slice(0, 160) : null; })(),
    };
  });
  await ctx.close();
  return { proto, url, rows, meta, errs };
}

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });
  const fileRes = await runAll(browser, 'file');
  const httpRes = await runAll(browser, 'http');
  await browser.close();

  const cmp = [];
  let sameCount = 0;
  for (let i = 0; i < QUERIES.length; i++) {
    const f = fileRes.rows[i], h = httpRes.rows[i];
    const sameN = f.n === h.n;
    const sameTop = JSON.stringify(f.top) === JSON.stringify(h.top);
    const sameSig = sameN && sameTop;
    if (sameSig) sameCount++;
    cmp.push({ q: f.q, fileN: f.n, httpN: h.n, fileTop: f.top, httpTop: h.top, sameN, sameTop, sameSig });
    console.log((sameSig ? 'SAME ' : 'DIFF ') + f.q.padEnd(10) + ' file=' + String(f.n).padStart(4) + ' http=' + String(h.n).padStart(4) + (sameSig ? '' : '   fileTop=' + JSON.stringify(f.top) + ' httpTop=' + JSON.stringify(h.top)));
  }
  console.log('\nidentical queries: ' + sameCount + '/' + QUERIES.length);
  console.log('file  index=' + fileRes.meta.indexPages + ' viaScriptTag=' + fileRes.meta.viaScriptTag + ' viaJson=' + fileRes.meta.viaJsonFetch + ' resources=' + fileRes.meta.resourceCount + ' errs=' + fileRes.errs.length);
  console.log('http  index=' + httpRes.meta.indexPages + ' viaScriptTag=' + httpRes.meta.viaScriptTag + ' viaJson=' + httpRes.meta.viaJsonFetch + ' resources=' + httpRes.meta.resourceCount + ' errs=' + httpRes.errs.length);

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ tool: 'tools/b1o-search.js', generatedAt: new Date().toISOString(), queries: QUERIES, file: fileRes, http: httpRes, compare: cmp, identical: sameCount, total: QUERIES.length }, null, 2), 'utf8');
  console.log('WROTE ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
