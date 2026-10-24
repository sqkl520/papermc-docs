'use strict';
/**
 * critique-typo-b.js -- measure experiment.
 *
 * 1. Empirical chars-per-line for real article paragraphs (per-character Range rects,
 *    grouped by line y) -- no ch arithmetic, no font-metric guessing.
 * 2. Injects candidate max-width values on the reading column and re-measures, so the
 *    recommendation is evidence-based per viewport / per page (with and without TOC).
 * 3. Detects mid-word breaks (Latin runs split across lines without a hyphen) -- the
 *    overflow-wrap:anywhere evidence.
 * 4. Records the y of H1 plus everything rendered above it (first-screen guidance).
 *
 * Usage: node tools/critique-typo-b.js --out="..\_typo-critique\b-measure.json"
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };

const BASE = opt('url', 'http://127.0.0.1:8787');
const OUT = path.resolve(__dirname, '..', opt('out', path.join('..', '_typo-critique', 'b-measure.json')));

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1025x900', width: 1025, height: 900 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
];
const PAGES = [
  { url: '/', name: 'landing' },
  { url: '/paper/dev/dialogs/', name: 'content-dialogs' },
  { url: '/paper/reference/world-configuration/', name: 'reference-longpage' },
  { url: '/velocity/tuning/', name: 'content-tuning' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/all-pages.html', name: 'index-allpages' },
];
const CANDS = [560, 592, 624, 656, 672, 688, 704, 720, 736, 752, 768, 800, 848, 948, 1000];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/* ------------------------------------------------------------------ */
const IN_PAGE = (cands) => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const article = q('.article');
  if (!article) return null;

  /* per-character geometry of one element, grouped into rendered lines */
  const lineMap = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const chars = [];
    let n;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      for (let i = 0; i < v.length; i++) chars.push({ node: n, i: i, ch: v[i] });
    }
    const rng = document.createRange();
    /* per-char geometry; inline <code> sits ~1-2px higher than body text, so bucket by
       rounded top with a tolerance band instead of exact equality */
    const geo = [];
    for (let k = 0; k < chars.length; k++) {
      const c = chars[k];
      rng.setStart(c.node, c.i);
      rng.setEnd(c.node, c.i + 1);
      const rr = rng.getBoundingClientRect();
      geo.push({ k: k, ch: c.ch, top: rr.top, bottom: rr.bottom, x0: rr.left, x1: rr.right, w: rr.width });
    }
    const lines = [];
    for (const g of geo) {
      let target = null;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
        const L = lines[i];
        /* same visual line if vertical bands overlap by more than half the body height */
        const ov = Math.min(L.bottom, g.bottom) - Math.max(L.top, g.top);
        if (ov > Math.min(L.bottom - L.top, g.bottom - g.top) * 0.5) { target = L; break; }
      }
      if (!target) { target = { top: g.top, bottom: g.bottom, n: 0, startK: g.k, endK: g.k, x0: g.x0, x1: g.x1 }; lines.push(target); }
      target.top = Math.min(target.top, g.top);
      target.bottom = Math.max(target.bottom, g.bottom);
      target.endK = g.k;
      target.x0 = Math.min(target.x0, g.x0);
      target.x1 = Math.max(target.x1, g.x1);
      if (!/\s/.test(g.ch) && g.w > 0) target.n++;
    }
    lines.sort((a, b) => a.top - b.top);
    const raw = chars.map((c) => c.ch).join('');
    /* mid-word breaks: the run of characters between the two lines must contain NO
       whitespace -- otherwise it is an ordinary wrap at a space */
    const splits = [];
    for (let k = 0; k + 1 < lines.length; k++) {
      const a = lines[k], b = lines[k + 1];
      if (a.n < 4 || b.n < 4) continue;
      const between = raw.slice(a.endK, b.startK + 1);
      if (/\s/.test(between)) continue;
      let s = a.endK;
      while (s > 0 && /\s/.test(raw[s])) s--;
      let e = b.startK;
      while (e < raw.length && /\s/.test(raw[e])) e++;
      const endCh = raw[s], startCh = raw[e];
      if (/[A-Za-z]/.test(endCh) && /[A-Za-z]/.test(startCh)) {
        let ws = s, we = e;
        while (ws > 0 && /[A-Za-z]/.test(raw[ws - 1])) ws--;
        while (we < raw.length && /[A-Za-z]/.test(raw[we])) we++;
        splits.push({ word: raw.slice(ws, we), left: raw.slice(ws, s + 1), right: raw.slice(e, we), lineNo: k + 1, atPx: R2(a.x1) });
      }
    }
    return {
      lines: lines.map((l) => ({ n: l.n, x0: R2(l.x0), x1: R2(l.x1), w: R2(l.x1 - l.x0) })),
      splits: splits,
    };
  };

  const stats = (el) => {
    const lm = lineMap(el);
    const full = lm.lines.slice(0, -1).filter((l) => l.n > 3);
    const arr = full.map((l) => l.n).sort((a, b) => a - b);
    const med = arr.length ? arr[Math.floor(arr.length / 2)] : null;
    const mean = arr.length ? R2(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
    return {
      totalLines: lm.lines.length, fullLines: full.length,
      medianChars: med, meanChars: mean,
      minChars: arr.length ? arr[0] : null, maxChars: arr.length ? arr[arr.length - 1] : null,
      lineWidthPx: full.length ? R2(full.reduce((s, l) => s + l.w, 0) / full.length) : null,
      splits: lm.splits,
    };
  };

  const pickParas = () => {
    const ps = qa('p', article).filter((p) => (p.innerText || '').replace(/\s+/g, '').length > 220 && !p.className);
    return ps.slice(0, 3);
  };

  const measurePage = () => {
    const ps = pickParas();
    const target = ps[0];
    const res = { paras: ps.length, samples: ps.map((p) => ({ chars: (p.innerText || '').replace(/\s+/g, '').length, w: R2(p.getBoundingClientRect().width), s: stats(p) })) };
    res.primary = target ? { w: R2(target.getBoundingClientRect().width), s: stats(target) } : null;
    return res;
  };

  /* everything above and including H1 */
  const firstScreen = () => {
    const h1 = q('h1', article);
    const r = h1 ? h1.getBoundingClientRect() : null;
    const kids = Array.prototype.slice.call(article.children);
    const idx = kids.indexOf(h1);
    return {
      h1Y: r ? R2(r.y + window.scrollY) : null,
      h1H: r ? R2(r.height) : null,
      h1AbsY: r ? R2(r.y) : null,
      before: idx >= 0 ? kids.slice(0, idx + 1).map((k) => ({ tag: k.tagName.toLowerCase(), cls: typeof k.className === 'string' ? k.className : '', text: (k.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70), h: R2(k.getBoundingClientRect().height), y: R2(k.getBoundingClientRect().y + window.scrollY) })) : [],
      crumbs: (function () { const c = q('.crumbs'); return c ? { text: (c.innerText || '').replace(/\s+/g, ' ').trim(), h: R2(c.getBoundingClientRect().height), y: R2(c.getBoundingClientRect().y + window.scrollY) } : null; })(),
      heroTag: (function () { const c = q('.hero-tag'); return c ? { h: R2(c.getBoundingClientRect().height), y: R2(c.getBoundingClientRect().y + window.scrollY) } : null; })(),
    };
  };

  /* whole-article split scan (catches chips/sidebar too) */
  const splitScan = () => {
    const scope = q('.content') || document.body;
    const lm = lineMap(q('.article'));
    return { articleSplits: lm.splits.slice(0, 12), articleSplitCount: lm.splits.length };
  };

  /* experiment: constrain reading column to candidate widths and re-measure */
  const experiment = (cands) => {
    const ps = pickParas();
    if (!ps.length) return null;
    const target = ps[0];
    const before = stats(target);
    const wBefore = R2(target.getBoundingClientRect().width);
    const style = document.createElement('style');
    style.id = '__typo_probe';
    style.textContent = '.article>*{max-width:0px}';
    document.head.appendChild(style);
    const rows = [];
    for (const c of cands) {
      style.textContent = '.article>*{max-width:' + c + 'px}';
      /* force layout */
      void target.offsetWidth;
      const s = stats(target);
      const w = R2(target.getBoundingClientRect().width);
      rows.push({ maxWidth: c, w: w, medianChars: s.medianChars, meanChars: s.meanChars, fullLines: s.fullLines, lineWidthPx: s.lineWidthPx, splits: s.splits.length });
    }
    /* also try ch-based caps */
    const chRows = [];
    for (const chv of [60, 65, 70, 75, 78, 80]) {
      style.textContent = '.article>*{max-width:' + chv + 'ch}';
      void target.offsetWidth;
      const s = stats(target);
      chRows.push({ ch: chv, w: R2(target.getBoundingClientRect().width), medianChars: s.medianChars, meanChars: s.meanChars });
    }
    style.remove();
    void target.offsetWidth;
    return { wBefore: wBefore, before: before, rows: rows, chRows: chRows };
  };

  /* geometry of the reading column */
  const contentEl = q('.content');
  const layoutEl = q('.layout');
  const tocEl = q('.toc-side');
  const csC = contentEl ? getComputedStyle(contentEl) : null;

  return {
    url: location.pathname,
    docHeight: Math.round(document.documentElement.scrollHeight),
    articleChars: (article.innerText || '').replace(/\s+/g, '').length,
    hasTocClass: !!(layoutEl && layoutEl.classList.contains('has-toc')),
    tocVisible: !!(tocEl && tocEl.offsetParent !== null && getComputedStyle(tocEl).display !== 'none'),
    tocItems: qa('.toc-side a').length,
    content: contentEl ? {
      w: R2(contentEl.getBoundingClientRect().width), maxWidth: csC.maxWidth,
      padL: R2(parseFloat(csC.paddingLeft)), padR: R2(parseFloat(csC.paddingRight)),
      innerW: R2(contentEl.getBoundingClientRect().width - parseFloat(csC.paddingLeft) - parseFloat(csC.paddingRight)),
    } : null,
    articleW: R2(article.getBoundingClientRect().width),
    pageInnerW: document.documentElement.clientWidth,
    measure: measurePage(),
    firstScreen: firstScreen(),
    splitScan: splitScan(),
    experiment: experiment(cands),
  };
};

/* ------------------------------------------------------------------ */
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const results = [];
  for (const vp of VIEWPORTS) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const pg of PAGES) {
      try {
        await page.goto(BASE + pg.url, { waitUntil: 'load', timeout: 30000 });
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
        await page.waitForTimeout(100);
        const d = await page.evaluate(IN_PAGE, CANDS);
        results.push({ viewport: vp.name, vpW: vp.width, page: pg.url, name: pg.name, m: d });
        process.stderr.write('ok ' + vp.name + ' ' + pg.url + ' med=' + (d && d.measure && d.measure.primary ? d.measure.primary.s.medianChars : '-') + '\n');
      } catch (e) {
        results.push({ viewport: vp.name, page: pg.url, name: pg.name, error: String(e).slice(0, 240) });
        process.stderr.write('ERR ' + vp.name + ' ' + pg.url + ' ' + e + '\n');
      }
    }
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), base: BASE, results: results }, null, 1), 'utf8');
  process.stderr.write('wrote ' + OUT + ' (' + results.length + ')\n');
})();
