'use strict';
/**
 * b1g-diff.js - geometry A/B probe for batch-1 ("shell only" claim).
 *
 * Measures the reading column on the AFTER build (127.0.0.1:8787) and the
 * BEFORE worktree (127.0.0.1:8788, ..\_pre-mobile @ a19a6c2) over
 * 6 pages x 7 viewports, then emits a field-by-field diff table.
 *
 * Usage:
 *   node tools/b1g-diff.js                # light, all pages/viewports
 *   node tools/b1g-diff.js --dark         # repeat the key subset in dark
 *   node tools/b1g-diff.js --out=reports/b1-shots/_diff.json
 *   node tools/b1g-diff.js --vp=1440 --page=/paper/dev/dialogs/
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (n, d) => { const p = '--' + n + '='; const h = argv.find((a) => a.startsWith(p)); return h ? h.slice(p.length) : d; };
const DARK = argv.includes('--dark');
const OUT = opt('out', path.join('reports', 'b1-shots', DARK ? '_diff-dark.json' : '_diff.json'));
const ONLY_VP = opt('vp', null);
const ONLY_PAGE = opt('page', null);

const AFTER = 'http://127.0.0.1:8787';
const BEFORE = 'http://127.0.0.1:8788';

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '1280', width: 1280, height: 800, mobile: false },
  { name: '1025', width: 1025, height: 800, mobile: false },
  { name: '1024', width: 1024, height: 800, mobile: false },
  { name: '768', width: 768, height: 1024, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '320', width: 320, height: 568, mobile: true },
];

const PAGES = [
  { url: '/', name: 'landing' },
  { url: '/paper/', name: 'section-paper' },
  { url: '/paper/dev/dialogs/', name: 'content-callout-code' },
  { url: '/paper/reference/world-configuration/', name: 'reference-longpage' },
  { url: '/velocity/tuning/', name: 'content-tuning' },
  { url: '/all-pages.html', name: 'index-allpages' },
];

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

/** Runs in the page. Must stay self-contained (no outer refs). */
const MEASURE = () => {
  const q = (s, r) => (r || document).querySelector(s);
  const r2 = (n) => Math.round(n * 100) / 100;
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const num = (el, p) => (el ? r2(parseFloat(getComputedStyle(el)[p])) : null);
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height) };
  };

  const article = q('article.article') || q('article') || q('main');
  const content = q('.content');
  const toc = q('.toc-side');
  const side = q('.sidebar');

  const isProse = (el) => {
    if (!el) return false;
    if (el.closest('.page-meta, .page-desc, .hero-tag, .page-head, .cover, .card, .stat, .sr-item, .crumbs')) return false;
    return (el.textContent || '').trim().length >= 40;
  };
  const pros = article ? [...article.querySelectorAll('p')].filter(isProse) : [];
  const prose = pros[0] || null;

  /** real line boxes + true advance of the widest line */
  const measureOf = (el) => {
    if (!el) return null;
    const st = getComputedStyle(el);
    const fsPx = parseFloat(st.fontSize);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
    if (!rects.length) return null;
    const lineW = Math.max(...rects.map((x) => x.width));
    const b = el.getBoundingClientRect();
    const capW = Math.max(b.width - (parseFloat(st.paddingLeft) || 0) - (parseFloat(st.paddingRight) || 0), lineW);
    // distinct line tops of the widest paragraph -> real line advance
    const tops = [...new Set(rects.map((x) => Math.round(x.top)))].sort((a, c) => a - c);
    const deltas = [];
    for (let i = 1; i < tops.length; i++) deltas.push(tops[i] - tops[i - 1]);
    const cvs = document.createElement('canvas').getContext('2d');
    cvs.font = st.fontSize + ' ' + st.fontFamily;
    const zeroW = cvs.measureText('0').width;
    return {
      lineW: r2(lineW), capW: r2(capW), zeroW: r2(zeroW),
      fontSize: r2(fsPx), lineHeight: r2(parseFloat(st.lineHeight)),
      lines: rects.length,
      advance: deltas.length ? deltas.sort((a, c) => a - c)[Math.floor(deltas.length / 2)] : null,
      ch: zeroW > 0 ? Math.round(capW / zeroW) : null,
    };
  };

  const h1 = article ? q('h1', article) : null;
  const h2 = article ? q('h2', article) : null;
  const h3 = article ? q('h3', article) : null;

  // code block: outer scroll container + inner pre + inner code
  const pre = q('pre.code-pre') || q('pre');
  const code = pre ? q('code', pre) || pre : null;
  const codePreInner = pre ? pre : null;
  const codeMeasure = (() => {
    if (!pre) return null;
    const st = getComputedStyle(pre);
    const stCode = code ? getComputedStyle(code) : null;
    const fsPre = parseFloat(st.fontSize);
    const lhPre = parseFloat(st.lineHeight);
    // real advance of code lines (Range over the <code> text)
    let advance = null, nLines = null;
    if (code) {
      const rg = document.createRange();
      rg.selectNodeContents(code);
      const rs = [...rg.getClientRects()].filter((x) => x.width > 1 && x.height > 1);
      const tops = [...new Set(rs.map((x) => Math.round(x.top)))].sort((a, c) => a - c);
      const d = [];
      for (let i = 1; i < tops.length; i++) d.push(tops[i] - tops[i - 1]);
      if (d.length) { d.sort((a, c) => a - c); advance = d[Math.floor(d.length / 2)]; }
      nLines = tops.length;
    }
    return {
      preFontSize: r2(fsPre),
      preLineHeight: r2(lhPre),
      codeFontSize: stCode ? r2(parseFloat(stCode.fontSize)) : null,
      codeLineHeight: stCode ? r2(parseFloat(stCode.lineHeight)) : null,
      advance,
      advanceRatio: advance && stCode ? r2(advance / parseFloat(stCode.fontSize)) : null,
      strutRatio: lhPre && stCode ? r2(lhPre / parseFloat(stCode.fontSize)) : null,
      nLines,
      scrollW: pre.scrollWidth, clientW: pre.clientWidth,
      width: r2(pre.getBoundingClientRect().width),
      fontFamily: st.fontFamily.split(',')[0],
      pad: st.padding,
    };
  })();

  const table = article ? q('table', article) || q('table') : null;
  const img = article ? q('img', article) || q('img') : null;

  return {
    url: location.pathname,
    title: document.title,
    theme: document.documentElement.getAttribute('data-theme'),
    pageHeight: Math.round(document.documentElement.scrollHeight),
    scrollW: Math.round(document.documentElement.scrollWidth),
    article: rect(article),
    content: content ? Object.assign(rect(content), {
      padL: num(content, 'paddingLeft'), padR: num(content, 'paddingRight'),
      maxWidth: cs(content, 'maxWidth'),
    }) : null,
    sidebar: side ? Object.assign(rect(side), { display: cs(side, 'display') }) : null,
    toc: toc ? Object.assign(rect(toc), {
      display: cs(toc, 'display'), position: cs(toc, 'position'),
      tag: toc.tagName.toLowerCase(), open: toc.hasAttribute('open'), id: toc.id || null,
    }) : null,
    typography: {
      bodyFontSize: prose ? num(prose, 'fontSize') : null,
      bodyLineHeight: prose ? num(prose, 'lineHeight') : null,
      bodyColor: prose ? cs(prose, 'color') : null,
      bodyFamily: prose ? cs(prose, 'fontFamily').split(',')[0] : null,
      highlightColor: article ? (q('strong', article) ? cs(q('strong', article), 'color') : null) : null,
    },
    measure: measureOf(prose),
    heads: {
      h1: h1 ? { size: num(h1, 'fontSize'), lh: num(h1, 'lineHeight'), mt: num(h1, 'marginTop'), mb: num(h1, 'marginBottom'), y: r2(h1.getBoundingClientRect().y) } : null,
      h2: h2 ? { size: num(h2, 'fontSize'), lh: num(h2, 'lineHeight'), mt: num(h2, 'marginTop'), mb: num(h2, 'marginBottom'), y: r2(h2.getBoundingClientRect().y) } : null,
      h3: h3 ? { size: num(h3, 'fontSize'), lh: num(h3, 'lineHeight'), mt: num(h3, 'marginTop'), mb: num(h3, 'marginBottom') } : null,
    },
    code: codeMeasure,
    table: table ? { w: r2(table.getBoundingClientRect().width), clientW: table.clientWidth, offsetW: table.offsetWidth, layout: cs(table, 'tableLayout') } : null,
    img: img ? {
      dw: r2(img.getBoundingClientRect().width), dh: r2(img.getBoundingClientRect().height),
      nw: img.naturalWidth, nh: img.naturalHeight,
      src: (img.getAttribute('src') || '').split('/').pop(),
    } : null,
    counts: {
      pros: pros.length,
      pre: document.querySelectorAll('pre').length,
      table: document.querySelectorAll('table').length,
      img: document.querySelectorAll('img').length,
      tocLinks: toc ? toc.querySelectorAll('a').length : 0,
    },
  };
};

