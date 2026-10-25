#!/usr/bin/env node
'use strict';
/**
 * b1o-network.js — 任务 D：网络降级（Slow 3G / offline）。
 *
 * CDP Network.emulateNetworkConditions：
 *   slow3g  : 400 kbps 下行 / 400ms RTT（任务书口径）
 *   slow4g  : 1.6 Mbps / 150ms（对照）
 *   offline : offline=true（所有网络请求直接失败）
 *
 * 两种协议各跑一遍：
 *   http://127.0.0.1:8787  —— 真·网络路径，Slow 3G 下所有资源真的排队
 *   file://               —— 离线镜像的真实用法：CDP 网络模拟对 file:// 不生效，
 *                            因此 offline 也不能把站点弄坏（这本身就是「离线可用」的证明）
 *
 * 检查：首屏是否仍可读（CSS/JS 是否阻塞渲染导致无样式骨架）、FCP、关键文本是否在 DOM 里。
 *
 * 用法：node tools/b1o-network.js [--json=$env:TEMP\b1o\network.json] [--url=http://127.0.0.1:8787]
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'network.json')));
const BASE = opt('url', 'http://127.0.0.1:8787').replace(/\/+$/, '');

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

const PROFILES = [
  { id: 'slow3g', offline: false, latency: 400, download: Math.round(400 * 1024 / 8), upload: Math.round(400 * 1024 / 8), note: '400kbps/400ms' },
  { id: 'slow4g', offline: false, latency: 150, download: Math.round(1600 * 1024 / 8), upload: Math.round(750 * 1024 / 8), note: '1.6Mbps/150ms' },
  { id: 'offline', offline: true, latency: 0, download: 0, upload: 0, note: 'offline=true' },
];

const PAGES = [
  { id: 'index', rel: 'index.html' },
  { id: 'paper-dialogs', rel: 'paper/dev/dialogs/index.html' },
  { id: 'velocity-tuning', rel: 'velocity/tuning/index.html' },
];

const rows = [];

async function runOne(browser, proto, profile, pg) {
  const url = proto === 'file'
    ? pathToFileURL(path.join(REPO, pg.rel)).href
    : BASE + '/' + pg.rel;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  const failed = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  page.on('requestfailed', (r) => failed.push({ url: r.url().slice(-70), reason: (r.failure() && r.failure().errorText) || '?' }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: profile.offline, latency: profile.latency, downloadThroughput: profile.download, uploadThroughput: profile.upload,
  });
  const t0 = Date.now();
  let gotoErr = null;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: profile.offline && proto === 'http' ? 12000 : 60000 });
  } catch (e) { gotoErr = String(e.message).slice(0, 200); }
  const tDom = Date.now() - t0;
  // 等 load（失败也算），再等样式表结算
  try { await page.waitForLoadState('load', { timeout: profile.offline && proto === 'http' ? 6000 : 45000 }); } catch (e) { /* ignore */ }
  const tLoad = Date.now() - t0;
  await page.waitForTimeout(500);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const cs = getComputedStyle(de);
    const bodyCS = getComputedStyle(document.body);
    const art = document.querySelector('.article') || document.querySelector('main.content') || document.querySelector('main');
    // FCP
    let fcp = null;
    for (const e of performance.getEntriesByType('paint') || []) if (e.name === 'first-contentful-paint') fcp = Math.round(e.startTime);
    const res = performance.getEntriesByType('resource') || [];
    const css = res.filter((r) => /\.css($|\?)/.test(r.name));
    const js = res.filter((r) => /\.js($|\?)/.test(r.name));
    const articleText = art ? (art.innerText || '').replace(/\s+/g, ' ').trim() : '';
    return {
      topbarH: cs.getPropertyValue('--topbar-h').trim(),
      bodyBg: bodyCS.backgroundColor,
      articleW: art ? Math.round(art.getBoundingClientRect().width) : null,
      articleChars: articleText.length,
      articleHead: articleText.slice(0, 120),
      fcp,
      resourceCount: res.length,
      cssCount: css.length,
      cssTransfer: css.reduce((a, r) => a + (r.transferSize || 0), 0),
      jsCount: js.length,
      jsTransfer: js.reduce((a, r) => a + (r.transferSize || 0), 0),
      // 无样式骨架的判据：CSS 变量没生效 / body 背景是默认白但 topbar 不 sticky
      probeSticky: (() => { const d = document.createElement('div'); d.className = 'topbar'; document.body.appendChild(d); const p = getComputedStyle(d).position; d.remove(); return p; })(),
      searchInput: !!document.getElementById('search-input'),
      navToggle: !!document.getElementById('nav-toggle'),
      overflow: Math.max(0, de.scrollWidth - de.clientWidth),
      docChars: (document.body.innerText || '').length,
    };
  });

  const row = {
    proto, profile: profile.id, profileNote: profile.note, page: pg.id, url,
    domMs: tDom, loadMs: tLoad, gotoError: gotoErr,
    ...m,
    errors: errs.slice(0, 5),
    failedCount: failed.length,
    failedSample: failed.slice(0, 5),
  };
  row.ok = {
    // 首屏可读：CSS 生效（--topbar-h + sticky 探针）+ 正文有内容
    styled: row.topbarH !== '' && row.probeSticky === 'sticky' && row.bodyBg !== 'rgba(0, 0, 0, 0)',
    readable: row.docChars > 500 && row.articleChars > 200,
    noFatalErrors: errs.length === 0,
    noHScroll: row.overflow === 0,
  };
  row.okAll = row.ok.styled && row.ok.readable && row.ok.noFatalErrors && row.ok.noHScroll;
  rows.push(row);
  console.log('[' + (row.okAll ? 'PASS' : 'FAIL') + '] ' + proto + ' ' + profile.id.padEnd(7) + ' ' + pg.id.padEnd(16) +
    ' dom=' + String(row.domMs).padStart(5) + 'ms load=' + String(row.loadMs).padStart(5) + 'ms' +
    ' fcp=' + String(row.fcp).padStart(5) + 'ms' +
    ' css=' + row.cssCount + '/' + row.cssTransfer + 'B js=' + row.jsCount + '/' + row.jsTransfer + 'B' +
    ' chars=' + row.docChars + ' styled=' + row.ok.styled + ' failedReq=' + row.failedCount +
    (gotoErr ? ' gotoErr=' + gotoErr.slice(0, 60) : '') + (errs.length ? ' ERR=' + errs[0].slice(0, 80) : ''));
  await ctx.close();
  return row;
}

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  console.log('BROWSER ' + exe);
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });
  try {
    for (const profile of PROFILES) {
      for (const proto of ['http', 'file']) {
        for (const pg of PAGES) {
          try { await runOne(browser, proto, profile, pg); }
          catch (e) {
            rows.push({ proto, profile: profile.id, page: pg.id, fatal: String(e.message).slice(0, 300) });
            console.log('[THROW] ' + proto + ' ' + profile.id + ' ' + pg.id + ' :: ' + String(e.message).slice(0, 160));
          }
        }
      }
    }
  } finally { await browser.close(); }

  const fail = rows.filter((r) => !r.okAll);
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ tool: 'tools/b1o-network.js', generatedAt: new Date().toISOString(), base: BASE, rows, summary: { total: rows.length, pass: rows.length - fail.length, fail: fail.length } }, null, 2), 'utf8');
  console.log('\n==== ' + (rows.length - fail.length) + '/' + rows.length + ' PASS  -> ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
