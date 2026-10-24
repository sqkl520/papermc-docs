'use strict';
/** critique-red-probe7.js — 侧栏标签截断审计 + 顶栏/首屏纵向占用 + 颜色对比度 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = process.cwd();
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));

const TRUNC = () => {
  const rows = [];
  for (const a of document.querySelectorAll('.sidebar a, .toc-side a, .crumbs a, .side-sec a')) {
    const r = a.getBoundingClientRect(); if (!r.width) continue;
    const el = a.querySelector('.ttl, .lbl') || a;
    const over = el.scrollWidth > el.clientWidth + 1;
    if (over) rows.push({ region: a.closest('.sidebar') ? 'sidebar' : a.closest('.toc-side') ? 'toc' : 'other', txt: (a.textContent || '').trim().slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth, overflowPx: el.scrollWidth - el.clientWidth, tert: el.className });
  }
  return rows;
};
const CONTRAST = () => {
  const lum = (c) => { const m = c.match(/\d+/g); if (!m) return null; const [r, g, b] = m.map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); if (l1 == null || l2 == null) return null; const [x, y] = l1 > l2 ? [l1, l2] : [l2, l1]; return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const bgOf = (el) => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; };
  const items = [];
  const sel = ['.page-desc', '.page-meta', '.crumbs a', '.side-group-title .grp-zh', '.side-count', '.side-legend', '.sr-path', '.sr-snip', '.pager .pth', '.toc-side a', '.side-sec a', '.article p', '.article h2', '.article code', '.code-title', '.chip', '.footnote-back', '.details-summary', '.alert-title', '.banner'];
  for (const s of sel) {
    const el = document.querySelector(s); if (!el) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const cs = getComputedStyle(el);
    items.push({ sel: s, fs: parseFloat(cs.fontSize), color: cs.color, bg: bgOf(el), ratio: ratio(cs.color, bgOf(el)), bold: parseInt(cs.fontWeight, 10) >= 700, sample: (el.textContent || '').trim().slice(0, 30) });
  }
  return items;
};
const FOLD = () => {
  const q = (s) => document.querySelector(s);
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }; };
  const art = q('.article');
  const firstH2 = art && art.querySelector('h2');
  return {
    topbar: R(q('.topbar')), h1: R(art && art.querySelector('h1')), desc: R(q('.page-desc')), chips: R(q('.page-meta')), firstH2: R(firstH2),
    vh: window.innerHeight,
    firstH2BelowFold: firstH2 ? firstH2.getBoundingClientRect().top > window.innerHeight : null,
    contentTop: R(q('.content')),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { trunc: [], contrast: [], fold: [] };
  for (const vp of [{ n: '1440x900', w: 1440, h: 900, m: false }, { n: '1280x800', w: 1280, h: 800, m: false }, { n: '1025x800', w: 1025, h: 800, m: false }, { n: '390x844', w: 390, h: 844, m: true }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m, colorScheme: 'light' });
    const page = await ctx.newPage();
    for (const p of ['/paper/dev/dialogs/', '/velocity/tuning/', '/']) {
      await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(250);
      if (vp.n === '390x844') { await page.evaluate(() => { const b = document.querySelector('#nav-toggle'); if (b) b.click(); }); await page.waitForTimeout(400); }
      const t = await page.evaluate(TRUNC);
      const f = await page.evaluate(FOLD);
      out.trunc.push({ vp: vp.n, page: p, count: t.length, rows: t.slice(0, 20) });
      out.fold.push({ vp: vp.n, page: p, ...f });
      console.log('TRUNC ' + vp.n.padEnd(9) + p.padEnd(24) + '截断=' + t.length + (t[0] ? '  e.g. "' + t[0].txt + '" 溢出' + t[0].overflowPx + 'px (' + t[0].region + ')' : ''));
      console.log('FOLD  ' + vp.n.padEnd(9) + p.padEnd(24) + JSON.stringify({ topbar: f.topbar && f.topbar.h, h1: f.h1 && f.h1.h, firstH2Y: f.firstH2 && f.firstH2.y, vh: f.vh, h2BelowFold: f.firstH2BelowFold }));
      if (vp.n === '1440x900' && p === '/paper/dev/dialogs/') {
        out.contrast = await page.evaluate(CONTRAST);
        for (const c of out.contrast) console.log('  CONTRAST ' + String(c.sel).padEnd(26) + ' fs=' + String(c.fs).padEnd(6) + ' ratio=' + String(c.ratio).padEnd(6) + ' bold=' + c.bold + ' ' + c.color + ' on ' + c.bg);
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe7.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe7.json');
})();