/** flatten to comparable dotted fields */
function flatten(m) {
  const f = {};
  const put = (k, v) => { f[k] = v === undefined ? null : v; };
  put('pageHeight', m.pageHeight);
  put('docScrollW', m.scrollW);
  put('article.x', m.article && m.article.x);
  put('article.w', m.article && m.article.w);
  put('article.y', m.article && m.article.y);
  put('article.h', m.article && m.article.h);
  put('content.padL', m.content && m.content.padL);
  put('content.padR', m.content && m.content.padR);
  put('content.maxW', m.content && m.content.maxWidth);
  put('toc.display', m.toc && m.toc.display);
  put('toc.h', m.toc && m.toc.h);
  put('toc.open', m.toc && m.toc.open);
  put('m.lineW', m.measure && m.measure.lineW);
  put('m.capW', m.measure && m.measure.capW);
  put('m.zeroW', m.measure && m.measure.zeroW);
  put('m.fontSize', m.measure && m.measure.fontSize);
  put('m.lineHeight', m.measure && m.measure.lineHeight);
  put('m.advance', m.measure && m.measure.advance);
  put('m.sh', m.measure && m.measure.ch);
  put('body.fontSize', m.typography.bodyFontSize);
  put('body.lineHeight', m.typography.bodyLineHeight);
  put('body.color', m.typography.bodyColor);
  put('body.family', m.typography.bodyFamily);
  for (const h of ['h1', 'h2']) {
    put(h + '.size', m.heads[h] && m.heads[h].size);
    put(h + '.mt', m.heads[h] && m.heads[h].mt);
    put(h + '.mb', m.heads[h] && m.heads[h].mb);
  }
  put('code.preFontSize', m.code && m.code.preFontSize);
  put('code.preLineHeight', m.code && m.code.preLineHeight);
  put('code.fontSize', m.code && m.code.codeFontSize);
  put('code.lineHeight', m.code && m.code.codeLineHeight);
  put('code.advance', m.code && m.code.advance);
  put('code.advanceRatio', m.code && m.code.advanceRatio);
  put('code.scrollW', m.code && m.code.scrollW);
  put('code.clientW', m.code && m.code.clientW);
  put('table.w', m.table && m.table.w);
  put('table.clientW', m.table && m.table.clientW);
  put('img.w', m.img && m.img.dw);
  put('img.h', m.img && m.img.dh);
  put('img.nw', m.img && m.img.nw);
  return f;
}

