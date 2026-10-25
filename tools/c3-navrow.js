'use strict';
/**
 * c3-navrow.js — 定位抽屉内 navRow 的最小行高来自哪个元素（只读）
 * 对 8787（当前工作树产物）与 8788（9c82b47 基线）各测一次，用于判断
 * navRowMin=24 是否由批 3（C3 断点搬家）引入。
 *
 * 用法：node tools/c3-navrow.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* 与 verify-mobile.js 的 navRows 选择器口径一致：抽屉内导航链接 */
const NAV = () => {
  const side = document.querySelector('#sidebar');
  if (!side) return { err: 'no sidebar' };
  const rows = [...side.querySelectorAll('a')].filter((a) => {
    const cs = getComputedStyle(a);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = a.getBoundingClientRect();
    return r.height > 0;
  });
  const hs = rows.map((a) => ({ h: Math.round(a.getBoundingClientRect().height * 100) / 100, cls: a.className || '', href: a.getAttribute('href') || '', txt: (a.textContent || '').trim().slice(0, 24) }));
  hs.sort((x, y) => x.h - y.h);
  return { count: hs.length, min: hs[0] || null, bottom5: hs.slice(0, 5), top3: hs.slice(-3) };
};

(async () => {
  if (!EXE) throw new Error('no chrome');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  try {
    for (const [label, base] of [['8787 工作树', 'http://127.0.0.1:8787'], ['8788 基线 9c82b47', 'http://127.0.0.1:8788']]) {
      for (const w of [390, 768]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', bypassCSP: true });
        const page = await ctx.newPage();
        await page.goto(base + '/paper/dev/pdc/', { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(150);
        /* 打开抽屉（<1200 时 ☰ 可见） */
        const btn = await page.$('#nav-toggle');
        if (btn) { const vis = await btn.isVisible().catch(() => false); if (vis) { await btn.click().catch(() => {}); await page.waitForTimeout(300); } }
        const r = await page.evaluate(NAV);
        console.log('\n[' + label + '] vw=' + w + '  navRows=' + r.count);
        if (r.min) console.log('  MIN h=' + r.min.h + '  cls="' + r.min.cls + '"  href=' + r.min.href + '  txt="' + r.min.txt + '"');
        if (r.bottom5) for (const x of r.bottom5) console.log('    h=' + x.h + ' cls="' + x.cls + '" txt="' + x.txt + '"');
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
