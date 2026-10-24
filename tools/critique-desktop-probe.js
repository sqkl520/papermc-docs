/* critique-desktop-probe.js — targeted fixed measurement pass
 * Checks: real ch-capacity of the text column, overflow identity of wide blocks,
 * code/table sizes, image loading attributes, TOC active tracking, index-table filter.
 * Usage: node tools/critique-desktop-probe.js [--base=...] [--vp=1440x900]
 * Writes reports/_critique-desktop-probe.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const h = process.argv.find(a => a.startsWith('--' + n + '=')); return h ? h.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:8787');
const [VW, VH] = arg('vp', '1440x900').split('x').map(Number);
const OUT = path.join(ROOT, 'reports', '_critique-desktop-probe.json');
const EXE = [process.env.CHROME_PATH,
process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean).find(p => fs.existsSync(p));
const PAGES = ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  let page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const fresh = async p => { try { await page.close(); } catch (e) { } page = await ctx.newPage(); page.setDefaultTimeout(60000); await page.goto(BASE + p, { waitUntil: 'load' }); await page.waitForTimeout(300); };
  const out = [];

  for (const p of PAGES) {
    await fresh(p);
    const r = await page.evaluate(() => {
      const qa = s => Array.from(document.querySelectorAll(s));
      const cs = el => getComputedStyle(el);
      const px = v => Math.round(parseFloat(v) * 10) / 10;
      const box = el => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +(b.y + scrollY).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +b.right.toFixed(1) }; };

      // real ch capacity using the actual paragraph font, measured in the live DOM
      const p0 = document.querySelector('.article p');
      let ch = null, perZero = null, perN = null, perX = null, fontOf = null;
      if (p0) {
        const s = cs(p0); fontOf = s.fontSize + '/' + s.fontFamily.split(',')[0];
        const host = p0;
        const mk = (txt) => { const d = document.createElement('span'); d.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;font:' + s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + '/' + s.lineHeight + ' ' + s.fontFamily; d.textContent = txt; host.appendChild(d); const w = d.getBoundingClientRect().width / txt.length; d.remove(); return w; };
        perZero = mk('0'.repeat(200)); perN = mk('n'.repeat(200)); perX = mk('x'.repeat(200));
        const w = p0.getBoundingClientRect().width;
        ch = { mZero: +(w / perZero).toFixed(1), mN: +(w / perN).toFixed(1), mMix: +(w / ((perZero + perN + perX) / 3)).toFixed(1), w };
      }

      const wide = qa('.code-block, .table-wrap, .alert, .article > p, .article figure').slice(0, 60).map(el => {
        const b = box(el); const s = cs(el);
        return { tag: el.tagName + '.' + (el.className || '').split(' ')[0], w: b.w, x: b.x, right: b.right, ml: s.marginLeft, mr: s.marginRight, padL: s.paddingLeft, padR: s.paddingRight, maxW: s.maxWidth, width: s.width, display: s.display, parentW: el.parentElement ? +el.parentElement.getBoundingClientRect().width.toFixed(1) : null, parentCls: el.parentElement ? (el.parentElement.className || '').split(' ')[0] : null, parentBox: el.parentElement ? box(el.parentElement) : null };
      });

      const code = qa('.code-block').map(cb => {
        const pre = cb.querySelector('pre'); const sc = cb.querySelector('.code-scroll') || pre;
        const lines = (pre ? pre.textContent : '').replace(/\n$/, '').split('\n');
        const monoSpan = (() => { const s = cs(pre); const d = document.createElement('span'); d.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;font:' + s.fontSize + ' ' + s.fontFamily; d.textContent = '0'.repeat(200); document.body.appendChild(d); const w = d.getBoundingClientRect().width / 200; d.remove(); return w; })();
        const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
        return { box: box(cb), scrollBox: box(sc), scrollW: sc.scrollWidth, clientW: sc.clientWidth, overBy: sc.scrollWidth - sc.clientWidth, overflowX: cs(sc).overflowX, lines: lines.length, longestChars: longest.length, longestHead: longest.slice(0, 80), longestPx: Math.round(longest.length * monoSpan), monoPerChar: +monoSpan.toFixed(3), preFs: px(cs(pre).fontSize), preLh: px(cs(pre).lineHeight), lang: (() => { const l = cb.querySelector('.code-lang'); return l ? l.textContent.trim() : null; })(), copyBox: (() => { const c = cb.querySelector('.code-copy'); return c ? box(c) : null; })(), titleBox: (() => { const t = cb.querySelector('.code-title'); return t ? box(t) : null; })(), tabindex: sc.getAttribute('tabindex'), region: sc.getAttribute('role') };
      });

      const tables = qa('.table-wrap').map(w => { const t = w.querySelector('table'); const firstRow = Array.from(t.querySelectorAll('tbody tr:first-child > *')); const ths = Array.from(w.querySelectorAll('thead th')); return { box: box(w), tableBox: box(t), rows: t.querySelectorAll('tbody tr').length, cols: firstRow.length, headers: ths.map(x => x.textContent.trim()), colW: firstRow.map(c => +c.getBoundingClientRect().width.toFixed(0)), thPos: ths[0] ? cs(ths[0]).position : null, thBg: ths[0] ? cs(ths[0]).backgroundColor : null, fs: px(cs(t).fontSize), wrapPad: cs(w).padding, scrollW: w.scrollWidth, clientW: w.clientWidth, over: w.scrollWidth > w.clientWidth + 1 }; });

      const images = qa('.article img').map(im => { const b = box(im); return { src: (im.currentSrc || im.src || '').split('/').pop(), box: b, nat: im.naturalWidth + 'x' + im.naturalHeight, complete: im.complete, alt: im.getAttribute('alt'), loading: im.getAttribute('loading'), decoding: im.getAttribute('decoding'), w: im.getAttribute('width'), h: im.getAttribute('height'), styleAttr: im.getAttribute('style'), cls: im.className, level: px(cs(im).aspectRatio || ''), fillOfArticle: (() => { const a = document.querySelector('.article'); return a ? +(b.w / a.getBoundingClientRect().width).toFixed(3) : null; })(), dataLcb: im.getAttribute('data-lcb-src') }; });

      const colors = (() => { const g = {}, add = (k, v) => { const kk = k + '@' + v; g[kk] = (g[kk] || 0) + 1; }; const pick = ['background-color', 'color', 'border-color', 'border-radius', 'box-shadow', 'border-width', 'font-weight'];
        for (const el of qa('.article *').slice(0, 4000)) { const s = cs(el); for (const pr of pick) add(pr, s[pr.replace(/-(\w)/g, (m, c) => c.toUpperCase())] || s.getPropertyValue(pr)); }
        const top = Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 60); return top; })();

      const radii = (() => { const g = {}; for (const el of qa('.article *, .topbar *, .sidebar *, .toc-side *').slice(0, 6000)) { const r = cs(el).borderRadius; g[r] = (g[r] || 0) + 1; } return Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 20); })();
      const shadows = (() => { const g = {}; for (const el of qa('.article *, .topbar *, .sidebar *, .toc-side *').slice(0, 6000)) { const r = cs(el).boxShadow; g[r] = (g[r] || 0) + 1; } return Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 12); })();
      const widths = (() => { const g = {}; for (const el of qa('.article *, .topbar *, .sidebar *').slice(0, 6000)) { const s = cs(el); const k = s.borderTopWidth + '|' + s.borderTopStyle; g[k] = (g[k] || 0) + 1; } return Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 12); })();
      const fw = (() => { const g = {}; for (const el of qa('.article *, .topbar *, .sidebar *, .toc-side *').slice(0, 6000)) { const r = cs(el).fontWeight; g[r] = (g[r] || 0) + 1; } return Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 12); })();

      const rhythm = (() => {
        const kids = Array.from(document.querySelectorAll('.article > *')).slice(0, 200);
        const seq = kids.map(el => { const s = cs(el); const b = box(el); return { tag: el.tagName + (el.className ? '.' + el.className.split(' ')[0] : ''), mt: px(s.marginTop), mb: px(s.marginBottom), h: b.h, y: b.y }; });
        let prev = null; const gaps = [];
        for (const k of seq) { if (prev) gaps.push({ from: prev.tag, to: k.tag, gap: +(k.y - (prev.y + prev.h)).toFixed(1) }); prev = k; }
        return { seq: seq.slice(0, 40), gaps: gaps.slice(0, 40) };
      })();

      return { path: location.pathname, docH: document.documentElement.scrollHeight, ch, fontOf, wide: wide.slice(0, 24), code, tables, images, colors, radii, shadows, borderWidths: widths, fontWeights: fw, rhythm };
    });
    out.push(r);
  }

  await fresh('/paper/dev/dialogs/');
  const track = [];
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (const f of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    await page.evaluate(y => window.scrollTo(0, y), Math.round(H * f));
    await page.waitForTimeout(800);
    track.push(await page.evaluate(() => ({ y: Math.round(scrollY), active: Array.from(document.querySelectorAll('.toc-side a.active')).map(a => a.textContent.trim()), tocTop: Math.round(document.querySelector('.toc-side').getBoundingClientRect().top), tocScrollTop: document.querySelector('.toc-side').scrollTop, tocScrollH: document.querySelector('.toc-side').scrollHeight, tocClientH: document.querySelector('.toc-side').clientHeight })));
  }

  await fresh('/all-pages.html');
  const idx = await page.evaluate(async () => {
    const th = document.querySelector('table.allpages thead th');
    const t0 = th.getBoundingClientRect().top;
    window.scrollTo(0, 5000); await new Promise(r => setTimeout(r, 500));
    const t1 = th.getBoundingClientRect().top;
    const f = document.querySelector('.filter-bar input');
    const res = { thPos: getComputedStyle(th).position, thTopAt0: Math.round(t0), thTopAt5000: Math.round(t1), ariaSort: !!document.querySelector('thead [aria-sort]'), thClickable: !!document.querySelector('thead th button, thead th[role=button], thead th a'), filterPh: f ? f.placeholder : null, filterCount: (document.querySelector('.filter-count') || {}).textContent, rowHeights: Array.from(document.querySelectorAll('table.allpages tbody tr')).slice(0, 6).map(r => Math.round(r.getBoundingClientRect().height)), colWidths: Array.from(document.querySelectorAll('table.allpages thead th')).map(x => Math.round(x.getBoundingClientRect().width)) };
    if (f) { f.value = 'velocity'; f.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 400)); res.afterFilterCount = (document.querySelector('.filter-count') || {}).textContent; res.afterFilterRows = Array.from(document.querySelectorAll('table.allpages tbody tr')).filter(r => r.offsetParent !== null).length; res.afterFilterTotalRows = document.querySelectorAll('table.allpages tbody tr').length; }
    return res;
  });

  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, viewport: VW + 'x' + VH, pages: out, tocTrack: track, index: idx }, null, 1), 'utf8');
  console.log('wrote', OUT);
  await browser.close();
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