const NUMERIC = (v) => typeof v === 'number' && isFinite(v);

(async () => {
  if (!EXE) { console.error('no chrome binary found'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const out = { generated_at: new Date().toISOString(), dark: DARK, after: AFTER, before: BEFORE, rows: [], raw: {} };
  const vps = VIEWPORTS.filter((v) => !ONLY_VP || v.name === ONLY_VP);
  const pgs = PAGES.filter((p) => !ONLY_PAGE || p.url === ONLY_PAGE);

  for (const vp of vps) {
    for (const pg of pgs) {
      const key = vp.name + '|' + pg.url;
      out.raw[key] = {};
      const rec = {};
      for (const [side, base] of [['after', AFTER], ['before', BEFORE]]) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
          isMobile: vp.mobile, hasTouch: vp.mobile,
          colorScheme: DARK ? 'dark' : 'light',
        });
        const page = await ctx.newPage();
        try {
          await page.goto(base + pg.url, { waitUntil: 'load', timeout: 45000 });
          await page.waitForTimeout(450);
          const m = await page.evaluate(MEASURE);
          rec[side] = m;
          out.raw[key][side] = flatten(m);
        } catch (e) {
          rec[side] = { error: e.message.slice(0, 120) };
          out.raw[key][side] = { error: e.message.slice(0, 120) };
        }
        await ctx.close();
      }
      const a = flatten(rec.after || {});
      const b = flatten(rec.before || {});
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])];
      let changed = 0;
      for (const f of fields) {
        const av = a[f], bv = b[f];
        let delta = null;
        let same;
        if (NUMERIC(av) && NUMERIC(bv)) { delta = Math.round((av - bv) * 100) / 100; same = Math.abs(delta) < 0.011; }
        else same = String(av) === String(bv);
        if (!same) changed++;
        out.rows.push({ vp: vp.name, page: pg.url, pageName: pg.name, field: f, before: bv, after: av, delta, same });
      }
      console.log('  ' + vp.name.padEnd(5) + pg.url.padEnd(40) + 'changed=' + String(changed).padEnd(3) +
        ' art=' + JSON.stringify([b['article.x'], b['article.w']]) + '->' + JSON.stringify([a['article.x'], a['article.w']]) +
        ' H=' + b.pageHeight + '->' + a.pageHeight);
    }
  }
  await browser.close();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

  // console summary: which fields ever changed
  const byField = {};
  for (const r of out.rows) {
    if (!byField[r.field]) byField[r.field] = { n: 0, changed: [], maxAbsDelta: 0 };
    if (!r.same) {
      byField[r.field].n++;
      byField[r.field].changed.push(r.vp + ' ' + r.pageName + ' ' + r.before + '->' + r.after);
      if (r.delta !== null) byField[r.field].maxAbsDelta = Math.max(byField[r.field].maxAbsDelta, Math.abs(r.delta));
    }
  }
  console.log('\n=== fields that changed anywhere ===');
  for (const [f, v] of Object.entries(byField)) {
    if (!v.n) continue;
    console.log(f.padEnd(20) + ' n=' + String(v.n).padEnd(4) + ' maxDelta=' + v.maxAbsDelta + '  eg: ' + v.changed[0]);
  }
  console.log('\nwrote ' + OUT + ' (' + out.rows.length + ' field rows)');
})();
