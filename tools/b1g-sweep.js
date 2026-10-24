'use strict';
/**
 * b1g-sweep.js - width sweep across the TOC breakpoint band + light/dark parity.
 *
 * (1) article/content width for a TOC page and a non-TOC page from 1000..1300 px,
 *     before vs after, to expose the 1025/1201 breakpoint cliff.
 * (2) light vs dark equality of the same fields (same build), to prove dark mode
 *     introduces no separate geometry.
 *
 * Usage: node tools/b1g-sweep.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const AFTER = 'http://127.0.0.1:8787';
const BEFORE = 'http://127.0.0.1:8788';
const WIDTHS = [1000, 1024, 1025, 1060, 1100, 1150, 1199, 1200, 1201, 1210, 1279, 1280, 1440];
const PAGES = [
  { url: '/paper/dev/dialogs/', name: 'dialogs(TOC)' },
  { url: '/paper/reference/world-configuration/', name: 'world-config(noTOC)' },
];

const M = () => {
  const q = (s) => document.querySelector(s);
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x * 100) / 100, w: Math.round(b.width * 100) / 100 }; };
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = q('article');
  const prose = art ? [...art.querySelectorAll('p')].find((p) => (p.textContent || '').trim().length >= 40) : null;
  const st = prose ? getComputedStyle(prose) : null;
  let lineW = null;
  if (prose) {
    const rg = document.createRange(); rg.selectNodeContents(prose);
    const rs = [...rg.getClientRects()].filter((x) => x.width > 1);
    if (rs.length) lineW = Math.round(Math.max(...rs.map((x) => x.width)) * 100) / 100;
  }
  return {
    article: r(art), content: r(q('.content')),
    toc: q('.toc-side') ? { d: cs(q('.toc-side'), 'display'), w: r(q('.toc-side')).w } : null,
    lineW,
    fs: st ? parseFloat(st.fontSize) : null,
    lh: st ? parseFloat(st.lineHeight) : null,
    pageH: document.documentElement.scrollHeight,
    scrollW: document.documentElement.scrollWidth,
  };
};

(async () => {
  if (!EXE) { console.error('no chrome'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { generated_at: new Date().toISOString(), sweep: [], parity: {} };

  for (const pg of PAGES) {
    for (const w of WIDTHS) {
      const rec = { page: pg.name, width: w };
      for (const [side, base] of [['before', BEFORE], ['after', AFTER]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(base + pg.url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(300);
        rec[side] = await page.evaluate(M);
        await ctx.close();
      }
      out.sweep.push(rec);
      console.log(pg.name.padEnd(20) + String(w).padEnd(6) +
        'before art.x/w=' + (rec.before.article ? rec.before.article.x + '/' + rec.before.article.w : '-') +
        ' toc=' + (rec.before.toc ? rec.before.toc.d : '-') +
        ' | after art.x/w=' + (rec.after.article ? rec.after.article.x + '/' + rec.after.article.w : '-') +
        ' toc=' + (rec.after.toc ? rec.after.toc.d : '-'));
    }
  }

  // light vs dark parity on the after build (same page/viewport set as the diff)
  for (const scheme of ['light', 'dark']) {
    for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }]) {
      for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: vp.n === '390', hasTouch: vp.n === '390' });
        const page = await ctx.newPage();
        await page.goto(AFTER + u, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100, Math.round(b.width * 100) / 100]; };
          const art = q('article');
          const prose = art ? [...art.querySelectorAll('p')].find((p) => (p.textContent || '').trim().length >= 40) : null;
          const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
          const pre = q('pre'); const code = pre && pre.querySelector('code');
          return {
            theme: document.documentElement.getAttribute('data-theme'),
            article: r(art), pageH: document.documentElement.scrollHeight,
            fs: prose ? parseFloat(cs(prose, 'fontSize')) : null,
            lh: prose ? parseFloat(cs(prose, 'lineHeight')) : null,
            color: cs(prose, 'color'),
            codeFs: code ? parseFloat(cs(code, 'fontSize')) : null,
            codeAdvance: (() => {
              if (!code) return null;
              const rg = document.createRange(); rg.selectNodeContents(code);
              const rs = [...rg.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
              const tops = [...new Set(rs.map((x) => Math.round(x.top)))].sort((a, b) => a - b);
              const d = []; for (let i = 1; i < tops.length; i++) d.push(tops[i] - tops[i - 1]);
              d.sort((a, b) => a - b); return d.length ? d[Math.floor(d.length / 2)] : null;
            })(),
            h1: (() => { const h = q('article h1'); return h ? [parseFloat(cs(h, 'fontSize')), parseFloat(cs(h, 'marginTop'))] : null; })(),
            img: (() => { const i = q('article img'); return i ? [Math.round(i.getBoundingClientRect().width * 100) / 100, Math.round(i.getBoundingClientRect().height * 100) / 100] : null; })(),
          };
        });
        out.parity[scheme + ' ' + vp.n + ' ' + u] = m;
        await ctx.close();
      }
    }
  }
  await browser.close();

  const file = path.join('reports', 'b1-shots', '_sweep.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

  console.log('\n== light vs dark parity (after build) ==');
  for (const vp of ['1440', '390']) {
    for (const u of ['/paper/dev/dialogs/', '/paper/reference/world-configuration/']) {
      const l = out.parity['light ' + vp + ' ' + u];
      const d = out.parity['dark ' + vp + ' ' + u];
      const keys = ['article', 'pageH', 'fs', 'lh', 'codeFs', 'codeAdvance', 'h1', 'img'];
      const diff = keys.filter((k) => JSON.stringify(l[k]) !== JSON.stringify(d[k]));
      console.log(vp.padEnd(5) + u.padEnd(40) + 'diff=' + (diff.length ? diff.join(',') : 'NONE') +
        ' color ' + l.color + ' vs ' + d.color +
        ' article ' + JSON.stringify(l.article) + ' vs ' + JSON.stringify(d.article));
    }
  }
  console.log('\nwrote ' + file);
})();
