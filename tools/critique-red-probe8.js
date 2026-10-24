'use strict';
/** critique-red-probe8.js — 移动首屏构成 / 侧栏 summary 截断 / 真正文对比度 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = process.cwd();
const EXE = [process.env.CHROME_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find((p) => fs.existsSync(p));

const PROBE = () => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), top: Math.round(r.top) }; };
  const lum = (c) => { const m = String(c).match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); if (l1 == null || l2 == null) return null; const [x, y] = l1 > l2 ? [l1, l2] : [l2, l1]; return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const bgOf = (el) => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; e = e.parentElement; } return 'rgb(255, 255, 255)'; };

  /* 侧栏截断：同时覆盖 a 与 summary 及其内部标签元素 */
  const trunc = [];
  for (const el of qa('.sidebar a, .sidebar summary, .sidebar .ttl, .sidebar .side-group-title, .side-sec a, .toc-side a')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const over = el.scrollWidth > el.clientWidth + 1;
    const st = getComputedStyle(el);
    if (over || st.textOverflow === 'ellipsis') {
      trunc.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 34), txt: (el.textContent || '').trim().slice(0, 44), cw: el.clientWidth, sw: el.scrollWidth, overPx: el.scrollWidth - el.clientWidth, ellipsis: st.textOverflow, overflow: st.overflow, whiteSpace: st.whiteSpace, truncated: over && st.textOverflow === 'ellipsis' });
    }
  }

  const art = q('.article');
  const bodyP = art ? [...art.querySelectorAll('p')].find((p) => !p.className && (p.textContent || '').trim().length > 80) : null;

  return {
    layoutDisplay: q('.layout') ? getComputedStyle(q('.layout')).display : null,
    layoutFlexDir: q('.layout') ? getComputedStyle(q('.layout')).flexDirection : null,
    contentOrder: q('.content') ? getComputedStyle(q('.content')).order : null,
    tocOrder: q('.toc-side') ? getComputedStyle(q('.toc-side')).order : null,
    vh: window.innerHeight,
    tocSide: R(q('.toc-side')),
    tocDetailsOpen: (() => { const d = q('.toc-side details'); return d ? d.open : null; })(),
    tocItems: qa('.toc-side a').length,
    article: R(art),
    h1: R(art && art.querySelector('h1')),
    crumbs: R(q('.crumbs')),
    pageMeta: R(q('.page-meta')),
    tocContrib: (() => { const t = q('.toc-side'); if (!t) return null; const r = t.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), coversFoldPct: Math.round((Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) / window.innerHeight * 100) }; })(),
    h1BelowFold: (() => { const h = art && art.querySelector('h1'); return h ? h.getBoundingClientRect().top > window.innerHeight : null; })(),
    trunc,
    bodyContrast: bodyP ? { fs: getComputedStyle(bodyP).fontSize, color: getComputedStyle(bodyP).color, bg: bgOf(bodyP), ratio: ratio(getComputedStyle(bodyP).color, bgOf(bodyP)), sample: bodyP.textContent.trim().slice(0, 40) } : null,
    tocLinkH: (() => { const a = q('.toc-side a'); return a ? Math.round(a.getBoundingClientRect().height) : null; })(),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = [];
  for (const vp of [{ n: '390x844', w: 390, h: 844, m: true }, { n: '320x568', w: 320, h: 568, m: true }, { n: '768x1024', w: 768, h: 1024, m: true }, { n: '1440x900', w: 1440, h: 900, m: false }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.m, hasTouch: vp.m, colorScheme: 'light' });
    const page = await ctx.newPage();
    for (const p of ['/paper/dev/dialogs/']) {
      await page.goto('http://127.0.0.1:8787' + p, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(350);
      const d = await page.evaluate(PROBE);
      out.push({ vp: vp.n, page: p, ...d });
      console.log('=== ' + vp.n + ' ' + p);
      console.log('  layout=' + d.layoutDisplay + ' dir=' + d.layoutFlexDir + ' contentOrder=' + d.contentOrder + ' tocOrder=' + d.tocOrder + ' tocDetails.open=' + d.tocDetailsOpen + ' tocItems=' + d.tocItems);
      console.log('  vh=' + d.vh + ' tocSide=' + JSON.stringify(d.tocSide) + ' h1=' + JSON.stringify(d.h1) + ' article.top=' + (d.article && d.article.top) + ' h1BelowFold=' + d.h1BelowFold);
      console.log('  tocContrib=' + JSON.stringify(d.tocContrib) + ' tocLinkH=' + d.tocLinkH);
      console.log('  bodyContrast=' + JSON.stringify(d.bodyContrast));
      console.log('  trunc(' + d.trunc.length + '): ' + JSON.stringify(d.trunc.filter((x) => x.truncated).slice(0, 8)));
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join('reports', 'critique-red-probe8.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('写出 reports/critique-red-probe8.json');
})();
