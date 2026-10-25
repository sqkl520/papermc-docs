'use strict';
/**
 * fa-c5.js — final acceptance, group G: C5 four items with a *correct* word-break metric.
 *
 * The plan's "320px 词中断 19 -> <=5" counts **broken ASCII tokens** (a long token with no
 * spaces that had to be split across lines), not "td whose line count exceeds word count"
 * — the latter counts CJK paragraphs, which legitimately wrap without any word breaking.
 *
 * Metric: for each .table-wrap td, take every ASCII run of length >= 10
 * (/[A-Za-z0-9_().<>?,:;=+\-\/\[\]#]{10,}/), wrap it in a Range and count distinct line
 * tops. lines > 1  =>  that token was broken mid-word. Sum over the page.
 *
 * Arms: `with` (HEAD as shipped) vs `without` (.table-wrap td{overflow-wrap:normal!important})
 * so the 19 -> N delta is attributable, not just asserted.
 *
 * Usage: node tools/fa-c5.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const OUT = path.join(os.tmpdir(), 'fa');
fs.mkdirSync(OUT, { recursive: true });
const HEAD = 'http://127.0.0.1:8796';
const B0 = 'http://127.0.0.1:8791';

const MEASURE = () => {
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = document.querySelector('article.article') || document.querySelector('article');

  /* ---- broken ASCII tokens inside table cells ---- */
  const TOKEN = /[A-Za-z0-9_().<>?,:;=+\-\/\[\]#]{10,}/g;
  const brokenTokens = [];
  const tds = [...document.querySelectorAll('.table-wrap td')];
  for (const td of tds) {
    const text = td.textContent || '';
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text)) !== null) {
      const tok = m[0];
      /* locate the token inside the td with a Range over the matching text node(s) */
      const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
      let node;
      let found = null;
      while ((node = walker.nextNode())) {
        const idx = (node.nodeValue || '').indexOf(tok);
        if (idx >= 0) { found = { node, idx }; break; }
      }
      if (!found) continue;
      const rg = document.createRange();
      rg.setStart(found.node, found.idx);
      rg.setEnd(found.node, found.idx + tok.length);
      const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      const lines = new Set(rects.map((r) => Math.round(r.top))).size;
      if (lines > 1) {
        const tdW = Math.round(td.getBoundingClientRect().width);
        brokenTokens.push({ tok: tok.slice(0, 34), lines, tdW });
      }
    }
  }
  /* de-dup identical (tok,tdW) pairs counted once per cell */
  const uniq = new Map();
  for (const b of brokenTokens) uniq.set(b.tok + '@' + b.tdW, b);

  const h5s = art ? [...art.querySelectorAll('h5')] : [];
  const fb = document.querySelector('.filter-bar');
  const grp = [...document.querySelectorAll('.side-group-title')].map((g) => {
    const name = g.querySelector('.grp-name');
    const zh = g.querySelector('.grp-zh');
    const ell = (el) => (el ? el.scrollWidth > el.clientWidth + 1 : false);
    return {
      name: name ? (name.textContent || '').trim().slice(0, 22) : null,
      nameEll: ell(name), zhEll: ell(zh),
      nameW: name ? Math.round(name.getBoundingClientRect().width) : null,
      nameSW: name ? name.scrollWidth : null,
    };
  });
  const de = document.documentElement;
  return {
    h5Count: h5s.length,
    h5Sizes: [...new Set(h5s.map((h) => cs(h, 'fontSize')))],
    h5Color: h5s.length ? cs(h5s[0], 'color') : null,
    bodyP: (() => { const p = art && art.querySelector('p'); return p ? cs(p, 'fontSize') : null; })(),
    filterBar: fb ? { position: cs(fb, 'position'), top: cs(fb, 'top'), z: cs(fb, 'zIndex') } : null,
    tdCount: tds.length,
    tokenCount: (() => {
      let n = 0;
      for (const td of tds) { TOKEN.lastIndex = 0; n += ((td.textContent || '').match(TOKEN) || []).length; }
      return n;
    })(),
    brokenTokens: uniq.size,
    brokenSample: [...uniq.values()].slice(0, 6),
    grpCount: grp.length,
    grpTruncated: grp.filter((g) => g.nameEll).length,
    zhTruncated: grp.filter((g) => g.zhEll).length,
    grpNames: grp.filter((g) => g.nameEll).map((g) => g.name + '(' + g.nameW + '<' + g.nameSW + ')'),
    hOverflow: de.scrollWidth - de.clientWidth,
    docH: de.scrollHeight,
  };
};

