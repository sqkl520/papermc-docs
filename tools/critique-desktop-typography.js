/* critique-desktop-typography.js
 * Measure desktop typography / layout / accessibility facts on the local mirror.
 * Usage: node tools/critique-desktop-typography.js [--base=http://127.0.0.1:8787] [--vp=1440x900]
 * Writes reports/_critique-desktop-typo.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith('--' + n + '='));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const BASE = arg('base', 'http://127.0.0.1:8787');
const [VW, VH] = arg('vp', '1440x900').split('x').map(Number);
const OUT = path.join(ROOT, 'reports', '_critique-desktop-typo.json');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find(p => fs.existsSync(p));

const PAGES = ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const results = [];
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const data = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const qa = s => Array.from(document.querySelectorAll(s));
      const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
      const cs = el => el ? getComputedStyle(el) : null;
      const px = v => { const n = parseFloat(v); return isNaN(n) ? v : Math.round(n * 10) / 10; };

      const live = size => { const d = document.createElement('span'); d.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:' + size + 'px'; d.textContent = 'x'.repeat(50); document.body.appendChild(d); const w = d.getBoundingClientRect().width / 50; d.remove(); return w; };

      const article = q('.article') || q('.content');
      const artCS = cs(article);
      const artRect = rect(article);
      const paras = qa('.article p');
      const pWidths = paras.map(p => { const r = p.getBoundingClientRect(); return { w: Math.round(r.width), px: px(cs(p).fontSize), fs: cs(p).fontSize, lh: cs(p).lineHeight, mb: cs(p).marginBottom, mt: cs(p).marginTop }; });
      const pxPerEm = live(artCS ? px(artCS.fontSize) : 16);
      const chPerPx = (() => { const c = live(artCS ? px(artCS.fontSize) : 16); const z = (() => { const d = document.createElement('span'); d.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:' + (artCS ? px(artCS.fontSize) : 16) + 'px'; d.textContent = '0'.repeat(100); document.body.appendChild(d); const w = d.getBoundingClientRect().width / 100 / (artCS ? px(artCS.fontSize) : 16); d.remove(); return w; })(); return z; })();
      const pCh = pWidths.map(p => { const fs = parseFloat(p.fs); const perCh = chPerPx * fs; return Math.round(p.w / perCh * 10) / 10; });

      const h1 = q('.article h1') || q('.page-head h1');
      const h2s = qa('.article h2');
      const h3s = qa('.article h3');
      const foldY = window.innerHeight;
      const firstP = paras[0];
      const foldInfo = {
        h1: h1 ? { ...rect(h1), fs: px(cs(h1).fontSize), lh: px(cs(h1).lineHeight), mt: px(cs(h1).marginTop), mb: px(cs(h1).marginBottom), text: h1.textContent.trim().slice(0, 60) } : null,
        crumbs: (() => { const c = q('.crumbs'); return c ? { ...rect(c), fs: px(cs(c).fontSize), h: Math.round(c.getBoundingClientRect().height) } : null; })(),
        desc: (() => { const d = q('.page-desc'); return d ? { ...rect(d), fs: px(cs(d).fontSize) } : null; })(),
        meta: (() => { const m = q('.page-meta'); return m ? { ...rect(m), fs: px(cs(m).fontSize), h: Math.round(m.getBoundingClientRect().height), chips: qa('.page-meta .chip').map(c => c.textContent.trim()) } : null; })(),
        firstP: firstP ? { y: Math.round(rect(firstP).y), w: Math.round(firstP.getBoundingClientRect().width) } : null,
        parasAboveFold: paras.filter(p => rect(p).y + rect(p).h <= foldY).length,
        textCharsAboveFold: (() => { let n = 0; for (const p of paras) { const r = rect(p); if (r.y + r.h <= foldY) n += p.textContent.trim().length; } return n; })(),
        articleTop: artRect ? artRect.y : null,
        contentTop: rect(q('.content')) ? rect(q('.content')).y : null,
      };

      const sidebar = q('.sidebar');
      const sideLinks = qa('.sidebar a');
      const sideItems = sideLinks.map(a => { const r = a.getBoundingClientRect(); const s = cs(a); return { t: a.textContent.trim().slice(0, 42), x: Math.round(r.x), y: Math.round(r.y + window.scrollY), h: Math.round(r.height), fs: px(s.fontSize), pad: s.paddingLeft, color: s.color, bg: s.backgroundColor, fw: s.fontWeight, cls: a.className }; });
      const badges = qa('.sidebar .side-home, .sidebar .tag, .sidebar .grp-zh, .sidebar .side-count');
      const sideInfo = {
        rect: rect(sidebar),
        filter: (() => { const f = q('.side-filter'); return f ? { ...rect(f), ph: f.placeholder, fs: px(cs(f).fontSize) } : null; })(),
        legend: (() => { const l = q('.side-legend'); return l ? { ...rect(l), text: l.textContent.trim(), fs: px(cs(l).fontSize) } : null; })(),
        totalLinks: sideLinks.length,
        distinctX: Array.from(new Set(sideItems.map(i => i.x))).sort((a, b) => a - b),
        itemHeights: Array.from(new Set(sideItems.map(i => i.h))).sort((a, b) => a - b),
        badgeTexts: badges.map(b => b.textContent.trim()).reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {}),
        badgeColors: Array.from(new Set(badges.map(b => { const s = cs(b); return s.color + '|' + s.borderColor + '|' + s.backgroundColor + '|' + s.fontSize; }))).slice(0, 30),
        activeCount: qa('.sidebar a.active').length,
        activeStyle: (() => { const a = q('.sidebar a.active'); if (!a) return null; const s = cs(a); return { t: a.textContent.trim(), color: s.color, bg: s.backgroundColor, fw: s.fontWeight, borderLeft: s.borderLeft, outline: s.outline }; })(),
        colorKinds: (() => { const m = {}; for (const i of sideItems) { m[i.color] = (m[i.color] || 0) + 1; } return m; })(),
        minHeightVar: cs(sidebar) ? getComputedStyle(document.documentElement).getPropertyValue('--topbar-h') : null,
        scrollH: sidebar ? sidebar.scrollHeight : null,
        clientH: sidebar ? sidebar.clientHeight : null,
        isSticky: cs(sidebar) ? cs(sidebar).position : null,
      };

      const toc = q('.toc-side');
      const tocLinks = qa('.toc-side a');
      const tocInfo = toc ? {
        rect: rect(toc),
        position: cs(toc).position,
        top: cs(toc).top,
        maxH: cs(toc).maxHeight,
        overflowY: cs(toc).overflowY,
        fs: px(cs(toc).fontSize),
        title: (() => { const t = q('.toc-side .toc-title'); return t ? t.textContent.trim() : null; })(),
        count: (() => { const c = q('.toc-side .toc-count'); return c ? c.textContent.trim() : null; })(),
        items: tocLinks.map(a => { const r = a.getBoundingClientRect(); const s = cs(a); return { t: a.textContent.trim().slice(0, 40), y: Math.round(r.y + window.scrollY), h: Math.round(r.height), fs: px(s.fontSize), padL: s.paddingLeft, color: s.color, cls: a.className, lh: s.lineHeight }; }),
        activeCount: qa('.toc-side a.active').length,
        activeTexts: qa('.toc-side a.active').map(a => a.textContent.trim()),
        heights: Array.from(new Set(tocLinks.map(a => Math.round(a.getBoundingClientRect().height)))).sort((a, b) => a - b),
        gapAfter: (() => { const last = tocLinks[tocLinks.length - 1]; if (!last) return null; const lr = last.getBoundingClientRect(); return Math.round(window.innerWidth - lr.right); })(),
        rightSpace: (() => { const r = toc.getBoundingClientRect(); return Math.round(window.innerWidth - r.right); })(),
      } : null;

      const topbar = q('.topbar');
      const topbarInfo = topbar ? {
        rect: rect(topbar), h: Math.round(topbar.getBoundingClientRect().height), position: cs(topbar).position,
        children: Array.from(topbar.children).map(c => ({ tag: c.tagName, cls: c.className, text: c.textContent.trim().slice(0, 40), ...rect(c) })),
        buttons: qa('.topbar button, .topbar a.tbtn').map(b => ({ t: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), cls: b.className, ...rect(b), fs: px(cs(b).fontSize) })),
        switch: qa('.topbar .sec-switch a').map(a => ({ t: a.textContent.trim(), on: /on/.test(a.className), ...rect(a) })),
        externalLinks: qa('.topbar a.external, .topbar .page-source').map(a => ({ t: a.textContent.trim(), href: a.getAttribute('href'), ...rect(a) })),
        bodyExternalLinks: qa('.article a.external, .page-meta a.external').slice(0, 12).map(a => ({ t: a.textContent.trim().slice(0, 30), href: a.getAttribute('href'), ...rect(a) })),
        ctrlK: !!q('.topbar kbd'),
        brand: (() => { const b = q('.topbar .brand'); return b ? { ...rect(b), t: b.textContent.trim(), fs: px(cs(b).fontSize) } : null; })(),
      } : null;

      const bodySamples = qa('.article p, .article li, .article td, .article th, .hero p, .hero-tag, .page-desc').slice(0, 400);
      const fsHist = bodySamples.reduce((acc, el) => { const k = px(cs(el).fontSize); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

      const codeBlocks = qa('.code-block').map(cb => {
        const pre = cb.querySelector('pre');
        const scroller = cb.querySelector('.code-scroll') || pre;
        const title = cb.querySelector('.code-title');
        const lang = cb.querySelector('.code-lang');
        const copy = cb.querySelector('.code-copy');
        const content = pre ? pre.textContent : '';
        const lines = content.replace(/\n$/, '').split('\n');
        const s = pre ? cs(pre) : null;
        return {
          rect: rect(cb), scrollerRect: rect(scroller),
          scrollW: scroller ? Math.round(scroller.scrollWidth) : null,
          clientW: scroller ? Math.round(scroller.clientWidth) : null,
          overflowing: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : null,
          overflowX: scroller ? cs(scroller).overflowX : null,
          preFs: s ? px(s.fontSize) : null, preLh: s ? px(s.lineHeight) : null,
          hasTitleBar: !!title, hasLang: !!lang, langText: lang ? lang.textContent.trim() : null,
          hasCopy: !!copy, copyText: copy ? copy.textContent.trim() : null,
          lineCount: lines.length,
          maxLineChars: Math.max(0, ...lines.map(l => l.length)),
          maxLinePxApprox: Math.max(0, ...lines.map(l => Math.round(l.length * (s ? parseFloat(s.fontSize) * 0.6 : 9.6)))),
          tabindex: scroller ? scroller.getAttribute('tabindex') : null,
          preTabindex: pre ? pre.getAttribute('tabindex') : null,
          preRadius: s ? s.borderRadius : null, preBg: s ? s.backgroundColor : null,
          hasLineNumbers: !!cb.querySelector('.linenums, .line-numbers, [data-line]'),
          hasHighlight: !!cb.querySelector('.highlight, .hll, mark'),
          scrollbarH: scroller ? Math.round(scroller.offsetHeight - scroller.clientHeight) : null,
        };
      });

      const tables = qa('.table-wrap, table').map(t => {
        const isWrap = t.classList.contains('table-wrap');
        const tbl = isWrap ? t.querySelector('table') : t;
        if (!tbl) return null;
        const wrap = isWrap ? t : tbl.parentElement;
        const ths = Array.from(tbl.querySelectorAll('thead th'));
        const firstRowCells = Array.from(tbl.querySelectorAll('tbody tr:first-child td, tbody tr:first-child th'));
        return {
          rect: rect(wrap),
          tableRect: rect(tbl),
          rows: tbl.querySelectorAll('tbody tr').length,
          cols: ths.length || firstRowCells.length,
          headers: ths.map(th => th.textContent.trim().slice(0, 22)),
          colWidths: firstRowCells.map(c => Math.round(c.getBoundingClientRect().width)),
          wrapScrollW: wrap ? Math.round(wrap.scrollWidth) : null,
          wrapClientW: wrap ? Math.round(wrap.clientWidth) : null,
          overflowing: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : null,
          fs: px(cs(tbl).fontSize),
          thPosition: ths[0] ? cs(ths[0]).position : null,
          thTop: ths[0] ? cs(ths[0]).top : null,
          cellMaxChars: firstRowCells.length ? Math.max(...firstRowCells.map(c => c.textContent.trim().length)) : null,
        };
      }).filter(Boolean);

      const callouts = qa('.alert').map(a => {
        const s = cs(a);
        return { rect: rect(a), cls: a.className, bg: s.backgroundColor, borderLeft: s.borderLeft, borderLeftColor: s.borderLeftColor, titleColor: (() => { const t = a.querySelector('.alert-title'); return t ? cs(t).color : null; })(), titleFs: (() => { const t = a.querySelector('.alert-title'); return t ? px(cs(t).fontSize) : null; })(), borderColor: s.borderColor, shadow: s.boxShadow, radius: s.borderRadius, title: (() => { const t = a.querySelector('.alert-title'); return t ? t.textContent.trim() : null; })() };
      });
      const calloutKinds = qa('.alert').reduce((acc, a) => { const k = (a.className.match(/alert-(\w+)/) || [])[1] || '?'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});

      const images = qa('.article img, .content img').map(im => {
        const r = im.getBoundingClientRect();
        return { src: (im.getAttribute('src') || '').slice(-60), cls: im.className, rect: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }, naturalW: im.naturalWidth, naturalH: im.naturalHeight, alt: im.getAttribute('alt'), loading: im.getAttribute('loading'), decoding: im.getAttribute('decoding'), width: im.getAttribute('width'), height: im.getAttribute('height'), style: im.getAttribute('style'), hasCaption: !!(im.closest('figure') && im.closest('figure').querySelector('figcaption')), inFigure: !!im.closest('figure') };
      });

      const perf = { docHeight: document.documentElement.scrollHeight, scripts: qa('script[src]').map(s => s.getAttribute('src')), defer: qa('script[defer]').length, async: qa('script[async]').length, imgsTotal: qa('img').length, imgsLazy: qa('img[loading=lazy]').length, imgsWithDims: qa('img[width][height]').length };

      const allPages = q('.table-wrap table.allpages, table.allpages');
      const allPagesInfo = allPages ? {
        rows: allPages.querySelectorAll('tbody tr').length,
        headers: Array.from(allPages.querySelectorAll('thead th')).map(th => th.textContent.trim()),
        filter: (() => { const f = q('.filter-bar input'); return f ? { ph: f.placeholder, ...rect(f) } : null; })(),
        filterCount: (() => { const c = q('.filter-count'); return c ? c.textContent.trim() : null; })(),
        sortable: !!q('.allpages [aria-sort], .allpages th[data-sort]'),
        thPosition: (() => { const th = allPages.querySelector('thead th'); return th ? cs(th).position : null; })(),
        rowHeights: Array.from(allPages.querySelectorAll('tbody tr')).slice(0, 8).map(tr => Math.round(tr.getBoundingClientRect().height)),
        linkTexts: Array.from(allPages.querySelectorAll('tbody tr')).slice(0, 5).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim().slice(0, 26))),
      } : null;

      return {
        page: location.pathname, viewport: { w: window.innerWidth, h: window.innerHeight },
        fontSizes: { body: px(cs(document.body).fontSize), bodyLh: px(cs(document.body).lineHeight), article: artCS ? px(artCS.fontSize) : null, articleLh: artCS ? px(artCS.lineHeight) : null, hist: fsHist },
        article: artRect, contentRect: rect(q('.content')),
        paragraphWidths: pWidths, paragraphChWidths: pCh, chPerPx,
        fold: foldInfo,
        h2: h2s.slice(0, 6).map(h => ({ t: h.textContent.trim().slice(0, 30), ...rect(h), fs: px(cs(h).fontSize), mt: px(cs(h).marginTop), mb: px(cs(h).marginBottom), pb: px(cs(h).paddingBottom) })),
        h3: h3s.slice(0, 4).map(h => ({ t: h.textContent.trim().slice(0, 30), fs: px(cs(h).fontSize), mt: px(cs(h).marginTop) })),
        sidebar: sideInfo, toc: tocInfo, topbar: topbarInfo,
        code: { count: codeBlocks.length, blocks: codeBlocks.slice(0, 8) },
        tables: { count: tables.length, list: tables.slice(0, 8) },
        callouts: { count: callouts.length, kinds: calloutKinds, list: callouts.slice(0, 6) },
        images: { count: images.length, list: images.slice(0, 10), fillRatios: images.map(im => ({ w: im.rect.w, ratio: artRect ? Math.round(im.rect.w / artRect.w * 100) / 100 : null })) },
        perf, allPages: allPagesInfo,
        layoutRoot: (() => { const l = q('.layout'); if (!l) return null; return { cls: l.className, cols: cs(l).gridTemplateColumns, gap: cs(l).gap }; })(),
      };
    });
    results.push({ path: p, ...data });
  }
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, viewport: VW + 'x' + VH, pages: results }, null, 1), 'utf8');
  console.log('wrote', OUT, 'pages', results.length);
  await browser.close();
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
