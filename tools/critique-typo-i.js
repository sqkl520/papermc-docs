'use strict';
/* critique-typo-i.js -- language mix of article bodies + CJK/Latin gap on Chinese pages +
   overflow behaviour at 320px (code blocks, tables, long tokens). Read-only. */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..');

const EXE = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win', 'chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

const IN_PAGE = () => {
  const R2 = (v) => Math.round(v * 100) / 100;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const art = q('.article') || document.body;
  const text = (art.innerText || '');

  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/[0-9]/g) || []).length;
  const punct = (text.match(/[\u3000-\u303f\uff00-\uffef]/g) || []).length;

  /* CJK<->Latin gap on real Chinese prose */
  const gaps = [];
  const paras = qa('p, li, td', art);
  for (const p of paras) {
    if (gaps.length > 40) break;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      for (let i = 0; i + 1 < v.length; i++) {
        const a = v[i], b = v[i + 1];
        const hanA = /[\u4e00-\u9fff]/.test(a), hanB = /[\u4e00-\u9fff]/.test(b);
        const latA = /[A-Za-z0-9]/.test(a), latB = /[A-Za-z0-9]/.test(b);
        if ((hanA && latB) || (latA && hanB)) {
          const r = document.createRange();
          r.setStart(n, i); r.setEnd(n, i + 1);
          const r1 = r.getBoundingClientRect();
          r.setStart(n, i + 1); r.setEnd(n, i + 2);
          const r2 = r.getBoundingClientRect();
          if (!r1.width || !r2.width) continue;
          if (Math.abs(r1.top - r2.top) > 4) continue;
          gaps.push({ pair: (a + b), gap: R2(r2.left - r1.right), size: R2(parseFloat(getComputedStyle(p).fontSize)), sel: p.tagName.toLowerCase() });
          if (gaps.length > 40) break;
        }
      }
    }
  }
  const gapVals = gaps.map((g) => g.gap);
  const med = gapVals.length ? gapVals.slice().sort((x, y) => x - y)[Math.floor(gapVals.length / 2)] : null;

  /* punctuation compression: consecutive 。， at line ends etc. (informational) */
  const cjkPunctSpacing = getComputedStyle(art).textSpacingTrim || getComputedStyle(art).textAutospace || null;

  /* overflow audit at this viewport */
  const overflow = [];
  qa('.article *').forEach((el) => {
    const s = getComputedStyle(el);
    if (s.overflowX === 'auto' || s.overflowX === 'scroll') return;
    const r = el.getBoundingClientRect();
    const parentW = el.parentElement ? el.parentElement.getBoundingClientRect().width : 0;
    if (r.width > parentW + 2 && parentW > 0) {
      overflow.push({ sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''), w: R2(r.width), parentW: R2(parentW) });
    }
  });

  /* scroll containers: does content actually overflow inside them? */
  const scrollables = qa('.code-pre, .code-scroll, .table-wrap').slice(0, 12).map((el) => ({
    sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''),
    clientW: el.clientWidth, scrollW: el.scrollWidth, overflows: el.scrollWidth > el.clientWidth + 1,
  }));

  /* document-level horizontal overflow */
  const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;

  return {
    url: location.pathname,
    innerW: document.documentElement.clientWidth,
    docOverflowPx: docOverflow,
    docHeight: Math.round(document.documentElement.scrollHeight),
    mix: { han, latin, digits, punct, hanRatio: R2(han / Math.max(1, han + latin)) },
    cjkGap: { count: gaps.length, medianPx: med, minPx: gapVals.length ? Math.min.apply(null, gapVals) : null, maxPx: gapVals.length ? Math.max.apply(null, gapVals) : null },
    cjkSpacingProp: cjkPunctSpacing,
    overflow: overflow.slice(0, 12),
    overflowCount: overflow.length,
    scrollables,
    lang: document.documentElement.lang,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--force-color-profile=srgb'] });
  const pages = ['/', '/paper/', '/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/velocity/tuning/', '/all-pages.html'];
  const out = [];
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const u of pages) {
      await page.goto('http://127.0.0.1:8787' + u, { waitUntil: 'load' });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.waitForTimeout(60);
      const d = await page.evaluate(IN_PAGE);
      out.push({ vp: vp.width + 'x' + vp.height, ...d });
      process.stderr.write('ok ' + vp.width + ' ' + u + ' han=' + d.mix.han + ' latin=' + d.mix.latin + '\n');
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, '..', '_typo-critique', 'i-lang.json'), JSON.stringify(out, null, 1), 'utf8');
  for (const r of out) console.log([r.vp.padEnd(9), r.url.padEnd(40), 'han', String(r.mix.han).padStart(6), 'lat', String(r.mix.latin).padStart(6), 'ratio', r.mix.hanRatio, 'gap', r.cjkGap.medianPx, 'docOvfl', r.docOverflowPx, 'ovfl', r.overflowCount].join(' '));
})();
