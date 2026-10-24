/* critique-desktop-audit.js
 * Wide desktop audit: broken/oversized images, tables, callouts, code overflow,
 * TOC active-tracking, desktop whitespace, text-width/measure math.
 * Usage: node tools/critique-desktop-audit.js [--base=...] [--vp=1440x900]
 * Writes reports/_critique-desktop-audit.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const h = process.argv.find(a => a.startsWith('--' + n + '=')); return h ? h.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:8787');
const [VW, VH] = arg('vp', '1440x900').split('x').map(Number);
const OUT = path.join(ROOT, 'reports', '_critique-desktop-audit.json');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find(p => fs.existsSync(p));

const PAGES = ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  let page = await ctx.newPage();
  const out = [];

  const fresh = async (p) => {
    try { await page.close(); } catch (e) { }
    page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(BASE + p, { waitUntil: 'load' });
    return page;
  };

  for (const p of PAGES) {
    await fresh(p);
    await page.waitForTimeout(400);
    // force-load lazy images, then settle
    await page.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 600));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 300));
      await Promise.all(Array.from(document.images).map(im => im.complete ? 0 : new Promise(r => { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); setTimeout(r, 3000); })));
    });
    const data = await page.evaluate(() => {
      const qa = s => Array.from(document.querySelectorAll(s));
      const cs = el => getComputedStyle(el);
      const px = v => Math.round(parseFloat(v) * 10) / 10;
      const article = document.querySelector('.article') || document.querySelector('.content');
      const artW = article ? article.getBoundingClientRect().width : null;

      const imgs = qa('img').map(im => {
        const r = im.getBoundingClientRect();
        return { src: (im.currentSrc || im.src || '').split('/').slice(-1)[0], cls: im.className, w: Math.round(r.width), h: Math.round(r.height), naturalW: im.naturalWidth, naturalH: im.naturalHeight, broken: !(im.naturalWidth > 0), alt: im.getAttribute('alt'), loading: im.getAttribute('loading'), dims: !!(im.getAttribute('width') && im.getAttribute('height')), inArticle: !!im.closest('.article'), caption: !!(im.closest('figure') && im.closest('figure').querySelector('figcaption')), ariaHidden: im.getAttribute('aria-hidden'), role: im.getAttribute('role') };
      });

      const tables = qa('.article table, .table-wrap table').map(t => {
        const wrap = t.closest('.table-wrap') || t.parentElement;
        const ths = Array.from(t.querySelectorAll('thead th'));
        const cs0 = t.querySelector('tbody tr td, tbody tr th');
        const zt = Array.from(t.querySelectorAll('tbody tr:nth-child(-n+40) td')).map(td => { const r = td.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), chars: td.textContent.trim().length, fs: px(cs(td).fontSize), lh: px(cs(td).lineHeight) }; });
        return { hdr: ths.map(x => x.textContent.trim()), rows: t.querySelectorAll('tbody tr').length, wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : null, scrollW: wrap ? wrap.scrollWidth : null, clientW: wrap ? wrap.clientWidth : null, over: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : null, fs: px(cs(t).fontSize), thPos: ths[0] ? cs(ths[0]).position : null, thBg: ths[0] ? cs(ths[0]).backgroundColor : null, thNowrap: ths[0] ? cs(ths[0]).whiteSpace : null, cellH: zt.slice(0, 6).map(x => x.h), cellFs: zt[0] ? zt[0].fs : null, firstColW: zt[0] ? zt[0].w : null, firstCellChars: zt[0] ? zt[0].chars : null, avgChars: zt.length ? Math.round(zt.reduce((a, b) => a + b.chars, 0) / zt.length) : null, sticky: ths[0] ? (cs(ths[0]).position === 'sticky') : null };
      });

      const callouts = qa('.alert').map(a => {
        const t = a.querySelector('.alert-title');
        const ip = t ? getComputedStyle(t, '::before') : null;
        const p1 = a.querySelector('.alert-body p');
        return { kind: (a.className.match(/alert-(\w+)/) || [])[1] || '?', cls: a.className, bg: cs(a).backgroundColor, bl: cs(a).borderLeftWidth + ' ' + cs(a).borderLeftColor, radius: cs(a).borderRadius, iconBg: ip ? ip.backgroundColor : null, iconRadius: ip ? ip.borderRadius : null, titleColor: t ? cs(t).color : null, titleWeight: t ? cs(t).fontWeight : null, titleFs: t ? px(cs(t).fontSize) : null, bodyFirstP: p1 ? { fs: px(cs(p1).fontSize), color: cs(p1).color, w: Math.round(p1.getBoundingClientRect().width) } : null, padTop: px(cs(a).paddingTop), mrTop: px(cs(a).marginTop), mrBottom: px(cs(a).marginBottom) };
      });

      const code = qa('.code-block').map(cb => {
        const sc = cb.querySelector('.code-scroll') || cb.querySelector('pre');
        const pre = cb.querySelector('pre');
        const lines = (pre ? pre.textContent : '').replace(/\n$/, '').split('\n');
        const s = pre ? cs(pre) : null;
        const fs = s ? parseFloat(s.fontSize) : 16;
        const second = Array.from(document.querySelectorAll('.article p, .article li')).filter(e => /\S/.test(e.textContent));
        const sample = second.slice(0, 30).map(e => e.getBoundingClientRect().width);
        return { rect: (() => { const r = cb.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; })(), scrollW: sc ? sc.scrollWidth : null, clientW: sc ? sc.clientWidth : null, overBy: sc ? Math.max(0, sc.scrollWidth - sc.clientWidth) : null, lines: lines.length, maxChars: Math.max(0, ...lines.map(l => l.length)), preFs: fs, preLh: s ? px(s.lineHeight) : null, lang: (() => { const l = cb.querySelector('.code-lang'); return l ? l.textContent.trim() : null; })(), copy: !!cb.querySelector('.code-copy'), copyH: (() => { const c = cb.querySelector('.code-copy'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), fs: px(cs(c).fontSize) }; })(), titleH: (() => { const t = cb.querySelector('.code-title'); return t ? Math.round(t.getBoundingClientRect().height) : null; })(), tab: sc ? sc.getAttribute('tabindex') : null, ariaLabel: sc ? sc.getAttribute('aria-label') : null, bg: s ? s.backgroundColor : null, wrapBg: (() => { const b = cb.querySelector('.code-block'); return b ? cs(b).backgroundColor : null; })(), linenums: !!cb.querySelector('ol.linenums, .linenums, [data-line-number]'), highlightRanges: !!cb.querySelector('mark, .hll, .highlight-line'), margins: { mt: px(cs(cb).marginTop), mb: px(cs(cb).marginBottom) } };
      });

      const measure = (() => {
        const probe = fs => { const d = document.createElement('span'); d.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;font-size:' + fs + 'px'; d.textContent = '0'.repeat(200); const host = article || document.body; host.appendChild(d); const w = d.getBoundingClientRect().width / 200; d.remove(); return w; };
        const fs = article ? parseFloat(cs(article).fontSize) : 16;
        const perChar = probe(fs);
        const ps = Array.from(document.querySelectorAll('.article p')).filter(p => p.textContent.trim().length > 40).map(p => p.getBoundingClientRect().width);
        const w = ps.length ? Math.max(...ps) : null;
        return { articleFs: fs, perCharPxZero: Math.round(perChar * 1000) / 1000, maxPW: w, asciiCh: w ? Math.round(w / perChar) : null, chMeasured112: w ? Math.round(w / (fs * 0.5)) : null };
      })();

      const toc = document.querySelector('.toc-side');
      const tocInfo = toc ? { position: cs(toc).position, sticky: cs(toc).position === 'sticky', itemFs: Array.from(new Set(qa('.toc-side a').map(a => px(cs(a).fontSize)))), indents: Array.from(new Set(qa('.toc-side a').map(a => cs(a).paddingLeft))), active: qa('.toc-side a.active').length, levelClasses: Array.from(new Set(qa('.toc-side a').map(a => (a.className.match(/lvl-\d/) || [''])[0]))), count: qa('.toc-side a').length, rightGap: Math.round(window.innerWidth - toc.getBoundingClientRect().right) } : null;

      const whitespace = (() => {
        const tocEl = document.querySelector('.toc-side');
        const content = document.querySelector('.content');
        if (!tocEl || !content) return null;
        const c = content.getBoundingClientRect();
        const t = tocEl.getBoundingClientRect();
        const art = article.getBoundingClientRect();
        return { contentRight: Math.round(c.right), articleRight: Math.round(art.right), tocLeft: Math.round(t.left), gapArticleToToc: Math.round(t.left - art.right), contentPadRight: px(cs(content).paddingRight), contentMaxW: cs(content).maxWidth, cols: cs(document.querySelector('.layout')).gridTemplateColumns };
      })();

      return { path: location.pathname, docH: document.documentElement.scrollHeight, viewport: { w: innerWidth, h: innerHeight }, imgs, imgCount: imgs.length, brokenCount: imgs.filter(i => i.broken).length, inArticleBroken: imgs.filter(i => i.broken && i.inArticle).length, tables, callouts, code, measure, toc: tocInfo, whitespace, scrollW: document.documentElement.scrollWidth };
    });
    out.push(data);
  }

  // TOC active-link tracking across scroll
  await fresh('/paper/dev/dialogs/');
  const track = [];
  for (const f of [0, 0.15, 0.35, 0.6, 0.85]) {
    await page.evaluate(y => window.scrollTo(0, y), Math.round((await page.evaluate(() => document.documentElement.scrollHeight)) * f));
    await page.waitForTimeout(700);
    track.push(await page.evaluate(() => ({ scrollY: Math.round(window.scrollY), active: Array.from(document.querySelectorAll('.toc-side a.active')).map(a => a.textContent.trim()), tocTop: Math.round(document.querySelector('.toc-side').getBoundingClientRect().top) })));
  }

  // header stickiness of the big index table
  await fresh('/all-pages.html');
  const allpages = await page.evaluate(async () => {
    const t = document.querySelector('table.allpages');
    const th = t.querySelector('thead th');
    const before = th.getBoundingClientRect().top;
    window.scrollTo(0, 3000);
    await new Promise(r => setTimeout(r, 400));
    const after = th.getBoundingClientRect().top;
    const tb = t.querySelector('tbody tr');
    return { thPos: getComputedStyle(th).position, thTopZoomed: Math.round(after), thTopInitial: Math.round(before), rowH: Math.round(tb.getBoundingClientRect().height), filter: (() => { const f = document.querySelector('.filter-bar input'); return f ? f.placeholder : null; })(), filterCount: (() => { const c = document.querySelector('.filter-count'); return c ? c.textContent.trim() : null; })() };
  });
  const filterTest = await page.evaluate(async () => {
    const f = document.querySelector('.filter-bar input');
    if (!f) return null;
    f.value = 'velocity';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    const c = document.querySelector('.filter-count');
    const rows = document.querySelectorAll('table.allpages tbody tr');
    const visible = Array.from(rows).filter(r => r.offsetParent !== null).length;
    return { after: c ? c.textContent.trim() : null, domRowsVisible: visible, domRows: rows.length };
  });

  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, viewport: VW + 'x' + VH, pages: out, tocTrack: track, allpages, filterTest }, null, 1), 'utf8');
  console.log('wrote', OUT);
  await browser.close();
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
