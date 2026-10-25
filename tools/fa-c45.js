'use strict';
/**
 * fa-c45.js — final acceptance, group F: C4 (image width/height -> CLS) and C5 (four items).
 *
 * Measured on the immutable 4ce8407 archive (:8796), so a concurrent agent editing the
 * working tree cannot move the numbers. The "without" arm strips width/height from
 * content-img tags via route fulfil (no disk writes) to attribute CLS to C4.
 *
 * C5 four items:
 *   1) h5 font-size = 17px (1.0625rem)
 *   2) td word-break <= 5 at 320px
 *   3) .filter-bar position: sticky
 *   4) group-name truncation count (sidebar .grp-name ellipsised)
 *
 * Usage: node tools/fa-c45.js
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

const CLS_INIT = () => {
  window.__cls = { total: 0, max: 0, count: 0, entries: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls.total += e.value;
        window.__cls.count += 1;
        if (e.value > window.__cls.max) window.__cls.max = e.value;
        window.__cls.entries.push({
          v: +e.value.toFixed(5),
          t: Math.round(e.startTime),
          src: (e.sources || []).map((s) => {
            const n = s.node;
            if (!n) return '';
            const t = (n.tagName || '').toLowerCase();
            const src = n.currentSrc || (n.getAttribute && n.getAttribute('src')) || '';
            return t + (src ? ':' + String(src).split('/').pop().slice(0, 44) : '');
          }).slice(0, 3),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* unsupported */ }
};

const IMG_RATIOS = () => {
  const imgs = [...document.querySelectorAll('img.content-img')];
  const rows = imgs.map((im) => {
    const r = im.getBoundingClientRect();
    const cs = getComputedStyle(im);
    const bw = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const bh = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const cw = r.width - bw;
    const ch = r.height - bh;
    const natAR = im.naturalHeight > 0 ? im.naturalWidth / im.naturalHeight : null;
    const contentAR = ch > 0 ? cw / ch : null;
    const aw = parseInt(im.getAttribute('width') || '0', 10);
    const ah = parseInt(im.getAttribute('height') || '0', 10);
    return {
      n: (im.currentSrc || im.getAttribute('src') || '').split('/').pop().slice(0, 44),
      w: Math.round(r.width), h: Math.round(r.height),
      natural: im.naturalWidth + 'x' + im.naturalHeight,
      attr: (aw || '-') + 'x' + (ah || '-'),
      naturalAR: natAR === null ? null : +natAR.toFixed(4),
      contentAR: contentAR === null ? null : +contentAR.toFixed(4),
      arDrift: natAR && contentAR ? +(Math.abs(contentAR - natAR) / natAR).toFixed(5) : null,
    };
  });
  return {
    cls: +window.__cls.total.toFixed(5),
    maxShift: +window.__cls.max.toFixed(5),
    shiftCount: window.__cls.count,
    shifts: window.__cls.entries.slice(0, 10),
    contentImgs: imgs.length,
    withDims: imgs.filter((i) => i.getAttribute('width') && i.getAttribute('height')).length,
    rows,
    maxArDrift: rows.reduce((m, r) => Math.max(m, r.arDrift === null ? 0 : r.arDrift), 0),
    docH: document.documentElement.scrollHeight,
  };
};

