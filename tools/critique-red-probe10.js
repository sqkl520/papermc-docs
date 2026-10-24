'use strict';
/** critique-red-probe10.js — 深色对比度 + 标题层级使用率 + ellipsis/word-break 归属取证 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = process.cwd();
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));

const CONTRAST = () => {
  const lum = (c) => { const m = String(c).match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); if (l1 == null || l2 == null) return null; const [x, y] = l1 > l2 ? [l1, l2] : [l2, l1]; return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const bgOf = (el) => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  const art = document.querySelector('.article');
  const bodyP = art ? [...art.querySelectorAll('p')].find((p) => !p.className && (p.textContent || '').trim().length > 80) : null;
  const rows = [];
  const add = (label, el) => { if (!el) return; const r = el.getBoundingClientRect(); if (!r.width) return; const cs = getComputedStyle(el); rows.push({ label, fs: parseFloat(cs.fontSize), color: cs.color, bg: bgOf(el), ratio: ratio(cs.color, bgOf(el)), bold: parseInt(cs.fontWeight, 10) >= 700 }); };
  add('body p (真正文)', bodyP);
  add('.page-desc', document.querySelector('.page-desc'));
  add('.page-meta', document.querySelector('.page-meta'));
  add('.crumbs a', document.querySelector('.crumbs a'));
  add('.toc-side a', document.querySelector('.toc-side a'));
  add('.side-count', document.querySelector('.side-count'));
  add('.side-legend', document.querySelector('.side-legend'));
  add('.side-group-title .grp-zh', document.querySelector('.side-group-title .grp-zh'));
  add('.code-title', document.querySelector('.code-title'));
  add('.chip', document.querySelector('.chip'));
  add('.alert-body / blockquote', document.querySelector('.article blockquote'));
  add('.article code', document.querySelector('.article code'));
  return { theme: document.documentElement.getAttribute('data-theme'), bodyBg: getComputedStyle(document.body).backgroundColor, rows };
};

const HEADINGS = () => {
  const art = document.querySelector('.article');
  if (!art) return null;
  const cs = (el) => { const c = getComputedStyle(el); return { fs: parseFloat(c.fontSize), fw: c.fontWeight, color: c.color }; };
  const by = {};
  for (const n of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const els = [...art.querySelectorAll(n)];
    by[n] = { count: els.length, style: els[0] ? cs(els[0]) : null, fsOverride: els[0] ? cs(els[0]).fs : null };
  }
  const p = [...art.querySelectorAll('p')].find((x) => !x.className && (x.textContent || '').trim().length > 80);
  return { headings: by, bodyFS: p ? parseFloat(getComputedStyle(p).fontSize) : null };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { contrast: {}, headings: {} };
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    for (const p of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
      await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(300);
      const c = await page.evaluate(CONTRAST);
      out.contrast[scheme + ' ' + p] = c;
      console.log('=== ' + scheme + ' ' + p + ' bodyBg=' + c.bodyBg);
      for (const r of c.rows) console.log('   ' + String(r.label).padEnd(24) + ' fs=' + String(r.fs).padEnd(7) + ' ratio=' + String(r.ratio).padEnd(7) + (r.bold ? 'bold ' : '     ') + r.color + ' on ' + r.bg + '  AA=' + (r.bold ? r.ratio >= 3 : r.ratio >= 4.5));
      if (scheme === 'light') {
        const h = await page.evaluate(HEADINGS);
        out.headings[p] = h;
        console.log('   HEADINGS ' + JSON.stringify(h));
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe10.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe10.json');
})();
