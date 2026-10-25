#!/usr/bin/env node
'use strict';
/**
 * b1o-bisect.js — 二分出「横向溢出开始出现的视口宽度」，给出可复现的最小条件。
 *
 * 已知：320 / 240 宽无溢出，160 宽有溢出。二分找阈值，并对每个阈值给出真肇事者。
 * 同时对 topbar 单独量「不溢出所需的最小宽度」。
 *
 * 用法：node tools/b1o-bisect.js [--json=$env:TEMP\b1o\bisect.json]
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const REPO = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const OUT_JSON = path.resolve(opt('json', path.join(require("os").tmpdir() || '.', 'b1o', 'bisect.json')));

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean);
function browserPath() { for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch { /* */ } } return null; }

const PAGES = ['index.html', 'all-pages.html', 'paper/dev/dialogs/index.html', 'velocity/tuning/index.html'];
const out = { tool: 'tools/b1o-bisect.js', generatedAt: new Date().toISOString(), pages: [] };

async function overflowAt(browser, rel, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 400 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(REPO, rel)).href, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(320);
  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const CLIP = new Set(['auto', 'scroll', 'hidden', 'clip']);
    const clippedBy = (el) => { let p = el.parentElement; while (p && p !== de && p !== document.body) { if (CLIP.has(getComputedStyle(p).overflowX)) return p; p = p.parentElement; } return null; };
    const sel = (el) => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; if (el.className && typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.'); return s; };
    const real = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      const over = Math.round(b.right - vw);
      if (over <= 1) continue;
      if (clippedBy(el)) continue;
      real.push({ sel: sel(el), over, w: Math.round(b.width), minWidth: cs.minWidth, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
    }
    real.sort((a, b) => b.over - a.over);
    // topbar 自身所需最小宽度：量所有子项 scrollWidth 之和
    const tb = document.querySelector('.topbar');
    return {
      vw, overflow: Math.max(0, de.scrollWidth - vw),
      topbarScrollW: tb ? tb.scrollWidth : null,
      topbarOverflow: tb ? Math.max(0, tb.scrollWidth - tb.clientWidth) : null,
      culprits: real.slice(0, 6),
    };
  });
  await ctx.close();
  return r;
}

(async () => {
  const exe = browserPath();
  if (!exe) { console.error('no chrome found'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'] });

  for (const rel of PAGES) {
    const rec = { rel, probes: [] };
    // 先粗扫 100..360
    const coarse = [];
    for (let w = 100; w <= 360; w += 20) {
      const r = await overflowAt(browser, rel, w);
      coarse.push({ w, overflow: r.overflow, topbarOverflow: r.topbarOverflow, culprits: r.culprits });
    }
    rec.coarse = coarse;
    const clean = coarse.filter((c) => c.overflow === 0).map((c) => c.w);
    const dirty = coarse.filter((c) => c.overflow > 0).map((c) => c.w);
    rec.minCleanWidth = clean.length ? Math.min(...clean) : null;
    rec.maxDirtyWidth = dirty.length ? Math.max(...dirty) : null;
    // 在界上二分（1px）
    if (rec.minCleanWidth !== null && rec.maxDirtyWidth !== null) {
      let lo = rec.maxDirtyWidth, hi = rec.minCleanWidth;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const r = await overflowAt(browser, rel, mid);
        if (r.overflow === 0) hi = mid; else lo = mid;
      }
      rec.thresholdClean = hi;
      rec.thresholdDirty = lo;
      const last = await overflowAt(browser, rel, lo);
      rec.lastDirtyDetail = last;
    }
    out.pages.push(rec);
    console.log('\n=== ' + rel);
    for (const c of coarse) console.log('   w=' + String(c.w).padStart(3) + '  docOverflow=' + String(c.overflow).padStart(3) + '  topbarOverflow=' + String(c.topbarOverflow).padStart(3) + (c.culprits.length ? '  top: ' + c.culprits[0].sel + ' +' + c.culprits[0].over : ''));
    console.log('   -> 无溢出最小宽度=' + rec.minCleanWidth + '  开始溢出宽度=' + rec.maxDirtyWidth + '  1px 二分: 干净=' + (rec.thresholdClean || '-') + ' 脏=' + (rec.thresholdDirty || '-'));
    if (rec.lastDirtyDetail) console.log('   脏侧细节 ' + JSON.stringify(rec.lastDirtyDetail).slice(0, 400));
  }

  await browser.close();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
  console.log('\nWROTE ' + OUT_JSON);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