const C5 = () => {
  const cs = (e, p) => (e ? getComputedStyle(e)[p] : null);
  const art = document.querySelector('article.article') || document.querySelector('article');
  const h5s = art ? [...art.querySelectorAll('h5')] : [];
  const fb = document.querySelector('.filter-bar');
  /* word-break audit at 320: find text nodes whose rect is narrower than a word
     because the browser had to break inside a word. Practical proxy: count elements
     whose scrollWidth exceeds clientWidth is NOT it (that is overflow). Instead count
     occurrences of intra-word wrapping by comparing line count vs word count for td. */
  const tds = [...document.querySelectorAll('.table-wrap td')];
  let broken = 0;
  const brokenSamples = [];
  for (const td of tds) {
    const rg = document.createRange();
    rg.selectNodeContents(td);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const lines = new Set(rects.map((r) => Math.round(r.top))).size;
    const words = (td.textContent || '').trim().split(/\s+/).filter(Boolean).length;
    /* more visual lines than words => at least one word was broken */
    if (words > 0 && lines > words) {
      broken++;
      if (brokenSamples.length < 6) brokenSamples.push({ text: (td.textContent || '').trim().slice(0, 40), lines, words });
    }
  }
  const grp = [...document.querySelectorAll('.side-group-title')].map((g) => {
    const name = g.querySelector('.grp-name');
    const zh = g.querySelector('.grp-zh');
    const ell = (el) => (el ? el.scrollWidth > el.clientWidth + 1 : false);
    return {
      name: name ? (name.textContent || '').trim().slice(0, 24) : null,
      nameEllipsised: ell(name),
      zhEllipsised: ell(zh),
      nameW: name ? Math.round(name.getBoundingClientRect().width) : null,
      nameScrollW: name ? name.scrollWidth : null,
    };
  });
  return {
    h5Count: h5s.length,
    h5Sizes: [...new Set(h5s.map((h) => cs(h, 'fontSize')))],
    pSize: (() => { const p = art && art.querySelector('p'); return p ? cs(p, 'fontSize') : null; })(),
    filterBar: fb ? { position: cs(fb, 'position'), top: cs(fb, 'top'), zIndex: cs(fb, 'zIndex') } : null,
    tdCount: tds.length,
    tdBroken: broken,
    tdBrokenSamples: brokenSamples,
    grpCount: grp.length,
    grpTruncated: grp.filter((g) => g.nameEllipsised).length,
    grpDetail: grp,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
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
  const out = { generated_at: new Date().toISOString(), cls: {}, c5: {} };
  try {
    /* ---------- CLS: with-dim vs without-dim, slow network to expose the shift ---------- */
    for (const arm of ['with', 'without']) {
      for (const w of [1440, 390]) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: w === 1440 ? 900 : 844 },
          deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        /* throttle images so the shift (if any) actually happens */
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false, latency: 150, downloadThroughput: 220 * 1024 / 8, uploadThroughput: 64 * 1024 / 8,
        });
        await page.addInitScript(CLS_INIT);
        if (arm === 'without') {
          await page.route('**/*.html', async (route) => {
            const resp = await route.fetch();
            let body = await resp.text();
            body = body.replace(/<img\b[^>]*>/g, (tag) => (/class="[^"]*\bcontent-img\b[^"]*"/.test(tag)
              ? tag.replace(/\s(?:width|height)="\d+"/g, '') : tag));
            await route.fulfill({ response: resp, body });
          });
        }
        await page.goto(HEAD + '/paper/dev/dialogs/', { waitUntil: 'load', timeout: 90000 });
        await page.waitForTimeout(2200);
        const m = await page.evaluate(IMG_RATIOS);
        await ctx.close();
        out.cls[arm + '@' + w] = m;
        console.log('CLS ' + arm.padEnd(8) + ' @' + String(w).padEnd(5) + ' cls=' + String(m.cls).padEnd(8) +
          ' max=' + String(m.maxShift).padEnd(8) + ' n=' + String(m.shiftCount).padEnd(3) +
          ' imgs=' + m.contentImgs + ' withDims=' + m.withDims + ' maxARdrift=' + m.maxArDrift + ' docH=' + m.docH);
        if (m.shifts.length) console.log('    shifts: ' + JSON.stringify(m.shifts.slice(0, 4)));
      }
    }

    /* ---------- C5 ---------- */
    for (const [w, h, pages] of [
      [1440, 900, ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/paper/reference/cli-arguments/', '/all-pages.html', '/paper/dev/pdc/']],
      [320, 568, ['/paper/dev/dialogs/', '/paper/reference/world-configuration/', '/all-pages.html', '/paper/dev/pdc/']],
      [390, 844, ['/paper/dev/dialogs/', '/all-pages.html']],
      [768, 1024, ['/paper/dev/dialogs/', '/all-pages.html']],
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      for (const p of pages) {
        await page.goto(HEAD + p, { waitUntil: 'load', timeout: 60000 });
        await settle(page);
        const m = await page.evaluate(C5);
        out.c5[w + '|' + p] = m;
        console.log('\nC5 @' + w + ' ' + p);
        console.log('   h5=' + m.h5Count + ' sizes=' + JSON.stringify(m.h5Sizes) + ' p=' + m.pSize +
          ' | filterBar=' + JSON.stringify(m.filterBar));
        console.log('   td=' + m.tdCount + ' broken=' + m.tdBroken + ' | grp=' + m.grpCount + ' truncated=' + m.grpTruncated +
          ' | hOv=' + m.hOverflow);
        if (m.tdBrokenSamples.length) console.log('   brokenSamples=' + JSON.stringify(m.tdBrokenSamples.slice(0, 3)));
        if (m.grpDetail.length) console.log('   grp=' + JSON.stringify(m.grpDetail.map((g) => g.name + (g.nameEllipsised ? '(T)' : '') + (g.zhEllipsised ? '(zhT)' : ''))));
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'fa-c45.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\nJSON: ' + path.join(OUT, 'fa-c45.json'));
  }
})().catch((e) => { console.error(e); process.exit(1); });
