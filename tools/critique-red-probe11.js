'use strict';
/** critique-red-probe11.js — CLS 实测 + 「全页真实渲染字号」普查（预防性反驳「字号过小」类批评） */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = process.cwd();
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));

const FONTS = () => {
  const skip = new Set(['SCRIPT', 'STYLE', 'TITLE', 'NOSCRIPT']);
  const acc = new Map();
  const walk = (el) => {
    if (skip.has(el.tagName)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 1);
    if (hasOwnText && r.width > 0 && r.height > 0) {
      const fs = Math.round(parseFloat(cs.fontSize) * 100) / 100;
      const key = fs;
      let e = acc.get(key);
      if (!e) { e = { fs, count: 0, samples: [] }; acc.set(key, e); }
      e.count++;
      if (e.samples.length < 4) e.samples.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 26), t: (el.textContent || '').trim().slice(0, 28) });
    }
    for (const c of el.children) walk(c);
  };
  walk(document.body);
  const rows = [...acc.values()].sort((a, b) => a.fs - b.fs);
  const els = [...document.querySelectorAll('body *')].filter((el) => !skip.has(el.tagName) && el.getBoundingClientRect().width > 0);
  return {
    min: rows[0] || null,
    under12: rows.filter((r) => r.fs < 12), under14: rows.filter((r) => r.fs < 14),
    totalTextEls: rows.reduce((a, r) => a + r.count, 0),
    rows: rows.slice(0, 14),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { cls: {}, fonts: {} };
  for (const vp of [{ n: '1440x900', w: 1440, h: 900, m: false }, { n: '1280x800', w: 1280, h: 800, m: false }, { n: '390x844', w: 390, h: 844, m: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m, colorScheme: 'light' });
    const page = await ctx.newPage();
    // CLS 观测：导航前注入
    await page.addInitScript(() => {
      window.__cls = { value: 0, entries: [] };
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            if (!e.hadRecentInput) { window.__cls.value += e.value; window.__cls.entries.push({ v: Math.round(e.value * 1e5) / 1e5, t: Math.round(e.startTime), src: e.sources && e.sources[0] ? String(e.sources[0].node && e.sources[0].node.nodeName) : null }); }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (e) {}
    });
    for (const p of ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html']) {
      await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
      // 触发交互：开合抽屉/搜索再关掉，看是否产生偏移
      if (vp.m) { await page.evaluate(() => { const b = document.querySelector('#nav-toggle'); if (b) b.click(); }); await page.waitForTimeout(350); await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
      await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(200); await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(900);
      const c = await page.evaluate(() => window.__cls);
      const f = await page.evaluate(FONTS);
      out.cls[vp.n + ' ' + p] = c;
      out.fonts[vp.n + ' ' + p] = f;
      console.log('CLS ' + vp.n.padEnd(9) + p.padEnd(42) + 'cls=' + String(Math.round(c.value * 1e4) / 1e4).padEnd(8) + ' shifts=' + c.entries.length + (c.entries[0] ? '  e.g. ' + JSON.stringify(c.entries[0]) : ''));
      console.log('    FONT min=' + (f.min ? f.min.fs + 'px ×' + f.min.count + ' (' + JSON.stringify(f.min.samples[0]) + ')' : '-') + '  <12px 档=' + f.under12.length + '  <14px 档=' + f.under14.length + '  文本元素数=' + f.totalTextEls);
      if (f.under14.length) console.log('    under14: ' + f.under14.map((r) => r.fs + 'px×' + r.count + '(' + (r.samples[0] ? r.samples[0].cls || r.samples[0].tag : '') + ')').join(' '));
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe11.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe11.json');
})();