const settle = async (page) => {
  await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true));
  await page.evaluate(() => new Promise((res) => {
    let i = 0;
    const step = () => { if (++i >= 3) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }));
};

(async () => {
  if (!EXE) throw new Error('no chrome (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-gpu'],
  });
  const out = { generated_at: new Date().toISOString(), cells: {} };
  const CASES = [
    { key: 'head@1440', base: HEAD, w: 1440, h: 900, arm: 'with', page: '/paper/reference/cli-arguments/' },
    { key: 'head@1440-pdc', base: HEAD, w: 1440, h: 900, arm: 'with', page: '/paper/dev/pdc/' },
    { key: 'head@1440-allpages', base: HEAD, w: 1440, h: 900, arm: 'with', page: '/all-pages.html' },
    { key: 'head@320-dialogs', base: HEAD, w: 320, h: 568, arm: 'with', page: '/paper/dev/dialogs/' },
    { key: 'head@320-allpages', base: HEAD, w: 320, h: 568, arm: 'with', page: '/all-pages.html' },
    { key: 'head@320-nowrap-dialogs', base: HEAD, w: 320, h: 568, arm: 'without', page: '/paper/dev/dialogs/' },
    { key: 'head@320-nowrap-allpages', base: HEAD, w: 320, h: 568, arm: 'without', page: '/all-pages.html' },
    { key: 'b0@320-dialogs', base: B0, w: 320, h: 568, arm: 'with', page: '/paper/dev/dialogs/' },
    { key: 'b0@320-allpages', base: B0, w: 320, h: 568, arm: 'with', page: '/all-pages.html' },
    { key: 'head@390-dialogs', base: HEAD, w: 390, h: 844, arm: 'with', page: '/paper/dev/dialogs/' },
    { key: 'head@390-allpages', base: HEAD, w: 390, h: 844, arm: 'with', page: '/all-pages.html' },
    { key: 'head@768-allpages', base: HEAD, w: 768, h: 1024, arm: 'with', page: '/all-pages.html' },
    { key: 'head@1440-worldcfg', base: HEAD, w: 1440, h: 900, arm: 'with', page: '/paper/reference/world-configuration/' },
    { key: 'b0@1440-worldcfg', base: B0, w: 1440, h: 900, arm: 'with', page: '/paper/reference/world-configuration/' },
  ];
  try {
    for (const c of CASES) {
      const ctx = await browser.newContext({
        viewport: { width: c.w, height: c.h }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      await page.goto(c.base + c.page, { waitUntil: 'load', timeout: 60000 });
      await settle(page);
      if (c.arm === 'without') {
        await page.addStyleTag({ content: '.table-wrap td{overflow-wrap:normal !important}' });
        await settle(page);
      }
      const m = await page.evaluate(MEASURE);
      await ctx.close();
      out.cells[c.key] = m;
      console.log(c.key.padEnd(26) +
        ' h5=' + String(m.h5Count).padEnd(3) + JSON.stringify(m.h5Sizes).padEnd(10) +
        ' fb=' + String(m.filterBar ? m.filterBar.position + '@' + m.filterBar.top : '-').padEnd(14) +
        ' td=' + String(m.tdCount).padEnd(5) + ' toks=' + String(m.tokenCount).padEnd(5) +
        ' broken=' + String(m.brokenTokens).padEnd(4) +
        ' grpTrunc=' + String(m.grpTruncated).padEnd(3) + ' zhTrunc=' + String(m.zhTruncated).padEnd(3) +
        ' hOv=' + m.hOverflow);
      if (m.brokenSample.length) console.log('      brokenSample=' + JSON.stringify(m.brokenSample.slice(0, 4)));
      if (m.grpNames.length) console.log('      grpTrunc=' + JSON.stringify(m.grpNames.slice(0, 6)));
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-c5.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-c5.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
